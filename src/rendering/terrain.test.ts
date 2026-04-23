import { describe, expect, it, vi } from 'vitest';

/**
 * Three.js's `three/webgpu` entry pulls in WebGPU + WebGL backends that won't
 * load under Node. We mock only the geometry/mesh surface that terrain.ts uses.
 */
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

  class BufferAttribute {
    array: Float32Array;
    needsUpdate = false;
    constructor(array: Float32Array, _itemSize: number) {
      this.array = array;
    }
    setY(index: number, value: number) {
      this.array[index * 3 + 1] = value;
    }
  }

  class BufferGeometry {
    attributes: Record<string, BufferAttribute> = {};
    _disposed = false;
    dispose() { this._disposed = true; }
    computeVertexNormals() {}
    setAttribute(name: string, attr: BufferAttribute) {
      this.attributes[name] = attr;
    }
  }

  class PlaneGeometry extends BufferGeometry {
    constructor(_w?: number, _h?: number, _wSeg?: number, _hSeg?: number) {
      super();
      const wSeg = (_wSeg ?? 1);
      const hSeg = (_hSeg ?? 1);
      const vertCount = (wSeg + 1) * (hSeg + 1);
      const arr = new Float32Array(vertCount * 3);
      let idx = 0;
      for (let r = 0; r <= hSeg; r++) {
        for (let c = 0; c <= wSeg; c++) {
          arr[idx * 3] = c;
          arr[idx * 3 + 1] = 0;
          arr[idx * 3 + 2] = r;
          idx++;
        }
      }
      this.setAttribute('position', new BufferAttribute(arr, 3));
    }
    rotateX(_angle: number) { return this; }
  }

  class MeshLambertMaterial {}
  class MeshStandardNodeMaterial {
    colorNode: unknown = null;
    roughnessNode: unknown = null;
    metalnessNode: unknown = null;
  }
  class Object3D { position = { set: vi.fn() } }
  class Mesh extends Object3D {
    geometry: BufferGeometry;
    material: MeshLambertMaterial | MeshStandardNodeMaterial;
    constructor(geo?: BufferGeometry, mat?: MeshLambertMaterial | MeshStandardNodeMaterial) {
      super();
      this.geometry = geo ?? new BufferGeometry();
      this.material = mat ?? new MeshStandardNodeMaterial();
    }
  }
  class Scene { add = vi.fn() }

  return { Color, BufferAttribute, BufferGeometry, PlaneGeometry, MeshLambertMaterial, MeshStandardNodeMaterial, Mesh, Object3D, Scene };
});

/** Mock three/tsl — terrain.ts uses uniform, normalWorld, smoothstep, mix. */
vi.mock('three/tsl', () => {
  const makeNode = () => ({ value: null as unknown });
  const uniform = (val: unknown) => {
    const node = makeNode();
    node.value = val;
    return node;
  };
  const normalWorld = { y: {} };
  const smoothstep = () => ({});
  const mix = () => ({});
  return { uniform, normalWorld, smoothstep, mix };
});

vi.mock('../config.ts', () => ({
  default: {
    biomeConfig: {
      surfaceColor: 0x1a3d1a,
      cliffColor: 0x231810,
      surfaceRoughness: 0.92,
      cliffRoughness: 0.75,
      surfaceMetalness: 0.0,
      cliffMetalness: 0.05,
      slopeBlendLow: 0.55,
      slopeBlendHigh: 0.80,
    },
    terrainMaxCells: 4_000_000,
    entityVerticalOffsetRatio: 0.5,
  },
}));

import { getTerrainHeight, applyTerrainToMesh, createTerrainMesh, createTerrainMaterial } from './terrain';
import type { TerrainGrid } from '../types';
import type { BiomeConfig } from '../config';
import * as THREE from 'three/webgpu';

