---
docType: slice-design
slice: websocket-consumer-and-live-entity-rendering
project: migratory-viewer
parent: user/architecture/100-slices.viewer-foundation.md
dependencies: [100-project-scaffold-and-rendering-core]
interfaces: [102-terrain-and-biome-rendering, 103-environment-overlay-rendering, 105-hud-and-status-panel]
dateCreated: 20260406
dateUpdated: 20260406
status: in-progress
---

# Slice Design: WebSocket Consumer and Live Entity Rendering

## Overview

This slice turns the viewer from a static test scene into a real client of the migratory world server. It adds three layers: a **binary protocol deserializer** that parses SNAPSHOT (0x01) and STATE_UPDATE (0x02) messages, a **WebSocket connection manager** that handles connect/reconnect/disconnect lifecycle, and a **`ViewerState` central store** that holds all server-derived state. The existing `InstancedMesh` entity rendering is updated to pull positions from `ViewerState` each frame instead of from random test data.

This is the critical path slice: everything after it (terrain displacement, environment overlays, HUD) depends on live data flowing through `ViewerState`. Migratory slices 305 and 306 are complete, so there is no protocol uncertainty — the wire format is pinned.

## Value

**User-facing:** The viewer connects to a running migratory server and renders the live simulation. Cones move as the server simulates agents. Reconnection is automatic if the connection drops.

**Architectural enablement:** Establishes `ViewerState` as the single source of truth for server-derived state. All subsequent slices (102 terrain, 103 overlays, 105 HUD) read from `ViewerState` rather than each inventing its own data path. The `net/` and `protocol/` modules come into existence here and remain stable for the remainder of the initiative.

## Technical Scope

### Included
- `protocol/types.ts` — TypeScript types for parsed messages and `ViewerState`
- `protocol/deserialize.ts` — binary deserialization for SNAPSHOT and STATE_UPDATE with validation at parse boundaries
- `net/connection.ts` — WebSocket lifecycle manager (connect, receive, reconnect with backoff, disconnect)
- `ViewerState` singleton — central shared state container with ownership rules
- `entities.ts` update — consume positions/velocities from `ViewerState` instead of random data
- Configurable WebSocket endpoint via `import.meta.env.VITE_SERVER_URL` (default `ws://localhost:8765`)
- Configurable entity count cap (for validation)
- Connection status logging to console (UI indicator is slice 105)
- Fallback behavior when no server is running: viewer attempts reconnection silently; existing test cones from slice 100 are removed so an empty scene clearly indicates "no data"

### Excluded
- Connection status UI/HUD (slice 105)
- Terrain displacement from server data (slice 102; this slice keeps the flat plane)
- Environment overlays (slice 103)
- Performance profiling and buffer reuse optimization (slice 106)
- Production build configuration (slice 107)
- Client-to-server commands — v1 protocol is server-push only

## Dependencies

### Prerequisites
- **(100) Project Scaffold and Rendering Core** — complete. Provides `scene.ts`, `entities.ts`, `camera.ts`, `terrain.ts`, `config.ts`, `main.ts`, `types.ts`.

### External
- **migratory slice 305 (WebSocket Client Layer)** — complete. Provides the WebSocket endpoint at `ws://host:port`.
- **migratory slice 306 (State Serialization and Protocol)** — complete. Defines the binary wire format consumed by this slice. Reference: `user/reference/server/306-slice.state-serialization-and-protocol.md` and `user/reference/server/protocol.py`.

## Architecture

### Component Structure

```
src/
├── main.ts                 # MODIFIED: initialize ViewerState, connection; remove test entities
├── config.ts               # MODIFIED: add maxEntityCount cap
├── types.ts                # MODIFIED: add ViewerState, parsed message types
├── protocol/
│   ├── types.ts            # NEW: ParsedSnapshot, ParsedStateUpdate, MessageType enum
│   └── deserialize.ts      # NEW: binary parsing with validation
├── net/
│   └── connection.ts       # NEW: WebSocket lifecycle manager
└── rendering/
    └── entities.ts         # MODIFIED: read from ViewerState; drop random test data
```

The `protocol/` and `net/` directories are created in this slice. They do not exist in slice 100.

### Data Flow

