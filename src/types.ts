/** Connection states for the WebSocket lifecycle (used by slice 101). */
export type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'reconnecting';

/** World bounds dimensions. */
export interface WorldBounds {
  width: number;
  height: number;
}
