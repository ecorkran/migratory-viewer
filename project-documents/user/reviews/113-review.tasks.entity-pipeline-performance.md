---
docType: review
layer: project
reviewType: tasks
slice: entity-pipeline-performance
project: squadron
verdict: CONCERNS
sourceDocument: project-documents/user/tasks/113-tasks.entity-pipeline-performance.md
aiModel: minimax/minimax-m2.7
status: complete
dateCreated: 20260506
dateUpdated: 20260506
findings:
  - id: F001
    severity: concern
    category: test-coverage
    summary: "Render-skip behavior not explicitly tested"
    location: unverified
  - id: F002
    severity: pass
    category: success-criterion-coverage
    summary: "Success criterion 1 — `parseStateUpdate` zero-copy"
    location: unverified
  - id: F003
    severity: pass
    category: success-criterion-coverage
    summary: "Success criterion 2 — `ViewerState.entityHeights` field"
    location: unverified
  - id: F004
    severity: pass
    category: success-criterion-coverage
    summary: "Success criterion 3 — `applyStateUpdate` populates `entityHeights`"
    location: unverified
  - id: F005
    severity: pass
    category: success-criterion-coverage
    summary: "Success criterion 4 — `applyTerrain` rebakes `entityHeights`"
    location: unverified
  - id: F006
    severity: pass
    category: success-criterion-coverage
    summary: "Success criterion 5 — `updateEntities` reads from `entityHeights`"
    location: unverified
  - id: F007
    severity: pass
    category: success-criterion-coverage
    summary: "Success criterion 6 — render-skip implementation"
    location: unverified
  - id: F008
    severity: pass
    category: success-criterion-coverage
    summary: "Success criterion 8 — typecheck"
    location: unverified
  - id: F009
    severity: pass
    category: success-criterion-coverage
    summary: "Success criterion 9 — smoke test"
    location: unverified
  - id: F010
    severity: pass
    category: scope-accuracy
    summary: "`parseSnapshot` left unchanged — matches design intent"
    location: unverified
  - id: F011
    severity: pass
    category: process-quality
    summary: "Commit checkpoints distributed throughout"
    location: unverified
  - id: F012
    severity: pass
    category: process-quality
    summary: "Test-with pattern consistently applied"
    location: unverified
  - id: F013
    severity: pass
    category: process-quality
    summary: "Task sequencing respects dependencies"
    location: unverified
  - id: F014
    severity: note
    category: performance-testing
    summary: "No load test for NFR — none declared in slice design"
    location: unverified
---

# Review: tasks — slice 113

**Verdict:** CONCERNS
**Model:** minimax/minimax-m2.7

## Findings

### [CONCERN] Render-skip behavior not explicitly tested

Success criterion 7 lists four required new test coverages, including: *"Render-skip: calling the render loop without a tick change does not invoke `updateEntities`."* No task in the breakdown provides this test. T15 tests that `updateEntities` reads from `entityHeights` correctly, but does not test the conditional skip guard in `main.ts`. T16 implements the render-skip logic but lacks a unit or integration test that verifies `updateEntities` is *not* called when `currentTick === lastRenderedTick`. Without this test, the success criterion is not fully satisfied.

---

### [PASS] Success criterion 1 — `parseStateUpdate` zero-copy

T11 (remove `buffer.slice()`) and T12 (test f32/f64 round-trip) together cover criterion 1. T12 explicitly tests both dtypes against expected values. T13 is the commit checkpoint.

---

### [PASS] Success criterion 2 — `ViewerState.entityHeights` field

T1 adds `entityHeights: Float32Array | null` to the interface, with JSDoc and `createInitialViewerState` initialization. TypeScript compile check is part of T1's success criteria.

---

### [PASS] Success criterion 3 — `applyStateUpdate` populates `entityHeights`

T2 extracts `bakeEntityHeights` helper. T6 calls it from `applyStateUpdate`. T7 tests with position changes and null terrain. The complete coverage is good.

---

### [PASS] Success criterion 4 — `applyTerrain` rebakes `entityHeights`

T8 implements the rebake conditional. T9 tests with terrain change and null positions. Both tests in T9 are explicitly defined.

---

### [PASS] Success criterion 5 — `updateEntities` reads from `entityHeights`

T14 removes `getTerrainHeight` from the entity loop. T15 tests Y-component output and null fallback. Tests immediately follow implementation (test-with pattern).

---

### [PASS] Success criterion 6 — render-skip implementation

T16 implements the `lastRenderedTick` guard with `renderer.render()` remaining unconditional. The implementation matches the slice design exactly.

---

### [PASS] Success criterion 8 — typecheck

T17 bundles `pnpm tsc --noEmit` with the full test pass as the final gate. This is an appropriate checkpoint before the final commit.

---

### [PASS] Success criterion 9 — smoke test

T19 covers all four smoke test checkpoints from the verification walkthrough: correct entity positions, smooth camera, no console errors, and terrain reload reseating. This is appropriately scoped as a manual verification task.

---

### [PASS] `parseSnapshot` left unchanged — matches design intent

T11 explicitly defers `parseSnapshot` changes, consistent with the slice design's note that SNAPSHOT is low-frequency and the zero-copy benefit is largest for STATE_UPDATE. No scope creep here.

---

### [PASS] Commit checkpoints distributed throughout

Three commits at T10 (state layer), T13 (deserializer), and T18 (rendering/render-skip) break the work into logical units. The final smoke test (T19) is post-commit and appropriately manual.

---

### [PASS] Test-with pattern consistently applied

Every implementation task (T1, T2, T4, T6, T8, T11, T14, T16) is immediately followed by its test task (T3, T5, T7, T9, T12, T15). The pattern is clean throughout.

---

### [PASS] Task sequencing respects dependencies

The state layer tasks (T1–T10) precede deserializer (T11–T13) and rendering tasks (T14–T18). The `bakeEntityHeights` helper (T2) is defined before it's called (T4, T6, T8). No circular dependencies.

---

### [NOTE] No load test for NFR — none declared in slice design

The evaluation criteria mention load tests if an NFR is restated in the parent slice. The slice design for 113 does not restate any NFR, and no load test task exists. This is not a gap — the slice addresses algorithmic efficiency, not throughput/latency NFRs. No action needed.
