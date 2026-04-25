/**
 * Shared test fixtures and builders for terrain wire-protocol v2 tests.
 * Used by terrain-assembler.test.ts (single-shot) and the chunked tests in T10.
 *
 * Compressed payloads are pre-generated via the system zstd / lz4 CLIs (see
 * accompanying inline comments above each constant). fzstd is decode-only and
 * lz4js's frame compressor doesn't match the on-the-wire descriptor we expect,
 * so we cannot generate frames at test time — the constants are baked.
 */

import {
  MessageType,
  TerrainCompression,
  type TerrainCompressionValue,
  TerrainDtype,
  type TerrainDtypeValue,
} from './types';

// ---------------------------------------------------------------------------
// Pre-generated compressed frames for fixed payloads
// ---------------------------------------------------------------------------

/**
 * Spec worked-example f32 payload: 2×2 grid with elevations [0, 1, 2, 3].
 * Plaintext (16 bytes f32 LE):
 *   00 00 00 00   00 00 80 3f   00 00 00 40   00 00 40 40
 *
 * Generated via:
 *   $ zstd -f -19 elev_2x2.bin -o elev_2x2.zst
 *   $ lz4 -f --no-frame-crc elev_2x2.bin elev_2x2.lz4
 */
export const FRAME_2X2_F32_ZSTD = Uint8Array.of(
  0x28, 0xb5, 0x2f, 0xfd, 0x24, 0x10, 0x81, 0x00,
  0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x80,
  0x3f, 0x00, 0x00, 0x00, 0x40, 0x00, 0x00, 0x40,
  0x40, 0x4f, 0xc6, 0xae, 0x49,
);

export const FRAME_2X2_F32_LZ4 = Uint8Array.of(
  0x04, 0x22, 0x4d, 0x18, 0x60, 0x40, 0x82, 0x0f,
  0x00, 0x00, 0x00, 0x11, 0x00, 0x01, 0x00, 0xa0,
  0x80, 0x3f, 0x00, 0x00, 0x00, 0x40, 0x00, 0x00,
  0x40, 0x40, 0x00, 0x00, 0x00, 0x00,
);

export const PLAINTEXT_2X2_F32 = Uint8Array.of(
  0x00, 0x00, 0x00, 0x00,
  0x00, 0x00, 0x80, 0x3f,
  0x00, 0x00, 0x00, 0x40,
  0x00, 0x00, 0x40, 0x40,
);

/**
 * Spec chunked worked-example f32 payloads:
 *   chunk 0 (rows 0–1): [0, 1, 2, 3] → identical bytes to FRAME_2X2_F32_ZSTD.
 *   chunk 1 (rows 2–3): [4, 5, 6, 7].
 */
export const FRAME_CHUNK1_F32_ZSTD = Uint8Array.of(
  0x28, 0xb5, 0x2f, 0xfd, 0x24, 0x10, 0x81, 0x00,
  0x00, 0x00, 0x00, 0x80, 0x40, 0x00, 0x00, 0xa0,
  0x40, 0x00, 0x00, 0xc0, 0x40, 0x00, 0x00, 0xe0,
  0x40, 0xee, 0xa1, 0x32, 0xa1,
);

/**
 * 3×3 grid with elevations [0, 1, ..., 8] in three encodings.
 * Used for the all-9-combos round-trip test.
 *
 * Plaintexts:
 *   F32  (36 bytes): 9× f32 LE, values 0..8
 *   F64  (72 bytes): 9× f64 LE, values 0..8
 *   UINT16 (18 bytes): 9× u16 LE, quantized over [0, 8] (so u_i = round(i/8 * 65535))
 */
export const FRAME_3X3_F32_ZSTD = Uint8Array.of(
  0x28, 0xb5, 0x2f, 0xfd, 0x24, 0x24, 0xdd, 0x00,
  0x00, 0x42, 0xc2, 0x05, 0x0d, 0xe0, 0x69, 0x0c,
  0xd0, 0xa1, 0x43, 0x07, 0x50, 0x60, 0x2f, 0xa8,
  0x20, 0x05, 0xf1, 0xd5, 0xa3, 0x37, 0x4f, 0xde,
  0xde, 0x41, 0xfe, 0x00, 0xa2, 0xfa, 0x32, 0x3d,
);

