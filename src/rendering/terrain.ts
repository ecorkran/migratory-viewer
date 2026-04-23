import * as THREE from 'three/webgpu';
import { uniform, normalWorld, smoothstep, mix } from 'three/tsl';
import config from '../config.ts';
import type { BiomeConfig } from '../config.ts';
import type { TerrainGrid } from '../types.ts';

/** Handle returned by createTerrainMaterial — hides uniform internals. */
export interface TerrainMaterialHandle {
  material: THREE.MeshStandardNodeMaterial;
  /** Update all biome uniforms in-place. No shader recompile. */
  updateBiome: (biome: BiomeConfig) => void;
}

/**
 * Build a MeshStandardNodeMaterial with a TSL slope-blend node graph.
 * All BiomeConfig fields are backed by uniform() nodes — runtime-updatable
 * without shader recompile via updateBiome().
 */
export function createTerrainMaterial(biome: BiomeConfig): TerrainMaterialHandle {
  const uSurfaceColor    = uniform(new THREE.Color(biome.surfaceColor));
  const uCliffColor      = uniform(new THREE.Color(biome.cliffColor));
  const uSurfaceRoughness = uniform(biome.surfaceRoughness);
  const uCliffRoughness  = uniform(biome.cliffRoughness);
  const uSurfaceMetalness = uniform(biome.surfaceMetalness);
  const uCliffMetalness  = uniform(biome.cliffMetalness);
  const uSlopeBlendLow   = uniform(biome.slopeBlendLow);
  const uSlopeBlendHigh  = uniform(biome.slopeBlendHigh);

  // normalWorld.y is 1.0 on horizontal, 0.0 on vertical cliff
  const blendFactor = smoothstep(uSlopeBlendLow, uSlopeBlendHigh, normalWorld.y);

  const material = new THREE.MeshStandardNodeMaterial();
  material.colorNode     = mix(uCliffColor,      uSurfaceColor,      blendFactor);
  material.roughnessNode = mix(uCliffRoughness,  uSurfaceRoughness,  blendFactor);
  material.metalnessNode = mix(uCliffMetalness,  uSurfaceMetalness,  blendFactor);

  function updateBiome(b: BiomeConfig): void {
    uSurfaceColor.value.set(b.surfaceColor);
    uCliffColor.value.set(b.cliffColor);
    uSurfaceRoughness.value = b.surfaceRoughness;
    uCliffRoughness.value   = b.cliffRoughness;
    uSurfaceMetalness.value = b.surfaceMetalness;
    uCliffMetalness.value   = b.cliffMetalness;
    uSlopeBlendLow.value    = b.slopeBlendLow;
    uSlopeBlendHigh.value   = b.slopeBlendHigh;
  }

  return { material, updateBiome };
}

// Module-level handle so callers can call updateBiome after mesh creation.
let terrainMaterialHandle: TerrainMaterialHandle | null = null;

/** Return the active terrain material handle, or null if not yet created. */
export function getTerrainMaterialHandle(): TerrainMaterialHandle | null {
  return terrainMaterialHandle;
}

/**
 * Create an empty terrain mesh (1×1 placeholder) added to the scene.
 * The geometry is replaced on the first render frame by either
 * `applyTerrainToMesh` (when TERRAIN has arrived) or `applyFlatPlane`.
 */
export function createTerrainMesh(scene: THREE.Scene): THREE.Mesh {
  const geometry = new THREE.PlaneGeometry(1, 1);
  geometry.rotateX(-Math.PI / 2);
  terrainMaterialHandle = createTerrainMaterial(config.biomeConfig);
  const mesh = new THREE.Mesh(geometry, terrainMaterialHandle.material);
  scene.add(mesh);
  return mesh;
}

/**
 * Rebuild the terrain mesh geometry from an elevation grid.
 * Disposes the prior geometry to avoid GPU leaks.
 * PlaneGeometry vertices are row-major, left-to-right, top-to-bottom (in local XY).
 * After rotateX(-π/2), local Y maps to world -Z, so row 0 is at minimum world Z.
 */
export function applyTerrainToMesh(mesh: THREE.Mesh, grid: TerrainGrid): void {
  const { rows, cols, resolution, originX, originY, elevation } = grid;
  const geometry = new THREE.PlaneGeometry(
    cols * resolution,
    rows * resolution,
    cols - 1,
    rows - 1,
  );
  geometry.rotateX(-Math.PI / 2);

  const position = geometry.attributes['position'] as THREE.BufferAttribute;
  const vertCount = rows * cols;
  // After rotateX, PlaneGeometry vertex order is row-major top→bottom in local Y.
  // Local Y becomes world -Z after the rotation, so row 0 is at minimum world Z.
  for (let i = 0; i < vertCount; i++) {
    const r = Math.floor(i / cols);
    const c = i % cols;
    position.setY(i, elevation[r * cols + c]);
  }
  position.needsUpdate = true;
  geometry.computeVertexNormals();

  mesh.geometry.dispose();
  mesh.geometry = geometry;
  mesh.position.set(originX + (cols * resolution) / 2, 0, originY + (rows * resolution) / 2);
}

/**
 * Apply a world-sized flat plane to the mesh (no-TERRAIN fallback).
 * Preserves the pre-slice-102 visual: a single flat ground plane across the full world.
 */
export function applyFlatPlane(mesh: THREE.Mesh, worldWidth: number, worldHeight: number): void {
  const geometry = new THREE.PlaneGeometry(worldWidth, worldHeight);
  geometry.rotateX(-Math.PI / 2);
  geometry.computeVertexNormals();
  mesh.geometry.dispose();
  mesh.geometry = geometry;
  mesh.position.set(worldWidth / 2, 0, worldHeight / 2);
}

/**
 * Bilinear interpolation of terrain elevation at world-space (x, z).
 * Returns 0 when grid is null (flat-plane fallback until TERRAIN arrives).
 * Wire originY maps to world Z; elevation maps to world Y.
 */
export function getTerrainHeight(grid: TerrainGrid | null, x: number, z: number): number {
  if (grid === null) return 0;
  const { rows, cols, resolution, originX, originY, elevation } = grid;

  const fr = Math.max(0, Math.min(rows - 1, (z - originY) / resolution - 0.5));
  const fc = Math.max(0, Math.min(cols - 1, (x - originX) / resolution - 0.5));

  const r0 = Math.floor(fr);
  const c0 = Math.floor(fc);
  const r1 = Math.min(r0 + 1, rows - 1);
  const c1 = Math.min(c0 + 1, cols - 1);
  const dr = fr - r0;
  const dc = fc - c0;

  const e00 = elevation[r0 * cols + c0];
  const e01 = elevation[r0 * cols + c1];
  const e10 = elevation[r1 * cols + c0];
  const e11 = elevation[r1 * cols + c1];

  return e00 * (1 - dr) * (1 - dc) +
         e01 * (1 - dr) * dc +
         e10 * dr * (1 - dc) +
         e11 * dr * dc;
}
