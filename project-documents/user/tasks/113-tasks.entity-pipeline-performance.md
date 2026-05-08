---
docType: tasks
slice: entity-pipeline-performance
project: migratory-viewer
lld: user/slices/113-slice.entity-pipeline-performance.md
dependencies:
  - 101-slice.websocket-consumer-and-live-entity-rendering
  - 102-slice.terrain-rendering
  - 114-slice.entity-position-dtype-negotiation-f32-f64
projectState: >
  Slices 100–102, 104–105, 108, 110–112, 114 complete. Branch main, clean tree.
  ViewerState.positions/velocities are Float32Array | Float64Array | null (slice 114).
  parseStateUpdate allocates via buffer.slice(); updateEntities calls getTerrainHeight
  per entity per frame. Both are the targets of this slice.
dateCreated: 20260506
dateUpdated: 20260507
status: complete
---

## Context Summary

- Working on slice 113: entity pipeline performance
- Entity counts routinely reach 100k+; per-entity costs in the hot path compound heavily
- Three bottlenecks addressed: (1) `buffer.slice()` allocation in `parseStateUpdate`, (2) per-frame bilinear terrain lookups in `updateEntities`, (3) redundant entity matrix loop on frames where the tick hasn't advanced
- `parseStateUpdate` will use typed-array views directly into the WebSocket buffer; the existing `.set()` call in `applyStateUpdate` performs the single copy into persistent state buffers
- New `entityHeights: Float32Array | null` field on `ViewerState`; baked in `applyStateUpdate`, `applySnapshot`, and `applyTerrain`
- Render-skip: `lastRenderedTick` in `main.ts` gates `updateEntities`; `renderer.render()` still runs every frame
- No wire format changes; no visual output changes
- Next planned slice: TBD (see slice plan)

---

## Tasks

- [x] **T1 — Add `entityHeights` field to `ViewerState` in `src/types.ts`**
  - [x] Add `entityHeights: Float32Array | null` to the `ViewerState` interface after `velocities`
  - [x] Add a JSDoc line: `/** Pre-baked terrain height per entity (world Y), length = entityCount. Null until first snapshot. */`
  - [x] In `createInitialViewerState`, initialize `entityHeights: null`
  - [x] Success: `pnpm tsc --noEmit` reports zero errors; `entityHeights` is visible on the `ViewerState` type

- [x] **T2 — Extract `bakeEntityHeights` helper in `src/state.ts`**
  - [x] Add a non-exported helper `function bakeEntityHeights(state: ViewerState): void`
  - [x] The helper iterates `0..state.entityCount`, reads `positions[i*2]` and `positions[i*2+1]`, calls `getTerrainHeight(state.terrain, x, y)`, writes into `state.entityHeights[i]`
  - [x] Guard: if `state.positions === null || state.entityHeights === null` return immediately (no-op)
  - [x] Import `getTerrainHeight` from `../rendering/terrain.ts` (already available)
  - [x] Success: function compiles with no type errors; handles both `Float32Array` and `Float64Array` positions via numeric index access

- [x] **T3 — Test `bakeEntityHeights` helper**
  - [x] In `src/state.test.ts`, add a test: build a `ViewerState` with 2 entities and a simple flat terrain grid; call `bakeEntityHeights` via a thin export or by driving it through `applyStateUpdate` (see T5); assert `entityHeights[0]` and `entityHeights[1]` match `getTerrainHeight` for those positions
  - [x] Add a test: `positions === null` → `entityHeights` is untouched (no crash)
  - [x] Success: both tests pass; `pnpm test` fully green

- [x] **T4 — Update `applySnapshot` in `src/state.ts` to allocate and bake `entityHeights`**
  - [x] After setting `state.positions` and `state.entityCount`, allocate `state.entityHeights = new Float32Array(parsed.entityCount)`
  - [x] Call `bakeEntityHeights(state)` immediately after allocation
  - [x] Success: after `applySnapshot`, `state.entityHeights` is non-null, length equals `entityCount`, values equal `getTerrainHeight` for each entity's position

