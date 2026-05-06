import { describe, expect, it, vi } from 'vitest';
import { parseMessage } from './deserialize';
import { MessageType } from './types';

import { PositionDtype } from './types';

/**
 * Build a binary snapshot buffer matching the new 26-byte header layout:
 * `[u8 type | u32 tick | f64 worldWidth | f64 worldHeight | u32 entityCount | u8 dtype | payload...]`
 *
 * Supports both f64 (dtype=0x00) and f32 (dtype=0x01) payloads.
 */
function buildSnapshot(
  tick: number,
  worldWidth: number,
  worldHeight: number,
  positions: number[], // interleaved x,y
  velocities: number[], // interleaved vx,vy
  profileIndices: number[],
  dtype: number = PositionDtype.F64,
): ArrayBuffer {
  const entityCount = profileIndices.length;
  const isF32 = dtype === PositionDtype.F32;
  const posVelBytesPerEntity = isF32 ? 16 : 32;
  const totalBytes = 26 + entityCount * (posVelBytesPerEntity + 4);
  const buf = new ArrayBuffer(totalBytes);
  const view = new DataView(buf);
  view.setUint8(0, MessageType.SNAPSHOT);
  view.setUint32(1, tick, true);
  view.setFloat64(5, worldWidth, true);
  view.setFloat64(13, worldHeight, true);
  view.setUint32(21, entityCount, true);
  view.setUint8(25, dtype);
  let off = 26;
  for (const v of positions) {
    if (isF32) { view.setFloat32(off, v, true); off += 4; }
    else { view.setFloat64(off, v, true); off += 8; }
  }
  for (const v of velocities) {
    if (isF32) { view.setFloat32(off, v, true); off += 4; }
    else { view.setFloat64(off, v, true); off += 8; }
  }
  for (const v of profileIndices) {
    view.setInt32(off, v, true);
    off += 4;
  }
  return buf;
}

/**
 * Build a binary state update matching the new 10-byte header layout:
 * `[u8 type | u32 tick | u32 entityCount | u8 dtype | payload...]`
 *
 * Supports both f64 (dtype=0x00) and f32 (dtype=0x01) payloads.
 */
function buildStateUpdate(
  tick: number,
  positions: number[],
  velocities: number[],
  dtype: number = PositionDtype.F64,
): ArrayBuffer {
  const entityCount = positions.length / 2;
  const isF32 = dtype === PositionDtype.F32;
  const perEntityBytes = isF32 ? 16 : 32;
  const totalBytes = 10 + entityCount * perEntityBytes;
  const buf = new ArrayBuffer(totalBytes);
  const view = new DataView(buf);
  view.setUint8(0, MessageType.STATE_UPDATE);
  view.setUint32(1, tick, true);
  view.setUint32(5, entityCount, true);
  view.setUint8(9, dtype);
  let off = 10;
  for (const v of positions) {
    if (isF32) { view.setFloat32(off, v, true); off += 4; }
    else { view.setFloat64(off, v, true); off += 8; }
  }
  for (const v of velocities) {
    if (isF32) { view.setFloat32(off, v, true); off += 4; }
    else { view.setFloat64(off, v, true); off += 8; }
  }
  return buf;
}

describe('parseMessage — dispatch and validation', () => {
  it('returns null on empty buffer', () => {
    expect(parseMessage(new ArrayBuffer(0))).toBeNull();
  });

  it('returns null on unknown message type byte', () => {
    const buf = new ArrayBuffer(4);
    new DataView(buf).setUint8(0, 0xff);
    expect(parseMessage(buf)).toBeNull();
  });
});

