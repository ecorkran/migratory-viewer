/**
 * Binary protocol deserializer for migratory wire messages.
 *
 * All raw `DataView` reads in this file MUST go through `readU8`, `readU32LE`,
 * or `readF64LE`. This enforces consistent little-endian discipline — direct
 * `view.getUint32(offset)` calls (without the `littleEndian = true` flag) are
 * a defect waiting to happen on big-endian hardware. The helpers are not
 * exported; this is internal-only enforcement.
 */

import config from '../config';
import {
  MessageType,
  PositionDtype,
  WIRE_SCHEMA_VERSION,
  type ParsedMessage,
  type ParsedSnapshot,
  type ParsedStateUpdate,
} from './types';

function readU8(view: DataView, offset: number): number {
  return view.getUint8(offset);
}

function readU32LE(view: DataView, offset: number): number {
  return view.getUint32(offset, true);
}

function readF64LE(view: DataView, offset: number): number {
  return view.getFloat64(offset, true);
}

const SNAPSHOT_HEADER_BYTES = 32;
const SNAPSHOT_PER_ENTITY_BYTES_F64 = 36; // 32 pos+vel (f64) + 4 profile
const SNAPSHOT_PER_ENTITY_BYTES_F32 = 20; // 16 pos+vel (f32) + 4 profile
const STATE_UPDATE_HEADER_BYTES = 16;
const STATE_UPDATE_PER_ENTITY_BYTES_F64 = 32; // 32 pos+vel (f64)
const STATE_UPDATE_PER_ENTITY_BYTES_F32 = 16; // 16 pos+vel (f32)

/**
 * Parse a SNAPSHOT or STATE_UPDATE message from the wire. Returns `null` (with
 * a logged warning) for any malformed or unrecognized input.
 *
 * Terrain (v2 — single-shot 0x03, chunked 0x05/0x04) is exclusively routed
 * through `protocol/terrain-assembler.ts`; this dispatcher does not handle
 * terrain opcodes. The assembler also delegates SNAPSHOT and STATE_UPDATE
 * to the helpers below, so end-to-end the wire is fully covered.
 */
export function parseMessage(buffer: ArrayBuffer): ParsedMessage | null {
  if (buffer.byteLength < 1) {
    console.warn('[protocol] empty buffer');
    return null;
  }
  const view = new DataView(buffer);
  const type = readU8(view, 0);
  switch (type) {
    case MessageType.SNAPSHOT:
      return parseSnapshot(buffer, view);
    case MessageType.STATE_UPDATE:
      return parseStateUpdate(buffer, view);
    default:
      console.warn(`[protocol] unknown message type byte: 0x${type.toString(16).padStart(2, '0')}`);
      return null;
  }
}

export function parseSnapshot(buffer: ArrayBuffer, view: DataView): ParsedSnapshot | null {
  if (buffer.byteLength < SNAPSHOT_HEADER_BYTES) {
    console.warn(
      `[protocol] snapshot buffer too small for header: got ${buffer.byteLength}, need >= ${SNAPSHOT_HEADER_BYTES}`,
    );
    return null;
  }
  const tick = readU32LE(view, 1);
  const worldWidth = readF64LE(view, 5);
  const worldHeight = readF64LE(view, 13);
  const entityCount = readU32LE(view, 21);
  const dtype = readU8(view, 25);
  const schemaVersion = readU8(view, 26);
  // Bytes 27-31 are reserved (forward-compat); parser must not validate them.

  if (dtype !== PositionDtype.F64 && dtype !== PositionDtype.F32) {
    console.warn(`[protocol] unknown position dtype: 0x${dtype.toString(16).padStart(2, '0')}`);
    return null;
  }

  if (schemaVersion !== WIRE_SCHEMA_VERSION) {
    console.warn(
      `[protocol] snapshot unsupported schema version: 0x${schemaVersion.toString(16).padStart(2, '0')}`,
    );
    return null;
  }

  if (entityCount > config.maxEntityCount) {
    console.warn(
      `[protocol] snapshot entity count ${entityCount} exceeds cap ${config.maxEntityCount}`,
    );
    return null;
  }

  const perEntityBytes =
    dtype === PositionDtype.F32 ? SNAPSHOT_PER_ENTITY_BYTES_F32 : SNAPSHOT_PER_ENTITY_BYTES_F64;
  const expectedBytes = SNAPSHOT_HEADER_BYTES + entityCount * perEntityBytes;
  if (buffer.byteLength !== expectedBytes) {
    console.warn(
      `[protocol] snapshot length mismatch: got ${buffer.byteLength}, expected ${expectedBytes} (entityCount=${entityCount})`,
    );
    return null;
  }

  // Zero-copy: returned typed arrays alias the WebSocket message buffer.
  // `applySnapshot` is responsible for detaching via `.slice()` before the
  // browser reuses the buffer on the next `onmessage`.
  const componentCount = entityCount * 2;
  const dtypeBytes = dtype === PositionDtype.F32 ? 4 : 8;
  const posOffset = SNAPSHOT_HEADER_BYTES;
  const velOffset = posOffset + componentCount * dtypeBytes;
  const idxOffset = velOffset + componentCount * dtypeBytes;

  const positions =
    dtype === PositionDtype.F32
      ? new Float32Array(buffer, posOffset, componentCount)
      : new Float64Array(buffer, posOffset, componentCount);
  const velocities =
    dtype === PositionDtype.F32
      ? new Float32Array(buffer, velOffset, componentCount)
      : new Float64Array(buffer, velOffset, componentCount);
  const profileIndices = new Int32Array(buffer, idxOffset, entityCount);

  return {
    type: MessageType.SNAPSHOT,
    tick,
    worldWidth,
    worldHeight,
    entityCount,
    positions,
    velocities,
    profileIndices,
  };
}

