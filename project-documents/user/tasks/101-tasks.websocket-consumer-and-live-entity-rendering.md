---
docType: slice-tasks
slice: websocket-consumer-and-live-entity-rendering
project: migratory-viewer
parent: user/slices/101-slice.websocket-consumer-and-live-entity-rendering.md
dependencies: [100-project-scaffold-and-rendering-core]
currentState: slice 100 complete — Vite+TS scaffold, Three.js WebGPU scene, orthographic camera, flat ground plane, InstancedMesh of 500 random test cones
dateCreated: 20260406
dateUpdated: 20260408
status: complete
---

# Tasks: WebSocket Consumer and Live Entity Rendering

## Context Summary

This slice turns the viewer from a static test scene into a live client of the migratory world server. Three new concerns are introduced:

1. **Binary protocol deserializer** (`src/protocol/`) — parses SNAPSHOT (0x01) and STATE_UPDATE (0x02) messages with validation at parse boundaries.
2. **WebSocket connection manager** (`src/net/connection.ts`) — connect/reconnect/disconnect lifecycle with exponential backoff.
3. **`ViewerState` singleton** — central shared state written only by `connection.ts`, read by rendering/UI.

The existing slice 100 `entities.ts` (random test data) is rewritten to consume `ViewerState`. The flat ground plane, camera, and scene setup from slice 100 remain unchanged.

**Key references:**
- Slice design: [101-slice.websocket-consumer-and-live-entity-rendering.md](../slices/101-slice.websocket-consumer-and-live-entity-rendering.md)
- Wire protocol: [306-slice.state-serialization-and-protocol.md](../reference/server/306-slice.state-serialization-and-protocol.md)
- Python reference: [protocol.py](../reference/server/protocol.py)
- Architecture: [100-arch.viewer-foundation.md](../architecture/100-arch.viewer-foundation.md) (State Ownership, Protocol Error Handling, Connection Lifecycle sections)

**Pre-task checklist:**
- [x] On branch `101-slice.websocket-consumer-and-live-entity-rendering` (create from `main` if not)
- [x] `main` is up to date and slice 100 is merged
- [x] Working directory is clean

---

## Task 1 — Test Infrastructure and Types

### 1.1 Add vitest for unit testing
- [x] Install `vitest` as devDependency via `pnpm add -D vitest`
- [x] Add `"test": "vitest run"` and `"test:watch": "vitest"` scripts to `package.json`
- [x] Create `vitest.config.ts` (or extend `vite.config.ts`) with minimal config targeting `src/**/*.test.ts`
- [x] Verify `pnpm test` runs and exits with "no tests found" or similar success message
- **SC:** `pnpm test` runs successfully with no tests yet.
- **Effort:** 1/5

### 1.2 Extend shared types in src/types.ts
- [x] Add `ViewerState` interface matching the architecture doc (`worldWidth`, `worldHeight`, `entityCount`, `profileIndices: Int32Array | null`, `positions: Float64Array | null`, `velocities: Float64Array | null`, `currentTick`, `connectionStatus`)
- [x] `ConnectionStatus` already exists — reuse it
- [x] Export a `createInitialViewerState()` factory returning a `ViewerState` with all nullable fields set to `null`, counts to 0, and status `'disconnected'`
- **SC:** `npx tsc --noEmit` passes. `ViewerState` is importable from `src/types.ts`.
- **Effort:** 1/5

### 1.3 Add maxEntityCount to config.ts
- [x] Add `maxEntityCount: number` field to `ViewerConfig` interface with JSDoc describing its role as the validation cap
- [x] Set default to `200_000` in the exported config object
- **SC:** `config.maxEntityCount` is accessible and typed as `number`.
- **Effort:** 1/5

### 1.4 Create protocol message type definitions
- [x] Create `src/protocol/types.ts`
- [x] Define `MessageType` as `as const` object: `{ SNAPSHOT: 0x01, STATE_UPDATE: 0x02 }` with derived union type
- [x] Define `ParsedSnapshot` interface: `{ type: 0x01, tick: number, worldWidth: number, worldHeight: number, entityCount: number, positions: Float64Array, velocities: Float64Array, profileIndices: Int32Array }`
- [x] Define `ParsedStateUpdate` interface: `{ type: 0x02, tick: number, entityCount: number, positions: Float64Array, velocities: Float64Array }`
- [x] Define `ParsedMessage = ParsedSnapshot | ParsedStateUpdate` discriminated union
- **SC:** Types compile cleanly. The `type` field is a literal, enabling discriminated union narrowing.
- **Effort:** 1/5

