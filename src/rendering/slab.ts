import * as THREE from 'three/webgpu';
import { uniform } from 'three/tsl';
import type { BiomeConfig } from '../config.ts';

/**
 * Handle returned by createSlab.
 * Consumers must re-read handle.material after calling updateBiome() if cliff
 * texture paths changed — the material may be replaced.
 */
export interface SlabHandle {
  group: THREE.Group;
  /** Rebuild slab geometry to new world dimensions. Disposes old geometries. */
  resize: (worldWidth: number, worldHeight: number) => void;
  /** Update slab material cliff color/roughness/metalness. Rebuilds material if cliff texture paths changed. */
  updateBiome: (biome: BiomeConfig) => void;
}

/**
 * Build five PlaneGeometry meshes (4 walls + bottom) forming the geological
 * slab depth beneath the terrain. Returns a SlabHandle for resize and biome updates.
 *
 * World coordinate convention: X ∈ [0, worldWidth], Z ∈ [0, worldHeight], Y = 0 at surface.
 * Slab extends from Y = 0 down to Y = -slabDepth.
 */
export function createSlab(
  scene: THREE.Scene,
  biome: BiomeConfig,
  slabDepth: number,
): SlabHandle {
  // Initial world dimensions — updated on first TERRAIN/snapshot message.
  const INIT_WIDTH  = 1000;
  const INIT_HEIGHT = 1000;

  const group = new THREE.Group();
  scene.add(group);

  // Uniform nodes — closed over so updateBiome can mutate .value in place.
  const cliffColorVal   = new THREE.Color(biome.cliffColor);
  const uCliffColor     = uniform(cliffColorVal);
  const uCliffRoughness = uniform(biome.cliffRoughness);
  const uCliffMetalness = uniform(biome.cliffMetalness);

  const slabMaterial = new THREE.MeshStandardNodeMaterial();
  slabMaterial.colorNode     = uCliffColor;
  slabMaterial.roughnessNode = uCliffRoughness;
  slabMaterial.metalnessNode = uCliffMetalness;

  // Mutable mesh references so resize() can dispose and rebuild.
  let meshNorth: THREE.Mesh;
  let meshSouth: THREE.Mesh;
  let meshEast:  THREE.Mesh;
  let meshWest:  THREE.Mesh;
  let meshBottom: THREE.Mesh;

  function buildMeshes(worldWidth: number, worldHeight: number): void {
    const mat = slabMaterial;

    // North wall: faces +Z (front face is toward +Z)
    const geoNorth = new THREE.PlaneGeometry(worldWidth, slabDepth);
    meshNorth = new THREE.Mesh(geoNorth, mat);
    meshNorth.position.set(worldWidth / 2, -slabDepth / 2, 0);
    // Default PlaneGeometry faces -Z; rotate 180° around Y to face +Z
    meshNorth.rotation.y = Math.PI;

    // South wall: faces -Z
    const geoSouth = new THREE.PlaneGeometry(worldWidth, slabDepth);
    meshSouth = new THREE.Mesh(geoSouth, mat);
    meshSouth.position.set(worldWidth / 2, -slabDepth / 2, worldHeight);
    // Default PlaneGeometry faces -Z which is "outward" from the south edge

    // East wall: faces -X
    const geoEast = new THREE.PlaneGeometry(worldHeight, slabDepth);
    meshEast = new THREE.Mesh(geoEast, mat);
    meshEast.position.set(worldWidth, -slabDepth / 2, worldHeight / 2);
    // Rotate -90° around Y so the plane faces -X
    meshEast.rotation.y = -Math.PI / 2;

    // West wall: faces +X
    const geoWest = new THREE.PlaneGeometry(worldHeight, slabDepth);
    meshWest = new THREE.Mesh(geoWest, mat);
    meshWest.position.set(0, -slabDepth / 2, worldHeight / 2);
    // Rotate +90° around Y so the plane faces +X
    meshWest.rotation.y = Math.PI / 2;

    // Bottom face: faces +Y (up toward viewer)
    const geoBottom = new THREE.PlaneGeometry(worldWidth, worldHeight);
    meshBottom = new THREE.Mesh(geoBottom, mat);
    meshBottom.position.set(worldWidth / 2, -slabDepth, worldHeight / 2);
    // Default PlaneGeometry is in XY plane facing -Z; rotate to lie flat facing +Y
    meshBottom.rotation.x = Math.PI / 2;

    group.add(meshNorth, meshSouth, meshEast, meshWest, meshBottom);
  }

  buildMeshes(INIT_WIDTH, INIT_HEIGHT);

  function resize(worldWidth: number, worldHeight: number): void {
    // Dispose old geometries and remove meshes from group.
    for (const mesh of [meshNorth, meshSouth, meshEast, meshWest, meshBottom]) {
      mesh.geometry.dispose();
      group.remove(mesh);
    }
    buildMeshes(worldWidth, worldHeight);
  }

  function updateBiome(b: BiomeConfig): void {
    cliffColorVal.set(b.cliffColor);
    uCliffRoughness.value = b.cliffRoughness;
    uCliffMetalness.value = b.cliffMetalness;
  }

  return { group, resize, updateBiome };
}
