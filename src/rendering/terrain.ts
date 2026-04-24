import * as THREE from 'three/webgpu';
import { uniform, normalWorld, smoothstep, mix } from 'three/tsl';
import config from '../config.ts';
import type { BiomeConfig } from '../config.ts';
import type { TerrainGrid } from '../types.ts';

/** Handle returned by createTerrainMaterial — hides uniform internals. */
export interface TerrainMaterialHandle {
  material: THREE.MeshStandardNodeMaterial;
  /** Update all biome uniforms in-place. No shader recompile. */
  updateBiome: (biome: BiomeConfig) => void;
}

/**
 * Build a MeshStandardNodeMaterial with a TSL slope-blend node graph.
 * All BiomeConfig fields are backed by uniform() nodes — runtime-updatable
 * without shader recompile via updateBiome().
 */
export function createTerrainMaterial(biome: BiomeConfig): TerrainMaterialHandle {
  const uSurfaceColor    = uniform(new THREE.Color(biome.surfaceColor));
  const uCliffColor      = uniform(new THREE.Color(biome.cliffColor));
  const uSurfaceRoughness = uniform(biome.surfaceRoughness);
  const uCliffRoughness  = uniform(biome.cliffRoughness);
  const uSurfaceMetalness = uniform(biome.surfaceMetalness);
  const uCliffMetalness  = uniform(biome.cliffMetalness);
  const uSlopeBlendLow   = uniform(biome.slopeBlendLow);
  const uSlopeBlendHigh  = uniform(biome.slopeBlendHigh);

  // normalWorld.y is 1.0 on horizontal, 0.0 on vertical cliff, -1.0 on downward-facing bottom.
  // Both walls (y≈0) and bottom (y=-1) fall below slopeBlendLow and render as pure cliff.
  const blendFactor = smoothstep(uSlopeBlendLow, uSlopeBlendHigh, normalWorld.y);

  const material = new THREE.MeshStandardNodeMaterial();
  material.colorNode     = mix(uCliffColor,      uSurfaceColor,      blendFactor);
  material.roughnessNode = mix(uCliffRoughness,  uSurfaceRoughness,  blendFactor);
  material.metalnessNode = mix(uCliffMetalness,  uSurfaceMetalness,  blendFactor);

  function updateBiome(b: BiomeConfig): void {
    uSurfaceColor.value.set(b.surfaceColor);
    uCliffColor.value.set(b.cliffColor);
    uSurfaceRoughness.value = b.surfaceRoughness;
    uCliffRoughness.value   = b.cliffRoughness;
    uSurfaceMetalness.value = b.surfaceMetalness;
    uCliffMetalness.value   = b.cliffMetalness;
    uSlopeBlendLow.value    = b.slopeBlendLow;
    uSlopeBlendHigh.value   = b.slopeBlendHigh;
  }

  return { material, updateBiome };
}

// Module-level handle so callers can call updateBiome after mesh creation.
let terrainMaterialHandle: TerrainMaterialHandle | null = null;

/** Return the active terrain material handle, or null if not yet created. */
export function getTerrainMaterialHandle(): TerrainMaterialHandle | null {
  return terrainMaterialHandle;
}

/**
 * Create an empty terrain mesh (1×1 placeholder) added to the scene.
 * The geometry is replaced on the first render frame by either
 * `applyTerrainToMesh` (when TERRAIN has arrived) or `applyFlatPlane`.
 */
export function createTerrainMesh(scene: THREE.Scene): THREE.Mesh {
  const geometry = new THREE.PlaneGeometry(1, 1);
  geometry.rotateX(-Math.PI / 2);
  terrainMaterialHandle = createTerrainMaterial(config.biomeConfig);
  const mesh = new THREE.Mesh(geometry, terrainMaterialHandle.material);
  scene.add(mesh);
  return mesh;
}

