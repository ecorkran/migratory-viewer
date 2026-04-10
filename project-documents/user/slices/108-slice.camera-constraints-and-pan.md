---
docType: slice-design
parent: user/architecture/100-slices.viewer-foundation.md
project: migratory-viewer
dateCreated: 20260408
dateUpdated: 20260410
status: complete
---

# Slice Design: Camera Constraints and Pan

## Parent Document
[100-slices.viewer-foundation.md](../architecture/100-slices.viewer-foundation.md) — Slice plan entry (108).

## Summary

Constrain the orthographic camera to the world bounds and replace the current middle/right-click pan with a left-click-drag pan routed through a thin input-action abstraction. Fully zooming out resets any pan by natural consequence of the clamp. A single `allowOutOfBoundsView` config flag disables both clamps as a debug escape hatch.

## Goals

- Zoom-out is capped at the level where the camera frustum exactly frames the world (world-fit zoom).
- Pan is clamped so the frustum edges cannot cross world bounds.
- Left-click + drag pans the camera; drag distance scales so one screen pixel = one world unit at the current zoom (already true in the existing implementation).
- Input is routed through a small action layer so rebinding to other inputs (middle-click, modifiers, gamepad, macOS three-finger drag) is a wiring change, not a rewrite.
- `config.allowOutOfBoundsView` (default `false`) disables both zoom and pan clamps.
- Existing zoom-to-center wheel behavior and `resizeCameraToWorld` semantics are preserved.

## Non-goals

- No zoom-in clamp — unbounded zoom-in remains.
- No inertia, smoothing, easing, or animated pan.
- No pan-speed tuning knob. One-pixel-to-one-world-unit is exact and needs no config.
- No perspective mode, orbit, follow-cam, or minimap — those live in the future (104) slice.
- No touch/gesture handling beyond what macOS already delivers as normal mouse events.
- No cursor-style changes or visual pan indicator (can be added later if useful).

## Current State

[src/rendering/camera.ts](../../../src/rendering/camera.ts) already contains:

- `createCamera(w, h)` — builds an orthographic camera, registers canvas + window input listeners.
- `resizeCameraToWorld(camera, w, h)` — recenters and rescales on world-bounds change, resets `currentZoom = 1`.
- `handleResize(camera)` — updates frustum on window resize.
- `onWheel` — zoom to center, clamped by `config.zoomMin` / `config.zoomMax`.
- `onMouseDown` / `onMouseMove` / `onMouseUp` — **middle/right-click** pan (buttons 1 and 2). Drag translates camera X/Z by `dx * worldPerPixelX`, `dy * worldPerPixelY`. No clamping.

This slice replaces the pan trigger and adds the clamps. The existing pixel-to-world math is correct and is kept.

## Technical Design

### Module layout

New file: **[src/input/camera-input.ts](../../../src/input/camera-input.ts)** — thin input-action layer.

Responsibilities:

- Bind all camera-related DOM events (`mousedown`, `mousemove`, `mouseup`, `wheel`) on the canvas and window. No DOM event listeners remain in `camera.ts`.
- Translate raw events into camera actions: `panStart(x, y)`, `panMove(x, y)`, `panEnd()`, `zoomBy(factor)`.
- Own the "which button triggers pan" decision. Default: left-click (`event.button === 0`).
- Own the wheel → zoom-factor mapping (currently `deltaY > 0 ? 0.9 : 1.1`). This is the only place that reads `WheelEvent`.

Why separate: rebinding later (different button, modifier key, alternate input device, touch pinch) becomes a change in one small file rather than touching camera math. The camera module stays focused on frustum/position math and exposes a small action API that is input-source-agnostic.

**[src/rendering/camera.ts](../../../src/rendering/camera.ts)** changes:

