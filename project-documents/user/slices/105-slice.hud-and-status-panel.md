---
docType: slice-design
slice: hud-and-status-panel
project: migratory-viewer
parent: user/architecture/100-slices.viewer-foundation.md
dependencies: [101-websocket-consumer-and-live-entity-rendering]
interfaces: []
dateCreated: 20260410
dateUpdated: 20260410
status: complete
---

# Slice Design: HUD and Status Panel

## Parent Document
[100-slices.viewer-foundation.md](../architecture/100-slices.viewer-foundation.md) — Slice plan entry (105).

## Overview

Add a heads-up display overlay that surfaces simulation metadata the viewer already has but does not expose to the user. The HUD reads from `ViewerState` and the render loop — it introduces no new data dependencies, no protocol changes, and no rendering pipeline modifications. Everything is vanilla DOM positioned over the canvas.

## Value

Without the HUD, the user has no way to know whether the viewer is connected, how many entities exist, what tick the simulation is on, or what the profile colors mean. All of this data is already flowing through `ViewerState`; this slice simply makes it visible. The profile legend is particularly important — without it the color-coded cones are meaningless.

## Technical Scope

**Included:**
- Connection status indicator (disconnected / connecting / connected / reconnecting)
- Current server tick number
- Entity count (total, and per-profile breakdown)
- Frame rate counter (renderer FPS)
- Profile legend (color swatch + profile index label for each profile in use)
- Toggle HUD visibility with a hotkey (`H` key)
- CSS styling consistent with the dark simulation aesthetic

**Excluded:**
- Simulation time / calendar time (requires server slice 308, not yet available)
- Layer toggle controls (slice 103, environment overlays)
- Tick rate (server ticks per second) — would require tracking tick timestamps over a window; deferred to a future enhancement if useful
- Any server-to-client metadata beyond what the wire protocol already carries
- UI framework (React, Vue, etc.)

## Dependencies

### Prerequisites
- **Slice 101 (WebSocket Consumer)** — complete. Provides `ViewerState` with `connectionStatus`, `currentTick`, `entityCount`, `profileIndices`.
- **Slice 100 (Project Scaffold)** — complete. Provides the canvas element, render loop, and `config.ts` with `profileColors`.

### Interfaces Required
- `ViewerState` (read-only): `connectionStatus`, `currentTick`, `entityCount`, `profileIndices`
- `config.profileColors`: the color palette array
- Render loop callback: a place to call the HUD's per-frame update (FPS counter)

## Architecture

### Component Structure

Two new files in `src/ui/`:

```
src/ui/
├── hud.ts          # HUD panel: create DOM, update from ViewerState, toggle visibility
└── hud.css         # HUD-specific styles (imported by hud.ts)
```

The architecture document also lists `src/ui/legend.ts`, but the profile legend is small enough to live inside `hud.ts` as a section of the HUD panel. If the legend grows significantly (interactive filtering, tooltips), it can be extracted later. No premature file split.

### Data Flow

```
render loop (main.ts)
  └─ updateHud(viewerState, deltaTime)
       ├─ connection status  ← viewerState.connectionStatus
       ├─ tick counter       ← viewerState.currentTick
       ├─ entity count       ← viewerState.entityCount
       ├─ profile breakdown  ← viewerState.profileIndices + config.profileColors
       └─ FPS counter        ← 1 / deltaTime (smoothed)

keydown 'h' (hud.ts internal listener)
  └─ toggle HUD container display
```