export const FRAME_3X3_F32_LZ4 = Uint8Array.of(
  0x04, 0x22, 0x4d, 0x18, 0x60, 0x40, 0x82, 0x24,
  0x00, 0x00, 0x80, 0x00, 0x00, 0x00, 0x00, 0x00,
  0x00, 0x80, 0x3f, 0x00, 0x00, 0x00, 0x40, 0x00,
  0x00, 0x40, 0x40, 0x00, 0x00, 0x80, 0x40, 0x00,
  0x00, 0xa0, 0x40, 0x00, 0x00, 0xc0, 0x40, 0x00,
  0x00, 0xe0, 0x40, 0x00, 0x00, 0x00, 0x41, 0x00,
  0x00, 0x00, 0x00,
);

export const PLAINTEXT_3X3_F32 = Uint8Array.of(
  0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x80, 0x3f,
  0x00, 0x00, 0x00, 0x40, 0x00, 0x00, 0x40, 0x40,
  0x00, 0x00, 0x80, 0x40, 0x00, 0x00, 0xa0, 0x40,
  0x00, 0x00, 0xc0, 0x40, 0x00, 0x00, 0xe0, 0x40,
  0x00, 0x00, 0x00, 0x41,
);

export const FRAME_3X3_F64_ZSTD = Uint8Array.of(
  0x28, 0xb5, 0x2f, 0xfd, 0x24, 0x48, 0x35, 0x01,
  0x00, 0xc0, 0x00, 0xf0, 0x3f, 0x00, 0x00, 0x00,
  0x00, 0x00, 0x00, 0x00, 0x40, 0x00, 0x00, 0x00,
  0x00, 0x00, 0x00, 0x08, 0x10, 0x14, 0x18, 0x1c,
  0x20, 0x40, 0x06, 0x20, 0xb0, 0x0f, 0x59, 0xf2,
  0x65, 0xc6, 0x2c, 0xce, 0xf6, 0x98, 0x57, 0x36,
  0xb2, 0xa4, 0x54,
);

export const FRAME_3X3_F64_LZ4 = Uint8Array.of(
  0x04, 0x22, 0x4d, 0x18, 0x60, 0x40, 0x82, 0x28,
  0x00, 0x00, 0x00, 0x19, 0x00, 0x01, 0x00, 0x23,
  0xf0, 0x3f, 0x0f, 0x00, 0x12, 0x40, 0x08, 0x00,
  0x13, 0x08, 0x08, 0x00, 0x13, 0x10, 0x08, 0x00,
  0x13, 0x14, 0x08, 0x00, 0x13, 0x18, 0x08, 0x00,
  0xa0, 0x1c, 0x40, 0x00, 0x00, 0x00, 0x00, 0x00,
  0x00, 0x20, 0x40, 0x00, 0x00, 0x00, 0x00,
);

export const PLAINTEXT_3X3_F64 = Uint8Array.of(
  0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
  0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0xf0, 0x3f,
  0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x40,
  0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x08, 0x40,
  0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x10, 0x40,
  0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x14, 0x40,
  0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x18, 0x40,
  0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x1c, 0x40,
  0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x20, 0x40,
);

export const FRAME_3X3_U16_ZSTD = Uint8Array.of(
  0x28, 0xb5, 0x2f, 0xfd, 0x24, 0x12, 0x91, 0x00,
  0x00, 0x00, 0x00, 0x00, 0x20, 0x00, 0x40, 0x00,
  0x60, 0x00, 0x80, 0xff, 0x9f, 0xff, 0xbf, 0xff,
  0xdf, 0xff, 0xff, 0x25, 0xce, 0xe8, 0x07,
);

