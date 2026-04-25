---
docType: architecture
layer: project
phase: 2
phaseName: architecture
project: migratory-viewer
initiative: 100
initiativeName: viewer-foundation
source: user/project-guides/001-initiative-plan.migratory-viewer.md
dateCreated: 20260405
dateUpdated: 20260424
status: in_progress
archIndex: 100
component: viewer-foundation
---

# Architecture: Viewer Foundation

## Overview

Initiative 100 delivers the complete v1 migratory viewer — a browser-based Three.js application that connects to the migratory world server over WebSocket, consumes the binary state protocol, and renders the simulation in real time. The viewer is the first external consumer of the world server's client API and validates the wire protocol under real usage.

## System Context

```
┌─────────────────────┐          WebSocket (binary)          ┌──────────────────────┐
│   migratory server   │ ─────────────────────────────────── │   migratory-viewer   │
│                      │   SNAPSHOT (0x01): world bounds,    │                      │
│  tick loop           │   entity state, profile indices     │  Three.js scene      │
│  behavior engine     │                                     │  InstancedMesh       │
│  environment layer   │   STATE_UPDATE (0x02): positions,   │  camera controls     │
│  entity management   │   velocities per tick               │  HUD overlay         │
│  WebSocket server    │                                     │  terrain geometry     │
└─────────────────────┘                                      └──────────────────────┘
        Python                                                    TypeScript
```

The viewer is a pure consumer — server-push only, no client-to-server commands in v1. The server owns the simulation; the viewer renders what it receives.

## Architecture Decisions

### Three.js with WebGPURenderer and InstancedMesh

**Decision:** Use Three.js r183+ with `WebGPURenderer` (via `import * as THREE from 'three/webgpu'`) for all rendering, and `InstancedMesh` for entity visualization.

**Rationale:** A prior artifact (`threejs_boid_terrain.html`) validated the InstancedMesh approach at 2,000 agents with smooth frame rates. `InstancedMesh` issues a single draw call for all instances of a geometry, making it the standard approach for rendering thousands of identical-ish objects. Canvas 2D was considered and rejected — it would need to be rebuilt in WebGL the moment terrain elevation, lighting, or environment overlays are needed.

Since r171 (September 2025), `WebGPURenderer` is the recommended renderer for new Three.js projects. It provides native WebGPU with automatic WebGL 2 fallback — no detection code needed. Browser support is ~95% globally (Chrome 113+, Edge 113+, Firefox 141+, Safari 26+). The remaining ~5% fall back silently to WebGL 2. `InstancedMesh`, standard materials, and all built-in geometries work unchanged with `WebGPURenderer`.

The WebGPU path also unlocks compute shaders for future performance work (slice 106) — particle/entity systems that top out at ~10K in WebGL can run at 1M+ with WebGPU compute. This directly supports the aspirational 100K entity target.

**Implications:**
- All imports use `three/webgpu`, not `three`. These must not be mixed in the same project.
- The render loop uses `renderer.setAnimationLoop()`, not bare `requestAnimationFrame`. `WebGPURenderer` initializes asynchronously; `setAnimationLoop` defers the first frame until the GPU is ready.
- `THREE.Timer` replaces the deprecated `THREE.Clock` for delta time.
- Lighting uses the physically correct model (default since r155): `DirectionalLight` intensity in lux (`Math.PI` ≈ legacy `1.0`), `AmbientLight` intensity ~1.5.
- TypeScript `tsconfig.json` requires `"moduleResolution": "bundler"` for `three/webgpu` and `three/tsl` subpath imports.

### Orthographic Default, Perspective Available

**Decision:** Default camera is orthographic top-down. Perspective mode with orbit controls is available via toggle.

**Rationale:** The "2D view" requested in the concept maps to an orthographic camera looking straight down. This gives the clean top-down aesthetic while keeping the full 3D infrastructure available. Smooth animated transitions between modes let users explore both views naturally.

**Note:** The transition mechanism between orthographic and perspective projections (tween library, custom lerp, or Three.js utilities) is an implementation decision deferred to slice 104 (Camera Modes).

### Binary Protocol Deserialization

