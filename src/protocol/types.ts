/** Wire protocol message type bytes. */
export const MessageType = {
  SNAPSHOT: 0x01,
  STATE_UPDATE: 0x02,
  TERRAIN: 0x03,
} as const;

export type MessageTypeValue = (typeof MessageType)[keyof typeof MessageType];

/** Parsed SNAPSHOT (0x01) message. Carries world bounds and full entity state. */
export interface ParsedSnapshot {
  type: typeof MessageType.SNAPSHOT;
  tick: number;
  worldWidth: number;
  worldHeight: number;
  entityCount: number;
  positions: Float64Array;
  velocities: Float64Array;
  profileIndices: Int32Array;
}

/** Parsed STATE_UPDATE (0x02) message. Per-tick position and velocity update. */
export interface ParsedStateUpdate {
  type: typeof MessageType.STATE_UPDATE;
  tick: number;
  entityCount: number;
  positions: Float64Array;
  velocities: Float64Array;
}

/**
 * Parsed TERRAIN (0x03) message. Carries an elevation grid in server 2D space.
 * Wire `originY` and row indices map to world Z; `elevation` maps to world Y.
 */
export interface ParsedTerrain {
  type: typeof MessageType.TERRAIN;
  rows: number;
  cols: number;
  resolution: number;
  originX: number;
  /** Wire name; maps to world Z in Three.js scene space. */
  originY: number;
  elevation: Float64Array;
}

/** Discriminated union of all parsed protocol messages. */
export type ParsedMessage = ParsedSnapshot | ParsedStateUpdate | ParsedTerrain;
