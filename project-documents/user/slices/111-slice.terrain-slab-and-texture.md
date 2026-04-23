---
docType: slice-design
slice: terrain-slab-and-texture
project: migratory-viewer
parent: user/architecture/100-slices.viewer-foundation.md
dependencies: [110-terrain-surface-material]
interfaces: []
dateCreated: 20260422
dateUpdated: 20260423
status: not_started
---

# Slice Design: Terrain Slab and Texture

## Overview

This slice adds two things to the terrain established in slices 102 and 110: **geological slab depth** (the world becomes a floating slab with visible side walls and a bottom face, matching the concept art) and **texture maps** (diffuse and normal textures replace the solid PBR colors from slice 110, with triplanar UV projection to eliminate seams on sloped surfaces).

Both features extend the `BiomeConfig` contract from slice 110. Textures are optional — when absent, the solid-color behavior from slice 110 is preserved exactly. The slab is static geometry, rebuilt only when world bounds change.

## Value

**User-facing:** The world looks like the concept art — a massive geological formation floating in darkness. Surface textures give the terrain organic detail (mossy vegetation, cracked rock) that solid colors cannot achieve. Together with slice 110's slope blending and lighting, the viewer reaches the visual target established by the concept art reference.

**Architectural enablement:** The `BiomeConfig` texture fields and `textureScale` parameter establish the slot for future biome switching. Loading a different biome means pointing `BiomeConfig` at different texture paths and calling `rebuildMaterial`.

## Technical Scope

**Included:**
- `BiomeConfig` extended with optional texture path fields and `textureScale`
- `slabDepth` added to `ViewerConfig`
- New `src/rendering/slab.ts` module: creates and resizes the 5-mesh slab group
- Texture loading in `createTerrainMaterial`: when texture paths are present, `colorNode` uses `triplanarTexture` nodes; when absent, solid color uniforms from slice 110 are used unchanged
- Normal map support via `normalNode` when normal map paths are present
- `main.ts`: create slab on init; resize slab when world bounds change

**Excluded:**
- Runtime biome switching via UI or protocol (texture paths are read at startup only)
- Multiple simultaneous biomes
- LOD or distance-based texture switching
- Slab edge contouring (slab top edge is flat, not terrain-profile-matched — consistent with concept art)

## Dependencies

### Prerequisites
- **Slice 110 (Terrain Surface Material):** complete as of 2026-04-23 (commits c8401ed, b385ad0, aae4d6e, 8cfaccc). `BiomeConfig`, `TerrainMaterialHandle`, and `createTerrainMaterial` are in place in [src/rendering/terrain.ts](src/rendering/terrain.ts) and [src/config.ts](src/config.ts). This slice extends them.
- **Texture assets:** CC0 texture files must be present in `public/textures/biomes/alien/` before visual verification is possible.

### Baseline from Slice 110

The committed `DEFAULT_BIOME` and lighting values are the starting point for slice 111 visual tuning:

| Field | Committed value | Notes |
|---|---|---|
| `surfaceColor` | `0x1a3d1a` | dark alien vegetation green |
| `cliffColor` | `0x231810` | near-black brown rock |
| `surfaceRoughness` | `0.92` | |
| `cliffRoughness` | `0.75` | |
| `surfaceMetalness` | `0.0` | |
| `cliffMetalness` | `0.05` | |
| `slopeBlendLow` | `0.65` | empirically tuned for sine-wave terrain |
| `slopeBlendHigh` | `0.90` | see note below |
| `hemisphereIntensity` | `1.1` | |
| `directionalIntensity` | `Math.PI * 1.5` | |
| `directionalPosition` | `[-400, 600, 600]` | user-adjusted from initial `[-400, 600, 150]` |

