import { describe, expect, it, vi } from 'vitest';
import { applySnapshot, applyStateUpdate, applyTerrain } from './state';
import { createInitialViewerState } from './types';
import { MessageType, type ParsedSnapshot, type ParsedStateUpdate, type ParsedTerrain } from './protocol/types';

function makeSnapshot(entityCount: number, tick = 1): ParsedSnapshot {
  return {
    type: MessageType.SNAPSHOT,
    tick,
    worldWidth: 1000,
    worldHeight: 800,
    entityCount,
    positions: new Float64Array(entityCount * 2).fill(1),
    velocities: new Float64Array(entityCount * 2).fill(2),
    profileIndices: new Int32Array(entityCount).fill(0),
  };
}

function makeUpdate(entityCount: number, tick = 2, fill = 9): ParsedStateUpdate {
  return {
    type: MessageType.STATE_UPDATE,
    tick,
    entityCount,
    positions: new Float64Array(entityCount * 2).fill(fill),
    velocities: new Float64Array(entityCount * 2).fill(fill),
  };
}

function makeF32Update(entityCount: number, tick = 2, fill = 9): ParsedStateUpdate {
  return {
    type: MessageType.STATE_UPDATE,
    tick,
    entityCount,
    positions: new Float32Array(entityCount * 2).fill(fill),
    velocities: new Float32Array(entityCount * 2).fill(fill),
  };
}

function makeTerrain(elevation: number, rows = 1, cols = 1, resolution = 10): ParsedTerrain {
  return {
    type: MessageType.TERRAIN,
    rows,
    cols,
    resolution,
    originX: 0,
    originY: 0,
    elevation: new Float64Array(rows * cols).fill(elevation),
  };
}

describe('createInitialViewerState', () => {
  it('returns expected initial values', () => {
    const s = createInitialViewerState();
    expect(s.worldWidth).toBe(0);
    expect(s.worldHeight).toBe(0);
    expect(s.entityCount).toBe(0);
    expect(s.positions).toBeNull();
    expect(s.velocities).toBeNull();
    expect(s.entityHeights).toBeNull();
    expect(s.profileIndices).toBeNull();
    expect(s.currentTick).toBe(0);
    expect(s.connectionStatus).toBe('disconnected');
  });
});

describe('applySnapshot', () => {
  it('replaces all relevant fields and retains references to parsed arrays', () => {
    const state = createInitialViewerState();
    const snap = makeSnapshot(3, 42);
    applySnapshot(state, snap);
    expect(state.entityCount).toBe(3);
    expect(state.worldWidth).toBe(1000);
    expect(state.worldHeight).toBe(800);
    expect(state.currentTick).toBe(42);
    expect(state.positions).toBe(snap.positions);
    expect(state.velocities).toBe(snap.velocities);
    expect(state.profileIndices).toBe(snap.profileIndices);
  });
});