**Decision:** Parse the migratory wire protocol (slice 306) directly using `DataView` and typed array views.

**Rationale:** The protocol is minimal: a 1-byte type discriminator, fixed-size header fields (uint32 tick, uint32 count, float64 world bounds), and raw typed array buffers (float64 positions/velocities, int32 profile indices). This maps directly to JavaScript's `DataView` for headers and `Float64Array`/`Int32Array` wrapping the `ArrayBuffer` at computed byte offsets. No serialization library needed. Little-endian throughout, matching the server.

**Protocol summary:**
- **SNAPSHOT (0x01):** `[u8 type | u32 tick | f64 width | f64 height | u32 count | f64[N×2] positions | f64[N×2] velocities | i32[N] profile_indices]` — 25 + N×36 bytes
- **STATE_UPDATE (0x02):** `[u8 type | u32 tick | u32 count | f64[N×2] positions | f64[N×2] velocities]` — 9 + N×32 bytes
- **TERRAIN (0x03):** v2 single-shot terrain frame. Header carries `rows`, `cols`, `resolution`, `originX`, `originY`, then a flags byte (dtype + compression + reserved bits), optionally `elevation_min`/`elevation_max` for `uint16` dequantization, then a (possibly compressed) elevation payload. Full byte layout, dtype/compression encodings, and the protocol-error catalog live in [project-documents/reference/terrain-wire-protocol-v2.md](../../reference/terrain-wire-protocol-v2.md). Slice 112 implements the v2 decode path.
- **TERRAIN_HEADER (0x05) + TERRAIN_CHUNK (0x04):** chunked terrain delivery. `TERRAIN_HEADER` declares the same metadata as a single-shot `TERRAIN` plus an `expected_chunks` count; each `TERRAIN_CHUNK` carries a 22-byte header with `sequence_number`, `row_offset`, `col_offset`, `chunk_rows`, `chunk_cols`, `last_chunk_flag` plus a (possibly compressed) sub-rectangle payload. Reassembly is offset-driven, not arrival-driven. See the captured spec.

**Opcode versioning convention.** The migratory wire protocol does not carry a version field. Versioning is encoded in the opcode itself: an opcode's *meaning* (which message type it represents) is stable forever. Additive, backward-tolerant changes to a payload — such as the v2 flags byte appended after the existing v1 fixed header on `0x03 TERRAIN` — preserve the opcode. A *behaviorally incompatible* change (e.g. a new message type with different framing or semantics) gets a new opcode (as `0x04` and `0x05` did when chunked delivery was added). All opcode comparisons in viewer code go through the `MessageType` const table in `protocol/types.ts`; raw hex literals (`0x03`, etc.) outside that definition are forbidden.

### Protocol Error Handling

**Decision:** Validate at parse boundaries. Recovery is two-tiered: malformed **stateless, per-tick** messages are logged and discarded without disconnecting; malformed **stateful or one-shot** messages where continuing would risk corrupt rendering state close the WebSocket with code 1002 (protocol error) and rely on the existing reconnect path to re-handshake.

**Rationale:** The binary protocol uses computed byte offsets — a truncated message or corrupted count field could cause `DataView` reads or typed array views to access invalid buffer ranges. The deserialization layer must validate before wrapping.

The two tiers reflect a meaningful difference in blast radius:

- **Stateless, per-tick frames (`SNAPSHOT 0x01`, `STATE_UPDATE 0x02`).** Each frame is independent of the previous; a fresh `STATE_UPDATE` arrives next tick. Dropping a single corrupted frame is self-healing — the user sees one missed tick (~16 ms at 60 Hz). A reconnect would cost hundreds of ms of backoff plus a fresh `SNAPSHOT` re-handshake to recover from the same condition. Skip-and-continue is the right call.
- **Stateful or one-shot frames (`TERRAIN 0x03`, `TERRAIN_HEADER 0x05`, `TERRAIN_CHUNK 0x04`).** Terrain is sent once per connection and gates rendering correctness. The chunked path (`0x05` + N × `0x04`) maintains a state machine that spans messages; a malformed chunk in the middle of an in-flight terrain transfer cannot be skipped without leaving the assembler in a half-applied state, where some grid cells come from one transfer and others from a stale earlier one. Close-1002 + reconnect is the only safe recovery: the next connection re-runs SNAPSHOT → terrain → STATE_UPDATE from a clean state.

