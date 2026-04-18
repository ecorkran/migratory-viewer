---
docType: slice-design
slice: terrain-rendering
project: migratory-viewer
parent: user/architecture/100-slices.viewer-foundation.md
dependencies: [101-websocket-consumer-and-live-entity-rendering]
interfaces: [103-environment-overlay-rendering, 109-biome-rendering]
dateCreated: 20260418
dateUpdated: 20260418
status: not_started
---

# Slice Design: Terrain Rendering

## Overview

This slice replaces the viewer's flat ground plane with a real elevation surface driven by the server's TERRAIN (0x03) message. The viewer parses the one-shot TERRAIN frame that follows SNAPSHOT on connect, builds a displaced `PlaneGeometry` from the row-major `float64` elevation grid, computes vertex normals for correct lighting, and exposes a terrain height lookup so entities render on the surface rather than at `y=0`.

The work is bounded to terrain. Biome coloring (future slice 109) and other environment overlays (slice 103) layer on top of the same mesh later; this slice defines the geometry and the height-lookup contract those later slices will consume.

## Value

**User-facing:** The viewer renders the actual terrain the server simulates against. Entities sit on the ground surface instead of hovering at an arbitrary fixed plane. Perspective-mode views (slice 104) become meaningful because the world has topography.

**Architectural enablement:**
- Adds TERRAIN (0x03) to the existing protocol dispatch, establishing the pattern for subsequent static-world messages (biome, resource, threat, trail).
- Introduces a stable `getTerrainHeight(x, z)` contract on the terrain module that all later slices use for ground-relative placement.
- Raises the client-side WebSocket payload ceiling to match the server's 32 MiB default, unblocking any future message large enough to have prompted that ceiling on the server side.

## Technical Scope

### Included
- New `TERRAIN = 0x03` entry in `src/protocol/types.ts` with a `ParsedTerrain` type.
- TERRAIN parser in `src/protocol/deserialize.ts` added to the `parseMessage` switch.
- `ParsedMessage` discriminated union extended to include `ParsedTerrain`.
- `ViewerState.terrain` field (nullable) holding the parsed grid.
- `applyTerrain` mutation helper in `src/state.ts`; `connection.ts` dispatch updated.
- `src/rendering/terrain.ts` rewritten: displaced `PlaneGeometry` sized/positioned from the TERRAIN header, `computeVertexNormals`, update path that rebuilds geometry when a new TERRAIN frame arrives.
- `getTerrainHeight(x, z)` helper with bilinear interpolation; clamps to grid edges; returns `0` when no terrain data has been received.
- `src/rendering/entities.ts` updated to place each instance at `y = getTerrainHeight(x, z) + verticalOffset` (offset keeps the cone above the surface; see Technical Decisions).
- `main.ts` update: detect new terrain frames and rebuild the mesh; pass terrain to the entity update.
- Client-side WebSocket payload cap raised where it applies (see Technical Decisions — the browser `WebSocket` API has no knob; this is a no-op for the browser path but is documented explicitly so a future Node-based replay tool wires it correctly).
- Unit tests for TERRAIN deserialization (happy path, truncated buffer, bad dimensions, bad resolution, oversize grid rejected by configurable cap).
- Unit tests for `getTerrainHeight` (corners, cell centers, interpolation midpoints, out-of-bounds clamp, null-grid zero fallback).
- Config entries: `terrainMaxCells` cap, `entityVerticalOffsetRatio`.

### Excluded
- Biome coloring or per-cell color attributes (slice 109).
- Resource, threat, trail overlays (slice 103).
- Terrain LOD, tiling, or streaming (future work if world sizes grow).
- Server-side compression of TERRAIN (deferred per the protocol spec — a dedicated future slice).
- Shadow casting from terrain (out of scope; lighting remains hemispheric + directional as in slice 100).
- Any change to SNAPSHOT (0x01) or STATE_UPDATE (0x02) parsing.

## Dependencies

### Prerequisites
- **(101) WebSocket Consumer and Live Entity Rendering** — complete. Provides `protocol/`, `net/connection.ts`, `state.ts`, and the `ViewerState` ownership rule.
- **(100) Project Scaffold and Rendering Core** — complete. Provides the scene, lighting, and the current flat `terrain.ts` being rewritten.

### External
- **migratory slice 507 (TERRAIN wire format)** — the server produces the TERRAIN (0x03) message per the spec pasted in the slice plan. The viewer is a pure consumer; no server work is required here.

### Interfaces Required
- `ViewerState` shape (extend, do not break).
- `parseMessage` dispatch (extend the switch).
- Entity placement path in `entities.ts` (adds a y-component).

## Architecture

