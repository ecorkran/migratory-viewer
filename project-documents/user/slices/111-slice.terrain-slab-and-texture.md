---
docType: slice-design
slice: terrain-slab-and-texture
project: migratory-viewer
parent: user/architecture/100-slices.viewer-foundation.md
dependencies: [110-terrain-surface-material]
interfaces: []
dateCreated: 20260422
dateUpdated: 20260422
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
- **Slice 110 (Terrain Surface Material):** `BiomeConfig`, `TerrainMaterialHandle`, and `createTerrainMaterial` must be in place. This slice extends them.
- **Texture assets:** CC0 texture files must be present in `public/textures/biomes/alien/` before visual verification is possible.

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

**Node graph with textures present:**

```
blendFactor = smoothstep(slopeBlendLow, slopeBlendHigh, normalWorld.y)

surfaceDiffuse = triplanarTexture(texture(surfaceMap), scale)
cliffDiffuse   = triplanarTexture(texture(cliffMap), scale)
colorNode      = mix(cliffDiffuse, surfaceDiffuse, blendFactor)

surfaceNormal  = normalMap(triplanarTexture(texture(surfaceNormalMap), scale))
cliffNormal    = normalMap(triplanarTexture(texture(cliffNormalMap), scale))
normalNode     = mix(cliffNormal, surfaceNormal, blendFactor)
```

**Node graph without textures (slice 110 behavior, unchanged):**

```
colorNode      = mix(cliffColorUniform, surfaceColorUniform, blendFactor)
normalNode     = (not set — default geometry normals)
```

`createTerrainMaterial` branches on whether `biome.surfaceTexturePath` is defined. The two node graphs are structurally different; switching between them requires creating a new material (not just updating uniforms). This is fine because texture-configuration changes are rare (biome switches), not per-frame.

**Texture tiling:**
`triplanarTexture` in TSL takes a "blend sharpness" float as its fourth parameter — this controls how sharply the three projection axes blend, not texture tiling. Controlling tiling frequency requires scaling the world-position coordinates used in the triplanar projection. The exact TSL API for this (likely `positionWorld.mul(textureScale)` passed into the triplanar sampler, or a scale parameter on the `texture()` node) must be verified during implementation against Three.js r183+ source. The `textureScale` field in `BiomeConfig` captures the intent; the implementer should consult `three/tsl` source or examples to confirm the correct form.

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
- **Surface (flat terrain):** a mossy/organic ground texture (e.g. "Mossy Ground", "Forest Floor")
- **Cliff (steep faces):** a dark rock texture (e.g. "Rock Cliff", "Granite")

Textures should be downloaded at 2K resolution (2048×2048 px). File format: JPG for diffuse (smaller), JPG or PNG for normal maps.

### Triplanar normal maps — implementation-time decision
Triplanar normal mapping requires blending normals computed from three different tangent-space projections. TSL's `triplanarTexture` may or may not handle this correctly for `normalNode`. If it does not work cleanly, the fallback for this slice is:
1. Apply normal maps non-triplanar (standard UV from `uv()`), accepting minor seam artifacts at slope transitions
2. Or skip normal maps and defer to a future dedicated slice

This decision is made during implementation with `renderer.debug.checkShaderErrors = true` active.

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

### Triplanar normal mapping compatibility
The `triplanarTexture` TSL function is confirmed for diffuse textures (from tool guide and context7). Normal map blending via triplanar involves tangent-space normal transformation across three projection axes — this is more complex and may not work cleanly with TSL's `normalMap()` wrapper. If it doesn't, the fallback (non-triplanar normal maps with standard UV) still improves visual quality over no normal maps, and the decision is made during implementation.

**Mitigation:** Implement diffuse triplanar first, confirm it works, then attempt triplanar normals. If triplanar normals fail, apply `normalMap(texture(normalMapTexture, uv()))` as the non-triplanar fallback and document the decision.

### Texture tiling scale API
The exact TSL mechanism for controlling `triplanarTexture` tiling frequency is not confirmed from tool guides. `positionWorld.mul(textureScale)` is the likely approach, but the `triplanarTexture` function signature needs verification.

**Mitigation:** Verify against Three.js r183+ source or `three/tsl` examples during implementation. The `textureScale` config field is defined correctly regardless — it maps to whatever the correct TSL expression turns out to be.

## Implementation Notes

### Suggested Order
1. Add `slabDepth` to `ViewerConfig`; create `slab.ts` with flat-colored slab geometry — verify slab is visible
2. Wire slab resize into `main.ts` world-bounds change handler
3. Extend `BiomeConfig` with texture fields in `config.ts`
4. Source CC0 textures, place in `public/textures/biomes/alien/`
5. Add texture loading to `createTerrainMaterial` — start with diffuse only, verify triplanar tiling
6. Add normal map support — verify triplanar normal maps, apply fallback if needed
7. Update slab material to use cliff texture when present
8. Visual tuning: texture scale, slab depth against concept art

### Testing Strategy
Unit tests cover geometry construction (slab dimensions, mesh count). Visual correctness — texture appearance, triplanar seam elimination, slab proportions — is verified manually against the concept art. The existing terrain height-lookup and geometry tests are unaffected.