**Validation rules:**
1. **Message type byte:** Reject leading bytes that do not match a known opcode in the `MessageType` const table. For `0x01`/`0x02`, log and discard. For an unknown byte received where a terrain frame was expected (i.e. mid–chunked-delivery), close 1002. For an unknown byte at any other point, the implementation may discard or close — the slice 112 design takes the conservative "close 1002 on unknown opcode" path.
2. **Buffer length vs. claimed count.** After reading the header, verify the remaining buffer length matches the expected payload size. Tier-1: discard. Tier-2: close 1002.
3. **Entity count sanity.** Reject entity counts exceeding a configurable upper bound (e.g., 200,000). This guards against corrupted count fields that would cause massive typed array allocations. Tier-1.
4. **Endianness.** All `DataView` reads must pass `true` for the `littleEndian` parameter. This is a coding discipline requirement (DataView defaults to big-endian if omitted), enforced via the deserialization module's internal API.
5. **Terrain protocol errors.** The full catalog (reserved-flag-bit set, unknown dtype, unknown compression, out-of-state chunk, decoder failure, coverage-validation failure, terrain frame received after `STATE_UPDATE` started) lives in [project-documents/reference/terrain-wire-protocol-v2.md](../../reference/terrain-wire-protocol-v2.md). Each is a tier-2 close-1002. The lone exception is a duplicate `sequence_number` with identical chunk coordinates, which is recoverable: log a warning and continue (last-write-wins per spec).

**Tier-1 recovery behavior:** Log a warning with the failure reason and raw byte context, discard the frame, do not disconnect. If multiple consecutive frames fail validation, the connection is likely broken; the existing reconnect logic (connection close event) will handle it.

**Tier-2 recovery behavior:** Log a warning with the failure reason, call `ws.close(1002, reason)`, dispose the per-connection terrain assembler, let the existing reconnect-with-backoff path re-handshake. The next connection re-runs the full protocol from a clean state. The server does not attempt in-stream re-synchronization, so close-and-reconnect is the only correct recovery.

**Scope of tier-2 today.** Slice 112 introduces tier-2 close-1002 for *terrain opcodes only*. `SNAPSHOT` and `STATE_UPDATE` keep their original tier-1 behavior unchanged. Promoting entity-state errors to tier-2 would be a separate behavioral change with its own test coverage and is deliberately deferred — see slice 112 TD-7.

### Terrain via TERRAIN (0x03)

**Decision:** Render terrain from the server's TERRAIN (0x03) message (migratory slice 507). A flat ground plane is the fallback for connections where the server does not send TERRAIN.

**Rationale:** Migratory slice 507 defines a TERRAIN message sent once per connection (after SNAPSHOT, before STATE_UPDATE) carrying a row-major `float64` elevation grid plus `rows`, `cols`, `resolution`, `origin_x`, `origin_y`. The viewer builds a displaced `PlaneGeometry` from this data and exposes a `getTerrainHeight(x, z)` lookup for entity placement. Clients MUST tolerate connections that never send TERRAIN — the viewer stays on the flat plane and renders entities at `y = 0`, which matches server configurations without a terrain layer. Biome coloring is deferred to a separate slice pending its own protocol extension.

### TypeScript

**Decision:** TypeScript, not vanilla JavaScript.

**Rationale:** The binary protocol deserialization layer computes byte offsets into `ArrayBuffer` and wraps sections as typed array views. A wrong offset silently corrupts data — type annotations catch structural mistakes at compile time. The project will grow in complexity (environment layers, camera modes, HUD state) and TypeScript's type system pays for itself quickly. Vite's TypeScript support is zero-config.

### Vite for Build Tooling

**Decision:** Vite for development server and production builds.

**Rationale:** Fast HMR during development, standard Rollup-based production builds producing static assets. No framework lock-in. The production output is static HTML/JS/CSS deployable anywhere — no coupling to a hosting provider. The WebSocket endpoint is configured via environment variable, so the same build works against any server.

### No UI Framework