### Component Structure

```
WebSocket binary frame
      │
      ▼
protocol/deserialize.ts::parseMessage
      │  (dispatch on type byte)
      ├──▶ parseSnapshot       (existing)
      ├──▶ parseStateUpdate    (existing)
      └──▶ parseTerrain        (NEW)
                │
                ▼
          ParsedTerrain
                │
                ▼
net/connection.ts::handleMessage
                │
                ▼
state.ts::applyTerrain
                │
                ▼
        viewerState.terrain
                │  (read-only)
        ┌───────┴────────┐
        ▼                ▼
rendering/terrain.ts   rendering/entities.ts
 - buildMesh            - per-instance y =
 - computeNormals          getTerrainHeight(x,z)
 - getTerrainHeight        + verticalOffset
```

### Data Flow

1. Server sends SNAPSHOT, then (optionally) TERRAIN.
2. `parseMessage` dispatches on the 0x03 byte. `parseTerrain` validates header fields, confirms `buffer.byteLength === 33 + rows * cols * 8`, and returns a `ParsedTerrain` with a copied `Float64Array` of elevations (same "copy to detach from WebSocket buffer" discipline as SNAPSHOT).
3. `connection.handleMessage` routes `ParsedTerrain` to `applyTerrain`, which stores the grid on `viewerState.terrain`.
4. `main.ts` render loop detects a new terrain frame (via a `terrainRevision` counter incremented by `applyTerrain`). When the counter changes, it calls `resizeTerrain(mesh, viewerState.terrain)` which rebuilds the displaced geometry.
5. `updateEntities` calls `getTerrainHeight(x, z)` per entity to compute y.

### State Management

Extends `ViewerState`:

```
terrain: TerrainGrid | null    // null until first TERRAIN arrives; also null if server never sends one
terrainRevision: number        // incremented on every applyTerrain; render loop watches this
```

`TerrainGrid` (internal shape, not on the wire):
```
{
  rows: number
  cols: number
  resolution: number   // meters per cell
  originX: number
  originY: number
  elevation: Float64Array  // length = rows * cols, row-major
}
```

Ownership rule from slice 101 is preserved: only `state.ts` (called from `connection.ts`) mutates `viewerState.terrain`. Rendering reads it.

## Technical Decisions

### Geometry construction

Use `THREE.PlaneGeometry(worldW, worldH, cols - 1, rows - 1)` rotated `-π/2` around X so it lies in the XZ plane. World-space size is `cols * resolution` by `rows * resolution`. Position is `(originX + cols*resolution/2, 0, originY + rows*resolution/2)` so the mesh center matches the grid center.

Vertices are written in a single pass after construction: for each grid cell `(r, c)`, the corresponding vertex y is `elevation[r * cols + c]`. `PlaneGeometry`'s vertex ordering is row-major top-to-bottom in its local (unrotated) XY plane; after the `-π/2` rotation, rows map to the world z-axis. The TERRAIN spec says row 0 = southern edge = minimum z in our coordinate convention, so the row mapping must be verified against the `PlaneGeometry` ordering with a small test (see Verification).

After writing positions, call `geometry.computeVertexNormals()` and `geometry.attributes.position.needsUpdate = true`.

### Height lookup

`getTerrainHeight(x, z)` performs bilinear interpolation:
1. If `viewerState.terrain === null`, return `0`.
2. Compute fractional cell index `(fr, fc) = ((z - originY) / resolution - 0.5, (x - originX) / resolution - 0.5)` (cell centers are at `0.5`).
3. Clamp `fr ∈ [0, rows - 1]`, `fc ∈ [0, cols - 1]`.
4. Let `r0 = floor(fr)`, `c0 = floor(fc)`, `r1 = min(r0+1, rows-1)`, `c1 = min(c0+1, cols-1)`, `tr = fr - r0`, `tc = fc - c0`.
5. Interpolate the four corner elevations.

This is O(1) per call. With 50K entities and one lookup per frame, the cost is negligible.

### Entity vertical offset

Cones currently render centered on `y=0`. The cone geometry built in `entities.ts` has its point on `+Z` (after rotation) but its centroid at origin, meaning half the cone is below the ground. A `entityVerticalOffsetRatio` config value (default `0.5` × cone height) lifts the cone base to the terrain surface. This is cosmetic and can be tuned by the user.

### Validation ceiling

Add `config.terrainMaxCells` (default `4_000_000` = 2000×2000). `parseTerrain` rejects grids above the cap to mirror the spec's "32 MiB / ~2000² f64" reasoning on the client side, and to avoid a pathological server frame allocating hundreds of MB of elevation data. Rejection is non-fatal (log + skip frame); the viewer stays on whatever terrain it has.