/**
 * Build a unified closed BufferGeometry = top surface + 4 walls + bottom face.
 *
 * Local coordinate space: X ∈ [-w/2, +w/2], Z ∈ [-h/2, +h/2], Y = elevation.
 * The caller offsets the mesh to `(originX + w/2, 0, originY + h/2)` so that
 * world X ∈ [originX, originX+w], world Z ∈ [originY, originY+h].
 *
 * Vertex layout (row-major within each group):
 *   [0, rows*cols)                      : top surface (row 0 at min Z, col 0 at min X)
 *   [T, T+2*cols)                       : north wall (top edge row 0, then bottom row) — T = rows*cols
 *   [T+2*cols, T+4*cols)                : south wall (top edge row rows-1, then bottom row)
 *   [T+4*cols, T+4*cols+2*rows)         : west wall  (top edge col 0, then bottom col)
 *   [T+4*cols+2*rows, T+4*cols+4*rows)  : east wall  (top edge col cols-1, then bottom col)
 *   [T+4*cols+4*rows, +4)               : bottom face (4 corners at Y = bottomY)
 *
 * Wall top vertices are position-identical to the corresponding terrain edge vertices
 * but stored separately so they can carry wall-appropriate UVs and normals.
 */
function buildUnifiedGeometry(
  rows: number,
  cols: number,
  width: number,   // world units along X
  height: number,  // world units along Z
  sampleElevation: (r: number, c: number) => number,
  slabDepth: number,
): THREE.BufferGeometry {
  // Guard: a 1-vertex grid can't form quads. PlaneGeometry handles seg=0 fine, but our
  // wall strips assume cols>=2 and rows>=2. The caller (createTerrainMesh placeholder)
  // uses a 1×1 PlaneGeometry instead; applyTerrainToMesh and applyFlatPlane always pass rows,cols >= 2.
  const T = rows * cols;
  const stepX = cols > 1 ? width  / (cols - 1) : 0;
  const stepZ = rows > 1 ? height / (rows - 1) : 0;

  // Find min elevation to set bottom Y.
  let minElev = Infinity;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const e = sampleElevation(r, c);
      if (e < minElev) minElev = e;
    }
  }
  if (!isFinite(minElev)) minElev = 0;
  const bottomY = minElev - slabDepth;

  const wallN_base = T;
  const wallS_base = T + 2 * cols;
  const wallW_base = T + 4 * cols;
  const wallE_base = T + 4 * cols + 2 * rows;
  const floor_base = T + 4 * cols + 4 * rows;
  const totalVerts = floor_base + 4;

  const positions = new Float32Array(totalVerts * 3);
  const normals   = new Float32Array(totalVerts * 3);
  const uvs       = new Float32Array(totalVerts * 2);

  // --- Top surface ---------------------------------------------------------
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const i = r * cols + c;
      const x = -width  / 2 + c * stepX;
      const z = -height / 2 + r * stepZ;
      positions[i * 3]     = x;
      positions[i * 3 + 1] = sampleElevation(r, c);
      positions[i * 3 + 2] = z;
      // Normals computed later via computeVertexNormals for the top surface.
      uvs[i * 2]     = cols > 1 ? c / (cols - 1) : 0;
      uvs[i * 2 + 1] = rows > 1 ? r / (rows - 1) : 0;
    }
  }

  // --- Wall helper ---------------------------------------------------------
  function writeWall(
    baseIdx: number,
    vertCount: number,
    topSample: (i: number) => { x: number; y: number; z: number },
    outward: { x: number; y: number; z: number },
  ): void {
    for (let i = 0; i < vertCount; i++) {
      const top = topSample(i);
      // Top vertex (row 0 of the wall strip)
      positions[(baseIdx + i) * 3]     = top.x;
      positions[(baseIdx + i) * 3 + 1] = top.y;
      positions[(baseIdx + i) * 3 + 2] = top.z;
      // Bottom vertex (row 1 of the wall strip)
      positions[(baseIdx + vertCount + i) * 3]     = top.x;
      positions[(baseIdx + vertCount + i) * 3 + 1] = bottomY;
      positions[(baseIdx + vertCount + i) * 3 + 2] = top.z;

      for (let k = 0; k < 2; k++) {
        const vi = baseIdx + k * vertCount + i;
        normals[vi * 3]     = outward.x;
        normals[vi * 3 + 1] = outward.y;
        normals[vi * 3 + 2] = outward.z;
      }

      const u = vertCount > 1 ? i / (vertCount - 1) : 0;
      uvs[(baseIdx + i) * 2]                   = u;
      uvs[(baseIdx + i) * 2 + 1]               = 0;
      uvs[(baseIdx + vertCount + i) * 2]       = u;
      uvs[(baseIdx + vertCount + i) * 2 + 1]   = 1;
    }
  }

  const halfW = width  / 2;
  const halfH = height / 2;

  // North wall (min Z = -halfH). Outward normal: -Z.
  writeWall(
    wallN_base, cols,
    (c) => ({ x: -halfW + c * stepX, y: sampleElevation(0, c), z: -halfH }),
    { x: 0, y: 0, z: -1 },
  );
  // South wall (max Z = +halfH). Outward normal: +Z.
  writeWall(
    wallS_base, cols,
    (c) => ({ x: -halfW + c * stepX, y: sampleElevation(rows - 1, c), z: +halfH }),
    { x: 0, y: 0, z: 1 },
  );
  // West wall (min X = -halfW). Outward normal: -X.
  writeWall(
    wallW_base, rows,
    (r) => ({ x: -halfW, y: sampleElevation(r, 0), z: -halfH + r * stepZ }),
    { x: -1, y: 0, z: 0 },
  );
  // East wall (max X = +halfW). Outward normal: +X.
  writeWall(
    wallE_base, rows,
    (r) => ({ x: +halfW, y: sampleElevation(r, cols - 1), z: -halfH + r * stepZ }),
    { x: 1, y: 0, z: 0 },
  );

  // --- Bottom face (4 corners, facing -Y) ---------------------------------
  // Corners at (±halfW, bottomY, ±halfH)
  const bNW = floor_base;     // (-halfW, bottomY, -halfH)
  const bNE = floor_base + 1; // (+halfW, bottomY, -halfH)
  const bSW = floor_base + 2; // (-halfW, bottomY, +halfH)
  const bSE = floor_base + 3; // (+halfW, bottomY, +halfH)
  const setCorner = (vi: number, x: number, z: number, u: number, v: number) => {
    positions[vi * 3]     = x;
    positions[vi * 3 + 1] = bottomY;
    positions[vi * 3 + 2] = z;
    normals[vi * 3]     = 0;
    normals[vi * 3 + 1] = -1;
    normals[vi * 3 + 2] = 0;
    uvs[vi * 2]     = u;
    uvs[vi * 2 + 1] = v;
  };
  setCorner(bNW, -halfW, -halfH, 0, 0);
  setCorner(bNE, +halfW, -halfH, 1, 0);
  setCorner(bSW, -halfW, +halfH, 0, 1);
  setCorner(bSE, +halfW, +halfH, 1, 1);

  // --- Indices -------------------------------------------------------------
  // Top surface: (cols-1) * (rows-1) quads, 2 tris each.
  // Each wall: (vertCount-1) quads, 2 tris each.
  // Bottom: 2 tris.
  const topQuads    = (cols - 1) * (rows - 1);
  const wallNQuads  = cols - 1;
  const wallSQuads  = cols - 1;
  const wallWQuads  = rows - 1;
  const wallEQuads  = rows - 1;
  const totalTris   = (topQuads + wallNQuads + wallSQuads + wallWQuads + wallEQuads) * 2 + 2;
  const indices     = new Uint32Array(totalTris * 3);
  let indexPtr = 0;

  // Top surface triangulation: row 0 is at min Z, row rows-1 at max Z.
  // Consider the quad at (r, c)-(r, c+1)-(r+1, c+1)-(r+1, c).
  // Top surface faces +Y, so the front face normal must point +Y.
  // In a right-handed coordinate system, winding CCW *when viewed from +Y*.
  // Viewed from above looking down (-Y direction), CCW means the visible winding
  // is reversed. So pick indices such that, projected to XZ, the order winds CCW
  // when viewed from +Y.
  for (let r = 0; r < rows - 1; r++) {
    for (let c = 0; c < cols - 1; c++) {
      const a = r * cols + c;         // (r,   c)
      const b = r * cols + (c + 1);   // (r,   c+1)
      const d = (r + 1) * cols + c;   // (r+1, c)
      const e = (r + 1) * cols + (c + 1); // (r+1, c+1)
      // Quad corners in XZ: a=(x,z0), b=(x+Δ,z0), d=(x,z+Δ), e=(x+Δ,z+Δ).
      // Triangle 1: a, d, b  → viewed from +Y, winds CCW (a → d is +Z; d → b is +X, -Z)
      // Triangle 2: b, d, e
      indices[indexPtr++] = a;
      indices[indexPtr++] = d;
      indices[indexPtr++] = b;
      indices[indexPtr++] = b;
      indices[indexPtr++] = d;
      indices[indexPtr++] = e;
    }
  }

  // Wall strips. For each wall, indices go (top_i, bottom_i, top_i+1) and
  // (top_i+1, bottom_i, bottom_i+1). Winding is chosen so the front face points
  // along +outwardNormal. The `writeWall` layout places top verts at [base..base+n)
  // and bottom verts at [base+n..base+2n).
  function writeWallIndices(base: number, n: number, invert: boolean): void {
    for (let i = 0; i < n - 1; i++) {
      const tA = base + i;
      const tB = base + i + 1;
      const bA = base + n + i;
      const bB = base + n + i + 1;
      if (!invert) {
        indices[indexPtr++] = tA;
        indices[indexPtr++] = bA;
        indices[indexPtr++] = tB;
        indices[indexPtr++] = tB;
        indices[indexPtr++] = bA;
        indices[indexPtr++] = bB;
      } else {
        indices[indexPtr++] = tA;
        indices[indexPtr++] = tB;
        indices[indexPtr++] = bA;
        indices[indexPtr++] = tB;
        indices[indexPtr++] = bB;
        indices[indexPtr++] = bA;
      }
    }
  }

  // Determine per-wall winding by checking which direction the wall's "i-axis"
  // runs along in world coordinates vs. the outward normal direction.
  //
  // For each wall, visualize looking at the wall from OUTSIDE (along -outward):
  //   - North wall (outward -Z): looking from -Z toward +Z. Top row (i=0..cols-1) runs in +X.
  //     From the outside viewer's perspective, i increases to their RIGHT.
  //     Front-facing CCW winding (from outside): top-left → bottom-left → top-right → ...
  //     That's tA=(top,i) → bA=(bottom,i) → tB=(top,i+1). invert=false.
  //   - South wall (outward +Z): looking from +Z toward -Z. i=0..cols-1 runs in +X.
  //     The viewer sees +X on their LEFT (because they are looking back toward -Z).
  //     So we need invert=true to reverse winding.
  //   - West wall (outward -X): looking from -X toward +X. i=0..rows-1 runs in +Z.
  //     Viewer sees +Z on their LEFT. invert=true.
  //   - East wall (outward +X): looking from +X toward -X. i=0..rows-1 runs in +Z.
  //     Viewer sees +Z on their RIGHT. invert=false.
  writeWallIndices(wallN_base, cols, /* invert */ false);
  writeWallIndices(wallS_base, cols, /* invert */ true);
  writeWallIndices(wallW_base, rows, /* invert */ true);
  writeWallIndices(wallE_base, rows, /* invert */ false);

  // Bottom face, facing -Y (outward is down). Viewed from below (-Y looking up toward +Y),
  // to get CCW winding: NW → SW → NE and NE → SW → SE (mirror of the top-surface pattern).
  indices[indexPtr++] = bNW;
  indices[indexPtr++] = bSW;
  indices[indexPtr++] = bNE;
  indices[indexPtr++] = bNE;
  indices[indexPtr++] = bSW;
  indices[indexPtr++] = bSE;

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('normal',   new THREE.BufferAttribute(normals,   3));
  geometry.setAttribute('uv',       new THREE.BufferAttribute(uvs,       2));
  geometry.setIndex(new THREE.BufferAttribute(indices, 1));

  // Recompute normals ONLY on the top-surface region — walls and bottom have
  // hand-authored normals appropriate for their orientation. We do this by
  // running computeVertexNormals globally and then overwriting wall/bottom rows.
  // Simpler: skip computeVertexNormals and compute top-surface normals manually.
  computeTopNormals(positions, normals, indices, rows, cols);

  return geometry;
}

