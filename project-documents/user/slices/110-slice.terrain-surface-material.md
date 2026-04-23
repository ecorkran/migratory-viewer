---
docType: slice-design
slice: terrain-surface-material
project: migratory-viewer
parent: user/architecture/100-slices.viewer-foundation.md
dependencies: [102-terrain-rendering]
interfaces: [111-terrain-slab-and-texture]
dateCreated: 20260422
dateUpdated: 20260422
status: complete
---

# Slice Design: Terrain Surface Material

## Overview

This slice replaces the terrain's flat `MeshLambertMaterial` with a `MeshStandardNodeMaterial` whose appearance is driven by slope angle — a TSL shader node graph that reads the world-space surface normal and blends between a "surface" appearance (flat ground: vegetation, soil) and a "cliff" appearance (steep faces: bare rock) using a `smoothstep` transition. All blending runs on the GPU; there is no per-frame CPU cost.

The material is parameterized by a `BiomeConfig` struct whose fields map to TSL `uniform()` nodes. Changing a biome is a single config substitution followed by updating uniform values — no shader recompile. This slice uses solid PBR colors only; texture map support is added in slice 111. Lighting is upgraded from the current flat hemisphere+directional setup to values that match the concept art's dramatic alien-world aesthetic.

## Value

**User-facing:** The terrain gains visible surface detail — alien vegetation on the plateaus, dark rock on the cliffs — matching the concept art reference. Combined with upgraded lighting, the world looks like a real environment rather than a lit mesh.

**Architectural enablement:** The `BiomeConfig` contract and `TerrainMaterialHandle` interface established here are the slot into which slice 111 plugs texture maps, and into which future biome-switching logic plugs runtime updates.

## Technical Scope

**Included:**
- `BiomeConfig` interface and default alien vegetation biome in `config.ts`
- `MeshStandardNodeMaterial` with TSL slope-blend node graph in `terrain.ts`
- `TerrainMaterialHandle` interface with `updateBiome()` for runtime switching (wired to init; not triggered by any UI or protocol event in this slice)
- Removal of `groundColor` from `ViewerConfig` (absorbed into `BiomeConfig.surfaceColor`)
- Lighting parameter tuning in `scene.ts` and `config.ts`

**Excluded:**
- Texture maps (slice 111)
- Slab geometry (slice 111)
- Runtime biome switching via UI or protocol
- Any changes to geometry construction, height lookup, or entity rendering

## Dependencies

### Prerequisites
- **Slice 102 (Terrain Rendering):** The displaced `PlaneGeometry` with computed vertex normals must be in place. Vertex normals are what makes slope-based blending meaningful — without `computeVertexNormals()`, `normalWorld.y` is uniform across the mesh.

### Interfaces Required
- `terrain.ts`: `createTerrainMesh()` and the mesh it manages
- `config.ts`: `ViewerConfig` for the new `biomeConfig` field
- `scene.ts`: lighting setup functions

## Architecture

### Component Structure

```
config.ts
  BiomeConfig (new interface)
  ViewerConfig.biomeConfig (new field, replaces groundColor)
  ViewerConfig lighting fields (tuned values)

rendering/terrain.ts
  TerrainMaterialHandle (new interface)
  createTerrainMaterial(biome) → TerrainMaterialHandle  (new)
  createTerrainMesh(scene) → THREE.Mesh                 (updated: uses node material)
  applyTerrainToMesh(mesh, grid)                        (unchanged)
  applyFlatPlane(mesh, w, h)                            (unchanged)
  getTerrainHeight(grid, x, z)                          (unchanged)

rendering/scene.ts
  createScene(canvas) → SceneContext                    (updated: tuned lighting)
```

### Data Flow

```
config.ts
  BiomeConfig
      │
      ▼
createTerrainMaterial(biome)
  ├── Creates uniform() nodes for each BiomeConfig field
  ├── Builds TSL node graph: normalWorld.y → smoothstep → mix(cliffColor, surfaceColor)
  ├── Creates MeshStandardNodeMaterial with colorNode, roughnessNode, metalnessNode
  └── Returns TerrainMaterialHandle { material, updateBiome }
      │
      ▼
createTerrainMesh(scene)
  ├── Calls createTerrainMaterial(config.biomeConfig)
  ├── mesh.material = handle.material
  └── Returns mesh (geometry set later by applyTerrainToMesh / applyFlatPlane)
```

The `updateBiome` function updates uniform `.value` fields in-place — no material swap, no shader recompile.

### TSL Node Graph

The shader computes one blend factor per fragment from the world-space surface normal:

```
blendFactor = smoothstep(slopeBlendLow, slopeBlendHigh, normalWorld.y)

colorNode     = mix(cliffColor,     surfaceColor,     blendFactor)
roughnessNode = mix(cliffRoughness, surfaceRoughness, blendFactor)
metalnessNode = mix(cliffMetalness, surfaceMetalness, blendFactor)
```

