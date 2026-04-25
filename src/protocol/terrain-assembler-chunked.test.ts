import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createTerrainAssembler } from './terrain-assembler';
import {
  buildSingleShotTerrain,
  buildTerrainChunk,
  buildTerrainHeader,
  encodeRawDtype,
  FRAME_2X2_F32_ZSTD,
  FRAME_3X3_F32_LZ4,
  FRAME_3X3_F32_ZSTD,
  FRAME_3X3_F64_LZ4,
  FRAME_3X3_F64_ZSTD,
  FRAME_3X3_U16_LZ4,
  FRAME_3X3_U16_ZSTD,
  FRAME_CHUNK1_F32_ZSTD,
  PLAINTEXT_3X3_F32,
  PLAINTEXT_3X3_F64,
  PLAINTEXT_3X3_U16,
  U16_3X3_ELEVATION_MAX,
  U16_3X3_ELEVATION_MIN,
} from './_test-helpers';
import { MessageType, TerrainCompression, type TerrainCompressionValue, TerrainDtype, type TerrainDtypeValue } from './types';

function buildStateUpdate(tick: number, positions: number[], velocities: number[]): ArrayBuffer {
  const entityCount = positions.length / 2;
  const buf = new ArrayBuffer(9 + entityCount * 32);
  const view = new DataView(buf);
  view.setUint8(0, MessageType.STATE_UPDATE);
  view.setUint32(1, tick, true);
  view.setUint32(5, entityCount, true);
  let off = 9;
  for (const v of positions) { view.setFloat64(off, v, true); off += 8; }
  for (const v of velocities) { view.setFloat64(off, v, true); off += 8; }
  return buf;
}

