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

const SNAPSHOT_HEADER_BYTES = 25;
const SNAPSHOT_PER_ENTITY_BYTES = 36; // 16 pos + 16 vel + 4 profile
const STATE_UPDATE_HEADER_BYTES = 9;
const STATE_UPDATE_PER_ENTITY_BYTES = 32; // 16 pos + 16 vel

/**
 * Parse a binary message from the wire. Returns `null` (with a logged warning)
 * for any malformed or unrecognized input.
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

function parseSnapshot(buffer: ArrayBuffer, view: DataView): ParsedSnapshot | null {
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

  if (entityCount > config.maxEntityCount) {
    console.warn(
      `[protocol] snapshot entity count ${entityCount} exceeds cap ${config.maxEntityCount}`,
    );
    return null;
  }
  const expectedBytes = SNAPSHOT_HEADER_BYTES + entityCount * SNAPSHOT_PER_ENTITY_BYTES;
  if (buffer.byteLength !== expectedBytes) {
    console.warn(
      `[protocol] snapshot length mismatch: got ${buffer.byteLength}, expected ${expectedBytes} (entityCount=${entityCount})`,
    );
    return null;
  }

  const posOffset = SNAPSHOT_HEADER_BYTES;
  const velOffset = posOffset + entityCount * 16;
  const idxOffset = velOffset + entityCount * 16;

  // Copy: detach from the WebSocket message buffer so reuse on the next tick is safe.
  const positions = new Float64Array(buffer.slice(posOffset, posOffset + entityCount * 16));
  const velocities = new Float64Array(buffer.slice(velOffset, velOffset + entityCount * 16));
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

function parseStateUpdate(buffer: ArrayBuffer, view: DataView): ParsedStateUpdate | null {
  if (buffer.byteLength < STATE_UPDATE_HEADER_BYTES) {
    console.warn(
      `[protocol] state update buffer too small for header: got ${buffer.byteLength}, need >= ${STATE_UPDATE_HEADER_BYTES}`,
    );
    return null;
  }
  const tick = readU32LE(view, 1);
  const entityCount = readU32LE(view, 5);

  if (entityCount > config.maxEntityCount) {
    console.warn(
      `[protocol] state update entity count ${entityCount} exceeds cap ${config.maxEntityCount}`,
    );
    return null;
  }
  const expectedBytes = STATE_UPDATE_HEADER_BYTES + entityCount * STATE_UPDATE_PER_ENTITY_BYTES;
  if (buffer.byteLength !== expectedBytes) {
    console.warn(
      `[protocol] state update length mismatch: got ${buffer.byteLength}, expected ${expectedBytes} (entityCount=${entityCount})`,
    );
    return null;
  }

  const posOffset = STATE_UPDATE_HEADER_BYTES;
  const velOffset = posOffset + entityCount * 16;

  const positions = new Float64Array(buffer.slice(posOffset, posOffset + entityCount * 16));
  const velocities = new Float64Array(buffer.slice(velOffset, velOffset + entityCount * 16));

  return {
    type: MessageType.STATE_UPDATE,
    tick,
    entityCount,
    positions,
    velocities,
  };
}
