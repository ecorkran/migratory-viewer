---
docType: review
layer: project
reviewType: slice
slice: camera-constraints-and-pan
project: squadron
verdict: CONCERNS
sourceDocument: project-documents/user/slices/108-slice.camera-constraints-and-pan.md
aiModel: z-ai/glm-5
status: complete
dateCreated: 20260408
dateUpdated: 20260408
findings:
  - id: F001
    severity: concern
    category: architectural-boundaries
    summary: "- Input module category not defined in architecture"
  - id: F002
    severity: note
    category: scope
    summary: "- Slice numbering beyond defined scope"
  - id: F003
    severity: pass
    category: dependency-direction
    summary: "- Dependency direction correct"
  - id: F004
    severity: pass
    category: integration
    summary: "- Integration points match architecture"
  - id: F005
    severity: pass
    category: scope
    summary: "- Clear scope with appropriate non-goals"
  - id: F006
    severity: pass
    category: integration
    summary: "- Data flow maintains architecture patterns"
---

# Review: slice — slice 108

**Verdict:** CONCERNS
**Model:** z-ai/glm-5

## Findings

### [CONCERN] - Input module category not defined in architecture

The slice proposes creating `src/input/camera-input.ts`, introducing a new `input/` top-level directory. The architecture document's component structure explicitly lists `src/` contents: `main.ts`, `protocol/`, `net/`, `rendering/`, `ui/`, and `config.ts`. There is no `input/` directory defined. While the abstraction rationale (future rebinding support) is sound, adding a new top-level module category extends the architecture and should be acknowledged as such. Alternative approaches: (1) place input handling in `rendering/camera.ts` per the architecture's existing structure, (2) update the architecture document to define an input layer before implementing.

### [NOTE] - Slice numbering beyond defined scope

The architecture defines slices 100-107 in its slice plan. Slice 108 extends beyond this defined scope. However, the slice correctly identifies itself as a prerequisite subset of slice 104 (Camera Modes), which is a reasonable decomposition. This is informational rather than blocking.

### [PASS] - Dependency direction correct

The proposed design correctly flows dependencies: `camera-input.ts` imports and calls action functions from `camera.ts`. The camera module owns the frustum/position math and remains unaware of DOM events. This maintains proper separation—the rendering layer contains camera logic, the input layer (if accepted) translates events to actions.

### [PASS] - Integration points match architecture

The slice correctly integrates with existing components: uses `config.ts` for the `allowOutOfBoundsView` flag (matching the flat config shape), preserves `resizeCameraToWorld` semantics, hooks into the existing render loop, and doesn't modify protocol, connection, terrain, entities, or UI modules.

### [PASS] - Clear scope with appropriate non-goals

The slice establishes clear boundaries: no zoom-in clamp, no inertia/easing, no perspective mode changes, no touch gestures, no cursor styling. These non-goals align with the architecture's minimalist philosophy and prevent scope creep into slice 104 territory.

### [PASS] - Data flow maintains architecture patterns

The data flow diagrams correctly show user events → input layer → camera actions → camera position mutation → render loop reads position. This matches the architecture's state ownership model where rendering components read from shared state without caching stale copies.
