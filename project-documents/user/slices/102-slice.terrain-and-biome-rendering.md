---
docType: slice-design
slice: terrain-and-biome-rendering
project: migratory-viewer
parent: user/architecture/100-slices.viewer-foundation.md
dependencies: [101-websocket-consumer-and-live-entity-rendering]
interfaces: [103-environment-overlay-rendering]
dateCreated: 20260406
dateUpdated: 20260406
status: not_started
---

# Slice Design: Terrain and Biome Rendering

## Overview

This slice replaces the flat ground plane from slice 100 with a terrain system capable of rendering displaced elevation data. The server has real terrain (migratory slice 501 complete), but the wire protocol doesn't carry it yet — so the viewer renders a flat plane until a protocol extension delivers elevation grids. The critical deliverable is the **terrain height lookup**: entities must render at terrain height at their world positions, and the terrain module must accept elevation data from any source so that swapping in server data is a one-line change.

## Value

**User-facing:** When elevation data arrives (via protocol extension or test data), the viewer renders a displaced terrain mesh with correct lighting and normals instead of a featureless flat plane. Entities ride the terrain surface rather than floating at y=0.

**Architectural enablement:** Establishes the `getTerrainHeight()` interface that entities, environment overlays (slice 103), and camera follow-cam (slice 104) all depend on. The biome color stub provides the extension point for slice 502 data.

## Technical Scope

### Included
- Subdivided `PlaneGeometry` replacing the current flat plane (segment count configurable for resolution)
- `applyElevationGrid()` function that accepts a `Float64Array` (or `Float32Array`) elevation grid and displaces vertex Y positions
- Vertex normal recomputation after displacement (`geometry.computeVertexNormals()`)
- `getTerrainHeight(x, z)` lookup function using bilinear interpolation on the elevation grid
- Entity Y-positioning: entities render at `getTerrainHeight(x, z)` instead of `y = 0`
- Test elevation data generator for visual verification (procedural sine-based terrain matching the prototype pattern)
- Biome color layer stub: uniform ground color, with a documented interface for accepting per-vertex or texture-based biome coloring
- Config additions: terrain segment resolution, test terrain toggle
- Updates to `entities.ts` to use terrain height lookup

### Excluded
- Wire protocol extension for terrain data (migratory-side work)
- Actual biome rendering with per-vertex colors or texture atlas (awaits slice 502 data)
- Environment overlays atop terrain (slice 103)
- Terrain LOD or chunked rendering (slice 106 performance work)
- Procedural terrain generation for production use — test data is explicitly for verification only

## Dependencies

### Prerequisites
- **(101) WebSocket Consumer and Live Entity Rendering** — Entities must be rendering from server data before terrain height can be applied to them. The terrain module itself has no WebSocket dependency, but the entity integration does.
- **(100) Project Scaffold and Rendering Core** — Complete. Provides `terrain.ts`, `entities.ts`, `config.ts`, scene infrastructure.

### External
- **migratory protocol extension** — A future new message type (0x03–0x0F reserved range) to carry the elevation grid in the snapshot. Until this exists, the viewer uses flat or test terrain. This slice does not block on this extension — it builds the rendering infrastructure so that consuming server terrain is trivial when it arrives.

## Architecture

### Component Structure

Changes are confined to existing modules plus one new utility:

```
src/
├── rendering/
│   ├── terrain.ts          # MODIFIED: subdivided geometry, displacement, height lookup
│   └── entities.ts         # MODIFIED: use getTerrainHeight() for entity Y position
├── config.ts               # MODIFIED: add terrain config fields
└── types.ts                # MODIFIED: add ElevationGrid type
```

No new files are needed. The terrain height lookup is exported from `terrain.ts` and imported by `entities.ts`.

### Data Flow

```
Terrain initialization (on snapshot or startup):
  config.ts → terrain segment resolution, world bounds
  → terrain.ts: createTerrain() builds subdivided PlaneGeometry
  → if test mode: generateTestElevation() → applyElevationGrid()
  → if server data arrives (future): applyElevationGrid(serverGrid)

Per-tick entity rendering (slice 101 integration):
  positions (Float64Array from server)
  → entities.ts: for each entity, y = getTerrainHeight(x, z)
  → InstancedMesh matrix update with terrain-aware Y position

Height lookup:
  getTerrainHeight(x, z)
  → if no elevation data loaded: return 0 (flat plane behavior)
  → if elevation grid loaded: bilinear interpolation on grid
```

