import * as THREE from 'three/webgpu';
import config from '../config.ts';

/** Create a flat ground plane in the XZ plane, sized to world bounds. */
export function createTerrain(scene: THREE.Scene, worldWidth: number, worldHeight: number): THREE.Mesh {
  const geometry = buildPlaneGeometry(worldWidth, worldHeight);
  const material = new THREE.MeshLambertMaterial({ color: config.groundColor });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.set(worldWidth / 2, 0, worldHeight / 2);
  scene.add(mesh);
  return mesh;
}

/** Resize the terrain plane to new world bounds and recenter it. */
export function resizeTerrain(mesh: THREE.Mesh, worldWidth: number, worldHeight: number): void {
  mesh.geometry.dispose();
  mesh.geometry = buildPlaneGeometry(worldWidth, worldHeight);
  mesh.position.set(worldWidth / 2, 0, worldHeight / 2);
}

function buildPlaneGeometry(worldWidth: number, worldHeight: number): THREE.PlaneGeometry {
  const geometry = new THREE.PlaneGeometry(worldWidth, worldHeight);
  geometry.rotateX(-Math.PI / 2);
  return geometry;
}