```
Startup (main.ts):
  createScene → createCamera → createTerrain (flat) → createEntities(viewerState)
  → connection.connect(config.serverUrl)
  → setAnimationLoop starts

WebSocket message arrives:
  ws.onmessage (ArrayBuffer)
    → deserialize.parseMessage(buffer)
       → read type byte → dispatch
       → SNAPSHOT: validate → return ParsedSnapshot
       → STATE_UPDATE: validate → return ParsedStateUpdate
       → invalid: return null, log warning
    → connection.ts:
       → if SNAPSHOT: viewerState.applySnapshot(parsed)
                      → reallocate InstancedMesh if entityCount changed
                      → update profileIndices, worldBounds, positions, velocities
       → if STATE_UPDATE:
                      → if entityCount mismatch: log warning, force reconnect
                      → else: viewerState.applyStateUpdate(parsed)

Render loop (every frame):
  entities.ts: read viewerState.positions, viewerState.velocities
  → for each entity: update InstancedMesh matrix (position.xz from positions, rotation from velocity)
  → instanceMatrix.needsUpdate = true

Connection lifecycle:
  DISCONNECTED → connect() → CONNECTING → onopen → CONNECTED
  CONNECTED → onerror/onclose → RECONNECTING
  RECONNECTING → wait(backoff) → connect() → ...
```

### State Ownership

`ViewerState` is a plain TypeScript object (not a framework store). It lives as a module-level singleton exported from `protocol/types.ts` (or a dedicated `state.ts` — see decision below). The architecture doc defines this interface precisely; this slice implements it.

```typescript
type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'reconnecting';

interface ViewerState {
  worldWidth: number;
  worldHeight: number;
  entityCount: number;
  profileIndices: Int32Array | null;    // from SNAPSHOT; stable between snapshots
  positions: Float64Array | null;       // updated each tick
  velocities: Float64Array | null;      // updated each tick
  currentTick: number;
  connectionStatus: ConnectionStatus;
}
```

**Ownership rules (enforced by convention, not compiler):**
- `net/connection.ts` is the **sole writer**. It updates `ViewerState` after each successfully deserialized message.
- `rendering/entities.ts` (this slice) and future `rendering/terrain.ts`, `ui/hud.ts` (slice 105) are **readers only**. They read current values every frame or tick — never cache stale copies.
- On SNAPSHOT: all fields replaced atomically.
- On STATE_UPDATE: only `positions`, `velocities`, `currentTick` mutated.

## Technical Decisions

### Binary Deserialization with DataView and Typed Array Views

The protocol uses `DataView` for fixed header fields and typed array views (`Float64Array`, `Int32Array`) that wrap the same `ArrayBuffer` at computed byte offsets. This is a zero-copy approach: no per-entity allocation, no JSON parsing, no object construction per field.

All reads pass `littleEndian = true` explicitly. A helper wrapper around `DataView` enforces this at the module boundary — the raw `DataView.getUint32(offset)` call without `true` is a bug waiting to happen (it defaults to big-endian), so the deserializer exposes a small internal helper `readU32LE(view, offset)` and friends and never calls `DataView` methods directly.

#### SNAPSHOT parsing (0x01)

```
Offset  Size     Field
0       1        type (u8) — must be 0x01
1       4        tick (u32 LE)
5       8        world_width (f64 LE)
13      8        world_height (f64 LE)
21      4        entity_count (u32 LE)
25      N×16     positions (f64[] LE, row-major [x0,y0,x1,y1,...])
25+N×16 N×16     velocities (f64[] LE, row-major)
25+N×32 N×4      profile_indices (i32[] LE)
```

Expected total: `25 + N × 36` bytes.

#### STATE_UPDATE parsing (0x02)

```
Offset  Size     Field
0       1        type (u8) — must be 0x02
1       4        tick (u32 LE)
5       4        entity_count (u32 LE)
9       N×16     positions (f64[] LE, row-major)
9+N×16  N×16     velocities (f64[] LE, row-major)
```

Expected total: `9 + N × 32` bytes.

### Validation at Parse Boundaries

The architecture document defines four validation rules. This slice implements them in `deserialize.ts`:

1. **Unknown message type byte:** Read `buffer[0]`. If not in `{0x01, 0x02}`, log the value in hex and return `null`. Connection is not dropped.
2. **Buffer length vs. claimed entity count:** After reading `entity_count`, compute expected total length (`25 + N×36` for snapshot, `9 + N×32` for update). If `buffer.byteLength` doesn't match, log the mismatch and return `null`.
3. **Entity count sanity cap:** Reject entity counts exceeding `config.maxEntityCount` (default: 200,000). This guards against corrupted count fields causing massive allocations. Log and return `null`.
4. **Little-endian discipline:** All DataView reads pass `true`. Enforced via the internal `readU32LE`/`readF64LE` helpers — the raw DataView methods are not called directly from parsing code.