### Key Interfaces

#### ElevationGrid Type

```typescript
/** Elevation data for terrain displacement. */
interface ElevationGrid {
  /** Row-major elevation values, sized gridWidth × gridHeight. */
  data: Float64Array | Float32Array;
  /** Number of columns in the grid. */
  gridWidth: number;
  /** Number of rows in the grid. */
  gridHeight: number;
  /** World-space width the grid covers. */
  worldWidth: number;
  /** World-space height (depth) the grid covers. */
  worldHeight: number;
}
```

This is the interface the protocol extension will fill. The terrain module is agnostic to data source — it takes an `ElevationGrid` and displaces geometry.

#### Terrain Module Exports

```typescript
/** Create terrain mesh with subdivided geometry. Returns the mesh. */
function createTerrain(scene: THREE.Scene, worldWidth: number, worldHeight: number): THREE.Mesh;

/** Apply elevation data to the terrain mesh. Displaces vertices and recomputes normals. */
function applyElevationGrid(grid: ElevationGrid): void;

/** Look up terrain height at a world position. Returns 0 if no elevation data loaded. */
function getTerrainHeight(x: number, z: number): number;

/** Generate procedural test elevation data for visual verification. */
function generateTestElevation(worldWidth: number, worldHeight: number, segments: number): ElevationGrid;
```

#### Entity Integration

`entities.ts` currently positions entities at `y = 0`. After this slice, entity matrix updates call `getTerrainHeight(x, z)` to set the Y coordinate. This applies to both the test entities (slice 100's random data) and live entities (slice 101's server data).

## Technical Decisions

### Subdivided PlaneGeometry for Displacement

The current `PlaneGeometry(worldWidth, worldHeight)` has no subdivisions — it's two triangles. Terrain displacement requires subdivisions so that vertices can be individually positioned. The geometry becomes `PlaneGeometry(worldWidth, worldHeight, segments, segments)` where `segments` is configurable.

**Segment count trade-off:** More segments = higher terrain fidelity but more vertices. For a 1000×1000 world:
- 64×64 segments = 4,225 vertices — adequate for gentle rolling terrain
- 128×128 segments = 16,641 vertices — good detail for varied elevation
- 256×256 segments = 66,049 vertices — high detail, still well within GPU budget

Default: 128 segments. This provides ~8-unit resolution on a 1000-unit world, which is sufficient to capture elevation features that affect agent movement without being wasteful. Configurable via `config.terrainSegments`.

### Bilinear Interpolation for Height Lookup

`getTerrainHeight(x, z)` must return smooth height values for arbitrary world positions, not just grid points. Bilinear interpolation between the four nearest grid points provides continuous height without visible stepping. This is the same approach used in the server-side terrain lookup.

For positions outside world bounds, clamp to the nearest edge value rather than returning 0 — entities near world edges should still sit on the terrain surface.

### Test Elevation Generator

For visual verification before server terrain data is available, a procedural generator creates a sine-based elevation pattern matching the prototype:

```
y = sin(x * 0.08) * cos(z * 0.06) * amplitude + sin(x * 0.03 + z * 0.04) * (amplitude * 0.6)
```

This is the same formula used in `02-migratory-threejs-instanced-terrain.html` (prototype reference), scaled to the world bounds. It produces gentle rolling hills that are visually distinct from a flat plane and verify that:
- Vertex displacement works correctly
- Normals are recomputed (lighting responds to slopes)
- Entity Y-positioning follows the terrain surface
- The height lookup interpolation is smooth

Test elevation is enabled via `config.useTestTerrain` (default: `false` in production, toggled for development). When the server protocol extension arrives, this flag becomes irrelevant — real data replaces test data.

### Flat Plane as Default Behavior

When no elevation data is loaded (no test terrain, no server data), `getTerrainHeight()` returns 0 for all positions. The terrain mesh remains flat. This preserves slice 100/101 behavior — existing functionality is not disrupted. The flat plane is the correct rendering when no elevation data exists.

### Biome Color Stub

The biome layer (migratory slice 502, not started) will provide per-cell biome type data. The terrain module prepares for this by:
- Using `MeshLambertMaterial` which supports vertex colors
- Documenting the interface: `applyBiomeColors(biomeGrid)` will set per-vertex colors based on biome type mapped through a biome color palette
- Not implementing the function yet — there's no data to render and no protocol to carry it

This is a documented extension point, not code.

### Entity Height Offset

