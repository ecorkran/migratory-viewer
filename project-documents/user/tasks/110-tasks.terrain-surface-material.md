---
docType: tasks
slice: terrain-surface-material
project: migratory-viewer
lld: user/slices/110-slice.terrain-surface-material.md
dependencies: [102-terrain-rendering]
projectState: Slice 102 complete and merged to main. Terrain mesh uses MeshLambertMaterial with flat groundColor. 51 tests passing, build clean.
dateCreated: 20260422
dateUpdated: 20260422
status: complete
---

## Context Summary

- Working on slice 110: Terrain Surface Material
- Replaces flat `MeshLambertMaterial` with `MeshStandardNodeMaterial` driven by a TSL slope-blend node graph
- Adds `BiomeConfig` interface to `config.ts`; removes `groundColor` from `ViewerConfig`
- Adds `TerrainMaterialHandle` interface and `createTerrainMaterial()` to `terrain.ts`
- Upgrades lighting values in `config.ts` to match the alien-world concept art
- No texture maps (deferred to slice 111); no UI or protocol event triggers for biome switching
- Next slice: 111-terrain-slab-and-texture (depends on `BiomeConfig` and `TerrainMaterialHandle`)

---

## Tasks

- [x] **T1 — Add `BiomeConfig` interface and default biome to `config.ts`** *(effort: 1)*
  - [x] Add `BiomeConfig` interface with all eight fields as specified in the slice design
  - [x] Add default alien vegetation biome constant using the values from the slice design table
  - [x] Add `biomeConfig: BiomeConfig` field to `ViewerConfig` interface
  - [x] Set `biomeConfig` to the default alien vegetation biome in the `config` object
  - [x] Remove `groundColor` field from `ViewerConfig` interface and from the `config` object
  - [x] **Success:** `pnpm tsc --noEmit` passes with no errors; `groundColor` has zero remaining references in `src/`

- [x] **T2 — Fix `groundColor` consumers** *(effort: 1)*
  - [x] Run `grep -rn "groundColor" src/` to confirm all references
  - [x] Update `src/rendering/terrain.ts`: replace `config.groundColor` with a placeholder (to be superseded in T4); any direct reference must be removed
  - [x] Verify no other files reference `groundColor`
  - [x] **Success:** `pnpm tsc --noEmit` clean; `grep -rn "groundColor" src/` returns no results

- [x] **T3 — Commit config changes** *(effort: 1)*
  - [x] Stage `src/config.ts` and any updated consumers
  - [x] Commit: `feat(config): add BiomeConfig interface and default alien biome`
  - [x] **Success:** Commit created; `pnpm tsc --noEmit` and `pnpm test --run` pass on the commit

- [x] **T4 — Add `TerrainMaterialHandle` interface and `createTerrainMaterial()` to `terrain.ts`** *(effort: 3)*
  - [x] Add `TerrainMaterialHandle` interface: `{ material: THREE.MeshStandardNodeMaterial; updateBiome: (biome: BiomeConfig) => void }`
  - [x] Import TSL functions from `three/tsl`: `uniform`, `normalWorld`, `smoothstep`, `mix`
  - [x] Implement `createTerrainMaterial(biome: BiomeConfig): TerrainMaterialHandle`:
    - [x] Create one `uniform()` node per `BiomeConfig` field (eight total)
    - [x] Build `blendFactor = smoothstep(uSlopeBlendLow, uSlopeBlendHigh, normalWorld.y)`
    - [x] Set `colorNode = mix(cliffColorNode, surfaceColorNode, blendFactor)`
    - [x] Set `roughnessNode = mix(cliffRoughnessNode, surfaceRoughnessNode, blendFactor)`
    - [x] Set `metalnessNode = mix(cliffMetalnessNode, surfaceMetalnessNode, blendFactor)`
    - [x] Construct `new THREE.MeshStandardNodeMaterial()` and assign the three nodes
    - [x] Return `{ material, updateBiome }` where `updateBiome` writes new values into uniform `.value` fields
  - [x] Use `uniform(new THREE.Color(hex))` for color fields; `uniform(scalar)` for numeric fields
  - [x] **Success:** Function is exported; TypeScript compiles without errors

