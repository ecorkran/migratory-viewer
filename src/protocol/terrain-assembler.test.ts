import { describe, expect, it, vi } from 'vitest';
import { createTerrainAssembler } from './terrain-assembler';
import {
  buildSingleShotTerrain,
  buildSpecWorkedExample2x2,
  FRAME_2X2_F32_LZ4,
  FRAME_3X3_F32_LZ4,
  FRAME_3X3_F32_ZSTD,
  FRAME_3X3_F64_LZ4,
  FRAME_3X3_F64_ZSTD,
  FRAME_3X3_U16_LZ4,
  FRAME_3X3_U16_ZSTD,
  PLAINTEXT_2X2_F32,
  PLAINTEXT_3X3_F32,
  PLAINTEXT_3X3_F64,
  PLAINTEXT_3X3_U16,
  U16_3X3_ELEVATION_MAX,
  U16_3X3_ELEVATION_MIN,
} from './_test-helpers';
import { MessageType, TerrainCompression, type TerrainCompressionValue, TerrainDtype, type TerrainDtypeValue } from './types';

import { PositionDtype } from './types';

function buildSnapshot(
  tick: number,
  worldWidth: number,
  worldHeight: number,
  positions: number[],
  velocities: number[],
  profileIndices: number[],
): ArrayBuffer {
  const entityCount = profileIndices.length;
  // 26-byte header + f64 payload (36 bytes/entity: 32 pos+vel + 4 profile idx)
  const totalBytes = 26 + entityCount * 36;
  const buf = new ArrayBuffer(totalBytes);
  const view = new DataView(buf);
  view.setUint8(0, MessageType.SNAPSHOT);
  view.setUint32(1, tick, true);
  view.setFloat64(5, worldWidth, true);
  view.setFloat64(13, worldHeight, true);
  view.setUint32(21, entityCount, true);
  view.setUint8(25, PositionDtype.F64);
  let off = 26;
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
  // 10-byte header + f64 payload (32 bytes/entity)
  const totalBytes = 10 + entityCount * 32;
  const buf = new ArrayBuffer(totalBytes);
  const view = new DataView(buf);
  view.setUint8(0, MessageType.STATE_UPDATE);
  view.setUint32(1, tick, true);
  view.setUint32(5, entityCount, true);
  view.setUint8(9, PositionDtype.F64);
  let off = 10;
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

describe('terrain-assembler single-shot v2 (T7/T8)', () => {
  it('decodes the spec 2×2 f32+zstd worked example exactly', () => {
    vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const out = createTerrainAssembler().feed(buildSpecWorkedExample2x2());
    expect(out.kind).toBe('message');
    if (out.kind !== 'message') return;
    expect(out.message.type).toBe(MessageType.TERRAIN);
    if (out.message.type !== MessageType.TERRAIN) return;
    expect(out.message.rows).toBe(2);
    expect(out.message.cols).toBe(2);
    expect(out.message.resolution).toBe(10);
    expect(out.message.originX).toBe(0);
    expect(out.message.originY).toBe(0);
    const expected = [0, 1, 2, 3];
    expect(out.message.elevation.length).toBe(4);
    for (let i = 0; i < 4; i++) {
      expect(out.message.elevation[i]).toBeCloseTo(expected[i], 6);
    }
  });

  type Combo = {
    label: string;
    dtype: TerrainDtypeValue;
    compression: TerrainCompressionValue;
    payload: Uint8Array;
  };
  const COMBOS_3X3: Combo[] = [
    { label: 'f32 none',  dtype: TerrainDtype.F32,    compression: TerrainCompression.NONE, payload: PLAINTEXT_3X3_F32 },
    { label: 'f32 zstd',  dtype: TerrainDtype.F32,    compression: TerrainCompression.ZSTD, payload: FRAME_3X3_F32_ZSTD },
    { label: 'f32 lz4',   dtype: TerrainDtype.F32,    compression: TerrainCompression.LZ4,  payload: FRAME_3X3_F32_LZ4 },
    { label: 'f64 none',  dtype: TerrainDtype.F64,    compression: TerrainCompression.NONE, payload: PLAINTEXT_3X3_F64 },
    { label: 'f64 zstd',  dtype: TerrainDtype.F64,    compression: TerrainCompression.ZSTD, payload: FRAME_3X3_F64_ZSTD },
    { label: 'f64 lz4',   dtype: TerrainDtype.F64,    compression: TerrainCompression.LZ4,  payload: FRAME_3X3_F64_LZ4 },
    { label: 'u16 none',  dtype: TerrainDtype.UINT16, compression: TerrainCompression.NONE, payload: PLAINTEXT_3X3_U16 },
    { label: 'u16 zstd',  dtype: TerrainDtype.UINT16, compression: TerrainCompression.ZSTD, payload: FRAME_3X3_U16_ZSTD },
    { label: 'u16 lz4',   dtype: TerrainDtype.UINT16, compression: TerrainCompression.LZ4,  payload: FRAME_3X3_U16_LZ4 },
  ];

  for (const combo of COMBOS_3X3) {
    it(`round-trips a 3×3 grid with ${combo.label}`, () => {
      vi.spyOn(console, 'info').mockImplementation(() => undefined);
      const isU16 = combo.dtype === TerrainDtype.UINT16;
      const buf = buildSingleShotTerrain({
        rows: 3, cols: 3, resolution: 1, originX: 0, originY: 0,
        dtype: combo.dtype, compression: combo.compression,
        compressedPayload: combo.payload,
        elevationMin: isU16 ? U16_3X3_ELEVATION_MIN : undefined,
        elevationMax: isU16 ? U16_3X3_ELEVATION_MAX : undefined,
      });
      const out = createTerrainAssembler().feed(buf);
      expect(out.kind).toBe('message');
      if (out.kind !== 'message') return;
      if (out.message.type !== MessageType.TERRAIN) return;
      expect(out.message.elevation.length).toBe(9);
      for (let i = 0; i < 9; i++) {
        // For uint16 the dequant tolerance is (max-min)/65535 = 8/65535 ≈ 1.22e-4
        // For f32 the worst-case rounding for these integers is 0; we use a
        // single tolerance permissive enough for all three dtypes.
        const tolerance = isU16 ? 8 / 65535 + 1e-9 : 1e-6;
        expect(Math.abs(out.message.elevation[i] - i)).toBeLessThanOrEqual(tolerance);
      }
    });
  }

  it('rejects a frame with reserved flag bits set (close 1002)', () => {
    // dtype f32 + compression none → flags 0b00000000; set bit 5 → 0b00100000.
    const buf = buildSingleShotTerrain({
      rows: 1, cols: 1, resolution: 1, originX: 0, originY: 0,
      dtype: TerrainDtype.F32, compression: TerrainCompression.NONE,
      compressedPayload: Uint8Array.of(0, 0, 0, 0),
    });
    new DataView(buf).setUint8(33, 0b00100000);
    const out = createTerrainAssembler().feed(buf);
    expect(out.kind).toBe('protocol-error');
    if (out.kind !== 'protocol-error') return;
    expect(out.reason).toMatch(/reserved flag bits/);
  });

  it('rejects a frame with unknown dtype (bits 0-1 = 3)', () => {
    const buf = buildSingleShotTerrain({
      rows: 1, cols: 1, resolution: 1, originX: 0, originY: 0,
      dtype: TerrainDtype.F32, compression: TerrainCompression.NONE,
      compressedPayload: Uint8Array.of(0, 0, 0, 0),
    });
    // Force flags byte to dtype=3, compression=0.
    new DataView(buf).setUint8(33, 0b00000011);
    const out = createTerrainAssembler().feed(buf);
    expect(out.kind).toBe('protocol-error');
    if (out.kind !== 'protocol-error') return;
    expect(out.reason).toMatch(/unknown dtype/);
  });

  it('rejects a frame with unknown compression (bits 2-4 = 3)', () => {
    const buf = buildSingleShotTerrain({
      rows: 1, cols: 1, resolution: 1, originX: 0, originY: 0,
      dtype: TerrainDtype.F32, compression: TerrainCompression.NONE,
      compressedPayload: Uint8Array.of(0, 0, 0, 0),
    });
    // dtype=0, compression=3 → flags = (3 << 2) = 0b00001100.
    new DataView(buf).setUint8(33, 0b00001100);
    const out = createTerrainAssembler().feed(buf);
    expect(out.kind).toBe('protocol-error');
    if (out.kind !== 'protocol-error') return;
    expect(out.reason).toMatch(/unknown compression/);
  });

  it('uint16 dequant produces values within (max-min)/65535 tolerance', () => {
    // 4×4 grid with elevations 0,10,20,...,150 quantized over [0, 150].
    vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const elevations: number[] = [];
    for (let i = 0; i < 16; i++) elevations.push(i * 10);
    const min = 0;
    const max = 150;
    const plaintext = new Uint8Array(16 * 2);
    const view = new DataView(plaintext.buffer);
    for (let i = 0; i < 16; i++) {
      const u = Math.round(((elevations[i] - min) / (max - min)) * 65535);
      view.setUint16(i * 2, u, true);
    }
    const buf = buildSingleShotTerrain({
      rows: 4, cols: 4, resolution: 1, originX: 0, originY: 0,
      dtype: TerrainDtype.UINT16, compression: TerrainCompression.NONE,
      compressedPayload: plaintext,
      elevationMin: min, elevationMax: max,
    });
    const out = createTerrainAssembler().feed(buf);
    expect(out.kind).toBe('message');
    if (out.kind !== 'message') return;
    if (out.message.type !== MessageType.TERRAIN) return;
    const tolerance = (max - min) / 65535 + 1e-9;
    for (let i = 0; i < 16; i++) {
      expect(Math.abs(out.message.elevation[i] - elevations[i])).toBeLessThanOrEqual(tolerance);
    }
  });

  it('uint16 with elevation_min == elevation_max produces all-min values, no NaN', () => {
    vi.spyOn(console, 'info').mockImplementation(() => undefined);
    // Plaintext: 4 cells, any u16 values — they all collapse to min.
    const plaintext = Uint8Array.of(0xff, 0xff, 0x00, 0x00, 0x80, 0x40, 0x12, 0x34);
    const buf = buildSingleShotTerrain({
      rows: 2, cols: 2, resolution: 1, originX: 0, originY: 0,
      dtype: TerrainDtype.UINT16, compression: TerrainCompression.NONE,
      compressedPayload: plaintext,
      elevationMin: 42, elevationMax: 42,
    });
    const out = createTerrainAssembler().feed(buf);
    expect(out.kind).toBe('message');
    if (out.kind !== 'message') return;
    if (out.message.type !== MessageType.TERRAIN) return;
    for (let i = 0; i < 4; i++) {
      expect(out.message.elevation[i]).toBe(42);
      expect(Number.isNaN(out.message.elevation[i])).toBe(false);
    }
  });

  it('rejects TERRAIN received after a STATE_UPDATE has begun', () => {
    const a = createTerrainAssembler();
    a.feed(buildStateUpdate(1, [1, 2], [0, 0]));
    const out = a.feed(buildSpecWorkedExample2x2());
    expect(out.kind).toBe('protocol-error');
    if (out.kind !== 'protocol-error') return;
    expect(out.reason).toMatch(/TERRAIN received after STATE_UPDATE/);
  });

  it('rejects a single-shot frame whose declared payload length is short', () => {
    // dtype=F64, compression=NONE, declared 2×2 → expect 32 bytes of payload,
    // but supply only 31 (truncated). Length mismatch surfaces as protocol-error.
    const truncatedPayload = new Uint8Array(31);
    const buf = buildSingleShotTerrain({
      rows: 2, cols: 2, resolution: 1, originX: 0, originY: 0,
      dtype: TerrainDtype.F64, compression: TerrainCompression.NONE,
      compressedPayload: truncatedPayload,
    });
    const out = createTerrainAssembler().feed(buf);
    expect(out.kind).toBe('protocol-error');
    if (out.kind !== 'protocol-error') return;
    expect(out.reason).toMatch(/length mismatch/);
  });

  it('decodes the spec worked-example via lz4 too', () => {
    // Same 2×2 [0,1,2,3] payload as the spec worked example, but lz4-framed.
    vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const buf = buildSingleShotTerrain({
      rows: 2, cols: 2, resolution: 10, originX: 0, originY: 0,
      dtype: TerrainDtype.F32, compression: TerrainCompression.LZ4,
      compressedPayload: FRAME_2X2_F32_LZ4,
    });
    const out = createTerrainAssembler().feed(buf);
    expect(out.kind).toBe('message');
    if (out.kind !== 'message') return;
    if (out.message.type !== MessageType.TERRAIN) return;
    for (let i = 0; i < 4; i++) {
      expect(out.message.elevation[i]).toBeCloseTo(i, 6);
    }
  });

  it('decodes a none-compression frame (raw bytes path)', () => {
    vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const buf = buildSingleShotTerrain({
      rows: 2, cols: 2, resolution: 10, originX: 0, originY: 0,
      dtype: TerrainDtype.F32, compression: TerrainCompression.NONE,
      compressedPayload: PLAINTEXT_2X2_F32,
    });
    const out = createTerrainAssembler().feed(buf);
    expect(out.kind).toBe('message');
    if (out.kind !== 'message') return;
    if (out.message.type !== MessageType.TERRAIN) return;
    for (let i = 0; i < 4; i++) {
      expect(out.message.elevation[i]).toBeCloseTo(i, 6);
    }
  });
});
