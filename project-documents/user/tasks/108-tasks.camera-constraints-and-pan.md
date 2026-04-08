---
docType: slice-tasks
parent: user/slices/108-slice.camera-constraints-and-pan.md
project: migratory-viewer
dateCreated: 20260408
dateUpdated: 20260408
status: not_started
dependencies:
  - slice 100 (Project Scaffold) — complete
  - slice 101 (WebSocket Consumer and Live Entity Rendering) — complete
currentProjectState: >
  Viewer renders live entities from a WebSocket snapshot. Camera is orthographic with
  wheel zoom to center and middle/right-click pan. No world-bounds clamping. DOM event
  handlers are registered inside createCamera in src/rendering/camera.ts. No src/input
  directory yet.
---

# Slice Tasks: Camera Constraints and Pan

## Context Summary

Add world-bounds clamping to the orthographic camera (zoom-out capped at world-fit; pan edges cannot cross world bounds) and move all DOM event binding out of `camera.ts` into a new `src/input/camera-input.ts` module. Pan input changes from middle/right-click to left-click. Wheel zoom is rebindable through the same input layer. A single `config.allowOutOfBoundsView` flag disables both clamps as a debug escape hatch.

Key architectural shift: `camera.ts` becomes DOM-free. It exposes action functions (`panStart`, `panMove`, `panEnd`, `zoomBy`) that `camera-input.ts` calls in response to raw events. All clamp math lives in one internal helper `clampCameraToWorld` called from every path that mutates camera position or frustum.

Relevant files:
- [src/rendering/camera.ts](../../../src/rendering/camera.ts) — existing camera module (will be stripped of DOM code and extended with action API + clamp).
- [src/config.ts](../../../src/config.ts) — add `allowOutOfBoundsView: false`.
- [src/main.ts](../../../src/main.ts) — add `initCameraInput(canvas)` call.
- [src/input/camera-input.ts](../../../src/input/camera-input.ts) — new file.
- Slice design: [108-slice.camera-constraints-and-pan.md](../slices/108-slice.camera-constraints-and-pan.md) — canonical reference for clamp math and API shape.

## Tasks

### 1. Config and module scaffolding

- [ ] **1.1 Add `allowOutOfBoundsView` to config**
  - Add a single flat field `allowOutOfBoundsView: false` to [src/config.ts](../../../src/config.ts) alongside existing fields.
  - Inline comment: `// debug: disable camera zoom/pan clamps (pan outside world, zoom past world-fit)`.
  - Keep the existing flat config shape; do **not** introduce a `camera` sub-object.
  - Success: `config.allowOutOfBoundsView` is reachable from `camera.ts` via the existing `import config from '../config.ts'`.

- [ ] **1.2 Create `src/input/` directory and empty `camera-input.ts`**
  - Create directory `src/input/`.
  - Create file `src/input/camera-input.ts` with a single exported stub: `export function initCameraInput(_canvas: HTMLCanvasElement): void {}`.
  - File header comment: one line explaining this module owns all DOM event binding for the camera.
  - Success: `pnpm tsc --noEmit` clean; file compiles with the stub.

- [ ] **1.3 Commit: scaffolding**
  - Semantic commit on the slice branch: `chore(camera): scaffold input module and out-of-bounds-view flag`.
  - Include `src/config.ts` and `src/input/camera-input.ts`.

### 2. Camera action API in `camera.ts`

Subtasks 2.x extend `camera.ts` with the action API and clamp helper **without removing the existing DOM handlers yet**. Removal happens in task 4 after `camera-input.ts` is wired in, so the viewer keeps working at every step.

- [ ] **2.1 Add `clampCameraToWorld` internal helper**
  - Add a module-private function `clampCameraToWorld(camera: THREE.OrthographicCamera): void` in [camera.ts](../../../src/rendering/camera.ts).
  - Requires access to active world width + height. The module already holds `activeWorldHeight`; add a parallel `activeWorldWidth` module variable, populated everywhere `activeWorldHeight` is set (`createCamera` and `resizeCameraToWorld`).
  - Behavior:
    - Early return if `config.allowOutOfBoundsView` is true.
    - Compute `fw = camera.right - camera.left`, `fh = camera.top - camera.bottom`.
    - If `fw >= activeWorldWidth`, force `camera.position.x = activeWorldWidth / 2`; otherwise clamp `camera.position.x` to `[fw/2, activeWorldWidth - fw/2]`.
    - Same for Z axis against `activeWorldHeight`.
    - Call `camera.lookAt(camera.position.x, 0, camera.position.z)` to keep the camera looking straight down after position mutation.
  - Success: function exists, is not yet called from anywhere (wired up in later subtasks), TypeScript clean.

