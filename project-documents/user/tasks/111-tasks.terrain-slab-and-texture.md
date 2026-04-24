---
docType: tasks
slice: terrain-slab-and-texture
project: migratory-viewer
lld: user/slices/111-slice.terrain-slab-and-texture.md
dependencies: [110-terrain-surface-material]
projectState: Slice 110 complete and merged to main (commits c8401ed, b385ad0, aae4d6e, 8cfaccc). BiomeConfig, TerrainMaterialHandle, createTerrainMaterial() in place. 54 tests passing, build clean. Open issue #1 tracks weak directional lighting contrast at low camera angles — may become blocking for slab-wall visual verification.
dateCreated: 20260423
dateUpdated: 20260423
status: in_progress
---

## Context Summary

- Working on slice 111: Terrain Slab and Texture
- Adds (a) geological slab depth — walls tracking terrain edge profile + bottom face — unified into a single closed mesh with the terrain top surface, and (b) texture maps (diffuse + normal) to the terrain material via triplanar sampling for diffuse, non-triplanar UV for normals
- Extends `BiomeConfig` with optional texture path fields and a `textureScale` uniform
- Extends `TerrainMaterialHandle.updateBiome()` to rebuild the material when texture paths change (single-method contract preserved)
- **Revised design (mid-implementation):** no separate `slab.ts` module. The slab is part of the terrain mesh — one `BufferGeometry` with top surface + 4 walls + 1 bottom, sharing edge vertices, sharing the slope-blend material. Walls fall below `slopeBlendLow` naturally (`normalWorld.y ≈ 0`) and render as pure cliff. See slice design § "Unified Slab+Terrain Geometry" for rationale.
- Textures are optional: when absent, slice 110's solid-color behavior is preserved exactly
- Open risk: issue #1 (directional lighting contrast) — checkpoint in T8 gates progression into texture work until wall shading is verified
- Next planned slice: none remaining in the slice plan after 111 (other than deferred/future items)

Authoritative TSL signature used throughout:

```
triplanarTexture(textureXNode, textureYNode?, textureZNode?, scaleNode?, positionNode?, normalNode?)
```

The 4th argument is tiling scale (`Node<float>`, default `float(1)`), confirmed against Three.js `dev` source.

---

## Tasks

- [x] **T1 — Extend `BiomeConfig` and add `slabDepth` in `config.ts`** *(effort: 1)*
  - [x] Add new optional fields to `BiomeConfig`: `surfaceTexturePath?: string`, `cliffTexturePath?: string`, `surfaceNormalPath?: string`, `cliffNormalPath?: string`
  - [x] Add required field `textureScale: number` to `BiomeConfig`
  - [x] Update `DEFAULT_BIOME` with `textureScale: 0.05` and the four texture paths from the slice design table
  - [x] Add `slabDepth: number` to `ViewerConfig` interface
  - [x] Set `slabDepth` in the `config` object to a sensible starting value
  - [x] **Success:** `pnpm tsc --noEmit` clean; `DEFAULT_BIOME` contains all new fields; no other file references break

- [x] **T2 — Commit config extensions** *(effort: 1)*
  - [x] Stage `src/config.ts`
  - [x] Commit: `feat(config): extend BiomeConfig with texture fields and add slabDepth`
  - [x] **Success:** Commit created; `pnpm tsc --noEmit` and `pnpm test --run` pass on the commit

### Superseded tasks (kept for history — code to be removed in T3b)

- [x] ~~**T3 — Create `src/rendering/slab.ts` with flat-colored slab geometry**~~ — *superseded; module removed in T3b*
- [x] ~~**T4 — Tests: slab geometry construction**~~ — *superseded; test file removed in T3b*
- [x] ~~**T5 — Wire slab creation and resize into `main.ts`**~~ — *superseded; wiring replaced by unified mesh in T3b*
- [x] ~~**T6 — Tests: `main.ts` slab wiring**~~ — *no-op; no tests were added*
- [x] ~~**T7 — Commit slab module + wiring**~~ — *committed; revert/replace lands in T7b*

### Unified-mesh tasks (revised approach)

