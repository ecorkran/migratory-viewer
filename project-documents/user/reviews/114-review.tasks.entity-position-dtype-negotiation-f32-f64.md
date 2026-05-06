---
docType: review
layer: project
reviewType: tasks
slice: entity-position-dtype-negotiation-f32-f64
project: squadron
verdict: CONCERNS
sourceDocument: project-documents/user/tasks/114-tasks.entity-position-dtype-negotiation-f32-f64.md
aiModel: minimax/minimax-m2.7
status: complete
dateCreated: 20260506
dateUpdated: 20260506
findings:
  - id: F001
    severity: pass
    category: uncategorized
    summary: "T1 covers PositionDtype definition"
    location: unverified
  - id: F002
    severity: pass
    category: uncategorized
    summary: "T2–T3 cover protocol layer changes"
    location: unverified
  - id: F003
    severity: concern
    category: uncategorized
    summary: "T4 success criteria underspecified"
    location: unverified
  - id: F004
    severity: concern
    category: uncategorized
    summary: "T7 success criteria underspecified"
    location: unverified
  - id: F005
    severity: pass
    category: uncategorized
    summary: "T5–T8 cover new unit tests"
    location: unverified
  - id: F006
    severity: pass
    category: uncategorized
    summary: "T9 commit checkpoint exists mid-breakdown"
    location: unverified
  - id: F007
    severity: pass
    category: uncategorized
    summary: "T10–T12 cover state layer"
    location: unverified
  - id: F008
    severity: pass
    category: uncategorized
    summary: "T13 covers rendering layer with no logic changes"
    location: unverified
  - id: F009
    severity: pass
    category: uncategorized
    summary: "T14 covers typecheck and test pass"
    location: unverified
  - id: F010
    severity: pass
    category: uncategorized
    summary: "T15 commit checkpoint exists"
    location: unverified
  - id: F011
    severity: pass
    category: uncategorized
    summary: "T16 covers f32 smoke test with concrete criteria"
    location: unverified
  - id: F012
    severity: concern
    category: uncategorized
    summary: "T17 could be more specific for backward compatibility"
    location: unverified
  - id: F013
    severity: pass
    category: uncategorized
    summary: "No gaps: all success criteria trace to tasks"
    location: unverified
  - id: F014
    severity: pass
    category: uncategorized
    summary: "Sequencing is correct; test-with pattern followed"
    location: unverified
  - id: F015
    severity: pass
    category: uncategorized
    summary: "All tasks are independently completable"
    location: unverified
---

# Review: tasks — slice 114

**Verdict:** CONCERNS
**Model:** minimax/minimax-m2.7

## Findings

### [PASS] T1 covers PositionDtype definition

T1 explicitly defines the constant and type alias in `protocol/types.ts` alongside `TerrainDtype`. Success criteria correctly require `PositionDtype.F64 === 0` and `PositionDtype.F32 === 1`, and forbid raw hex literals outside this definition — satisfying technical requirements 1 and 2.

### [PASS] T2–T3 cover protocol layer changes

T2 widens interface fields; T3 updates header constants (25→26, 9→10), introduces dtype-specific `SNAPSHOT_PER_ENTITY_BYTES_F64/F32`, reads dtype flag at documented offsets, and branches to construct the correct typed array. The validation pattern (warn + null on unknown dtype) is specified. Task sequence is correct: T2 widens types so T3's compiler errors act as a checklist.

### [CONCERN] T4 success criteria underspecified

T4 states: "Success: all previously passing snapshot tests still pass with no modifications to test logic (only fixture byte layout if needed)." This verifies that existing tests are not broken, but does not explicitly assert that the f64 parsing path is exercised and correct. The slice design lists "f64 snapshot round-trip" as a distinct required test. T5 then adds the f32 path test, but T4 lacks a symmetric explicit assertion for f64. Recommend adding: "assert `positions` is `instanceof Float64Array` and values match (f64 path confirmed)."

### [CONCERN] T7 success criteria underspecified

Mirrors the T4 issue for state updates. T7 states existing state update tests should pass but does not explicitly assert the f64 parsing path is exercised. The slice design lists "f64 state update round-trip" as a required test. Recommend adding explicit f64 path assertion: "assert `positions` is `instanceof Float64Array` and values match."

### [PASS] T5–T8 cover new unit tests

T5 adds f32 snapshot test and unknown-dtype test for snapshot. T8 adds the equivalent for state updates. Unknown dtype tests assert return `null` and console warning — matching the tier-1 behavior spec. Test count expectations in T14 (6 new tests from T5+T8+T12) are consistent.

### [PASS] T9 commit checkpoint exists mid-breakdown

The protocol layer is committed separately from the state/rendering layer, satisfying the "distributed checkpoints, not batched at end" requirement.

### [PASS] T10–T12 cover state layer

T10 widens `ViewerState`. T11 implements the dtype-switch logic in `applyStateUpdate` with the three-way branching (same dtype→set, different dtype+same length→reassign+log, different length→warn path). T12 adds tests covering both the dtype-switch and same-dtype paths. Sequence is logical: T11 logic depends on T10's type widening.

### [PASS] T13 covers rendering layer with no logic changes

The slice design explicitly states no logic change is needed; T13 widens parameter types and the compiler error checklist confirms completion. Success criterion correctly prohibits `as` casts.

### [PASS] T14 covers typecheck and test pass

Zero type errors + 121+ tests (existing + new). Criteria are concrete and verifiable.

### [PASS] T15 commit checkpoint exists

State and rendering layers committed with descriptive message. Working tree clean after.

### [PASS] T16 covers f32 smoke test with concrete criteria

Explicitly verifies: correct entity positions (visual), no console warnings, and WS frame size (~156 KB at 10k entities). These match the bandwidth-reduction claim in the slice design's value section.

### [CONCERN] T17 could be more specific for backward compatibility

T17 states "Confirm rendering is identical to pre-slice behavior; no regressions" but does not provide concrete assertions (e.g., entity positions match expected values, no JS errors, frame count stable). Given this is the backward-compatibility gate for f64, more explicit criteria would reduce ambiguity during manual execution.

### [PASS] No gaps: all success criteria trace to tasks

Cross-reference confirmed:
- f32/f64 parse paths: T3/T6 + T5/T8 (new f32 tests) + T4/T7 (f64 existing tests)
- Unknown dtype → null: T5/T8
- ViewerState holds typed array: T10
- dtype switch without crash: T11/T12
- Visual correctness: T16 (f32), T17 (f64)
- All existing tests pass: T14
- PositionDtype constant: T1
- No raw hex literals: T1 + T3/T6
- Header constants updated: T3/T6
- dtype-specific expectedBytes: T3/T6

### [PASS] Sequencing is correct; test-with pattern followed

Parse logic tasks (T3/T6) precede their test tasks (T4/T5, T7/T8). State-layer tasks (T11/T12) follow type widening (T10). Two commit checkpoints are distributed (T9, T15), not batched at the end. No circular dependencies.

### [PASS] All tasks are independently completable

Each task has a clear file/function scope and concrete success criteria that a junior AI could verify independently. No task requires retrospective changes from downstream tasks.
