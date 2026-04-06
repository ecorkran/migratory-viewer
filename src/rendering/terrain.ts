import * as THREE from 'three/webgpu';
import config from '../config.ts';

/** Create a flat ground plane in the XZ plane, sized to world bounds. */
export function createTerrain(scene: THREE.Scene, worldWidth: number, worldHeight: number): THREE.Mesh {
  const geometry = new THREE.PlaneGeometry(worldWidth, worldHeight);
  geometry.rotateX(-Math.PI / 2);

  const material = new THREE.MeshLambertMaterial({ color: config.groundColor });
  const mesh = new THREE.Mesh(geometry, material);

  // Center the plane under the camera's initial view
  mesh.position.set(worldWidth / 2, 0, worldHeight / 2);

  scene.add(mesh);
  return mesh;
}