- [ ] **T3b — Remove `slab.ts`/`slab.test.ts`; extend `terrain.ts` with unified closed-mesh builder** *(effort: 3)*
  - [ ] Delete `src/rendering/slab.ts` and `src/rendering/slab.test.ts`
  - [ ] Remove `createSlab` import and wiring from `src/main.ts` (including `applyTerrain` / `applyFlat` calls on `slabHandle`)
  - [ ] In `src/rendering/terrain.ts`, extend `applyTerrainToMesh(mesh, grid)` to build a single indexed `BufferGeometry` containing:
    - [ ] Top surface: `rows × cols` vertices at `(originX + c*stepX, elevation[r*cols+c], originY + r*stepZ)` with standard row/col triangulation and UVs matching slice 110's `PlaneGeometry`-style layout
    - [ ] 4 wall strips (N/S/E/W): top-edge vertices reuse terrain-edge vertex indices; bottom-edge vertices are new at `Y = min(elevation) - slabDepth`, same XZ. Triangulation = 2 triangles per quad; UVs run along edge (u) and top-to-bottom (v)
    - [ ] Bottom face: reuses the 4 wall-bottom corner vertices; 2 triangles; UVs span `[0,1]²`
  - [ ] Read `slabDepth` from `config.slabDepth` (module-level import, same pattern as existing `createTerrainMesh`)
  - [ ] Call `geometry.computeVertexNormals()` after populating positions/indices (accepts bevelled top-edge seam — see slice design § "Normal generation")
  - [ ] Extend `applyFlatPlane(mesh, worldWidth, worldHeight)` similarly: flat top at `Y = 0`, same 4 walls + bottom geometry pattern, bottom at `Y = -slabDepth`
  - [ ] Keep `terrain.ts` readable; extract helpers (`buildWallStrip`, `buildBottomFace`) as needed; file may grow somewhat past ~200 lines but stay well under the 300-line soft limit if practical
  - [ ] **Success:** `pnpm tsc --noEmit` clean; `slab.ts` and `slab.test.ts` no longer exist; `main.ts` imports nothing from `slab.ts`; terrain mesh in the scene now contains top + walls + bottom as a single mesh

- [ ] **T4b — Tests: unified mesh construction** *(effort: 2)*
  - [ ] Update or add tests in `src/rendering/terrain.test.ts` for the unified mesh
  - [ ] Test: after `applyTerrainToMesh`, the geometry's position attribute has expected vertex count (`rows*cols + wall_bottoms`)
  - [ ] Test: after `applyTerrainToMesh`, the geometry's index attribute has expected triangle count (terrain quads + 4 wall strips × `(edge-1)` quads × 2 tris + 2 bottom tris)
  - [ ] Test: north-edge top vertices have Y equal to `elevation[0..cols-1]`; south-edge top vertices match `elevation[(rows-1)*cols + 0..cols-1]`
  - [ ] Test: all 4 wall-bottom corners + the bottom face vertices have Y = `min(elevation) - slabDepth`
  - [ ] Test: existing slice 110 behavior (height lookup via `getTerrainHeight`) is unchanged
  - [ ] **Success:** `pnpm test --run` green; new tests clearly named under `describe('applyTerrainToMesh — unified slab', …)` or similar

- [ ] **T7b — Commit unified-mesh restructure** *(effort: 1)*
  - [ ] Stage deletions of `src/rendering/slab.ts`, `src/rendering/slab.test.ts`; stage modifications to `src/rendering/terrain.ts`, `src/rendering/terrain.test.ts`, `src/main.ts`
  - [ ] Commit: `refactor(terrain): unify slab into terrain mesh as single closed geometry`
  - [ ] **Success:** Commit created; `pnpm tsc --noEmit`, `pnpm test --run`, `pnpm build` all pass

- [ ] **T8 — Checkpoint: visual verification of unified mesh + directional lighting** *(effort: 2)*
  - [ ] Run `pnpm dev` and connect to a world server that sends TERRAIN
  - [ ] Switch to perspective camera mode; orbit to a low angle looking at the terrain edge
  - [ ] Confirm: terrain block is visible with dark cliff walls on all 4 sides tracing the terrain edge profile; no gaps at top edge (walls meet terrain surface seamlessly); bottom face is visible when viewed from below
  - [ ] Orbit fully around the world to confirm all four walls render correctly (no missing faces, no inverted normals)
  - [ ] Walls should read as *pure cliff appearance* via the slope-blend (dark brown, cliff color/roughness) — not green
  - [ ] **Issue #1 gate:** rotate the scene so the sun is low and nearly parallel to one of the walls. The wall should show *visible* shading variation — one side lit, opposite side darker. If walls are uniformly shaded, **STOP** and investigate issue #1 (likely fix: set `directionalLight.target` to world center `(worldWidth/2, 0, worldHeight/2)` so the light aims at the slab, not world origin)
  - [ ] **Success:** Walls render correctly on all sides; directional shading is visible on walls; if issue #1 manifested, it was resolved before proceeding