**Commit:** `feat(types): add ViewerState, protocol message types, and vitest setup`

---

## Task 2 — Binary Deserializer

### 2.1 Create little-endian read helpers
- [x] Create `src/protocol/deserialize.ts`
- [x] Implement internal helpers: `readU8(view, offset)`, `readU32LE(view, offset)`, `readF64LE(view, offset)` — each wraps `DataView` methods with `littleEndian = true` hardcoded
- [x] Do not export these helpers; they are internal discipline enforcement
- [x] Add a module-level comment explaining that all raw `DataView` reads in this file must go through these helpers
- **SC:** Helpers exist and are referenced by parse functions (next tasks). No direct `view.getUint32(offset)` calls without `true`.
- **Effort:** 1/5

### 2.2 Implement parseMessage dispatcher
- [x] Export `parseMessage(buffer: ArrayBuffer): ParsedMessage | null`
- [x] Guard: if `buffer.byteLength < 1`, log warning and return `null`
- [x] Read type byte at offset 0
- [x] Dispatch: `0x01` → `parseSnapshot`, `0x02` → `parseStateUpdate`, other → log unknown type byte in hex and return `null`
- [x] Import `config` for the entity count cap
- **SC:** Unknown type bytes return `null` and log; valid type bytes delegate to parser functions (implemented next).
- **Effort:** 1/5

### 2.3 Implement parseSnapshot
- [x] Internal function `parseSnapshot(buffer: ArrayBuffer): ParsedSnapshot | null`
- [x] Create `DataView` over buffer
- [x] Read: `tick` (u32 LE at offset 1), `worldWidth` (f64 LE at 5), `worldHeight` (f64 LE at 13), `entityCount` (u32 LE at 21)
- [x] Validation: reject if `entityCount > config.maxEntityCount`; reject if `buffer.byteLength !== 25 + entityCount * 36`
- [x] On failure: log warning with expected vs. actual length and return `null`
- [x] Allocate fresh `Float64Array` for positions (length `entityCount * 2`) and copy from buffer at offset 25
- [x] Allocate fresh `Float64Array` for velocities and copy from buffer at offset `25 + entityCount * 16`
- [x] Allocate fresh `Int32Array` for profileIndices (length `entityCount`) and copy from buffer at offset `25 + entityCount * 32`
- [x] Use `new Float64Array(buffer.slice(offset, offset + byteLength))` or `new Float64Array(buffer, offset, count).slice()` to ensure copies, not views
- [x] Return `ParsedSnapshot` with `type: 0x01`
- **SC:** Valid snapshot parses correctly; malformed snapshots return `null` with a log message.
- **Effort:** 2/5

### 2.4 Implement parseStateUpdate
- [x] Internal function `parseStateUpdate(buffer: ArrayBuffer): ParsedStateUpdate | null`
- [x] Read `tick` (u32 LE at 1), `entityCount` (u32 LE at 5)
- [x] Validation: reject if `entityCount > config.maxEntityCount`; reject if `buffer.byteLength !== 9 + entityCount * 32`
- [x] Copy positions (offset 9, length `entityCount * 2`) and velocities (offset `9 + entityCount * 16`) into fresh `Float64Array` instances
- [x] Return `ParsedStateUpdate` with `type: 0x02`
- **SC:** Valid state updates parse correctly; malformed updates return `null` with log.
- **Effort:** 2/5

### 2.5 Generate Python reference fixtures
- [x] Create a one-off script in the reference server repo (or document the one-liner) that serializes known state to bytes and writes to `test/fixtures/snapshot-*.bin` and `state-update-*.bin`
- [x] Include fixtures for: zero entities, one entity, three entities with distinct profile indices and positions
- [x] Check the generated `.bin` files into `src/protocol/__fixtures__/` (or equivalent)
- [x] Document in a `README.md` next to the fixtures: which script produced them, the exact `AgentState` values, and how to regenerate
- **SC:** Fixture `.bin` files exist and their expected values are documented.
- **Effort:** 2/5

