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
dateUpdated: 20260405
status: in_progress
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

### Three.js with InstancedMesh

**Decision:** Use Three.js for all rendering, with `InstancedMesh` for entity visualization.

**Rationale:** A prior artifact (`threejs_boid_terrain.html`) validated this approach at 2,000 agents with smooth frame rates. `InstancedMesh` issues a single draw call for all instances of a geometry, making it the standard approach for rendering thousands of identical-ish objects. At the target entity counts (10K comfortable, 50K functional), this is the right tool. Canvas 2D was considered and rejected — it would need to be rebuilt in WebGL the moment terrain elevation, lighting, or environment overlays are needed.

**Implications:** The viewer requires WebGL support in the browser. All modern browsers support this. The Three.js version should be r128+ for stable `InstancedMesh` APIs.

### Orthographic Default, Perspective Available

**Decision:** Default camera is orthographic top-down. Perspective mode with orbit controls is available via toggle.

**Rationale:** The "2D view" requested in the concept maps to an orthographic camera looking straight down. This gives the clean top-down aesthetic while keeping the full 3D infrastructure available. Smooth animated transitions between modes let users explore both views naturally.

### Binary Protocol Deserialization

**Decision:** Parse the migratory wire protocol (slice 306) directly using `DataView` and typed array views.

**Rationale:** The protocol is minimal: a 1-byte type discriminator, fixed-size header fields (uint32 tick, uint32 count, float64 world bounds), and raw typed array buffers (float64 positions/velocities, int32 profile indices). This maps directly to JavaScript's `DataView` for headers and `Float64Array`/`Int32Array` wrapping the `ArrayBuffer` at computed byte offsets. No serialization library needed. Little-endian throughout, matching the server.

**Protocol summary:**
- **SNAPSHOT (0x01):** `[u8 type | u32 tick | f64 width | f64 height | u32 count | f64[N×2] positions | f64[N×2] velocities | i32[N] profile_indices]` — 25 + N×36 bytes
- **STATE_UPDATE (0x02):** `[u8 type | u32 tick | u32 count | f64[N×2] positions | f64[N×2] velocities]` — 9 + N×32 bytes

### Flat Ground Plane Until Protocol Extension

**Decision:** Render a flat ground plane for terrain until the wire protocol is extended to carry terrain data.

**Rationale:** The server has real terrain data (slice 501 complete) that agents respond to, but the wire protocol (306) only carries entity state. The correct path is extending the protocol to send terrain — not replicating terrain generation in JavaScript. A flat plane is honest about what data the viewer actually has. Agents may appear to slow down or divert for no visible reason (they're responding to server-side elevation), which is a known visual artifact of this gap.

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
│   ├── types.ts            # Message types, parsed state interfaces
│   └── deserialize.ts      # Binary protocol parsing (DataView + typed array views)
├── net/
│   └── connection.ts       # WebSocket lifecycle: connect, reconnect, status
├── rendering/
│   ├── scene.ts            # Three.js scene setup: renderer, lighting, resize
│   ├── entities.ts         # InstancedMesh creation, per-tick matrix updates
│   ├── terrain.ts          # PlaneGeometry ground plane (flat now, displaced later)
│   ├── overlays.ts         # Environment layer overlays (stubbed until data available)
│   └── camera.ts           # Orthographic/perspective modes, pan/zoom/orbit, follow-cam
├── ui/
│   ├── hud.ts              # Status panel: connection, tick rate, entity counts
│   └── legend.ts           # Profile color legend
└── config.ts               # Runtime configuration (server URL, rendering params)
```

### Data Flow

```
WebSocket binary frame
  → protocol/deserialize.ts: parse type byte, extract header, wrap array sections
  → net/connection.ts: dispatch to snapshot handler or update handler
  
Snapshot (0x01):
  → Store world bounds, profile indices
  → rendering/terrain.ts: set ground plane scale from world bounds
  → rendering/entities.ts: allocate InstancedMesh for entity_count, set initial matrices
  → ui/hud.ts: update entity counts, profile breakdown

State Update (0x02):
  → rendering/entities.ts: update InstancedMesh matrices from new positions/velocities
  → ui/hud.ts: update tick counter

Render loop (requestAnimationFrame):
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

## External Dependencies

### migratory (server-side)

| Slice | Status | Viewer Dependency |
|---|---|---|
| 305 — WebSocket Client Layer | Complete | Connection endpoint |
| 306 — State Serialization and Protocol | Complete | Wire format definition |
| 307 — Simulation Logging and Replay | Complete | Future: replay mode data source |
| 501 — Terrain Layer | Complete | Terrain exists but not on wire yet |

The viewer can begin immediately — all required server infrastructure is operational. Terrain rendering depends on a future protocol extension to carry environment data (reserved message types 0x03–0x0F).

### Third-Party

- **Three.js** (r128+) — 3D rendering
- **Vite** — Build tooling and dev server
- No other runtime dependencies in v1

## Performance Targets

| Metric | Target | Notes |
|---|---|---|
| Frame rate at 10K entities | 60 fps | Comfortable operating range |
| Frame rate at 50K entities | 30 fps | Functional with instancing optimizations |
| Frame rate at 100K entities | 15+ fps | Aspirational; may need LOD or WebGL compute |
| WebSocket deserialization | < 1ms per message | Typed array views are near-zero-cost |
| Time to first render after connect | < 500ms | Snapshot parsing + initial mesh setup |

Performance profiling and optimization is its own slice (106) in the slice plan.

## Relationship to Slice Plan

The slice plan (`100-slices.viewer-foundation.md`) is already complete and decomposes this architecture into 8 slices:

| Slice | Scope | Architecture Component |
|---|---|---|
| 100 — Scaffold + Rendering Core | Vite project, Three.js scene, static test instances | Scene setup, entity rendering skeleton |
| 101 — WebSocket Consumer | Binary protocol parsing, live entity rendering | Protocol, connection, entity update pipeline |
| 102 — Terrain + Biome Rendering | Displaced PlaneGeometry, flat plane until wire carries terrain | Terrain rendering |
| 103 — Environment Overlays | Resource points, threat zones, trails | Overlay rendering (stubbed until data available) |
| 104 — Camera Modes | Ortho/perspective toggle, orbit, follow-cam, minimap | Camera system |
| 105 — HUD + Status Panel | Connection status, counters, legend | UI layer |
| 106 — Performance Profiling | Bottleneck identification, optimization at scale | Performance targets |
| 107 — Build + Deployment | Production build, static hosting, README | Build and deploy |

The slice plan's implementation order, dependencies, and success criteria remain authoritative. This architecture document provides the structural rationale and component design that the slice plan implements.
