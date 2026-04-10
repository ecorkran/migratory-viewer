---
docType: review
layer: project
reviewType: slice
slice: hud-and-status-panel
project: squadron
verdict: PASS
sourceDocument: project-documents/user/slices/105-slice.hud-and-status-panel.md
aiModel: z-ai/glm-5
status: complete
dateCreated: 20260410
dateUpdated: 20260410
findings:
  - id: F001
    severity: pass
    category: technology-choice
    summary: "No UI Framework"
  - id: F002
    severity: pass
    category: state-management
    summary: "Read-only ViewerState access"
  - id: F003
    severity: pass
    category: dependencies
    summary: "Correct dependency identification"
  - id: F004
    severity: pass
    category: scope
    summary: "Scope boundaries respected"
  - id: F005
    severity: pass
    category: layer-separation
    summary: "No Three.js coupling"
  - id: F006
    severity: note
    category: component-structure
    summary: "legend.ts consolidated into hud.ts"
    location: src/ui/
  - id: F007
    severity: note
    category: performance
    summary: "Profile breakdown caching optimization"
---

# Review: slice — slice 105

**Verdict:** PASS
**Model:** z-ai/glm-5

## Findings

### [PASS] No UI Framework

The slice correctly uses vanilla DOM manipulation without introducing React, Vue, or other UI frameworks, directly aligning with the architecture decision: "Vanilla DOM for UI controls in v1. No React, Vue, or similar."

### [PASS] Read-only ViewerState access

The slice explicitly states "The HUD is a pure reader. It never mutates ViewerState" and correctly identifies that `net/connection.ts` is the sole writer. This respects the architecture's state ownership rules.

### [PASS] Correct dependency identification

Dependencies are properly identified: slice 101 for ViewerState, slice 100 for config.profileColors and the render loop, and THREE.Timer delta. The slice correctly consumes from these without modifying them.

### [PASS] Scope boundaries respected

The slice correctly excludes out-of-scope items (simulation time requiring server slice 308, layer toggles for slice 103, tick rate as deferred enhancement) and explicitly commits to no modifications of core modules (ViewerState, connection.ts, camera.ts, entities.ts, terrain.ts).

### [PASS] No Three.js coupling

The success criteria correctly require "The HUD module has no dependency on Three.js — it reads plain TypeScript types (ViewerState, ViewerConfig), not Three.js objects." This maintains clean layer separation.

### [NOTE] legend.ts consolidated into hud.ts

The architecture document lists `src/ui/legend.ts` as a separate component, but the slice consolidates the profile legend into `hud.ts` with rationale: "the profile legend is small enough to live inside hud.ts as a section of the HUD panel. If the legend grows significantly (interactive filtering, tooltips), it can be extracted later." This is a reasonable implementation decision within the UI layer's autonomy and does not violate architectural boundaries.

### [NOTE] Profile breakdown caching optimization

The slice proposes caching per-profile entity counts and recomputing only when entityCount changes or a new snapshot arrives, rather than iterating every frame. The architecture states components "do not cache stale copies; they reference the current values each frame or tick." However, this optimization caches derived/computed data (not raw ViewerState) and is architecturally sound since `profileIndices` only changes on SNAPSHOT messages. The HUD still reads current ViewerState values each frame for connection status, tick, and entity count.