**Slope-blend empirical note:** The default thresholds `(0.65, 0.90)` are a compromise. On slice 110's sine-wave terrain the surface normals stay close to `(0, 1, 0)` so cliff color barely triggers; thresholds of `(0.85, 0.98)` made cliff color visible on hillsides but felt over-aggressive. Slice 111's slab walls are near-vertical (`normalWorld.y ≈ 0`) and will reliably fall below `slopeBlendLow` — so the slab provides the first strong visual confirmation that the cliff path of the blend works end-to-end. No threshold retuning is expected as part of this slice; if the textured result warrants it, tune in a follow-up.

**Related open issue:** [#1](https://github.com/ecorkran/migratory-viewer/issues/1) — weak directional lighting contrast at low camera angles. The slab walls will be the first near-vertical geometry in the scene and may expose or clarify this. If shading on the walls is uniform/flat, investigation of issue #1 becomes a blocker rather than deferred work.

### Interfaces Required
- `terrain.ts` → `createTerrainMaterial`, `TerrainMaterialHandle`
- `config.ts` → `BiomeConfig`, `ViewerConfig`
- `main.ts` → world-bounds change handler (slab resize trigger)

## Architecture

### Component Structure

```
config.ts
  BiomeConfig (extended: texture paths, textureScale)
  ViewerConfig.slabDepth (new field)

rendering/terrain.ts
  createTerrainMaterial(biome)     (extended: texture-aware node graph)
  TerrainMaterialHandle            (unchanged interface; internal impl changes)

rendering/slab.ts                  (new file)
  createSlab(scene, biome) → SlabHandle
  SlabHandle { group, resize(w, h), updateBiome(biome) }

main.ts
  createSlab call on init
  slab.resize() on world-bounds change
```

### Data Flow

```
BiomeConfig (config.ts)
  ├── texture paths present?
  │     YES → TextureLoader.load(paths) → THREE.Texture instances
  │           → texture() nodes → triplanarTexture() → colorNode / normalNode
  │     NO  → uniform(color) nodes (slice 110 behavior, unchanged)
  │
  └── slabDepth (ViewerConfig) + worldWidth + worldHeight
        → createSlab(): 5 PlaneGeometry meshes in a Group
        → slab material: solid cliffColor (or cliff texture if present)
```

### Slab Geometry

The slab is a `THREE.Group` containing five meshes, all added to the scene. It is rebuilt when world bounds change.

```
World in XZ: x ∈ [0, worldWidth], z ∈ [0, worldHeight]
Terrain Y: varies (elevation-driven)
Slab top: Y = 0 (constant; terrain surface rises above this)
Slab bottom: Y = -slabDepth

Slab north wall: PlaneGeometry(worldWidth, slabDepth)
  Position: (worldWidth/2, -slabDepth/2, 0), facing +Z
Slab south wall: PlaneGeometry(worldWidth, slabDepth)
  Position: (worldWidth/2, -slabDepth/2, worldHeight), facing -Z
Slab east wall:  PlaneGeometry(worldHeight, slabDepth)
  Position: (worldWidth, -slabDepth/2, worldHeight/2), facing -X
Slab west wall:  PlaneGeometry(worldHeight, slabDepth)
  Position: (0, -slabDepth/2, worldHeight/2), facing +X
Slab bottom:     PlaneGeometry(worldWidth, worldHeight)
  Position: (worldWidth/2, -slabDepth, worldHeight/2), rotated flat
```

The slab top edge is at Y=0. The terrain surface mesh starts at approximately Y=0 and rises with elevation — this slight overhang is intentional and matches the concept art appearance (terrain appears to rest on top of the slab).

### Texture Strategy

**Canonical TSL `triplanarTexture` signature** (confirmed against Three.js `dev` source, `docs/pages/TSL.html`):

```
triplanarTexture(
  textureXNode,          // Required. Texture sampled on the X-facing projection.
  textureYNode?,         // Optional; defaults to null → samples textureXNode on Y.
  textureZNode?,         // Optional; defaults to null → samples textureXNode on Z.
  scaleNode?,            // Optional float. Default float(1). This IS the tiling scale.
  positionNode?,         // Optional vec3. Default positionLocal.
  normalNode?,           // Optional vec3. Default normalLocal.
) → Node<vec4>
```

Key clarification: the 4th argument is the *tiling scale*, not blend sharpness. Passing a single texture (X only) samples the same texture on all three axes — appropriate for an isotropic ground/rock material where we don't need separate top/side textures.

**Node graph with textures present:**

```
blendFactor      = smoothstep(uSlopeBlendLow, uSlopeBlendHigh, normalWorld.y)

surfaceDiffuse   = triplanarTexture(texture(surfaceMap), null, null, uTextureScale)
cliffDiffuse     = triplanarTexture(texture(cliffMap),   null, null, uTextureScale)
colorNode        = mix(cliffDiffuse.mul(uCliffColor), surfaceDiffuse.mul(uSurfaceColor), blendFactor)

// Normal maps: non-triplanar fallback — TSL has no first-class triplanar normal map.
// triplanar-sampled tangent-space normals would need per-axis re-orientation, which
// normalMap() does not do. Using uv() is simpler and correct on the flat PlaneGeometry
// terrain mesh; seam artifacts at steep slopes are acceptable for this slice.
surfaceNormal    = normalMap(texture(surfaceNormalMap, uv().mul(uTextureScale)))
cliffNormal      = normalMap(texture(cliffNormalMap,   uv().mul(uTextureScale)))
normalNode       = mix(cliffNormal, surfaceNormal, blendFactor)
```

**Node graph without textures (slice 110 behavior, unchanged):**

```
colorNode        = mix(uCliffColor, uSurfaceColor, blendFactor)
normalNode       = (not set — default geometry normals)
```

Color uniforms (`uSurfaceColor`, `uCliffColor`) from slice 110 are preserved in the textured path as tints (multiplied against the sampled diffuse). This keeps the committed alien-vegetation palette governing overall mood regardless of the raw texture's color cast, and keeps the solid-color path of slice 110 literally identical to before.

`createTerrainMaterial` branches on whether `biome.surfaceTexturePath` is defined. The two node graphs are structurally different; switching between them requires creating a new material (not just updating uniforms). This is fine because texture-configuration changes are rare (biome switches), not per-frame.

### Handle contract: texture-aware `updateBiome`

Slice 110's `TerrainMaterialHandle.updateBiome()` is uniform-only — it mutates `.value` on existing uniform nodes. Slice 111 resolves the contract ambiguity by **keeping the single-method interface**:

```ts
export interface TerrainMaterialHandle {
  material: THREE.MeshStandardNodeMaterial;   // reference may change on texture-path swap
  updateBiome: (biome: BiomeConfig) => void;  // rebuilds material internally if needed
}
```

`updateBiome()` compares the incoming texture paths against the previous call. If any texture path changed (added, removed, or swapped), it disposes the old material, constructs a fresh one via the same factory path, and assigns it to `this.material`. Consumers that hold a direct material reference (e.g. `mesh.material = handle.material`) must re-read `handle.material` after calling `updateBiome()`. For slice 111, only `main.ts` does this and the call site is straightforward:

```ts
materialHandle.updateBiome(newBiome);
terrainMesh.material = materialHandle.material;  // idempotent when unchanged
slabHandle.updateBiome(newBiome);                // same pattern
```

This is simpler than introducing a separate `rebuildMaterial()` method and keeps slice 110's public contract compatible — existing uniform-only biome updates still work without a material swap.

### Texture tiling scale

`uTextureScale = uniform(biome.textureScale)` is passed as the 4th argument to `triplanarTexture`. For normal maps (non-triplanar fallback), the same uniform multiplies `uv()` to keep tiling density visually consistent between the triplanar diffuse and the UV-sampled normals. The `textureScale` field in `BiomeConfig` is a uniform — runtime-tunable via `updateBiome()` without a shader recompile.

Units: `textureScale` is a float multiplier on the local-position coordinates fed into the triplanar projection. Larger values = tighter tiling (more repetitions per world unit). Empirical tuning is expected during implementation; the default `0.05` in the BiomeConfig table below is a starting point, not a confirmed value.

### Slab Material

The slab walls and bottom use a simpler material — always cliff appearance, no slope blending:

- When `cliffTexturePath` is absent: `MeshStandardNodeMaterial` with solid `cliffColor`, `cliffRoughness`, `cliffMetalness` from `BiomeConfig` (uniform-backed, consistent with terrain material)
- When `cliffTexturePath` is present: `texture(cliffMap)` applied via standard UV (slab walls are flat planes — triplanar is unnecessary for flat geometry)

The slab material is created once per biome. It can be a shared material across all five slab meshes — they all use the same cliff appearance.

## Technical Decisions

### New `slab.ts` module (not terrain.ts)
The slab is geometrically and materially distinct from the terrain surface — different mesh lifecycle (5 meshes resized on world-bounds change), different material (cliff-only, no slope blend). Keeping it separate from `terrain.ts` preserves the ~300-line file limit and keeps concerns separated.

### Textures as optional fields in BiomeConfig
Making texture paths optional (`surfaceTexturePath?: string`) preserves the slice 110 fallback exactly — a `BiomeConfig` with no texture fields renders identically to slice 110. This means slice 111 does not break slice 110 behavior if textures are not sourced yet.

### Texture files in `public/textures/biomes/`
Vite serves `public/` as static assets at the root URL. Texture paths in `BiomeConfig` are root-relative (e.g. `/textures/biomes/alien/surface-diffuse.jpg`). This works in both dev (`pnpm dev`) and production (`pnpm build`) without any loader configuration.

### CC0 texture sourcing (Poly Haven)
[Poly Haven](https://polyhaven.com/textures) provides CC0-licensed PBR texture sets (diffuse, normal, roughness). For the alien vegetation biome, appropriate candidates:
- **Surface (flat terrain):** a mossy/organic ground texture (e.g. "Mossy Ground", "Forest Floor"). Tint should be compatible with the committed `surfaceColor` `0x1a3d1a` (dark green) — either the raw texture already reads dark-green, or the shader tints the sampled diffuse by the surface-color uniform.
- **Cliff (steep faces):** a dark rock texture (e.g. "Rock Cliff", "Granite"). Similar consideration with `cliffColor` `0x231810`.

Textures should be downloaded at 2K resolution (2048×2048 px). File format: JPG for diffuse (smaller), JPG or PNG for normal maps.

**Color-tint decision:** When a texture is present, does the shader still multiply by the color uniform, or does the texture fully replace it? The cleanest approach is to keep the color uniforms as *tints* (multiply) so the committed alien-vegetation palette still governs the overall mood regardless of the raw texture's color cast. This is an implementation-time decision; both options are viable.

### Triplanar normal maps — decision: non-triplanar normals
TSL ships `triplanarTexture` and `normalMap`, but not a combined "triplanar normal map" primitive. Correctly triplanar-sampling a tangent-space normal map requires re-orienting each projected sample into the geometry's tangent frame — `normalMap()` wrapped around a `triplanarTexture` sample would produce wrong normals (the sampled RGB is interpreted in tangent space but came from three different projections).

**Decision for this slice:** apply normal maps *non-triplanar* via standard UV — `normalMap(texture(normalMap, uv().mul(uTextureScale)))`. This is correct on the `PlaneGeometry` terrain mesh (one dominant projection axis already), and slab walls are flat planes where UV sampling is naturally correct. Minor seam artifacts at steep slope transitions on the terrain are an accepted visual compromise for this slice. A future slice can investigate bespoke triplanar-normal blending if the artifacts prove distracting.

### SlabHandle interface

```ts
export interface SlabHandle {
  group: THREE.Group;
  /** Rebuild slab geometry to new world dimensions. */
  resize: (worldWidth: number, worldHeight: number) => void;
  /** Update slab material to match new biome (cliff color/texture). */
  updateBiome: (biome: BiomeConfig) => void;
}
```

`updateBiome` on the slab updates cliff color uniforms. If `cliffTexturePath` changed, `updateBiome` rebuilds the slab material (acceptable cost for a rare event).

## BiomeConfig Extension

```ts
export interface BiomeConfig {
  // --- slice 110 fields (unchanged) ---
  surfaceColor: number;
  cliffColor: number;
  surfaceRoughness: number;
  cliffRoughness: number;
  surfaceMetalness: number;
  cliffMetalness: number;
  slopeBlendLow: number;
  slopeBlendHigh: number;

  // --- slice 111 additions ---
  /** World units per texture tile. Controls tiling density. */
  textureScale: number;
  /** Root-relative path to diffuse texture for flat terrain. Absent = use surfaceColor. */
  surfaceTexturePath?: string;
  /** Root-relative path to diffuse texture for cliff faces. Absent = use cliffColor. */
  cliffTexturePath?: string;
  /** Root-relative path to normal map for flat terrain. */
  surfaceNormalPath?: string;
  /** Root-relative path to normal map for cliff faces. */
  cliffNormalPath?: string;
}
```

Default alien vegetation biome additions:

| Field | Value |
|---|---|
| `textureScale` | `0.05` (20 world units per tile at default scale — adjust during tuning) |
| `surfaceTexturePath` | `/textures/biomes/alien/surface-diffuse.jpg` |
| `cliffTexturePath` | `/textures/biomes/alien/cliff-diffuse.jpg` |
| `surfaceNormalPath` | `/textures/biomes/alien/surface-normal.jpg` |
| `cliffNormalPath` | `/textures/biomes/alien/cliff-normal.jpg` |

`textureScale` has a sensible default even with textures absent, so it need not be optional.

## Integration Points

### Provides
- Completed visual target matching concept art
- `SlabHandle` interface for future biome-switching or slab-depth control
- `BiomeConfig` texture field contract for any future biome definitions

### Consumes from Slice 110
- `BiomeConfig` interface (extended, not replaced)
- `TerrainMaterialHandle` from `createTerrainMaterial`
- Slope-blend node graph structure (texture nodes are inserted into the same graph)

## Success Criteria

### Functional Requirements
- [ ] Slab is visible — 4 walls and a bottom face, correctly positioned at world edges, extending `slabDepth` below Y=0
- [ ] Slab walls show cliff color/texture; no slope-based blending on flat walls
- [ ] Slab geometry is rebuilt when world bounds change
- [ ] When texture paths are present in `BiomeConfig`, terrain surface shows texture (not solid color)
- [ ] No visible UV seams on sloped terrain areas (triplanar projection working)
- [ ] Normal maps add surface detail visible under directional light
- [ ] When texture paths are absent in `BiomeConfig`, solid-color fallback from slice 110 is preserved exactly

### Technical Requirements
- [ ] `src/rendering/slab.ts` is a new module, under 300 lines
- [ ] `pnpm tsc --noEmit` clean
- [ ] `pnpm test --run` passes (existing tests unbroken)
- [ ] `pnpm build` clean
- [ ] No shader compilation errors with `renderer.debug.checkShaderErrors = true`

### Verification Walkthrough

**Pre-flight:**
```bash
pnpm tsc --noEmit
pnpm test --run
pnpm build
```

**Slab verification:**
1. `pnpm dev` — connect to a world server. In perspective camera mode, orbit the camera to a low angle looking at the terrain edge.
2. The terrain should appear as a thick slab: dark rocky walls on the sides, a flat bottom.
3. Orbit around all four sides to confirm all walls are present and correctly positioned.
4. If the world server sends a different world size on reconnect, verify the slab resizes correctly.

**Texture verification:**
5. With texture files present in `public/textures/biomes/alien/`, the terrain surface should show organic texture detail — not a flat solid green.
6. On steep cliff areas, the rock texture should be visible. The transition between surface and cliff textures should be smooth (following the slope blend from slice 110).
7. Look for UV seam artifacts on slopes (sharp lines where the texture projection changes). These should not be visible with triplanar mapping working correctly.
8. Open browser console — confirm no shader compilation warnings or errors.

**Fallback verification:**
9. Temporarily remove all texture paths from `BiomeConfig` in `config.ts` and reload. Confirm the terrain renders with solid colors (slice 110 behavior) — no errors, no blank meshes.

**Visual target check:**
10. Compare against `project-documents/user/reference/concept-art/migratory-terrain-concept.png`. The terrain surface texture character, slab depth, and overall composition should be consistent with the concept art.

## Risk Assessment

### Slab-wall lighting (issue #1)
Slab walls are the first near-vertical geometry in the scene. If the directional lighting contrast issue filed as [#1](https://github.com/ecorkran/migratory-viewer/issues/1) manifests on slab walls as flat/uniform shading, success criterion *"slab walls show cliff color/texture"* may pass but feel visually wrong (no sense of depth or direction). This does not block slice 111 *delivery* but may elevate #1 from deferred to blocking for the visual target check.

**Mitigation:** During visual verification, check that slab walls show directional shading variation when the sun is low and the camera is near-parallel to a wall. If they look uniformly lit, pause slice 111 and investigate issue #1 first (likely fix: set `directionalLight.target` to world center so the light aims at the slab instead of `(0,0,0)`).

## Implementation Notes

### Suggested Order
1. Add `slabDepth` and `textureScale` to `ViewerConfig`/`BiomeConfig`; extend `BiomeConfig` with optional texture path fields in `config.ts`.
2. Create `slab.ts` with flat-colored slab geometry (uniform-backed cliff color/roughness/metalness material, no textures) — verify slab is visible in `pnpm dev`.
3. Wire slab resize into `main.ts` world-bounds change handler.
4. **Checkpoint:** visual verify slab walls show directional shading variation (gates issue #1 — see Risk Assessment).
5. Source CC0 textures, place in `public/textures/biomes/alien/`.
6. Add diffuse texture loading to `createTerrainMaterial` — `triplanarTexture(texture(map), null, null, uTextureScale)`, tinted by color uniform. Verify tiling looks right against concept art.
7. Add non-triplanar normal maps via `normalMap(texture(normalMap, uv().mul(uTextureScale)))`.
8. Extend `TerrainMaterialHandle.updateBiome()` to detect texture-path changes and rebuild the material (preserve single-method contract).
9. Update slab material to use cliff texture via standard UV when present (flat planes — no triplanar needed).
10. Visual tuning: `textureScale`, `slabDepth` against concept art.

### Testing Strategy
Unit tests cover geometry construction (slab dimensions, mesh count, wall positions, bottom-face orientation). Visual correctness — texture appearance, triplanar seam elimination, slab proportions — is verified manually against the concept art. The existing terrain height-lookup and geometry tests are unaffected.

**Mocking pattern (inherited from slice 110):** The test setup mocks `three/webgpu` (adds `MeshStandardNodeMaterial`, `Color`) and `three/tsl` (uniform/mix/smoothstep/texture nodes). Slice 111 will need to extend the `three/tsl` mock with whatever nodes the triplanar implementation uses (likely `triplanarTexture`, `positionWorld`, `normalMap`). Texture loading in tests can be stubbed — `TextureLoader.load` returns a placeholder `THREE.Texture` — because tests verify the *node graph construction*, not the sampled pixel output.

### Build / verification gates (inherited)

Slice 110 established these pre-commit gates; slice 111 uses the same:
- `pnpm tsc --noEmit`
- `pnpm test --run`
- `pnpm build`
- `renderer.debug.checkShaderErrors = true` is already wired behind `import.meta.env.DEV` in [src/rendering/scene.ts](src/rendering/scene.ts) — any TSL node graph error in slice 111 will surface in the browser console during `pnpm dev`.
