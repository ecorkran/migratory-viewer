---
docType: changelog
scope: project-wide
---

# Changelog
All notable changes to migratory-viewer will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.2.0] - 20260406
### Added
- Binary wire protocol deserializer for SNAPSHOT (0x01) and STATE_UPDATE (0x02) messages with little-endian discipline and parse-boundary validation (`src/protocol/`)
- `ViewerState` singleton with `applySnapshot` / `applyStateUpdate` mutation helpers — connection manager is the sole writer (`src/state.ts`)
- WebSocket connection manager with state machine (DISCONNECTED → CONNECTING → CONNECTED → RECONNECTING), exponential backoff with jitter (500ms → 30s cap), and forced reconnect on entity-count mismatch (`src/net/connection.ts`)
- Live entity rendering: `entities.ts` now consumes `ViewerState`, allocates `InstancedMesh` at `config.maxEntityCount` capacity, and refreshes profile colors only on snapshot
- `config.maxEntityCount` (default 200,000) — hard cap enforced by the parser
- vitest test runner with 29 unit tests covering deserialize, state mutations, connection lifecycle, and entity update logic

### Changed
- `entities.ts` no longer generates random test data; entity rendering is driven entirely by server snapshots
- `main.ts` wires `createConnection(viewerState)` and calls `updateEntities(mesh, viewerState)` per frame

## [0.1.0] - 20260406
### Added
- Vite + TypeScript project scaffold with pnpm
- Three.js WebGPURenderer with automatic WebGL 2 fallback (via `three/webgpu`)
- Orthographic top-down camera with mouse wheel zoom and right-click drag pan
- Flat ground plane terrain sized to world bounds (1000x1000)
- InstancedMesh rendering of 500 test entities (cones) with profile-based coloring
- Physically correct lighting (HemisphereLight + DirectionalLight)
- Render loop via `renderer.setAnimationLoop()` with `THREE.Timer`
- GPU device loss handling for both WebGPU and WebGL 2 fallback paths
- Centralized configuration module (`config.ts`) with typed defaults
- Console logging of active renderer backend (WebGPU vs WebGL 2)
