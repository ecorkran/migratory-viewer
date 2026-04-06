---
docType: tasks
slice: project-scaffold-and-rendering-core
project: migratory-viewer
lld: user/slices/100-slice.project-scaffold-and-rendering-core.md
dependencies: []
projectState: New project — no source code, no package.json, no existing infrastructure. Project documents and guides are in place.
dateCreated: 20260405
dateUpdated: 20260406
status: complete
---

## Context Summary
- Working on slice 100: Project Scaffold and Rendering Core
- This is the foundation slice — no prerequisites, no existing source code
- Establishes the Vite + TypeScript + Three.js (WebGPURenderer) project scaffold
- Delivers a static test scene: instanced cones over a flat ground plane with orthographic camera
- No WebSocket connection or simulation data — purely rendering pipeline validation
- Next planned slice: 101 (WebSocket Consumer and Live Entity Rendering)
- Reference: prototype at `project-documents/user/reference/prototypes/02-migratory-threejs-instanced-terrain.html`
- Tool guides: `ai-project-guide/tool-guides/threejs/` (setup, overview, webgpu, lighting, deployment)

## Tasks

### 1. Project Scaffold

- [x] **1.1 Initialize Vite project with TypeScript template**
  - [x] Run `pnpm create vite@latest . -- --template vanilla-ts` from project root (or scaffold into a temp dir and move files if project root has existing content)
  - [x] Install Three.js: `pnpm add three`
  - [x] Verify no `@types/three` is installed — type definitions are bundled with `three` since r152
  - [x] Add ai-project-guide npm scripts from `ai-project-guide/snippets/npm-scripts.ai-support.json.md` to `package.json`
  - [x] Verify `pnpm dev` serves the default Vite template page in the browser
  - [x] Commit: `feat: initialize Vite + TypeScript project scaffold`

- [x] **1.2 Configure TypeScript for Three.js WebGPU**
  - [x] Update `tsconfig.json` to include:
    - `"target": "ES2022"`
    - `"module": "ESNext"`
    - `"moduleResolution": "bundler"` (required for `three/webgpu` and `three/tsl` subpath imports)
    - `"strict": true`
  - [x] Verify the Vite template's default `tsconfig` settings are compatible; adjust if the template overrides any of the above
  - [x] SC: `pnpm dev` still runs without errors after tsconfig changes

- [x] **1.3 Create source directory layout**
  - [x] Create the directory structure matching the architecture:
    ```
    src/
    ├── main.ts
    ├── rendering/
    │   ├── scene.ts
    │   ├── entities.ts
    │   ├── terrain.ts
    │   └── camera.ts
    ├── config.ts
    └── types.ts
    ```
  - [x] Create placeholder files with minimal exports (empty functions or type stubs) so that imports resolve
  - [x] Remove Vite template boilerplate files (`counter.ts`, `style.css` template content, etc.) — replace with project files
  - [x] Update `index.html` to reference `src/main.ts` as the module entry point and include a `<canvas id="three-canvas">` element
  - [x] Add CSS: full-viewport canvas with dark background color (`#1a1a1a`), no margins, no scrollbars (see `ai-project-guide/tool-guides/threejs/setup.md` section 4)
  - [x] SC: `pnpm dev` runs, browser shows a dark viewport with no console errors
  - [x] Commit: `feat: create source directory layout and HTML entry point`

### 2. Configuration Module

- [x] **2.1 Implement `config.ts` with typed defaults**
  - [x] Define `ViewerConfig` interface as specified in the slice design (serverUrl, worldWidth, worldHeight, defaultEntityCount, coneRadius, coneHeight, coneSegments, profileColors, groundColor, backgroundColor)
  - [x] Export a default config object with the values from the slice design:
    - `serverUrl`: `import.meta.env.VITE_SERVER_URL || 'ws://localhost:8765'`
    - `worldWidth`: 1000, `worldHeight`: 1000
    - `defaultEntityCount`: 500
    - `coneRadius`: 0.3, `coneHeight`: 1.2, `coneSegments`: 5
    - `profileColors`: array of at least 3 distinct hex colors
    - `groundColor`: `0x2a3a2a`, `backgroundColor`: `0x1a1a1a`
  - [x] Add lighting intensity values to config: `hemisphereIntensity` (~1.5), `directionalIntensity` (`Math.PI`), `hemisphereColors` (sky/ground), `directionalColor`, `directionalPosition`
  - [x] SC: `npx tsc --noEmit` passes with no errors

- [x] **2.2 Implement `types.ts` with shared type definitions**
  - [x] Define `ConnectionStatus` enum (or string union): `disconnected`, `connecting`, `connected`, `reconnecting`
  - [x] Define any shared rendering types needed across modules (e.g., type alias for world bounds)
  - [x] Keep minimal — this file grows in slice 101 when `ViewerState` and protocol types are added
  - [x] SC: `npx tsc --noEmit` passes
  - [x] Commit: `feat: add configuration module and shared types`

### 3. Scene and Renderer

