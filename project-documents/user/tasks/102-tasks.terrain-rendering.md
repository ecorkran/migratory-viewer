---
docType: slice-tasks
parent: user/slices/102-slice.terrain-rendering.md
project: migratory-viewer
dateCreated: 20260418
dateUpdated: 20260418
status: complete
dependencies:
  - slice 100 (Project Scaffold) — complete
  - slice 101 (WebSocket Consumer) — complete
currentProjectState: >
  Viewer renders live entities from WebSocket SNAPSHOT (0x01) and STATE_UPDATE (0x02)
  messages. A flat MeshLambertMaterial plane sized to world bounds serves as ground
  (src/rendering/terrain.ts). Entities render at y=0 regardless of world elevation.
  ViewerState (src/types.ts + src/state.ts) is mutated exclusively from src/net/connection.ts
  via applySnapshot/applyStateUpdate. Protocol parsing is in src/protocol/{types,deserialize}.ts
  using readU8/readU32LE/readF64LE helpers. Camera work through slice 104 is complete.
---

# Slice Tasks: Terrain Rendering

## Context Summary

Consume the TERRAIN (0x03) wire message (migratory slice 507) and render the server's elevation grid as a displaced `PlaneGeometry`. Add a `getTerrainHeight(grid, x, z)` bilinear-interpolation lookup; wire it into entity placement so cones sit on the terrain surface. Preserve the flat-plane fallback for servers that don't send TERRAIN.

Sequencing follows the slice design's suggested order: protocol first (isolated, test-driven), then state, then the height lookup (tested against a fixed fixture before any rendering), then the mesh rewrite, then entity integration, then main-loop wiring, then manual verification and finalization.

**Coordinate note.** The TERRAIN wire spec uses `origin_x` / `origin_y` in 2D server space. In the viewer's 3D scene, Y is up; wire `originY` and elevation-grid rows map to world Z. `getTerrainHeight` takes world-space `(x, z)`.

Relevant files:
- [src/protocol/types.ts](../../../src/protocol/types.ts) — add TERRAIN type byte and `ParsedTerrain`
- [src/protocol/deserialize.ts](../../../src/protocol/deserialize.ts) — add `parseTerrain`, extend dispatch
- [src/protocol/deserialize.test.ts](../../../src/protocol/deserialize.test.ts) — add TERRAIN tests
- [src/types.ts](../../../src/types.ts) — extend `ViewerState` with `terrain` and `terrainRevision`
- [src/state.ts](../../../src/state.ts) — add `applyTerrain`
- [src/net/connection.ts](../../../src/net/connection.ts) — dispatch TERRAIN to `applyTerrain`
- [src/rendering/terrain.ts](../../../src/rendering/terrain.ts) — rewrite for displaced geometry + height lookup
- [src/rendering/terrain.test.ts](../../../src/rendering/terrain.test.ts) — new file for `getTerrainHeight` tests
- [src/rendering/entities.ts](../../../src/rendering/entities.ts) — y-placement via `getTerrainHeight`
- [src/main.ts](../../../src/main.ts) — detect `terrainRevision` changes, rebuild mesh
- [src/config.ts](../../../src/config.ts) — add `terrainMaxCells`, `entityVerticalOffsetRatio`
- Slice design: [102-slice.terrain-rendering.md](../slices/102-slice.terrain-rendering.md)

---

## Tasks

### 1. Branch setup and config additions

- [x] **1.1 Create or switch to slice branch**
  - From `main`, run: `git checkout -b 102-terrain-rendering` (or `git checkout 102-terrain-rendering` if it exists).
  - Success: current branch is `102-terrain-rendering`; working tree is clean.

- [x] **1.2 Add terrain config fields to `config.ts`**
  - Add to [src/config.ts](../../../src/config.ts):
    ```
    terrainMaxCells: number            // default 4_000_000  (= 2000 × 2000)
    entityVerticalOffsetRatio: number  // default 0.5  (fraction of cone height)
    ```
  - Add matching entries in the `ViewerConfig` interface with short JSDoc comments.
  - Success: `pnpm tsc --noEmit` clean; `config.terrainMaxCells` and `config.entityVerticalOffsetRatio` import cleanly from any source file.