describe('parseSnapshot', () => {
  it('parses a zero-entity snapshot', () => {
    const buf = buildSnapshot(42, 1000, 800, [], [], []);
    const result = parseMessage(buf);
    expect(result).not.toBeNull();
    if (result === null || result.type !== MessageType.SNAPSHOT) throw new Error('expected snapshot');
    expect(result.tick).toBe(42);
    expect(result.worldWidth).toBe(1000);
    expect(result.worldHeight).toBe(800);
    expect(result.entityCount).toBe(0);
    expect(result.positions.length).toBe(0);
    expect(result.velocities.length).toBe(0);
    expect(result.profileIndices.length).toBe(0);
  });

  it('parses a single-entity f64 snapshot — explicit round-trip', () => {
    const buf = buildSnapshot(100, 1000, 1000, [12.5, -7.25], [0.5, -0.25], [3], PositionDtype.F64);
    const result = parseMessage(buf);
    if (result === null || result.type !== MessageType.SNAPSHOT) throw new Error('expected snapshot');
    expect(result.tick).toBe(100);
    expect(result.entityCount).toBe(1);
    expect(result.positions).toBeInstanceOf(Float64Array);
    expect(Array.from(result.positions)).toEqual([12.5, -7.25]);
    expect(result.velocities).toBeInstanceOf(Float64Array);
    expect(Array.from(result.velocities)).toEqual([0.5, -0.25]);
    expect(Array.from(result.profileIndices)).toEqual([3]);
  });

  it('parses a three-entity snapshot with distinct profile indices', () => {
    const positions = [1, 2, 3, 4, 5, 6];
    const velocities = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6];
    const profiles = [0, 2, 4];
    const buf = buildSnapshot(7, 500, 500, positions, velocities, profiles);
    const result = parseMessage(buf);
    if (result === null || result.type !== MessageType.SNAPSHOT) throw new Error('expected snapshot');
    expect(result.entityCount).toBe(3);
    expect(Array.from(result.positions)).toEqual(positions);
    expect(Array.from(result.velocities)).toEqual(velocities);
    expect(Array.from(result.profileIndices)).toEqual(profiles);
  });

  it('returns null when snapshot is truncated', () => {
    const buf = buildSnapshot(1, 100, 100, [1, 2], [3, 4], [0]);
    const truncated = buf.slice(0, buf.byteLength - 4);
    expect(parseMessage(truncated)).toBeNull();
  });

  it('returns null when entity count exceeds cap', () => {
    // Manually craft a header claiming a huge entity count.
    const buf = new ArrayBuffer(26);
    const view = new DataView(buf);
    view.setUint8(0, MessageType.SNAPSHOT);
    view.setUint32(1, 1, true);
    view.setFloat64(5, 100, true);
    view.setFloat64(13, 100, true);
    view.setUint32(21, 9_999_999, true);
    view.setUint8(25, PositionDtype.F64);
    expect(parseMessage(buf)).toBeNull();
  });

  it('returns typed-array copies independent from the source buffer', () => {
    const buf = buildSnapshot(1, 100, 100, [10, 20], [0, 0], [0]);
    const result = parseMessage(buf);
    if (result === null || result.type !== MessageType.SNAPSHOT) throw new Error('expected snapshot');
    // Mutating the result must not affect re-parsing the original buffer.
    result.positions[0] = 999;
    const reparsed = parseMessage(buf);
    if (reparsed === null || reparsed.type !== MessageType.SNAPSHOT) throw new Error('expected snapshot');
    expect(reparsed.positions[0]).toBe(10);
  });
});

describe('parseSnapshot — f32 and unknown dtype', () => {
  it('parses a 2-entity f32 snapshot — returns Float32Array with correct values', () => {
    const buf = buildSnapshot(
      55,
      500,
      500,
      [1.5, 2.5, 3.5, 4.5],
      [0.1, 0.2, 0.3, 0.4],
      [0, 1],
      PositionDtype.F32,
    );
    const result = parseMessage(buf);
    if (result === null || result.type !== MessageType.SNAPSHOT) throw new Error('expected snapshot');
    expect(result.entityCount).toBe(2);
    expect(result.positions).toBeInstanceOf(Float32Array);
    expect(result.velocities).toBeInstanceOf(Float32Array);
    // f32 precision: compare with tolerance
    expect(result.positions[0]).toBeCloseTo(1.5, 5);
    expect(result.positions[1]).toBeCloseTo(2.5, 5);
    expect(result.positions[2]).toBeCloseTo(3.5, 5);
    expect(result.positions[3]).toBeCloseTo(4.5, 5);
    expect(result.velocities[0]).toBeCloseTo(0.1, 5);
    expect(result.velocities[3]).toBeCloseTo(0.4, 5);
    expect(Array.from(result.profileIndices)).toEqual([0, 1]);
  });

  it('returns null and warns on unknown snapshot dtype', () => {
    const buf = new ArrayBuffer(26);
    const view = new DataView(buf);
    view.setUint8(0, MessageType.SNAPSHOT);
    view.setUint32(1, 1, true);
    view.setFloat64(5, 100, true);
    view.setFloat64(13, 100, true);
    view.setUint32(21, 0, true);
    view.setUint8(25, 0xff);
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(parseMessage(buf)).toBeNull();
    expect(warnSpy).toHaveBeenCalledWith('[protocol] unknown position dtype: 0xff');
    warnSpy.mockRestore();
  });
});

