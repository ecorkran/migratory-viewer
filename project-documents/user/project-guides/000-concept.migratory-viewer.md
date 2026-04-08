---
layer: project
project: migratory-viewer
phase: 0
phaseName: concept
guideRole: primary
audience: [human, ai]
description: Concept for migratory-viewer
dependsOn: []
dateCreated: 20260405
dateUpdated: 20260405
status: in_progress
docType: concept
---

# migratory-viewer

## Overview
A real-time visualization client for the migratory simulation, consuming world server state over WebSocket and rendering entities, terrain, and environmental layers in a browser.

## User-Provided Concept

The migratory project has three active worktrees delivering the simulation backend: a behavior engine (initiative 100) providing force-based agent movement with flocking, herding, and predator-prey dynamics; a world server (initiative 300) orchestrating the tick loop, entity management, and client connections; and an environment layer (initiative 500) providing terrain, biomes, resources, threat zones, and stigmergic trails.

The world server already accepts WebSocket connections and pushes per-tick state updates to clients (slice 305, complete). The wire protocol (slice 306) is complete — a custom binary format using typed array buffers with a 1-byte message type discriminator, minimal fixed-size headers, and raw NumPy array sections. The environment layer integration (slice 304) is complete. The grid infrastructure (500) is complete; terrain layer (501) is complete — `TerrainLayer` provides elevation and slope via simplex noise generation, and it's integrated into the tick loop via 304. Biome (502) and remaining environment layers are not yet started. No existing slice plan owns the rendering client — this is a new project.

A prior artifact (`threejs_boid_terrain.html`) demonstrated the viability of Three.js with instanced mesh rendering for this domain: up to 2,000 agents as directional cones over procedural terrain, with a predator, camera orbit controls, and parameter sliders. That artifact computed simulation locally; this project replaces the local simulation with a WebSocket consumer receiving state from the world server.

The first version should render a top-down view. Three.js is preferred over Canvas 2D because the instanced mesh approach is already validated, terrain elevation maps naturally to vertex displacement, and environment layers (biomes, threats, trails) map to standard 3D rendering techniques. An orthographic camera provides the top-down 2D feel while preserving the option to orbit into perspective for a 3D view.

This is a separate repository (`migratory-viewer`), not a worktree of migratory. The client shares zero source code with the Python simulation backend — it consumes a WebSocket API and renders. Its language, toolchain, build pipeline, and deployment are independent. The context-visualizer project establishes the precedent: separate repo, consumes a backend's API, has its own initiative/slice structure.

See reference (`project-documents/user/reference`) for:
* concept art which servers as a sort of 'ultimate future vision'
* server protocol and config information
* initial threejs prototype

## Refined Concept

### Problem & Motivation

The migratory simulation currently runs headless. Verifying that agent behavior is correct — that flocks cohere, herds follow corridors, predators hunt, prey flee — requires inspecting logged state or writing ad-hoc test harnesses. A real-time visual client makes emergent behavior immediately observable, accelerates development feedback loops, and produces compelling demonstrations of the simulation's capabilities.

Beyond development utility, the viewer is the first consumer of the world server's client protocol. Building it validates the WebSocket layer, the wire protocol (306), and the spatial culling system (309) under real usage. Any protocol design issues surface here before external clients are built.

### Target Users

1. **The developer (Erik)** — primary user during development. Needs to see agent behavior in real time, verify environment layers are producing expected effects, and debug simulation issues visually.
2. **Demonstration audience** — portfolio reviewers, potential employers, collaborators. The viewer is the public face of migratory's simulation work.
3. **Future: interactive users** — once administrative client commands (300-series future work) are implemented, the viewer becomes a control surface for spawning entities, adjusting parameters, and experimenting with scenarios.

### Solution Approach

A browser-based Three.js application that connects to the world server over WebSocket, receives entity state and environment data, and renders in real time.

**Core rendering pipeline:**
- Connect to world server, receive initial snapshot (world bounds, entity positions/velocities/profile indices, environment state)
- Each tick: receive state update, update instanced mesh matrices from position/velocity arrays, render
- Entities rendered as directional cones (or similar geometry) via `InstancedMesh`, color-coded by behavioral profile
- Terrain as a displaced `PlaneGeometry` with vertex colors or texture mapping for biomes
- Environment overlays: resource points as icons/markers, threat zones as translucent radial meshes, stigmergic trails as dynamic textures or decal layers

**Camera system:**
- Default: orthographic top-down (the "2D" view)
- Toggle or smooth transition to perspective with orbit controls
- Pan and zoom in both modes
- Optional: follow-cam mode tracking a specific entity or group centroid

