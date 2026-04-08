/** Connection states for the WebSocket lifecycle (used by slice 101). */
export type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'reconnecting';

/** World bounds dimensions. */
export interface WorldBounds {
  width: number;
  height: number;
}

/**
 * Central viewer state. Sole writer is `src/net/connection.ts` (via the
 * mutation helpers in `src/state.ts`); all other modules are read-only consumers.
 */
export interface ViewerState {
  /** World width in simulation units (from latest snapshot). */
  worldWidth: number;
  /** World height in simulation units (from latest snapshot). */
  worldHeight: number;
  /** Number of entities in the latest snapshot. */
  entityCount: number;
  /** Per-entity profile indices. Null until first snapshot. */
  profileIndices: Int32Array | null;
  /** Interleaved (x, y) positions, length = entityCount * 2. Null until first snapshot. */
  positions: Float64Array | null;
  /** Interleaved (vx, vy) velocities, length = entityCount * 2. Null until first snapshot. */
  velocities: Float64Array | null;
  /** Server tick of the most recently applied message. */
  currentTick: number;
  /** Current connection state. */
  connectionStatus: ConnectionStatus;
}

/** Build a fresh `ViewerState` with all dynamic data cleared. */
export function createInitialViewerState(): ViewerState {
  return {
    worldWidth: 0,
    worldHeight: 0,
    entityCount: 0,
    profileIndices: null,
    positions: null,
    velocities: null,
    currentTick: 0,
    connectionStatus: 'disconnected',
  };
}
