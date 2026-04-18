---
docType: review
layer: project
reviewType: tasks
slice: terrain-rendering
project: squadron
verdict: CONCERNS
sourceDocument: project-documents/user/tasks/102-tasks.terrain-rendering.md
aiModel: z-ai/glm-5.1
status: complete
dateCreated: 20260418
dateUpdated: 20260418
findings:
  - id: F001
    severity: concern
    category: success-criteria-coverage
    summary: "No-terrain fallback doesn't meet \"unchanged behavior\" success criterion"
    location: Task 5.3 vs. slice design Success Criteria (Functional Requirement 2)
  - id: F002
    severity: concern
    category: success-criteria-coverage
    summary: "Second TERRAIN replacement not explicitly tested or verified"
    location: Tasks 5.2, 7.1 vs. slice design Success Criteria (Functional Requirement 5)
  - id: F003
    severity: note
    category: scope-coverage
    summary: "Missing task for WebSocket payload ceiling documentation comment"
    location: slice design Technical Decisions → "WebSocket payload ceiling"
  - id: F004
    severity: note
    category: consistency
    summary: "Log format inconsistency between verification walkthrough and task"
    location: Task 3.3 vs. slice design Verification Walkthrough step 3
  - id: F005
    severity: pass
    category: task-sequencing
    summary: "Protocol tasks well-sequenced and test-driven"
  - id: F006
    severity: pass
    category: task-scoping
    summary: "Task scoping appropriate for junior AI completion"
  - id: F007
    severity: pass
    category: success-criteria-coverage
    summary: "All parser and height-lookup test requirements covered"
    location: Tasks 2.3, 4.2
---

# Review: tasks — slice 102

**Verdict:** CONCERNS
**Model:** z-ai/glm-5.1

## Findings

### [CONCERN] No-terrain fallback doesn't meet "unchanged behavior" success criterion

The slice design's Functional Requirement 2 states: *"Connecting to a server that does not send TERRAIN leaves the viewer on a flat plane (unchanged behavior) with no errors."* The verification walkthrough step 6 is even more explicit: *"Flat plane renders as before slice 102."* However, Task 5.3 delivers a 1×1 placeholder mesh described as "tiny" and explicitly acknowledges this as a "cosmetic limitation." Before this slice, the viewer shows a world-sized `PlaneGeometry` sized to world bounds. After, a no-terrain server would show a barely-visible 1×1 plane — a clear regression from "unchanged behavior." Task 8.5 also waters down the verification to "Expect a flat (placeholder) plane" rather than matching the walkthrough's "as before slice 102." The task plan should either restore the world-sized flat-plane fallback (e.g., by keeping or replicating the old `resizeTerrain` logic when `terrain === null`) or the success criterion should be explicitly revised.

### [CONCERN] Second TERRAIN replacement not explicitly tested or verified

Functional Requirement 5 states: *"A second TERRAIN frame on the same connection replaces the mesh."* The architecture supports this via `terrainRevision` increment + `applyTerrainToMesh` geometry disposal, but no task includes an automated test or a manual verification step that confirms this behavior. Task 8's walkthrough doesn't include a step for sending a second TERRAIN on the same connection. An automated test could verify that calling `applyTerrainToMesh` twice with different grids updates vertex positions to the second grid's values, and a manual step could use a server debug hook to re-send TERRAIN. Without either, this functional requirement is unverified.

### [NOTE] Missing task for WebSocket payload ceiling documentation comment

The slice design's "Included" scope and Technical Decisions section both call for: *"A comment in net/connection.ts documents this asymmetry so a future maintainer does not chase a nonexistent API."* No task in the breakdown adds this comment. While it's a documentation-only item, it is explicitly scoped as included in the slice design and should have a corresponding task (even if bundled into Task 3.3 which already touches `connection.ts`).

### [NOTE] Log format inconsistency between verification walkthrough and task

The slice design's verification walkthrough step 3 expects: `"[protocol] terrain rows=R cols=C resolution=X"`. Task 3.3 specifies: `"[net] TERRAIN rows=${parsed.rows} cols=${parsed.cols} resolution=${parsed.resolution}"`. The prefix (`[protocol]` vs `[net]`) and the casing (`terrain` vs `TERRAIN`) differ. While cosmetic, the manual verification in Task 8.2 will look for the format defined in the task, not the format in the slice design. These should be aligned.

### [PASS] Protocol tasks well-sequenced and test-driven

Tasks 2.1–2.4 follow the test-with pattern correctly: type definitions (2.1), implementation (2.2), then tests immediately follow (2.3), with a commit checkpoint (2.4). The same pattern holds for height lookup (4.1 → 4.2 → 4.3) and entity placement (6.1 → 6.2 → 6.3). Commit checkpoints are distributed throughout (7 commits across the implementation, none batched at the end).

### [PASS] Task scoping appropriate for junior AI completion

Each task has clear, actionable steps with explicit success criteria verifiable by compilation, test results, or inspection. No task appears too large (the most complex, Task 2.2, is a single well-specified function with 7 numbered steps) or too granular. Dependencies are respected: protocol before state, state before height lookup, height lookup before mesh, mesh before entity integration, all before main-loop wiring.

### [PASS] All parser and height-lookup test requirements covered

Technical Requirements 3 and 4 (unit tests for `getTerrainHeight` and TERRAIN parser) are comprehensively covered. Task 2.3 covers 9 test cases including happy path, truncated buffer, zero/negative dimensions, zero/negative resolution, length mismatch, oversize cap, and dispatch routing. Task 4.2 covers 6 test cases including null grid, cell centers, interpolation midpoints, out-of-bounds clamp, grid origin, and far corner. The asymmetric 3×3 fixture in Task 4.2 is specifically designed to catch row/column confusion, aligning with the slice design's "row-major ordering is the bug-farm" warning.
