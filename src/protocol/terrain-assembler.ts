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
 */

import { parseSnapshot, parseStateUpdate } from './deserialize';
import { MessageType, type ParsedMessage } from './types';

export type AssemblerOutput =
  | { kind: 'message'; message: ParsedMessage }
  | { kind: 'pending' }
  | { kind: 'protocol-error'; reason: string };

interface AssemblerState {
  state: 'IDLE' | 'EXPECTING_CHUNKS';
  stateUpdatesStarted: boolean;
}

export interface TerrainAssembler {
  feed(buffer: ArrayBuffer): AssemblerOutput;
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
      case MessageType.TERRAIN:
      case MessageType.TERRAIN_HEADER:
      case MessageType.TERRAIN_CHUNK:
        // TODO T7/T9 — implement single-shot and chunked terrain paths.
        return { kind: 'protocol-error', reason: 'not implemented in T5' };
      default:
        return {
          kind: 'protocol-error',
          reason: `unknown opcode 0x${opcode.toString(16).padStart(2, '0')}`,
        };
    }
  }

  return { feed };
}
