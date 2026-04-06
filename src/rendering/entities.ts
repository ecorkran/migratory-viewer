import * as THREE from 'three/webgpu';
import config from '../config.ts';

const dummy = new THREE.Object3D();

/** Create an InstancedMesh with test entities at random positions. */
export function createEntities(scene: THREE.Scene): THREE.InstancedMesh {
  const geometry = new THREE.ConeGeometry(
    config.coneRadius,
    config.coneHeight,
    config.coneSegments,
  );
  // Rotate so the point faces +Z direction (forward)
  geometry.rotateX(Math.PI / 2);

  const material = new THREE.MeshLambertMaterial();
  const count = config.defaultEntityCount;
  const mesh = new THREE.InstancedMesh(geometry, material, count);

  // Generate random test data and populate instance matrices + colors
  const color = new THREE.Color();

  for (let i = 0; i < count; i++) {
    // Random position within world bounds
    const x = Math.random() * config.worldWidth;
    const z = Math.random() * config.worldHeight;

    // Random velocity direction (for rotation only)
    const vx = Math.random() * 2 - 1;
    const vz = Math.random() * 2 - 1;

    // Position on the ground plane
    dummy.position.set(x, 0, z);

    // Rotate cone to point in velocity direction
    dummy.rotation.set(0, -Math.atan2(vz, vx) + Math.PI / 2, 0);

    dummy.updateMatrix();
    mesh.setMatrixAt(i, dummy.matrix);

    // Profile-based coloring
    const profileIndex = i % config.profileColors.length;
    color.set(config.profileColors[profileIndex]);
    mesh.setColorAt(i, color);
  }

  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) {
    mesh.instanceColor.needsUpdate = true;
  }

  scene.add(mesh);
  return mesh;
}

/** Update entity positions/velocities from typed arrays. Used by slice 101. */
export function updateEntities(
  _positions: Float64Array,
  _velocities: Float64Array,
): void {
  // no-op until slice 101
}
