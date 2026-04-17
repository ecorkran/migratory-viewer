---
docType: slice-tasks
parent: user/slices/104-slice.camera-modes-and-navigation.md
project: migratory-viewer
dateCreated: 20260416
dateUpdated: 20260417
status: complete
dependencies:
  - slice 100 (Project Scaffold) — complete
  - slice 105 (HUD and Status Panel) — complete
  - slice 108 (Camera Constraints and Pan) — complete
currentProjectState: >
  Viewer renders live entities from a WebSocket snapshot. Camera is orthographic with
  pan (left-drag) and zoom (wheel) routed through the action layer established in slice 108.
  Camera state lives in module-level globals in src/rendering/camera.ts. The HUD panel
  (src/ui/hud.ts) shows connection status, FPS, TPS, entity count, and a profile legend.
  The render loop in main.ts passes a pinned OrthographicCamera reference to renderer.render().
---

# Slice Tasks: Camera Modes and Navigation

## Context Summary

Refactor the orthographic camera into a `CameraRig` that owns both an `OrthographicCamera` and a `PerspectiveCamera`, then add a perspective mode with orbit controls. The toggle lives in the HUD (prominent button at the bottom) and on the `V` key. Perspective state (pitch, yaw, dolly, orbit target) persists across toggles within a session; double-clicking the HUD button resets perspective to defaults.

Sequencing: the rig refactor (task 1) happens first in ortho-only form to prove parity before perspective is added. This minimizes the blast radius of the camera API change.

Relevant files:
- [src/rendering/camera.ts](../../../src/rendering/camera.ts) — will become the rig implementation
- [src/input/camera-input.ts](../../../src/input/camera-input.ts) — gains right-mouse orbit bindings
- [src/ui/hud.ts](../../../src/ui/hud.ts) — gains the mode toggle button
- [src/ui/hud.css](../../../src/ui/hud.css) — gains button styles
- [src/config.ts](../../../src/config.ts) — gains perspective-specific config fields
- [src/main.ts](../../../src/main.ts) — updated to use rig API
- Slice design: [104-slice.camera-modes-and-navigation.md](../slices/104-slice.camera-modes-and-navigation.md)

macOS note: macOS trackpads deliver right-click as a two-finger tap only when "Secondary click" is enabled in System Settings. Users with it disabled cannot orbit but can still use the HUD button — this is accepted degradation.

---

## Tasks

### 1. Config additions

- [x] **1.1 Add perspective and transition config fields to `config.ts`**
  - Add all new fields to [src/config.ts](../../../src/config.ts) alongside the existing flat structure. Do not introduce a camera sub-object.
  - Fields and defaults:
    ```
    perspectiveFov: 50         // degrees
    defaultPitch: 55           // degrees from horizontal
    defaultYaw: 0              // degrees
    pitchMin: 15               // degrees
    pitchMax: 85               // degrees
    dollyMinRatio: 0.05        // multiplied by max(worldWidth, worldHeight) at runtime
    dollyMaxRatio: 3.0
    dollyDefaultRatio: 1.2
    modeTransitionSeconds: 0.5
    ```
  - Success: `pnpm tsc --noEmit` clean; new fields reachable from `camera.ts` and `hud.ts` via existing import.

- [x] **1.2 Commit: config additions**
  - Semantic commit on the slice branch: `feat(config): add perspective camera config fields`.

### 2. CameraRig refactor (ortho-only, parity)

This task replaces module-level globals in `camera.ts` with a `CameraRig` instance and updates all call sites. No perspective mode yet — ortho behavior must be identical to pre-refactor at the end of this task.

- [x] **2.1 Define `CameraRig` interface and internal state shape**
  - In [src/rendering/camera.ts](../../../src/rendering/camera.ts), define and export:
    ```ts
    export type CameraMode = 'ortho' | 'perspective';
    export interface CameraRig {
      readonly mode: CameraMode;
      readonly activeCamera: THREE.Camera;
    }
    ```
  - Define a private `CameraRigState` type (not exported) that extends `CameraRig` with all mutable fields: `orthoCamera`, `perspCamera`, `orbitTarget` (THREE.Vector3), `pitch`, `yaw`, `dollyDistance`, `perspInitialized` (boolean), `currentZoom`, `panOrigin`, `orbitOrigin`, `activeWorldWidth`, `activeWorldHeight`, `transition` (TransitionState or null).
  - Define `TransitionState`:
    ```ts
    interface TransitionState {
      fromMode: CameraMode;
      elapsed: number;
      duration: number;
    }
    ```
  - Success: types compile, no existing exports changed yet.

