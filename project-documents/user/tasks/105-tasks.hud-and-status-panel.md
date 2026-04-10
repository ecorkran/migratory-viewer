---
docType: tasks
slice: hud-and-status-panel
project: migratory-viewer
lld: user/slices/105-slice.hud-and-status-panel.md
dependencies:
  - slice 100 (Project Scaffold) — complete
  - slice 101 (WebSocket Consumer and Live Entity Rendering) — complete
  - slice 108 (Camera Constraints and Pan) — complete
projectState: >
  Viewer renders live entities from a WebSocket snapshot with orthographic camera,
  left-click-drag pan, world-bounds clamping, and zoom constraints. No UI overlay exists.
  The user has no way to see connection status, tick count, entity count, profile legend,
  or frame rate. ViewerState holds all needed data; this slice surfaces it in DOM.
dateCreated: 20260410
dateUpdated: 20260410
status: in_progress
---

# Slice Tasks: HUD and Status Panel

## Context Summary

- Working on slice 105 (HUD and Status Panel)
- Adds a vanilla-DOM heads-up display overlay showing connection status, tick counter, entity count, FPS, and profile legend with color swatches
- All data comes from existing `ViewerState` and the render loop's `THREE.Timer` delta — no new data sources, no protocol changes
- Two new files: `src/ui/hud.ts` and `src/ui/hud.css`
- One modification: `src/main.ts` to wire in `createHud()` and `updateHud()`
- HUD visibility toggles with `H` key; `pointer-events: none` so canvas pan works through HUD area
- No modifications to ViewerState, connection, camera, entities, or terrain modules
- Slice design: [105-slice.hud-and-status-panel.md](../slices/105-slice.hud-and-status-panel.md)

## Tasks

### 1. HUD styles

- [x] **1.1 Create `src/ui/hud.css`**
  - Create directory `src/ui/` if it does not exist.
  - Create `src/ui/hud.css` with all HUD styles as specified in the slice design § Styling:
    - `#hud` container: `position: fixed`, top-left corner (8px margin), `background: rgba(0, 0, 0, 0.6)`, `border-radius: 4px`, `padding: 8px 12px`, `pointer-events: none`, `z-index: 10`.
    - Font: `font-family: 'SF Mono', 'Fira Code', 'Cascadia Code', monospace`, `font-size: 12px`, `color: rgba(255, 255, 255, 0.85)`.
    - `.hud-section`: bottom border divider `1px solid rgba(255, 255, 255, 0.1)`, with small vertical padding. Last section has no bottom border.
    - `.hud-connection-dot`: `width: 8px`, `height: 8px`, `border-radius: 50%`, `display: inline-block`, `margin-right: 6px`, `vertical-align: middle`.
    - Connection dot color classes: `.dot-connected` (green, `#4caf50`), `.dot-connecting` (yellow, `#ffca28`), `.dot-reconnecting` (yellow, pulsing), `.dot-disconnected` (red, `#ef5350`).
    - `@keyframes hud-pulse` for the reconnecting dot — opacity oscillates between 1 and 0.4.
    - `.hud-color-swatch`: `width: 10px`, `height: 10px`, `display: inline-block`, `margin-right: 6px`, `vertical-align: middle`.
    - `.hud-profile-row`: small vertical spacing between rows.
  - [x] Success: file exists at `src/ui/hud.css` with all styles. No build errors when imported.

### 2. HUD module — DOM creation and `HudElements` interface

- [x] **2.1 Create `src/ui/hud.ts` with `HudElements` interface and `createHud()`**
  - Create `src/ui/hud.ts`. Import `./hud.css` at the top (Vite handles CSS imports).
  - Import `ViewerState` from `../types.ts` (type-only import).
  - Define and export `HudElements` interface with cached DOM references:
    - `container: HTMLDivElement` — the root `#hud` element
    - `connectionDot: HTMLSpanElement`
    - `connectionLabel: HTMLSpanElement`
    - `tickValue: HTMLSpanElement`
    - `entityCountValue: HTMLSpanElement`
    - `fpsValue: HTMLSpanElement`
    - `profileSection: HTMLDivElement` — container for dynamically rebuilt profile rows
  - Implement `export function createHud(): HudElements`:
    - Build the DOM tree programmatically as specified in slice design § DOM structure.
    - Append the root `<div id="hud">` to `document.body`.
    - Return the `HudElements` object with references to the updatable elements.
    - Initial values: connection label `"disconnected"`, dot class `dot-disconnected`, tick `0`, entities `0`, FPS `--`, profile section empty.
  - [x] Success: `pnpm tsc --noEmit` clean. `createHud()` is callable and returns a valid `HudElements`. No Three.js imports in this file.