- Remove all DOM event handlers (`onMouseDown`, `onMouseMove`, `onMouseUp`, `onWheel`, `contextmenu`) and the canvas/window `addEventListener` block in `createCamera`. After this slice, `camera.ts` contains no DOM code.
- Export action functions consumed by `camera-input.ts`:
  - `panStart(screenX: number, screenY: number): void` — records drag origin.
  - `panMove(screenX: number, screenY: number): void` — applies clamped translation delta, updates origin.
  - `panEnd(): void` — clears drag state.
  - `zoomBy(factor: number): void` — multiplies `currentZoom` by `factor`, clamps against `zoomFit`/`zoomMax`, recomputes frustum, and calls `clampCameraToWorld` so the center stays valid at the new zoom.
- Introduce an internal `clampCameraToWorld(camera)` helper used by `panMove`, `zoomBy`, `handleResize`, and `resizeCameraToWorld`. It is a no-op when `config.allowOutOfBoundsView` is true.
- The existing `contextmenu` suppression is no longer needed (we're not using right-click). Remove it.

### Clamp math

Let `fw = camera.right - camera.left`, `fh = camera.top - camera.bottom` be the current frustum size in world units, and `W, H` be the active world dimensions. The camera looks straight down at `(camera.position.x, camera.position.z)`.

**Zoom-out ceiling (world-fit).** The largest frustum that still fits inside the world is the one where the frustum edges touch or are smaller than the world edges on both axes. Because the frustum aspect is driven by `window.innerWidth / window.innerHeight`, the limiting axis is whichever of `fw > W` or `fh > H` is hit first. The world-fit zoom is:

```
zoomFit = min(W / (worldHeight * aspect), H / worldHeight)
```

— i.e. the smallest `currentZoom` such that the frustum fits inside the world on both axes. Any `currentZoom < zoomFit` would make the frustum larger than the world on at least one axis, which is exactly the "zoom outside bounds" condition we reject.

Apply the clamp inside `zoomBy` (before computing the new frustum): `currentZoom = max(currentZoom, zoomFit)`. Keep the existing `config.zoomMax` cap. Remove or keep `config.zoomMin` — the new `zoomFit` clamp supersedes it in practice; I'll keep `zoomMin` as a hard floor guard and just let `zoomFit` be tighter when the world is smaller than the screen aspect would otherwise allow.

**Pan clamp (position).** With the camera centered at `(cx, _, cz)` looking down, the frustum covers the world rectangle `[cx - fw/2, cx + fw/2] × [cz - fh/2, cz + fh/2]`. To keep the frustum inside `[0, W] × [0, H]`:

```
cx clamped to [fw/2, W - fw/2]
cz clamped to [fh/2, H - fh/2]
```

If `fw >= W` (frustum wider than world on X), the only valid `cx` is `W/2`. Same for the Z axis. This means: **at the world-fit zoom level, the only valid center is the world center, so fully zooming out automatically resets any pan with no special-case code.** When `fw > W` or `fh > H` (only possible when `allowOutOfBoundsView` is true), the clamp is skipped.

Both clamps are gated by `config.allowOutOfBoundsView`. When true: no zoom clamp, no pan clamp.

### Window resize interaction

`handleResize` recomputes the frustum from `activeWorldHeight / currentZoom` and the new aspect. After updating the frustum, call `clampCameraToWorld` so (a) if `currentZoom` is now below the new `zoomFit`, it's snapped up, and (b) the camera center is re-clamped to the new frustum. This prevents the camera from drifting outside bounds when the user resizes the window after panning or zooming.

### `resizeCameraToWorld` interaction

Already sets `currentZoom = 1` and recenters at `(W/2, camY, H/2)`. That is guaranteed world-fit-or-tighter on any reasonable world, but we should still call `clampCameraToWorld` at the end for safety (e.g. if the server announces a world so small or so wide that `currentZoom = 1` is below `zoomFit`).

### Config additions

Single flat field in [src/config.ts](../../../src/config.ts):

```ts
allowOutOfBoundsView: false,  // debug: disable camera zoom/pan clamps
```

No `panSpeed`, no `camera` sub-object. Matches existing flat config shape.

### Input-action API (camera-input.ts)

```ts
// Pseudocode sketch — not final code
import { panStart, panMove, panEnd, zoomBy } from '../rendering/camera.ts';

export function initCameraInput(canvas: HTMLCanvasElement): void {
  canvas.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return;  // left-click only
    panStart(e.clientX, e.clientY);
    e.preventDefault();
  });
  window.addEventListener('mousemove', (e) => panMove(e.clientX, e.clientY));
  window.addEventListener('mouseup', (e) => {
    if (e.button !== 0) return;
    panEnd();
  });
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    zoomBy(e.deltaY > 0 ? 0.9 : 1.1);
  }, { passive: false });
}
```

Rebinding later = change the button check, add a modifier-key branch, or swap `deltaY` for a pinch gesture in this one function. The camera module never sees a DOM event.

### Call site changes

[src/main.ts](../../../src/main.ts) currently calls `createCamera(...)`. After this slice: still calls `createCamera(...)`, and additionally calls `initCameraInput(canvas)` after the canvas is available. `createCamera` no longer registers its own input listeners — all DOM event binding lives in `camera-input.ts`.

## Data Flow

```
pan:   mouse event → camera-input.ts → panStart/panMove/panEnd → camera.ts
                                                                  ├─ mutate position
                                                                  └─ clampCameraToWorld
zoom:  wheel event → camera-input.ts → zoomBy(factor) → camera.ts
                                                        ├─ update currentZoom (clamped to [zoomFit, zoomMax])
                                                        ├─ recompute frustum
                                                        └─ clampCameraToWorld
render loop: reads camera.position + camera projection (no change)
```

Both paths end in `clampCameraToWorld`, which is a no-op when `config.allowOutOfBoundsView` is true.

## Cross-slice Dependencies and Interfaces

- **Slice 100 (Project Scaffold)** — provides the camera module and canvas. Already complete.
- **Slice 101 (WebSocket Consumer)** — provides `resizeCameraToWorld` call site via `main.ts` render loop on world-bounds change. This slice adds a final `clampCameraToWorld` to that path; no interface change.
- **Future slice 104 (Camera Modes and Navigation)** — this slice is a prerequisite subset of 104. When 104 is picked up, note that its orthographic pan/zoom requirements are already met and should not be re-done; 104 adds perspective mode, orbit, follow-cam, and minimap on top. Record this in the 104 design when it begins.

No changes to rendering, terrain, entities, connection, or state modules.

## Success Criteria

1. Left-click + drag on the canvas pans the camera. The cursor-under-world-point tracks the drag (one screen pixel = one world unit at current zoom).
2. Middle-click and right-click no longer pan. Right-click shows the default browser context menu (or nothing, per canvas default).
3. Mouse wheel zooms toward world center (unchanged behavior).
4. Zooming out is capped at the world-fit level: further wheel-down input has no effect once the frustum frames the world.
5. At max zoom-out, any pan offset is gone — the camera is centered on the world center. No manual reset code path; this falls out of the pan clamp.
6. Panning near a world edge stops at the edge — the frustum never shows area outside `[0, W] × [0, H]`.
7. Resizing the browser window while zoomed or panned keeps the camera within world bounds (no drift outside).
8. When the server announces new world bounds (different snapshot `worldWidth`/`worldHeight`), the camera recenters, resets zoom, and the new clamp boundaries are active immediately.
9. Setting `config.allowOutOfBoundsView = true` disables both clamps: the user can zoom out past the world-fit level and pan the camera so the frustum extends outside world bounds, for debugging.
10. No regressions in [src/rendering/camera.ts](../../../src/rendering/camera.ts) responsibilities: frustum math, `handleResize`, `resizeCameraToWorld`, and wheel zoom continue to work.
11. The camera module contains no DOM event listeners. All mouse and wheel binding lives in [src/input/camera-input.ts](../../../src/input/camera-input.ts); `camera.ts` exposes only action functions (`panStart`, `panMove`, `panEnd`, `zoomBy`) and the existing lifecycle functions.

## Verification Walkthrough

Prereqs: world server running, viewer connected, at least one snapshot received so entities are visible.

1. **Baseline.** `pnpm dev`, open the viewer in a browser. Confirm entities render and the view is framed on the world. **Verified:** entities render, world framed. On a wide window the world appears centered with black/background bars on the sides (expected — frustum is height-based).
2. **Pan — left-click.** Left-click and drag across the canvas. The world should translate under the cursor so a feature you click stays roughly under the cursor as you drag. Release. Position stays put. **Verified.**
3. **Pan does not trigger on other buttons.** Middle-click drag: nothing happens. Right-click: default context menu appears (or nothing); no pan. **Verified.**
4. **Pan clamp — edges.** Zoom in a couple of steps (wheel up) so the frustum is smaller than the world. Left-click-drag hard in one direction; the camera stops when the frustum edge reaches the world edge. Drag in the opposite direction: the opposite edge stops at the opposite world boundary. Repeat on both axes. **Verified.**
5. **Zoom-out clamp.** From any zoom level, scroll the wheel down repeatedly. Zooming out stops at zoom=1 where the full world height fills the frustum. Further wheel-down does nothing visible. **Verified.** Note: on a wide window, horizontal overflow beyond world bounds is visible at max zoom-out; this is by design (height-based frustum).
6. **Pan resets at max zoom-out.** Zoom in, pan somewhere off-center, then zoom all the way out. At the last zoom-out step, the camera snaps/ends up centered on the world center. There should be no jump that is perceptibly wrong — only the forced reset as the clamp tightens. **Verified.**
7. **Window resize while panned.** Pan off-center at medium zoom. Resize the browser window smaller (especially narrower). The camera should stay inside world bounds after resize; no visible region outside `[0, W] × [0, H]`. Resize larger: same check. **Verified.**
8. **World bounds change.** With the server configured to change world size across restarts (or using a test scenario), reconnect and receive a snapshot with different `worldWidth` / `worldHeight`. Camera recenters, zoom resets, and the new clamp is active (panning clamps to the new bounds). **Not tested** — requires server reconfiguration; deferred.
9. **Debug escape hatch.** Set `allowOutOfBoundsView: true` in [src/config.ts](../../../src/config.ts), reload. Repeat steps 4 and 5: pan should now be able to push the frustum outside the world, and zoom-out should be able to go past world-fit (revealing empty area around the world). Set back to `false` and confirm clamps are active again. **Not tested** — deferred to avoid config churn during verification.
10. **TypeScript + tests.** `pnpm tsc --noEmit` clean. `pnpm test` — existing 29 tests still pass. **Verified:** 4 test files, 29 tests, all passing.

### Caveats

- **WebGPU buffer-in-use on refresh (pre-existing).** Page refresh intermittently causes `"Buffer (unlabeled) used in submit while destroyed"` WebGPU errors, resulting in a blank canvas. Root cause: GPU buffers from the previous page load are garbage collected while the new page's renderer is still submitting commands. Geometry disposal was deferred to `requestAnimationFrame` to reduce frequency, but the issue persists at the browser/Three.js WebGPU backend level. Tracked for separate investigation — not caused by slice 108 changes. WebGL 2 fallback (`forceWebGL: true` on `WebGPURenderer`) was attempted but renders blank; needs separate debugging.

## Risks

- **Zoom-to-center feel at the clamp.** At the world-fit zoom level, further wheel-down becomes a no-op, which can feel like the wheel is broken if the user doesn't realize they're at max zoom-out. Low risk; the visual framing makes it obvious. A future HUD indicator could show "max zoom-out" but is out of scope.
- **Aspect-driven limiting axis.** `zoomFit` depends on window aspect. Very wide or very tall windows may make one axis the binding constraint. The math handles this correctly, but it's worth eyeballing during window-resize testing (step 7).

## Effort

2/5. Small, localized, mostly math. No new dependencies, no protocol work.