- [x] **T5 — Update `createTerrainMesh()` to use node material** *(effort: 1)*
  - [x] Call `createTerrainMaterial(config.biomeConfig)` inside `createTerrainMesh()`
  - [x] Assign `handle.material` to the mesh material
  - [x] Store the handle so future code can call `handle.updateBiome()` (module-level variable or returned alongside the mesh — follow the pattern described in the slice design)
  - [x] Remove the old `new THREE.MeshLambertMaterial(...)` instantiation
  - [x] **Success:** `pnpm tsc --noEmit` clean; no `MeshLambertMaterial` reference remains in `terrain.ts`

- [x] **T6 — Tests: material creation and updateBiome** *(effort: 2)*
  - [x] In the existing terrain test file, add a test asserting `createTerrainMesh()` returns a mesh whose `.material` is an instance of `THREE.MeshStandardNodeMaterial` (not `MeshLambertMaterial`)
  - [x] Add a test for `createTerrainMaterial()`: call `updateBiome()` with a different `BiomeConfig` and assert the uniform `.value` fields reflect the new values
  - [x] Confirm all existing terrain tests still pass
  - [x] **Success:** `pnpm test --run` green; new tests present and named clearly

- [x] **T7 — Commit terrain material** *(effort: 1)*
  - [x] Stage `src/rendering/terrain.ts` and test file
  - [x] Commit: `feat(terrain): add TSL slope-blend node material with BiomeConfig`
  - [x] **Success:** Commit created; `pnpm tsc --noEmit` and `pnpm test --run` pass

- [x] **T8 — Upgrade lighting values in `config.ts`** *(effort: 2)*
  - [x] Update `hemisphereSkyColor` to deep alien blue-purple (target range: `0x1a1a4e`; tune visually)
  - [x] Update `hemisphereGroundColor` to near-black green (target range: `0x0a1a0a`; tune visually)
  - [x] Update `hemisphereIntensity` to `1.0`–`1.2` range
  - [x] Update `directionalColor` to warm amber-white (target range: `0xfff5d0`; tune visually)
  - [x] Update `directionalIntensity` to `Math.PI * 1.5` (adjust during visual verification)
  - [x] Update `directionalPosition` to place key light at upper-left angle (negative X, high Y)
  - [x] All values remain in `config.ts`; `scene.ts` must not contain magic numbers — confirm it already reads from config
  - [x] **Success:** `pnpm tsc --noEmit` clean; lighting fields are updated in config only

- [x] **T9 — Enable `renderer.debug.checkShaderErrors` for development** *(effort: 1)*
  - [x] In `scene.ts` (or wherever the renderer is created), set `renderer.debug.checkShaderErrors = true` behind an `import.meta.env.DEV` guard
  - [x] **Success:** Flag is set only in dev mode; `pnpm build` produces a clean production bundle

- [x] **T10 — Visual verification against concept art** *(effort: 2)*
  - [x] Run `pnpm dev` and open the viewer in Chrome
  - [x] Connect to a world server sending TERRAIN; confirm flat plateaus render in `surfaceColor` (dark green) and steep faces in `cliffColor` (dark rock-brown)
  - [x] Confirm the transition between surface and cliff is smooth (no hard edge)
  - [x] Check browser console: no shader compilation errors
  - [x] Compare against `project-documents/user/reference/concept-art/migratory-terrain-concept.png` — color palette and contrast should match
  - [x] Rotate to a low angle: directional light should create visible depth; sky fill should be visibly blue-purple
  - [x] In browser console, call `updateBiome` with a different color (e.g., `surfaceColor: 0xff0000`) and confirm terrain updates instantly
  - [x] Connect to a server not sending TERRAIN; confirm the flat plane also uses the node material
  - [x] Tune `BiomeConfig` defaults and lighting values in `config.ts` until visual match is satisfactory
  - [x] **Success:** All eight walkthrough steps in the slice design's Verification Walkthrough section pass

- [x] **T11 — Final build and test pass** *(effort: 1)*
  - [x] `pnpm tsc --noEmit` — no errors
  - [x] `pnpm test --run` — all tests pass (≥51)
  - [x] `pnpm build` — clean production build
  - [x] **Success:** All three commands exit 0

- [x] **T12 — Final commit** *(effort: 1)*
  - [x] Stage all remaining changes (config lighting values, scene.ts debug flag, any tuned defaults)
  - [x] Commit: `feat(scene): upgrade lighting for alien-world aesthetic`
  - [x] **Success:** Commit created; working tree clean; `git log --oneline` shows three semantic commits for this slice