### 3. HUD module — per-frame update

- [x] **3.1 Implement `updateHud()` — connection status, tick, entity count**
  - In `src/ui/hud.ts`, implement `export function updateHud(hud: HudElements, state: ViewerState, delta: number): void`.
  - **Connection status:** read `state.connectionStatus`. Update `hud.connectionLabel.textContent` to the status string. Update `hud.connectionDot.className` to the matching dot class (`dot-connected`, `dot-connecting`, `dot-reconnecting`, `dot-disconnected`). Only update the DOM if the value has changed from the previous frame (track with a module-level `lastConnectionStatus` variable to avoid unnecessary DOM writes).
  - **Tick:** set `hud.tickValue.textContent = String(state.currentTick)`.
  - **Entity count:** set `hud.entityCountValue.textContent = String(state.entityCount)`.
  - [x] Success: connection status, tick, and entity count update correctly when `updateHud` is called with different `ViewerState` values. TypeScript clean.

- [x] **3.2 Implement `updateHud()` — FPS counter**
  - Add a module-level `let smoothFps = 0` variable.
  - In `updateHud`, if `delta > 0`: compute `instantFps = 1 / delta`, then `smoothFps = smoothFps * 0.95 + instantFps * 0.05`. Set `hud.fpsValue.textContent = String(Math.round(smoothFps))`.
  - If `delta <= 0` (first frame or timer not started): display `--`.
  - [x] Success: FPS displays a smooth, stable integer. Does not jump erratically between frames.

- [x] **3.3 Implement `updateHud()` — profile legend**
  - Import `config` from `../config.ts`.
  - Add module-level cache: `let cachedEntityCount = -1` and `let cachedProfileRows: HTMLDivElement[] = []`.
  - In `updateHud`, check if `state.entityCount !== cachedEntityCount` (new snapshot arrived). If changed:
    1. Clear `hud.profileSection.innerHTML = ''`.
    2. If `state.profileIndices` is not null, count entities per profile index by iterating the `Int32Array`.
    3. For each distinct profile index (sorted ascending), create a `<div class="hud-profile-row">` containing:
       - A `<span class="hud-color-swatch">` with `style.backgroundColor` set to `#${config.profileColors[profileIndex].toString(16).padStart(6, '0')}` (fall back to a default gray if the index exceeds the palette length).
       - A text `<span>` with content `Profile {index}: {count}`.
    4. Append each row to `hud.profileSection`.
    5. Update `cachedEntityCount = state.entityCount`.
  - If entity count hasn't changed, skip the rebuild — cached rows remain in the DOM.
  - [x] Success: profile legend shows one row per distinct profile with correct color and count. Sum of all profile counts equals total entity count. Legend only rebuilds on snapshot change, not every frame.

### 4. HUD visibility toggle

- [x] **4.1 Add `H` key toggle**
  - In `src/ui/hud.ts`, inside `createHud()` (after the DOM is built), register a `document.addEventListener('keydown', ...)` handler:
    - If `event.key === 'h' || event.key === 'H'`: toggle `hud.container.style.display` between `''` and `'none'`.
    - Do not trigger if `event.target` is an input, textarea, or contenteditable element (future-proofing; currently no inputs exist).
  - The HUD starts visible (`display: ''`).
  - [x] Success: pressing `H` hides the HUD; pressing `H` again shows it. Works regardless of caps lock.

- [x] **4.2 Commit: HUD module**
  - Semantic commit: `feat(ui): add HUD overlay with status, stats, and profile legend`.
  - Include `src/ui/hud.ts` and `src/ui/hud.css`.

### 5. Wire HUD into render loop

- [x] **5.1 Integrate `createHud` and `updateHud` in `main.ts`**
  - In [src/main.ts](../../../src/main.ts):
    - Add imports: `import { createHud, updateHud } from './ui/hud.ts'`.
    - After existing setup (scene, camera, terrain, entities, connection), call `const hud = createHud()`.
    - Inside `renderer.setAnimationLoop`:
      - After `timer.update()`, get `const delta = timer.getDelta()`.
      - Call `updateHud(hud, viewerState, delta)` **before** the `if (viewerState.worldWidth === 0) return` early-return. This ensures the HUD is visible and shows connection status while waiting for the first snapshot.
      - The existing `timer.update()` call remains unchanged. `timer.getDelta()` is a new call to retrieve the delta time needed by the FPS counter.
  - [x] Success: HUD panel appears on page load. Connection status, tick, entity count, FPS, and profile legend all update in real time when connected to the server. HUD shows `connecting` / `disconnected` status before the first snapshot.

