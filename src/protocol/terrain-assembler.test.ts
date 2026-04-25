import { describe, expect, it } from 'vitest';
import { createTerrainAssembler } from './terrain-assembler';
import { MessageType } from './types';

function buildSnapshot(
  tick: number,
  worldWidth: number,
  worldHeight: number,
  positions: number[],
  velocities: number[],
  profileIndices: number[],
): ArrayBuffer {
  const entityCount = profileIndices.length;
  const totalBytes = 25 + entityCount * 36;
  const buf = new ArrayBuffer(totalBytes);
  const view = new DataView(buf);
  view.setUint8(0, MessageType.SNAPSHOT);
  view.setUint32(1, tick, true);
  view.setFloat64(5, worldWidth, true);
  view.setFloat64(13, worldHeight, true);
  view.setUint32(21, entityCount, true);
  let off = 25;
  for (const v of positions) { view.setFloat64(off, v, true); off += 8; }
  for (const v of velocities) { view.setFloat64(off, v, true); off += 8; }
  for (const v of profileIndices) { view.setInt32(off, v, true); off += 4; }
  return buf;
}

function buildStateUpdate(
  tick: number,
  positions: number[],
  velocities: number[],
): ArrayBuffer {
  const entityCount = positions.length / 2;
  const totalBytes = 9 + entityCount * 32;
  const buf = new ArrayBuffer(totalBytes);
  const view = new DataView(buf);
  view.setUint8(0, MessageType.STATE_UPDATE);
  view.setUint32(1, tick, true);
  view.setUint32(5, entityCount, true);
  let off = 9;
  for (const v of positions) { view.setFloat64(off, v, true); off += 8; }
  for (const v of velocities) { view.setFloat64(off, v, true); off += 8; }
  return buf;
}

describe('terrain-assembler skeleton', () => {
  it('delegates a valid SNAPSHOT to parseSnapshot', () => {
    const a = createTerrainAssembler();
    const out = a.feed(buildSnapshot(7, 100, 100, [1, 2], [0, 0], [3]));
    expect(out.kind).toBe('message');
    if (out.kind !== 'message') return;
    expect(out.message.type).toBe(MessageType.SNAPSHOT);
  });

  it('delegates a valid STATE_UPDATE and records that updates have started', () => {
    const a = createTerrainAssembler();
    const first = a.feed(buildStateUpdate(1, [1, 2], [0, 0]));
    expect(first.kind).toBe('message');
    if (first.kind !== 'message') return;
    expect(first.message.type).toBe(MessageType.STATE_UPDATE);

    // Skeleton-level proxy for the stateUpdatesStarted flag: feeding TERRAIN
    // afterward should be rejected by T7. For now (skeleton), TERRAIN returns
    // the not-implemented stub — but the flag's true effect is verified in T8.
    // Here we just confirm the second STATE_UPDATE is also accepted (idempotent).
    const second = a.feed(buildStateUpdate(2, [3, 4], [0, 0]));
    expect(second.kind).toBe('message');
  });

  it('returns pending on a malformed SNAPSHOT (tier-1 drop, not protocol error)', () => {
    // Truncated SNAPSHOT: opcode byte set, but buffer is shorter than the
    // 25-byte snapshot header minimum.
    const buf = new ArrayBuffer(4);
    new DataView(buf).setUint8(0, MessageType.SNAPSHOT);
    const out = createTerrainAssembler().feed(buf);
    expect(out.kind).toBe('pending');
  });

  it('returns protocol-error on an unknown opcode', () => {
    const buf = new ArrayBuffer(4);
    new DataView(buf).setUint8(0, 0x42);
    const out = createTerrainAssembler().feed(buf);
    expect(out.kind).toBe('protocol-error');
    if (out.kind !== 'protocol-error') return;
    expect(out.reason).toMatch(/unknown opcode 0x42/);
  });

  it('two assemblers from createTerrainAssembler() are independent', () => {
    const a = createTerrainAssembler();
    const b = createTerrainAssembler();
    a.feed(buildStateUpdate(1, [1, 2], [0, 0]));
    // b should still see a fresh state machine; the only observable
    // skeleton-state difference would be future TERRAIN reception, which T7
    // tests cover. Here we just confirm both assemblers respond
    // independently to the same input without throwing or sharing state.
    const outA = a.feed(buildSnapshot(2, 100, 100, [], [], []));
    const outB = b.feed(buildSnapshot(2, 100, 100, [], [], []));
    expect(outA.kind).toBe('message');
    expect(outB.kind).toBe('message');
  });
});
