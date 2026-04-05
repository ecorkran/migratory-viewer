---
docType: slice-design
slice: project-scaffold-and-rendering-core
project: migratory-viewer
parent: user/architecture/100-slices.viewer-foundation.md
dependencies: []
interfaces: [101-websocket-consumer-and-live-entity-rendering, 104-camera-modes-and-navigation]
dateCreated: 20260405
dateUpdated: 20260405
status: not_started
---

# Slice Design: Project Scaffold and Rendering Core

## Overview

This slice establishes the migratory-viewer project from scratch: Vite + TypeScript toolchain, Three.js scene using `WebGPURenderer` (with automatic WebGL 2 fallback) and an orthographic camera, instanced mesh rendering of test entities over a flat ground plane, and the source directory layout that all subsequent slices build on. No WebSocket connection, no simulation data — the goal is a working rendering pipeline that proves instanced cones render correctly and the project structure is sound.

## Value

**Developer-facing:** A running `pnpm dev` that opens a browser with rendered instanced cones over a ground plane. This validates the core rendering approach (WebGPURenderer, InstancedMesh, orthographic camera, cone geometry) before any protocol or networking complexity is introduced.

**Architectural enablement:** Establishes the project scaffold, directory layout, and module boundaries that slices 101–107 build on. Every subsequent slice imports from or extends modules created here.

## Technical Scope

### Included
- Vite project scaffold: `package.json`, `tsconfig.json` (with `"moduleResolution": "bundler"`), `vite.config.ts`, `index.html`
- Three.js scene initialization: `WebGPURenderer` (via `three/webgpu`, automatic WebGL 2 fallback), physically correct lighting, resize handling
- Render loop via `renderer.setAnimationLoop()` with `THREE.Timer` for delta time
- Orthographic camera with mouse/trackpad pan and zoom
- Flat ground plane (`PlaneGeometry`) sized to a default world bounds
- `InstancedMesh` rendering N test cones at random positions with profile-based coloring
- Source directory layout matching the architecture's component structure
- GPU device loss handling (pause/resume render loop)
- `config.ts` with default values for world bounds, entity count, color palette
- `pnpm dev` script launching the Vite dev server

### Excluded
- WebSocket connection or binary protocol parsing (slice 101)
- Terrain displacement or environment overlays (slices 102, 103)
- Perspective mode, orbit controls, follow-cam, minimap (slice 104)
- HUD or status panel DOM (slice 105)
- Performance profiling or optimization (slice 106)
- Production build or deployment config (slice 107)

## Dependencies

### Prerequisites
None — this is the foundation slice.

### External Packages
- **three** (r183+) via `three/webgpu` — 3D rendering with WebGPURenderer and automatic WebGL 2 fallback. Type definitions are bundled — no separate `@types/three` needed.
- **vite** (6+) — build tooling and dev server
- **typescript** — compiler
- **pnpm** — package manager (required by Vite 6+ workflow, Node.js ≥ 20.19)

No other runtime or dev dependencies.

## Architecture

### Component Structure

```
src/
├── main.ts                 # Entry point: init scene, start render loop
├── rendering/
│   ├── scene.ts            # WebGPURenderer, scene, lighting, resize, device loss
│   ├── entities.ts         # InstancedMesh creation, matrix updates, coloring
│   ├── terrain.ts          # Flat ground plane
│   └── camera.ts           # Orthographic camera, pan/zoom controls
├── config.ts               # Default configuration values
└── types.ts                # Shared type definitions
```

Additional directories (`protocol/`, `net/`, `ui/`) are created as empty directories or are deferred to their owning slices. The architecture's full layout is established here so that subsequent slices add files into existing locations rather than restructuring.

### Data Flow

This slice has no external data source. The flow is:

```
main.ts
  → config.ts: read default world bounds, entity count, color palette
  → rendering/scene.ts: create WebGPURenderer, scene, lights; register resize + device loss handlers
  → rendering/camera.ts: create orthographic camera, attach pan/zoom input listeners
  → rendering/terrain.ts: create flat PlaneGeometry ground plane from world bounds
  → rendering/entities.ts: create InstancedMesh with N cones at random positions
  → renderer.setAnimationLoop: camera controls update → renderer.render()
```

In slice 101, `main.ts` will additionally initialize the WebSocket connection, and `entities.ts` will accept server-provided positions instead of random ones. The interfaces are designed for that transition.

## Technical Decisions

### Orthographic Camera Configuration

The default view is top-down orthographic. The camera looks straight down the Y axis at the XZ ground plane. Camera frustum is sized to show the full world bounds initially:

