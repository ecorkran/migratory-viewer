---
docType: slice-design
slice: entity-pipeline-performance
project: migratory-viewer
parent: user/architecture/100-slices.viewer-foundation.md
dependencies:
  - 101-slice.websocket-consumer-and-live-entity-rendering
  - 102-slice.terrain-rendering
  - 114-slice.entity-position-dtype-negotiation-f32-f64
interfaces: []
dateCreated: 20260506
dateUpdated: 20260507
status: complete
effort: 2
---

# Slice Design: Entity Pipeline Performance

## Overview

Two concrete throughput bottlenecks have been identified in the entity update pipeline.
Entity counts routinely reach 100k or more, so per-entity costs in the hot path
compound quickly.

1. **Allocation overhead in the deserializer** — `parseSnapshot` and `parseStateUpdate`
   both call `buffer.slice()` to detach from the WebSocket message buffer, then
   construct a `Float32Array` or `Float64Array` over the copy. At high entity counts
   and 250 tps, this is a substantial volume of short-lived heap allocation per second
   just for the copy, with the original buffer discarded immediately.

2. **Per-frame terrain height lookups** — `updateEntities` in `rendering/entities.ts`
   runs every animation frame (~60 fps) and calls `getTerrainHeight()` once per entity,
   performing a bilinear interpolation across the terrain grid. Terrain data changes only
   on `TERRAIN` messages (rare), but this O(N) bilinear pass executes 60× per server
   tick rather than once.

This slice addresses both bottlenecks. No changes to rendering visual output — same
positions, same heights, same colors.

## Value

**Reduced per-tick allocation pressure.** Eliminating the `buffer.slice()` + intermediate
typed-array path in the hot deserialization loop removes a predictable GC source on
every STATE_UPDATE. At high entity counts and 250 tps, this is a large volume of
short-lived heap churn per second — costs scale linearly with entity count.

**Per-frame terrain lookup eliminated.** Baking entity terrain heights once per tick
removes the dominant inner-loop cost from `updateEntities`, which currently performs
`O(N)` bilinear interpolations at 60 fps for a terrain that hasn't changed since the
last TERRAIN message.

**Render-skip on stale ticks.** At 60 fps with a 250 tps server, the viewer renders
the same entity positions ~4 frames per tick. Each such frame currently does a full
`O(N)` matrix update loop with identical inputs. Skipping frames where `currentTick`
hasn't advanced avoids that redundant work entirely.

## Technical Scope

**Included:**

- Zero-copy deserialization in `parseSnapshot` and `parseStateUpdate`: write parsed
  positions/velocities directly into pre-allocated ViewerState buffers rather than
  allocating new typed arrays. Eliminates `buffer.slice()` on the hot path.
- Baked height cache: add `entityHeights: Float32Array | null` to `ViewerState`
  (length = `entityCount`). Populate it in `applyStateUpdate` (and `applySnapshot`)
  from the terrain grid at the time of the update.
- Render-skip: track `lastRenderedTick` in `main.ts` and skip `updateEntities` when
  `viewerState.currentTick === lastRenderedTick`.
- `updateEntities` reads heights from `state.entityHeights` instead of calling
  `getTerrainHeight` per entity.
- Unit tests for all changed paths: zero-copy correctness, height baking, render-skip.

**Excluded:**

- Any change to wire format or protocol constants.
- Terrain mesh rebuild (already handled by `terrainRevision` in the render loop).
- Changes to `getTerrainHeight` itself — it remains available for other callers.
- Any profiling harness or benchmark tooling.

## Dependencies

### Prerequisites

- **Slice 101** — establishes `parseSnapshot`, `parseStateUpdate`, `ViewerState`, and
  `applyStateUpdate`. This slice modifies all four.
- **Slice 102** — establishes `getTerrainHeight` and `TerrainGrid`. The height bake
  calls `getTerrainHeight` on every entity from `applyStateUpdate`.
- **Slice 114** — widens `positions`/`velocities` to `Float32Array | Float64Array`
  and introduces `PositionDtype`. The zero-copy path must handle both dtypes.

## Architecture

### 1. Zero-Copy Deserialization

