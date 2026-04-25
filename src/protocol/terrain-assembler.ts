/**
 * Per-connection terrain wire-protocol v2 assembler.
 *
 * Owns the SNAPSHOT / STATE_UPDATE / TERRAIN / TERRAIN_HEADER / TERRAIN_CHUNK
 * dispatch and the IDLE ↔ EXPECTING_CHUNKS state machine. One assembler is
 * created per WebSocket connection in net/connection.ts; reconnect creates a
 * fresh one, so partial chunked state never leaks across connections.
 *
 * Output is a discriminated union: `message` (deliver to renderer), `pending`
 * (mid-chunked transfer or tier-1 stateless drop), or `protocol-error` (caller
 * closes the WebSocket with code 1002 — tier-2 policy per slice 112).
 *
 * Byte layouts authoritative source: project-documents/reference/terrain-wire-protocol-v2.md
 */

import config from '../config';
import { decompress } from './decompress';
import { parseSnapshot, parseStateUpdate } from './deserialize';
import {
  MessageType,
  TerrainCompression,
  type TerrainCompressionValue,
  TerrainDtype,
  type TerrainDtypeValue,
  type ParsedMessage,
  type ParsedTerrain,
} from './types';

export type AssemblerOutput =
  | { kind: 'message'; message: ParsedMessage }
  | { kind: 'pending' }
  | { kind: 'protocol-error'; reason: string };

const TERRAIN_HEADER_PREFIX_BYTES = 34; // bytes 0–33 inclusive (opcode + dims + flags)
const F32_BYTES = 4;
const F64_BYTES = 8;
const U16_BYTES = 2;
const UINT16_MAX = 65535;

interface TerrainHeaderPrefix {
  rows: number;
  cols: number;
  resolution: number;
  originX: number;
  originY: number;
  dtype: TerrainDtypeValue;
  compression: TerrainCompressionValue;
}

const TERRAIN_CHUNK_HEADER_BYTES = 22;

interface ChunkedTransferState {
  headerMeta: TerrainHeaderPrefix;
  elevationMin: number | undefined;
  elevationMax: number | undefined;
  grid: Float64Array;
  written: Uint8Array;
  expectedChunks: number;
  receivedChunks: number;
  /** Tracks each seq-num's claimed coordinates so duplicates can be classified. */
  seenSequenceNumbers: Map<number, { rowOffset: number; colOffset: number; chunkRows: number; chunkCols: number }>;
  /** Cumulative compressed/decompressed byte counts for the spec INFO log. */
  bytesCompressed: number;
  bytesDecompressed: number;
}

interface AssemblerState {
  state: 'IDLE' | 'EXPECTING_CHUNKS';
  stateUpdatesStarted: boolean;
  chunked: ChunkedTransferState | null;
}

export interface TerrainAssembler {
  feed(buffer: ArrayBuffer): AssemblerOutput;
}

/**
 * Reads bytes 0–33 of a TERRAIN (0x03) or TERRAIN_HEADER (0x05) message and
 * decodes the dimension fields plus the flags byte. The bytes 0–33 layout is
 * byte-position-identical between the two opcodes — a property the spec
 * confirms and which lets this reader serve both call sites.
 *
 * Returns either a parsed prefix or a string describing why the bytes do not
 * form a legal v2 header (caller turns the string into a protocol-error).
 */