describe('terrain-assembler chunked path (T9/T10)', () => {
  beforeEachSilenceInfo();

  it('decodes the spec chunked worked example exactly (header + chunk0 + chunk1)', () => {
    const a = createTerrainAssembler();
    const header = buildTerrainHeader({
      rows: 4, cols: 2, resolution: 10, originX: 0, originY: 0,
      dtype: TerrainDtype.F32, compression: TerrainCompression.ZSTD, chunkCount: 2,
    });
    const chunk0 = buildTerrainChunk({
      sequenceNumber: 0, rowOffset: 0, colOffset: 0, chunkRows: 2, chunkCols: 2,
      isLast: false, compressedPayload: FRAME_2X2_F32_ZSTD,
    });
    const chunk1 = buildTerrainChunk({
      sequenceNumber: 1, rowOffset: 2, colOffset: 0, chunkRows: 2, chunkCols: 2,
      isLast: true, compressedPayload: FRAME_CHUNK1_F32_ZSTD,
    });

    expect(a.feed(header).kind).toBe('pending');
    expect(a.feed(chunk0).kind).toBe('pending');
    const out = a.feed(chunk1);
    expect(out.kind).toBe('message');
    if (out.kind !== 'message' || out.message.type !== MessageType.TERRAIN) return;
    expect(out.message.rows).toBe(4);
    expect(out.message.cols).toBe(2);
    const expected = [0, 1, 2, 3, 4, 5, 6, 7];
    for (let i = 0; i < 8; i++) {
      expect(out.message.elevation[i]).toBeCloseTo(expected[i], 6);
    }
  });

  it('reassembles correctly when chunks arrive in reverse order', () => {
    const a = createTerrainAssembler();
    const header = buildTerrainHeader({
      rows: 4, cols: 2, resolution: 10, originX: 0, originY: 0,
      dtype: TerrainDtype.F32, compression: TerrainCompression.ZSTD, chunkCount: 2,
    });
    const chunk0 = buildTerrainChunk({
      sequenceNumber: 0, rowOffset: 0, colOffset: 0, chunkRows: 2, chunkCols: 2,
      isLast: false, compressedPayload: FRAME_2X2_F32_ZSTD,
    });
    const chunk1 = buildTerrainChunk({
      sequenceNumber: 1, rowOffset: 2, colOffset: 0, chunkRows: 2, chunkCols: 2,
      isLast: true, compressedPayload: FRAME_CHUNK1_F32_ZSTD,
    });
    expect(a.feed(header).kind).toBe('pending');
    // chunk1 first (with isLast). Note: the spec says "feeding the chunks in
    // either arrival order" works; isLast only triggers finalization. Since
    // chunk1 is the only one marked last, we feed chunk0 last in this variant
    // — but chunk0 has isLast=false, so we need to mark *the actually-last-
    // arriving chunk* as last. Re-build with swapped flags for the reverse
    // variant:
    const chunk1ReversedFlag = buildTerrainChunk({
      sequenceNumber: 1, rowOffset: 2, colOffset: 0, chunkRows: 2, chunkCols: 2,
      isLast: false, compressedPayload: FRAME_CHUNK1_F32_ZSTD,
    });
    const chunk0ReversedFlag = buildTerrainChunk({
      sequenceNumber: 0, rowOffset: 0, colOffset: 0, chunkRows: 2, chunkCols: 2,
      isLast: true, compressedPayload: FRAME_2X2_F32_ZSTD,
    });
    void chunk0; void chunk1; // keep references for clarity but use the flag-swapped variants
    expect(a.feed(chunk1ReversedFlag).kind).toBe('pending');
    const out = a.feed(chunk0ReversedFlag);
    expect(out.kind).toBe('message');
    if (out.kind !== 'message' || out.message.type !== MessageType.TERRAIN) return;
    const expected = [0, 1, 2, 3, 4, 5, 6, 7];
    for (let i = 0; i < 8; i++) {
      expect(out.message.elevation[i]).toBeCloseTo(expected[i], 6);
    }
  });

  it('reassembles a 6×6 grid from four 3×3 quadrant chunks (none compression)', () => {
    const a = createTerrainAssembler();
    const rows = 6, cols = 6;
    const grid: number[] = [];
    for (let i = 0; i < rows * cols; i++) grid.push(i);
    const dtype = TerrainDtype.F64;
    a.feed(buildTerrainHeader({
      rows, cols, resolution: 1, originX: 0, originY: 0,
      dtype, compression: TerrainCompression.NONE, chunkCount: 4,
    }));
    const quadrants = [
      { rowOffset: 0, colOffset: 0 },
      { rowOffset: 0, colOffset: 3 },
      { rowOffset: 3, colOffset: 0 },
      { rowOffset: 3, colOffset: 3 },
    ];
    for (let q = 0; q < quadrants.length; q++) {
      const { rowOffset, colOffset } = quadrants[q];
      const cells: number[] = [];
      for (let r = 0; r < 3; r++) {
        for (let c = 0; c < 3; c++) {
          cells.push(grid[(rowOffset + r) * cols + (colOffset + c)]);
        }
      }
      const out = a.feed(buildTerrainChunk({
        sequenceNumber: q, rowOffset, colOffset, chunkRows: 3, chunkCols: 3,
        isLast: q === quadrants.length - 1,
        compressedPayload: encodeRawDtype(cells, dtype),
      }));
      if (q < quadrants.length - 1) expect(out.kind).toBe('pending');
      else {
        expect(out.kind).toBe('message');
        if (out.kind !== 'message' || out.message.type !== MessageType.TERRAIN) return;
        for (let i = 0; i < rows * cols; i++) {
          expect(out.message.elevation[i]).toBe(grid[i]);
        }
      }
    }
  });

  it('reassembles correctly when 4 quadrant chunks arrive in reverse seq order', () => {
    const a = createTerrainAssembler();
    const rows = 6, cols = 6;
    const grid: number[] = [];
    for (let i = 0; i < rows * cols; i++) grid.push(i);
    const dtype = TerrainDtype.F64;
    a.feed(buildTerrainHeader({
      rows, cols, resolution: 1, originX: 0, originY: 0,
      dtype, compression: TerrainCompression.NONE, chunkCount: 4,
    }));
    const quadrants = [
      { seq: 0, rowOffset: 0, colOffset: 0 },
      { seq: 1, rowOffset: 0, colOffset: 3 },
      { seq: 2, rowOffset: 3, colOffset: 0 },
      { seq: 3, rowOffset: 3, colOffset: 3 },
    ];
    // Feed in reverse seq order; mark the LAST-fed chunk as isLast.
    const arrivalOrder = [...quadrants].reverse();
    for (let i = 0; i < arrivalOrder.length; i++) {
      const q = arrivalOrder[i];
      const cells: number[] = [];
      for (let r = 0; r < 3; r++) {
        for (let c = 0; c < 3; c++) {
          cells.push(grid[(q.rowOffset + r) * cols + (q.colOffset + c)]);
        }
      }
      const out = a.feed(buildTerrainChunk({
        sequenceNumber: q.seq, rowOffset: q.rowOffset, colOffset: q.colOffset,
        chunkRows: 3, chunkCols: 3, isLast: i === arrivalOrder.length - 1,
        compressedPayload: encodeRawDtype(cells, dtype),
      }));
      if (i < arrivalOrder.length - 1) expect(out.kind).toBe('pending');
      else {
        expect(out.kind).toBe('message');
        if (out.kind !== 'message' || out.message.type !== MessageType.TERRAIN) return;
        for (let k = 0; k < rows * cols; k++) {
          expect(out.message.elevation[k]).toBe(grid[k]);
        }
      }
    }
  });

  it('reassembles a non-uniform 8×12 partition (three 8×4 vertical strips, none)', () => {
    const a = createTerrainAssembler();
    const rows = 8, cols = 12;
    const grid: number[] = [];
    for (let i = 0; i < rows * cols; i++) grid.push(i);
    const dtype = TerrainDtype.F32;
    a.feed(buildTerrainHeader({
      rows, cols, resolution: 1, originX: 0, originY: 0,
      dtype, compression: TerrainCompression.NONE, chunkCount: 3,
    }));
    const strips = [
      { seq: 0, rowOffset: 0, colOffset: 0,  chunkRows: 8, chunkCols: 4 },
      { seq: 1, rowOffset: 0, colOffset: 4,  chunkRows: 8, chunkCols: 4 },
      { seq: 2, rowOffset: 0, colOffset: 8,  chunkRows: 8, chunkCols: 4 },
    ];
    for (let i = 0; i < strips.length; i++) {
      const s = strips[i];
      const cells: number[] = [];
      for (let r = 0; r < s.chunkRows; r++) {
        for (let c = 0; c < s.chunkCols; c++) {
          cells.push(grid[(s.rowOffset + r) * cols + (s.colOffset + c)]);
        }
      }
      const out = a.feed(buildTerrainChunk({
        sequenceNumber: s.seq, rowOffset: s.rowOffset, colOffset: s.colOffset,
        chunkRows: s.chunkRows, chunkCols: s.chunkCols,
        isLast: i === strips.length - 1,
        compressedPayload: encodeRawDtype(cells, dtype),
      }));
      if (i < strips.length - 1) expect(out.kind).toBe('pending');
      else {
        expect(out.kind).toBe('message');
        if (out.kind !== 'message' || out.message.type !== MessageType.TERRAIN) return;
        for (let k = 0; k < rows * cols; k++) {
          expect(out.message.elevation[k]).toBeCloseTo(grid[k], 5);
        }
      }
    }
  });

  // For each of the 9 dtype × compression combos, send a TERRAIN_HEADER with
  // chunkCount=1 followed by a single TERRAIN_CHUNK that covers the entire 3×3
  // grid. This re-uses the single-shot 3×3 fixtures since the chunk payload
  // format is identical (compressed bytes of the dtype-cast cells).
  type Combo = {
    label: string;
    dtype: TerrainDtypeValue;
    compression: TerrainCompressionValue;
    payload: Uint8Array;
  };
  const COMBOS_3X3: Combo[] = [
    { label: 'f32 none', dtype: TerrainDtype.F32, compression: TerrainCompression.NONE, payload: PLAINTEXT_3X3_F32 },
    { label: 'f32 zstd', dtype: TerrainDtype.F32, compression: TerrainCompression.ZSTD, payload: FRAME_3X3_F32_ZSTD },
    { label: 'f32 lz4',  dtype: TerrainDtype.F32, compression: TerrainCompression.LZ4,  payload: FRAME_3X3_F32_LZ4 },
    { label: 'f64 none', dtype: TerrainDtype.F64, compression: TerrainCompression.NONE, payload: PLAINTEXT_3X3_F64 },
    { label: 'f64 zstd', dtype: TerrainDtype.F64, compression: TerrainCompression.ZSTD, payload: FRAME_3X3_F64_ZSTD },
    { label: 'f64 lz4',  dtype: TerrainDtype.F64, compression: TerrainCompression.LZ4,  payload: FRAME_3X3_F64_LZ4 },
    { label: 'u16 none', dtype: TerrainDtype.UINT16, compression: TerrainCompression.NONE, payload: PLAINTEXT_3X3_U16 },
    { label: 'u16 zstd', dtype: TerrainDtype.UINT16, compression: TerrainCompression.ZSTD, payload: FRAME_3X3_U16_ZSTD },
    { label: 'u16 lz4',  dtype: TerrainDtype.UINT16, compression: TerrainCompression.LZ4,  payload: FRAME_3X3_U16_LZ4 },
  ];
  for (const combo of COMBOS_3X3) {
    it(`chunked: round-trips a 3×3 grid via 1 chunk with ${combo.label}`, () => {
      const a = createTerrainAssembler();
      const isU16 = combo.dtype === TerrainDtype.UINT16;
      a.feed(buildTerrainHeader({
        rows: 3, cols: 3, resolution: 1, originX: 0, originY: 0,
        dtype: combo.dtype, compression: combo.compression, chunkCount: 1,
        elevationMin: isU16 ? U16_3X3_ELEVATION_MIN : undefined,
        elevationMax: isU16 ? U16_3X3_ELEVATION_MAX : undefined,
      }));
      const out = a.feed(buildTerrainChunk({
        sequenceNumber: 0, rowOffset: 0, colOffset: 0, chunkRows: 3, chunkCols: 3,
        isLast: true, compressedPayload: combo.payload,
      }));
      expect(out.kind).toBe('message');
      if (out.kind !== 'message' || out.message.type !== MessageType.TERRAIN) return;
      const tolerance = isU16 ? 8 / 65535 + 1e-9 : 1e-6;
      for (let i = 0; i < 9; i++) {
        expect(Math.abs(out.message.elevation[i] - i)).toBeLessThanOrEqual(tolerance);
      }
    });
  }

  it('protocol-error when expectedChunks declared 4 but final chunk is the third', () => {
    const a = createTerrainAssembler();
    const dtype = TerrainDtype.F32;
    a.feed(buildTerrainHeader({
      rows: 4, cols: 4, resolution: 1, originX: 0, originY: 0,
      dtype, compression: TerrainCompression.NONE, chunkCount: 4,
    }));
    // Send 3 chunks marking the 3rd as last (count mismatch).
    const partition = [
      { seq: 0, rowOffset: 0, colOffset: 0, chunkRows: 2, chunkCols: 2 },
      { seq: 1, rowOffset: 0, colOffset: 2, chunkRows: 2, chunkCols: 2 },
      { seq: 2, rowOffset: 2, colOffset: 0, chunkRows: 2, chunkCols: 2 },
    ];
    let last: ReturnType<typeof a.feed> | undefined;
    for (let i = 0; i < partition.length; i++) {
      const p = partition[i];
      last = a.feed(buildTerrainChunk({
        sequenceNumber: p.seq, rowOffset: p.rowOffset, colOffset: p.colOffset,
        chunkRows: p.chunkRows, chunkCols: p.chunkCols,
        isLast: i === partition.length - 1,
        compressedPayload: encodeRawDtype([0, 0, 0, 0], dtype),
      }));
    }
    expect(last?.kind).toBe('protocol-error');
  });

  it('protocol-error when two non-duplicate chunks claim overlapping cells', () => {
    const a = createTerrainAssembler();
    const dtype = TerrainDtype.F32;
    a.feed(buildTerrainHeader({
      rows: 4, cols: 4, resolution: 1, originX: 0, originY: 0,
      dtype, compression: TerrainCompression.NONE, chunkCount: 2,
    }));
    a.feed(buildTerrainChunk({
      sequenceNumber: 0, rowOffset: 0, colOffset: 0, chunkRows: 2, chunkCols: 2,
      isLast: false, compressedPayload: encodeRawDtype([0, 0, 0, 0], dtype),
    }));
    // Different seq, identical region → overlap.
    const out = a.feed(buildTerrainChunk({
      sequenceNumber: 1, rowOffset: 0, colOffset: 0, chunkRows: 2, chunkCols: 2,
      isLast: true, compressedPayload: encodeRawDtype([0, 0, 0, 0], dtype),
    }));
    expect(out.kind).toBe('protocol-error');
    if (out.kind !== 'protocol-error') return;
    expect(out.reason).toMatch(/overlap/);
  });

  it('benign retransmit: duplicate seq with identical coords logs warning and continues', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const a = createTerrainAssembler();
    const dtype = TerrainDtype.F32;
    a.feed(buildTerrainHeader({
      rows: 2, cols: 2, resolution: 1, originX: 0, originY: 0,
      dtype, compression: TerrainCompression.NONE, chunkCount: 1,
    }));
    a.feed(buildTerrainChunk({
      sequenceNumber: 7, rowOffset: 0, colOffset: 0, chunkRows: 2, chunkCols: 2,
      isLast: false, compressedPayload: encodeRawDtype([0, 1, 2, 3], dtype),
    }));
    const out = a.feed(buildTerrainChunk({
      sequenceNumber: 7, rowOffset: 0, colOffset: 0, chunkRows: 2, chunkCols: 2,
      isLast: true, compressedPayload: encodeRawDtype([0, 1, 2, 3], dtype),
    }));
    expect(out.kind).toBe('message');
    if (out.kind !== 'message' || out.message.type !== MessageType.TERRAIN) return;
    for (let i = 0; i < 4; i++) {
      expect(out.message.elevation[i]).toBeCloseTo(i, 6);
    }
    expect(warnSpy).toHaveBeenCalledWith(expect.stringMatching(/duplicate chunk seq=7/));
  });

  it('protocol-error: duplicate seq with different coordinates', () => {
    const a = createTerrainAssembler();
    const dtype = TerrainDtype.F32;
    a.feed(buildTerrainHeader({
      rows: 4, cols: 4, resolution: 1, originX: 0, originY: 0,
      dtype, compression: TerrainCompression.NONE, chunkCount: 2,
    }));
    a.feed(buildTerrainChunk({
      sequenceNumber: 5, rowOffset: 0, colOffset: 0, chunkRows: 2, chunkCols: 2,
      isLast: false, compressedPayload: encodeRawDtype([0, 0, 0, 0], dtype),
    }));
    const out = a.feed(buildTerrainChunk({
      sequenceNumber: 5, rowOffset: 2, colOffset: 2, chunkRows: 2, chunkCols: 2,
      isLast: true, compressedPayload: encodeRawDtype([0, 0, 0, 0], dtype),
    }));
    expect(out.kind).toBe('protocol-error');
    if (out.kind !== 'protocol-error') return;
    expect(out.reason).toMatch(/duplicate sequence_number .* different coordinates/);
  });

  it('protocol-error: TERRAIN_HEADER received mid-chunked transfer', () => {
    const a = createTerrainAssembler();
    const dtype = TerrainDtype.F32;
    a.feed(buildTerrainHeader({
      rows: 4, cols: 4, resolution: 1, originX: 0, originY: 0,
      dtype, compression: TerrainCompression.NONE, chunkCount: 2,
    }));
    a.feed(buildTerrainChunk({
      sequenceNumber: 0, rowOffset: 0, colOffset: 0, chunkRows: 2, chunkCols: 2,
      isLast: false, compressedPayload: encodeRawDtype([0, 0, 0, 0], dtype),
    }));
    const out = a.feed(buildTerrainHeader({
      rows: 4, cols: 4, resolution: 1, originX: 0, originY: 0,
      dtype, compression: TerrainCompression.NONE, chunkCount: 2,
    }));
    expect(out.kind).toBe('protocol-error');
    if (out.kind !== 'protocol-error') return;
    expect(out.reason).toMatch(/TERRAIN_HEADER received mid-chunked/);
  });

  it('protocol-error: TERRAIN_CHUNK without preceding TERRAIN_HEADER', () => {
    const a = createTerrainAssembler();
    const out = a.feed(buildTerrainChunk({
      sequenceNumber: 0, rowOffset: 0, colOffset: 0, chunkRows: 1, chunkCols: 1,
      isLast: true, compressedPayload: encodeRawDtype([0], TerrainDtype.F32),
    }));
    expect(out.kind).toBe('protocol-error');
    if (out.kind !== 'protocol-error') return;
    expect(out.reason).toMatch(/without preceding TERRAIN_HEADER/);
  });

  it('protocol-error: TERRAIN single-shot received mid-chunked transfer', () => {
    const a = createTerrainAssembler();
    a.feed(buildTerrainHeader({
      rows: 4, cols: 4, resolution: 1, originX: 0, originY: 0,
      dtype: TerrainDtype.F32, compression: TerrainCompression.NONE, chunkCount: 2,
    }));
    const singleShot = buildSingleShotTerrain({
      rows: 1, cols: 1, resolution: 1, originX: 0, originY: 0,
      dtype: TerrainDtype.F32, compression: TerrainCompression.NONE,
      compressedPayload: encodeRawDtype([0], TerrainDtype.F32),
    });
    const out = a.feed(singleShot);
    expect(out.kind).toBe('protocol-error');
    if (out.kind !== 'protocol-error') return;
    expect(out.reason).toMatch(/TERRAIN single-shot received mid-chunked/);
  });

  it('protocol-error: chunk bounds exceed declared header dimensions', () => {
    const a = createTerrainAssembler();
    const dtype = TerrainDtype.F32;
    a.feed(buildTerrainHeader({
      rows: 4, cols: 4, resolution: 1, originX: 0, originY: 0,
      dtype, compression: TerrainCompression.NONE, chunkCount: 1,
    }));
    const out = a.feed(buildTerrainChunk({
      sequenceNumber: 0, rowOffset: 3, colOffset: 0, chunkRows: 2, chunkCols: 4,
      // rowOffset=3 + chunkRows=2 = 5 > rows=4 → bounds error.
      isLast: true, compressedPayload: encodeRawDtype(new Array(8).fill(0), dtype),
    }));
    expect(out.kind).toBe('protocol-error');
    if (out.kind !== 'protocol-error') return;
    expect(out.reason).toMatch(/bounds out of range/);
  });

  it('protocol-error: chunked TERRAIN_HEADER received after STATE_UPDATE began', () => {
    const a = createTerrainAssembler();
    a.feed(buildStateUpdate(1, [1, 2], [0, 0]));
    const out = a.feed(buildTerrainHeader({
      rows: 4, cols: 4, resolution: 1, originX: 0, originY: 0,
      dtype: TerrainDtype.F32, compression: TerrainCompression.NONE, chunkCount: 1,
    }));
    expect(out.kind).toBe('protocol-error');
    if (out.kind !== 'protocol-error') return;
    expect(out.reason).toMatch(/TERRAIN_HEADER received after STATE_UPDATE/);
  });
});

function beforeEachSilenceInfo(): void {
  // The decoder logs an INFO line per assembled terrain. Mute it for tests
  // so vitest output stays focused on assertions.
  beforeEach(() => {
    vi.spyOn(console, 'info').mockImplementation(() => undefined);
  });
}