On validation failure, the deserializer returns `null` and logs a warning with the failure reason and raw byte context (first N bytes as hex). `connection.ts` discards the frame and continues — a single malformed frame is not worth a reconnect cycle. If the connection is fundamentally broken, the underlying `onclose` event will fire and normal reconnection logic takes over.

### Typed Array Copy vs. View

**Decision:** On SNAPSHOT, copy the typed arrays into freshly allocated `Float64Array` / `Int32Array` instances owned by `ViewerState`. Do not keep views into the original `ArrayBuffer`.

**Rationale:** The `ArrayBuffer` received from `ws.onmessage` has lifetime tied to the message event. Views into it are valid only as long as the buffer is retained. Copying decouples `ViewerState` from message lifecycle and avoids subtle bugs where downstream readers assume the buffer is still live. For STATE_UPDATE, the existing `ViewerState.positions` and `ViewerState.velocities` buffers are reused — the deserializer copies incoming bytes into them via `set()` to avoid per-tick allocation.

This is a deliberate allocation trade-off. Per-tick allocation optimization (buffer reuse, ping-pong buffers) is deferred to slice 106 (Performance Profiling). For the v1 slice, correctness and clarity win.

**Edge case:** On SNAPSHOT, if the new `entity_count` differs from the existing one, `ViewerState`'s typed arrays are reallocated. The `entities.ts` module must detect this and reallocate the `InstancedMesh` accordingly (see Entity Rendering Update below).

### WebSocket Connection Lifecycle

`net/connection.ts` exports a `Connection` object with:

```typescript
interface Connection {
  connect(url: string): void;
  disconnect(): void;
  status: ConnectionStatus;  // reads through to viewerState.connectionStatus
}
```

Internal state machine:

```
DISCONNECTED
  → connect(url) → new WebSocket(url), set binaryType = 'arraybuffer'
  → CONNECTING
     → onopen → CONNECTED, reset backoff
     → onerror/onclose → RECONNECTING
CONNECTED
  → onmessage(ArrayBuffer) → deserialize → dispatch to ViewerState
  → onclose → RECONNECTING
RECONNECTING
  → setTimeout(backoff) → connect(url) → CONNECTING
```

**Backoff:** Exponential with jitter. Start at 500ms, double each attempt, cap at 30s. Apply ±20% jitter. Never give up — the user may start the server at any time.

**`binaryType = 'arraybuffer'`** — critical setting. Default is `'blob'` which would require async conversion. Setting this immediately after `new WebSocket()` ensures `event.data` is an `ArrayBuffer`.

**Entity count mismatch on STATE_UPDATE:** If a STATE_UPDATE arrives with an `entity_count` different from the last SNAPSHOT's count, the architecture doc specifies: log a warning and force a reconnect to obtain a fresh snapshot. `connection.ts` calls `ws.close()` which triggers the normal reconnection path.

### Module Placement: `state.ts` vs. `protocol/types.ts`

**Decision:** Place `ViewerState` in `types.ts` (the existing shared-types file at `src/types.ts`), with protocol-specific message types in `src/protocol/types.ts`.

**Rationale:** `ViewerState` is shared infrastructure used by multiple layers (net, rendering, UI). Keeping it in `src/types.ts` follows the existing convention from slice 100 (which put `ConnectionStatus` and `WorldBounds` there). Protocol message types (`ParsedSnapshot`, `ParsedStateUpdate`) are internal to the parsing pipeline — they belong with the parser.

The singleton instance is created once at startup in `main.ts` and passed to `connection.connect()` and `createEntities()`. No hidden global state — the instance is explicit in the wiring.

### Entity Rendering Update

`entities.ts` changes substantially:

**Before (slice 100):**
- `createEntities(scene)` — generates random positions/velocities, sets matrices once
- `updateEntities(positions, velocities)` — no-op stub