**Decision:** Vanilla DOM for UI controls in v1. No React, Vue, or similar.

**Rationale:** The viewer's UI is a handful of controls overlaid on a canvas: connection status indicator, tick/frame rate counters, entity count by profile, a profile legend, and layer toggles. This is 50–100 lines of DOM manipulation, not a component tree. Adding a framework would increase bundle size and complexity for marginal benefit. If UI complexity grows significantly (interactive controls initiative, analysis tools), a framework can be introduced then.

## Component Architecture

```
src/
├── main.ts                 # Entry point: init scene, connect WebSocket, start render loop
├── protocol/
│   ├── types.ts            # Message types, parsed state interfaces, dtype/compression const tables
│   ├── deserialize.ts      # Stateless parsing for SNAPSHOT (0x01) and STATE_UPDATE (0x02)
│   ├── terrain-assembler.ts # Per-connection state machine for TERRAIN (0x03) and chunked (0x05 + 0x04)
│   └── decompress.ts       # zstd/lz4 frame decompression dispatch (slice 112)
├── net/
│   └── connection.ts       # WebSocket lifecycle: connect, reconnect, status
├── rendering/
│   ├── scene.ts            # Three.js scene setup: WebGPURenderer, lighting, resize
│   ├── entities.ts         # InstancedMesh creation, per-tick matrix updates
│   ├── terrain.ts          # PlaneGeometry ground plane (flat now, displaced later)
│   ├── overlays.ts         # Environment layer overlays (stubbed until data available)
│   └── camera.ts           # Orthographic/perspective modes, pan/zoom/orbit, follow-cam
├── ui/
│   ├── hud.ts              # Status panel: connection, tick rate, entity counts
│   └── legend.ts           # Profile color legend
├── input/
│   └── camera-input.ts     # DOM event → camera action layer (pan/zoom bindings)
└── config.ts               # Runtime configuration (server URL, rendering params)
```

### State Ownership

A single `ViewerState` object (plain TypeScript interface, not a framework store) holds all shared state derived from the server. The connection handler writes to it; rendering and UI components read from it.

```typescript
interface ViewerState {
  worldWidth: number;
  worldHeight: number;
  entityCount: number;
  profileIndices: Int32Array | null;    // from SNAPSHOT, stable between snapshots
  positions: Float64Array | null;       // updated each tick
  velocities: Float64Array | null;      // updated each tick
  currentTick: number;
  connectionStatus: ConnectionStatus;
  terrain: TerrainGrid | null;          // from TERRAIN (slice 102); null until first TERRAIN arrives
}
```

(`TerrainGrid` carries `rows`, `cols`, `resolution`, `originX`, `originY`, and a row-major `Float64Array` elevation grid. The shape is identical for the slice 102 v1 path and the slice 112 v2 path — the protocol-layer change does not propagate into `ViewerState`.)

**Ownership rules:**
- `net/connection.ts` is the sole writer — it updates `ViewerState` after deserializing each message.
- `rendering/entities.ts`, `rendering/terrain.ts`, and `ui/hud.ts` read from `ViewerState`. They do not cache stale copies; they reference the current values each frame or tick.
- Profile-to-color mapping is derived from `profileIndices` and a color palette defined in `config.ts`. The palette is static configuration, not server state.
- On SNAPSHOT: all fields are replaced. On STATE_UPDATE: only `positions`, `velocities`, and `currentTick` are updated.

This avoids both a framework dependency and implicit state scattered across components. If state management needs grow (interactive controls initiative), this interface is the natural seam for introducing a more sophisticated store.

### Data Flow

