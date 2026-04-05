---
docType: tasks
slice: project-scaffold-and-rendering-core
project: migratory-viewer
lld: user/slices/100-slice.project-scaffold-and-rendering-core.md
dependencies: []
projectState: New project — no source code, no package.json, no existing infrastructure. Project documents and guides are in place.
dateCreated: 20260405
dateUpdated: 20260405
status: not_started
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

- [ ] **1.1 Initialize Vite project with TypeScript template**
  - [ ] Run `pnpm create vite@latest . -- --template vanilla-ts` from project root (or scaffold into a temp dir and move files if project root has existing content)
  - [ ] Install Three.js: `pnpm add three`
  - [ ] Verify no `@types/three` is installed — type definitions are bundled with `three` since r152
  - [ ] Add ai-project-guide npm scripts from `ai-project-guide/snippets/npm-scripts.ai-support.json.md` to `package.json`
  - [ ] Verify `pnpm dev` serves the default Vite template page in the browser
  - [ ] Commit: `feat: initialize Vite + TypeScript project scaffold`

- [ ] **1.2 Configure TypeScript for Three.js WebGPU**
  - [ ] Update `tsconfig.json` to include:
    - `"target": "ES2022"`
    - `"module": "ESNext"`
    - `"moduleResolution": "bundler"` (required for `three/webgpu` and `three/tsl` subpath imports)
    - `"strict": true`
  - [ ] Verify the Vite template's default `tsconfig` settings are compatible; adjust if the template overrides any of the above
  - [ ] SC: `pnpm dev` still runs without errors after tsconfig changes

- [ ] **1.3 Create source directory layout**
  - [ ] Create the directory structure matching the architecture:
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
  - [ ] Create placeholder files with minimal exports (empty functions or type stubs) so that imports resolve
  - [ ] Remove Vite template boilerplate files (`counter.ts`, `style.css` template content, etc.) — replace with project files
  - [ ] Update `index.html` to reference `src/main.ts` as the module entry point and include a `<canvas id="three-canvas">` element
  - [ ] Add CSS: full-viewport canvas with dark background color (`#1a1a1a`), no margins, no scrollbars (see `ai-project-guide/tool-guides/threejs/setup.md` section 4)
  - [ ] SC: `pnpm dev` runs, browser shows a dark viewport with no console errors
  - [ ] Commit: `feat: create source directory layout and HTML entry point`

### 2. Configuration Module

- [ ] **2.1 Implement `config.ts` with typed defaults**
  - [ ] Define `ViewerConfig` interface as specified in the slice design (serverUrl, worldWidth, worldHeight, defaultEntityCount, coneRadius, coneHeight, coneSegments, profileColors, groundColor, backgroundColor)
  - [ ] Export a default config object with the values from the slice design:
    - `serverUrl`: `import.meta.env.VITE_SERVER_URL || 'ws://localhost:8765'`
    - `worldWidth`: 1000, `worldHeight`: 1000
    - `defaultEntityCount`: 500
    - `coneRadius`: 0.3, `coneHeight`: 1.2, `coneSegments`: 5
    - `profileColors`: array of at least 3 distinct hex colors
    - `groundColor`: `0x2a3a2a`, `backgroundColor`: `0x1a1a1a`
  - [ ] Add lighting intensity values to config: `hemisphereIntensity` (~1.5), `directionalIntensity` (`Math.PI`), `hemisphereColors` (sky/ground), `directionalColor`, `directionalPosition`
  - [ ] SC: `npx tsc --noEmit` passes with no errors

- [ ] **2.2 Implement `types.ts` with shared type definitions**
  - [ ] Define `ConnectionStatus` enum (or string union): `disconnected`, `connecting`, `connected`, `reconnecting`
  - [ ] Define any shared rendering types needed across modules (e.g., type alias for world bounds)
  - [ ] Keep minimal — this file grows in slice 101 when `ViewerState` and protocol types are added
  - [ ] SC: `npx tsc --noEmit` passes
  - [ ] Commit: `feat: add configuration module and shared types`

### 3. Scene and Renderer

- [ ] **3.1 Implement `rendering/scene.ts` — WebGPURenderer and scene setup**
  - [ ] Import from `three/webgpu` (not `three`): `import * as THREE from 'three/webgpu'`
  - [ ] Create and export a function that initializes and returns the core rendering objects:
    - `WebGPURenderer` with `{ canvas, antialias: true }` — attach to the `#three-canvas` element
    - Set pixel ratio (`window.devicePixelRatio`) and size (`window.innerWidth/Height`)
    - Set clear color and scene background from `config.backgroundColor`
    - `Scene` instance
  - [ ] Add physically correct lighting from config values:
    - `HemisphereLight` (sky color, ground color, intensity ~1.5)
    - `DirectionalLight` (color, intensity `Math.PI`, positioned per config)
  - [ ] Register window resize handler: update renderer size (camera update is handled by camera module — scene.ts should accept a callback or the camera module registers its own listener)
  - [ ] Log active backend to console after renderer init: check `renderer.backend.isWebGPUBackend` and log `'WebGPU'` or `'WebGL 2 (fallback)'`
  - [ ] SC: Setup function exports renderer, scene, and camera; scene contains hemisphere and directional lights; `npx tsc --noEmit` passes (runtime verification in task 3.4 after render loop exists)

