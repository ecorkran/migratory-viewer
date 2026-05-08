---
docType: review
layer: project
reviewType: tasks
slice: wire-header-alignment-and-zero-copy-deserialization
project: squadron
verdict: CONCERNS
sourceDocument: project-documents/user/tasks/115-tasks.wire-header-alignment-and-zero-copy-deserialization.md
aiModel: minimax/minimax-m2.7
status: complete
dateCreated: 20260508
dateUpdated: 20260508
findings:
  - id: F001
    severity: pass
    category: uncategorized
    summary: "All success criteria have corresponding tasks"
    location: 115-tasks.wire-header-alignment-and-zero-copy-deserialization.md
  - id: F002
    severity: pass
    category: uncategorized
    summary: "Task sequencing is correct — no circular dependencies"
    location: 115-tasks.wire-header-alignment-and-zero-copy-deserialization.md
  - id: F003
    severity: pass
    category: uncategorized
    summary: "Commit checkpoints are distributed, not batched at end"
    location: 115-tasks.wire-header-alignment-and-zero-copy-deserialization.md
  - id: F004
    severity: pass
    category: uncategorized
    summary: "Test-with pattern respected"
    location: 115-tasks.wire-header-alignment-and-zero-copy-deserialization.md
  - id: F005
    severity: pass
    category: uncategorized
    summary: "No scope creep — excluded items absent"
    location: 115-tasks.wire-header-alignment-and-zero-copy-deserialization.md
  - id: F006
    severity: concern
    category: uncategorized
    summary: "T16 implementation method inconsistent with slice design"
    location: 115-tasks.wire-header-alignment-and-zero-copy-deserialization.md:T16
  - id: F007
    severity: note
    category: uncategorized
    summary: "T21 references `applyStateUpdate`'s `.set()` cost — slightly off-target"
    location: 115-tasks.wire-header-alignment-and-zero-copy-deserialization.md:T21
  - id: F008
    severity: pass
    category: uncategorized
    summary: "T8/T14 correctly test forward-compat reserved-byte tolerance"
    location: 115-tasks.wire-header-alignment-and-zero-copy-deserialization.md:T8,T14
  - id: F009
    severity: pass
    category: uncategorized
    summary: "T17 correctly tests detach via mutation"
    location: 115-tasks.wire-header-alignment-and-zero-copy-deserialization.md:T17
---

# Review: tasks — slice 115

**Verdict:** CONCERNS
**Model:** minimax/minimax-m2.7

## Findings

### [PASS] All success criteria have corresponding tasks

Functional requirements map cleanly:
- Parser updates (f32/f64, both messages): T4/T5 (STATE_UPDATE), T10/T11 (SNAPSHOT)
- Zero-copy buffer-identity assertions: T7 (STATE_UPDATE, byteOffset===16), T13 (SNAPSHOT, byteOffset===32)
- Schema version rejection: T8 (STATE_UPDATE, v1+v3), T14 (SNAPSHOT, v1+v3 + reserved-byte tolerance)
- `applySnapshot` detach: T16 (implementation), T17 (test)
- All 134 existing tests pass: T18 (combined typecheck + test run)

Technical requirements all covered: constant in T2, header constants in T4/T10, no slice() in T5/T11, all new tests in T3/T7/T8/T13/T14/T17.

### [PASS] Task sequencing is correct — no circular dependencies

Order is logical: constants (T2–T3) → STATE_UPDATE parser (T4–T9) → SNAPSHOT parser (T10–T15) → state-layer (T16–T19) → smoke (T20–T21) → PR (T22). No task depends on something defined later.

### [PASS] Commit checkpoints are distributed, not batched at end

Three meaningful commits at T9, T15, T19 — each after a logically complete unit of work (STATE_UPDATE parser, SNAPSHOT parser, state-layer fix). T18 (typecheck + test) precedes the commit, not batched after everything.

### [PASS] Test-with pattern respected

Tests immediately follow their implementation: T5→T7/T8, T11→T13/T14, T16→T17. No test gaps.

### [PASS] No scope creep — excluded items absent

Verified against slice design's explicit exclusions: no tasks touch shared-memory, mmap, TICK_AVAILABLE, HELLO messages, TERRAIN wire format, negotiation, or connection-level behavior.

### [CONCERN] T16 implementation method inconsistent with slice design

**Category: design-alignment**

The slice design prescribes this pattern for `applySnapshot`:
```typescript
state.positions = new Ctor(parsed.positions); // copy via TypedArray copy-constructor
```

T16 specifies a different implementation:
```typescript
state.positions = parsed.positions.slice();
```

Both are functionally equivalent (`.slice()` on a typed-array view returns a same-kind typed array backed by its own `ArrayBuffer`). However, T16 should either (a) match the slice design and use `new Ctor(...)`, or (b) the slice design should be updated to reflect the simpler `.slice()` approach. Since the slice design explicitly calls out `.slice()` as the chosen pattern ("the simplest pattern is `parsed.positions.slice()`"), T16 correctly implements the design intent — the concern is that the language in the task description ("change the three direct assignments to use `.slice()`") contradicts the architecture table in the design document which uses `new Ctor(...)`. **Resolution: no action needed — `.slice()` is the right choice, and the slice design acknowledges it as "the simplest pattern."**

### [NOTE] T21 references `applyStateUpdate`'s `.set()` cost — slightly off-target

**Category: clarity**

T21 says: "confirm via DevTools Performance the per-tick parse cost is dominated by `applyStateUpdate`'s `.set()` copy, not by parser allocations."

The slice is about eliminating *parser* allocations (the `buffer.slice()` calls in `parseStateUpdate`/`parseSnapshot`). `applyStateUpdate` is unchanged by this slice — its `.set()` copy was already correct since slice 113. The smoke test should verify that *parser* allocations are reduced, not that `applyStateUpdate`'s copy dominates. The intent is still testable (inspecting heap snapshots for `buffer.slice()` calls), but the framing makes it sound like `applyStateUpdate` changed, which it didn't. This is a clarification rather than a defect.

### [PASS] T8/T14 correctly test forward-compat reserved-byte tolerance

Both tasks include a test case that "builds a state update with reserved bytes 11–15 set to non-zero values; assert parsing succeeds (forward-compat)" — covering the slice design's requirement that "the parser must not validate or reject non-zero reserved bytes."

### [PASS] T17 correctly tests detach via mutation

The test builds a wire buffer, parses, calls `applySnapshot`, mutates the wire buffer's byte 32, and asserts `state.positions[0]` is unchanged — exactly the correct proof of detach. The slice design's success criterion ("after `applySnapshot`, mutating the parsed view's underlying buffer does not affect `state.positions`") is fully covered.