- [x] **3.1 Implement `rendering/scene.ts` — WebGPURenderer and scene setup**
  - [x] Import from `three/webgpu` (not `three`): `import * as THREE from 'three/webgpu'`
  - [x] Create and export a function that initializes and returns the core rendering objects:
    - `WebGPURenderer` with `{ canvas, antialias: true }` — attach to the `#three-canvas` element
    - Set pixel ratio (`window.devicePixelRatio`) and size (`window.innerWidth/Height`)
    - Set clear color and scene background from `config.backgroundColor`
    - `Scene` instance
  - [x] Add physically correct lighting from config values:
    - `HemisphereLight` (sky color, ground color, intensity ~1.5)
    - `DirectionalLight` (color, intensity `Math.PI`, positioned per config)
  - [x] Register window resize handler: update renderer size (camera update is handled by camera module — scene.ts should accept a callback or the camera module registers its own listener)
  - [x] Log active backend to console after renderer init: check `renderer.backend.isWebGPUBackend` and log `'WebGPU'` or `'WebGL 2 (fallback)'`
  - [x] SC: Setup function exports renderer, scene, and camera; scene contains hemisphere and directional lights; `npx tsc --noEmit` passes (runtime verification in task 3.4 after render loop exists)

- [x] **3.2 Implement GPU device loss handling in `rendering/scene.ts`**
  - [x] Register device-loss callback via renderer backend to log the event and set a `deviceLost` flag
  - [x] On restoration, `setAnimationLoop` resumes automatically — log the recovery event
  - [x] For WebGL 2 fallback path: register `webglcontextlost` and `webglcontextrestored` canvas events
    - `webglcontextlost`: `event.preventDefault()`, log event
    - `webglcontextrestored`: log recovery
  - [x] SC: No runtime errors during normal operation; device loss handlers are registered (verifiable via code inspection — full recovery testing deferred to slice 106)

- [x] **3.3 Implement `main.ts` — entry point and render loop**
  - [x] Import scene setup from `rendering/scene.ts`
  - [x] Import camera setup from `rendering/camera.ts` (stub for now — will be implemented in task 4)
  - [x] Import terrain setup from `rendering/terrain.ts` (stub for now — task 5)
  - [x] Import entity setup from `rendering/entities.ts` (stub for now — task 6)
  - [x] Create a `THREE.Timer` instance for delta time
  - [x] Start render loop via `renderer.setAnimationLoop()` — not bare `requestAnimationFrame`
  - [x] Inside the loop: call `timer.update()`, get delta, update camera controls, call `renderer.render(scene, camera)`
  - [x] SC: `pnpm dev` shows the dark background with lighting active; render loop runs continuously (verifiable via adding a temporary console.log or checking devtools frame rate)
  - [x] Commit: `feat: add WebGPURenderer scene setup and render loop`

- [x] **3.4 Verify scene and renderer**
  - [x] Run `pnpm dev` and confirm:
    1. Browser opens with dark background
    2. Console shows backend identification (`WebGPU` or `WebGL 2 (fallback)`)
    3. No console errors or warnings
    4. Resizing the browser window adjusts the viewport without errors
  - [x] Run `npx tsc --noEmit` — no type errors
  - [x] Verify all Three.js imports use `three/webgpu`, not `three`

### 4. Orthographic Camera

- [x] **4.1 Implement `rendering/camera.ts` — orthographic camera with pan/zoom**
  - [x] Create and export a function that creates an `OrthographicCamera`:
    - Position: `(worldWidth / 2, 100, worldHeight / 2)` looking down at `(worldWidth / 2, 0, worldHeight / 2)`
    - Frustum sized to show full world bounds, computed from world dimensions and viewport aspect ratio
  - [x] Implement zoom via mouse wheel:
    - Scale the frustum (`left`/`right`/`top`/`bottom`) on wheel events
    - Clamp zoom level to reasonable min/max bounds
    - Call `camera.updateProjectionMatrix()` after frustum changes
  - [x] Implement pan via middle-click or right-click drag:
    - Track mouse down/move/up events
    - Translate camera position and lookAt target by the drag delta scaled to world units
  - [x] Export an `updateCamera` function (or similar) called each frame from the render loop — even if it's a no-op for now, the interface should exist for future animation needs
  - [x] Register resize callback: update frustum boundaries when window is resized, maintaining aspect ratio and current zoom level
  - [x] SC: Camera created with correct initial frustum; zoom and pan handlers are registered

- [x] **4.2 Verify camera controls**
  - [x] Run `pnpm dev` and confirm:
    1. Top-down view shows the ground plane (if present) or at least responds to input
    2. Mouse wheel zooms in/out smoothly — frustum scales, objects get larger/smaller
    3. Middle-click (or right-click) drag pans the view
    4. Resizing the browser window maintains correct aspect ratio without distortion
  - [x] Run `npx tsc --noEmit` — no type errors
  - [x] Commit: `feat: add orthographic camera with pan and zoom controls`

### 5. Ground Plane