describe('parseStateUpdate', () => {
  it('parses a f64 state update — explicit round-trip', () => {
    const buf = buildStateUpdate(99, [10, 20, 30, 40], [1, 2, 3, 4], PositionDtype.F64);
    const result = parseMessage(buf);
    if (result === null || result.type !== MessageType.STATE_UPDATE) throw new Error('expected update');
    expect(result.tick).toBe(99);
    expect(result.entityCount).toBe(2);
    expect(result.positions).toBeInstanceOf(Float64Array);
    expect(Array.from(result.positions)).toEqual([10, 20, 30, 40]);
    expect(result.velocities).toBeInstanceOf(Float64Array);
    expect(Array.from(result.velocities)).toEqual([1, 2, 3, 4]);
  });

  it('returns null when state update is truncated', () => {
    const buf = buildStateUpdate(1, [1, 2], [3, 4]);
    const truncated = buf.slice(0, buf.byteLength - 8);
    expect(parseMessage(truncated)).toBeNull();
  });

  it('discriminates type for narrowing', () => {
    const snap = parseMessage(buildSnapshot(1, 1, 1, [], [], []));
    const upd = parseMessage(buildStateUpdate(1, [], []));
    if (snap === null || upd === null) throw new Error('parse failed');
    expect(snap.type).toBe(MessageType.SNAPSHOT);
    expect(upd.type).toBe(MessageType.STATE_UPDATE);
  });
});

describe('parseStateUpdate — f32 and unknown dtype', () => {
  it('parses a 2-entity f32 state update — returns Float32Array with correct values', () => {
    const buf = buildStateUpdate(77, [5.5, 6.5, 7.5, 8.5], [0.5, 0.6, 0.7, 0.8], PositionDtype.F32);
    const result = parseMessage(buf);
    if (result === null || result.type !== MessageType.STATE_UPDATE) throw new Error('expected update');
    expect(result.entityCount).toBe(2);
    expect(result.positions).toBeInstanceOf(Float32Array);
    expect(result.velocities).toBeInstanceOf(Float32Array);
    expect(result.positions[0]).toBeCloseTo(5.5, 5);
    expect(result.positions[1]).toBeCloseTo(6.5, 5);
    expect(result.velocities[2]).toBeCloseTo(0.7, 5);
  });

  it('returns null and warns on unknown state update dtype', () => {
    const buf = new ArrayBuffer(10);
    const view = new DataView(buf);
    view.setUint8(0, MessageType.STATE_UPDATE);
    view.setUint32(1, 1, true);
    view.setUint32(5, 0, true);
    view.setUint8(9, 0xff);
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(parseMessage(buf)).toBeNull();
    expect(warnSpy).toHaveBeenCalledWith('[protocol] unknown position dtype: 0xff');
    warnSpy.mockRestore();
  });
});

// Slice 102's v1 terrain (single-shot 0x03, raw f64 payload) tests have been
// removed: terrain decode is now exclusively routed through the v2 assembler
// in protocol/terrain-assembler.ts. Coverage of TERRAIN parsing — including
// dtype/compression flags, length validation, and the spec worked example —
// lives in terrain-assembler.test.ts and terrain-assembler-chunked.test.ts.