/** Compute vertex normals for the top surface only (vertex indices 0..rows*cols-1). */
function computeTopNormals(
  positions: Float32Array,
  normals:   Float32Array,
  indices:   Uint32Array,
  rows: number,
  cols: number,
): void {
  const T = rows * cols;
  // Zero out top-surface normals.
  for (let i = 0; i < T; i++) {
    normals[i * 3]     = 0;
    normals[i * 3 + 1] = 0;
    normals[i * 3 + 2] = 0;
  }

  // Accumulate face normals onto vertices that fall in the top-surface range.
  const topTriCount = (rows - 1) * (cols - 1) * 2;
  for (let t = 0; t < topTriCount; t++) {
    const i0 = indices[t * 3];
    const i1 = indices[t * 3 + 1];
    const i2 = indices[t * 3 + 2];

    const ax = positions[i0 * 3], ay = positions[i0 * 3 + 1], az = positions[i0 * 3 + 2];
    const bx = positions[i1 * 3], by = positions[i1 * 3 + 1], bz = positions[i1 * 3 + 2];
    const cx = positions[i2 * 3], cy = positions[i2 * 3 + 1], cz = positions[i2 * 3 + 2];

    const abx = bx - ax, aby = by - ay, abz = bz - az;
    const acx = cx - ax, acy = cy - ay, acz = cz - az;
    // Cross product AB × AC
    const nx = aby * acz - abz * acy;
    const ny = abz * acx - abx * acz;
    const nz = abx * acy - aby * acx;

    normals[i0 * 3]     += nx; normals[i0 * 3 + 1] += ny; normals[i0 * 3 + 2] += nz;
    normals[i1 * 3]     += nx; normals[i1 * 3 + 1] += ny; normals[i1 * 3 + 2] += nz;
    normals[i2 * 3]     += nx; normals[i2 * 3 + 1] += ny; normals[i2 * 3 + 2] += nz;
  }

  // Normalize top-surface normals.
  for (let i = 0; i < T; i++) {
    const x = normals[i * 3];
    const y = normals[i * 3 + 1];
    const z = normals[i * 3 + 2];
    const len = Math.hypot(x, y, z);
    if (len > 0) {
      normals[i * 3]     = x / len;
      normals[i * 3 + 1] = y / len;
      normals[i * 3 + 2] = z / len;
    } else {
      normals[i * 3]     = 0;
      normals[i * 3 + 1] = 1;
      normals[i * 3 + 2] = 0;
    }
  }
}

