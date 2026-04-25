/**
 * WebSocket connection manager for the migratory wire protocol.
 *
 * Sole writer of `viewerState` (via `applySnapshot` / `applyStateUpdate` from
 * `src/state.ts`). Handles connect / reconnect / disconnect with exponential
 * backoff and jitter, and dispatches incoming binary messages to the parser.
 *
 * Connection state machine: DISCONNECTED → CONNECTING → CONNECTED → RECONNECTING → CONNECTING → ...
 */

import type { ViewerState } from '../types';
import { applySnapshot, applyStateUpdate, applyTerrain } from '../state';
import { createTerrainAssembler, type TerrainAssembler } from '../protocol/terrain-assembler';
import { MessageType } from '../protocol/types';

const PROTOCOL_ERROR_CLOSE_CODE = 1002;

const INITIAL_BACKOFF_MS = 500;
const MAX_BACKOFF_MS = 30_000;
const BACKOFF_FACTOR = 2;
const JITTER_RATIO = 0.2;

export interface Connection {
  connect(url: string): void;
  disconnect(): void;
}

export function createConnection(viewerState: ViewerState): Connection {
  let ws: WebSocket | null = null;
  let assembler: TerrainAssembler | null = null;
  let backoffMs = INITIAL_BACKOFF_MS;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let intentionallyClosed = false;
  let currentUrl: string | null = null;

  function clearReconnectTimer(): void {
    if (reconnectTimer !== null) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
  }

  function scheduleReconnect(): void {
    clearReconnectTimer();
    if (currentUrl === null) return;
    const jitter = 1 + (Math.random() * 2 - 1) * JITTER_RATIO;
    const delay = backoffMs * jitter;
    console.warn(`[net] reconnecting in ${Math.round(delay)}ms (backoff=${backoffMs}ms)`);
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      backoffMs = Math.min(backoffMs * BACKOFF_FACTOR, MAX_BACKOFF_MS);
      if (currentUrl !== null) connect(currentUrl);
    }, delay);
  }

  function handleMessage(event: MessageEvent): void {
    if (!(event.data instanceof ArrayBuffer)) {
      console.warn('[net] non-ArrayBuffer message ignored');
      return;
    }
    if (assembler === null) {
      // Should be impossible: handleMessage only fires while a WebSocket is
      // open, and connect() always creates the assembler before binding onmessage.
      console.warn('[net] message received before assembler initialization — dropped');
      return;
    }
    const out = assembler.feed(event.data);
    if (out.kind === 'pending') return;
    if (out.kind === 'protocol-error') {
      console.warn(`[net] terrain protocol error: ${out.reason}`);
      ws?.close(PROTOCOL_ERROR_CLOSE_CODE, out.reason);
      return;
    }
    const parsed = out.message;
    if (parsed.type === MessageType.SNAPSHOT) {
      applySnapshot(viewerState, parsed);
      return;
    }
    if (parsed.type === MessageType.TERRAIN) {
      applyTerrain(viewerState, parsed);
      return;
    }
    // STATE_UPDATE
    if (viewerState.entityCount !== 0 && parsed.entityCount !== viewerState.entityCount) {
      console.warn(
        `[net] state update entity count ${parsed.entityCount} differs from snapshot ${viewerState.entityCount} — forcing reconnect`,
      );
      ws?.close();
      return;
    }
    applyStateUpdate(viewerState, parsed);
  }

  function connect(url: string): void {
    currentUrl = url;
    intentionallyClosed = false;
    viewerState.connectionStatus = 'connecting';
    // The browser WebSocket API has no client-side max_size knob. The server's
    // 32 MiB TERRAIN frame cap (migratory slice 507) is asymmetric by design;
    // Node-based consumers would need to configure their own limit separately.
    ws = new WebSocket(url);
    ws.binaryType = 'arraybuffer';
    // Per-connection assembler: reconnect implicitly resets terrain state.
    assembler = createTerrainAssembler();

    ws.onopen = () => {
      console.info(`[net] connected to ${url}`);
      viewerState.connectionStatus = 'connected';
      backoffMs = INITIAL_BACKOFF_MS;
    };
    ws.onmessage = handleMessage;
    ws.onerror = () => {
      console.warn('[net] socket error');
    };
    ws.onclose = () => {
      ws = null;
      assembler = null;
      if (intentionallyClosed) {
        viewerState.connectionStatus = 'disconnected';
        return;
      }
      viewerState.connectionStatus = 'reconnecting';
      scheduleReconnect();
    };
  }

  function disconnect(): void {
    intentionallyClosed = true;
    clearReconnectTimer();
    currentUrl = null;
    if (ws !== null) {
      ws.close();
      ws = null;
    }
    assembler = null;
    viewerState.connectionStatus = 'disconnected';
  }

  return { connect, disconnect };
}