### 2.6 Unit tests for deserialize.ts
- [x] Create `src/protocol/deserialize.test.ts`
- [x] Test: `parseMessage` with unknown type byte returns `null`
- [x] Test: `parseMessage` with empty buffer returns `null`
- [x] Test: snapshot fixture (zero entities) parses with correct tick, world bounds, empty arrays
- [x] Test: snapshot fixture (one entity) parses with correct single position, velocity, profile index
- [x] Test: snapshot fixture (three entities) parses with exact values matching the Python-generated fixture
- [x] Test: state-update fixture parses with correct tick and arrays
- [x] Test: truncated snapshot (removes last 4 bytes) returns `null`
- [x] Test: entity count exceeding `maxEntityCount` returns `null`
- [x] Test: returned `Float64Array` is a copy (mutating it does not affect the input buffer)
- [x] Test: `parseMessage` correctly discriminates based on `type` field (type narrowing works)
- **SC:** `pnpm test` passes all deserialize tests. Coverage includes both success and validation failure paths.
- **Effort:** 2/5

**Commit:** `feat(protocol): add binary deserializer with validation and tests`

---

## Task 3 — ViewerState and Mutations

### 3.1 Create ViewerState singleton module
- [x] Create `src/state.ts` (or add to `src/types.ts` — see slice design decision)
- [x] Export a module-level singleton `viewerState: ViewerState` created via `createInitialViewerState()`
- [x] Export `applySnapshot(state: ViewerState, parsed: ParsedSnapshot): void`:
  - Replace `worldWidth`, `worldHeight`, `entityCount`, `currentTick`
  - Assign fresh `positions`, `velocities`, `profileIndices` from parsed
- [x] Export `applyStateUpdate(state: ViewerState, parsed: ParsedStateUpdate): void`:
  - If `state.positions` is null or length differs from `parsed.positions.length`, log warning (caller should force reconnect) and return early
  - Use `state.positions.set(parsed.positions)` and `state.velocities.set(parsed.velocities)` to reuse buffers
  - Update `currentTick`
- **SC:** Both mutation functions exist with correct ownership contract. `tsc --noEmit` passes.
- **Effort:** 2/5

### 3.2 Unit tests for state mutations
- [x] Create `src/state.test.ts`
- [x] Test: `createInitialViewerState` returns expected initial values
- [x] Test: `applySnapshot` replaces all relevant fields and retains references to parsed arrays
- [x] Test: `applyStateUpdate` updates `positions`, `velocities`, `currentTick` without reallocating (buffer identity is preserved)
- [x] Test: `applyStateUpdate` with mismatched length returns early and leaves state unchanged
- **SC:** All state tests pass.
- **Effort:** 1/5

**Commit:** `feat(state): add ViewerState singleton with snapshot and update mutations`

---

## Task 4 — WebSocket Connection Manager

### 4.1 Implement connection state machine skeleton
- [x] Create `src/net/connection.ts`
- [x] Define internal state machine: `DISCONNECTED`, `CONNECTING`, `CONNECTED`, `RECONNECTING`
- [x] Export `createConnection(viewerState: ViewerState)` returning `{ connect(url: string): void, disconnect(): void }`
- [x] Track internal variables: `ws: WebSocket | null`, `backoffMs: number`, `reconnectTimer: number | null`
- [x] Initial backoff constant: 500ms, max 30000ms, doubling factor 2, jitter ±20%
- **SC:** Module compiles and exposes the documented interface.
- **Effort:** 2/5

### 4.2 Implement connect and reconnect flow
- [x] `connect(url)`: set `viewerState.connectionStatus = 'connecting'`, create `new WebSocket(url)`, immediately set `ws.binaryType = 'arraybuffer'`
- [x] `onopen`: set status `'connected'`, reset backoff to 500ms
- [x] `onclose`: set status `'reconnecting'`, schedule reconnect via `scheduleReconnect(url)`
- [x] `onerror`: log, let `onclose` handle the transition
- [x] `scheduleReconnect(url)`: clear any existing timer, wait `backoffMs * (1 ± 0.2 * Math.random())`, double `backoffMs` up to cap, then `connect(url)` again
- [x] `disconnect()`: clear reconnect timer, close ws, set status `'disconnected'`
- **SC:** Manual test: with no server running, viewer logs reconnect attempts at growing intervals capped at 30s.
- **Effort:** 3/5

