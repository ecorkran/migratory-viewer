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

const SNAPSHOT_HEADER_BYTES = 26;
const SNAPSHOT_PER_ENTITY_BYTES_F64 = 36; // 32 pos+vel (f64) + 4 profile
const SNAPSHOT_PER_ENTITY_BYTES_F32 = 20; // 16 pos+vel (f32) + 4 profile
const STATE_UPDATE_HEADER_BYTES = 10;
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

  if (dtype !== PositionDtype.F64 && dtype !== PositionDtype.F32) {
    console.warn(`[protocol] unknown position dtype: 0x${dtype.toString(16).padStart(2, '0')}`);
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
  // perEntityBytes includes pos+vel (posVelBytes) + 4 bytes for profile index
  const posVelBytes = perEntityBytes - 4;
  const expectedBytes = SNAPSHOT_HEADER_BYTES + entityCount * perEntityBytes;
  if (buffer.byteLength !== expectedBytes) {
    console.warn(
      `[protocol] snapshot length mismatch: got ${buffer.byteLength}, expected ${expectedBytes} (entityCount=${entityCount})`,
    );
    return null;
  }

  const posOffset = SNAPSHOT_HEADER_BYTES;
  const perComponentBytes = posVelBytes / 4; // bytes per component (x or y for one entity)
  const velOffset = posOffset + entityCount * perComponentBytes * 2;
  const idxOffset = velOffset + entityCount * perComponentBytes * 2;

  // Copy: detach from the WebSocket message buffer so reuse on the next tick is safe.
  const posByteLen = entityCount * perComponentBytes * 2;
  const positions =
    dtype === PositionDtype.F32
      ? new Float32Array(buffer.slice(posOffset, posOffset + posByteLen))
      : new Float64Array(buffer.slice(posOffset, posOffset + posByteLen));
  const velocities =
    dtype === PositionDtype.F32
      ? new Float32Array(buffer.slice(velOffset, velOffset + posByteLen))
      : new Float64Array(buffer.slice(velOffset, velOffset + posByteLen));
  const profileIndices = new Int32Array(buffer.slice(idxOffset, idxOffset + entityCount * 4));

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

  if (dtype !== PositionDtype.F64 && dtype !== PositionDtype.F32) {
    console.warn(`[protocol] unknown position dtype: 0x${dtype.toString(16).padStart(2, '0')}`);
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

  const posOffset = STATE_UPDATE_HEADER_BYTES;
  const perComponentBytes = perEntityBytes / 4; // bytes per component (x or y for one entity)
  const velOffset = posOffset + entityCount * perComponentBytes * 2;
  const posByteLen = entityCount * perComponentBytes * 2;

  const positions =
    dtype === PositionDtype.F32
      ? new Float32Array(buffer.slice(posOffset, posOffset + posByteLen))
      : new Float64Array(buffer.slice(posOffset, posOffset + posByteLen));
  const velocities =
    dtype === PositionDtype.F32
      ? new Float32Array(buffer.slice(velOffset, velOffset + posByteLen))
      : new Float64Array(buffer.slice(velOffset, velOffset + posByteLen));

  return {
    type: MessageType.STATE_UPDATE,
    tick,
    entityCount,
    positions,
    velocities,
  };
}
