/** Wire protocol message type bytes. */
export const MessageType = {
  SNAPSHOT: 0x01,
  STATE_UPDATE: 0x02,
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

/** Discriminated union of all parsed protocol messages. */
export type ParsedMessage = ParsedSnapshot | ParsedStateUpdate;
