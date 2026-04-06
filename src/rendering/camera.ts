import * as THREE from 'three/webgpu';

// Stub — full implementation in task 4.1
export function createCamera(_worldWidth: number, _worldHeight: number): THREE.OrthographicCamera {
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 1000);
  return camera;
}

export function updateCamera(): void {
  // no-op until task 4.1
}

export function handleResize(_camera: THREE.OrthographicCamera): void {
  // no-op until task 4.1
}