export const FRAME_3X3_U16_LZ4 = Uint8Array.of(
  0x04, 0x22, 0x4d, 0x18, 0x60, 0x40, 0x82, 0x12,
  0x00, 0x00, 0x80, 0x00, 0x00, 0x00, 0x20, 0x00,
  0x40, 0x00, 0x60, 0x00, 0x80, 0xff, 0x9f, 0xff,
  0xbf, 0xff, 0xdf, 0xff, 0xff, 0x00, 0x00, 0x00,
  0x00,
);

export const PLAINTEXT_3X3_U16 = Uint8Array.of(
  0x00, 0x00, 0x00, 0x20, 0x00, 0x40, 0x00, 0x60,
  0x00, 0x80, 0xff, 0x9f, 0xff, 0xbf, 0xff, 0xdf,
  0xff, 0xff,
);

// Quantization parameters used to generate the uint16 plaintext above.
export const U16_3X3_ELEVATION_MIN = 0;
export const U16_3X3_ELEVATION_MAX = 8;

// ---------------------------------------------------------------------------
// Frame builder
// ---------------------------------------------------------------------------

interface SingleShotInput {
  rows: number;
  cols: number;
  resolution: number;
  originX: number;
  originY: number;
  dtype: TerrainDtypeValue;
  compression: TerrainCompressionValue;
  /** Already-compressed payload bytes (or raw bytes when compression == NONE). */
  compressedPayload: Uint8Array;
  /** Required for UINT16; ignored otherwise. */
  elevationMin?: number;
  elevationMax?: number;
}

/**
 * Build a single-shot v2 TERRAIN (`0x03`) frame from a pre-compressed payload.
 * Tests construct payloads via the FRAME_* fixtures above (or via plaintext
 * for the NONE case), then call this helper to wrap them in a v2 header.
 */
export function buildSingleShotTerrain(input: SingleShotInput): ArrayBuffer {
  const isUint16 = input.dtype === TerrainDtype.UINT16;
  const dequantBytes = isUint16 ? 16 : 0;
  const headerBytes = 34 + dequantBytes;
  const buf = new ArrayBuffer(headerBytes + input.compressedPayload.byteLength);
  const view = new DataView(buf);
  view.setUint8(0, MessageType.TERRAIN);
  view.setUint32(1, input.rows, true);
  view.setUint32(5, input.cols, true);
  view.setFloat64(9, input.resolution, true);
  view.setFloat64(17, input.originX, true);
  view.setFloat64(25, input.originY, true);
  // flags: bits 0-1 dtype, bits 2-4 compression, bits 5-7 reserved (0).
  const flags = (input.dtype & 0b11) | ((input.compression & 0b111) << 2);
  view.setUint8(33, flags);
  if (isUint16) {
    if (input.elevationMin === undefined || input.elevationMax === undefined) {
      throw new Error('UINT16 frames require elevationMin/elevationMax');
    }
    view.setFloat64(34, input.elevationMin, true);
    view.setFloat64(42, input.elevationMax, true);
  }
  new Uint8Array(buf).set(input.compressedPayload, headerBytes);
  return buf;
}

/**
 * Convenience: build the spec's exact 2×2 f32 + zstd worked-example frame.
 * The reference doc encodes this layout byte-for-byte; the test asserts the
 * decoder matches.
 */
export function buildSpecWorkedExample2x2(): ArrayBuffer {
  return buildSingleShotTerrain({
    rows: 2,
    cols: 2,
    resolution: 10,
    originX: 0,
    originY: 0,
    dtype: TerrainDtype.F32,
    compression: TerrainCompression.ZSTD,
    compressedPayload: FRAME_2X2_F32_ZSTD,
  });
}

// ---------------------------------------------------------------------------
// Chunked frame builders
// ---------------------------------------------------------------------------

interface ChunkedHeaderInput {
  rows: number;
  cols: number;
  resolution: number;
  originX: number;
  originY: number;
  dtype: TerrainDtypeValue;
  compression: TerrainCompressionValue;
  chunkCount: number;
  /** Required for UINT16; ignored otherwise. */
  elevationMin?: number;
  elevationMax?: number;
}

