import { describe, expect, it } from 'vitest';
import { parseMessage } from './deserialize';
import { MessageType } from './types';

/**
 * Build a binary snapshot buffer matching the Python `struct.pack("<BIddI", ...)` layout
 * followed by f64 positions, f64 velocities, and i32 profile indices.
 *
 * This is the ground-truth format from `reference/server/protocol.py:serialize_snapshot`.
 */
function buildSnapshot(
  tick: number,
  worldWidth: number,
  worldHeight: number,
  positions: number[], // interleaved x,y
  velocities: number[], // interleaved vx,vy
  profileIndices: number[],
): ArrayBuffer {
  const entityCount = profileIndices.length;
  const totalBytes = 25 + entityCount * 36;
  const buf = new ArrayBuffer(totalBytes);
  const view = new DataView(buf);
  view.setUint8(0, 0x01);
  view.setUint32(1, tick, true);
  view.setFloat64(5, worldWidth, true);
  view.setFloat64(13, worldHeight, true);
  view.setUint32(21, entityCount, true);
  let off = 25;
  for (const v of positions) {
    view.setFloat64(off, v, true);
    off += 8;
  }
  for (const v of velocities) {
    view.setFloat64(off, v, true);
    off += 8;
  }
  for (const v of profileIndices) {
    view.setInt32(off, v, true);
    off += 4;
  }
  return buf;
}

/**
 * Build a binary state update matching `serialize_state_update`:
 * `struct.pack("<BII", ...)` + f64 positions + f64 velocities.
 */
function buildStateUpdate(
  tick: number,
  positions: number[],
  velocities: number[],
): ArrayBuffer {
  const entityCount = positions.length / 2;
  const totalBytes = 9 + entityCount * 32;
  const buf = new ArrayBuffer(totalBytes);
  const view = new DataView(buf);
  view.setUint8(0, 0x02);
  view.setUint32(1, tick, true);
  view.setUint32(5, entityCount, true);
  let off = 9;
  for (const v of positions) {
    view.setFloat64(off, v, true);
    off += 8;
  }
  for (const v of velocities) {
    view.setFloat64(off, v, true);
    off += 8;
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

  it('parses a single-entity snapshot', () => {
    const buf = buildSnapshot(100, 1000, 1000, [12.5, -7.25], [0.5, -0.25], [3]);
    const result = parseMessage(buf);
    if (result === null || result.type !== MessageType.SNAPSHOT) throw new Error('expected snapshot');
    expect(result.tick).toBe(100);
    expect(result.entityCount).toBe(1);
    expect(Array.from(result.positions)).toEqual([12.5, -7.25]);
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
    const buf = new ArrayBuffer(25);
    const view = new DataView(buf);
    view.setUint8(0, 0x01);
    view.setUint32(1, 1, true);
    view.setFloat64(5, 100, true);
    view.setFloat64(13, 100, true);
    view.setUint32(21, 9_999_999, true);
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

describe('parseStateUpdate', () => {
  it('parses a state update', () => {
    const buf = buildStateUpdate(99, [10, 20, 30, 40], [1, 2, 3, 4]);
    const result = parseMessage(buf);
    if (result === null || result.type !== MessageType.STATE_UPDATE) throw new Error('expected update');
    expect(result.tick).toBe(99);
    expect(result.entityCount).toBe(2);
    expect(Array.from(result.positions)).toEqual([10, 20, 30, 40]);
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