- [ ] **3.2 Implement GPU device loss handling in `rendering/scene.ts`**
  - [ ] Register device-loss callback via renderer backend to log the event and set a `deviceLost` flag
  - [ ] On restoration, `setAnimationLoop` resumes automatically — log the recovery event
  - [ ] For WebGL 2 fallback path: register `webglcontextlost` and `webglcontextrestored` canvas events
    - `webglcontextlost`: `event.preventDefault()`, log event
    - `webglcontextrestored`: log recovery
  - [ ] SC: No runtime errors during normal operation; device loss handlers are registered (verifiable via code inspection — full recovery testing deferred to slice 106)

- [ ] **3.3 Implement `main.ts` — entry point and render loop**
  - [ ] Import scene setup from `rendering/scene.ts`
  - [ ] Import camera setup from `rendering/camera.ts` (stub for now — will be implemented in task 4)
  - [ ] Import terrain setup from `rendering/terrain.ts` (stub for now — task 5)
  - [ ] Import entity setup from `rendering/entities.ts` (stub for now — task 6)
  - [ ] Create a `THREE.Timer` instance for delta time
  - [ ] Start render loop via `renderer.setAnimationLoop()` — not bare `requestAnimationFrame`
  - [ ] Inside the loop: call `timer.update()`, get delta, update camera controls, call `renderer.render(scene, camera)`
  - [ ] SC: `pnpm dev` shows the dark background with lighting active; render loop runs continuously (verifiable via adding a temporary console.log or checking devtools frame rate)
  - [ ] Commit: `feat: add WebGPURenderer scene setup and render loop`

- [ ] **3.4 Verify scene and renderer**
  - [ ] Run `pnpm dev` and confirm:
    1. Browser opens with dark background
    2. Console shows backend identification (`WebGPU` or `WebGL 2 (fallback)`)
    3. No console errors or warnings
    4. Resizing the browser window adjusts the viewport without errors
  - [ ] Run `npx tsc --noEmit` — no type errors
  - [ ] Verify all Three.js imports use `three/webgpu`, not `three`

### 4. Orthographic Camera

- [ ] **4.1 Implement `rendering/camera.ts` — orthographic camera with pan/zoom**
  - [ ] Create and export a function that creates an `OrthographicCamera`:
    - Position: `(worldWidth / 2, 100, worldHeight / 2)` looking down at `(worldWidth / 2, 0, worldHeight / 2)`
    - Frustum sized to show full world bounds, computed from world dimensions and viewport aspect ratio
  - [ ] Implement zoom via mouse wheel:
    - Scale the frustum (`left`/`right`/`top`/`bottom`) on wheel events
    - Clamp zoom level to reasonable min/max bounds
    - Call `camera.updateProjectionMatrix()` after frustum changes
  - [ ] Implement pan via middle-click or right-click drag:
    - Track mouse down/move/up events
    - Translate camera position and lookAt target by the drag delta scaled to world units
  - [ ] Export an `updateCamera` function (or similar) called each frame from the render loop — even if it's a no-op for now, the interface should exist for future animation needs
  - [ ] Register resize callback: update frustum boundaries when window is resized, maintaining aspect ratio and current zoom level
  - [ ] SC: Camera created with correct initial frustum; zoom and pan handlers are registered

- [ ] **4.2 Verify camera controls**
  - [ ] Run `pnpm dev` and confirm:
    1. Top-down view shows the ground plane (if present) or at least responds to input
    2. Mouse wheel zooms in/out smoothly — frustum scales, objects get larger/smaller
    3. Middle-click (or right-click) drag pans the view
    4. Resizing the browser window maintains correct aspect ratio without distortion
  - [ ] Run `npx tsc --noEmit` — no type errors
  - [ ] Commit: `feat: add orthographic camera with pan and zoom controls`

### 5. Ground Plane

- [ ] **5.1 Implement `rendering/terrain.ts` — flat ground plane**
  - [ ] Create and export a function that builds the ground plane:
    - `PlaneGeometry` sized to `worldWidth × worldHeight` from config
    - Rotate to lie in XZ plane (`rotateX(-Math.PI / 2)`)
    - `MeshLambertMaterial` with color from `config.groundColor`
    - Add the mesh to the scene
  - [ ] Position the plane so it is centered under the camera's initial view (origin at `(worldWidth/2, 0, worldHeight/2)` or adjusted to match camera lookAt)
  - [ ] SC: Plane renders as a visible green-tinted surface from the top-down orthographic camera