### 4.3 Implement message dispatch
- [x] `onmessage(event)`: call `parseMessage(event.data as ArrayBuffer)`
- [x] If `null`, return (already logged by parser)
- [x] If `type === 0x01`: call `applySnapshot(viewerState, parsed)`
- [x] If `type === 0x02`:
  - If `viewerState.entityCount !== 0` and `parsed.entityCount !== viewerState.entityCount`: log warning about mismatch and call `ws.close()` to force reconnect
  - Else: call `applyStateUpdate(viewerState, parsed)`
- **SC:** Messages route correctly based on type; count mismatch forces a reconnect.
- **Effort:** 2/5

### 4.4 Unit tests for connection logic
- [x] Create `src/net/connection.test.ts`
- [x] Mock the global `WebSocket` constructor (vitest `vi.stubGlobal`)
- [x] Test: `connect` sets status to `'connecting'` and creates a WebSocket with `binaryType = 'arraybuffer'`
- [x] Test: `onopen` transitions to `'connected'` and resets backoff
- [x] Test: `onclose` triggers scheduled reconnect (use fake timers)
- [x] Test: consecutive failures double backoff up to 30000ms
- [x] Test: incoming snapshot ArrayBuffer invokes `applySnapshot` and updates `viewerState`
- [x] Test: state update with mismatched entity count calls `ws.close()` on the mock
- [x] Test: `disconnect()` clears reconnect timer and sets status `'disconnected'`
- **SC:** All connection tests pass with mocked WebSocket.
- **Effort:** 3/5

**Commit:** `feat(net): add websocket connection manager with reconnect and dispatch`

---

## Task 5 — Entity Rendering Integration

### 5.1 Rewrite createEntities to consume ViewerState
- [x] Modify `src/rendering/entities.ts`
- [x] Change signature: `createEntities(scene: THREE.Scene): THREE.InstancedMesh` — no longer generates random data
- [x] Allocate `InstancedMesh` at capacity `config.maxEntityCount` with cone geometry and `MeshLambertMaterial`
- [x] Set `mesh.count = 0` initially so nothing renders until first snapshot
- [x] Add the mesh to the scene and return it
- [x] Remove all random position/velocity generation code
- **SC:** `createEntities` no longer touches random data. Mesh is added to scene at full capacity with `count = 0`.
- **Effort:** 2/5

### 5.2 Implement updateEntities reading ViewerState
- [x] Replace the current stub `updateEntities` with a real implementation
- [x] Signature: `updateEntities(mesh: THREE.InstancedMesh, state: ViewerState): void`
- [x] Early return if `state.positions === null` or `state.entityCount === 0`
- [x] Track last-applied entity count in a module-level variable (to detect snapshot-sized changes for color refresh)
- [x] For `i = 0; i < state.entityCount`: read `x = positions[i*2]`, `y = positions[i*2 + 1]`, `vx = velocities[i*2]`, `vy = velocities[i*2 + 1]`
- [x] Set `dummy.position.set(x, 0, y)` (server 2D `y` → viewer 3D `z`)
- [x] Set `dummy.rotation.set(0, -Math.atan2(vy, vx) + Math.PI / 2, 0)`
- [x] `dummy.updateMatrix()`, `mesh.setMatrixAt(i, dummy.matrix)`
- [x] Set `mesh.count = state.entityCount`
- [x] Set `mesh.instanceMatrix.needsUpdate = true`
- **SC:** Function updates only the first N instances and sets `mesh.count` correctly.
- **Effort:** 2/5

### 5.3 Implement profile color refresh on snapshot
- [x] When `state.entityCount` changes from the last-applied count (indicates a new snapshot) AND `state.profileIndices` is non-null: loop and call `mesh.setColorAt(i, color)` using `config.profileColors[profileIndices[i] % palette.length]`
- [x] Set `mesh.instanceColor.needsUpdate = true`
- [x] Update the last-applied count tracker
- **SC:** Colors update only on snapshot, not on every tick.
- **Effort:** 1/5

### 5.4 Unit tests for entity update logic
- [x] Create `src/rendering/entities.test.ts`
- [x] Build a minimal fake `InstancedMesh`-like object (record matrix/color calls) or import real Three.js if tests run in happy-dom
- [x] Test: `updateEntities` with null positions is a no-op
- [x] Test: `updateEntities` with `entityCount = 3` writes 3 matrices and sets `mesh.count = 3`
- [x] Test: position mapping `(x, y)` → `(x, 0, z=y)` is correct
- [x] Test: rotation formula produces expected angle for a known velocity
- [x] Test: color refresh only fires when entity count changes (not on sequential calls with same count)
- **SC:** Entity update tests pass.
- **Effort:** 2/5

