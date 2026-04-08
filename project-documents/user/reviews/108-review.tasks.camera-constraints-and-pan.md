---
docType: review
layer: project
reviewType: tasks
slice: camera-constraints-and-pan
project: squadron
verdict: FAIL
sourceDocument: project-documents/user/tasks/108-tasks.camera-constraints-and-pan.md
aiModel: z-ai/glm-5
status: complete
dateCreated: 20260408
dateUpdated: 20260408
findings:
  - id: F001
    severity: fail
    category: success-criteria-gap
    summary: "Zoom-out clamp not properly disabled when allowOutOfBoundsView is true"
    location: 108-tasks.camera-constraints-and-pan.md:Task 2.4
  - id: F002
    severity: concern
    category: task-sequencing
    summary: "All commits batched at end rather than distributed throughout"
    location: 108-tasks.camera-constraints-and-pan.md:Task 6.2
  - id: F003
    severity: pass
    category: completeness
    summary: "All success criteria traced to implementation tasks"
  - id: F004
    severity: pass
    category: task-sequencing
    summary: "Task sequencing respects dependencies with intentional overlap"
  - id: F005
    severity: pass
    category: technical-accuracy
    summary: "Zoom-fit formula discrepancy handled with defensive guidance"
    location: 108-tasks.camera-constraints-and-pan.md:Task 2.2
  - id: F006
    severity: pass
    category: testing
    summary: "Manual verification comprehensively covers integration behavior"
    location: 108-tasks.camera-constraints-and-pan.md:Task 5
---

# Review: tasks — slice 108

**Verdict:** FAIL
**Model:** z-ai/glm-5

## Findings

### [FAIL] Zoom-out clamp not properly disabled when allowOutOfBoundsView is true

Task 2.4 specifies that `zoomBy` clamps `currentZoom` against `computeZoomFit()` without checking `config.allowOutOfBoundsView`. However, Success Criterion 9 requires that setting `allowOutOfBoundsView = true` disables **both** clamps (zoom and pan). The pan clamp is correctly gated (Task 2.1's `clampCameraToWorld` returns early when the config is true), but the zoom-out clamp in Task 2.4 would still be enforced. This would cause SC9's verification step (Task 5.9) to fail for zoom-out behavior — the user would still be unable to zoom past world-fit even with the debug flag set. 

**Fix:** Task 2.4 should include a conditional such as: "If `allowOutOfBoundsView` is true, skip the `computeZoomFit()` lower bound (only apply `config.zoomMax` upper bound)."

### [CONCERN] All commits batched at end rather than distributed throughout

The only commit task is Task 6.2, which batches all changes at the end of implementation. Best practice is to distribute commit checkpoints throughout so work is incrementally saved and reviewable. Natural commit boundaries would be: after Task 1 (scaffolding complete), after Task 3.2 (new input path wired), and after Task 4.1 (legacy removal complete). The Notes acknowledge intermediate work should not span "more than one commit" but don't provide explicit commit tasks, leaving this to implementer judgment.

### [PASS] All success criteria traced to implementation tasks

Each of the 11 success criteria from the slice design maps to one or more implementation tasks. SC1 (left-click pan) → Tasks 2.3, 3.1, 5.2. SC2 (no middle/right-click pan) → Tasks 3.1, 4.1, 5.3. SC3 (wheel zoom) → Tasks 2.4, 3.1. SC4 (zoom-out clamp) → Tasks 2.2, 2.4, 5.5. SC5 (pan reset at max zoom-out) → Tasks 2.1, 5.6. SC6 (pan edge clamp) → Tasks 2.1, 2.3, 5.4. SC7 (resize handling) → Tasks 2.5, 5.7. SC8 (world bounds change) → Tasks 2.5, 5.8. SC9 (debug escape hatch) → Tasks 1.1, 2.1, 5.9. SC10 (no regressions) → Tasks 5.1, 5.10. SC11 (DOM separation) → Tasks 4.1, 4.2.

### [PASS] Task sequencing respects dependencies with intentional overlap

The task order correctly respects dependencies: config/scaffolding (Task 1) → camera action API (Task 2) → input wiring (Task 3) → legacy removal (Task 4) → verification (Task 5) → finalization (Task 6). The temporary duplication during Tasks 3.2→4.1 is explicitly acknowledged in the Notes as intentional, allowing each subtask to be independently verifiable. No circular dependencies exist.

### [PASS] Zoom-fit formula discrepancy handled with defensive guidance

Task 2.2 derives `zoomFit = max(1, (activeWorldHeight * aspect) / activeWorldWidth)` which differs from the slice design's formula `min(W / (worldHeight * aspect), H / worldHeight)`. However, the task explicitly instructs implementers to re-derive carefully and "stop and flag it" if their derivation disagrees with the slice, rather than silently changing. The task's derivation appears correct based on first-principles analysis (frustum must fit within world on both axes). This is appropriate defensive guidance.

### [PASS] Manual verification comprehensively covers integration behavior

Task 5 provides 10 manual verification steps mapping directly to the slice design's Verification Walkthrough. Each success criterion has a corresponding manual test. The approach is appropriate for visual, integration-level behavior where unit tests would be low-value — a judgment explicitly endorsed in both the slice design and task Notes.