- [ ] **5.2 Verify ground plane rendering**
  - [ ] Run `pnpm dev` and confirm:
    1. A green-tinted flat surface fills the viewport (or most of it at default zoom)
    2. The plane is correctly lit by the hemisphere and directional lights — not uniformly flat, some shading visible
    3. Zooming and panning work over the ground plane
  - [ ] Commit: `feat: add flat ground plane terrain`

### 6. Instanced Entity Rendering

- [ ] **6.1 Implement `rendering/entities.ts` — InstancedMesh with test data**
  - [ ] Create and export a function that builds the instanced entity mesh:
    - `ConeGeometry(config.coneRadius, config.coneHeight, config.coneSegments)` rotated with `rotateX(Math.PI / 2)` so the point faces +Z
    - `MeshLambertMaterial` as the base material
    - `InstancedMesh` with count from `config.defaultEntityCount`
  - [ ] Generate random test data:
    - Positions: random `(x, z)` within world bounds
    - Velocities: random direction vectors (for rotation only — entities don't move in this slice)
    - Profile indices: random assignment across available profile colors
  - [ ] Populate instance matrices using the `Object3D` dummy pattern:
    - For each entity: set position `(x, 0, z)`, rotation `atan2(vz, vx)` via `dummy.rotation.y`, update matrix, call `mesh.setMatrixAt(i, dummy.matrix)`
    - Mark `instanceMatrix.needsUpdate = true`
  - [ ] Apply per-instance colors via `InstancedMesh.instanceColor`:
    - For each entity: set color from `config.profileColors[profileIndex]`
    - Mark `instanceColor.needsUpdate = true`
  - [ ] Export an `updateEntities` function interface that accepts position and velocity typed arrays — for this slice it can be a no-op or log, but the signature must exist for slice 101
  - [ ] SC: Instanced mesh is created and added to the scene

- [ ] **6.2 Verify instanced entity rendering**
  - [ ] Run `pnpm dev` and confirm:
    1. ~500 small colored cones are visible scattered across the ground plane
    2. At least 2-3 distinct colors are visible (profile-based coloring works)
    3. Cones point in varied directions (rotation from velocity vectors works)
    4. Cones are positioned on the ground plane surface (y ≈ 0), not floating or buried
    5. Zooming in shows individual cone geometry clearly
  - [ ] Commit: `feat: add instanced entity rendering with test data`

### 7. Config Extraction and Final Verification

- [ ] **7.1 Audit for hard-coded values**
  - [ ] Review all files in `src/rendering/` and `src/main.ts` for any hard-coded magic values
  - [ ] Move any remaining inline literals to `config.ts`:
    - Cone dimensions, colors, world bounds
    - Lighting intensities, positions, colors
    - Ground plane color, background color
    - Camera initial position, zoom limits
  - [ ] Ensure rendering modules receive config values as parameters or import from `config.ts`
  - [ ] SC: No numeric or color literals in rendering modules except mathematical constants (`Math.PI`, `0`, `-1`, etc.)

- [ ] **7.2 TypeScript compilation check**
  - [ ] Run `npx tsc --noEmit` — must exit with code 0, no errors
  - [ ] Verify all imports use `three/webgpu`, not `three`
  - [ ] Verify no use of deprecated `THREE.Clock` — must use `THREE.Timer`
  - [ ] Verify render loop uses `renderer.setAnimationLoop()`, not `requestAnimationFrame`

- [ ] **7.3 Production build verification**
  - [ ] Run `pnpm build` — must complete without errors, produce `dist/` directory
  - [ ] Run `pnpm preview` — serve the production build locally
  - [ ] Verify the scene renders identically to dev mode (ground plane, cones, camera controls)
  - [ ] Commit: `feat: finalize config extraction and production build`

- [ ] **7.4 Full verification walkthrough**
  - [ ] Execute the complete verification walkthrough from the slice design:
    1. `pnpm install && pnpm dev` — browser opens with dark background and green ground plane
    2. Console shows backend identification (`WebGPU` or `WebGL 2 (fallback)`)
    3. ~500 colored cones visible, varied directions, 2-3+ colors
    4. Mouse wheel zoom works smoothly
    5. Middle/right-click drag pan works
    6. Window resize maintains proportions
    7. `npx tsc --noEmit` exits 0
    8. `pnpm build && pnpm preview` shows same scene
  - [ ] If any step fails, fix and re-verify before marking complete
  - [ ] Final commit: `feat: complete slice 100 — project scaffold and rendering core`