```
WebSocket binary frame
  → protocol/terrain-assembler.feed(buffer): per-connection state machine
      ├── 0x01 / 0x02 → delegate to protocol/deserialize.ts (stateless)
      └── 0x03 / 0x04 / 0x05 → in-assembler terrain decode
                                 (decompress via protocol/decompress.ts,
                                  dtype-decode, optional dequantize,
                                  reassemble chunked grids)
      → returns {kind: 'message' | 'pending' | 'protocol-error'}
  → net/connection.ts: switch on output kind
      ├── 'message'        → dispatch to per-opcode handler
      ├── 'pending'        → no-op (chunked terrain mid-flight, or tier-1 dropped frame)
      └── 'protocol-error' → ws.close(1002, reason); reconnect path takes over

Snapshot (0x01):
  → Store world bounds, profile indices
  → rendering/terrain.ts: set ground plane scale from world bounds
  → rendering/entities.ts: allocate InstancedMesh for entity_count, set initial matrices
  → ui/hud.ts: update entity counts, profile breakdown

Terrain (0x03 single-shot, or 0x05 + 0x04* chunked):
  → ViewerState.terrain populated with the assembled TerrainGrid
  → rendering/terrain.ts: rebuild displaced mesh from elevation grid

State Update (0x02):
  → rendering/entities.ts: update InstancedMesh matrices from new positions/velocities
  → ui/hud.ts: update tick counter

Render loop (renderer.setAnimationLoop):
  → rendering/camera.ts: apply camera controls (pan/zoom/orbit)
  → renderer.render(scene, camera)
  → ui/hud.ts: update FPS counter
```

### Entity Rendering Detail

Each entity is rendered as a small directional cone via `InstancedMesh`. Per tick:

1. Receive positions (N×2 float64) and velocities (N×2 float64) from the state update
2. For each entity, compute a 4×4 transformation matrix:
   - **Position:** `(x, terrain_height_at(x,z), z)` — y is terrain height lookup (0 on flat plane)
   - **Rotation:** `atan2(vz, vx)` — cone points in movement direction
3. Set the matrix on the `InstancedMesh` via `setMatrixAt(i, matrix)`
4. Mark `instanceMatrix.needsUpdate = true`

Profile-based coloring: entities are colored by their `profile_index` from the snapshot. This can be done via per-instance color attributes on the `InstancedMesh` (Three.js supports `instanceColor`), mapping each profile index to a color from a configurable palette.

### Connection Lifecycle

```
DISCONNECTED → connect(url) → CONNECTING → onopen → CONNECTED
                                           → onerror/onclose → RECONNECTING
RECONNECTING → wait(backoff) → connect(url) → CONNECTING → ...
CONNECTED → onclose → RECONNECTING
CONNECTED → onmessage(binary) → deserialize → dispatch
```

Reconnection uses exponential backoff with jitter. On reconnect, the server sends a fresh snapshot — the viewer resets its state entirely rather than trying to reconcile stale data.

**Entity lifecycle:** Entity count is stable between SNAPSHOT messages in v1. STATE_UPDATE carries only positions and velocities — no add/remove events. If a STATE_UPDATE's entity count differs from the last SNAPSHOT's count, the viewer logs a warning and initiates a reconnect to obtain a fresh snapshot. Entity creation/deletion events are out of scope for v1; this is a known protocol limitation, not a bug.

**GPU device loss:** `WebGPURenderer` handles GPU device loss differently from WebGL context loss. When the GPU adapter is lost (tab backgrounded, driver reset, memory pressure), Three.js internally handles reinitialization. The viewer registers a device-loss callback via `renderer.backend` to pause the render loop and log the event. On restoration, `setAnimationLoop` resumes automatically once the device is reacquired. For the WebGL 2 fallback path, the traditional `webglcontextlost`/`webglcontextrestored` canvas events still apply. Detailed recovery testing is deferred to the performance slice (106).

## External Dependencies

### migratory (server-side)

| Slice | Status | Viewer Dependency |
|---|---|---|
| 305 — WebSocket Client Layer | Complete | Connection endpoint |
| 306 — State Serialization and Protocol | Complete | Wire format definition |
| 307 — Simulation Logging and Replay | Complete | Future: replay mode data source |
| 501 — Terrain Layer | Complete | Consumed by viewer slice 102 |
| 507 — TERRAIN Wire Format | Complete | Defines 0x03 message; consumed by viewer slice 102 |
| 502 — Biome Layer | Not started | Gates viewer slice 109 (biome rendering) |

The viewer can begin immediately — all required server infrastructure is operational. Terrain rendering (slice 102) consumes TERRAIN (0x03) from migratory slice 507. Further environment layers (biome, resource, threat, trail) use additional message types in the 0x03–0x0F reserved range and are gated on their respective server-side slices.