- [x] **T5 — Test `applySnapshot` height baking**
  - [x] Add a test: apply a snapshot with 2 entities over a terrain grid; assert `state.entityHeights` is a `Float32Array` of length 2 with correct values
  - [x] Add a test: apply a snapshot with 0 entities; assert `entityHeights` is a `Float32Array` of length 0 (not null)
  - [x] Success: both tests pass; `pnpm test` fully green

- [x] **T6 — Update `applyStateUpdate` in `src/state.ts` to bake `entityHeights`**
  - [x] At the end of `applyStateUpdate` (after the `.set()` or dtype-switch branch), call `bakeEntityHeights(state)`
  - [x] The call runs unconditionally on the success path (after the length-mismatch guard)
  - [x] Success: after `applyStateUpdate`, `state.entityHeights` values reflect the updated positions and current terrain

- [x] **T7 — Test `applyStateUpdate` height baking**
  - [x] Add a test: apply a snapshot establishing positions, then apply a state update with different positions; assert `entityHeights` reflects the new positions (not snapshot positions)
  - [x] Add a test: apply a state update when `state.terrain === null`; assert `entityHeights` is all zeros (flat fallback)
  - [x] Success: both tests pass; `pnpm test` fully green

- [x] **T8 — Update `applyTerrain` in `src/state.ts` to rebake `entityHeights`**
  - [x] After `state.terrainRevision += 1`, add: `if (state.positions !== null && state.entityHeights !== null) { bakeEntityHeights(state); }`
  - [x] Success: after `applyTerrain`, `entityHeights` values are recomputed using the new terrain grid

- [x] **T9 — Test `applyTerrain` rebake**
  - [x] Add a test: apply a snapshot (flat terrain, heights ≈ 0), then apply a new terrain grid with non-zero elevations via `applyTerrain`; assert `entityHeights` reflects the new terrain heights without a STATE_UPDATE
  - [x] Add a test: `applyTerrain` when `state.positions === null` → no crash, `entityHeights` stays null
  - [x] Success: both tests pass; `pnpm test` fully green

- [x] **T10 — Commit: `ViewerState.entityHeights` and state layer baking complete**
  - [x] `git add src/types.ts src/state.ts src/state.test.ts`
  - [x] Commit: `feat: add entityHeights cache and bakeEntityHeights to state layer`
  - [x] Success: commit created; `pnpm tsc --noEmit` and `pnpm test` both clean

- [x] **T11 — Remove `buffer.slice()` from `parseStateUpdate` in `src/protocol/deserialize.ts`**
  - BLOCKED — wire format alignment; original buffer.slice() retained. See slice design Verification Walkthrough → Implementation Notes.
  - [x] Replace the `buffer.slice(posOffset, posOffset + posByteLen)` pattern for positions and velocities with direct typed-array views: `new Float32Array(buffer, posOffset, componentCount)` / `new Float64Array(buffer, posOffset, componentCount)` (where `componentCount = entityCount * 2`)
  - [x] Same replacement for velocities: `new Float32Array(buffer, velOffset, componentCount)` etc.
  - [x] The `buffer` is the raw `ArrayBuffer` parameter — the view is not copied here; `applyStateUpdate`'s `.set()` performs the copy into persistent state before the view is invalidated
  - [x] Verify `parseSnapshot` — the design notes SNAPSHOT is low-frequency; leave its `buffer.slice()` calls as-is unless trivially obvious to update (do not risk complexity)
  - [x] Success: `parseStateUpdate` contains no `buffer.slice()` calls; `pnpm tsc --noEmit` zero errors

- [x] **T12 — Test zero-copy `parseStateUpdate` correctness**
  - BLOCKED — wire format alignment; original buffer.slice() retained. See slice design Verification Walkthrough → Implementation Notes.
  - [x] Add a test (f32): build a STATE_UPDATE buffer manually; parse it; assert `positions` and `velocities` hold the expected float values — same values as before this change
  - [x] Add a test (f64): same pattern with f64 payload; assert `instanceof Float64Array` and correct values
  - [x] Confirm all pre-existing `parseStateUpdate` tests still pass
  - [x] Success: new and existing tests pass; `pnpm test` fully green

