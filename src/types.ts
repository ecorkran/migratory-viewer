/** Connection states for the WebSocket lifecycle (used by slice 101). */
export type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'reconnecting';

/** Elevation grid received from the server via TERRAIN (0x03). Wire originY maps to world Z. */
export interface TerrainGrid {
  rows: number;
  cols: number;
  resolution: number;
  originX: number;
  /** Wire name; maps to world Z in Three.js scene space. */
  originY: number;
  elevation: Float64Array;
}

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
  positions: Float32Array | Float64Array | null;
  /** Interleaved (vx, vy) velocities, length = entityCount * 2. Null until first snapshot. */
  velocities: Float32Array | Float64Array | null;
  /** Server tick of the most recently applied message. */
  currentTick: number;
  /** Current connection state. */
  connectionStatus: ConnectionStatus;
  /** Terrain elevation grid from the latest TERRAIN message, or null if none received. */
  terrain: TerrainGrid | null;
  /** Incremented each time a new TERRAIN message is applied; drives mesh rebuild in the render loop. */
  terrainRevision: number;
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
    terrain: null,
    terrainRevision: 0,
  };
}