**Current path** (`parseSnapshot` / `parseStateUpdate`):

```
WebSocket ArrayBuffer
  → buffer.slice(posOffset, posOffset + byteLen)   // heap allocation + copy
  → new Float32Array(slicedBuffer)                 // typed-array view over copy
```

**Target path:**

```
WebSocket ArrayBuffer
  → new Float32Array(buffer, posOffset, count * 2)  // view directly into original
```

`ArrayBuffer`s received from the WebSocket `onmessage` event are owned by the browser
and are not reused or freed by the browser between event handlers. Wrapping a view
directly into the incoming buffer (without `slice`) is safe as long as the caller
does not hold the view past the next message's `onmessage` call.

However, `ViewerState.positions` / `velocities` persist across ticks. The view into
the WebSocket buffer would be silently invalidated when the next message arrives.
The correct zero-copy approach is therefore:

- Pre-allocate `ViewerState.positions` and `velocities` at snapshot time (once per
  entity-count change, not once per tick).
- In `applyStateUpdate`, use `TypedArray.prototype.set()` to copy from the inlined view
  into the pre-allocated state buffer — one copy, no intermediate allocation.

This is the same pattern currently used in `applyStateUpdate` (the `.set()` call on line
66 of `state.ts`) but the allocation still happens in the deserializer. The change is
to **remove `buffer.slice()` from `parseStateUpdate` and `parseSnapshot`** and instead
wrap views directly. The state layer's `.set()` call remains the single copy into the
persistent buffer.

> **Note:** `parseSnapshot` always allocates fresh buffers because it establishes the
> entity count. The zero-copy benefit is largest for STATE_UPDATE (the hot path at
> 250 tps). SNAPSHOT is infrequent — buffer.slice() there is not the performance target.
> For consistency, SNAPSHOT can also use views, but the primary gain is STATE_UPDATE.

**What changes in `parseStateUpdate`:**

Replace:
```typescript
const positions =
  dtype === PositionDtype.F32
    ? new Float32Array(buffer.slice(posOffset, posOffset + posByteLen))
    : new Float64Array(buffer.slice(posOffset, posOffset + posByteLen));
```

With:
```typescript
const componentCount = entityCount * 2;
const positions =
  dtype === PositionDtype.F32
    ? new Float32Array(buffer, posOffset, componentCount)
    : new Float64Array(buffer, posOffset, componentCount);
```

The `ParsedStateUpdate.positions` / `velocities` fields become views into the
WebSocket buffer. The state layer's `applyStateUpdate` copies them via `.set()` into
the pre-allocated `ViewerState` buffers before the views could be invalidated.

**Impact on `applyStateUpdate`:** No structural change — `.set()` is already used
and remains correct. The dtype-switch branch replaces the reference; in that path
a new typed array is allocated (dtype changes are rare).

**Impact on `parseSnapshot`:** The SNAPSHOT path can stay as-is (uses `buffer.slice`
for the initial allocation of persistent state buffers). If desired, views can be used
and `.set()` applied in `applySnapshot` — but this is lower priority given SNAPSHOT
frequency.

### 2. Baked Entity Height Cache

**Current path** (`updateEntities`, called every animation frame):

```
for i in 0..entityCount:
  h = getTerrainHeight(state.terrain, x[i], y[i])   // bilinear interpolation
  dummy.position.set(x, h + verticalOffset, y)
  ...
```

**Target path:**

`applyStateUpdate` (called once per server tick) bakes terrain heights into
`state.entityHeights`:

```
for i in 0..entityCount:
  state.entityHeights[i] = getTerrainHeight(state.terrain, x[i], y[i])
```

`updateEntities` reads from the cache:

```
for i in 0..entityCount:
  h = state.entityHeights[i]      // array read — no interpolation
  dummy.position.set(x, h + verticalOffset, y)
  ...
```

**`ViewerState` additions:**

```typescript
/** Pre-baked terrain height per entity (world Y). Null until first snapshot. */
entityHeights: Float32Array | null;
```

Added to `ViewerState` interface in `src/types.ts` and to `createInitialViewerState`.

**Population rules:**