/**
 * Build a TERRAIN_HEADER (`0x05`) frame. 38 bytes for non-uint16 dtypes;
 * 54 bytes (with elevation_min/max) for uint16. Layout: bytes 0–33 are
 * byte-position-identical to single-shot 0x03; bytes 34–37 hold chunk_count;
 * bytes 38–53 hold the dequant range when dtype is uint16.
 */
export function buildTerrainHeader(input: ChunkedHeaderInput): ArrayBuffer {
  const isUint16 = input.dtype === TerrainDtype.UINT16;
  const totalBytes = isUint16 ? 54 : 38;
  const buf = new ArrayBuffer(totalBytes);
  const view = new DataView(buf);
  view.setUint8(0, MessageType.TERRAIN_HEADER);
  view.setUint32(1, input.rows, true);
  view.setUint32(5, input.cols, true);
  view.setFloat64(9, input.resolution, true);
  view.setFloat64(17, input.originX, true);
  view.setFloat64(25, input.originY, true);
  const flags = (input.dtype & 0b11) | ((input.compression & 0b111) << 2);
  view.setUint8(33, flags);
  view.setUint32(34, input.chunkCount, true);
  if (isUint16) {
    if (input.elevationMin === undefined || input.elevationMax === undefined) {
      throw new Error('UINT16 chunked headers require elevationMin/elevationMax');
    }
    view.setFloat64(38, input.elevationMin, true);
    view.setFloat64(46, input.elevationMax, true);
  }
  return buf;
}

interface ChunkInput {
  sequenceNumber: number;
  rowOffset: number;
  colOffset: number;
  chunkRows: number;
  chunkCols: number;
  isLast: boolean;
  /** Already-compressed payload bytes (or raw bytes when compression == NONE). */
  compressedPayload: Uint8Array;
}

/**
 * Build a TERRAIN_CHUNK (`0x04`) frame: 22-byte header + payload.
 */
export function buildTerrainChunk(input: ChunkInput): ArrayBuffer {
  const buf = new ArrayBuffer(22 + input.compressedPayload.byteLength);
  const view = new DataView(buf);
  view.setUint8(0, MessageType.TERRAIN_CHUNK);
  view.setUint32(1, input.sequenceNumber, true);
  view.setUint32(5, input.rowOffset, true);
  view.setUint32(9, input.colOffset, true);
  view.setUint32(13, input.chunkRows, true);
  view.setUint32(17, input.chunkCols, true);
  view.setUint8(21, input.isLast ? 1 : 0);
  new Uint8Array(buf).set(input.compressedPayload, 22);
  return buf;
}

/**
 * Encode `count` Float64 values as raw bytes for the requested dtype. For
 * UINT16, quantizes against the supplied range. Returns a Uint8Array suitable
 * for direct use as compression=NONE payload — for tests that round-trip
 * through chunked frames with NONE compression.
 */
export function encodeRawDtype(
  values: readonly number[],
  dtype: TerrainDtypeValue,
  elevationMin?: number,
  elevationMax?: number,
): Uint8Array {
  if (dtype === TerrainDtype.F32) {
    const buf = new ArrayBuffer(values.length * 4);
    const view = new DataView(buf);
    for (let i = 0; i < values.length; i++) view.setFloat32(i * 4, values[i], true);
    return new Uint8Array(buf);
  }
  if (dtype === TerrainDtype.F64) {
    const buf = new ArrayBuffer(values.length * 8);
    const view = new DataView(buf);
    for (let i = 0; i < values.length; i++) view.setFloat64(i * 8, values[i], true);
    return new Uint8Array(buf);
  }
  if (elevationMin === undefined || elevationMax === undefined) {
    throw new Error('UINT16 dtype requires elevationMin/elevationMax');
  }
  const buf = new ArrayBuffer(values.length * 2);
  const view = new DataView(buf);
  const range = elevationMax - elevationMin;
  for (let i = 0; i < values.length; i++) {
    const u = range === 0 ? 0 : Math.round(((values[i] - elevationMin) / range) * 65535);
    view.setUint16(i * 2, u, true);
  }
  return new Uint8Array(buf);
}