function readTerrainHeaderPrefix(
  buffer: ArrayBuffer,
  view: DataView,
): TerrainHeaderPrefix | { error: string } {
  if (buffer.byteLength < TERRAIN_HEADER_PREFIX_BYTES) {
    return { error: `terrain header truncated: got ${buffer.byteLength} bytes, need >= ${TERRAIN_HEADER_PREFIX_BYTES}` };
  }
  const rows = view.getUint32(1, true);
  const cols = view.getUint32(5, true);
  const resolution = view.getFloat64(9, true);
  const originX = view.getFloat64(17, true);
  const originY = view.getFloat64(25, true);
  const flags = view.getUint8(33);

  // flags layout: bits 0–1 = dtype, bits 2–4 = compression, bits 5–7 = reserved.
  const reserved = (flags >> 5) & 0b111;
  if (reserved !== 0) {
    return { error: 'reserved flag bits set (protocol version mismatch — update viewer)' };
  }
  const dtypeBits = flags & 0b11;
  if (dtypeBits !== TerrainDtype.F32 && dtypeBits !== TerrainDtype.F64 && dtypeBits !== TerrainDtype.UINT16) {
    return { error: `unknown dtype: ${dtypeBits}` };
  }
  const compressionBits = (flags >> 2) & 0b111;
  if (
    compressionBits !== TerrainCompression.NONE &&
    compressionBits !== TerrainCompression.ZSTD &&
    compressionBits !== TerrainCompression.LZ4
  ) {
    return { error: `unknown compression: ${compressionBits}` };
  }

  if (rows === 0 || cols === 0 || resolution <= 0) {
    return { error: `terrain invalid header: rows=${rows} cols=${cols} resolution=${resolution}` };
  }
  if (rows * cols > config.terrainMaxCells) {
    return { error: `terrain grid ${rows}×${cols} exceeds cap ${config.terrainMaxCells}` };
  }

  return {
    rows,
    cols,
    resolution,
    originX,
    originY,
    dtype: dtypeBits,
    compression: compressionBits,
  };
}

/**
 * Decode a decompressed payload as `count` cells of `dtype`, returning a
 * Float64Array. For UINT16, dequantization uses elevation_min/max:
 *   elev = min + (u / 65535) * (max - min)
 * which collapses to all-min when min == max (no NaN).
 *
 * Returns `{error}` on length mismatch or unknown dtype.
 */
function decodeDtype(
  decompressed: Uint8Array,
  dtype: TerrainDtypeValue,
  count: number,
  elevationMin?: number,
  elevationMax?: number,
): Float64Array | { error: string } {
  switch (dtype) {
    case TerrainDtype.F32: {
      const expected = count * F32_BYTES;
      if (decompressed.byteLength !== expected) {
        return { error: `f32 payload length mismatch: got ${decompressed.byteLength}, expected ${expected}` };
      }
      // Detach from the source buffer. `slice` copies; `Float32Array` view then
      // reads aligned f32 LE values regardless of underlying offset.
      const copy = decompressed.slice();
      const f32 = new Float32Array(copy.buffer, copy.byteOffset, count);
      const out = new Float64Array(count);
      for (let i = 0; i < count; i++) out[i] = f32[i];
      return out;
    }
    case TerrainDtype.F64: {
      const expected = count * F64_BYTES;
      if (decompressed.byteLength !== expected) {
        return { error: `f64 payload length mismatch: got ${decompressed.byteLength}, expected ${expected}` };
      }
      const copy = decompressed.slice();
      return new Float64Array(copy.buffer, copy.byteOffset, count);
    }
    case TerrainDtype.UINT16: {
      const expected = count * U16_BYTES;
      if (decompressed.byteLength !== expected) {
        return { error: `uint16 payload length mismatch: got ${decompressed.byteLength}, expected ${expected}` };
      }
      if (elevationMin === undefined || elevationMax === undefined) {
        return { error: 'uint16 dtype requires elevation_min/elevation_max in header' };
      }
      const copy = decompressed.slice();
      const u16 = new Uint16Array(copy.buffer, copy.byteOffset, count);
      const range = elevationMax - elevationMin;
      const out = new Float64Array(count);
      if (range === 0) {
        // Constant-terrain: avoid 0/0 NaN, fill with min.
        out.fill(elevationMin);
        return out;
      }
      const scale = range / UINT16_MAX;
      for (let i = 0; i < count; i++) out[i] = elevationMin + u16[i] * scale;
      return out;
    }
  }
}

function describeDtype(dtype: TerrainDtypeValue): string {
  return dtype === TerrainDtype.F32 ? 'f32' : dtype === TerrainDtype.F64 ? 'f64' : 'uint16';
}

function describeCompression(compression: TerrainCompressionValue): string {
  return compression === TerrainCompression.NONE ? 'none' : compression === TerrainCompression.ZSTD ? 'zstd' : 'lz4';
}