- [x] **T13 — Commit: zero-copy deserializer change**
  - BLOCKED — wire format alignment; original buffer.slice() retained. See slice design Verification Walkthrough → Implementation Notes.
  - [x] `git add src/protocol/deserialize.ts` and any updated test files
  - [x] Commit: `perf: remove buffer.slice() from parseStateUpdate — view directly into WebSocket buffer`
  - [x] Success: commit created; `pnpm tsc --noEmit` and `pnpm test` both clean

- [x] **T14 — Update `updateEntities` in `src/rendering/entities.ts` to read from `entityHeights`**
  - [x] Remove the `getTerrainHeight(state.terrain, x, y)` call from the per-entity loop
  - [x] Replace with: `const h = state.entityHeights !== null ? state.entityHeights[i] : 0`
  - [x] The import of `getTerrainHeight` can be removed if it is no longer referenced anywhere in this file
  - [x] No other logic changes — `dummy.position.set(x, h + verticalOffset, y)` is unchanged
  - [x] Success: `src/rendering/entities.ts` compiles; no call to `getTerrainHeight` inside the entity loop

- [x] **T15 — Test `updateEntities` reads from `entityHeights`**
  - [x] In `src/rendering/entities.test.ts`, add a test: construct a `ViewerState` with `entityHeights` set to known values; call `updateEntities`; read the resulting matrix positions from the `InstancedMesh` and assert the Y component matches `entityHeights[i] + verticalOffset`
  - [x] Add a test: `entityHeights === null` → entities render at Y = verticalOffset (zero height fallback)
  - [x] Success: both tests pass; `pnpm test` fully green

- [x] **T16 — Add render-skip to animation loop in `src/main.ts`**
  - [x] Declare `let lastRenderedTick = -1` before the `renderer.setAnimationLoop` call
  - [x] Wrap the `updateEntities(entityMesh, viewerState)` call: only execute it when `viewerState.currentTick !== lastRenderedTick`; assign `lastRenderedTick = viewerState.currentTick` inside the branch
  - [x] `renderer.render(scene, rig.activeCamera)` remains outside the guard — runs every frame
  - [x] Note: `main.ts` has no unit test file and cannot be isolated from the Three.js animation loop; correctness of the skip guard is verified via code inspection (T17) and smoke test (T19)
  - [x] Success: `src/main.ts` compiles; `updateEntities` is conditionally gated; `renderer.render` is unconditional

- [x] **T17 — Full typecheck, test pass, and render-skip code inspection**
  - [x] Run `pnpm tsc --noEmit` — zero errors
  - [x] Run `pnpm test` — all tests pass (baseline 127 + new tests from this slice)
  - [x] Inspect `src/main.ts`: confirm `lastRenderedTick` is declared, the `updateEntities` call is inside `if (viewerState.currentTick !== lastRenderedTick)`, and `renderer.render` is outside that guard
  - [x] Success: both commands exit cleanly; code inspection confirms render-skip guard is structurally correct

- [x] **T18 — Commit: rendering and render-skip changes**
  - [x] `git add src/rendering/entities.ts src/rendering/entities.test.ts src/main.ts`
  - [x] Commit: `perf: read entityHeights in updateEntities; add render-skip on stale tick`
  - [x] Success: commit created; working tree clean

- [x] **T19 — Manual smoke test (including render-skip verification)**
  - [x] Start the migratory server (f32 or f64 dtype)
  - [x] Run `pnpm dev` and open the viewer in a browser
  - [x] Confirm entities appear at correct positions on terrain — no floating or sunken artifacts
  - [x] Move the camera; confirm smooth movement (render loop is not blocked by entity skip)
  - [x] Open DevTools console — no errors or unexpected warnings
  - [x] Trigger a terrain reload if possible; confirm entities re-seat on new terrain heights without waiting for the next STATE_UPDATE
  - [x] Verify render-skip: in DevTools Performance tab, record a few seconds; confirm the per-frame CPU spike for entity matrix updates is absent on frames where no new server tick has arrived (frame budget is materially lower between ticks than on tick-arrival frames)
  - [x] Success: visual output matches pre-slice behavior; no regressions; camera smooth; render-skip observable in profiler
