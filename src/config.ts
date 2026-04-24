/** Per-population visual configuration. */
export interface ProfileConfig {
  /** Hex color. */
  color: number;
  /** Absolute cone height in world units. */
  coneSize: number;
}

/** PBR biome appearance — controls terrain slope-blend shader and slab material. */
export interface BiomeConfig {
  /** Hex color for near-flat terrain (vegetation, soil). */
  surfaceColor: number;
  /** Hex color for steep cliff faces (rock, bare earth). */
  cliffColor: number;
  /** PBR roughness for flat surface (0 = mirror, 1 = fully rough). */
  surfaceRoughness: number;
  /** PBR roughness for cliff faces. */
  cliffRoughness: number;
  /** PBR metalness for flat surface (0 = dielectric, 1 = metal). */
  surfaceMetalness: number;
  /** PBR metalness for cliff faces. */
  cliffMetalness: number;
  /** normalWorld.y ≤ this → full cliff appearance. */
  slopeBlendLow: number;
  /** normalWorld.y ≥ this → full surface appearance. */
  slopeBlendHigh: number;
  /** Triplanar tiling scale (larger = tighter tiling). Applies to both diffuse and normal maps. */
  textureScale: number;
  /** Root-relative URL for the flat-surface diffuse texture. Optional — omit for solid color. */
  surfaceTexturePath?: string;
  /** Root-relative URL for the cliff diffuse texture. Optional — omit for solid color. */
  cliffTexturePath?: string;
  /** Root-relative URL for the flat-surface normal map. Optional — requires cliffNormalPath to activate. */
  surfaceNormalPath?: string;
  /** Root-relative URL for the cliff normal map. Optional — requires surfaceNormalPath to activate. */
  cliffNormalPath?: string;
}

/** Default alien vegetation biome matching the concept art reference. */
export const DEFAULT_BIOME: BiomeConfig = {
  surfaceColor:     0x1a3d1a,
  cliffColor:       0x231810,
  surfaceRoughness: 0.92,
  cliffRoughness:   0.75,
  surfaceMetalness: 0.0,
  cliffMetalness:   0.05,
  slopeBlendLow:    0.65,
  slopeBlendHigh:   0.90,
  textureScale:     0.05,
  surfaceTexturePath: '/textures/biomes/default/surface-diffuse.jpg',
  cliffTexturePath:   '/textures/biomes/default/cliff-diffuse.jpg',
  surfaceNormalPath:  '/textures/biomes/default/surface-normal.jpg',
  cliffNormalPath:    '/textures/biomes/default/cliff-normal.jpg',
};

export interface ViewerConfig {
  /** WebSocket endpoint (used by slice 101). */
  serverUrl: string;

  /** World dimensions in simulation units. */
  worldWidth: number;
  worldHeight: number;

  /** Number of test entities to render (test mode only). */
  defaultEntityCount: number;

  /** Hard cap on entity count accepted from the wire protocol. Parser rejects messages above this. */
  maxEntityCount: number;

  /** Cone shape parameters. Ratios define aspect; coneSize per profile sets absolute scale. */
  coneRadiusRatio: number;
  coneHeightRatio: number;
  coneSegments: number;

  /** Per-population color and size configuration, indexed by profile. */
  profileConfig: ProfileConfig[];

  /** Biome appearance — drives terrain slope-blend shader and slab material. */
  biomeConfig: BiomeConfig;

  /** Scene background color (hex). */
  backgroundColor: number;

  /** Lighting configuration. */
  hemisphereSkyColor: number;
  hemisphereGroundColor: number;
  hemisphereIntensity: number;
  directionalColor: number;
  directionalIntensity: number;
  directionalPosition: [number, number, number];

  /** Maximum number of terrain cells accepted from the wire protocol (rows × cols cap). */
  terrainMaxCells: number;

  /** Vertical offset for entity placement as a fraction of cone height (keeps cones above surface). */
  entityVerticalOffsetRatio: number;

  /** Geological slab depth below terrain surface in world units. */
  slabDepth: number;

  /** Camera zoom limits. */
  zoomMin: number;
  zoomMax: number;

  // debug: disable camera zoom/pan clamps (pan outside world, zoom past world-fit)
  allowOutOfBoundsView: boolean;

  /** Perspective camera settings. */
  perspectiveFov: number;
  defaultPitch: number;
  defaultYaw: number;
  pitchMin: number;
  pitchMax: number;
  dollyMinRatio: number;
  dollyMaxRatio: number;
  dollyDefaultRatio: number;
  modeTransitionSeconds: number;
}

/** Baseline cone height in world units. Population sizes are derived from this. */
const BASE_CONE_SIZE = 4.8;

const config: ViewerConfig = {
  serverUrl: import.meta.env.VITE_SERVER_URL as string || 'ws://localhost:8765',

  worldWidth: 1000,
  worldHeight: 1000,

  defaultEntityCount: 500,
  maxEntityCount: 200_000,

  terrainMaxCells: 4_000_000,
  entityVerticalOffsetRatio: 0.5,

  coneRadiusRatio: 0.003,
  coneHeightRatio: 0.012,
  coneSegments: 5,

  profileConfig: [
    { color: 0x5dcaa5, coneSize: BASE_CONE_SIZE },
    { color: 0xf09595, coneSize: BASE_CONE_SIZE * 0.70 },  // 70%
    { color: 0x7ab8f5, coneSize: BASE_CONE_SIZE * 1.30 },  // 130%
    { color: 0xe8c36a, coneSize: BASE_CONE_SIZE },
    { color: 0xc490e4, coneSize: BASE_CONE_SIZE },
  ],

  biomeConfig: DEFAULT_BIOME,
  slabDepth: 100,
  backgroundColor: 0x0a0a0a,

  hemisphereSkyColor: 0x1a1a4e,      // deep alien blue-purple sky
  hemisphereGroundColor: 0x0a1a0a,   // near-black green ground bounce
  hemisphereIntensity: 1.1,
  directionalColor: 0xfff5d0,        // warm amber-white key light
  directionalIntensity: Math.PI * 1.5,
  directionalPosition: [-400, 600, 600] as [number, number, number],

  zoomMin: 0.1,
  zoomMax: 10,

  // debug: disable camera zoom/pan clamps (pan outside world, zoom past world-fit)
  allowOutOfBoundsView: false,

  perspectiveFov: 50,
  defaultPitch: 24,
  defaultYaw: 0,
  pitchMin: 15,
  pitchMax: 85,
  dollyMinRatio: 0.05,
  dollyMaxRatio: 3.0,
  dollyDefaultRatio: 0.72,
  modeTransitionSeconds: 0.5,
};

export default config;
