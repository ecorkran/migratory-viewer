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
import { applySnapshot, applyStateUpdate } from '../state';
import { parseMessage } from '../protocol/deserialize';
import { MessageType } from '../protocol/types';

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
    const parsed = parseMessage(event.data);
    if (parsed === null) return;
    if (parsed.type === MessageType.SNAPSHOT) {
      applySnapshot(viewerState, parsed);
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
    // Debug: per-tick parsed-payload log. Uncomment to verify the server is
    // delivering changing positions/velocities for STATE_UPDATE frames.
    // if ((parsed.tick % 60) === 0) {
    //   console.log(
    //     '[debug:net] update tick', parsed.tick,
    //     'count', parsed.entityCount,
    //     'pos[0..3]', parsed.positions[0], parsed.positions[1], parsed.positions[2], parsed.positions[3],
    //     'vel[0..3]', parsed.velocities[0], parsed.velocities[1], parsed.velocities[2], parsed.velocities[3],
    //   );
    // }
    applyStateUpdate(viewerState, parsed);
  }

  function connect(url: string): void {
    currentUrl = url;
    intentionallyClosed = false;
    viewerState.connectionStatus = 'connecting';
    ws = new WebSocket(url);
    ws.binaryType = 'arraybuffer';

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
    viewerState.connectionStatus = 'disconnected';
  }

  return { connect, disconnect };
}
