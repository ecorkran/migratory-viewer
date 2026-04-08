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

  /** Cone geometry parameters. Radius/height are expressed as a fraction of world width
   * so cones remain visible at any world scale. Recomputed whenever world bounds change. */
  coneRadiusRatio: number;
  coneHeightRatio: number;
  coneSegments: number;

  /** Hex color palette indexed by profile. */
  profileColors: number[];

  /** Ground plane color (hex). */
  groundColor: number;

  /** Scene background color (hex). */
  backgroundColor: number;

  /** Lighting configuration. */
  hemisphereSkyColor: number;
  hemisphereGroundColor: number;
  hemisphereIntensity: number;
  directionalColor: number;
  directionalIntensity: number;
  directionalPosition: [number, number, number];

  /** Camera zoom limits. */
  zoomMin: number;
  zoomMax: number;
}

const config: ViewerConfig = {
  serverUrl: import.meta.env.VITE_SERVER_URL as string || 'ws://localhost:8765',

  worldWidth: 1000,
  worldHeight: 1000,

  defaultEntityCount: 500,
  maxEntityCount: 200_000,

  coneRadiusRatio: 0.003,
  coneHeightRatio: 0.012,
  coneSegments: 5,

  profileColors: [0x5dcaa5, 0xf09595, 0x7ab8f5, 0xe8c36a, 0xc490e4],

  groundColor: 0x2a3a2a,
  backgroundColor: 0x1a1a1a,

  hemisphereSkyColor: 0x87ceeb,
  hemisphereGroundColor: 0x444444,
  hemisphereIntensity: 1.5,
  directionalColor: 0xffffff,
  directionalIntensity: Math.PI,
  directionalPosition: [300, 500, 200],

  zoomMin: 0.1,
  zoomMax: 10,
};

export default config;