### WebSocket payload ceiling

The browser `WebSocket` API has no client-side `max_size` equivalent — the browser accepts whatever the server sends, subject to browser-internal limits (multi-hundred-MB range, well above our 32 MiB server cap). This slice therefore does **not** add a browser-side knob. The spec's reference to "viewer sets its own client-side `max_size`" applies to future non-browser consumers (Node replay tools, etc.). A comment in `net/connection.ts` documents this asymmetry so a future maintainer does not chase a nonexistent API.

### No separate terrain material slice

Terrain uses the existing `MeshLambertMaterial` with `config.groundColor`. Biome-driven coloring waits for slice 109. This keeps the visual diff from slice 101 to this slice narrowly scoped to "topography appeared."

### Error handling

Consistent with existing protocol code:
- Malformed TERRAIN → `console.warn` + return null; no disconnect.
- `ParsedTerrain` arriving before SNAPSHOT: accepted (terrain is independent of entity state).
- Second TERRAIN on the same connection: accepted, replaces the first. The spec says one-per-connection, but the client does not enforce this — enforcement would mean silently ignoring a legitimate server reconfiguration.

### Patterns and Conventions

- New parser reuses `readU8`, `readU32LE`, `readF64LE` helpers — no direct `DataView` reads.
- `ParsedTerrain` follows the same "copy out of the WebSocket buffer" pattern as `ParsedSnapshot` (use `buffer.slice(...)` into a new `Float64Array`).
- `terrain.ts` keeps the public surface tight: `createTerrain(scene)`, `applyTerrainToMesh(mesh, grid)`, `getTerrainHeight(grid | null, x, z)`. `resizeTerrain` is removed (world-size-driven resize is no longer meaningful once elevation data owns the geometry).

## Implementation Details

### API Contracts

**New protocol type:**
```typescript
export interface ParsedTerrain {
  type: typeof MessageType.TERRAIN;
  rows: number;
  cols: number;
  resolution: number;
  originX: number;
  originY: number;              // wire-protocol naming; maps to world Z in Three.js space
  elevation: Float64Array;      // length = rows * cols, row-major
}
```

**Coordinate-naming note.** The wire protocol uses `origin_x` / `origin_y` because the server works in a 2D (x, y) grid. The viewer's 3D scene uses Three.js's (x, y, z) convention where **y is up** and the ground lies in the X-Z plane. Throughout this slice, wire-level `originY` and elevation-grid rows map to the world **Z axis**; vertex heights (the actual elevation values) occupy the world **Y axis**. `getTerrainHeight(grid, x, z)` takes world-space parameters and correctly uses `z` where the grid uses its row coordinate.

**New state mutation:**
```typescript
export function applyTerrain(state: ViewerState, parsed: ParsedTerrain): void;
```

**Terrain module public surface:**
```typescript
export function createTerrainMesh(scene: THREE.Scene): THREE.Mesh;
export function applyTerrainToMesh(mesh: THREE.Mesh, grid: TerrainGrid): void;
export function getTerrainHeight(grid: TerrainGrid | null, x: number, z: number): number;
```

### Config additions

```typescript
terrainMaxCells: number;           // default 4_000_000
entityVerticalOffsetRatio: number; // default 0.5 (of cone height)
```

## Integration Points

### Provides to Other Slices
- `getTerrainHeight(grid, x, z)` — used by 103 (overlays snap to surface) and 109 (biome rendering may need it for label placement).
- `viewerState.terrain` — raw grid available to any slice needing cell-level data.
- TERRAIN dispatch in `parseMessage` — reference implementation for the BIOME message slice 109 will add.

### Consumes from Other Slices
- Slice 101: `ViewerState`, `parseMessage`, `connection.handleMessage`, `applySnapshot`/`applyStateUpdate` patterns.
- Slice 100: `createScene`, lighting, `config`.
- Slice 104 (camera): no new dependency; perspective view simply becomes more useful.

## Success Criteria

### Functional Requirements
- Connecting to a server that sends TERRAIN renders a displaced surface matching the elevation grid.
- Connecting to a server that does not send TERRAIN leaves the viewer on a flat plane (unchanged behavior) with no errors.
- Entities render on the terrain surface (y ≈ terrain height + offset), not embedded or floating.
- Malformed TERRAIN frames (bad dimensions, length mismatch, zero/negative resolution, oversize grid) are logged and discarded without breaking the connection.
- A second TERRAIN frame on the same connection replaces the mesh.

