/** Wire protocol message type bytes. */
export const MessageType = {
  SNAPSHOT: 0x01,
  STATE_UPDATE: 0x02,
  TERRAIN: 0x03,
  TERRAIN_CHUNK: 0x04,
  TERRAIN_HEADER: 0x05,
} as const;

export type MessageTypeValue = (typeof MessageType)[keyof typeof MessageType];

/** Terrain payload dtype, encoded in low 2 bits of the flags byte. */
export const TerrainDtype = {
  F32: 0,
  UINT16: 1,
  F64: 2,
} as const;

export type TerrainDtypeValue = (typeof TerrainDtype)[keyof typeof TerrainDtype];

/** Entity position/velocity wire dtype, encoded as a u8 flag byte in SNAPSHOT and STATE_UPDATE. */
export const PositionDtype = {
  F64: 0x00,
  F32: 0x01,
} as const;

export type PositionDtypeValue = (typeof PositionDtype)[keyof typeof PositionDtype];

/**
 * Migratory wire-protocol schema version. Bumped to 2 by slice 321 (header
 * alignment + zero-copy). Distinct from the mmap region's schema version,
 * which lives in slice 322 and is not consumed by the browser viewer.
 */
export const WIRE_SCHEMA_VERSION = 2 as const;

/** Terrain payload compression algorithm, encoded in flags bits 2-4. */
export const TerrainCompression = {
  NONE: 0,
  ZSTD: 1,
  LZ4: 2,
} as const;

export type TerrainCompressionValue =
  (typeof TerrainCompression)[keyof typeof TerrainCompression];

/** Parsed SNAPSHOT (0x01) message. Carries world bounds and full entity state. */
export interface ParsedSnapshot {
  type: typeof MessageType.SNAPSHOT;
  tick: number;
  worldWidth: number;
  worldHeight: number;
  entityCount: number;
  positions: Float32Array | Float64Array;
  velocities: Float32Array | Float64Array;
  profileIndices: Int32Array;
}

/** Parsed STATE_UPDATE (0x02) message. Per-tick position and velocity update. */
export interface ParsedStateUpdate {
  type: typeof MessageType.STATE_UPDATE;
  tick: number;
  entityCount: number;
  positions: Float32Array | Float64Array;
  velocities: Float32Array | Float64Array;
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
