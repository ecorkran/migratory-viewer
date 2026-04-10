---
docType: changelog
scope: project-wide
---

# Changelog
All notable changes to migratory-viewer will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.4.0] - 20260410
### Added
- HUD overlay panel (`src/ui/hud.ts`, `src/ui/hud.css`) displaying connection status, tick counter, entity count, FPS, and profile legend with color swatches
- Connection status indicator with colored dot (green/yellow/red) and pulsing animation for reconnecting state
- FPS counter with exponential moving average smoothing
- Profile legend with per-profile entity counts and color swatches from `config.profileColors`
- `H` key toggles HUD visibility; click-through (`pointer-events: none`) preserves canvas interaction
- HUD updates before the render early-return, showing connection status while awaiting first snapshot

## [0.3.0] - 20260409
### Added
- World-bounds clamping: pan edges cannot cross world bounds, zoom-out capped at world-fit (zoom=1, full world height visible)
- `panStart`, `panMove`, `panEnd`, `zoomBy` action API exported from `camera.ts`
- `clampCameraToWorld` internal helper enforces position constraints after every camera mutation
- `config.allowOutOfBoundsView` debug flag disables zoom and pan clamps
- `src/input/camera-input.ts` module owns all DOM event binding for the camera

### Changed
- Pan input changed from middle/right-click to left-click drag
- `camera.ts` is now DOM-free — contains no `addEventListener` calls
- `handleResize` re-evaluates zoom-fit and clamps camera position after window resize

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
