---
docType: slice-design
slice: camera-modes-and-navigation
project: migratory-viewer
parent: user/architecture/100-slices.viewer-foundation.md
dependencies: [100-project-scaffold-and-rendering-core, 105-hud-and-status-panel, 108-camera-constraints-and-pan]
interfaces: []
dateCreated: 20260416
dateUpdated: 20260416
status: complete
---

# Slice Design: Camera Modes and Navigation

## Parent Document
[100-slices.viewer-foundation.md](../architecture/100-slices.viewer-foundation.md) — Slice plan entry (104).

## Overview

Add a second camera mode — perspective with orbit controls — and a toggle between it and the existing orthographic top-down view. The toggle is driven by a prominent HUD button and a `V` keyboard shortcut. Perspective state (pitch, yaw, dolly, orbit target) persists across toggles within a session; double-clicking the HUD button resets perspective to its default framing.

This slice is deliberately narrower than the original 104 entry in the slice plan. Follow-cam and the minimap are deferred; they are independent features and can land as later slices (e.g. 104b, 104c) without disturbing the work here.

## Value

Ortho is great for reading world state at a glance but kills depth perception, which matters once terrain (102) arrives. Perspective lets the user actually see the world as 3D. Having both modes one click apart means the user picks the right tool for the task without committing to either.

The HUD button doubles as a mode indicator — the label always reads what clicking will *do*, so there is never ambiguity about which mode you are currently in.

## Technical Scope

**Included:**

- Perspective camera creation, sized to the world's bounding sphere at a sensible default pitch.
- Mode toggle: smooth animated transition (~0.5s) between ortho and perspective views.
- Orbit controls in perspective mode: right-click + drag to rotate around the orbit target, left-click + drag to pan the orbit target along the ground plane, wheel to dolly in/out.
- Persistent perspective state: pitch, yaw, dolly distance, and orbit target survive mode toggles.
- Double-click the HUD camera button resets perspective to its default framing.
- HUD button at the bottom of the existing HUD panel, wide, labeled with the *target* mode ("3D View" when in ortho, "2D View" when in perspective).
- `V` keyboard shortcut toggles camera mode (equivalent to clicking the button once).
- `camera-input.ts` gains `orbitStart`/`orbitMove`/`orbitEnd` and `orbitPanStart`/`orbitPanMove`/`orbitPanEnd` actions, wired behind the same action-abstraction layer established in 108.
- Constraints in perspective: pitch clamped to a configurable range (default 15°–85°), dolly distance clamped to min/max. No world-bounds clamp — free to look past world edges.
- Ortho behavior from 108 is unchanged when the active mode is ortho.

**Excluded (future slices or future work entries):**

- Follow-cam mode that tracks a selected entity or centroid — requires entity selection UI that does not exist.
- Minimap in the corner — independent feature; lands as its own slice later.
- Touch/gesture input beyond what macOS delivers as standard mouse events.
- FOV tuning UI (perspective FOV is a single config value; no runtime control).
- Inertia, easing, or momentum on orbit/pan motion beyond the one-shot mode transition.
- Saving perspective state across page reloads (session-only persistence).

## Current State

After slice 108, camera state and input are split across two files:

- [src/rendering/camera.ts](../../../src/rendering/camera.ts) — owns a single `OrthographicCamera`, exports `createCamera`, `resizeCameraToWorld`, `handleResize`, `updateCamera`, and action functions (`panStart`, `panMove`, `panEnd`, `zoomBy`). Module-level state: `currentZoom`, `panOrigin`, `cameraRef`, `activeWorldWidth`, `activeWorldHeight`.
- [src/input/camera-input.ts](../../../src/input/camera-input.ts) — binds DOM events to those actions. Currently: left-mouse → pan, wheel → zoom. No right-mouse or keyboard bindings.
- [src/main.ts](../../../src/main.ts) — calls `createCamera`, `initCameraInput`, and `updateCamera` once per frame.
- [src/ui/hud.ts](../../../src/ui/hud.ts) — owns the HUD DOM, keyboard binding for `H` (toggle HUD), and `updateHud` per frame.
- [src/config.ts](../../../src/config.ts) — `zoomMin`, `zoomMax`, `allowOutOfBoundsView` are the existing camera-related knobs.