/**
 * Parse a single-shot v2 TERRAIN (`0x03`) message into a ParsedTerrain.
 * Header bytes 0–33 are read by readTerrainHeaderPrefix; if dtype is UINT16
 * the dequant range follows at bytes 34–49 and the compressed payload starts
 * at byte 50, otherwise the payload starts at byte 34.
 */
function parseTerrainSingleShot(buffer: ArrayBuffer): ParsedTerrain | { error: string } {
  const view = new DataView(buffer);
  const prefix = readTerrainHeaderPrefix(buffer, view);
  if ('error' in prefix) return prefix;

  let payloadStart: number;
  let elevationMin: number | undefined;
  let elevationMax: number | undefined;
  if (prefix.dtype === TerrainDtype.UINT16) {
    if (buffer.byteLength < TERRAIN_HEADER_PREFIX_BYTES + 16) {
      return { error: 'uint16 single-shot terrain truncated before elevation_min/max' };
    }
    elevationMin = view.getFloat64(34, true);
    elevationMax = view.getFloat64(42, true);
    payloadStart = 50;
  } else {
    payloadStart = TERRAIN_HEADER_PREFIX_BYTES;
  }

  if (buffer.byteLength < payloadStart) {
    return { error: 'single-shot terrain has no payload bytes' };
  }
  const compressed = new Uint8Array(buffer.slice(payloadStart));

  let decompressed: Uint8Array;
  try {
    decompressed = decompress(compressed, prefix.compression);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { error: `malformed compressed payload: ${message}` };
  }

  const cellCount = prefix.rows * prefix.cols;
  const decoded = decodeDtype(decompressed, prefix.dtype, cellCount, elevationMin, elevationMax);
  if ('error' in decoded) return decoded;

  // Spec INFO log per TD-10.
  console.info(
    `[net] TERRAIN rows=${prefix.rows} cols=${prefix.cols} resolution=${prefix.resolution} ` +
    `dtype=${describeDtype(prefix.dtype)} compression=${describeCompression(prefix.compression)} ` +
    `chunks=1 bytes_compressed=${compressed.byteLength} bytes_decompressed=${decompressed.byteLength}`,
  );

  return {
    type: MessageType.TERRAIN,
    rows: prefix.rows,
    cols: prefix.cols,
    resolution: prefix.resolution,
    originX: prefix.originX,
    originY: prefix.originY,
    elevation: decoded,
  };
}

/**
 * Handle a TERRAIN_HEADER (`0x05`) message. Initializes the chunked transfer
 * state: parses bytes 0–33 (shared layout with single-shot 0x03), reads the
 * `chunk_count` u32 at byte 34, and the optional uint16 dequant range at
 * bytes 38–53. Allocates the destination grid and coverage mask.
 */
function startChunkedTransfer(
  buffer: ArrayBuffer,
  s: AssemblerState,
): AssemblerOutput {
  if (s.state === 'EXPECTING_CHUNKS') {
    return { kind: 'protocol-error', reason: 'TERRAIN_HEADER received mid-chunked delivery' };
  }
  if (s.stateUpdatesStarted) {
    return { kind: 'protocol-error', reason: 'TERRAIN_HEADER received after STATE_UPDATE began' };
  }

  const view = new DataView(buffer);
  const prefix = readTerrainHeaderPrefix(buffer, view);
  if ('error' in prefix) return { kind: 'protocol-error', reason: prefix.error };

  const isUint16 = prefix.dtype === TerrainDtype.UINT16;
  const minHeaderBytes = isUint16 ? 54 : 38;
  if (buffer.byteLength < minHeaderBytes) {
    return {
      kind: 'protocol-error',
      reason: `TERRAIN_HEADER truncated: got ${buffer.byteLength}, need >= ${minHeaderBytes}`,
    };
  }
  const chunkCount = view.getUint32(34, true);
  if (chunkCount === 0) {
    return { kind: 'protocol-error', reason: 'TERRAIN_HEADER chunk_count is zero' };
  }
  let elevationMin: number | undefined;
  let elevationMax: number | undefined;
  if (isUint16) {
    elevationMin = view.getFloat64(38, true);
    elevationMax = view.getFloat64(46, true);
  }

  s.state = 'EXPECTING_CHUNKS';
  s.chunked = {
    headerMeta: prefix,
    elevationMin,
    elevationMax,
    grid: new Float64Array(prefix.rows * prefix.cols),
    written: new Uint8Array(prefix.rows * prefix.cols),
    expectedChunks: chunkCount,
    receivedChunks: 0,
    seenSequenceNumbers: new Map(),
    bytesCompressed: 0,
    bytesDecompressed: 0,
  };
  return { kind: 'pending' };
}