### Technical Requirements
- All new parser code routes reads through `readU8` / `readU32LE` / `readF64LE`.
- `ViewerState` remains mutated exclusively via helpers in `state.ts`.
- `getTerrainHeight` correctness is unit-tested (corners, centers, interpolation midpoints, out-of-bounds clamp, null-grid fallback).
- TERRAIN parser is unit-tested (happy path, truncated buffer, header-field failures, length-mismatch, oversize cap).
- `terrain.ts`, `deserialize.ts`, and `entities.ts` all stay under ~300 lines and functions stay under ~50 lines.
- No `any`. No `as` assertions beyond what's already in the codebase.

### Verification Walkthrough

This walkthrough assumes a migratory server with slice 507 merged, configured to produce a non-trivial terrain layer (e.g., the `default.yaml` terrain example from 507 or a small perlin heightmap).

**1. Start server with terrain:**
```
# in the migratory world server repo
cd ../migratory-world-server
python -m migratory.server --config configs/terrain-default.yaml
# Expect on startup: "[server] max_message_bytes = 33554432"
# Expect on client connect (server log): "[server] sent TERRAIN 0x03 rows=R cols=C"
```

**2. Start the viewer:**
```
cd migratory-viewer
pnpm dev
# Open the printed localhost URL
```

**3. Confirm topography in orthographic (top-down) view:**
- Open the browser devtools console. Expect a log line like `[net] TERRAIN rows=R cols=C resolution=X`. No warnings.
- The ground is no longer a uniform single-tone plane: lighting differences across slopes are visible. Shaded slopes are darker than flat areas because vertex normals now vary.

**4. Switch to perspective view (slice 104 button or `V` key):**
- Topography is clearly visible as elevation differences.
- Double-click the canvas resets framing; terrain remains.

**5. Confirm entities sit on the surface:**
- Cones rest on the terrain at each position, not on a fixed plane. Cones on a hill are visibly higher than cones in a valley.
- Zoom in (wheel) on a cone near a slope and confirm its base is flush with the surface, not floating or buried.

**6. Confirm no-terrain fallback:**
```
python -m migratory.server --config configs/no-terrain.yaml
# (a config with environment.layers having no "terrain:" section)
```
Refresh the viewer.
- Flat plane renders as before slice 102.
- Console shows no TERRAIN log and no warnings.

**7. Confirm malformed-frame tolerance:**
Add a temporary server debug hook (or use a WebSocket fuzzer) to emit a TERRAIN frame with `rows=0`, or truncated by one byte, or with an elevation array sized for one fewer cell.
- Expect `[protocol] ...` warnings from the parser in the viewer console.
- Viewer continues to render the last good terrain (or flat plane if no prior good terrain).
- Connection remains open; state updates continue.

**8. Unit tests:**
```
pnpm test
# Expect green:
#   protocol/deserialize.test.ts — terrain cases
#   rendering/terrain.test.ts — getTerrainHeight cases
```

**9. Build check:**
```
pnpm build
# tsc + vite build both succeed with no new warnings.
```

## Implementation Notes

### Development Approach

Suggested order:
1. **Protocol first.** Add `MessageType.TERRAIN`, `ParsedTerrain`, `parseTerrain`, and unit tests. This is isolated and test-driven.
2. **State.** Extend `ViewerState`, add `applyTerrain` and `terrainRevision`, wire into `connection.handleMessage`.
3. **Height lookup.** Write `getTerrainHeight` with tests against a fixed 3×3 fixture grid before any rendering work — this is the piece that's easiest to get subtly wrong.
4. **Terrain mesh.** Rewrite `terrain.ts` to build displaced `PlaneGeometry`. Verify row-ordering by loading a fixture grid with a known asymmetric pattern (e.g., a ramp from north to south) and eyeballing it in the viewer.
5. **Entity y-placement.** Wire `getTerrainHeight` into `updateEntities`; verify cones sit on the surface across flat, sloped, and corner regions.
6. **Main-loop integration.** Detect `terrainRevision` changes; rebuild the mesh when it increments.
7. **Manual verification** per the walkthrough above.
8. **Finalization.**

### Special Considerations

- **Row-major ordering is the bug-farm.** The TERRAIN spec's row 0 = southern edge convention must be matched to Three.js's `PlaneGeometry` vertex order after the `-π/2` rotation. Do not rely on symmetric fixtures during development; use an asymmetric ramp fixture so row-direction errors are immediately visible.
- **Don't re-allocate geometry on every update.** `applyTerrainToMesh` should dispose the prior `geometry` before assigning the new one to avoid GPU memory leaks across repeated TERRAIN frames.
- **Keep `entities.ts` lightweight.** The new y-lookup is one function call per instance; resist the urge to precompute or cache anything until slice 106 (performance) proves it's needed.