- [ ] **2.2 Add zoom-fit computation helper**
  - Add module-private `computeZoomFit(): number` in [camera.ts](../../../src/rendering/camera.ts).
  - Formula (see slice design §Clamp math):
    ```
    aspect = window.innerWidth / window.innerHeight
    zoomFit = min(
      activeWorldWidth / (activeWorldHeight * aspect),
      activeWorldHeight / activeWorldHeight,   // = 1 on the limiting axis
    )
    ```
    Practical form: the smallest `currentZoom` such that `(activeWorldHeight/currentZoom) <= activeWorldHeight` **and** `(activeWorldHeight/currentZoom)*aspect <= activeWorldWidth`. Solve for `currentZoom`:
    ```
    zoomFit = max(1, (activeWorldHeight * aspect) / activeWorldWidth)
    ```
    Double-check against both orientations (wide-world vs tall-world, wide-window vs tall-window) before committing.
  - Success: function returns a positive number; spot-check with a square world + square window (returns 1), a wide world + square window (returns < 1 means world wider than frustum at zoom=1 — which is already inside bounds; in that case the minimum `currentZoom` is whatever makes the **frustum** fit the **world**, not the other way). Re-derive carefully from the slice formula:
    ```
    frustumHeight = activeWorldHeight / currentZoom
    frustumWidth  = frustumHeight * aspect
    need: frustumHeight <= activeWorldHeight AND frustumWidth <= activeWorldWidth
         currentZoom >= 1 AND currentZoom >= (activeWorldHeight * aspect) / activeWorldWidth
    zoomFit = max(1, (activeWorldHeight * aspect) / activeWorldWidth)
    ```
  - **Note to implementer:** if your rederivation disagrees with the slice, stop and flag it — do not silently change the formula. The clamp must be validated against both axes before merging.

- [ ] **2.3 Add `panStart`, `panMove`, `panEnd` exported actions**
  - Replace the existing `isPanning` / `panStart` (Vector2) module state usage with a new internal `panOrigin: { x: number; y: number } | null = null` (rename the existing `panStart` Vector2 to avoid a name collision with the new exported function).
  - Implement:
    - `export function panStart(screenX: number, screenY: number): void` — set `panOrigin = { x: screenX, y: screenY }`.
    - `export function panMove(screenX: number, screenY: number): void` — if `panOrigin === null || cameraRef === null`, return. Compute `dx`, `dy`, convert via the existing pixel→world math, mutate `cameraRef.position.x -= dx * worldPerPixelX; cameraRef.position.z -= dy * worldPerPixelY`, update `panOrigin`, then call `clampCameraToWorld(cameraRef)`.
    - `export function panEnd(): void` — set `panOrigin = null`.
  - Do **not** yet remove the legacy `onMouseDown`/`onMouseMove`/`onMouseUp` handlers. They will coexist for one task so the viewer keeps working.
  - Success: actions compile and, when called manually, translate the camera and clamp it.

- [ ] **2.4 Add `zoomBy` exported action**
  - `export function zoomBy(factor: number): void`.
  - Body mirrors the existing `onWheel` body but takes `factor` as argument instead of reading `event.deltaY`:
    1. Early return if `cameraRef === null`.
    2. `currentZoom = currentZoom * factor`.
    3. Clamp:
       - Always apply the upper bound: `currentZoom = min(config.zoomMax, currentZoom)`.
       - Apply the zoom-fit lower bound **only when** `config.allowOutOfBoundsView` is false: `currentZoom = max(computeZoomFit(), currentZoom)`. When the flag is true, skip this lower bound so the user can zoom out past world-fit for debugging (mirrors `clampCameraToWorld` being a no-op in the same mode).
       - Drop the old `config.zoomMin` floor — `zoomFit` supersedes it when the flag is false, and the flag-on path deliberately has no floor. If `zoomMin` is still referenced elsewhere, leave the config field alone but stop using it here.
    4. Recompute frustum from `activeWorldHeight / currentZoom * aspect`, write `camera.left/right/top/bottom`, call `updateProjectionMatrix()`.
    5. Call `clampCameraToWorld(cameraRef)` to re-clamp the center in case the frustum grew.
  - Do **not** yet remove the legacy `onWheel` handler.
  - Success: calling `zoomBy(1.1)` zooms in one step; calling `zoomBy(0.9)` zooms out until clamped at `zoomFit`.