```
camera.position.set(worldWidth / 2, 100, worldHeight / 2)
camera.lookAt(worldWidth / 2, 0, worldHeight / 2)
```

Frustum boundaries are computed from world bounds and the viewport aspect ratio. Zoom is implemented by scaling the frustum (adjusting `left`/`right`/`top`/`bottom`). Pan is implemented by translating the camera target position. Both respond to mouse wheel (zoom) and middle-click/right-click drag (pan).

### Entity Rendering with InstancedMesh

Following the validated approach from the prototype (`02-migratory-threejs-instanced-terrain.html`):

- **Geometry:** `ConeGeometry` rotated so the point faces the +Z direction (forward). The prototype uses `ConeGeometry(0.3, 1.2, 5)` with `rotateX(Math.PI / 2)` — this is a reasonable starting size for the default world bounds (1000x1000). The exact dimensions are defined in `config.ts`.
- **Coloring:** Per-instance color via `InstancedMesh.instanceColor`. Each entity's color is determined by its profile index mapped through a color palette array in `config.ts`.
- **Matrix updates:** A shared `Object3D` (the `dummy` pattern from the prototype) computes each entity's transformation matrix. Position is `(x, 0, z)` on the flat plane. Rotation is `atan2(vz, vx)` pointing the cone in the movement direction. For test data in this slice, velocities are randomized alongside positions.
- **Count:** The test scene renders `config.defaultEntityCount` instances (default: 500). This is enough to visually verify instancing works without being a performance test.

### Ground Plane

A `PlaneGeometry` rotated to lie in the XZ plane, sized to match world bounds from config. `MeshLambertMaterial` with a muted color (similar to the prototype's `0x2a3a2a`). Lighting uses the physically correct model: `HemisphereLight` at intensity ~1.5 for ambient fill, `DirectionalLight` at intensity `Math.PI` for the primary sun. In slice 102, this becomes a displaced terrain mesh; the interface is: replace the geometry's vertex Y values and recompute normals.

### GPU Device Loss Handling

`WebGPURenderer` handles device loss differently from WebGL context loss. When the GPU adapter is lost (tab backgrounded, driver reset, memory pressure), Three.js internally handles reinitialization. The viewer:

- Registers a device-loss callback to log the event and set a `deviceLost` flag.
- On restoration, `setAnimationLoop` resumes automatically once the device is reacquired.
- For the WebGL 2 fallback path, the traditional `webglcontextlost`/`webglcontextrestored` canvas events still apply — register both for completeness.

This is basic lifecycle management. Full recovery testing is deferred to slice 106.

### Configuration Module

`config.ts` exports a typed configuration object with defaults:

```typescript
export interface ViewerConfig {
  serverUrl: string;          // WebSocket endpoint (used by slice 101)
  worldWidth: number;         // default: 1000
  worldHeight: number;        // default: 1000
  defaultEntityCount: number; // default: 500 (test mode only)
  coneRadius: number;         // default: 0.3
  coneHeight: number;         // default: 1.2
  coneSegments: number;       // default: 5
  profileColors: number[];    // hex color palette indexed by profile
  groundColor: number;        // default: 0x2a3a2a
  backgroundColor: number;    // default: 0x1a1a1a
}
```

Values are not hard-coded in rendering modules. Rendering modules receive config values as parameters or read from the config module. `serverUrl` defaults to `import.meta.env.VITE_SERVER_URL || 'ws://localhost:8765'` — unused in this slice but established for slice 101.

### TypeScript Configuration

`tsconfig.json` must set `"moduleResolution": "bundler"` — required for `three/webgpu` and `three/tsl` subpath imports to resolve correctly. This is Vite's default for the `vanilla-ts` template:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true
  }
}
```

### Vite Configuration

```typescript
// vite.config.ts
import { defineConfig } from 'vite';