- [x] **1.3 Commit: config additions**
  - Commit message: `feat(config): add terrain config fields`.

### 2. Protocol: TERRAIN message type and parser

- [x] **2.1 Add TERRAIN message-type constant and `ParsedTerrain` type**
  - In [src/protocol/types.ts](../../../src/protocol/types.ts):
    - Add `TERRAIN: 0x03` to the `MessageType` const object.
    - Add `ParsedTerrain` interface with fields: `type` (= TERRAIN), `rows`, `cols`, `resolution`, `originX`, `originY`, `elevation: Float64Array`.
    - Extend the `ParsedMessage` discriminated union to include `ParsedTerrain`.
  - Success: `pnpm tsc --noEmit` clean. Existing `parseMessage` compiles (the switch is non-exhaustive by design — default branch handles unknown types).

- [x] **2.2 Implement `parseTerrain` and extend `parseMessage` dispatch**
  - In [src/protocol/deserialize.ts](../../../src/protocol/deserialize.ts):
    - Add constants `TERRAIN_HEADER_BYTES = 33` and `TERRAIN_BYTES_PER_CELL = 8`.
    - Add `parseTerrain(buffer, view): ParsedTerrain | null` that:
      1. Verifies `buffer.byteLength >= TERRAIN_HEADER_BYTES`; warn + null otherwise.
      2. Reads `rows` (u32 @1), `cols` (u32 @5), `resolution` (f64 @9), `originX` (f64 @17), `originY` (f64 @25).
      3. Rejects `rows === 0`, `cols === 0`, or `resolution <= 0` with a logged warning.
      4. Rejects `rows * cols > config.terrainMaxCells` with a logged warning.
      5. Verifies `buffer.byteLength === TERRAIN_HEADER_BYTES + rows * cols * TERRAIN_BYTES_PER_CELL`; warn + null on mismatch.
      6. Copies elevation bytes via `buffer.slice(...)` into a new `Float64Array` (detach from WebSocket buffer).
      7. Returns a `ParsedTerrain` with `type: MessageType.TERRAIN`.
    - Add `case MessageType.TERRAIN: return parseTerrain(buffer, view);` to the `parseMessage` switch.
  - All reads must go through `readU8` / `readU32LE` / `readF64LE`. No direct `view.getXxx` calls.
  - Success: `pnpm tsc --noEmit` clean; build passes.

- [x] **2.3 Unit tests for `parseTerrain`**
  - Extend [src/protocol/deserialize.test.ts](../../../src/protocol/deserialize.test.ts) with TERRAIN cases. Add a small test helper that builds a TERRAIN buffer from `rows`, `cols`, `resolution`, `originX`, `originY`, `elevation: number[]` (convenience, not production code).
  - Cover:
    1. Happy path: 2×3 grid with distinct elevation values round-trips correctly (dimensions, resolution, origin, all 6 elevation values, row-major ordering verified).
    2. Truncated buffer (header short by 1 byte) → returns null, warns.
    3. `rows === 0` → returns null.
    4. `cols === 0` → returns null.
    5. `resolution === 0` → returns null.
    6. `resolution` negative → returns null.
    7. Length mismatch (declared `rows*cols` ≠ payload size) → returns null.
    8. Over-cap: `rows*cols > config.terrainMaxCells` → returns null.
    9. Dispatch: a buffer starting with `0x03` routed through `parseMessage` returns `ParsedTerrain`.
  - Success: `pnpm test` green for all new TERRAIN cases; previous SNAPSHOT/STATE_UPDATE tests still pass.

- [x] **2.4 Commit: protocol TERRAIN support**
  - Commit message: `feat(protocol): add TERRAIN (0x03) parser`.

### 3. State: `applyTerrain` and `ViewerState` extension

