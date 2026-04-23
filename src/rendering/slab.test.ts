import { describe, expect, it, vi } from 'vitest';

vi.mock('three/webgpu', () => {
  class Color {
    r = 0; g = 0; b = 0;
    constructor(hex?: number) {
      if (hex !== undefined) this.set(hex);
    }
    set(hex: number) {
      this.r = ((hex >> 16) & 0xff) / 255;
      this.g = ((hex >> 8)  & 0xff) / 255;
      this.b = (hex & 0xff) / 255;
      return this;
    }
  }

  class BufferGeometry {
    _disposed = false;
    dispose() { this._disposed = true; }
  }

  class PlaneGeometry extends BufferGeometry {
    width: number;
    height: number;
    constructor(w = 1, h = 1) {
      super();
      this.width  = w;
      this.height = h;
    }
    rotateX(_angle: number) { return this; }
  }

  class MeshStandardNodeMaterial {
    colorNode: unknown     = null;
    roughnessNode: unknown = null;
    metalnessNode: unknown = null;
    normalNode: unknown    = null;
  }

  class Object3D {
    position = { set: vi.fn() };
    rotation = { x: 0, y: 0, z: 0 };
  }

  class Mesh extends Object3D {
    geometry: BufferGeometry;
    material: MeshStandardNodeMaterial;
    constructor(geo?: BufferGeometry, mat?: MeshStandardNodeMaterial) {
      super();
      this.geometry = geo ?? new BufferGeometry();
      this.material = mat ?? new MeshStandardNodeMaterial();
    }
  }

  class Group {
    children: Object3D[] = [];
    add(...objects: Object3D[]) {
      this.children.push(...objects);
    }
    remove(obj: Object3D) {
      const idx = this.children.indexOf(obj);
      if (idx !== -1) this.children.splice(idx, 1);
    }
  }

  class Scene {
    children: Object3D[] = [];
    add(obj: Object3D) { this.children.push(obj); }
  }

  return { Color, BufferGeometry, PlaneGeometry, MeshStandardNodeMaterial, Mesh, Group, Object3D, Scene };
});

vi.mock('three/tsl', () => {
  const uniform = (val: unknown) => ({ value: val });
  return { uniform };
});

import { createSlab } from './slab';
import * as THREE from 'three/webgpu';
import type { BiomeConfig } from '../config';

function makeBiome(overrides?: Partial<BiomeConfig>): BiomeConfig {
  return {
    surfaceColor:     0x1a3d1a,
    cliffColor:       0x231810,
    surfaceRoughness: 0.92,
    cliffRoughness:   0.75,
    surfaceMetalness: 0.0,
    cliffMetalness:   0.05,
    slopeBlendLow:    0.65,
    slopeBlendHigh:   0.90,
    textureScale:     0.05,
    ...overrides,
  };
}

describe('slab', () => {
  it('adds a Group to the scene', () => {
    const scene = new THREE.Scene();
    createSlab(scene, makeBiome(), 30);
    expect(scene.children).toHaveLength(1);
    expect(scene.children[0]).toBeInstanceOf(THREE.Group);
  });

  it('group contains exactly 5 meshes', () => {
    const scene = new THREE.Scene();
    createSlab(scene, makeBiome(), 30);
    const group = scene.children[0] as THREE.Group;
    expect(group.children).toHaveLength(5);
    for (const child of group.children) {
      expect(child).toBeInstanceOf(THREE.Mesh);
    }
  });

  it('wall meshes are positioned at world-edge midpoints at Y = -slabDepth/2', () => {
    const scene   = new THREE.Scene();
    const W       = 1000;
    const H       = 1000;
    const depth   = 30;
    createSlab(scene, makeBiome(), depth);
    const group   = scene.children[0] as THREE.Group;
    const meshes  = group.children as THREE.Mesh[];

    // Collect the .set calls for all 5 meshes.
    // position.set is a vi.fn() from Object3D mock.
    const calls = meshes.map(m => (m.position.set as ReturnType<typeof vi.fn>).mock.calls[0]);

    // North wall: (W/2, -depth/2, 0)
    expect(calls).toContainEqual([W / 2, -depth / 2, 0]);
    // South wall: (W/2, -depth/2, H)
    expect(calls).toContainEqual([W / 2, -depth / 2, H]);
    // East wall:  (W,   -depth/2, H/2)
    expect(calls).toContainEqual([W,     -depth / 2, H / 2]);
    // West wall:  (0,   -depth/2, H/2)
    expect(calls).toContainEqual([0,     -depth / 2, H / 2]);
  });

  it('bottom mesh is positioned at (W/2, -slabDepth, H/2)', () => {
    const scene = new THREE.Scene();
    const W     = 1000;
    const H     = 1000;
    const depth = 30;
    createSlab(scene, makeBiome(), depth);
    const group  = scene.children[0] as THREE.Group;
    const meshes = group.children as THREE.Mesh[];

    const calls = meshes.map(m => (m.position.set as ReturnType<typeof vi.fn>).mock.calls[0]);
    expect(calls).toContainEqual([W / 2, -depth, H / 2]);
  });

  it('resize replaces mesh geometries and new positions reflect new dimensions', () => {
    const scene = new THREE.Scene();
    const depth = 30;
    const handle = createSlab(scene, makeBiome(), depth);
    const group  = scene.children[0] as THREE.Group;

    // Capture geometry references before resize.
    const oldGeos = (group.children as THREE.Mesh[]).map(m => m.geometry);

    const newW = 500;
    const newH = 800;
    handle.resize(newW, newH);

    // After resize the group should still have 5 meshes.
    expect(group.children).toHaveLength(5);

    // Old geometries must have been disposed.
    for (const geo of oldGeos) {
      expect((geo as unknown as { _disposed: boolean })._disposed).toBe(true);
    }

    // New positions must reflect the new dimensions.
    const calls = (group.children as THREE.Mesh[]).map(
      m => (m.position.set as ReturnType<typeof vi.fn>).mock.calls[0],
    );
    expect(calls).toContainEqual([newW / 2, -depth / 2, 0]);       // north
    expect(calls).toContainEqual([newW / 2, -depth / 2, newH]);    // south
    expect(calls).toContainEqual([newW,     -depth / 2, newH / 2]); // east
    expect(calls).toContainEqual([0,        -depth / 2, newH / 2]); // west
    expect(calls).toContainEqual([newW / 2, -depth,     newH / 2]); // bottom
  });

  it('updateBiome mutates uniform value fields on the slab material', () => {
    const scene    = new THREE.Scene();
    const handle   = createSlab(scene, makeBiome({ cliffColor: 0x000000, cliffRoughness: 0.5, cliffMetalness: 0.0 }), 30);
    const group    = scene.children[0] as THREE.Group;
    const material = (group.children[0] as THREE.Mesh).material as THREE.MeshStandardNodeMaterial;

    // colorNode.value is the Color instance used in the uniform; verify it changes.
    const colorBefore = (material.colorNode as unknown as { value: THREE.Color }).value;

    handle.updateBiome(makeBiome({ cliffColor: 0xff0000, cliffRoughness: 0.9, cliffMetalness: 0.1 }));

    // The same Color instance should have been mutated (set() called in place).
    const colorAfter = (material.colorNode as unknown as { value: THREE.Color }).value;
    expect(colorAfter).toBe(colorBefore); // same reference
    expect(colorAfter.r).toBeCloseTo(1.0); // 0xff0000 → r=1

    expect((material.roughnessNode as unknown as { value: number }).value).toBeCloseTo(0.9);
    expect((material.metalnessNode as unknown as { value: number }).value).toBeCloseTo(0.1);
  });
});