**Commit:** `feat(rendering): consume ViewerState in entity rendering`

---

## Task 6 — Main Wiring and Live Integration

### 6.1 Wire ViewerState, connection, and render loop in main.ts
- [x] Import `viewerState` and `createConnection` from their modules
- [x] After `createEntities(scene)`, capture the returned mesh
- [x] Create connection: `const connection = createConnection(viewerState)`
- [x] Call `connection.connect(config.serverUrl)` before starting the animation loop
- [x] In the animation loop callback, after `updateCamera()`, call `updateEntities(mesh, viewerState)`
- [x] Remove any references to the old random test-data code path
- **SC:** `pnpm dev` starts; browser console shows reconnect attempts when no server is running.
- **Effort:** 2/5

### 6.2 Manual verification against live server
- [x] Start the migratory server per its own instructions (server's slice 305/306 must be running locally on `ws://localhost:8765`)
- [x] Run `pnpm dev` and open the viewer
- [x] Confirm: cones appear shortly after page load (on snapshot)
- [x] Confirm: cones move smoothly each tick
- [x] Confirm: cones are colored per profile
- [x] Confirm: cone orientation follows velocity
- [x] Kill server: verify reconnect attempts logged, cones stop updating (freeze at last position)
- [x] Restart server: verify reconnect, new snapshot, rendering resumes
- [x] Document any discrepancies from the slice design's Verification Walkthrough and confer with PM
- **SC:** All manual verification steps pass. Live rendering confirmed: entities receive snapshot, render at correct world-space positions with profile colors and velocity-based orientation, move smoothly on state updates, reconnect on server restart.
- **Effort:** 2/5

**Commit:** `feat: integrate websocket consumer with live rendering`

---

## Task 7 — Finalization

### 7.1 Type check and build
- [x] Run `npx tsc --noEmit` — must exit 0
- [x] Run `pnpm build` — must produce `dist/` without errors
- [x] Run `pnpm test` — all tests must pass
- **SC:** All three commands pass clean.
- **Effort:** 1/5

### 7.2 Update slice design verification walkthrough
- [x] Open [101-slice.websocket-consumer-and-live-entity-rendering.md](../slices/101-slice.websocket-consumer-and-live-entity-rendering.md)
- [x] Update the Verification Walkthrough section with actual commands run, any console output snippets, and any caveats discovered
- [x] Update frontmatter: `status: complete`, `dateUpdated: <today>`
- **SC:** Slice design reflects implementation reality and is marked complete.
- **Effort:** 1/5

### 7.3 Update slice plan and CHANGELOG
- [x] Check off `(101)` in [100-slices.viewer-foundation.md](../architecture/100-slices.viewer-foundation.md)
- [x] Add a `## [0.2.0] - <date>` entry to `CHANGELOG.md` describing binary protocol consumer, ViewerState, reconnection logic, and live entity rendering
- **SC:** Changelog and slice plan reflect slice 101 completion.
- **Effort:** 1/5

### 7.4 Run workflow check
- [x] Run `mcp__context-forge__workflow_check` with `fix=true` (or `cf check --fix` if available)
- [x] Resolve any reported inconsistencies
- **SC:** Workflow check reports no inconsistencies.
- **Effort:** 1/5

**Commit:** `docs: mark slice 101 complete and update changelog`

---

## Notes

- **Fixture generation requires running the migratory server's Python environment.** If that's not immediately available, the fallback is to hand-construct fixture buffers using `struct.pack` semantics documented in the slice design. Prefer the Python-generated fixtures when possible — they are the ground truth.
- **Do not implement the connection status UI.** That is explicitly slice 105. Console logging is the only status channel for this slice.
- **Do not change `terrain.ts` or `camera.ts`.** Those are stable interfaces from slice 100.
- **Do not add buffer-reuse optimization for per-tick parsing beyond the `.set()` pattern in `applyStateUpdate`.** Full optimization is slice 106.
- **Keep `three/webgpu` imports consistent.** Never mix `three` and `three/webgpu` imports in the same project.
