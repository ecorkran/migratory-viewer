---
docType: tasks
slice: terrain-slab-and-texture
project: migratory-viewer
lld: user/slices/111-slice.terrain-slab-and-texture.md
dependencies: [110-terrain-surface-material]
projectState: Slice 110 complete and merged to main (commits c8401ed, b385ad0, aae4d6e, 8cfaccc). BiomeConfig, TerrainMaterialHandle, createTerrainMaterial() in place. 54 tests passing, build clean. Open issue #1 tracks weak directional lighting contrast at low camera angles — may become blocking for slab-wall visual verification.
dateCreated: 20260423
dateUpdated: 20260423
status: not_started
---

## Context Summary

- Working on slice 111: Terrain Slab and Texture
- Adds (a) geological slab depth — 5-mesh group with 4 walls + bottom, sized to world bounds — and (b) texture maps (diffuse + normal) to the terrain surface material via triplanar sampling for diffuse, non-triplanar UV for normals
- Extends `BiomeConfig` with optional texture path fields and a `textureScale` uniform
- Extends `TerrainMaterialHandle.updateBiome()` to rebuild the material when texture paths change (single-method contract preserved)
- Adds new `src/rendering/slab.ts` module with `SlabHandle { group, resize, updateBiome }`
- Textures are optional: when absent, slice 110's solid-color behavior is preserved exactly
- Open risk: issue #1 (directional lighting contrast) — checkpoint task T8 gates progression into texture work until slab-wall shading is verified
- Next planned slice: none remaining in the slice plan after 111 (other than deferred/future items)

Authoritative TSL signature used throughout:

```
triplanarTexture(textureXNode, textureYNode?, textureZNode?, scaleNode?, positionNode?, normalNode?)
```

The 4th argument is tiling scale (`Node<float>`, default `float(1)`), confirmed against Three.js `dev` source.

---

## Tasks

- [ ] **T1 — Extend `BiomeConfig` and add `slabDepth` in `config.ts`** *(effort: 1)*
  - [ ] Add new optional fields to `BiomeConfig`: `surfaceTexturePath?: string`, `cliffTexturePath?: string`, `surfaceNormalPath?: string`, `cliffNormalPath?: string`
  - [ ] Add required field `textureScale: number` to `BiomeConfig`
  - [ ] Update `DEFAULT_BIOME` with `textureScale: 0.05` and the four texture paths from the slice design table
  - [ ] Add `slabDepth: number` to `ViewerConfig` interface
  - [ ] Set `slabDepth` in the `config` object to a sensible starting value (e.g. `30` — tune later)
  - [ ] **Success:** `pnpm tsc --noEmit` clean; `DEFAULT_BIOME` contains all new fields; no other file references break

- [ ] **T2 — Commit config extensions** *(effort: 1)*
  - [ ] Stage `src/config.ts`
  - [ ] Commit: `feat(config): extend BiomeConfig with texture fields and add slabDepth`
  - [ ] **Success:** Commit created; `pnpm tsc --noEmit` and `pnpm test --run` pass on the commit

- [ ] **T3 — Create `src/rendering/slab.ts` with flat-colored slab geometry** *(effort: 3)*
  - [ ] Create new file `src/rendering/slab.ts`
  - [ ] Define and export `SlabHandle` interface per the slice design: `{ group: THREE.Group; resize: (w: number, h: number) => void; updateBiome: (biome: BiomeConfig) => void }`
  - [ ] Implement `createSlab(scene: THREE.Scene, biome: BiomeConfig, slabDepth: number): SlabHandle`:
    - [ ] Build a uniform-backed `MeshStandardNodeMaterial` (cliff color / roughness / metalness only — no slope blend, no textures in this task)
    - [ ] Construct `THREE.Group`; add to `scene` once
    - [ ] Create five `PlaneGeometry` meshes (4 walls + bottom) following the positions/sizes in the slice design's Slab Geometry section
    - [ ] Each wall is oriented so its outward-facing side is visible (set mesh rotation accordingly; confirm the normal points away from world center)
    - [ ] Bottom is rotated flat (`rotateX(-π/2)` or equivalent), positioned at `Y = -slabDepth`
    - [ ] Store references to the five meshes on the handle's closure so `resize` can dispose and rebuild geometries
    - [ ] `resize(worldWidth, worldHeight)` disposes old geometries and rebuilds all five planes at the new dimensions
    - [ ] `updateBiome(biome)` updates the cliff color / roughness / metalness uniforms on the shared slab material (uniform-only in this task — texture rebuild lands in T12)
  - [ ] Keep the file under 300 lines
  - [ ] **Success:** `pnpm tsc --noEmit` clean; `slab.ts` exports `createSlab` and `SlabHandle`