Entities should render slightly above the terrain surface, not intersecting it. A small Y offset (half the cone height) ensures the cone base sits on the terrain rather than the cone center being at terrain height. This offset is derived from `config.coneHeight / 2`.

## Integration Points

### Provides to Other Slices

- **`getTerrainHeight(x, z)`** — Used by:
  - `entities.ts` (this slice) for entity Y-positioning
  - slice 103 (Environment Overlays) for placing resource points and threat zones on terrain
  - slice 104 (Camera Modes) for follow-cam height offset
- **`applyElevationGrid(grid)`** — Used by future protocol handler when terrain data message type is implemented
- **`ElevationGrid` type** — Shared interface for terrain data from any source

### Consumes from Other Slices

- **(100) Project Scaffold** — `terrain.ts` module, `config.ts`, scene infrastructure, `entities.ts`
- **(101) WebSocket Consumer** — Entity position/velocity data that needs terrain-aware Y coordinate (the terrain module itself is independent, but the entity integration requires slice 101's data flow)

## Success Criteria

### Functional Requirements
- Terrain mesh uses subdivided geometry (configurable segment count)
- `applyElevationGrid()` displaces vertex Y positions from an elevation grid
- Vertex normals are recomputed after displacement — lighting responds to terrain slopes
- `getTerrainHeight(x, z)` returns interpolated height for arbitrary world positions
- `getTerrainHeight()` returns 0 when no elevation data is loaded (preserves flat behavior)
- Entities render at terrain height (visible when test terrain is enabled)
- Test terrain generator produces visually distinct rolling hills
- Biome color interface is documented but not implemented

### Technical Requirements
- `ElevationGrid` interface defined in `types.ts`
- Terrain segment count and test terrain flag are in `config.ts` — no magic numbers in `terrain.ts`
- Height lookup uses bilinear interpolation, not nearest-neighbor
- Positions outside world bounds clamp to edge values
- Entity Y includes height offset (`coneHeight / 2`) so cones sit on surface
- TypeScript compiles without errors (`npx tsc --noEmit`)
- No regression: with test terrain disabled, viewer renders identically to slice 101 output

### Verification Walkthrough

1. **Test terrain enabled:**
   Set `config.useTestTerrain = true` (or via environment variable). Run `pnpm dev`. The ground plane should show rolling hills with visible lighting variation on slopes — not a flat plane.

2. **Entity terrain following:**
   With test terrain enabled, entities (cones) should follow the terrain surface — riding up hills and down valleys. No entities should be floating above or buried below the terrain.

3. **Flat plane default:**
   With `useTestTerrain = false` (default), the viewer should render identically to the slice 101 baseline — flat ground plane, entities at y=0.

4. **Height lookup accuracy:**
   At world center (500, 500), `getTerrainHeight(500, 500)` should return a value matching the test elevation formula. At world corners (0, 0) and (1000, 1000), values should be plausible (not NaN, not extreme).

5. **Type check and build:**
   ```bash
   npx tsc --noEmit   # exits 0
   pnpm build          # produces dist/ without errors
   ```

## Implementation Notes

### Development Approach

1. **Types and config** — Add `ElevationGrid` to `types.ts`, add `terrainSegments` and `useTestTerrain` to `config.ts`
2. **Terrain geometry** — Update `createTerrain()` to use subdivided `PlaneGeometry`. Verify flat plane still renders correctly.
3. **Elevation displacement** — Implement `applyElevationGrid()` and `generateTestElevation()`. Verify displaced terrain renders with correct normals.
4. **Height lookup** — Implement `getTerrainHeight()` with bilinear interpolation. Verify interpolated values are correct.
5. **Entity integration** — Update entity matrix updates to use `getTerrainHeight()`. Verify entities follow terrain surface.
6. **Test terrain toggle** — Wire up `useTestTerrain` config flag. Verify toggle behavior.

### Special Considerations

- The `PlaneGeometry` is rotated to the XZ plane (`rotateX(-Math.PI / 2)`). After rotation, the geometry's local Y axis maps to world Y (height). When displacing, modify the position attribute's Y component (which is the 2nd component, index 1, in the buffer).
- After `geometry.rotateX()`, the position buffer already has the rotation baked in. Displacement should set Y values directly — they are already in world space after the rotation.
- `computeVertexNormals()` must be called after every displacement update, not just once.
- The test elevation generator and `applyElevationGrid` share no code — the generator creates data, the applier consumes it. Keep them separate.
