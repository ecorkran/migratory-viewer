import { describe, expect, it, vi } from 'vitest';
import { applySnapshot, applyStateUpdate } from './state';
import { createInitialViewerState } from './types';
import { MessageType, type ParsedSnapshot, type ParsedStateUpdate } from './protocol/types';

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

describe('createInitialViewerState', () => {
  it('returns expected initial values', () => {
    const s = createInitialViewerState();
    expect(s.worldWidth).toBe(0);
    expect(s.worldHeight).toBe(0);
    expect(s.entityCount).toBe(0);
    expect(s.positions).toBeNull();
    expect(s.velocities).toBeNull();
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
});
