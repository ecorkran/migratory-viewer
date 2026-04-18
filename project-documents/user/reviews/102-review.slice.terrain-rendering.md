---
docType: review
layer: project
reviewType: slice
slice: terrain-rendering
project: squadron
verdict: CONCERNS
sourceDocument: project-documents/user/slices/102-slice.terrain-rendering.md
aiModel: z-ai/glm-5.1
status: complete
dateCreated: 20260418
dateUpdated: 20260418
findings:
  - id: F001
    severity: concern
    category: scope
    summary: "Scope discrepancy: biome rendering missing from slice 102"
    location: 102-slice.terrain-rendering.md > Excluded; 100-arch.viewer-foundation.md > Relationship to Slice Plan
  - id: F002
    severity: pass
    category: state-management
    summary: "State ownership and mutation rules preserved"
    location: 102-slice.terrain-rendering.md > State Management
  - id: F003
    severity: pass
    category: error-handling
    summary: "Protocol error handling follows architectural pattern"
    location: 102-slice.terrain-rendering.md > Error handling; 100-arch.viewer-foundation.md > Protocol Error Handling
  - id: F004
    severity: pass
    category: data-flow
    summary: "Data flow direction correct"
    location: 102-slice.terrain-rendering.md > Architecture > Component Structure
  - id: F005
    severity: pass
    category: integration
    summary: "Entity terrain height lookup matches architecture specification"
    location: 102-slice.terrain-rendering.md > Height lookup; 100-arch.viewer-foundation.md > Entity Rendering Detail
  - id: F006
    severity: pass
    category: component-structure
    summary: "Component structure aligns with architecture"
    location: 102-slice.terrain-rendering.md > Technical Scope; 100-arch.viewer-foundation.md > Component Architecture
  - id: F007
    severity: note
    category: conventions
    summary: "Coordinate naming convention: originY maps to world Z"
    location: 102-slice.terrain-rendering.md > API Contracts > ParsedTerrain
---

# Review: slice — slice 102

**Verdict:** CONCERNS
**Model:** z-ai/glm-5.1

## Findings

### [CONCERN] Scope discrepancy: biome rendering missing from slice 102

The architecture document's slice plan table lists slice 102 as "Terrain + Biome Rendering," but this slice design explicitly excludes biome coloring, deferring it to slice 109. Slice 109 does not appear in the architecture's 8-slice decomposition (slices 100–107). While the architecture's own scope column for slice 102 only mentions "Displaced PlaneGeometry, flat plane until wire carries terrain," the slice title clearly includes biome. The slice design should either be reconciled with the architecture's stated scope (add biome rendering) or the architecture document should be updated to reflect the refined decomposition that introduces slice 109. Without this, it is ambiguous whether the slice is under-delivering relative to architectural expectations or the architecture is simply stale.

### [PASS] State ownership and mutation rules preserved

The slice correctly preserves the architecture's ownership rule: `net/connection.ts` routes `ParsedTerrain` to `applyTerrain` in `state.ts`, which is the sole mutator of `viewerState.terrain`. Rendering modules (`terrain.ts`, `entities.ts`) only read from the state. The new `terrainRevision` counter follows the same ownership boundary—it is incremented only by `applyTerrain` and read by the render loop for change detection, consistent with the architecture's principle that rendering components "reference the current values each frame or tick."

### [PASS] Protocol error handling follows architectural pattern

The slice's error handling is consistent with the architecture's decision to "validate at parse boundaries; discard malformed frames without disconnecting." Malformed TERRAIN frames are logged and discarded without breaking the connection. The `terrainMaxCells` configurable cap mirrors the architecture's "entity count sanity" pattern with a configurable upper bound. The non-fatal rejection behavior (log + skip frame, keep existing terrain) aligns with the architecture's recovery guidance.

### [PASS] Data flow direction correct

The data flow follows the architecture's unidirectional pipeline: WebSocket binary frame → `protocol/deserialize.ts::parseMessage` → `net/connection.ts::handleMessage` → `state.ts::applyTerrain` → rendering reads. No reverse dependencies or hidden coupling is introduced. The `ParsedTerrain` extension to the `ParsedMessage` discriminated union follows the same pattern as existing message types.

### [PASS] Entity terrain height lookup matches architecture specification

The architecture specifies entity position as `(x, terrain_height_at(x,z), z)` with "y is terrain height lookup (0 on flat plane)." The slice's `getTerrainHeight(grid | null, x, z)` implements exactly this contract: bilinear interpolation over the elevation grid, clamping at edges, and returning `0` when terrain is null (no TERRAIN received or server doesn't send one). The `entityVerticalOffsetRatio` is a cosmetic addition that doesn't alter the fundamental contract—it lifts the cone base to the surface rather than centering the cone at terrain height, which is a rendering detail not contradicted by the architecture.

### [PASS] Component structure aligns with architecture

New code is placed in the correct architectural components: protocol types and parsing in `src/protocol/`, connection dispatch in `src/net/`, state mutation in `src/state.ts`, rendering in `src/rendering/terrain.ts` and `src/rendering/entities.ts`, configuration in `config.ts`. The architecture's `terrain.ts` description says "PlaneGeometry ground plane (flat now, displaced later)" and this slice delivers exactly the "displaced later" evolution.

### [NOTE] Coordinate naming convention: originY maps to world Z

The `ParsedTerrain` interface uses `originX` and `originY` to match the wire protocol's naming, but `originY` maps to the world Z axis in Three.js space. The slice documents this mapping clearly in the geometry construction section, and the `getTerrainHeight` function signature uses `(x, z)` parameters, which correctly reflects the world-space convention. This is not an error, but it is a naming impedance mismatch that implementers should be aware of—the Y in `originY` is not the Y axis in world space.