/** 3×3 fixture: elevation[row][col] = row*3+col so values 0..8. */
function makeGrid(overrides?: Partial<TerrainGrid>): TerrainGrid {
  return {
    rows: 3,
    cols: 3,
    resolution: 10,
    originX: 0,
    originY: 0,
    elevation: new Float64Array([0, 1, 2, 3, 4, 5, 6, 7, 8]),
    ...overrides,
  };
}

describe('getTerrainHeight', () => {
  it('null grid → 0 for any position', () => {
    expect(getTerrainHeight(null, 0, 0)).toBe(0);
    expect(getTerrainHeight(null, 999, -99)).toBe(0);
  });

  it('cell centers return stored elevation exactly', () => {
    const grid = makeGrid();
    // Cell center formula: originX + (col+0.5)*resolution, originY + (row+0.5)*resolution
    // Row 0, Col 0 center: x=5, z=5 → elevation[0]=0
    expect(getTerrainHeight(grid, 5, 5)).toBeCloseTo(0);
    // Row 0, Col 1 center: x=15, z=5 → elevation[1]=1
    expect(getTerrainHeight(grid, 15, 5)).toBeCloseTo(1);
    // Row 1, Col 2 center: x=25, z=15 → elevation[5]=5
    expect(getTerrainHeight(grid, 25, 15)).toBeCloseTo(5);
  });

  it('midpoint between two adjacent cell centers returns arithmetic mean', () => {
    const grid = makeGrid();
    // Midpoint between (row=0,col=0) center (x=5,z=5) and (row=0,col=1) center (x=15,z=5)
    // → x=10, z=5 → mean of elevation[0]=0 and elevation[1]=1 = 0.5
    expect(getTerrainHeight(grid, 10, 5)).toBeCloseTo(0.5);
  });

  it('out-of-bounds x (left edge) clamps to column 0', () => {
    const grid = makeGrid();
    // x=-100 is far left → col 0 row 0 center → elevation[0]=0
    expect(getTerrainHeight(grid, -100, 5)).toBeCloseTo(0);
  });

  it('out-of-bounds x (right edge) clamps to last column', () => {
    const grid = makeGrid();
    // x=999 → col=2 → row 0 → elevation[2]=2
    expect(getTerrainHeight(grid, 999, 5)).toBeCloseTo(2);
  });

  it('out-of-bounds z (top edge) clamps to row 0', () => {
    const grid = makeGrid();
    // z=-100 → row=0 → col=0 center → elevation[0]=0
    expect(getTerrainHeight(grid, 5, -100)).toBeCloseTo(0);
  });

  it('out-of-bounds z (bottom edge) clamps to last row', () => {
    const grid = makeGrid();
    // z=999 → row=2, col=0 center → elevation[6]=6
    expect(getTerrainHeight(grid, 5, 999)).toBeCloseTo(6);
  });

  it('exact grid origin (0,0) clamps to corner elevation[0][0]=0', () => {
    const grid = makeGrid();
    expect(getTerrainHeight(grid, 0, 0)).toBeCloseTo(0);
  });

  it('far corner (cols*res, rows*res) clamps to elevation[rows-1][cols-1]=8', () => {
    const grid = makeGrid();
    expect(getTerrainHeight(grid, 30, 30)).toBeCloseTo(8);
  });
});