**Data flow:**
- World server pushes; client receives. No client-to-server commands in v1 (matches server's v1 protocol)
- Client-side viewport declaration for spatial culling (when server slice 309 is available)
- Graceful handling of connection loss, reconnection, and initial snapshot synchronization

### Initial Technical Direction

- **Language:** TypeScript
- **Rendering:** Three.js (r128+ for InstancedMesh stability; may upgrade for newer features)
- **Build:** Vite (fast dev server, HMR, minimal config)
- **WebSocket:** Native browser WebSocket API (no socket.io — the server uses raw asyncio WebSocket)
- **Serialization:** Custom binary protocol (migratory slice 306, complete). Messages are raw typed array buffers with minimal framing: a 1-byte type discriminator, fixed-size header fields via `struct`, and contiguous float64/int32 array sections. Client-side parsing uses `DataView` for headers and typed array views (`Float64Array`, `Int32Array`) at computed byte offsets. Two message types: SNAPSHOT (0x01, includes world bounds + full entity state + profile indices) and STATE_UPDATE (0x02, positions + velocities only). Little-endian, row-major throughout.
- **No framework initially:** Vanilla DOM for UI controls (sliders, status indicators, legend). React is overkill for a handful of controls. Can add later if UI complexity grows.
- **Hosting:** Local dev server initially. Architecture should not couple to a hosting provider — Vite's production build produces static assets deployable anywhere (GitHub Pages, Netlify, S3, etc.) with no code changes.

### Development Approach

- Follow the ai-project-guide methodology (this concept → architecture/HLD → slice plan → slice designs → tasks)
- Slice boundaries aligned with rendering capabilities: foundation (WebSocket + basic entity rendering), then environment layers one at a time, then UI/UX polish
- The wire protocol (slice 306) is complete — the client can build directly against the binary format
- Test with the live world server as early as possible; a mock server is useful but not a substitute for integration
- Entity count targets: comfortable at 10K, functional at 50K, aspirational at 100K+ (the last likely requires WebGL instancing optimizations or compute-shader approaches)

### Key Dependencies on migratory

| Migratory Slice | Status | Viewer Impact |
|---|---|---|
| 303 — Behavior Engine Integration | Complete | Entities move under behavioral forces |
| 304 — Environment Layer Integration | Complete | Server has environment data in tick loop |
| 305 — WebSocket Client Layer | Complete | Server accepts connections and pushes state |
| 306 — State Serialization and Protocol | Complete | Binary wire protocol — client parses this directly |
| 307 — Simulation Logging and Replay | Complete | Enables replay mode in viewer (future) |
| 308 — Temporal Orchestration | Not started | Day/night, seasons in viewer (future) |
| 309 — Client Spatial Culling | Not started | Viewport-based data reduction at scale |
| 500 — Grid Infrastructure | Complete | Foundation for all environment layers |
| 501 — Terrain Layer | Complete | Elevation and slope data influencing agent movement |
| 502 — Biome Layer | Not started | Biome visualization |
| 503 — Resource Layer | Not started | Resource point rendering |
| 505 — Threat Zones | Not started | Threat zone overlays |
| 506 — Stigmergic Trails | Not started | Trail visualization |

**Note on terrain:** The terrain layer (501) is complete server-side — `TerrainLayer` provides elevation and slope data via a `Grid`, and the environment integration (304) wires it into the tick loop. Agents are already moving under terrain influence. However, the wire protocol (306) carries entity state only — no terrain data is serialized to clients yet. The correct path is to extend the protocol to send terrain data to the client (a new message type in the reserved 0x03–0x0F range), not to replicate terrain generation in JavaScript. The viewer should render what the server provides. Until that protocol extension exists, the viewer starts with a flat ground plane — honest about what data it actually has. Extending the protocol is a migratory-side task that unblocks the viewer's terrain rendering.

The viewer can begin with entity rendering immediately — all entity-related server infrastructure is complete.

### Open Questions

1. **Terrain protocol extension:** The server has real terrain data (501 complete) that agents respond to. The viewer should render this data, not generate its own. This requires extending the wire protocol with an environment data message type — likely a one-time terrain grid sent in or after the snapshot. Who designs this extension and when? It could be a small follow-on to 306 on the migratory side, or part of the viewer's architecture phase if it's easier to define the format from the consumer's perspective. Until it's done, the viewer renders a flat plane.
2. **Environment protocol extension ownership:** When terrain/biome data eventually needs to reach the client, does migratory own that (as a 306 follow-on or new slice) or does the viewer project propose the message format? The protocol's reserved type range (0x03–0x0F) accommodates this. Likely migratory owns serialization, viewer owns rendering — but the format design benefits from both perspectives.