- [ ] **T9 — Place CC0 texture assets in `public/textures/biomes/alien/`** *(effort: 1)*
  - [ ] Create directory `public/textures/biomes/alien/` if absent
  - [ ] Source four CC0 textures from Poly Haven (surface diffuse, surface normal, cliff diffuse, cliff normal) at 2K resolution — see slice design's "CC0 texture sourcing" section for candidate names
  - [ ] Save files with the exact names referenced in `DEFAULT_BIOME`: `surface-diffuse.jpg`, `surface-normal.jpg`, `cliff-diffuse.jpg`, `cliff-normal.jpg`
  - [ ] Verify files are valid images by opening in a viewer
  - [ ] **Success:** All four files exist at the expected paths; `pnpm dev` serves them at the root-relative URLs listed in `DEFAULT_BIOME`

- [ ] **T10 — Extend `createTerrainMaterial()` with diffuse textures and tiling scale uniform** *(effort: 3)*
  - [ ] In `src/rendering/terrain.ts`, import additional TSL nodes: `texture`, `triplanarTexture`, `uv`, `normalMap` from `three/tsl`; `TextureLoader` from `three` core
  - [ ] Add a `uTextureScale = uniform(biome.textureScale)` node alongside the existing uniforms
  - [ ] Branch `createTerrainMaterial` on `biome.surfaceTexturePath !== undefined`:
    - [ ] **Textured path:** load `surfaceTexturePath` and `cliffTexturePath` via `TextureLoader`; pass the `THREE.Texture` handles to `triplanarTexture(texture(map), null, null, uTextureScale)`; compose `colorNode = mix(cliffDiffuse.mul(uCliffColor), surfaceDiffuse.mul(uSurfaceColor), blendFactor)` (color uniforms act as tints). Triplanar sampling handles walls correctly (uses world position).
    - [ ] **Solid-color path:** identical to slice 110 — `colorNode = mix(uCliffColor, uSurfaceColor, blendFactor)` (no regression)
  - [ ] Keep `roughnessNode` and `metalnessNode` unchanged from slice 110 (uniform mix) — textures for these are not in scope this slice
  - [ ] **Success:** `pnpm tsc --noEmit` clean; `createTerrainMaterial` compiles both paths; `pnpm dev` renders textured terrain and textured walls with tiling visible; no console shader errors with `checkShaderErrors` active

- [ ] **T11 — Tests: textured material node graph** *(effort: 2)*
  - [ ] Extend `three/tsl` mock with `texture`, `triplanarTexture`, `uv`, `normalMap` stubs that return identifiable tagged objects
  - [ ] Mock `TextureLoader.load` to return a placeholder `THREE.Texture`
  - [ ] Test: `createTerrainMaterial` with a biome containing texture paths calls `triplanarTexture` exactly twice (surface + cliff) and passes `uTextureScale` as the 4th argument
  - [ ] Test: `createTerrainMaterial` without texture paths does NOT call `triplanarTexture` (solid-color path unchanged)
  - [ ] Test: existing slice 110 material tests still pass unchanged
  - [ ] **Success:** `pnpm test --run` green; both texture-path and no-texture-path branches covered

- [ ] **T12 — Add non-triplanar normal maps to `createTerrainMaterial()`** *(effort: 2)*
  - [ ] In the textured branch, additionally load `surfaceNormalPath` and `cliffNormalPath` when present
  - [ ] Compose `surfaceNormal = normalMap(texture(surfaceNormalTexture, uv().mul(uTextureScale)))` and matching `cliffNormal`
  - [ ] Set `material.normalNode = mix(cliffNormal, surfaceNormal, blendFactor)` only when both normal paths are present; otherwise leave `normalNode` unset (geometry normals)
  - [ ] Handle partial presence gracefully: if only one of the two normal paths is defined, skip normal mapping entirely
  - [ ] Note: wall UVs from T3b must run along-edge (u) and top-to-bottom (v) for normal maps to orient correctly; bottom face UVs span `[0,1]²`
  - [ ] **Success:** `pnpm tsc --noEmit` clean; terrain and walls show visible surface relief under directional light in `pnpm dev`; no shader errors

- [ ] **T13 — Tests: normal-map node graph** *(effort: 1)*
  - [ ] Test: with both normal paths present, `normalMap` is called twice and `material.normalNode` is set
  - [ ] Test: with normal paths absent, `material.normalNode` is not set
  - [ ] Test: with only one normal path present, `normalNode` is not set (partial-presence fallback)
  - [ ] **Success:** `pnpm test --run` green