- [x] **2.2 Add `createCameraRig` (replaces `createCamera`)**
  - Implement `export function createCameraRig(worldWidth: number, worldHeight: number): CameraRig`.
  - Creates the ortho camera with the same geometry as the current `createCamera` (aspect-based frustum, camY = max(w, h), lookAt world center).
  - Creates a PerspectiveCamera placeholder (use `config.perspectiveFov`, same near/far pattern; position TBD — filled in task 4).
  - `perspInitialized = false` — marks that perspective defaults have not yet been applied.
  - Returns the rig; does **not** register any DOM events (those live in `camera-input.ts`).
  - Keep `createCamera` temporarily as a thin wrapper calling `createCameraRig` so existing callers don't break until task 2.5.
  - Success: `pnpm tsc --noEmit` clean.

- [x] **2.3 Rewrite rig-scoped lifecycle functions**
  - Implement these exports, replacing the module-global versions:
    - `resizeRigToWorld(rig, w, h)` — mirrors `resizeCameraToWorld`, updates `activeWorldWidth/Height` and ortho frustum, clamps `dollyDistance` into the new valid range, snaps `orbitTarget` to world center.
    - `handleRigResize(rig)` — mirrors `handleResize`, recomputes ortho frustum on window resize.
    - `updateRig(rig, deltaSeconds)` — placeholder for animation; currently a no-op (animation added in task 5).
  - Keep old function names as thin wrappers until task 2.5. 
  - Success: TypeScript clean; ortho behavior unchanged.

- [x] **2.4 Rewrite rig-scoped action functions**
  - Implement these exports, all taking `rig: CameraRig` as first argument:
    - `panStart(rig, x, y)` — sets `rig.panOrigin`.
    - `panMove(rig, x, y)` — in ortho mode, applies existing pan math + clamp. In perspective mode (stubbed for now — a no-op or logs a warning).
    - `panEnd(rig)` — clears `rig.panOrigin`.
    - `orbitStart(rig, x, y)` — sets `rig.orbitOrigin` (stub).
    - `orbitMove(rig, x, y)` — stub no-op.
    - `orbitEnd(rig)` — clears `rig.orbitOrigin` (stub).
    - `zoomBy(rig, factor)` — in ortho mode, applies existing zoom math + clamp. In perspective mode, stubs dolly (no-op for now).
    - `getCameraMode(rig)` — returns `rig.mode`.
    - `toggleCameraMode(rig)` — stub that just returns (implemented in task 5).
    - `resetPerspective(rig)` — stub (implemented in task 4).
  - Success: TypeScript clean.

- [x] **2.5 Update `main.ts` to use rig API**
  - In [src/main.ts](../../../src/main.ts):
    - Replace `createCamera` with `createCameraRig`.
    - Replace `resizeCameraToWorld` with `resizeRigToWorld`.
    - Replace `handleResize` with `handleRigResize`.
    - Replace `updateCamera` with `updateRig(rig, delta)`.
    - Change `renderer.render(scene, camera)` to `renderer.render(scene, rig.activeCamera)`.
  - Pass `rig` instead of raw camera to `initCameraInput`.
  - Remove all old function imports from `camera.ts`.
  - Success: `pnpm dev` — viewer loads, ortho pan and zoom work identically to before.

- [x] **2.6 Test: ortho parity**
  - Run `pnpm tsc --noEmit` — clean.
  - Run `pnpm test` — all tests pass.
  - Manual: left-drag pans, wheel zooms, pan clamp and zoom-fit clamp still work. HUD still updates.

- [x] **2.7 Update `camera-input.ts` to accept rig**
  - Change `initCameraInput(canvas)` signature to `initCameraInput(canvas, rig)`.
  - Pass `rig` through to `panStart(rig, ...)`, `panMove(rig, ...)`, `panEnd(rig)`, `zoomBy(rig, ...)`.
  - Add right-mouse bindings:
    - `canvas.addEventListener('mousedown', ...)` — if `event.button === 2`: call `orbitStart(rig, ...)`, `event.preventDefault()`.
    - `window.addEventListener('mousemove', ...)` — call `orbitMove(rig, ...)` unconditionally (no-op when no orbit in progress).
    - `window.addEventListener('mouseup', ...)` — if `event.button === 2`: call `orbitEnd(rig)`.
    - `canvas.addEventListener('contextmenu', ...)` — `event.preventDefault()` to suppress browser context menu.
  - Success: TypeScript clean; right-drag does nothing visible (stub), left-drag and wheel unchanged.

- [x] **2.8 Commit: CameraRig refactor (ortho-only)**
  - Semantic commit: `refactor(camera): introduce CameraRig, migrate callers to rig API`.