The HUD is a pure reader. It never mutates `ViewerState`. It never touches the Three.js scene. It has no effect on rendering performance beyond the trivial cost of DOM text updates (~10 `textContent` assignments per frame, which the browser batches into a single style/layout pass since they're all in one rAF callback).

## Technical Decisions

### DOM structure

A single container `<div id="hud">` appended to `<body>`, positioned with CSS `position: fixed` over the canvas. Internal structure:

```html
<div id="hud">
  <div class="hud-section hud-status">
    <span class="hud-connection-dot"></span>
    <span class="hud-connection-label">connected</span>
  </div>
  <div class="hud-section hud-stats">
    <div>Tick: <span class="hud-tick">0</span></div>
    <div>Entities: <span class="hud-entity-count">0</span></div>
    <div>FPS: <span class="hud-fps">0</span></div>
  </div>
  <div class="hud-section hud-profiles">
    <!-- one row per active profile, built dynamically -->
    <div class="hud-profile-row">
      <span class="hud-color-swatch" style="background:#5dcaa5"></span>
      <span>Profile 0: 142</span>
    </div>
    ...
  </div>
</div>
```

All elements are created programmatically in `createHud()` — no changes to `index.html`. The HUD owns its DOM subtree entirely.

### FPS smoothing

Raw `1 / delta` is noisy. Use an exponential moving average:

```
smoothFps = smoothFps * 0.95 + instantFps * 0.05
```

Display as an integer. Update the DOM text every frame (cheap — `textContent` on a `<span>` does not trigger layout if the parent dimensions don't change, which they won't at fixed font size).

### Profile breakdown

Count entities per profile index by iterating `viewerState.profileIndices` (an `Int32Array`). This is O(N) per frame. At 10K entities this is ~0.01ms; at 100K it's ~0.1ms. Acceptable. If profiling (slice 106) shows this is a bottleneck, it can be moved to a once-per-snapshot computation rather than per-frame, but the simplicity of per-frame is preferred for now since profile indices don't change between snapshots anyway.

**Optimization note:** Since `profileIndices` only changes on SNAPSHOT (not on STATE_UPDATE), the per-profile counts are stable between snapshots. The HUD can cache the breakdown and only recompute when `entityCount` changes or a new snapshot arrives. This avoids the O(N) iteration every frame. The implementation should use this approach: recompute on entity count change, cache the result, display cached counts on subsequent frames.

### Profile color rendering

Each profile row gets a small colored square (CSS `background-color`) using the hex value from `config.profileColors`. The hex number is converted to a CSS color string: `#${color.toString(16).padStart(6, '0')}`.

Profile labels are `Profile 0`, `Profile 1`, etc. The server does not send profile names — only integer indices. If profile names are added to the protocol later, the label source changes but the HUD structure stays the same.

### Connection status indicator

A small colored dot next to a text label:
- `connected` — green dot
- `connecting` — yellow dot
- `reconnecting` — yellow dot, pulsing animation (CSS `@keyframes`)
- `disconnected` — red dot

The dot is a `<span>` with a CSS `border-radius: 50%` and `background-color` set by class. The label text is the raw `ConnectionStatus` string.

### Visibility toggle

`document.addEventListener('keydown', ...)` in `hud.ts` listens for the `H` key (case-insensitive, not triggered when an input element has focus — though there are no input elements currently). Toggles `hud.style.display` between `''` and `'none'`.

The HUD starts visible. The toggle is stateless — no config persistence.

### Styling

- Font: monospace system font stack (`'SF Mono', 'Fira Code', 'Cascadia Code', monospace`)
- Font size: 12px
- Color: `rgba(255, 255, 255, 0.85)` — high contrast on the dark background
- Background: `rgba(0, 0, 0, 0.6)` — semi-transparent dark panel
- Position: top-left corner, with a small margin (8px)
- Border-radius: 4px
- Padding: 8px 12px
- Sections separated by a subtle divider (`border-bottom: 1px solid rgba(255,255,255,0.1)`)
- Color swatches: 10x10px inline blocks
- No pointer-events on the HUD container (`pointer-events: none`) so clicks pass through to the canvas for panning. Exception: if interactive controls are added later, this changes.

All styles live in `src/ui/hud.css`, imported by `hud.ts`. No additions to `src/style.css` beyond what's needed.

## Implementation Details

### Module API

```ts
// src/ui/hud.ts

/** Create the HUD DOM elements and attach to the document. */
export function createHud(): HudElements;

/** Update all HUD readouts. Called once per frame from the render loop. */
export function updateHud(hud: HudElements, state: ViewerState, delta: number): void;
```

`HudElements` is an interface holding references to the DOM elements that get updated each frame (the `<span>` elements for tick, entity count, FPS, connection status, and the profile section container). This avoids `document.querySelector` lookups every frame.

### Integration with main.ts

```ts
// In main.ts, after scene/camera/terrain/entity setup:
import { createHud, updateHud } from './ui/hud.ts';

const hud = createHud();

// Inside renderer.setAnimationLoop:
timer.update();
const delta = timer.getDelta();
// ... existing render logic ...
updateHud(hud, viewerState, delta);
```

The `updateHud` call goes after the render call — the HUD reads state that was just used to render, so the displayed values match what's on screen.

### Handling pre-snapshot state

Before the first snapshot, `viewerState.worldWidth === 0` and the render loop returns early. The HUD should still be visible and useful in this state:
- Connection status: shows `connecting` or `reconnecting` (the connection is in progress)
- Tick: `0`
- Entities: `0`
- FPS: `0` or `--` (no frames rendered yet)
- Profile legend: empty (no profiles until snapshot)

The `updateHud` call should be placed **before** the early return in the render loop, or called unconditionally regardless of the early return. This way the user sees the connection status while waiting for the first snapshot.

## Integration Points

### Provides to Other Slices
- The HUD container and styling pattern is reusable for future overlays (slice 103 layer toggles, slice 104 minimap).
- The `createHud` / `updateHud` pattern establishes the convention for UI modules in this project.

### Consumes from Other Slices
- **ViewerState** from slice 101 (read-only)
- **config.profileColors** from slice 100
- **THREE.Timer delta** from the render loop (slice 100)

## Success Criteria

### Functional Requirements
1. The HUD panel is visible in the top-left corner of the viewer on page load.
2. Connection status shows a colored dot and text label that accurately reflects the current `connectionStatus` value, updating in real time as the connection state changes.
3. Tick counter displays the current `viewerState.currentTick` and updates each frame.
4. Entity count displays the total number of entities from the latest snapshot.
5. FPS counter displays a smoothed frame rate that reflects actual rendering performance.
6. Profile legend shows one row per distinct profile index present in the snapshot, with a correctly colored swatch matching `config.profileColors[i]` and the count of entities with that profile.
7. Pressing `H` toggles the HUD visibility. Pressing `H` again restores it.
8. The HUD does not interfere with canvas interaction — left-click drag panning works through the HUD area.

### Technical Requirements
9. `pnpm tsc --noEmit` clean — no type errors introduced.
10. Existing tests pass (`pnpm test`).
11. The HUD module has no dependency on Three.js — it reads plain TypeScript types (`ViewerState`, `ViewerConfig`), not Three.js objects.
12. No modifications to `ViewerState`, `connection.ts`, `camera.ts`, `entities.ts`, or `terrain.ts`.

### Verification Walkthrough

**Prereqs:** world server running, viewer dev server running (`pnpm dev`).

**Automated checks (run from project root):**
```bash
pnpm tsc --noEmit    # must exit 0, no type errors
pnpm test            # must pass all 29 tests (4 files)
```

**Caveats discovered during implementation:**
- `updateHud` is called **before** the `if (viewerState.worldWidth === 0) return` guard in the render loop. This is intentional — the HUD must display connection status while waiting for the first snapshot.
- `timer.getDelta()` is called once per frame and stored in `const delta` which is passed to both `updateHud` and consumed by the render pipeline.
- Profile legend only rebuilds when `state.entityCount` changes (not every frame), using a module-level `cachedEntityCount` sentinel.

**Manual browser walkthrough:**

1. **HUD visible on load.** Open the viewer in a browser. Before the server connects, the HUD panel should be visible in the top-left corner showing connection status (likely `connecting` with a yellow dot), tick `0`, entities `0`, and no profile rows.

2. **Connection status.** Once the server connects and sends a snapshot, the status should update to `connected` with a green dot. Stop the server — status should change to `reconnecting` (yellow pulsing dot). Restart the server — status should return to `connected`.

3. **Tick and entity count.** With the server connected, the tick counter should increment each frame. The entity count should show the number from the snapshot (e.g., `300` for a 300-entity world).

4. **FPS counter.** The FPS value should stabilize around 60 (or the monitor's refresh rate) during normal operation. It should be a smooth value, not jumping erratically.

5. **Profile legend.** The legend should show one row per profile type with the correct color swatch and entity count per profile. The sum of all profile counts should equal the total entity count.

6. **Toggle.** Press `H` — the HUD disappears. Press `H` again — it reappears with current values.

7. **Click-through.** With the HUD visible, left-click and drag starting from the HUD area. The pan should work as normal — the HUD does not capture the mouse event.

8. **TypeScript and tests.** `pnpm tsc --noEmit` clean. `pnpm test` — all existing tests pass.

## Implementation Notes

### Development Approach

1. Create `src/ui/hud.css` with all styles.
2. Create `src/ui/hud.ts` with `createHud()` and `updateHud()`.
3. Wire into `main.ts` render loop.
4. Test manually against running server.
5. Verify TypeScript compilation and existing tests.

### Suggested implementation order within updateHud

Update connection status and tick/count first (cheapest — single `textContent` writes), then FPS (needs delta smoothing), then profile breakdown (O(N) scan on snapshot change only).

## Effort

2/5. Vanilla DOM, no new dependencies, no protocol changes, no rendering pipeline modifications. The only complexity is getting the CSS right.