- [ ] **2.5 Call `clampCameraToWorld` from `handleResize` and `resizeCameraToWorld`**
  - In [camera.ts](../../../src/rendering/camera.ts) `handleResize`: after `camera.updateProjectionMatrix()`, also re-evaluate `currentZoom` against the new `computeZoomFit()` (snap up if below), recompute the frustum, then call `clampCameraToWorld(camera)`. This prevents drift when the user resizes the window after panning or zooming.
  - In `resizeCameraToWorld`: after the existing body, call `clampCameraToWorld(camera)` as a safety net for edge-case world dimensions.
  - Success: resizing the window while panned keeps the camera inside world bounds; a world-bounds change from the server still produces a centered, correctly framed view.

- [ ] **2.6 Commit: camera action API**
  - Semantic commit: `feat(camera): add pan/zoom action API and world-bounds clamp`.
  - Include `src/rendering/camera.ts`. Legacy DOM handlers still present and working at this point — the commit is safe to ship in isolation.

### 3. `camera-input.ts` wiring

- [ ] **3.1 Implement `initCameraInput`**
  - In [src/input/camera-input.ts](../../../src/input/camera-input.ts), import action functions from `../rendering/camera.ts`: `panStart`, `panMove`, `panEnd`, `zoomBy`.
  - Implement `initCameraInput(canvas: HTMLCanvasElement): void`:
    - `canvas.addEventListener('mousedown', ...)` — if `event.button !== 0`, return. Call `panStart(event.clientX, event.clientY)` and `event.preventDefault()`.
    - `window.addEventListener('mousemove', ...)` — call `panMove(event.clientX, event.clientY)` unconditionally (the action is a no-op when no pan is in progress).
    - `window.addEventListener('mouseup', ...)` — if `event.button !== 0`, return. Call `panEnd()`.
    - `canvas.addEventListener('wheel', ...)` — call `event.preventDefault()`, then `zoomBy(event.deltaY > 0 ? 0.9 : 1.1)`. Register with `{ passive: false }`.
  - No `contextmenu` handler — right-click is no longer used for panning so there is nothing to suppress.
  - Success: `pnpm tsc --noEmit` clean. Manual test deferred to task 4.