### 3. HUD camera mode button

- [x] **3.1 Add camera mode button to HUD DOM**
  - In [src/ui/hud.ts](../../../src/ui/hud.ts):
    - Change `createHud()` signature to `createHud(rig: CameraRig)`.
    - Add a `<button class="camera-mode-btn">3D View</button>` element at the bottom of the HUD panel (below the existing profile section).
    - Register on the button:
      - `click` → `toggleCameraMode(rig)` (stub for now; button appears but has no visible effect until task 5).
      - `dblclick` → `resetPerspective(rig)` (stub).
    - Register on `window`:
      - `keydown` for `v` (lowercase, no modifier) → `toggleCameraMode(rig)`. Guard: skip if a form element is focused.
  - Store a reference to the button in `HudElements` interface (add `cameraModeBtn: HTMLButtonElement`).
  - Update `main.ts` call to `createHud(rig)` — pass the rig.
  - Success: button appears in HUD, TypeScript clean, `H` key still toggles HUD, `V` key logs no errors.

- [x] **3.2 Add button styles to `hud.css`**
  - In [src/ui/hud.css](../../../src/ui/hud.css), add styles for `.camera-mode-btn`:
    - `display: block; width: 100%` — spans the HUD panel width.
    - Visible affordance: matching border style, subtle hover background.
    - `pointer-events: auto` — overrides the panel's `pointer-events: none`.
    - `margin-top: 8px` — visual separation from the profile legend above.
  - Success: button is visually distinct, clickable, consistent with HUD aesthetic.

- [x] **3.3 Add label update to `updateHud`**
  - In `updateHud(hud, state, delta, rig)` — add `rig` parameter.
  - Read `getCameraMode(rig)` each frame. Only write to `hud.cameraModeBtn.textContent` when the mode has changed (use a `cachedMode` local or compare against the current button text).
    - `ortho` → `"3D View"`
    - `perspective` → `"2D View"`
  - Update the `main.ts` call to `updateHud(hud, viewerState, delta, rig)`.
  - Success: button label is correct on load ("3D View"); updates when mode changes (testable once task 5 is done).

- [x] **3.4 Test: HUD button visible**
  - `pnpm dev` — HUD shows "3D View" button at the bottom. Button is clickable (no JS errors). `V` key press produces no errors. HUD `H` toggle still works.

- [x] **3.5 Commit: HUD camera mode button**
  - Semantic commit: `feat(hud): add camera mode toggle button and V keybinding`.

### 4. Perspective camera implementation

- [x] **4.1 Implement `resetPerspective` and default framing**
  - In [src/rendering/camera.ts](../../../src/rendering/camera.ts), implement `resetPerspective(rig)`:
    - Set `pitch` to `config.defaultPitch` (in degrees; convert to radians internally with a helper `toRad`).
    - Set `yaw` to `config.defaultYaw`.
    - Set `dollyDistance` to `config.dollyDefaultRatio * max(activeWorldWidth, activeWorldHeight)`.
    - Set `orbitTarget` to `(activeWorldWidth/2, 0, activeWorldHeight/2)`.
    - Set `perspInitialized = true`.
    - Call an internal `applyPerspectiveCamera(rig)` helper that recomputes the perspective camera's world position from pitch/yaw/dolly/target and calls `lookAt(orbitTarget)`.
  - Implement `applyPerspectiveCamera(rig)`:
    ```
    offsetX = dolly * cos(pitch) * sin(yaw)
    offsetY = dolly * sin(pitch)
    offsetZ = dolly * cos(pitch) * cos(yaw)
    position = orbitTarget + offset
    perspCamera.position.set(position)
    perspCamera.lookAt(orbitTarget)
    perspCamera.updateProjectionMatrix()
    ```
  - Success: calling `resetPerspective` positions the perspective camera at a sensible view of the world.

- [x] **4.2 Test: perspective camera framing**
  - Temporarily force `rig.mode` to `'perspective'` and call `resetPerspective`. Verify in the browser that the world is visible from the expected angle (roughly 55° above ground, looking at world center).
  - Revert the mode override after confirming.

- [x] **4.3 Implement orbit action**
  - Implement `orbitStart(rig, x, y)` — store `orbitOrigin = { x, y }`.
  - Implement `orbitMove(rig, x, y)`:
    - If `orbitOrigin === null` or mode is not `'perspective'`: return.
    - `dx = x - orbitOrigin.x`, `dy = y - orbitOrigin.y`.
    - `sensitivity = Math.PI / (2 * window.innerHeight)`.
    - `yaw -= dx * sensitivity` (wraps freely, no clamp).
    - `pitch -= dy * sensitivity`, then clamp: `pitch = clamp(pitch, toRad(config.pitchMin), toRad(config.pitchMax))`.
    - Update `orbitOrigin = { x, y }`.
    - Call `applyPerspectiveCamera(rig)`.
  - Implement `orbitEnd(rig)` — clear `orbitOrigin`.
  - Success: in perspective mode (forced temporarily), right-drag rotates the view around the orbit target without flipping past pitch bounds.

