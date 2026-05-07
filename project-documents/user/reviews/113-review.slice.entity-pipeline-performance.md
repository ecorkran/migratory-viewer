---
docType: review
layer: project
reviewType: slice
slice: entity-pipeline-performance
project: squadron
verdict: PASS
sourceDocument: project-documents/user/slices/113-slice.entity-pipeline-performance.md
aiModel: minimax/minimax-m2.7
status: complete
dateCreated: 20260506
dateUpdated: 20260506
findings:
  - id: F001
    severity: pass
    category: uncategorized
    summary: "Zero-copy deserialization aligns with architecture performance targets and binary protocol decisions"
    location: 113-slice.entity-pipeline-performance.md#1-zero-copy-deserialization
  - id: F002
    severity: pass
    category: uncategorized
    summary: "`entityHeights` field addition is consistent with architecture state model"
    location: 113-slice.entity-pipeline-performance.md#viewerstate-additions
  - id: F003
    severity: pass
    category: uncategorized
    summary: "Baked height cache and rebake logic are technically sound"
    location: 113-slice.entity-pipeline-performance.md#2-baked-entity-height-cache
  - id: F004
    severity: pass
    category: uncategorized
    summary: "Render-skip pattern preserves smooth camera and HUD updates"
    location: 113-slice.entity-pipeline-performance.md#3-render-skip-on-stale-ticks
  - id: F005
    severity: pass
    category: uncategorized
    summary: "Dependencies are within architecture scope; dependency direction is correct"
    location: 113-slice.entity-pipeline-performance.md#dependencies
  - id: F006
    severity: pass
    category: uncategorized
    summary: "No new public interfaces introduced; changes are properly scoped"
    location: 113-slice.entity-pipeline-performance.md#cross-slice-interfaces
  - id: F007
    severity: pass
    category: uncategorized
    summary: "Explicitly excluded items are consistent with architecture scope boundaries"
    location: 113-slice.entity-pipeline-performance.md#excluded
  - id: F008
    severity: pass
    category: uncategorized
    summary: "Performance targets are consistent with architecture NFRs at scale"
    location: 113-slice.entity-pipeline-performance.md#performance-targets section (implied)
---

# Review: slice — slice 113

**Verdict:** PASS
**Model:** minimax/minimax-m2.7

## Findings

### [PASS] Zero-copy deserialization aligns with architecture performance targets and binary protocol decisions

The architecture specifies "WebSocket deserialization < 1ms per message" and "Typed array views are near-zero-cost" as the rationale for direct `DataView` / typed array parsing. The slice's zero-copy approach — replacing `buffer.slice()` + intermediate typed array with direct views into the WebSocket buffer — is a direct application of this principle. The design correctly notes that views are safe as long as the caller does not hold them past the next `onmessage` call, and that the state layer's existing `.set()` copy into pre-allocated `ViewerState` buffers is the correct persistence pattern. The architecture's data flow (WebSocket → deserialize → connection dispatch → render) is preserved.

### [PASS] `entityHeights` field addition is consistent with architecture state model

The architecture defines `ViewerState` as the single authoritative state object, with ownership rules stating "net/connection.ts is the sole writer." The slice adds `entityHeights: Float32Array | null` as a new field in `src/types.ts` and populates it in `applyStateUpdate`, `applySnapshot`, and `applyTerrain` — all invoked by the connection handler, consistent with the ownership contract. The field is nullable (`null` before first snapshot) matching the pattern already established for `profileIndices`, `positions`, and `velocities`.

The architecture notes "On STATE_UPDATE: only positions, velocities, and currentTick are updated." This slice adds `entityHeights` to the STATE_UPDATE update path. This is additive behavior on the established pattern, not a violation — the ownership contract (sole writer) is preserved; the set of fields updated by that writer is expanded. No layer boundary is crossed.

### [PASS] Baked height cache and rebake logic are technically sound