**After (slice 101):**
- `createEntities(scene, viewerState)` — creates an empty `InstancedMesh` (count = 0 initially) with a reusable geometry/material. The mesh is sized to `config.maxEntityCount` as its maximum capacity.
- `updateEntities()` — called every frame in the render loop. Reads `viewerState.entityCount`, `viewerState.positions`, `viewerState.velocities`, `viewerState.profileIndices`. Updates the first N instance matrices, sets `mesh.count = entityCount`, sets `instanceMatrix.needsUpdate = true`.
- On snapshot (entityCount change): update per-instance colors from `profileIndices` and set `instanceColor.needsUpdate = true`. This only runs on snapshots, not per-tick.

**InstancedMesh sizing:** Three.js requires the instance count at construction time. To avoid reallocating the mesh on every snapshot (slow), allocate once at `config.maxEntityCount` capacity and use `mesh.count` to control how many instances actually render. This is a standard Three.js idiom.

**Empty state:** Before the first snapshot, `viewerState.positions` is `null` and `mesh.count = 0` — nothing renders. The ground plane remains visible. This is the correct "no data yet" presentation.

### Y-axis Mapping

The server uses a 2D coordinate system: positions are `(x, y)` pairs where `y` is the second horizontal axis (not vertical). In Three.js world space, we map server `(x, y)` to world `(x, 0, y)` — the server's `y` becomes the viewer's `z`. This matches slice 100's convention where the ground plane lies in the XZ plane and entities have `y = 0`.

For rotation: `atan2(vy, vx)` in server space becomes `-atan2(vy, vx) + π/2` in viewer space to align with the cone's forward direction. This is the same formula slice 100 used for random velocities — proven correct.

## Integration Points

### Provides to Other Slices

- **`ViewerState`** — Central shared state. Used by:
  - Slice 102 (Terrain) — reads `worldWidth/worldHeight` on snapshot to size terrain
  - Slice 103 (Environment Overlays) — reads entity data and future environment fields
  - Slice 105 (HUD) — reads `connectionStatus`, `currentTick`, `entityCount`, `profileIndices`
- **`net/connection.ts`** — Connection lifecycle. Slice 105 subscribes to status changes for UI display.
- **`protocol/deserialize.ts`** — Binary parser. Future protocol extensions (e.g., terrain data in reserved range 0x03–0x0F) add new message type handlers here.
- **Extended `entities.ts`** — Render loop callsite reading from `ViewerState` each frame. Slice 102 adds terrain-aware Y positioning here.

### Consumes from Other Slices

- **Slice 100** — All scaffolding: scene, camera, terrain (flat), config, types. The test entity code from slice 100 is removed in this slice.

## Success Criteria

### Functional Requirements
- Viewer connects to `ws://localhost:8765` (or `VITE_SERVER_URL`) on startup
- On connection, viewer receives a binary SNAPSHOT and begins rendering entities
- Per-tick STATE_UPDATE messages update entity positions/velocities; cones move smoothly
- Cone orientation follows velocity direction
- Profile-based coloring applied from snapshot's `profile_indices`
- Disconnection triggers automatic reconnection with exponential backoff
- When no server is running, viewer renders ground plane only (no entities); reconnect attempts continue silently
- Malformed or truncated messages are logged and discarded without dropping the connection
- Unknown message type bytes are logged and discarded
- Entity count cap (`config.maxEntityCount`) rejects absurd counts

### Technical Requirements
- All `DataView` reads explicitly pass `littleEndian = true` (enforced via internal helpers)
- `ws.binaryType = 'arraybuffer'` set before any `onmessage` can fire
- `ViewerState` is written only by `net/connection.ts`; other modules read only
- `InstancedMesh` allocated once at `maxEntityCount` capacity; `mesh.count` controls render count
- Per-tick STATE_UPDATE reuses existing `ViewerState.positions`/`velocities` buffers via `set()`
- SNAPSHOT copies typed arrays into fresh allocations owned by `ViewerState`
- `npx tsc --noEmit` passes with no errors
- No `any` types in protocol or connection code
- Unit tests for `deserialize.ts`: round-trip against byte fixtures produced from the Python `protocol.py` reference

### Verification Walkthrough

**Setup:** The migratory server must be running locally on `ws://localhost:8765`. Confirm with the server's own verification steps before running the viewer.

1. **No server running (empty state):**
   ```bash
   pnpm dev
   ```
   Browser opens. The scene shows the ground plane and camera, but no cones. Browser console logs reconnection attempts at increasing intervals. No errors break the render loop.

2. **Server running (live data):**
   Start the migratory server. Within a few seconds of the next reconnect attempt, the viewer connects. Cones appear at positions from the server's snapshot. Cones move each tick as STATE_UPDATE messages arrive. Movement is visibly smooth at 20Hz.