- [x] **5.2 Verify click-through**
  - With the HUD visible, left-click and drag starting from the HUD area. Pan should work normally — `pointer-events: none` on `#hud` allows mouse events to pass through to the canvas.
  - [x] Success: panning works through the HUD overlay area without interference.

- [x] **5.3 Commit: wire HUD into render loop**
  - Semantic commit: `feat(ui): wire HUD into render loop with pre-snapshot display`.
  - Include `src/main.ts`.

### 6. Build verification

- [x] **6.1 TypeScript and test verification**
  - Run `pnpm tsc --noEmit` — must be clean with no type errors.
  - Run `pnpm test` — all existing tests (4 files, 29 tests) must pass.
  - Confirm `src/ui/hud.ts` has no `import` from `three` or `three/webgpu` — the HUD module must be Three.js-free.
  - Confirm no modifications were made to `ViewerState`, `connection.ts`, `camera.ts`, `entities.ts`, or `terrain.ts`.
  - [x] Success: TypeScript clean, all tests pass, no unauthorized module modifications.

### 7. Manual verification walkthrough

Run `pnpm dev` with a connected world server. Follow the verification walkthrough from the slice design.

- [ ] **7.1 HUD visible on load**
  - Open the viewer in a browser. Before the server connects, HUD is visible in the top-left showing connection status (`connecting`, yellow dot), tick `0`, entities `0`, no profile rows.
  - [ ] Success: HUD panel renders in the correct position with pre-snapshot state.

- [ ] **7.2 Connection status transitions**
  - Once connected: status shows `connected` (green dot). Stop the server: status changes to `reconnecting` (yellow pulsing dot). Restart the server: status returns to `connected` (green dot).
  - [ ] Success: all four connection states (`disconnected`, `connecting`, `connected`, `reconnecting`) display correctly with the right dot color and text.

- [ ] **7.3 Tick and entity count**
  - With server connected, tick counter increments. Entity count shows the snapshot value (e.g., 300).
  - [ ] Success: tick value increases each frame; entity count matches the server's snapshot count.

- [ ] **7.4 FPS counter**
  - FPS stabilizes around 60 (or monitor refresh rate). Value is smooth and integer, not jumping erratically.
  - [ ] Success: FPS displays a stable smoothed value.

- [ ] **7.5 Profile legend**
  - Legend shows one row per profile type with the correct color swatch (matching `config.profileColors`) and count per profile. Sum of counts equals total entity count.
  - [ ] Success: profile colors match config palette; per-profile counts sum to total entity count.

- [ ] **7.6 Toggle visibility**
  - Press `H` — HUD disappears. Press `H` again — HUD reappears with current values (not stale).
  - [ ] Success: toggle works cleanly in both directions.

- [ ] **7.7 Click-through panning**
  - Left-click drag starting from the HUD area pans the camera normally.
  - [ ] Success: canvas interaction is not blocked by the HUD.

### 8. Finalization

- [ ] **8.1 Update slice status**
  - Update [105-slice.hud-and-status-panel.md](../slices/105-slice.hud-and-status-panel.md) `status: complete`, bump `dateUpdated`.
  - Update this task file `status: complete`, bump `dateUpdated`.
  - Check off slice 105 in [100-slices.viewer-foundation.md](../architecture/100-slices.viewer-foundation.md).

- [ ] **8.2 Commit: docs and slice completion**
  - Semantic commit: `docs: mark slice 105 complete`.
  - Include only the updated slice/task/arch doc files.

## Notes

- **No unit tests planned.** The HUD is pure DOM rendering with trivial logic (string writes, simple arithmetic for FPS smoothing, array iteration for profile counts). The verification walkthrough covers all functional requirements end-to-end. If the FPS smoothing or profile counting logic becomes non-trivial during implementation, add focused tests at that point.
- **Profile index overflow.** If a profile index from the server exceeds `config.profileColors.length`, the color swatch should use a fallback color (e.g., gray `#888888`) rather than crashing. This is a defensive measure, not a likely scenario.
- **Pre-snapshot HUD placement.** The `updateHud` call is placed before the early return in the render loop so the user sees connection status while waiting. This is a deliberate deviation from the general pattern of "skip everything until first snapshot."