### Third-Party

- **Three.js** (r183+) via `three/webgpu` — 3D rendering with WebGPURenderer and automatic WebGL 2 fallback
- **Vite** (6+) — Build tooling and dev server (requires Node.js ≥ 20.19)
- **fzstd** — pure-JS zstd Frame decoder (slice 112). Decodes the v2 terrain wire protocol's zstd-compressed payloads. Sync `Uint8Array → Uint8Array` API; ~10 KB minified.
- **lz4js** — pure-JS LZ4 Frame decoder (slice 112). Decodes the v2 terrain wire protocol's lz4-compressed payloads. Sync `Uint8Array → Uint8Array` API; ~30 KB minified.
- Type definitions are bundled with `three` since r152 — no separate `@types/three` needed.

**Dependency policy.** Runtime dependencies are added only when (a) required by an external protocol the viewer must consume (e.g. compression algorithms declared in the server-emitted flags byte), or (b) replacing an in-house implementation would meaningfully reduce risk. The original architecture's "no other runtime dependencies in v1" line dated to before the v2 terrain wire protocol introduced compression; that constraint is superseded by the additions above. Any further runtime dependency requires an architecture amendment with the same level of justification.

## Performance Targets

| Metric | Target | Notes |
|---|---|---|
| Frame rate at 10K entities | 60 fps | Comfortable operating range |
| Frame rate at 50K entities | 30 fps | Functional with instancing optimizations |
| Frame rate at 100K entities | 15+ fps | Aspirational; WebGPU compute shaders make this realistic — may need LOD or storage buffer approaches |
| WebSocket deserialization | < 1ms per message | Typed array views are near-zero-cost |
| Time to first render after connect | < 500ms | Snapshot parsing + initial mesh setup |

Performance profiling and optimization is its own slice (106) in the slice plan.

## Relationship to Slice Plan

The slice plan (`100-slices.viewer-foundation.md`) decomposes this architecture into the following slices:

| Slice | Scope | Architecture Component |
|---|---|---|
| 100 — Scaffold + Rendering Core | Vite project, Three.js scene, static test instances | Scene setup, entity rendering skeleton |
| 101 — WebSocket Consumer | Binary protocol parsing, live entity rendering | Protocol, connection, entity update pipeline |
| 102 — Terrain Rendering | Displaced PlaneGeometry driven by TERRAIN (0x03); flat-plane fallback when absent | Terrain rendering |
| 103 — Environment Overlays | Resource points, threat zones, trails | Overlay rendering (gated on further protocol extensions) |
| 104 — Camera Modes | Ortho/perspective toggle, orbit, follow-cam, minimap | Camera system |
| 105 — HUD + Status Panel | Connection status, counters, legend | UI layer |
| 106 — Performance Profiling | Bottleneck identification, optimization at scale | Performance targets |
| 107 — Build + Deployment | Production build, static hosting, README | Build and deploy |
| 108 — Camera Constraints + Pan | World-fit clamp and drag-pan for the orthographic camera | Camera system (prerequisite subset of 104) |
| 109 — Biome Rendering | Biome-id coloring atop terrain | Biome rendering (gated on migratory slice 502 + its wire extension) |
| 110 — Terrain Surface Material | TSL node material with slope-based surface/cliff blending; `BiomeConfig` in config.ts for swappable biome appearance; PBR lighting upgrade | Terrain rendering, material system |
| 111 — Terrain Slab and Texture | Geological slab depth (side walls + bottom); texture maps on surface material via `BiomeConfig`; triplanar UV sampling in TSL | Terrain rendering, material system |
| 112 — Terrain Wire Protocol v2 | v2 single-shot `0x03` and chunked `0x05` + `0x04` decode; `fzstd` + `lz4js` decompression; per-connection assembler with tier-2 close-1002 error policy; renderer-facing `ParsedTerrain` shape preserved | Protocol layer (new `terrain-assembler.ts`, `decompress.ts`); two-tier error policy |

The slice plan's implementation order, dependencies, and success criteria remain authoritative. This architecture document provides the structural rationale and component design that the slice plan implements.