describe('applyTerrainToMesh — vertex mapping and re-application', () => {
  it('Test A: row 0 vertices (min Z) have y≈0, last row (max Z) have y≈10', () => {
    const grid: TerrainGrid = {
      rows: 2,
      cols: 3,
      resolution: 10,
      originX: 0,
      originY: 0,
      // Row 0 all 0, row 1 all 10
      elevation: new Float64Array([0, 0, 0, 10, 10, 10]),
    };
    const mesh = new THREE.Mesh();
    applyTerrainToMesh(mesh, grid);

    const pos = mesh.geometry.attributes['position'];
    expect(pos).toBeDefined();
    const arr = pos.array;
    const vertCount = (grid.cols) * (grid.rows); // (cols-1+1)*(rows-1+1)

    // For a 2-row, 3-col grid there are 2*3=6 vertices.
    // After applyTerrainToMesh, row 0 vertices have y=0 and row 1 have y=10.
    const yValues: number[] = [];
    for (let i = 0; i < vertCount; i++) {
      yValues.push(arr[i * 3 + 1]);
    }
    // First 3 vertices are row 0 (elevation 0)
    expect(yValues[0]).toBeCloseTo(0);
    expect(yValues[1]).toBeCloseTo(0);
    expect(yValues[2]).toBeCloseTo(0);
    // Last 3 vertices are row 1 (elevation 10)
    expect(yValues[3]).toBeCloseTo(10);
    expect(yValues[4]).toBeCloseTo(10);
    expect(yValues[5]).toBeCloseTo(10);
  });

  it('Test B: second applyTerrainToMesh replaces geometry and disposes old one', () => {
    const gridA: TerrainGrid = {
      rows: 2,
      cols: 2,
      resolution: 10,
      originX: 0,
      originY: 0,
      elevation: new Float64Array([0, 0, 10, 10]),
    };
    const gridB: TerrainGrid = {
      rows: 2,
      cols: 2,
      resolution: 10,
      originX: 0,
      originY: 0,
      elevation: new Float64Array([20, 20, 20, 20]),
    };
    const mesh = new THREE.Mesh();
    applyTerrainToMesh(mesh, gridA);

    const disposeSpy = vi.spyOn(mesh.geometry, 'dispose');

    applyTerrainToMesh(mesh, gridB);

    expect(disposeSpy).toHaveBeenCalledOnce();

    // All y values in new geometry should be 20
    const pos = mesh.geometry.attributes['position'];
    const arr = pos.array;
    const vertCount = 4; // 2×2
    for (let i = 0; i < vertCount; i++) {
      expect(arr[i * 3 + 1]).toBeCloseTo(20);
    }
  });
});

describe('createTerrainMesh — material type', () => {
  it('mesh material is MeshStandardNodeMaterial, not MeshLambertMaterial', () => {
    const scene = new THREE.Scene();
    const mesh = createTerrainMesh(scene);
    expect(mesh.material).toBeInstanceOf(THREE.MeshStandardNodeMaterial);
    expect(mesh.material).not.toBeInstanceOf(THREE.MeshLambertMaterial);
  });
});

describe('createTerrainMaterial — updateBiome', () => {
  function makeBiome(overrides?: Partial<BiomeConfig>): BiomeConfig {
    return {
      surfaceColor: 0x1a3d1a,
      cliffColor: 0x231810,
      surfaceRoughness: 0.92,
      cliffRoughness: 0.75,
      surfaceMetalness: 0.0,
      cliffMetalness: 0.05,
      slopeBlendLow: 0.55,
      slopeBlendHigh: 0.80,
      textureScale: 0.05,
      ...overrides,
    };
  }

  it('updateBiome updates scalar uniform values', () => {
    const handle = createTerrainMaterial(makeBiome());
    // Access the internals via updateBiome by calling it and checking via a second handle
    // Since uniforms are closure-private, we verify by calling updateBiome and confirming
    // no error is thrown and the material is a MeshStandardNodeMaterial.
    expect(() => handle.updateBiome(makeBiome({ surfaceRoughness: 0.5, cliffRoughness: 0.3 }))).not.toThrow();
    expect(handle.material).toBeInstanceOf(THREE.MeshStandardNodeMaterial);
  });

  it('updateBiome accepts a completely different biome without error', () => {
    const handle = createTerrainMaterial(makeBiome());
    const desertBiome = makeBiome({
      surfaceColor: 0xc2a050,
      cliffColor:   0x8b6914,
      surfaceRoughness: 0.85,
      cliffRoughness:   0.70,
      slopeBlendLow:    0.60,
      slopeBlendHigh:   0.85,
    });
    expect(() => handle.updateBiome(desertBiome)).not.toThrow();
  });
});