export function parseStateUpdate(buffer: ArrayBuffer, view: DataView): ParsedStateUpdate | null {
  if (buffer.byteLength < STATE_UPDATE_HEADER_BYTES) {
    console.warn(
      `[protocol] state update buffer too small for header: got ${buffer.byteLength}, need >= ${STATE_UPDATE_HEADER_BYTES}`,
    );
    return null;
  }
  const tick = readU32LE(view, 1);
  const entityCount = readU32LE(view, 5);
  const dtype = readU8(view, 9);
  const schemaVersion = readU8(view, 10);
  // Bytes 11-15 are reserved (forward-compat); parser must not validate them.

  if (dtype !== PositionDtype.F64 && dtype !== PositionDtype.F32) {
    console.warn(`[protocol] unknown position dtype: 0x${dtype.toString(16).padStart(2, '0')}`);
    return null;
  }

  if (schemaVersion !== WIRE_SCHEMA_VERSION) {
    console.warn(
      `[protocol] state update unsupported schema version: 0x${schemaVersion.toString(16).padStart(2, '0')}`,
    );
    return null;
  }

  if (entityCount > config.maxEntityCount) {
    console.warn(
      `[protocol] state update entity count ${entityCount} exceeds cap ${config.maxEntityCount}`,
    );
    return null;
  }

  const perEntityBytes =
    dtype === PositionDtype.F32
      ? STATE_UPDATE_PER_ENTITY_BYTES_F32
      : STATE_UPDATE_PER_ENTITY_BYTES_F64;
  const expectedBytes = STATE_UPDATE_HEADER_BYTES + entityCount * perEntityBytes;
  if (buffer.byteLength !== expectedBytes) {
    console.warn(
      `[protocol] state update length mismatch: got ${buffer.byteLength}, expected ${expectedBytes} (entityCount=${entityCount})`,
    );
    return null;
  }

  // Zero-copy: the returned typed arrays alias the WebSocket message buffer.
  // The browser reuses that buffer on the next `onmessage`, so callers must
  // copy before yielding to the event loop. `applyStateUpdate` already copies
  // via `.set()`; `applySnapshot` copies via `.slice()`.
  const componentCount = entityCount * 2;
  const dtypeBytes = dtype === PositionDtype.F32 ? 4 : 8;
  const posOffset = STATE_UPDATE_HEADER_BYTES;
  const velOffset = posOffset + componentCount * dtypeBytes;

  const positions =
    dtype === PositionDtype.F32
      ? new Float32Array(buffer, posOffset, componentCount)
      : new Float64Array(buffer, posOffset, componentCount);
  const velocities =
    dtype === PositionDtype.F32
      ? new Float32Array(buffer, velOffset, componentCount)
      : new Float64Array(buffer, velOffset, componentCount);

  return {
    type: MessageType.STATE_UPDATE,
    tick,
    entityCount,
    positions,
    velocities,
  };
}