/**
 * Handle a TERRAIN_CHUNK (`0x04`) message: 22-byte header + compressed payload.
 * Decompresses + dtype-decodes + writes into the destination grid; verifies
 * coverage and finalizes the ParsedTerrain when last_chunk_flag is set.
 *
 * Pre-conditions enforced by caller: `state === 'EXPECTING_CHUNKS'` and
 * `s.chunked !== null`.
 */
function handleChunk(
  buffer: ArrayBuffer,
  s: AssemblerState,
): AssemblerOutput {
  const ct = s.chunked;
  if (ct === null) {
    return { kind: 'protocol-error', reason: 'TERRAIN_CHUNK received without preceding TERRAIN_HEADER' };
  }
  if (buffer.byteLength < TERRAIN_CHUNK_HEADER_BYTES) {
    return { kind: 'protocol-error', reason: `TERRAIN_CHUNK header truncated: got ${buffer.byteLength}` };
  }
  const view = new DataView(buffer);
  const sequenceNumber = view.getUint32(1, true);
  const rowOffset = view.getUint32(5, true);
  const colOffset = view.getUint32(9, true);
  const chunkRows = view.getUint32(13, true);
  const chunkCols = view.getUint32(17, true);
  const lastChunkFlag = view.getUint8(21);

  const { headerMeta, elevationMin, elevationMax } = ct;
  if (chunkRows === 0 || chunkCols === 0) {
    return { kind: 'protocol-error', reason: `TERRAIN_CHUNK has zero rows or cols: ${chunkRows}×${chunkCols}` };
  }
  if (rowOffset + chunkRows > headerMeta.rows || colOffset + chunkCols > headerMeta.cols) {
    return {
      kind: 'protocol-error',
      reason: `TERRAIN_CHUNK bounds out of range: offset (${rowOffset},${colOffset}) + size (${chunkRows}×${chunkCols}) exceeds header (${headerMeta.rows}×${headerMeta.cols})`,
    };
  }

  // Duplicate-seq policy (per the reference's two-case refinement).
  const prior = ct.seenSequenceNumbers.get(sequenceNumber);
  let isBenignRetransmit = false;
  if (prior !== undefined) {
    if (
      prior.rowOffset === rowOffset &&
      prior.colOffset === colOffset &&
      prior.chunkRows === chunkRows &&
      prior.chunkCols === chunkCols
    ) {
      console.warn(`[net] terrain warning: duplicate chunk seq=${sequenceNumber} (last-write-wins)`);
      isBenignRetransmit = true;
    } else {
      return {
        kind: 'protocol-error',
        reason: `duplicate sequence_number ${sequenceNumber} with different coordinates`,
      };
    }
  } else {
    ct.seenSequenceNumbers.set(sequenceNumber, { rowOffset, colOffset, chunkRows, chunkCols });
  }

  const compressed = new Uint8Array(buffer.slice(TERRAIN_CHUNK_HEADER_BYTES));
  let decompressed: Uint8Array;
  try {
    decompressed = decompress(compressed, headerMeta.compression);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { kind: 'protocol-error', reason: `malformed compressed payload: ${message}` };
  }
  const cellCount = chunkRows * chunkCols;
  const decoded = decodeDtype(decompressed, headerMeta.dtype, cellCount, elevationMin, elevationMax);
  if ('error' in decoded) {
    return { kind: 'protocol-error', reason: decoded.error };
  }

  // Coverage write. For non-retransmits, any cell with `written === 1` already
  // is an overlap with a different sequence_number — protocol error.
  for (let r = 0; r < chunkRows; r++) {
    const srcOff = r * chunkCols;
    const dstOff = (rowOffset + r) * headerMeta.cols + colOffset;
    for (let c = 0; c < chunkCols; c++) {
      const dstIdx = dstOff + c;
      if (!isBenignRetransmit && ct.written[dstIdx] === 1) {
        return {
          kind: 'protocol-error',
          reason: `chunk overlap at row=${rowOffset + r} col=${colOffset + c}`,
        };
      }
      ct.grid[dstIdx] = decoded[srcOff + c];
      ct.written[dstIdx] = 1;
    }
  }

  ct.bytesCompressed += compressed.byteLength;
  ct.bytesDecompressed += decompressed.byteLength;
  if (!isBenignRetransmit) ct.receivedChunks++;

  if (lastChunkFlag !== 1) {
    return { kind: 'pending' };
  }

  // Finalize: assert chunk count and full coverage.
  if (ct.receivedChunks !== ct.expectedChunks) {
    return {
      kind: 'protocol-error',
      reason: `chunk count mismatch on finalize: received ${ct.receivedChunks}, expected ${ct.expectedChunks}`,
    };
  }
  for (let i = 0; i < ct.written.length; i++) {
    if (ct.written[i] !== 1) {
      return { kind: 'protocol-error', reason: `missing chunk coverage gap at index ${i}` };
    }
  }

  const message: ParsedTerrain = {
    type: MessageType.TERRAIN,
    rows: headerMeta.rows,
    cols: headerMeta.cols,
    resolution: headerMeta.resolution,
    originX: headerMeta.originX,
    originY: headerMeta.originY,
    elevation: ct.grid,
  };
  console.info(
    `[net] TERRAIN rows=${headerMeta.rows} cols=${headerMeta.cols} resolution=${headerMeta.resolution} ` +
    `dtype=${describeDtype(headerMeta.dtype)} compression=${describeCompression(headerMeta.compression)} ` +
    `chunks=${ct.expectedChunks} bytes_compressed=${ct.bytesCompressed} bytes_decompressed=${ct.bytesDecompressed}`,
  );

  // Reset chunked state — assembler returns to IDLE for any subsequent terrain.
  s.state = 'IDLE';
  s.chunked = null;
  return { kind: 'message', message };
}