- [x] **4.4 Test: orbit controls**
  - Force perspective mode. Right-drag orbits. Drag past the upper and lower pitch limits — motion stops at clamps, no horizon flip. Left-drag is a no-op (perspective pan not yet implemented).

- [x] **4.5 Implement perspective pan**
  - In `panMove(rig, x, y)`, implement the perspective branch:
    ```
    fovRad = toRad(config.perspectiveFov)
    worldPerPixel = 2 * dollyDistance * tan(fovRad / 2) / window.innerHeight
    target.x -= dx * worldPerPixel * cos(yaw) + dy * worldPerPixel * sin(yaw) * sin(pitch)
    target.z += dx * worldPerPixel * sin(yaw) - dy * worldPerPixel * cos(yaw) * sin(pitch)
    ```
    - Signs are a starting point; verify against the principle "drag right moves the world right" at 0° yaw and at 90° yaw. Adjust signs in the implementation if the visual test contradicts this.
    - Call `applyPerspectiveCamera(rig)` after mutating target.
  - Success: left-drag in perspective mode translates the scene under the camera.

- [x] **4.6 Test: perspective pan**
  - Force perspective mode. Left-drag — scene slides under camera in the dragged direction. Test at yaw=0 and after orbiting ~90° yaw to confirm it stays correct regardless of camera orientation.

- [x] **4.7 Implement dolly (perspective zoom)**
  - In `zoomBy(rig, factor)`, implement the perspective branch:
    - `dollyDistance = dollyDistance / factor` (scroll up = factor > 1 = zooms in = reduces dolly).
    - Clamp: `dollyDistance = clamp(dollyDistance, config.dollyMinRatio * maxWH, config.dollyMaxRatio * maxWH)`.
    - Call `applyPerspectiveCamera(rig)`.
  - Success: wheel scrolls in perspective mode; dolly reaches min/max and stops.

- [x] **4.8 Test: dolly clamps**
  - Force perspective mode. Scroll wheel to maximum zoom in — movement stops at `dollyMin`. Scroll out to maximum — stops at `dollyMax`. Scrolling past limits has no visual effect.

- [x] **4.9 Commit: perspective camera controls**
  - Semantic commit: `feat(camera): add perspective mode with orbit, pan, and dolly`.

### 5. Mode toggle and animation

- [x] **5.1 Implement instant mode toggle (no animation)**
  - Implement `toggleCameraMode(rig)`:
    - If transitioning, return (block double-tap during animation).
    - If `mode === 'ortho'`:
      - If `!perspInitialized`, call `resetPerspective(rig)`.
      - Set `mode = 'perspective'`.
      - `rig.activeCamera` now points to `rig.perspCamera`.
    - If `mode === 'perspective'`:
      - Set `mode = 'ortho'`.
      - `rig.activeCamera` now points to `rig.orthoCamera`.
    - Sync the new active camera's orbit target (ortho camera re-centers position above `orbitTarget`).
  - Success: clicking the HUD button toggles between modes. Entities visible in both. Button label updates.

- [x] **5.2 Test: instant toggle**
  - `pnpm dev`. Click "3D View" — switches to perspective, entities visible, button reads "2D View". Click again — back to ortho, button reads "3D View". `V` key also toggles. Double-click resets perspective framing.

- [x] **5.3 Implement animated transition**
  - Extend `toggleCameraMode(rig)` to set `rig.transition = { fromMode, elapsed: 0, duration: config.modeTransitionSeconds }` instead of snapping immediately.
  - Implement animation in `updateRig(rig, deltaSeconds)`:
    - If `transition === null`, return.
    - `t = elapsed / duration`, clamped to `[0, 1]`.
    - For ortho→perspective: render the perspective camera throughout; interpolate pitch from 90° toward `rig.pitch` using `lerp(PI/2, rig.pitch, t)`. Update `perspCamera` position via `applyPerspectiveCamera` using the lerped pitch.
    - For perspective→ortho: same idea — lerp pitch toward 90° while keeping orbit target fixed; at `t >= 0.5` switch `activeCamera` to ortho.
    - When `t >= 1.0`: clear `transition`, commit the final mode.
  - If animation looks wrong (pop, jitter), fall back to the instant swap from 5.1 and note it in the devlog. Do not spend more than one debugging iteration on it.
  - Success: smooth visual transition over ~0.5s, no perceived pop. Or instant swap flagged as intentional fallback.