export default defineConfig({
  // base is set at build time for deployment (slice 107)
});
```

Minimal config. TypeScript is handled by Vite's built-in esbuild transform. No plugins needed for this slice.

## Integration Points

### Provides to Other Slices

- **rendering/scene.ts** — `scene`, `renderer`, `camera` instances; resize handling; device loss lifecycle. Slice 101 uses the scene to add/update entities from server data.
- **rendering/entities.ts** — `InstancedMesh` creation and matrix update functions. Slice 101 replaces random test data with server-provided positions/velocities. The key interface: a function that accepts position and velocity typed arrays and updates the instanced mesh matrices.
- **rendering/terrain.ts** — Ground plane mesh in the scene. Slice 102 replaces flat geometry with displaced terrain.
- **rendering/camera.ts** — Orthographic camera with pan/zoom. Slice 104 adds perspective mode and orbit controls.
- **config.ts** — Centralized configuration. All slices read from this.
- **types.ts** — Shared type definitions. Slice 101 adds `ViewerState` and protocol types here.
- **Project scaffold** — `package.json`, Vite config, directory layout. Every slice adds to this.

### Consumes from Other Slices

Nothing — this is the foundation.

## Success Criteria

### Functional Requirements
- `pnpm dev` starts Vite dev server and opens the viewer in a browser
- `WebGPURenderer` initializes (WebGPU where available, WebGL 2 fallback otherwise) — log which backend is active to the console
- A flat ground plane renders, sized to the configured world bounds, with physically correct lighting
- N instanced cones render at random positions on the ground plane
- Cones are colored by a simulated profile index (at least 2-3 distinct colors visible)
- Cones point in the direction of their randomized velocity vector
- Mouse wheel zooms the orthographic camera (frustum scales)
- Middle-click or right-click drag pans the camera
- Window resize correctly updates the camera frustum and renderer size
- GPU device loss is handled (render loop pauses and resumes)

### Technical Requirements
- All Three.js imports use `three/webgpu`, not `three`
- Render loop uses `renderer.setAnimationLoop()`, not bare `requestAnimationFrame`
- Delta time via `THREE.Timer`, not deprecated `THREE.Clock`
- `tsconfig.json` has `"moduleResolution": "bundler"`
- TypeScript compiles without errors (`npx tsc --noEmit`)
- Source directory layout matches the architecture's component structure
- No hard-coded magic values in rendering modules — all configurable via `config.ts`
- Cone geometry, color palette, ground plane color, and lighting intensities are defined as config, not inline literals
- `pnpm build` produces a working production build (static assets in `dist/`)

### Verification Walkthrough

1. **Project setup:**
   ```bash
   pnpm install
   pnpm dev
   ```
   Browser opens to `http://localhost:5173`. The viewport shows a dark background with a green-tinted ground plane.

2. **Renderer backend:**
   Open browser console. A log message indicates which backend is active: `WebGPU` or `WebGL 2 (fallback)`. In Chrome/Edge the expectation is WebGPU.

3. **Entity rendering:**
   Approximately 500 small colored cones are visible scattered across the ground plane. At least 2-3 distinct colors are present, corresponding to different simulated profile indices. Each cone points in a direction (not all identical).

4. **Camera controls:**
   - Scroll the mouse wheel: the view zooms in and out smoothly. Zooming in makes cones larger; zooming out shows more of the world.
   - Hold middle-click (or right-click) and drag: the view pans across the ground plane.

5. **Resize:**
   Resize the browser window. The ground plane and cones maintain correct proportions — no stretching or clipping.

6. **Type check:**
   ```bash
   npx tsc --noEmit
   ```
   Exits with code 0, no errors.

7. **Production build:**
   ```bash
   pnpm build
   ```
   Produces `dist/` with `index.html` and bundled JS. Serving via `pnpm preview` shows the same scene.

## Implementation Notes

### Development Approach

Suggested implementation order:

1. **Project scaffold** — `pnpm create vite@latest -- --template vanilla-ts`, install `three`, set up `tsconfig.json` (verify `moduleResolution: "bundler"`), create the source directory layout, verify `pnpm dev` serves the default Vite page.
2. **Scene and renderer** — `rendering/scene.ts`: create `WebGPURenderer` via `import * as THREE from 'three/webgpu'`, `Scene`, physically correct lighting (`HemisphereLight` + `DirectionalLight`), resize handler, device loss handlers. `main.ts` initializes and starts the render loop via `renderer.setAnimationLoop()`. Use `THREE.Timer` for delta time. Log active backend to console. Verify: dark background renders in browser.
3. **Camera** — `rendering/camera.ts`: orthographic camera sized to default world bounds, pan/zoom input handlers. Verify: scrolling zooms, dragging pans (even with nothing in the scene yet).
4. **Ground plane** — `rendering/terrain.ts`: flat `PlaneGeometry` in XZ plane. Verify: green-tinted plane visible from the top-down camera with correct physically-lit appearance.
5. **Instanced entities** — `rendering/entities.ts`: create `InstancedMesh` with cone geometry, populate with random positions/velocities, apply profile colors. Verify: colored cones scattered on the ground plane, pointing in varied directions.
6. **Config extraction** — Move any inline values to `config.ts`. Verify `tsc --noEmit` passes, `pnpm build` succeeds.