/**
 * Rebuild the terrain mesh geometry from an elevation grid, as a single closed
 * mesh (top surface + 4 walls + bottom face). Disposes the prior geometry.
 *
 * Preserves slice 110's test invariant: the first `rows*cols` vertices in the
 * position attribute are the top-surface grid in row-major order (row 0 at min Z).
 */
export function applyTerrainToMesh(mesh: THREE.Mesh, grid: TerrainGrid): void {
  const { rows, cols, resolution, originX, originY, elevation } = grid;
  const width  = cols * resolution;
  const height = rows * resolution;

  const geometry = buildUnifiedGeometry(
    rows,
    cols,
    width,
    height,
    (r, c) => elevation[r * cols + c],
    config.slabDepth,
  );

  mesh.geometry.dispose();
  mesh.geometry = geometry;
  mesh.position.set(originX + width / 2, 0, originY + height / 2);
}

/**
 * Apply a world-sized flat top (Y=0 everywhere) with slab walls + bottom.
 * Used as the no-TERRAIN fallback — keeps the full closed-mesh shape.
 */
export function applyFlatPlane(mesh: THREE.Mesh, worldWidth: number, worldHeight: number): void {
  // Minimum viable grid: 2×2 so wall strips have one quad each.
  const geometry = buildUnifiedGeometry(
    2,
    2,
    worldWidth,
    worldHeight,
    () => 0,
    config.slabDepth,
  );

  mesh.geometry.dispose();
  mesh.geometry = geometry;
  mesh.position.set(worldWidth / 2, 0, worldHeight / 2);
}

/**
 * Bilinear interpolation of terrain elevation at world-space (x, z).
 * Returns 0 when grid is null (flat-plane fallback until TERRAIN arrives).
 * Wire originY maps to world Z; elevation maps to world Y.
 */
export function getTerrainHeight(grid: TerrainGrid | null, x: number, z: number): number {
  if (grid === null) return 0;
  const { rows, cols, resolution, originX, originY, elevation } = grid;

  const fr = Math.max(0, Math.min(rows - 1, (z - originY) / resolution - 0.5));
  const fc = Math.max(0, Math.min(cols - 1, (x - originX) / resolution - 0.5));

  const r0 = Math.floor(fr);
  const c0 = Math.floor(fc);
  const r1 = Math.min(r0 + 1, rows - 1);
  const c1 = Math.min(c0 + 1, cols - 1);
  const dr = fr - r0;
  const dc = fc - c0;

  const e00 = elevation[r0 * cols + c0];
  const e01 = elevation[r0 * cols + c1];
  const e10 = elevation[r1 * cols + c0];
  const e11 = elevation[r1 * cols + c1];

  return e00 * (1 - dr) * (1 - dc) +
         e01 * (1 - dr) * dc +
         e10 * dr * (1 - dc) +
         e11 * dr * dc;
}