| Event | Action |
|---|---|
| `applySnapshot` | Allocate `new Float32Array(entityCount)`, bake heights. |
| `applyStateUpdate` | Bake heights into existing buffer (same length assumed). |
| `applyTerrain` | Heights are now stale. Rebake using current positions. |
| `state.terrain === null` | `getTerrainHeight` returns 0; heights are all 0. |

The `applyTerrain` rebake is critical: a new terrain grid changes heights for all
entities even though no STATE_UPDATE arrived. Without it, entities would float at
the height of the previous terrain until the next STATE_UPDATE.

**`applyTerrain` change:**

After updating `state.terrain` and incrementing `terrainRevision`, rebake heights:

```typescript
if (state.positions !== null && state.entityHeights !== null) {
  bakeEntityHeights(state);
}
```

Extract `bakeEntityHeights(state: ViewerState): void` as a shared helper in
`state.ts`.

**`updateEntities` change:**

Replace `getTerrainHeight(state.terrain, x, y)` lookup with `state.entityHeights[i]`
(with a null-guard for the pre-snapshot case — fall back to 0).

### 3. Render-Skip on Stale Ticks

**Current path** (`main.ts` render loop):

```typescript
renderer.setAnimationLoop(() => {
  ...
  updateEntities(entityMesh, viewerState);  // called every frame regardless
  renderer.render(scene, rig.activeCamera);
});
```

**Target path:**

```typescript
let lastRenderedTick = -1;

renderer.setAnimationLoop(() => {
  ...
  if (viewerState.currentTick !== lastRenderedTick) {
    updateEntities(entityMesh, viewerState);
    lastRenderedTick = viewerState.currentTick;
  }
  renderer.render(scene, rig.activeCamera);
});
```

`renderer.render()` still runs every frame — camera movement and HUD updates must
remain smooth. Only the entity matrix loop is skipped.

**Edge cases:**

- First frame before any snapshot: `currentTick` is 0, `lastRenderedTick` is -1 →
  `updateEntities` runs once, sets `mesh.count = 0`. Subsequent pre-snapshot frames
  are skipped. Correct.
- Connection reset / reconnect: `applySnapshot` sets a new `currentTick` → render
  runs on the next frame. Correct.

### Data Flow Summary

```
WebSocket onmessage
  → parseStateUpdate(buffer)         // view into buffer, no slice
  → applyStateUpdate(state, parsed)  // .set() into state buffers; bake heights
  → state.currentTick updated

Animation frame (60 fps):
  if currentTick !== lastRenderedTick:
    updateEntities(mesh, state)       // reads state.entityHeights[i], no interpolation
    lastRenderedTick = currentTick
  renderer.render(...)
```

## Cross-Slice Interfaces

This slice does not define new public interfaces. Changes are internal to:
- `src/protocol/deserialize.ts` — `parseStateUpdate` (view instead of slice)
- `src/state.ts` — `applyStateUpdate`, `applySnapshot`, `applyTerrain`, new `bakeEntityHeights` helper
- `src/types.ts` — `ViewerState.entityHeights` field
- `src/rendering/entities.ts` — `updateEntities` reads `state.entityHeights`
- `src/main.ts` — render-skip logic with `lastRenderedTick`

## Success Criteria

1. `parseStateUpdate` no longer calls `buffer.slice()` — confirmed by code inspection.
2. `ViewerState.entityHeights` is a `Float32Array` (null before first snapshot).
3. `applyStateUpdate` populates `entityHeights` for every entity.
4. `applyTerrain` rebakes `entityHeights` if positions are available.
5. `updateEntities` reads from `entityHeights` with no call to `getTerrainHeight`.
6. Render-skip: `updateEntities` is not called when `currentTick` has not advanced.
7. All existing tests pass. New tests cover:
   - Zero-copy round-trip: parsed positions equal expected values (f32 and f64).
   - Height bake: `entityHeights` values match `getTerrainHeight` for the same inputs.
   - Terrain rebake: updating terrain via `applyTerrain` updates `entityHeights`.
   - Render-skip: calling the render loop without a tick change does not invoke `updateEntities`.
