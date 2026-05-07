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
 * Build a canonical cone geometry with height=coneHeightRatio and
 * radius=coneRadiusRatio (unit-scale). Per-instance scale sets absolute size.
 */
function buildConeGeometry(): THREE.ConeGeometry {
  const geometry = new THREE.ConeGeometry(
    config.coneRadiusRatio,
    config.coneHeightRatio,
    config.coneSegments,
  );
  geometry.rotateX(Math.PI / 2);
  return geometry;
}

/**
 * Create the entity InstancedMesh at full capacity (`config.maxEntityCount`).
 * `mesh.count` starts at 0 so nothing renders until the first snapshot arrives.
 */
export function createEntities(scene: THREE.Scene): THREE.InstancedMesh {
  const geometry = buildConeGeometry();
  const material = new THREE.MeshLambertMaterial();
  const mesh = new THREE.InstancedMesh(geometry, material, config.maxEntityCount);
  mesh.count = 0;
  scene.add(mesh);
  return mesh;
}

/**
 * Sync the InstancedMesh with the current `ViewerState`. Reads only — no state
 * mutation. Maps server 2D `(x, y)` to viewer 3D `(x, terrain_h, z=y)`.
 * Each entity is scaled to the absolute coneSize from its population's ProfileConfig.
 */
export function updateEntities(mesh: THREE.InstancedMesh, state: ViewerState): void {
  if (state.positions === null || state.velocities === null || state.entityCount === 0) {
    mesh.count = 0;
    return;
  }
  const { entityCount, positions, velocities, profileIndices } = state;
  const palette = config.profileConfig;

  for (let i = 0; i < entityCount; i++) {
    const x = positions[i * 2];
    const y = positions[i * 2 + 1];
    const vx = velocities[i * 2];
    const vy = velocities[i * 2 + 1];

    const profile = profileIndices !== null ? profileIndices[i] % palette.length : 0;
    const coneSize = palette[profile].coneSize;
    // Scale ratio: canonical geometry has height=coneHeightRatio; target=coneSize
    const scale = coneSize / config.coneHeightRatio;
    const verticalOffset = coneSize * config.entityVerticalOffsetRatio;

    const h = state.entityHeights !== null ? state.entityHeights[i] : 0;
    dummy.position.set(x, h + verticalOffset, y);
    dummy.rotation.set(0, -Math.atan2(vy, vx) + Math.PI / 2, 0);
    dummy.scale.set(scale, scale, scale);
    dummy.updateMatrix();
    mesh.setMatrixAt(i, dummy.matrix);
  }
  mesh.count = entityCount;
  mesh.instanceMatrix.needsUpdate = true;

  // Refresh per-instance colors only when the entity count changes — that
  // signals a fresh snapshot, not a per-tick state update.
  if (entityCount !== lastAppliedCount && profileIndices !== null) {
    for (let i = 0; i < entityCount; i++) {
      const profile = profileIndices[i] % palette.length;
      tmpColor.set(palette[profile].color);
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