- [ ] **T14 — Extend `TerrainMaterialHandle.updateBiome()` to handle texture-path changes** *(effort: 2)*
  - [ ] Store the last-applied texture paths on the handle's closure
  - [ ] In `updateBiome(b)`, compare each of the four texture paths against the stored previous values
  - [ ] If any path changed (including added or removed), dispose the existing `material` and call the internal material-construction routine with the new biome; assign the result to the handle's `material` property
  - [ ] If no texture paths changed, preserve slice 110 behavior: mutate uniform `.value` fields only (including `uTextureScale`)
  - [ ] Document that consumers must re-read `handle.material` after calling `updateBiome()` (add a brief comment above the interface)
  - [ ] Update `main.ts` call site to re-read `handle.material` and assign it to `mesh.material` after each `updateBiome` call (idempotent when unchanged)
  - [ ] **Success:** `pnpm tsc --noEmit` clean; calling `updateBiome` with a new texture path in browser console swaps the terrain texture live

- [ ] **T15 — Tests: texture-aware `updateBiome`** *(effort: 2)*
  - [ ] Test: `updateBiome` with identical texture paths does not replace `handle.material` (reference equality preserved)
  - [ ] Test: `updateBiome` with a changed `surfaceTexturePath` replaces `handle.material` (reference changes)
  - [ ] Test: `updateBiome` with only a color change (no path change) mutates uniform values, does not replace material
  - [ ] **Success:** `pnpm test --run` green

- [ ] **T16 — Commit terrain material texture support** *(effort: 1)*
  - [ ] Stage `src/rendering/terrain.ts`, `src/rendering/terrain.test.ts`, and any touched call sites in `src/main.ts`
  - [ ] Commit: `feat(terrain): add triplanar diffuse and normal maps to terrain material`
  - [ ] **Success:** Commit created; `pnpm tsc --noEmit`, `pnpm test --run`, `pnpm build` all pass

### Removed (no separate slab material)

- [x] ~~**T17 — Update slab material to use cliff texture when present**~~ — *not needed; walls share terrain material*
- [x] ~~**T18 — Tests: textured slab material**~~ — *not needed; covered by T11/T13*
- [x] ~~**T19 — Commit textured slab material**~~ — *not needed*

### Tuning and closeout

- [ ] **T20 — Visual tuning: `textureScale` and `slabDepth`** *(effort: 2)*
  - [ ] Run `pnpm dev` and compare against `project-documents/user/reference/concept-art/migratory-terrain-concept.png`
  - [ ] Adjust `DEFAULT_BIOME.textureScale` until tiling density looks right (too low = stretched textures; too high = visible repetition)
  - [ ] Adjust `ViewerConfig.slabDepth` until the slab's visible depth matches the concept art's geological slab
  - [ ] Verify the empirical `slopeBlendLow / slopeBlendHigh` values from slice 110 (`0.65 / 0.90`) still look right with textures; retune only if needed and note the change
  - [ ] Check browser console — confirm no shader compilation warnings or errors
  - [ ] Walk through the slice design's Verification Walkthrough and confirm each step passes
  - [ ] **Success:** Visual match to concept art is satisfactory; all walkthrough steps pass

- [ ] **T21 — Fallback verification: BiomeConfig without texture paths** *(effort: 1)*
  - [ ] Temporarily remove all four texture paths from `DEFAULT_BIOME` (set to `undefined`) and reload `pnpm dev`
  - [ ] Confirm terrain renders with solid colors (slice 110 behavior exactly) — no errors, no blank meshes, no shader warnings
  - [ ] Confirm walls and bottom render with solid cliff color (pure-cliff resolution via slope-blend)
  - [ ] Restore `DEFAULT_BIOME` texture paths
  - [ ] **Success:** Both paths (textured and solid) work end-to-end

- [ ] **T22 — Final build and test pass** *(effort: 1)*
  - [ ] `pnpm tsc --noEmit` — no errors
  - [ ] `pnpm test --run` — all tests pass
  - [ ] `pnpm build` — clean production build; verify texture files are either bundled or correctly served via `public/`
  - [ ] **Success:** All three commands exit 0

- [ ] **T23 — Final commit and slice closeout** *(effort: 1)*
  - [ ] Stage any remaining tuning changes (`textureScale`, `slabDepth`, possibly `slopeBlendLow/High`)
  - [ ] Commit: `feat(terrain): tune slab depth and texture scale against concept art`
  - [ ] Update slice design frontmatter: `status: complete`; rewrite Verification Walkthrough with actual commands and outcomes observed during T20
  - [ ] Update `CHANGELOG.md` with a `0.7.0` (or appropriate) entry summarizing slice 111 deliverables
  - [ ] Update slice plan entry in `project-documents/user/architecture/100-slices.viewer-foundation.md` — check the `[ ]` box for slice 111
  - [ ] Commit: `docs: mark slice 111 complete; update CHANGELOG and slice plan`
  - [ ] **Success:** Slice 111 main shows the full set of semantic commits; working tree clean; all success criteria from the slice design are checked off