describe('applyStateUpdate', () => {
  it('updates positions/velocities/tick without reallocating', () => {
    const state = createInitialViewerState();
    applySnapshot(state, makeSnapshot(2, 1));
    const positionsRef = state.positions;
    const velocitiesRef = state.velocities;
    applyStateUpdate(state, makeUpdate(2, 5, 7));
    expect(state.positions).toBe(positionsRef);
    expect(state.velocities).toBe(velocitiesRef);
    expect(state.currentTick).toBe(5);
    expect(state.positions?.[0]).toBe(7);
    expect(state.velocities?.[3]).toBe(7);
  });

  it('returns early on length mismatch and leaves state unchanged', () => {
    const state = createInitialViewerState();
    applySnapshot(state, makeSnapshot(2, 1));
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    applyStateUpdate(state, makeUpdate(5, 99));
    expect(state.currentTick).toBe(1);
    expect(state.positions?.[0]).toBe(1); // original snapshot fill
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it('returns early when positions are null', () => {
    const state = createInitialViewerState();
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    applyStateUpdate(state, makeUpdate(2));
    expect(state.currentTick).toBe(0);
    warnSpy.mockRestore();
  });

  it('same dtype: copies into existing buffers without reallocating', () => {
    const state = createInitialViewerState();
    applySnapshot(state, makeSnapshot(2, 1));
    const posRef = state.positions;
    const velRef = state.velocities;
    applyStateUpdate(state, makeUpdate(2, 5, 42));
    // same-dtype path: buffer identity preserved
    expect(state.positions).toBe(posRef);
    expect(state.velocities).toBe(velRef);
    expect(state.positions?.[0]).toBe(42);
    expect(state.currentTick).toBe(5);
  });

  it('dtype switch: replaces buffers and logs warning', () => {
    const state = createInitialViewerState();
    // Establish f64 buffers via snapshot
    applySnapshot(state, makeSnapshot(2, 1));
    expect(state.positions).toBeInstanceOf(Float64Array);

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const f32Update = makeF32Update(2, 3, 7);
    applyStateUpdate(state, f32Update);

    expect(warnSpy).toHaveBeenCalledWith('[state] position dtype changed mid-connection — replacing buffers');
    expect(state.positions).toBeInstanceOf(Float32Array);
    expect(state.velocities).toBeInstanceOf(Float32Array);
    expect(state.positions?.[0]).toBe(7);
    expect(state.currentTick).toBe(3);
    warnSpy.mockRestore();
  });
});

// T3/T5: bakeEntityHeights driven through applySnapshot
describe('applySnapshot — entityHeights baking', () => {
  it('allocates entityHeights of correct length and bakes flat-terrain heights', () => {
    const state = createInitialViewerState();
    // 2 entities at positions (0,0) and (1,1); no terrain → getTerrainHeight returns 0
    const snap: ParsedSnapshot = {
      type: MessageType.SNAPSHOT,
      tick: 1,
      worldWidth: 100,
      worldHeight: 100,
      entityCount: 2,
      positions: new Float64Array([0, 0, 1, 1]),
      velocities: new Float64Array(4),
      profileIndices: new Int32Array([0, 0]),
    };
    applySnapshot(state, snap);
    expect(state.entityHeights).toBeInstanceOf(Float32Array);
    expect(state.entityHeights?.length).toBe(2);
    // No terrain — heights should be 0
    expect(state.entityHeights?.[0]).toBeCloseTo(0);
    expect(state.entityHeights?.[1]).toBeCloseTo(0);
  });

  it('bakes correct values from a non-flat terrain grid', () => {
    const state = createInitialViewerState();
    const snap: ParsedSnapshot = {
      type: MessageType.SNAPSHOT,
      tick: 1,
      worldWidth: 100,
      worldHeight: 100,
      entityCount: 2,
      positions: new Float64Array([5, 5, 5, 5]),
      velocities: new Float64Array(4),
      profileIndices: new Int32Array([0, 0]),
    };
    applySnapshot(state, snap);
    // Apply terrain after snapshot — T9 covers rebake; here we verify snapshot bakes with existing terrain
    state.terrain = {
      rows: 1, cols: 1, resolution: 10, originX: 0, originY: 0,
      elevation: new Float64Array([7.5]),
    };
    // Manually call applySnapshot again with terrain in place
    applySnapshot(state, snap);
    expect(state.entityHeights?.[0]).toBeCloseTo(7.5);
    expect(state.entityHeights?.[1]).toBeCloseTo(7.5);
  });

  it('allocates entityHeights of length 0 for a zero-entity snapshot', () => {
    const state = createInitialViewerState();
    applySnapshot(state, makeSnapshot(0, 1));
    expect(state.entityHeights).toBeInstanceOf(Float32Array);
    expect(state.entityHeights?.length).toBe(0);
  });
});

// T7: applyStateUpdate bakes heights
describe('applyStateUpdate — entityHeights baking', () => {
  it('rebakes heights after a state update changes positions', () => {
    const state = createInitialViewerState();
    state.terrain = {
      rows: 1, cols: 1, resolution: 10, originX: 0, originY: 0,
      elevation: new Float64Array([4.0]),
    };
    // Snapshot at pos (0,0)
    applySnapshot(state, {
      type: MessageType.SNAPSHOT,
      tick: 1,
      worldWidth: 100,
      worldHeight: 100,
      entityCount: 1,
      positions: new Float64Array([0, 0]),
      velocities: new Float64Array([0, 0]),
      profileIndices: new Int32Array([0]),
    });
    expect(state.entityHeights?.[0]).toBeCloseTo(4.0);

    // State update moves entity; terrain height is still 4.0 (same cell)
    applyStateUpdate(state, {
      type: MessageType.STATE_UPDATE,
      tick: 2,
      entityCount: 1,
      positions: new Float64Array([5, 5]),
      velocities: new Float64Array([0, 0]),
    });
    expect(state.entityHeights?.[0]).toBeCloseTo(4.0);
  });

  it('returns 0 height when terrain is null (flat fallback)', () => {
    const state = createInitialViewerState();
    // null terrain — getTerrainHeight returns 0
    applySnapshot(state, {
      type: MessageType.SNAPSHOT,
      tick: 1,
      worldWidth: 100,
      worldHeight: 100,
      entityCount: 1,
      positions: new Float64Array([0, 0]),
      velocities: new Float64Array([0, 0]),
      profileIndices: new Int32Array([0]),
    });
    applyStateUpdate(state, {
      type: MessageType.STATE_UPDATE,
      tick: 2,
      entityCount: 1,
      positions: new Float64Array([5, 5]),
      velocities: new Float64Array([0, 0]),
    });
    expect(state.entityHeights?.[0]).toBeCloseTo(0);
  });
});

// T9: applyTerrain rebakes heights
describe('applyTerrain — entityHeights rebake', () => {
  it('rebakes heights when terrain changes without a STATE_UPDATE', () => {
    const state = createInitialViewerState();
    // Snapshot with flat terrain (elevation 0)
    applySnapshot(state, {
      type: MessageType.SNAPSHOT,
      tick: 1,
      worldWidth: 100,
      worldHeight: 100,
      entityCount: 1,
      positions: new Float64Array([5, 5]),
      velocities: new Float64Array([0, 0]),
      profileIndices: new Int32Array([0]),
    });
    expect(state.entityHeights?.[0]).toBeCloseTo(0); // no terrain yet

    // Apply terrain with elevation 3.5
    applyTerrain(state, makeTerrain(3.5));
    expect(state.entityHeights?.[0]).toBeCloseTo(3.5);
  });

  it('does not crash when positions are null at applyTerrain time', () => {
    const state = createInitialViewerState();
    // No snapshot — positions and entityHeights are null
    expect(() => applyTerrain(state, makeTerrain(5.0))).not.toThrow();
    expect(state.entityHeights).toBeNull();
  });
});