Where `normalWorld.y` is 1.0 on a perfectly flat horizontal surface and approaches 0.0 on a vertical cliff. All scalar inputs are `uniform()` nodes.

## Technical Decisions

### `MeshStandardNodeMaterial` over `MeshLambertMaterial`
Lambert is diffuse-only (no specular, no PBR). Standard gives PBR roughness and metalness, which are needed for the rock/vegetation contrast in the concept art and for the TSL `*Node` slots that accept the slope-blend expression. This is the correct Three.js node material for terrain.

### `uniform()` nodes for all BiomeConfig fields
Using `uniform()` instead of baked `color()`/`float()` constants means biome values are GPU-updatable at runtime without shader recompile. The cost is negligible (uniform upload is one GPU call). The benefit is that biome switching in future slices requires only `.value` assignment — no material rebuild.

### `TerrainMaterialHandle` as the interface boundary
Rather than exposing raw uniform references or the material directly, `createTerrainMaterial` returns a handle object with a typed `updateBiome(biome: BiomeConfig): void` method. This hides the uniform internals, keeps the contract stable, and gives slice 111 a clear point to extend (e.g., `updateTextures()`).

### `BiomeConfig` in `config.ts`, not hardcoded in terrain.ts
Biome parameters must be substitutable without touching rendering code. Keeping them in config follows the same pattern as `ProfileConfig` for entities — one config change, visuals update everywhere.

### Remove `groundColor` from `ViewerConfig`
`groundColor` was the single flat color previously passed to `MeshLambertMaterial`. With `BiomeConfig`, the surface color is `biomeConfig.surfaceColor`. Removing `groundColor` eliminates a redundant config field and avoids confusion about which color applies where. The `hud.ts` or any other consumer that referenced `groundColor` must be updated to use `biomeConfig.surfaceColor`.

## Implementation Details

### BiomeConfig interface

```ts
export interface BiomeConfig {
  /** Hex color for near-flat terrain (vegetation, soil). */
  surfaceColor: number;
  /** Hex color for steep cliff faces (rock, bare earth). */
  cliffColor: number;
  surfaceRoughness: number;  // 0 = mirror, 1 = fully rough
  cliffRoughness: number;
  surfaceMetalness: number;  // 0 = dielectric, 1 = metal
  cliffMetalness: number;
  /** normalWorld.y ≤ this → full cliff appearance. */
  slopeBlendLow: number;
  /** normalWorld.y ≥ this → full surface appearance. */
  slopeBlendHigh: number;
}
```

Default biome (alien vegetation, matching concept art):

| Field | Value | Rationale |
|---|---|---|
| `surfaceColor` | `0x1a3d1a` | Dark forest green |
| `cliffColor` | `0x231810` | Dark rocky brown |
| `surfaceRoughness` | `0.92` | Vegetation is rough |
| `cliffRoughness` | `0.75` | Rock is rough with slight sheen |
| `surfaceMetalness` | `0.0` | Organic surface |
| `cliffMetalness` | `0.05` | Slight mineral glint |
| `slopeBlendLow` | `0.55` | Cliff starts at ~57° from horizontal |
| `slopeBlendHigh` | `0.80` | Full surface above ~37° from horizontal |

### TerrainMaterialHandle interface

```ts
export interface TerrainMaterialHandle {
  material: THREE.MeshStandardNodeMaterial;
  /** Update all biome uniforms in-place. No shader recompile. */
  updateBiome: (biome: BiomeConfig) => void;
}
```

`createTerrainMesh` stores the handle internally (e.g., as a module variable or closure) so that a future `applyBiome(mesh, biome)` exported function can delegate to it.

### Lighting upgrade

The current lighting is tuned for a generic Earth-like scene. The concept art shows:
- A **warm amber key light** from the upper-left
- A **cool deep-blue/purple ambient fill** — alien sky
- **Very dark ground hemisphere** — almost no light bouncing from below
- High contrast between lit faces and shadows

Target intent (exact values to be tuned during implementation):

| Parameter | Current | Target intent |
|---|---|---|
| `hemisphereSkyColor` | `0x87ceeb` (light blue) | Deep alien blue-purple (`0x1a1a4e` range) |
| `hemisphereGroundColor` | `0x444444` (mid grey) | Near-black green (`0x0a1a0a` range) |
| `hemisphereIntensity` | `1.5` | `1.0–1.2` (reduced fill) |
| `directionalColor` | `0xffffff` (white) | Warm amber-white (`0xfff5d0` range) |
| `directionalIntensity` | `Math.PI` | `Math.PI * 1.5–2.0` (brighter key) |
| `directionalPosition` | `[300, 500, 200]` | Upper-left angle (negative X, high Y) |

These are starting ranges. The implementer should tune visually against the concept art reference at `project-documents/user/reference/concept-art/migratory-terrain-concept.png`.

### Changes summary by file