export function createTerrainAssembler(): TerrainAssembler {
  const s: AssemblerState = {
    state: 'IDLE',
    stateUpdatesStarted: false,
    chunked: null,
  };

  function feed(buffer: ArrayBuffer): AssemblerOutput {
    if (buffer.byteLength < 1) {
      return { kind: 'pending' };
    }
    const view = new DataView(buffer);
    const opcode = view.getUint8(0);

    switch (opcode) {
      case MessageType.SNAPSHOT: {
        const message = parseSnapshot(buffer, view);
        if (message === null) return { kind: 'pending' };
        return { kind: 'message', message };
      }
      case MessageType.STATE_UPDATE: {
        const message = parseStateUpdate(buffer, view);
        if (message === null) return { kind: 'pending' };
        s.stateUpdatesStarted = true;
        return { kind: 'message', message };
      }
      case MessageType.TERRAIN: {
        if (s.state === 'EXPECTING_CHUNKS') {
          return { kind: 'protocol-error', reason: 'TERRAIN single-shot received mid-chunked delivery' };
        }
        if (s.stateUpdatesStarted) {
          return { kind: 'protocol-error', reason: 'TERRAIN received after STATE_UPDATE began' };
        }
        const result = parseTerrainSingleShot(buffer);
        if ('error' in result) return { kind: 'protocol-error', reason: result.error };
        return { kind: 'message', message: result };
      }
      case MessageType.TERRAIN_HEADER:
        return startChunkedTransfer(buffer, s);
      case MessageType.TERRAIN_CHUNK:
        if (s.state !== 'EXPECTING_CHUNKS') {
          return { kind: 'protocol-error', reason: 'TERRAIN_CHUNK received without preceding TERRAIN_HEADER' };
        }
        return handleChunk(buffer, s);
      default:
        return {
          kind: 'protocol-error',
          reason: `unknown opcode 0x${opcode.toString(16).padStart(2, '0')}`,
        };
    }
  }

  return { feed };
}