The slice correctly identifies that `updateEntities` calls `getTerrainHeight()` per entity per frame (~60 fps) for a terrain that only changes on TERRAIN messages (rare). Moving this O(N) bilinear interpolation to `applyStateUpdate` (once per server tick at 250 tps) reduces inner-loop cost substantially at high entity counts.

The critical correctness detail — rebaking heights in `applyTerrain` when terrain changes — is explicitly addressed. Without this, entities would float at stale heights until the next STATE_UPDATE. The population rules table (snapshot, state update, terrain change, null terrain) covers all code paths. This is internal application logic calling an existing internal function (`getTerrainHeight`); no new protocol messages, network I/O, or failure modes beyond what already exists in the codebase are introduced.

### [PASS] Render-skip pattern preserves smooth camera and HUD updates

The architecture's data flow shows the render loop calling `renderer.render(scene, rig.activeCamera)` every frame for camera/HUD smoothness. The slice correctly preserves this — `renderer.render()` is still called every frame; only the expensive `updateEntities` matrix loop is skipped when `currentTick` hasn't advanced. The edge cases (pre-snapshot initial frame, reconnect) are handled correctly by the tick comparison logic. The performance target of "60 fps at 10K entities" is directly served by eliminating redundant matrix computation on unchanged tick data.

### [PASS] Dependencies are within architecture scope; dependency direction is correct

The slice declares dependencies on:
- **Slice 101** — establishes `parseSnapshot`, `parseStateUpdate`, `ViewerState`, `applyStateUpdate` (the exact symbols this slice modifies)
- **Slice 102** — establishes `getTerrainHeight` and `TerrainGrid` (the terrain grid the height bake reads from)
- **Slice 114** — introduces `PositionDtype` and the `Float32Array | Float64Array` dtype variant (the zero-copy path must handle both)

All three are within the same initiative (viewer-foundation). The slice modifies these symbols but does not change their signatures or break their contracts. Slice 114's `PositionDtype` is consumed as input, not modified. The dependency chain flows correctly: architecture defines the protocol/state/rendering layers → prerequisites provide the symbols → this slice modifies them. No cross-initiative or circular dependencies.

### [PASS] No new public interfaces introduced; changes are properly scoped

The slice explicitly states it "does not define new public interfaces." The modified files (`deserialize.ts`, `state.ts`, `types.ts`, `entities.ts`, `main.ts`) are all within the same project scope. No interface boundaries with other slices or external consumers are affected. The architectural component layout (protocol layer, state layer, rendering layer, entry point) is respected.

### [PASS] Explicitly excluded items are consistent with architecture scope boundaries

The excluded items are well-scoped:
- **Wire format / protocol constants** — architecture assigns protocol definition to slice 306 (server-side); this slice correctly does not propose protocol changes.
- **Terrain mesh rebuild** — architecture states this is "already handled by `terrainRevision` in the render loop" (slice 102/110 territory).
- **`getTerrainHeight` itself** — remains available for other callers; no changes that could break other slice consumers.
- **Profiling harness** — architecture defers performance profiling to slice 106.

### [PASS] Performance targets are consistent with architecture NFRs at scale

The architecture states:
- Frame rate at 100K entities: **15+ fps** (aspirational)
- WebSocket deserialization: **< 1ms per message**

This slice directly serves both. At 100K entities with 250 tps server tick rate and 60 fps render rate, the three optimizations (zero-copy eliminates GC pressure on the hot path; height cache eliminates 60× per-tick bilinear interpolation; render-skip eliminates redundant matrix computation on unchanged ticks) compound into measurable frame rate improvement. The architecture notes performance profiling and optimization is "its own slice (106)"; this slice (113) is a prerequisite that removes the most obvious algorithmic waste before profiling-based tuning occurs. There are no NFRs in the parent architecture that this slice could violate — the NFRs are at the whole-system level, and this slice moves performance toward the targets.
