---
docType: devlog
scope: project-wide
description: Internal session log for development work and project context
---

# Development Log
A lightweight, append-only record of development activity. Newest entries first.

---

## 20260506

### Slice 114: Entity Position dtype Negotiation (f32/f64) — Implementation Complete (T1–T15)

**Commits this session:**
- `3d4a56b` feat: add PositionDtype and f32/f64 branching to deserializer
- `52a667e` feat: propagate Float32Array | Float64Array union through ViewerState and state layer

**Delivered:**
- `PositionDtype = { F64: 0x00, F32: 0x01 } as const` added to `protocol/types.ts`
- `ParsedSnapshot` and `ParsedStateUpdate` interfaces widened: `positions/velocities` now `Float32Array | Float64Array`
- `parseSnapshot`: 26-byte header (was 25); dtype flag at offset 25; branches to `Float32Array` or `Float64Array` for pos/vel; unknown dtype → `console.warn` + `null`
- `parseStateUpdate`: 10-byte header (was 9); dtype flag at offset 9; same branching
- `ViewerState.positions/velocities` widened to `Float32Array | Float64Array | null`
- `applyStateUpdate`: same-dtype path uses `.set()` as before; dtype-switch path replaces buffers and logs a warning; length-mismatch path unchanged
- `rendering/entities.ts`: no logic changes needed (numeric index access works for both typed array types)
- 6 new tests; all 4 test files with buffer-building helpers updated to the new header format
- 127 tests passing total (was 121)

**Key decisions:**
- dtype-switch in `applyStateUpdate` replaces buffers rather than using cross-dtype `.set()` — avoids silent f64→f32 truncation. See slice design Special Considerations.
- `perComponentBytes` derived from `perEntityBytes / 4` (pos+vel is 4 components per entity); cleaner than duplicating element-size logic.
- Test helpers in `terrain-assembler.test.ts`, `terrain-assembler-chunked.test.ts`, and `connection.test.ts` each had their own local `buildSnapshot`/`buildStateUpdate` with the old header — all updated to include the dtype byte.

**Remaining:** T16/T17 are manual smoke tests requiring a running server.

---

## 20260410

### Slice 105: HUD and Status Panel — Complete

**Commits this session:**
- `6de346c` feat(ui): add HUD overlay with status, stats, and profile legend
- `e88d5f4` feat(ui): wire HUD into render loop with pre-snapshot display
- `5c8985d` docs: update slice 105 status, verification walkthrough, and CHANGELOG
- `0be4c9f` feat(ui): add TPS counter to HUD showing server ticks per second

**Delivered:**
- `src/ui/hud.ts` + `src/ui/hud.css` — vanilla DOM overlay, no Three.js dependency
- Connection status (colored dot + label), tick counter, entity count, FPS (EMA-smoothed), TPS (1-sec rolling window), profile legend with color swatches
- `H` key toggles visibility; `pointer-events: none` for canvas click-through
- `updateHud` called before render early-return so HUD is visible pre-snapshot
- Profile legend cached — only rebuilds on entity count change
- TPS counter added post-design to distinguish render FPS from server tick rate (useful for ongoing server optimization effort)

**Key observations:**
- 120 FPS vs ~12-20 TPS: render loop redraws at monitor refresh rate; entity positions only update on server tick. Motion appears smooth due to consistent frame pacing, not interpolation.
- No client-side position interpolation exists yet — could be a future enhancement.

---

### Slice 108: Camera Constraints and Pan — In Progress

**Commits this session:**
- `eeba7fd` chore(camera): scaffold input module and out-of-bounds-view flag
- `a63e5fe` feat(camera): add pan/zoom action API and world-bounds clamp
- `8c0d79c` refactor(camera): route input through camera-input module
- `a6d36f7` fix(camera): correct zoom-fit formula and remove degenerate lookAt from clamp
- `3d4e7e2` docs: update slice 108 verification walkthrough and changelog
- `27a14bb` fix(render): defer geometry disposal to avoid WebGPU buffer-in-use errors
- `23ccd1f` docs: mark slice 108 in-progress, update caveats with WebGPU refresh issue
- `76c5de1` fix(render): defer first render until snapshot provides world bounds

**Delivered:**
- Camera DOM handlers moved to `src/input/camera-input.ts`; `camera.ts` is DOM-free
- Left-click drag pans; wheel zooms; pan+zoom clamped to world bounds
- `config.allowOutOfBoundsView` debug flag disables clamps
- Pan/zoom/clamp verified working; 29 tests passing
- WebGPU refresh bug root-caused and fixed: skip rendering until first snapshot; drop premature geometry.dispose() calls that destroyed GPU buffers while in-flight

**Pending:**
- Tasks 5.8 (world bounds change) and 5.9 (debug escape hatch) not manually verified — slice status remains `in-progress`
- `forceWebGL` flag explored but WebGL backend renders blank; needs separate investigation
- WebGL fallback: `three/webgpu` WebGPURenderer with `forceWebGL: true` renders nothing — root cause unknown

**Key decisions:**
- `computeZoomFit()` returns 1 (height-based frustum; horizontal overflow acceptable on wide windows)
- `clampCameraToWorld` does not call `lookAt` — degenerate for top-down camera, caused orientation corruption on resize
- Geometry replacement: no dispose calls; orphan old geometry and let GC handle it to avoid WebGPU buffer lifetime issues
- First render deferred until `viewerState.worldWidth > 0` — prevents placeholder geometry from being GPU-uploaded before real world bounds arrive
