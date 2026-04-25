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

interface AssemblerState {
  state: 'IDLE' | 'EXPECTING_CHUNKS';
  stateUpdatesStarted: boolean;
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

export function createTerrainAssembler(): TerrainAssembler {
  const s: AssemblerState = {
    state: 'IDLE',
    stateUpdatesStarted: false,
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
      case MessageType.TERRAIN_CHUNK:
        // TODO T9 — implement chunked path.
        return { kind: 'protocol-error', reason: 'chunked terrain not implemented in T7' };
      default:
        return {
          kind: 'protocol-error',
          reason: `unknown opcode 0x${opcode.toString(16).padStart(2, '0')}`,
        };
    }
  }

  return { feed };
}