- [x] **3.1 Extend `ViewerState` with terrain fields**
  - In [src/types.ts](../../../src/types.ts):
    - Define a `TerrainGrid` interface: `rows`, `cols`, `resolution`, `originX`, `originY`, `elevation: Float64Array`. Exported.
    - Add to `ViewerState`: `terrain: TerrainGrid | null` and `terrainRevision: number`.
    - Update `createInitialViewerState()` to set `terrain: null` and `terrainRevision: 0`.
  - Success: `pnpm tsc --noEmit` clean. No existing consumers break (both new fields are additive).

- [x] **3.2 Add `applyTerrain` mutation helper**
  - In [src/state.ts](../../../src/state.ts):
    - Import `ParsedTerrain` from the protocol types.
    - Add `applyTerrain(state, parsed)` that:
      1. Builds a `TerrainGrid` from the parsed fields (direct field copy — same `Float64Array` reference, already detached by the parser).
      2. Assigns it to `state.terrain`.
      3. Increments `state.terrainRevision` by 1.
    - Do **not** touch `worldWidth`, `worldHeight`, or any entity fields.
  - Preserve the ownership comment at the top of the file — `connection.ts` remains the sole caller.
  - Success: `pnpm tsc --noEmit` clean.

- [x] **3.3 Dispatch TERRAIN in `connection.handleMessage`**
  - In [src/net/connection.ts](../../../src/net/connection.ts):
    - Import `applyTerrain`.
    - Add a branch to `handleMessage` dispatching `parsed.type === MessageType.TERRAIN` to `applyTerrain(viewerState, parsed)`.
    - Place it between the SNAPSHOT and STATE_UPDATE branches for readability.
    - Add an `info`-level log: `` `[net] TERRAIN rows=${parsed.rows} cols=${parsed.cols} resolution=${parsed.resolution}` ``.
    - Add a short comment near the `new WebSocket(url)` call documenting that the browser `WebSocket` API has no client-side `max_size` knob (the server's 32 MiB cap from migratory slice 507 is asymmetric by design; future Node-based consumers would need to set their own limit).
  - Success: `pnpm tsc --noEmit` clean; `pnpm test` still green.

- [x] **3.4 Commit: state + connection dispatch for TERRAIN**
  - Commit message: `feat(state): add applyTerrain and wire connection dispatch`.

### 4. Terrain height lookup (test-driven)

This is the piece most prone to subtle row/column errors. Implement against tests before any rendering code uses it.

- [x] **4.1 Add `getTerrainHeight` to `terrain.ts`**
  - In [src/rendering/terrain.ts](../../../src/rendering/terrain.ts), add and export:
    ```
    getTerrainHeight(grid: TerrainGrid | null, x: number, z: number): number
    ```
  - Behavior (per slice design "Height lookup"):
    1. `grid === null` → return `0`.
    2. Compute `fr = (z - originY) / resolution - 0.5`, `fc = (x - originX) / resolution - 0.5`.
    3. Clamp `fr ∈ [0, rows-1]`, `fc ∈ [0, cols-1]`.
    4. Bilinear interpolate the four corner elevations (`r0, c0`, `r0, c1`, `r1, c0`, `r1, c1`; `r1 = min(r0+1, rows-1)`, `c1 = min(c0+1, cols-1)`).
  - Do not add other behavior yet — no mesh code in this task.
  - Success: `pnpm tsc --noEmit` clean.

- [x] **4.2 Unit tests for `getTerrainHeight`**
  - Create [src/rendering/terrain.test.ts](../../../src/rendering/terrain.test.ts). Use an asymmetric 3×3 fixture (elevation values `[0,1,2, 3,4,5, 6,7,8]`, `resolution = 10`, `originX = 0`, `originY = 0`) so row/column confusion is visible.
  - Cover:
    1. Null grid at any `(x, z)` → `0`.
    2. Cell centers return the stored elevation exactly (test at least 3 distinct centers including a non-symmetric one — e.g., `(x=15, z=5)` returns `elevation[row=0, col=1] = 1`).
    3. Midpoint between two adjacent cell centers returns the arithmetic mean.
    4. Out-of-bounds `(x, z)` clamps to the nearest edge elevation (test all four edges).
    5. Exact grid origin `(originX, originY)` clamps to the corner elevation at `(row=0, col=0) = 0`.
    6. Grid far corner `(originX + cols*resolution, originY + rows*resolution)` clamps to `(row=rows-1, col=cols-1) = 8`.
  - Success: `pnpm test` green for all cases.

- [x] **4.3 Commit: terrain height lookup**
  - Commit message: `feat(terrain): add getTerrainHeight with bilinear interpolation`.

### 5. Terrain mesh: displaced geometry

- [x] **5.1 Rewrite `createTerrain` → `createTerrainMesh` (empty mesh)**
  - In [src/rendering/terrain.ts](../../../src/rendering/terrain.ts):
    - Rename `createTerrain` to `createTerrainMesh(scene)`. Signature takes only `scene` — no world dimensions.
    - Start the mesh with a minimal placeholder `PlaneGeometry(1, 1)` rotated to lie in XZ, added to the scene. Will be replaced immediately on the first render frame by either `applyTerrainToMesh` (terrain present) or `applyFlatPlane` (no-terrain fallback, added in 5.3).
    - Keep `MeshLambertMaterial({ color: config.groundColor })`.
    - Remove the old `resizeTerrain` export.
  - Success: `pnpm tsc --noEmit` clean. `entities.ts` / `main.ts` will be updated in later tasks — leaving their imports temporarily broken is acceptable but should be resolved before commit 5.5.

- [x] **5.2 Add `applyTerrainToMesh(mesh, grid)`**
  - In [src/rendering/terrain.ts](../../../src/rendering/terrain.ts), add and export:
    ```
    applyTerrainToMesh(mesh: THREE.Mesh, grid: TerrainGrid): void
    ```
  - Behavior:
    1. Build `new THREE.PlaneGeometry(cols * resolution, rows * resolution, cols - 1, rows - 1)`.
    2. Rotate `-π/2` around X so it lies in XZ.
    3. For each vertex at grid `(r, c)`, write `position.y = elevation[r * cols + c]`. Verify vertex ordering by examining `PlaneGeometry` docs — after the X rotation, PlaneGeometry's local-Y rows map to world-Z. Map row 0 (southern edge, minimum Z) correctly.
    4. Call `geometry.computeVertexNormals()`.
    5. Dispose the mesh's prior `geometry` (`mesh.geometry.dispose()`) before assigning the new one to avoid GPU leaks across repeated TERRAIN frames.
    6. Position the mesh at `(originX + cols*resolution/2, 0, originY + rows*resolution/2)`.
  - Success: `pnpm tsc --noEmit` clean.

- [x] **5.3 Fallback path: `applyFlatPlane(mesh, worldWidth, worldHeight)`**
  - In [src/rendering/terrain.ts](../../../src/rendering/terrain.ts), add and export:
    ```
    applyFlatPlane(mesh: THREE.Mesh, worldWidth: number, worldHeight: number): void
    ```
  - Behavior: dispose `mesh.geometry`; build `new THREE.PlaneGeometry(worldWidth, worldHeight)` rotated `-π/2` around X; assign to `mesh.geometry`; call `geometry.computeVertexNormals()`; position the mesh at `(worldWidth / 2, 0, worldHeight / 2)` (same centering the pre-slice-102 `createTerrain` used).
  - This preserves the slice 101 behavior: when the server does not send TERRAIN, the viewer still shows a world-sized flat ground plane with correct lighting. Main-loop integration (task 7.1) chooses between `applyTerrainToMesh` and `applyFlatPlane` based on `viewerState.terrain`.
  - Success: `pnpm tsc --noEmit` clean.

- [x] **5.4 Unit-level sanity check: mesh vertex mapping and re-application**
  - Extend [src/rendering/terrain.test.ts](../../../src/rendering/terrain.test.ts) with two tests:
  - **Test A — vertex mapping (row→Z ordering):**
    - Build a fixture `TerrainGrid` with asymmetric elevation (ramp: row 0 all `0`, last row all `10`).
    - Create a `THREE.Mesh` with empty `BufferGeometry` (or invoke `createTerrainMesh(scene)` with a dummy scene).
    - Call `applyTerrainToMesh(mesh, grid)`.
    - Read back `mesh.geometry.attributes.position`; assert:
      1. Vertices at the southern edge (minimum world Z after rotation) have y ≈ `0`.
      2. Vertices at the northern edge (maximum world Z) have y ≈ `10`.
    - This test detects the common "rows indexed backward" bug at unit-test time rather than requiring manual verification.
  - **Test B — second TERRAIN replaces geometry (Functional Requirement 5):**
    - Start with the mesh from Test A (elevation ramp 0→10).
    - Call `applyTerrainToMesh(mesh, gridB)` with a second fixture grid whose elevations are all `20`.
    - Assert that every vertex y in `mesh.geometry.attributes.position` is ≈ `20` — i.e., the second grid fully replaced the first. Also assert that the old geometry was disposed (check the old `BufferGeometry` reference's `disposed` state via a spy on `dispose()` before the second call).
  - Success: both tests green.

- [x] **5.5 Commit: terrain mesh rewrite**
  - Commit message: `feat(terrain): displaced PlaneGeometry from TERRAIN grid`.

### 6. Entity y-placement via terrain height

- [x] **6.1 Compute per-instance y from `getTerrainHeight` in `updateEntities`**
  - In [src/rendering/entities.ts](../../../src/rendering/entities.ts):
    - Import `getTerrainHeight` and `TerrainGrid`.
    - Change `updateEntities` signature to accept the terrain grid: `updateEntities(mesh, state)` already receives `state`, which now includes `state.terrain` — no signature change needed.
    - In the per-entity loop, compute the vertical offset once per call:
      ```
      const refSize = Math.min(state.worldWidth, state.worldHeight);
      const coneHeight = refSize * config.coneHeightRatio;
      const verticalOffset = coneHeight * config.entityVerticalOffsetRatio;
      ```
    - Replace `dummy.position.set(x, 0, y)` with:
      ```
      const h = getTerrainHeight(state.terrain, x, y);  // server y → world z
      dummy.position.set(x, h + verticalOffset, y);
      ```
    - The `y` local variable here is the server's 2D y-coordinate, which maps to world Z — matches the existing code's `(x, 0, y)` mapping.
  - Success: `pnpm tsc --noEmit` clean; existing entity tests still pass.

- [x] **6.2 Update entity tests for terrain-aware placement**
  - In [src/rendering/entities.test.ts](../../../src/rendering/entities.test.ts), update or extend one existing test so that:
    - A state with `terrain === null` still places entities at `y = verticalOffset` (cosmetic offset only, no terrain lookup).
    - A state with a synthetic `TerrainGrid` (constant elevation = 5) places entities at `y ≈ 5 + verticalOffset`.
  - Do not overhaul the whole test file — one flat-case and one terrain-case update is sufficient.
  - Success: `pnpm test` green.

- [x] **6.3 Commit: entity y-placement on terrain**
  - Commit message: `feat(entities): place instances on terrain surface`.

### 7. Main-loop integration

- [x] **7.1 Detect terrain revision changes in the render loop**
  - In [src/main.ts](../../../src/main.ts):
    - Replace `createTerrain(scene, worldWidth, worldHeight)` with `createTerrainMesh(scene)`.
    - Replace the `resizeTerrain(...)` call in the world-bounds-change block with a call to `applyFlatPlane(terrainMesh, lastWorldWidth, lastWorldHeight)` — gated on `viewerState.terrain === null`. When a terrain grid is present, the TERRAIN mesh owns sizing and world-bounds changes are ignored by the terrain path (the plane dimensions come from the grid header).
    - Add `let lastTerrainRevision = 0;` at module scope.
    - In the render loop, after the world-bounds check, add:
      ```
      if (viewerState.terrain !== null && viewerState.terrainRevision !== lastTerrainRevision) {
        applyTerrainToMesh(terrainMesh, viewerState.terrain);
        lastTerrainRevision = viewerState.terrainRevision;
      }
      ```
    - Ensure the first SNAPSHOT with no TERRAIN still produces a world-sized flat plane: the world-bounds-change block runs on the first frame after SNAPSHOT because `lastWorldWidth`/`lastWorldHeight` start at the pre-snapshot defaults, so `applyFlatPlane` is invoked once. Verify this path exists and is reached when `viewerState.terrain === null`.
  - Success: `pnpm tsc --noEmit` clean; `pnpm build` passes.

- [x] **7.2 Commit: main-loop terrain rebuild**
  - Commit message: `feat(main): rebuild terrain mesh on TERRAIN revision`.

### 8. Manual verification

Follow the verification walkthrough from the slice design (`102-slice.terrain-rendering.md` → "Verification Walkthrough"). Execute each step and check it off here.

- [x] **8.1 Pre-flight: build and unit tests green**
  - `pnpm tsc --noEmit` clean.
  - `pnpm test` all green (protocol, state, terrain, entities).
  - `pnpm build` succeeds.

- [x] **8.2 Topography renders with a terrain-enabled server** (requires live server)
  - Start a migratory server configured with a terrain layer (e.g., `configs/terrain-default.yaml` or the default.yaml example from migratory slice 507).
  - Start the viewer: `pnpm dev`.
  - Devtools console: expect `[net] TERRAIN rows=… cols=… resolution=…`; no warnings.
  - In orthographic view: slope shading is visible (not a uniform single-tone plane).

- [x] **8.3 Perspective view shows topography** (requires live server)
  - Press `V` (or click the HUD mode button) to switch to perspective. Elevation is visible. Double-click the canvas to reset framing; terrain persists.

- [x] **8.4 Entities sit on the surface** (requires live server)
  - Zoom in near a slope. Cone bases are flush with the surface (not buried, not floating). Cones on hills are visibly higher than cones in valleys.

- [x] **8.5 No-terrain fallback (unchanged behavior from slice 101)** (requires live server)
  - Restart the server with a config that omits `environment.terrain:`.
  - Refresh the viewer. Expect a **world-sized flat plane** (same visual as before slice 102), no TERRAIN console log, no warnings. Entities render at `y ≈ verticalOffset` across the full world extent.

- [x] **8.6 Second TERRAIN replaces the mesh (optional — run if server supports it)** (skipped)
  - If a server-side hook can trigger a second TERRAIN on an already-connected viewer (e.g., reloading terrain config), verify the viewer's mesh updates to the new elevation without disconnecting and without the old mesh lingering. Skip if no such hook exists — unit test 5.4/Test B covers this case.

- [x] **8.7 Malformed-frame tolerance (optional — run if easy)** (skipped)
  - If a server-side debug hook can emit a malformed TERRAIN, verify the viewer warns and continues. Skip if no such hook exists; rely on unit tests from task 2.3 for coverage.

### 9. Finalization

- [x] **9.1 Update slice and task statuses**
  - Set this task file's `status: complete` and bump `dateUpdated`.
  - Set `102-slice.terrain-rendering.md`'s `status: complete` and bump `dateUpdated`.
  - In [100-slices.viewer-foundation.md](../architecture/100-slices.viewer-foundation.md), mark slice 102 `[x]` and bump `dateUpdated`.

- [x] **9.2 Commit finalization**
  - Commit message: `docs: mark slice 102 complete`.

- [x] **9.3 Merge and advance phase**
  - Confirm with Project Manager before merging `102-terrain-rendering` to `main`.
  - Advance Context Forge phase after merge.
