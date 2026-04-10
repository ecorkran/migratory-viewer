---
docType: devlog
scope: project-wide
description: Internal session log for development work and project context
---

# Development Log
A lightweight, append-only record of development activity. Newest entries first.

---

## 20260410

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