| File | Change |
|---|---|
| `src/config.ts` | Add `BiomeConfig` interface; add `biomeConfig: BiomeConfig` field to `ViewerConfig`; remove `groundColor`; tune lighting fields |
| `src/rendering/terrain.ts` | Add `TerrainMaterialHandle` interface; add `createTerrainMaterial(biome)` function; update `createTerrainMesh` to use node material |
| `src/rendering/scene.ts` | No structural change; lighting values updated via config |
| `src/ui/hud.ts` | Update any reference to `config.groundColor` (grep to confirm) |

## Integration Points

### Provides to Slice 111 (Terrain Slab and Texture)
- `TerrainMaterialHandle` interface — slice 111 extends this (or composes with it) to add texture node support
- `BiomeConfig` interface — slice 111 adds optional `surfaceTexture` and `cliffTexture` fields
- `updateBiome()` pattern — slice 111 may extend this to `updateTextures()`

### Consumes from Slice 102
- The terrain mesh with computed vertex normals — `normalWorld.y` blending requires correct normals
- `createTerrainMesh` return value — this slice updates its material setup

## Success Criteria

### Functional Requirements
- [ ] Terrain surfaces with `normalWorld.y > slopeBlendHigh` render in `surfaceColor`
- [ ] Terrain faces with `normalWorld.y < slopeBlendLow` render in `cliffColor`
- [ ] The transition between surface and cliff is smooth (no hard edge)
- [ ] Flat-plane fallback (no TERRAIN received) also uses the node material
- [ ] `updateBiome()` changes colors and blend thresholds without a page reload
- [ ] No TypeScript errors; `pnpm tsc --noEmit` clean
- [ ] All existing tests pass; `pnpm test` green

### Technical Requirements
- [ ] Terrain mesh uses `MeshStandardNodeMaterial`, not `MeshLambertMaterial`
- [ ] All `BiomeConfig` fields are backed by `uniform()` nodes (not compiled constants)
- [ ] `groundColor` removed from `ViewerConfig`; no references remain
- [ ] Lighting values updated in config; no magic numbers in `scene.ts`
- [ ] `renderer.debug.checkShaderErrors = true` during dev (can be behind a debug flag)

### Verification Walkthrough

**Pre-flight (verified passing):**
```bash
pnpm tsc --noEmit   # no errors
pnpm test --run     # 54 tests pass (51 existing + 3 new material tests)
pnpm build          # clean build; chunk size warning is pre-existing, not introduced here
```

**Visual verification (dev server):**
1. `pnpm dev` — open the viewer in Chrome (WebGPU backend preferred)
2. Connect to a world server that sends TERRAIN. The terrain should show two distinct colors: dark green on flat plateaus, dark rock-brown on cliffs and steep faces.
3. The transition should be smooth, not a hard edge.
4. Open browser console — `renderer.debug.checkShaderErrors = true` is active in dev mode; confirm no shader compilation errors logged.
5. Compare against the concept art at `project-documents/user/reference/concept-art/migratory-terrain-concept.png`. The overall color palette and contrast should match.

**Lighting check:**
6. In perspective camera mode, rotate to view the terrain from a low angle. The directional light (warm amber `0xfff5d0`, intensity `Math.PI * 1.5`, position `[-400, 600, 150]`) should create visible shadows and depth on the slopes. The sky hemisphere fill (`0x1a1a4e` deep blue-purple) should be visibly alien, not Earth-blue.

**Biome update check (browser console):**
7. `getTerrainMaterialHandle()` is exported from `src/rendering/terrain.ts`. In the browser console, access via the module and call `.updateBiome(...)` with a dramatically different biome (e.g., `surfaceColor: 0xff0000`) — terrain should update instantly with no reload.
   (Developer-only smoke test — no UI for this in this slice.)

**Flat-plane fallback:**
8. Connect to a server that does not send TERRAIN. The flat ground plane uses the same node material (solid `surfaceColor`, no visible slope variation on a flat surface — expected).

## Risk Assessment

### TSL uniform type for `THREE.Color`
`uniform(new THREE.Color(hex))` is the correct pattern for color uniforms in TSL, confirmed by the tool guide and context7. If type errors arise during implementation, the fallback is `uniform(new THREE.Vector3(r, g, b))` and conversion in the node graph. This is a low-probability issue.

### WebGL 2 fallback compatibility
TSL compiles to both WGSL and GLSL. `normalWorld`, `smoothstep`, and `mix` are standard across both backends. No compatibility risk identified.

## Implementation Notes

### Development Approach
1. Add `BiomeConfig` to `config.ts` and wire `biomeConfig` field — confirms interface compiles
2. Implement `createTerrainMaterial` with the TSL node graph — start with just `colorNode`, verify slope blending works visually
3. Add `roughnessNode` and `metalnessNode` — verify PBR response under the directional light
4. Tune lighting values against the concept art
5. Confirm `updateBiome` updates the terrain in real time
6. Run full test suite and build

### Testing Strategy
Unit tests for terrain geometry and height lookup are unchanged. The material creation can be lightly tested by asserting the returned material is `MeshStandardNodeMaterial` (not Lambert). Visual correctness is verified manually against the concept art — there is no practical way to unit-test shader output in Node.