- [ ] **T4 — Tests: slab geometry construction** *(effort: 2)*
  - [ ] Create `src/rendering/slab.test.ts`
  - [ ] Extend the `three/webgpu` mock as needed (add `Group` if not already present) and the `three/tsl` mock if the slab material uses any new nodes beyond those already mocked in slice 110
  - [ ] Test: `createSlab` adds a `Group` to the supplied scene and the group contains exactly 5 meshes
  - [ ] Test: the four wall meshes are positioned at the four world-edge midpoints at `Y = -slabDepth/2` (verify each wall's `position` vector)
  - [ ] Test: the bottom mesh is positioned at `(worldWidth/2, -slabDepth, worldHeight/2)`
  - [ ] Test: `resize(w, h)` replaces mesh geometries (assert geometry identity changed after call) and new positions reflect the new dimensions
  - [ ] Test: `updateBiome(newBiome)` mutates uniform `.value` fields on the shared slab material
  - [ ] **Success:** `pnpm test --run` green; new tests named clearly under a `describe('slab', …)` block

- [ ] **T5 — Wire slab creation and resize into `main.ts`** *(effort: 2)*
  - [ ] Import `createSlab` and `SlabHandle` from `src/rendering/slab.ts`
  - [ ] Call `createSlab(scene, config.biomeConfig, config.slabDepth)` during viewer initialization (after scene creation, before the render loop starts)
  - [ ] Identify the existing world-bounds change handler (the same code path that resizes terrain / camera on snapshot / TERRAIN-message world-size changes)
  - [ ] In that handler, call `slabHandle.resize(worldWidth, worldHeight)` after the terrain handler runs
  - [ ] **Success:** `pnpm tsc --noEmit` clean; `pnpm dev` renders without console errors; slab `THREE.Group` is in the scene graph

- [ ] **T6 — Tests: `main.ts` slab wiring** *(effort: 1)*
  - [ ] If `main.ts` has existing wiring tests, extend them to assert that `createSlab` is called during init and that the world-bounds change handler triggers `slabHandle.resize`
  - [ ] If no such tests exist (main.ts is currently manually verified), skip test additions and document the decision in the commit message — visual verification in T8 covers this
  - [ ] **Success:** Any added tests pass; no regressions in existing tests

- [ ] **T7 — Commit slab module + wiring** *(effort: 1)*
  - [ ] Stage `src/rendering/slab.ts`, `src/rendering/slab.test.ts`, and `src/main.ts`
  - [ ] Commit: `feat(terrain): add slab geometry module and wire into main`
  - [ ] **Success:** Commit created; `pnpm tsc --noEmit`, `pnpm test --run`, `pnpm build` all pass

- [ ] **T8 — Checkpoint: visual verification of slab + directional lighting** *(effort: 2)*
  - [ ] Run `pnpm dev` and connect to a world server that sends TERRAIN
  - [ ] Switch to perspective camera mode; orbit to a low angle looking at the terrain edge
  - [ ] Confirm: slab is visible as a thick, dark, floating platform; all 4 walls and bottom are present at correct positions; terrain appears to rest on top
  - [ ] Orbit fully around the world to confirm all four walls render correctly (no missing faces, no inverted normals)
  - [ ] **Issue #1 gate:** rotate the scene so the sun is low and nearly parallel to one of the slab walls. The wall should show *visible* shading variation — one side lit, opposite side darker. If walls are uniformly shaded, **STOP** and investigate issue #1 (likely fix: set `directionalLight.target` to world center `(worldWidth/2, 0, worldHeight/2)` so the light aims at the slab, not world origin)
  - [ ] If a server sends a different world size on reconnect, verify slab resizes correctly
  - [ ] **Success:** Slab renders correctly on all sides; directional shading is visible on walls; if issue #1 manifested, it was resolved (document the fix in the slice design's Risk Assessment as a follow-up) before proceeding

- [ ] **T9 — Place CC0 texture assets in `public/textures/biomes/alien/`** *(effort: 1)*
  - [ ] Create directory `public/textures/biomes/alien/` if absent
  - [ ] Source four CC0 textures from Poly Haven (surface diffuse, surface normal, cliff diffuse, cliff normal) at 2K resolution — see slice design's "CC0 texture sourcing" section for candidate names
  - [ ] Save files with the exact names referenced in `DEFAULT_BIOME`: `surface-diffuse.jpg`, `surface-normal.jpg`, `cliff-diffuse.jpg`, `cliff-normal.jpg`
  - [ ] Verify files are valid images by opening in a viewer
  - [ ] **Success:** All four files exist at the expected paths; `pnpm dev` serves them at the root-relative URLs listed in `DEFAULT_BIOME`

- [ ] **T10 — Extend `createTerrainMaterial()` with diffuse textures and tiling scale uniform** *(effort: 3)*
  - [ ] In `src/rendering/terrain.ts`, import additional TSL nodes: `texture`, `triplanarTexture`, `uv`, `normalMap` from `three/tsl`; `TextureLoader` from `three/webgpu` (or `three` core — use whichever is correct for this build)
  - [ ] Add a `uTextureScale = uniform(biome.textureScale)` node alongside the existing uniforms
  - [ ] Branch `createTerrainMaterial` on `biome.surfaceTexturePath !== undefined`:
    - [ ] **Textured path:** load `surfaceTexturePath` and `cliffTexturePath` via `TextureLoader`; pass the `THREE.Texture` handles to `triplanarTexture(texture(map), null, null, uTextureScale)`; compose `colorNode = mix(cliffDiffuse.mul(uCliffColor), surfaceDiffuse.mul(uSurfaceColor), blendFactor)` (color uniforms act as tints)
    - [ ] **Solid-color path:** identical to slice 110 — `colorNode = mix(uCliffColor, uSurfaceColor, blendFactor)` (no regression)
  - [ ] Keep `roughnessNode` and `metalnessNode` unchanged from slice 110 (uniform mix) — textures for these are not in scope this slice
  - [ ] **Success:** `pnpm tsc --noEmit` clean; `createTerrainMaterial` compiles both paths; `pnpm dev` renders textured terrain with tiling visible; no console shader errors with `checkShaderErrors` active

- [ ] **T11 — Tests: textured material node graph** *(effort: 2)*
  - [ ] Extend `three/tsl` mock with `texture`, `triplanarTexture`, `uv`, `normalMap` stubs that return identifiable tagged objects (so tests can assert they were called with the right arguments)
  - [ ] Mock `TextureLoader.load` to return a placeholder `THREE.Texture`
  - [ ] Test: `createTerrainMaterial` with a biome containing texture paths calls `triplanarTexture` exactly twice (surface + cliff) and passes `uTextureScale` as the 4th argument
  - [ ] Test: `createTerrainMaterial` without texture paths does NOT call `triplanarTexture` (solid-color path unchanged)
  - [ ] Test: existing slice 110 material tests still pass unchanged
  - [ ] **Success:** `pnpm test --run` green; both texture-path and no-texture-path branches covered

- [ ] **T12 — Add non-triplanar normal maps to `createTerrainMaterial()`** *(effort: 2)*
  - [ ] In the textured branch, additionally load `surfaceNormalPath` and `cliffNormalPath` when present
  - [ ] Compose `surfaceNormal = normalMap(texture(surfaceNormalTexture, uv().mul(uTextureScale)))` and matching `cliffNormal`
  - [ ] Set `material.normalNode = mix(cliffNormal, surfaceNormal, blendFactor)` only when both normal paths are present; otherwise leave `normalNode` unset (geometry normals)
  - [ ] Handle partial presence gracefully: if only one of the two normal paths is defined, skip normal mapping entirely (don't fall back to one-sided normals — keep the contract simple)
  - [ ] **Success:** `pnpm tsc --noEmit` clean; terrain shows visible surface relief under directional light in `pnpm dev`; no shader errors

- [ ] **T13 — Tests: normal-map node graph** *(effort: 1)*
  - [ ] Test: with both normal paths present, `normalMap` is called twice and `material.normalNode` is set
  - [ ] Test: with normal paths absent, `material.normalNode` is not set (property is `undefined` or whatever the pre-assignment state is)
  - [ ] Test: with only one normal path present, `normalNode` is not set (partial-presence fallback)
  - [ ] **Success:** `pnpm test --run` green

- [ ] **T14 — Extend `TerrainMaterialHandle.updateBiome()` to handle texture-path changes** *(effort: 2)*
  - [ ] Store the last-applied texture paths on the handle's closure
  - [ ] In `updateBiome(b)`, compare each of the four texture paths against the stored previous values
  - [ ] If any path changed (including added or removed), dispose the existing `material` and call the internal material-construction routine with the new biome; assign the result to the handle's `material` property
  - [ ] If no texture paths changed, preserve slice 110 behavior: mutate uniform `.value` fields only (including `uTextureScale`)
  - [ ] Document that consumers must re-read `handle.material` after calling `updateBiome()` (add a brief comment above the interface)
  - [ ] Update `createTerrainMesh` in `terrain.ts` and the corresponding `main.ts` call site to re-read `handle.material` and assign it to `mesh.material` after each `updateBiome` call (idempotent when unchanged)
  - [ ] **Success:** `pnpm tsc --noEmit` clean; calling `updateBiome` with a new texture path in browser console swaps the terrain texture live

- [ ] **T15 — Tests: texture-aware `updateBiome`** *(effort: 2)*
  - [ ] Test: `updateBiome` with identical texture paths does not replace `handle.material` (reference equality preserved)
  - [ ] Test: `updateBiome` with a changed `surfaceTexturePath` replaces `handle.material` (reference changes)
  - [ ] Test: `updateBiome` with only a color change (no path change) mutates uniform values, does not replace material
  - [ ] **Success:** `pnpm test --run` green

- [ ] **T16 — Commit terrain material texture support** *(effort: 1)*
  - [ ] Stage `src/rendering/terrain.ts`, terrain test file, and any touched call sites in `main.ts`
  - [ ] Commit: `feat(terrain): add triplanar diffuse and normal maps to terrain material`
  - [ ] **Success:** Commit created; `pnpm tsc --noEmit`, `pnpm test --run`, `pnpm build` all pass

- [ ] **T17 — Update slab material to use cliff texture when present** *(effort: 2)*
  - [ ] In `src/rendering/slab.ts`, when `biome.cliffTexturePath` is defined, build the slab material with `texture(cliffTexture, uv().mul(uTextureScale))` on `colorNode` instead of the solid `uCliffColor` (keep the color uniform as a tint — `mul`)
  - [ ] When `biome.cliffNormalPath` is defined, also set `material.normalNode = normalMap(texture(cliffNormalTexture, uv().mul(uTextureScale)))`
  - [ ] Extend `slab.updateBiome(biome)` to rebuild the slab material (and reassign it on all 5 meshes) when any cliff texture path changed — analogous to T14
  - [ ] The slab uses standard UV sampling (no triplanar) because the walls and bottom are flat planes
  - [ ] **Success:** `pnpm tsc --noEmit` clean; `pnpm dev` renders textured slab walls matching the cliff texture; `pnpm test --run` still green (extend slab tests if the material-swap path is non-trivial)

- [ ] **T18 — Tests: textured slab material** *(effort: 1)*
  - [ ] Test: `createSlab` with a biome containing `cliffTexturePath` assigns a texture-backed `colorNode` to the slab material
  - [ ] Test: `slab.updateBiome` with a changed `cliffTexturePath` rebuilds the slab material (all 5 meshes have the new material reference)
  - [ ] Test: `createSlab` without texture paths preserves uniform-only material (no regression)
  - [ ] **Success:** `pnpm test --run` green

- [ ] **T19 — Commit textured slab material** *(effort: 1)*
  - [ ] Stage `src/rendering/slab.ts` and its test file
  - [ ] Commit: `feat(terrain): add cliff texture support to slab material`
  - [ ] **Success:** Commit created; all three verification gates pass

- [ ] **T20 — Visual tuning: `textureScale` and `slabDepth`** *(effort: 2)*
  - [ ] Run `pnpm dev` and compare against `project-documents/user/reference/concept-art/migratory-terrain-concept.png`
  - [ ] Adjust `DEFAULT_BIOME.textureScale` until tiling density looks right (too low = stretched textures; too high = visible repetition)
  - [ ] Adjust `ViewerConfig.slabDepth` until the slab's visible depth matches the concept art's geological slab
  - [ ] Verify the empirical `slopeBlendLow / slopeBlendHigh` values from slice 110 (`0.65 / 0.90`) still look right with textures; retune only if needed and note the change
  - [ ] Check browser console — confirm no shader compilation warnings or errors
  - [ ] Walk through all 10 steps of the slice design's Verification Walkthrough and confirm each passes
  - [ ] **Success:** Visual match to concept art is satisfactory; all walkthrough steps pass

- [ ] **T21 — Fallback verification: BiomeConfig without texture paths** *(effort: 1)*
  - [ ] Temporarily remove all four texture paths from `DEFAULT_BIOME` (comment out or set to `undefined`) and reload `pnpm dev`
  - [ ] Confirm terrain renders with solid colors (slice 110 behavior exactly) — no errors, no blank meshes, no shader warnings
  - [ ] Confirm slab renders with solid cliff color (no textures)
  - [ ] Restore `DEFAULT_BIOME` texture paths
  - [ ] **Success:** Both paths (textured and solid) work end-to-end

- [ ] **T22 — Final build and test pass** *(effort: 1)*
  - [ ] `pnpm tsc --noEmit` — no errors
  - [ ] `pnpm test --run` — all tests pass (expect significantly more than slice 110's 54)
  - [ ] `pnpm build` — clean production build; verify texture files are either bundled or correctly served via `public/`
  - [ ] **Success:** All three commands exit 0

- [ ] **T23 — Final commit and slice closeout** *(effort: 1)*
  - [ ] Stage any remaining tuning changes (`textureScale`, `slabDepth`, possibly `slopeBlendLow/High`)
  - [ ] Commit: `feat(terrain): tune slab depth and texture scale against concept art`
  - [ ] Update slice design frontmatter: `status: complete`; rewrite Verification Walkthrough with actual commands and outcomes observed during T20
  - [ ] Update `CHANGELOG.md` with a `0.7.0` (or appropriate) entry summarizing slice 111 deliverables
  - [ ] Update slice plan entry in `project-documents/user/architecture/100-slices.viewer-foundation.md` — check the `[ ]` box for slice 111
  - [ ] Commit: `docs: mark slice 111 complete; update CHANGELOG and slice plan`
  - [ ] **Success:** Slice 111 branch/main shows 6+ semantic commits; working tree clean; all success criteria from the slice design are checked off
