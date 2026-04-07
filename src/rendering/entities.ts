import * as THREE from 'three/webgpu';
import config from '../config.ts';
import type { ViewerState } from '../types.ts';

const dummy = new THREE.Object3D();
const tmpColor = new THREE.Color();

/**
 * Entity count from the most recently applied snapshot. A change here is the
 * trigger for refreshing per-instance colors (profile palette).
 */
let lastAppliedCount = -1;

/**
 * Create the entity InstancedMesh at full capacity (`config.maxEntityCount`).
 * `mesh.count` starts at 0 so nothing renders until the first snapshot arrives
 * via the WebSocket consumer.
 */
export function createEntities(scene: THREE.Scene): THREE.InstancedMesh {
  const geometry = new THREE.ConeGeometry(
    config.coneRadius,
    config.coneHeight,
    config.coneSegments,
  );
  // Rotate so the point faces +Z direction (forward)
  geometry.rotateX(Math.PI / 2);

  const material = new THREE.MeshLambertMaterial();
  const mesh = new THREE.InstancedMesh(geometry, material, config.maxEntityCount);
  mesh.count = 0;
  scene.add(mesh);
  return mesh;
}

/**
 * Sync the InstancedMesh with the current `ViewerState`. Reads only — no state
 * mutation. Maps server 2D `(x, y)` to viewer 3D `(x, 0, z=y)`.
 */
export function updateEntities(mesh: THREE.InstancedMesh, state: ViewerState): void {
  if (state.positions === null || state.velocities === null || state.entityCount === 0) {
    mesh.count = 0;
    return;
  }
  const { entityCount, positions, velocities, profileIndices } = state;

  for (let i = 0; i < entityCount; i++) {
    const x = positions[i * 2];
    const y = positions[i * 2 + 1];
    const vx = velocities[i * 2];
    const vy = velocities[i * 2 + 1];

    dummy.position.set(x, 0, y);
    dummy.rotation.set(0, -Math.atan2(vy, vx) + Math.PI / 2, 0);
    dummy.updateMatrix();
    mesh.setMatrixAt(i, dummy.matrix);
  }
  mesh.count = entityCount;
  mesh.instanceMatrix.needsUpdate = true;

  // Refresh per-instance colors only when the entity count changes — that
  // signals a fresh snapshot, not a per-tick state update.
  if (entityCount !== lastAppliedCount && profileIndices !== null) {
    const palette = config.profileColors;
    for (let i = 0; i < entityCount; i++) {
      const profile = profileIndices[i];
      tmpColor.set(palette[profile % palette.length]);
      mesh.setColorAt(i, tmpColor);
    }
    if (mesh.instanceColor !== null) {
      mesh.instanceColor.needsUpdate = true;
    }
    lastAppliedCount = entityCount;
  }
}

/** Test-only: reset module-level color refresh tracker. */
export function __resetEntityRenderState(): void {
  lastAppliedCount = -1;
}