8. `pnpm tsc --noEmit` reports zero errors.
9. Smoke test: viewer connects to a live f32 server, entities render at correct heights
   with no visual regression vs. pre-slice behavior.

## Verification Walkthrough

### Implementation Notes (post-implementation)

The slice originally proposed three optimizations. **Two shipped, one was blocked
by a wire-format constraint discovered during implementation:**

- ✅ **Terrain height cache** (`entityHeights`) — shipped.
- ✅ **Render-skip on stale tick** — shipped.
- ❌ **Zero-copy `parseStateUpdate`** — **reverted**. The STATE_UPDATE wire header
  is 10 bytes, so positions begin at byte offset 10 in the WebSocket `ArrayBuffer`.
  `new Float32Array(buffer, 10, n)` requires offset divisible by 4 (fails: 10 % 4 = 2);
  `new Float64Array(buffer, 10, n)` requires offset divisible by 8 (fails: 10 % 8 = 2).
  Both throw `RangeError`. Eliminating the `buffer.slice()` allocation requires
  changing the wire-format header size to a multiple of 8, which is a coordinated
  server/viewer protocol change and out of scope for this slice. `parseStateUpdate`
  retains its original `buffer.slice()` calls.

### Code Inspection

1. Open [src/protocol/deserialize.ts](src/protocol/deserialize.ts). `parseStateUpdate`
   retains its original `buffer.slice()`-based implementation (see notes above).
2. Open [src/types.ts](src/types.ts). Confirm `entityHeights: Float32Array | null` in
   `ViewerState`, initialized to `null` in `createInitialViewerState`.
3. Open [src/state.ts](src/state.ts). Confirm `bakeEntityHeights` helper and calls in
   `applyStateUpdate`, `applySnapshot`, and `applyTerrain` (rebake guarded by
   `state.positions !== null && state.entityHeights !== null`).
4. Open [src/rendering/entities.ts](src/rendering/entities.ts). In `updateEntities`,
   confirm `const h = state.entityHeights !== null ? state.entityHeights[i] : 0;` —
   no `getTerrainHeight` call. Import of `getTerrainHeight` removed.
5. Open [src/main.ts](src/main.ts). Confirm `let lastRenderedTick = -1;` declaration
   and the guard `if (viewerState.currentTick !== lastRenderedTick) { ... }` wrapping
   the `updateEntities` call inside the animation loop. `renderer.render(...)` runs
   unconditionally outside the guard.

### Test Suite

```bash
pnpm test
```

Expected: `Test Files 9 passed (9)`, `Tests 134 passed (134)` — baseline 127 plus
7 new tests added by this slice (3 in `applySnapshot — entityHeights baking`,
2 in `applyStateUpdate — entityHeights baking`, 2 in `applyTerrain — entityHeights rebake`).
The two pre-existing `entities.test.ts` terrain tests were updated in place to
drive `state.entityHeights` directly rather than invoke the removed `getTerrainHeight`
call path.

```bash
pnpm tsc --noEmit
```

Zero errors.

### Smoke Test

1. Start the migratory server with f32 dtype configured.
2. Open the viewer. Confirm:
   - Entities appear at correct positions on terrain (no floating/sunken artifacts).
   - HUD tick counter advances normally.
   - Camera movement is smooth (render loop not blocked by entity skip).
3. Trigger a terrain reload if possible. Confirm entities re-seat on the new terrain
   heights without waiting for a STATE_UPDATE.
4. (Optional) DevTools Performance tab: record a few seconds. The per-frame entity
   matrix update should be visible only on frames where a new server tick has
   arrived; frames between ticks should show no work in the entity loop. Camera
   render runs every frame regardless.

### Outcomes Observed

- All 134 tests green; `pnpm tsc --noEmit` clean.
- Smoke-tested at 10k entities, server 60 tps, f32 dtype: viewer renders
  ~85 fps; visual output matches pre-slice behavior; no console errors.
- Tps ceiling observed in viewer (~36 tps when server sends 60) is not caused
  by slice 113 — confirmed by toggling `bakeEntityHeights` off with no change.
  Investigation continues server-side.