- [x] **5.1 Implement `rendering/terrain.ts` — flat ground plane**
  - [x] Create and export a function that builds the ground plane:
    - `PlaneGeometry` sized to `worldWidth × worldHeight` from config
    - Rotate to lie in XZ plane (`rotateX(-Math.PI / 2)`)
    - `MeshLambertMaterial` with color from `config.groundColor`
    - Add the mesh to the scene
  - [x] Position the plane so it is centered under the camera's initial view (origin at `(worldWidth/2, 0, worldHeight/2)` or adjusted to match camera lookAt)
  - [x] SC: Plane renders as a visible green-tinted surface from the top-down orthographic camera

- [x] **5.2 Verify ground plane rendering**
  - [x] Run `pnpm dev` and confirm:
    1. A green-tinted flat surface fills the viewport (or most of it at default zoom)
    2. The plane is correctly lit by the hemisphere and directional lights — not uniformly flat, some shading visible
    3. Zooming and panning work over the ground plane
  - [x] Commit: `feat: add flat ground plane terrain`

### 6. Instanced Entity Rendering

- [x] **6.1 Implement `rendering/entities.ts` — InstancedMesh with test data**
  - [x] Create and export a function that builds the instanced entity mesh:
    - `ConeGeometry(config.coneRadius, config.coneHeight, config.coneSegments)` rotated with `rotateX(Math.PI / 2)` so the point faces +Z
    - `MeshLambertMaterial` as the base material
    - `InstancedMesh` with count from `config.defaultEntityCount`
  - [x] Generate random test data:
    - Positions: random `(x, z)` within world bounds
    - Velocities: random direction vectors (for rotation only — entities don't move in this slice)
    - Profile indices: random assignment across available profile colors
  - [x] Populate instance matrices using the `Object3D` dummy pattern:
    - For each entity: set position `(x, 0, z)`, rotation `atan2(vz, vx)` via `dummy.rotation.y`, update matrix, call `mesh.setMatrixAt(i, dummy.matrix)`
    - Mark `instanceMatrix.needsUpdate = true`
  - [x] Apply per-instance colors via `InstancedMesh.instanceColor`:
    - For each entity: set color from `config.profileColors[profileIndex]`
    - Mark `instanceColor.needsUpdate = true`
  - [x] Export an `updateEntities` function interface that accepts position and velocity typed arrays — for this slice it can be a no-op or log, but the signature must exist for slice 101
  - [x] SC: Instanced mesh is created and added to the scene

- [x] **6.2 Verify instanced entity rendering**
  - [x] Run `pnpm dev` and confirm:
    1. ~500 small colored cones are visible scattered across the ground plane
    2. At least 2-3 distinct colors are visible (profile-based coloring works)
    3. Cones point in varied directions (rotation from velocity vectors works)
    4. Cones are positioned on the ground plane surface (y ≈ 0), not floating or buried
    5. Zooming in shows individual cone geometry clearly
  - [x] Commit: `feat: add instanced entity rendering with test data`

### 7. Config Extraction and Final Verification

- [x] **7.1 Audit for hard-coded values**
  - [x] Review all files in `src/rendering/` and `src/main.ts` for any hard-coded magic values
  - [x] Move any remaining inline literals to `config.ts`:
    - Cone dimensions, colors, world bounds
    - Lighting intensities, positions, colors
    - Ground plane color, background color
    - Camera initial position, zoom limits
  - [x] Ensure rendering modules receive config values as parameters or import from `config.ts`
  - [x] SC: No numeric or color literals in rendering modules except mathematical constants (`Math.PI`, `0`, `-1`, etc.)

- [x] **7.2 TypeScript compilation check**
  - [x] Run `npx tsc --noEmit` — must exit with code 0, no errors
  - [x] Verify all imports use `three/webgpu`, not `three`
  - [x] Verify no use of deprecated `THREE.Clock` — must use `THREE.Timer`
  - [x] Verify render loop uses `renderer.setAnimationLoop()`, not `requestAnimationFrame`

- [x] **7.3 Production build verification**
  - [x] Run `pnpm build` — must complete without errors, produce `dist/` directory
  - [x] Run `pnpm preview` — serve the production build locally
  - [x] Verify the scene renders identically to dev mode (ground plane, cones, camera controls)
  - [x] Commit: `feat: finalize config extraction and production build`

- [x] **7.4 Full verification walkthrough**
  - [x] Execute the complete verification walkthrough from the slice design:
    1. `pnpm install && pnpm dev` — browser opens with dark background and green ground plane
    2. Console shows backend identification (`WebGPU` or `WebGL 2 (fallback)`)
    3. ~500 colored cones visible, varied directions, 2-3+ colors
    4. Mouse wheel zoom works smoothly
    5. Middle/right-click drag pan works
    6. Window resize maintains proportions
    7. `npx tsc --noEmit` exits 0
    8. `pnpm build && pnpm preview` shows same scene
  - [x] If any step fails, fix and re-verify before marking complete
  - [x] Final commit: `feat: complete slice 100 — project scaffold and rendering core`