- [ ] **3.2 Call `initCameraInput` from `main.ts`**
  - In [src/main.ts](../../../src/main.ts), after `createCamera(...)` returns and the canvas reference is available, call `initCameraInput(canvas)`.
  - Import path: `import { initCameraInput } from './input/camera-input.ts'`.
  - The existing `document.getElementById('three-canvas')` (or equivalent) should be reused; pass the same element `camera.ts` currently looks up.
  - Success: viewer still builds and runs. Left-click drag now pans (via the new path). Wheel still zooms (via the new path, in parallel with the old handler that we haven't removed yet — the duplication is temporary and harmless because both end up calling the same camera state).

  - **Do not commit yet.** Task 3 ends in a knowingly-broken intermediate state (duplicate handlers cause doubled pan distance). Task 4 immediately removes the legacy path; both tasks ship in one commit.

### 4. Remove legacy DOM handlers from `camera.ts`

- [ ] **4.1 Strip DOM event registration from `createCamera`**
  - Remove the entire `const canvas = document.getElementById('three-canvas'); if (canvas) { ... }` block from `createCamera` in [camera.ts](../../../src/rendering/camera.ts).
  - Remove the old `onWheel`, `onMouseDown`, `onMouseMove`, `onMouseUp` function definitions.
  - Remove the `contextmenu` listener registration.
  - Keep `cameraRef`, `currentZoom`, `activeWorldWidth`, `activeWorldHeight`, and all action/lifecycle exports.
  - After this subtask, `camera.ts` should contain zero `addEventListener` calls and zero references to `WheelEvent` or `MouseEvent`.
  - Success: `pnpm tsc --noEmit` clean; `pnpm test` passes; the viewer runs and pan + zoom still work — now exclusively through the `camera-input.ts` path.

- [ ] **4.2 Clean up unused imports and fields**
  - Remove the `import` of `THREE.Vector2` if it's no longer used after the `panStart` Vector2 → `panOrigin` object rename.
  - Remove the legacy `isPanning` boolean if it's no longer referenced.
  - Confirm no dead code remains in `camera.ts`.
  - Success: `pnpm tsc --noEmit` clean with `noUnusedLocals` and `noUnusedParameters` if enabled; no ESLint warnings on the file.

- [ ] **4.3 Commit: wire input layer and remove legacy handlers**
  - Semantic commit: `refactor(camera): route input through camera-input module`.
  - Include `src/input/camera-input.ts`, `src/rendering/camera.ts`, and `src/main.ts`. This is a single atomic change — the viewer is fully functional before and after, with no intermediate broken state committed.

### 5. Manual verification

Follows the Verification Walkthrough in [108-slice.camera-constraints-and-pan.md](../slices/108-slice.camera-constraints-and-pan.md). Run `pnpm dev` with a connected world server providing at least one snapshot before running through the checks.

- [ ] **5.1 Baseline**
  - Viewer loads, entities render, initial view is framed on the world. No console errors.

- [ ] **5.2 Left-click pan works**
  - Left-click-drag pans the camera. The world feature under the cursor stays approximately under the cursor during the drag. Release ends the pan cleanly.

- [ ] **5.3 Other mouse buttons do not pan**
  - Middle-click drag: nothing happens.
  - Right-click: default browser context menu appears (or the canvas default — either is acceptable). No pan.

- [ ] **5.4 Pan clamp — edges**
  - Zoom in a couple of wheel steps. Drag hard toward each of the four world edges in turn. The camera stops at each edge; the frustum never reveals area outside `[0, W] × [0, H]`.

- [ ] **5.5 Zoom-out clamp**
  - Scroll wheel down repeatedly from any zoom. Zooming out stops at the level where the frustum exactly frames the world. Further wheel-down does nothing visible.

- [ ] **5.6 Pan resets at max zoom-out**
  - Zoom in, pan off-center, then zoom all the way out. By the last zoom-out step the camera is centered on world center. No special reset was needed — this falls out of the clamp.

- [ ] **5.7 Window resize while panned**
  - Pan off-center at medium zoom. Resize the browser window smaller (and narrower). Camera stays inside world bounds after resize. Resize larger: same check.

- [ ] **5.8 World bounds change**
  - If the server supports reconfiguring world size across restarts (or a test scenario does), reconnect with a different `worldWidth` / `worldHeight`. Camera recenters, zoom resets, new clamp boundaries are active — panning immediately clamps to the new bounds.

- [ ] **5.9 Debug escape hatch**
  - Set `allowOutOfBoundsView: true` in [src/config.ts](../../../src/config.ts); reload. Repeat 5.4 and 5.5: pan can now push the frustum outside world bounds; wheel can zoom past the world-fit level (empty area visible around the world).
  - Set back to `false`; confirm clamps are active again.

- [ ] **5.10 TypeScript + existing tests**
  - `pnpm tsc --noEmit` clean.
  - `pnpm test` — all existing tests still pass (no new tests required for this slice; clamp math is small enough to validate manually and by the walkthrough above).

### 6. Finalization

- [ ] **6.1 Update status and dates**
  - Mark [108-slice.camera-constraints-and-pan.md](../slices/108-slice.camera-constraints-and-pan.md) `status: complete`, bump `dateUpdated`.
  - Mark this task file `status: complete`, bump `dateUpdated`.
  - Check off slice 108 in [100-slices.viewer-foundation.md](../architecture/100-slices.viewer-foundation.md).

- [ ] **6.2 Commit: docs and slice completion**
  - Semantic commit: `docs: mark slice 108 complete`.
  - Include only the updated slice/task/arch doc files. Code commits already happened in 1.3, 2.6, and 4.3.

## Notes

- **No new unit tests planned.** The clamp math is small, the behavior is visual, and the verification walkthrough covers it end-to-end. If `clampCameraToWorld` or `computeZoomFit` become non-trivial during implementation (e.g. additional axis handling, aspect edge cases), add focused unit tests at that point — do not pre-emptively write them.
- **Zoom-fit formula derivation.** Task 2.2 deliberately walks through the derivation in comments because it's the one piece of the slice where a silent math error would produce a plausible-looking but wrong clamp. Re-derive rather than copy.
- **Temporary duplication in tasks 3.2 → 4.1.** During that window, both the old `camera.ts` handlers and the new `camera-input.ts` handlers are live simultaneously. This is intentional: it lets each subtask be independently verifiable. The old handlers read the same `currentZoom` / `cameraRef` module state, so two identical inputs just apply the same update twice — pan distance doubles briefly. Do not leave this in place across more than one commit; task 4.1 removes it.
