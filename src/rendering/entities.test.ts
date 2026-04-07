import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Three.js's `three/webgpu` entry pulls in WebGPU + WebGL backends that won't
 * load under Node. We mock the module surface that `entities.ts` actually uses:
 * `Object3D`, `Color`, `ConeGeometry`, `MeshLambertMaterial`, `InstancedMesh`,
 * and `Scene`. Just enough behavior to test the update logic.
 */
vi.mock('three/webgpu', () => {
  class Vector3 {
    x = 0;
    y = 0;
    z = 0;
    set(x: number, y: number, z: number): this {
      this.x = x;
      this.y = y;
      this.z = z;
      return this;
    }
  }
  class Euler {
    x = 0;
    y = 0;
    z = 0;
    set(x: number, y: number, z: number): this {
      this.x = x;
      this.y = y;
      this.z = z;
      return this;
    }
  }
  class Matrix4 {
    elements = new Array<number>(16).fill(0);
    copy(other: Matrix4): this {
      this.elements = [...other.elements];
      return this;
    }
  }
  class Object3D {
    position = new Vector3();
    rotation = new Euler();
    matrix = new Matrix4();
    updateMatrix(): void {
      // Encode position+rotation into matrix elements for test inspection.
      this.matrix.elements[12] = this.position.x;
      this.matrix.elements[13] = this.position.y;
      this.matrix.elements[14] = this.position.z;
      this.matrix.elements[15] = this.rotation.y;
    }
  }
  class Color {
    value = 0;
    set(hex: number): this {
      this.value = hex;
      return this;
    }
  }
  class ConeGeometry {
    rotateX(): this {
      return this;
    }
  }
  class MeshLambertMaterial {}
  class InstancedMesh {
    geometry: ConeGeometry;
    material: MeshLambertMaterial;
    count: number;
    capacity: number;
    matrices: Matrix4[];
    colors: number[];
    instanceMatrix = { needsUpdate: false };
    instanceColor: { needsUpdate: boolean } | null = { needsUpdate: false };
    constructor(geometry: ConeGeometry, material: MeshLambertMaterial, count: number) {
      this.geometry = geometry;
      this.material = material;
      this.count = count;
      this.capacity = count;
      this.matrices = Array.from({ length: count }, () => new Matrix4());
      this.colors = new Array<number>(count).fill(-1);
    }
    setMatrixAt(i: number, m: Matrix4): void {
      this.matrices[i].copy(m);
    }
    setColorAt(i: number, c: Color): void {
      this.colors[i] = c.value;
    }
  }
  class Scene {
    children: unknown[] = [];
    add(o: unknown): void {
      this.children.push(o);
    }
  }
  return { Object3D, Color, ConeGeometry, MeshLambertMaterial, InstancedMesh, Scene };
});

import * as THREE from 'three/webgpu';
import { createEntities, updateEntities, __resetEntityRenderState } from './entities';
import { createInitialViewerState } from '../types';

beforeEach(() => {
  __resetEntityRenderState();
});

describe('createEntities', () => {
  it('creates an InstancedMesh at maxEntityCount capacity with count=0', () => {
    const scene = new THREE.Scene();
    const mesh = createEntities(scene) as unknown as { count: number; capacity: number };
    expect(mesh.count).toBe(0);
    expect(mesh.capacity).toBeGreaterThan(0);
  });
});

describe('updateEntities', () => {
  it('is a no-op (count=0) when positions are null', () => {
    const scene = new THREE.Scene();
    const mesh = createEntities(scene);
    const state = createInitialViewerState();
    updateEntities(mesh, state);
    expect(mesh.count).toBe(0);
  });

  it('writes N matrices and sets mesh.count when given N entities', () => {
    const scene = new THREE.Scene();
    const mesh = createEntities(scene);
    const state = createInitialViewerState();
    state.entityCount = 3;
    state.positions = new Float64Array([10, 20, 30, 40, 50, 60]);
    state.velocities = new Float64Array([1, 0, 0, 1, -1, 0]);
    state.profileIndices = new Int32Array([0, 1, 2]);
    updateEntities(mesh, state);
    expect(mesh.count).toBe(3);
    const m = mesh as unknown as { matrices: { elements: number[] }[] };
    // Position mapping: server (x, y) → viewer (x, 0, z=y)
    expect(m.matrices[0].elements[12]).toBe(10); // x
    expect(m.matrices[0].elements[13]).toBe(0); // y (always 0 in this slice)
    expect(m.matrices[0].elements[14]).toBe(20); // z = server y
    expect(m.matrices[2].elements[12]).toBe(50);
    expect(m.matrices[2].elements[14]).toBe(60);
  });

  it('rotation formula matches -atan2(vy, vx) + π/2', () => {
    const scene = new THREE.Scene();
    const mesh = createEntities(scene);
    const state = createInitialViewerState();
    state.entityCount = 1;
    state.positions = new Float64Array([0, 0]);
    state.velocities = new Float64Array([1, 0]); // facing +x
    state.profileIndices = new Int32Array([0]);
    updateEntities(mesh, state);
    const expected = -Math.atan2(0, 1) + Math.PI / 2;
    const m = mesh as unknown as { matrices: { elements: number[] }[] };
    expect(m.matrices[0].elements[15]).toBeCloseTo(expected);
  });

  it('refreshes colors when entity count changes (snapshot), not on subsequent same-count calls', () => {
    const scene = new THREE.Scene();
    const mesh = createEntities(scene);
    const state = createInitialViewerState();
    state.entityCount = 2;
    state.positions = new Float64Array([0, 0, 0, 0]);
    state.velocities = new Float64Array([0, 0, 0, 0]);
    state.profileIndices = new Int32Array([0, 1]);

    updateEntities(mesh, state);
    const m = mesh as unknown as { colors: number[] };
    expect(m.colors[0]).toBeGreaterThanOrEqual(0);
    expect(m.colors[1]).toBeGreaterThanOrEqual(0);

    // Sentinel: overwrite colors, then call updateEntities with the SAME count.
    // The update path should NOT touch colors (no snapshot).
    m.colors[0] = -42;
    updateEntities(mesh, state);
    expect(m.colors[0]).toBe(-42);

    // Now change count → triggers color refresh.
    state.entityCount = 1;
    updateEntities(mesh, state);
    expect(m.colors[0]).not.toBe(-42);
  });
});