- [x] **5.4 Test: animated transition**
  - Click toggle: observe smooth transition over ~0.5s. Toggle back: same. `V` key: same. During transition, clicking again has no effect (blocked).

- [x] **5.5 Commit: mode toggle and animation**
  - Semantic commit: `feat(camera): add perspective/ortho mode toggle with animated transition`.

### 6. Persistence and world-resize behavior

- [x] **6.1 Verify perspective state persists across toggles**
  - Enter perspective, orbit and dolly to a non-default framing. Toggle to ortho. Toggle back — perspective framing should be identical. No extra code needed if `toggleCameraMode` does not call `resetPerspective` (it should not).
  - Success: framing persists.

- [x] **6.2 Verify `resizeRigToWorld` behavior**
  - On world bounds change (new snapshot): `orbitTarget` snaps to new world center, `dollyDistance` clamped into new valid range, `pitch`/`yaw` preserved.
  - Confirm in `resizeRigToWorld` that these rules are implemented. Add clamping code if missing.
  - Success: switching world sizes does not blow up perspective state.

- [x] **6.3 Commit: persistence verification**
  - Only a commit if code changes were required in 6.2. Otherwise, note as confirmed in task file.

### 7. Manual verification

Run `pnpm dev` with a live server connection for all checks.

- [x] **7.1 Start in ortho**
  - Viewer loads. HUD shows "3D View" button at bottom. Mode is ortho. Existing pan and zoom work. HUD metrics update normally.

- [x] **7.2 Toggle to perspective**
  - Click "3D View" or press `V`. Transition is smooth (or instant swap, if flagged). Mode becomes perspective. Button reads "2D View". Entities visible.

- [x] **7.3 Orbit**
  - Right-drag: view rotates around orbit target. Dragging past upper/lower pitch limit stops at clamp; no horizon flip or gimbal lock artifact.

- [x] **7.4 Perspective pan**
  - Left-drag: scene slides in dragged direction. Test at default yaw and after orbiting ~90° — both orientations correct.

- [x] **7.5 Dolly**
  - Wheel up: camera moves closer. Wheel down: pulls back. Both stop at min/max limits.

- [x] **7.6 Toggle back to ortho**
  - Press `V`. Returns to ortho. Button reads "3D View". Pan and zoom-fit clamp still work.

- [x] **7.7 Persistence**
  - Enter perspective, orbit and dolly to a non-default framing. Toggle to ortho, toggle back to perspective. Framing is identical to where it was left.

- [x] **7.8 Double-click reset**
  - While in perspective, double-click the HUD button. Camera resets to default framing (55° pitch, world center, default dolly). In ortho mode, double-click is a no-op (no reset).

- [x] **7.9 Ortho regression**
  - In ortho: pan with left-drag, world-bounds clamp stops at edges. Wheel zoom, zoom-fit clamp stops at world-fit level. Behavior identical to slice 108.

- [x] **7.10 HUD regression**
  - In both modes, connection dot, FPS, TPS, entity count, and profile legend all update correctly.

- [x] **7.11 TypeScript and tests**
  - `pnpm tsc --noEmit` — clean.
  - `pnpm test` — all existing tests pass.

### 8. Finalization

- [x] **8.1 Update slice and task file status**
  - Mark [104-slice.camera-modes-and-navigation.md](../slices/104-slice.camera-modes-and-navigation.md) `status: complete`, bump `dateUpdated`.
  - Mark this task file `status: complete`, bump `dateUpdated`.
  - Mark slice 104 `[x]` in [100-slices.viewer-foundation.md](../architecture/100-slices.viewer-foundation.md).

- [x] **8.2 Commit: docs and slice completion**
  - Semantic commit: `docs: mark slice 104 complete`.

## Notes

- **No new unit tests planned.** Camera math is visual and small enough for the manual walkthrough. If `applyPerspectiveCamera` or the pan-math grows complex edge cases, add focused tests then.
- **Perspective pan signs.** The pan formula in 4.5 is a starting point — verify against actual behavior at different yaw values. Document any sign corrections in the commit message.
- **macOS right-click.** Users with "Secondary click" disabled on their trackpad cannot orbit. The HUD button is the full-featured fallback for all input.
- **Transition fallback.** If the crossfade animation cannot be tuned to look clean, ship instant swap and note it in the devlog. Do not block the slice on animation polish.