3. **Profile coloring:**
   Cones display distinct colors according to their profile indices — matching slice 100's color palette mapping.

4. **Disconnection and reconnection:**
   Kill the server process. Viewer console logs the disconnect. Ground plane remains visible; entities continue rendering their last known positions briefly, then on next frame the render loop continues with stale data (v1 behavior — clearing on disconnect is future work). Reconnection attempts begin. Restart the server. Viewer reconnects, receives fresh snapshot, resumes rendering.

5. **Malformed frame handling:**
   Simulate a malformed message (e.g., via a test server or a proxy that corrupts one byte). Verify the warning is logged and the connection stays up. (This can also be unit-tested directly against `deserialize.ts` with fuzzed input.)

6. **Entity count cap:**
   Set `config.maxEntityCount = 10` temporarily. Connect to a server with more than 10 entities. Verify the snapshot is rejected with a log message and the viewer remains in a "no data" state. Restore the cap afterward.

7. **Round-trip deserialization test:**
   Unit tests parse byte fixtures captured from `protocol.py` serialize functions. Positions, velocities, profile indices, world bounds, tick, and entity count all match exactly. Zero-entity and single-entity edge cases also pass.

8. **Type check and build:**
   ```bash
   npx tsc --noEmit   # exits 0
   pnpm build          # produces dist/ without errors
   ```

## Risk Assessment

- **Protocol mismatch with server.** Low. The wire format is pinned by migratory slice 306 (complete), and Python reference deserialization is available for cross-verification. Unit test fixtures should be generated from the actual `protocol.py` output (Python → byte buffer → JS test input).
- **Per-tick allocation causing GC pauses.** Medium at high entity counts (not in v1 scope). Buffer reuse in `ViewerState.applyStateUpdate` mitigates the common case. Full buffer reuse and profiling is slice 106.
- **WebSocket reconnect storm.** Low. Exponential backoff with jitter capped at 30s prevents this.

## Implementation Notes

### Development Approach

Suggested order:

1. **Types** — Add `ViewerState`, `ConnectionStatus` (already in `types.ts`), `ParsedSnapshot`, `ParsedStateUpdate` to `types.ts` and `protocol/types.ts`. Add `maxEntityCount` to `config.ts`.
2. **Deserializer** — Implement `protocol/deserialize.ts` with `parseMessage(buffer)` dispatching by type byte, plus internal `readU32LE` / `readF64LE` helpers. Write unit tests first using byte fixtures that match the Python reference format. Verify zero-entity, single-entity, large-count, unknown-type, truncated, and over-cap cases.
3. **ViewerState singleton and mutations** — Create the singleton and its `applySnapshot` / `applyStateUpdate` methods (or write them as free functions in `connection.ts` — either style is fine as long as ownership rules hold). Unit-test the mutations.
4. **Connection manager** — Implement `net/connection.ts`: state machine, backoff, message dispatch. Test by pointing at a running server.
5. **Entity rendering update** — Rewrite `createEntities` and `updateEntities` to consume `ViewerState`. Wire into `main.ts`. Remove random test data. Verify against a running server.
6. **End-to-end verification** — Run through the Verification Walkthrough. Confirm reconnection, empty-state, and malformed-frame handling.

### Special Considerations

- **Fixture generation for tests.** The most reliable test fixtures come from the Python `protocol.py` itself. A small script that serializes a known `AgentState` and writes the bytes to a file produces ground-truth input for the TypeScript deserializer tests. This closes the loop between the two language implementations and catches endianness or layout regressions.
- **Do not mix `three` and `three/webgpu` imports.** The entities module must continue importing from `three/webgpu` — this is the rule set in slice 100.
- **`mesh.count = 0` before first snapshot.** Verify this actually renders nothing (it should — Three.js respects instance count).
- **Console noise.** Reconnect attempts should log at `debug` or `info` level, not `warn`. Keep the console clean for legitimate warnings (malformed frames, count cap rejections).
- **Y-axis mapping discipline.** Server's 2D `(x, y)` → viewer's 3D `(x, 0, z)` must be done at exactly one place (entity matrix update). Do not sprinkle the mapping across multiple sites.
- **Do not implement connection UI.** Status indicator, tick counter, etc. are slice 105. Console logging is sufficient for this slice's verification.