The render loop uses `renderer.render(scene, camera)` with a single camera reference passed from `main.ts`. For mode switching, `main.ts` needs to pass *the current active camera* to the renderer each frame rather than a pinned reference.

## Proposed Solution

### Camera module refactor

Rename the internal concept from "the camera" to "the camera rig." The rig owns:

- An `OrthographicCamera` (pre-existing).
- A `PerspectiveCamera` (new).
- A `mode: 'ortho' | 'perspective'` discriminator.
- A shared **orbit target** — a world-space point in the XZ plane that both modes look at. In ortho, the camera position is directly above this point; in perspective, the camera is offset from it by pitch/yaw/distance.
- Perspective-specific state: `pitch`, `yaw`, `dollyDistance`.
- A `TransitionState | null` — when non-null, per-frame update interpolates between the two cameras for the duration of the transition.

Exported surface (from `camera.ts`):

```ts
export type CameraMode = 'ortho' | 'perspective';

export interface CameraRig {
  readonly mode: CameraMode;
  readonly activeCamera: THREE.Camera; // what the renderer uses
}

export function createCameraRig(worldWidth: number, worldHeight: number): CameraRig;
export function resizeRigToWorld(rig: CameraRig, w: number, h: number): void;
export function handleRigResize(rig: CameraRig): void;
export function updateRig(rig: CameraRig, deltaSeconds: number): void;

// Mode control
export function toggleCameraMode(rig: CameraRig): void;
export function resetPerspective(rig: CameraRig): void;
export function getCameraMode(rig: CameraRig): CameraMode;

// Actions (mode-aware — dispatch to the right handler internally)
export function panStart(rig: CameraRig, x: number, y: number): void;
export function panMove(rig: CameraRig, x: number, y: number): void;
export function panEnd(rig: CameraRig): void;

export function orbitStart(rig: CameraRig, x: number, y: number): void;
export function orbitMove(rig: CameraRig, x: number, y: number): void;
export function orbitEnd(rig: CameraRig): void;

export function zoomBy(rig: CameraRig, factor: number): void;
```

The existing `createCamera` / `resizeCameraToWorld` / `handleResize` / `updateCamera` names go away in favor of the rig-scoped versions. `main.ts` stores a `CameraRig` reference and passes `rig.activeCamera` to `renderer.render`.

The module-level globals (`cameraRef`, `currentZoom`, etc.) are replaced by fields on the rig instance. This is a good checkpoint to stop relying on module-level state.

### Perspective camera geometry

- FOV: 50° (config: `perspectiveFov`).
- Near/far: same pattern as ortho — far scales with world size.
- Default framing on first entry or reset:
  - `pitch = 55°` (measured from horizontal; 90° would be straight down, matching ortho)
  - `yaw = 0°` (camera looks along -Z toward the orbit target; pick one axis and document it)
  - `dollyDistance = 1.2 × max(worldWidth, worldHeight)` — enough to see the whole world comfortably
  - `orbitTarget = (worldWidth/2, 0, worldHeight/2)` — world center

Camera world position is computed from orbit target + spherical offset:

```
offsetX = dolly * cos(pitch) * sin(yaw)
offsetY = dolly * sin(pitch)
offsetZ = dolly * cos(pitch) * cos(yaw)
position = orbitTarget + (offsetX, offsetY, offsetZ)
lookAt(orbitTarget)
```

### Orbit (right-click drag)

- `orbitStart(x, y)` captures origin.
- `orbitMove(x, y)` computes `dx`, `dy` pixel deltas, converts to angle deltas:
  - `yaw -= dx * orbitSensitivity`
  - `pitch -= dy * orbitSensitivity`
  - `pitch` clamped to `[pitchMin, pitchMax]` (default 15°–85°, config).
  - `yaw` wraps freely (no clamp).
- Orbit target unchanged.
- Rebuild camera position + `lookAt(target)`.

Sensitivity: `orbitSensitivity = PI / (2 * windowHeight)` — so dragging from top to bottom of the window sweeps 90° of pitch. Clean, resolution-aware.

### Pan in perspective (left-click drag)

Translate the orbit target along the ground plane (y=0). One screen pixel at the orbit target's depth maps to one world unit:

```
worldPerPixelAtTarget = 2 * dolly * tan(fov/2) / windowHeight
target.x -= dx * worldPerPixelAtTarget * cos(yaw) + dy * worldPerPixelAtTarget * sin(yaw) * sin(pitch)
target.z += dx * worldPerPixelAtTarget * sin(yaw) - dy * worldPerPixelAtTarget * cos(yaw) * sin(pitch)
```

(Exact signs/axes settled during implementation against a quick visual test — the principle is: drag right moves the world right, drag up moves the world toward you, independent of current yaw.)

No clamp against world bounds in perspective — user can look past world edges freely.

### Dolly (wheel)

`zoomBy(rig, factor)` in perspective scales `dollyDistance` by `1/factor` (inverse of ortho zoom: scrolling up zooms in, matching ortho feel). Clamped to `[dollyMin, dollyMax]` (config: default `dollyMin = 0.05 * max(w,h)`, `dollyMax = 3.0 * max(w,h)`).

### Mode toggle animation

Transition animates over 500ms (config: `modeTransitionSeconds`, default 0.5). The render loop renders the *target* mode's camera, but during transition we lerp the visible camera's extrinsics to bridge the two framings:

- **Entering perspective from ortho**: construct the perspective camera at the current ortho framing's equivalent (pitch=90°, yaw=0, dolly chosen so frustum matches ortho's visible area at the orbit target), render the perspective camera from the start, and lerp pitch/dolly to the saved (or default) perspective state over the transition.
- **Entering ortho from perspective**: freeze the perspective camera's orbit target as the new ortho center, compute an ortho zoom that visually matches the perspective framing, then lerp pitch toward 90° on the perspective camera while fading in the ortho camera at the end of the transition.

Cleaner implementation: **always render the perspective camera**, and represent "ortho mode" as perspective at pitch=90° with a very narrow FOV and matching dolly. Rejected — messes up orthographic correctness (parallel lines, no foreshortening) and complicates the `zoomBy` math.

Chosen implementation: **two cameras, crossfade at the midpoint of the transition**. For the first half of the transition, render the source mode's camera while animating its visible parameters toward the target framing. At t=0.5, swap to rendering the target camera, initialized to match the mid-transition framing, and complete the animation on it. The swap point is chosen where both cameras produce nearly identical visible output, so the viewer sees no pop.

This is more code than an instant swap. If it turns out to look bad or takes too long to tune, fall back to instant swap and add animation later. Success criterion: no visible pop, no motion jitter, user perceives a smooth mode change. If not achievable in a reasonable attempt, ship with instant swap and flag as a polish followup.

### Persistent state

`CameraRig` fields `pitch`, `yaw`, `dollyDistance`, `orbitTarget` are *not* reset on `toggleCameraMode`. They are only reset by `resetPerspective(rig)`.

On first-ever entry to perspective (when `pitch === 0` sentinel or an explicit `hasBeenInitialized` flag), defaults are applied.

On `resizeRigToWorld` (new snapshot with different world bounds), the orbit target snaps to the new world center and `dollyDistance` clamps into the new valid range, but `pitch` and `yaw` are preserved.

### HUD integration

[src/ui/hud.ts](../../../src/ui/hud.ts) grows a new section at the bottom of the HUD panel:

- A `<button class="camera-mode-btn">` styled to span the HUD's content width.
- `createHud` registers `click` (toggle), `dblclick` (reset perspective — only active when in perspective mode), and the global `V` keydown.
- `createHud` now takes a `rig: CameraRig` parameter so the button can call `toggleCameraMode(rig)` and `resetPerspective(rig)` directly.
- `updateHud` writes the button label from `getCameraMode(rig)`:
  - `ortho` → button text `"3D View"`
  - `perspective` → button text `"2D View"`
  - Label only written when the mode changes (DOM-write guard, matching the pattern used for the connection dot).
- Button styling lives in [src/ui/hud.css](../../../src/ui/hud.css): block element, full panel width, visible affordance (border, hover state). `pointer-events: auto` on the button itself (the panel is `pointer-events: none` for canvas click-through; the button needs to override).

### Input bindings

[src/input/camera-input.ts](../../../src/input/camera-input.ts) gains:

- Right-mouse down/move/up → `orbitStart` / `orbitMove` / `orbitEnd`. Suppress the browser context menu on the canvas (`contextmenu` listener with `preventDefault`).
- Left-mouse handling is unchanged at the DOM level — it always calls `panStart`/`panMove`/`panEnd` on the rig, and the rig dispatches internally based on mode.
- Wheel handling unchanged — calls `zoomBy(rig, factor)`, rig dispatches internally.
- No `V` key binding in this module; the HUD owns it (consistent with `H` toggle for HUD visibility).

### Config additions

```ts
// camera modes
perspectiveFov: number;         // degrees, default 50
defaultPitch: number;           // degrees from horizontal, default 55
defaultYaw: number;             // degrees, default 0
pitchMin: number;               // default 15
pitchMax: number;               // default 85
dollyMinRatio: number;          // * max(w,h), default 0.05
dollyMaxRatio: number;          // * max(w,h), default 3.0
dollyDefaultRatio: number;      // * max(w,h), default 1.2
modeTransitionSeconds: number;  // default 0.5
```

## Interfaces

No new inter-slice interfaces. `ViewerState` is unchanged. `CameraRig` is internal to the viewer's rendering layer.

## Dependencies

- [100-project-scaffold-and-rendering-core](100-slice.project-scaffold-and-rendering-core.md) — complete.
- [105-hud-and-status-panel](105-slice.hud-and-status-panel.md) — complete. Supplies the HUD DOM to hang the mode button on.
- [108-camera-constraints-and-pan](108-slice.camera-constraints-and-pan.md) — complete. Supplies the action abstraction this slice extends.

External: none. No server-side changes.

## Risks

- **Transition animation complexity.** Two-camera crossfade is easy to describe and tricky to tune. Mitigation: ship with instant swap if the animation looks worse than no animation, and flag as a polish followup.
- **Right-click on macOS trackpads.** Standard macOS trackpad delivers right-click as two-finger tap (with default system settings). Users who have disabled secondary click won't have orbit — they can use the HUD toggle only, which is acceptable degradation. Document in the task file.
- **Perspective pan math sign errors.** Easy to invert an axis. Mitigation: manual test in both pitch extremes during implementation; catch via the manual walkthrough.
- **Module-level camera state migration.** Moving from module globals to a rig instance touches every caller of `camera.ts`. Mitigation: do the refactor as step 1 (rig with ortho-only, no perspective), verify parity with existing behavior, then add perspective. Ortho parity is easy to confirm: existing manual pan/zoom smoke test still passes.

## Success Criteria

- Toggle via HUD button works. Label reads "3D View" in ortho, "2D View" in perspective.
- `V` key toggles. Single key, no modifier.
- In perspective: right-drag orbits, left-drag pans the orbit target, wheel dollies in/out.
- Pitch clamped (can't flip past horizon or past straight-down).
- Dolly clamped (can't get stuck inside geometry or zoom infinitely far out).
- Toggling back and forth returns to the same perspective framing (persistence).
- Double-click button in perspective mode resets to default framing.
- Mode transition is smooth (or, if instant-swap fallback shipped, clearly flagged in devlog).
- Ortho mode behavior from slice 108 is unchanged — pan clamp, zoom-fit clamp, wheel zoom all still work.
- No regressions in HUD (connection dot, FPS, TPS, profile legend all still update).
- All existing tests pass. TypeScript clean.

## Manual Walkthrough

1. Start viewer. Verify HUD shows "3D View" button at the bottom. Current mode is ortho.
2. Click the button. Camera animates smoothly into perspective. Button label changes to "2D View."
3. Right-drag: camera orbits around world center.
4. Drag past pitch bounds: motion stops at the clamp, no flip-over.
5. Left-drag: the scene slides under the camera — orbit target moves along ground plane.
6. Wheel up: camera dollies closer. Wheel down: pulls back. Clamps at min/max.
7. Press `V`. Camera animates back to ortho at the current orbit target. Button reads "3D View."
8. Press `V` again. Perspective framing from step 6 is restored exactly.
9. Double-click the button. Perspective resets to default framing.
10. Ortho regression: pan with left-drag, zoom with wheel. World-fit clamp still works, world-bounds pan clamp still works.
11. Trigger a world snapshot with different dimensions (if feasible from test harness). Perspective pitch/yaw preserved, orbit target snapped to new world center, dolly clamped into new valid range.
