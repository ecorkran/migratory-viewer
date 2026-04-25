---
docType: review
layer: project
reviewType: tasks
slice: terrain-wire-protocol-v2
project: squadron
verdict: CONCERNS
sourceDocument: project-documents/user/tasks/112-tasks.terrain-wire-protocol-v2.md
aiModel: z-ai/glm-5.1
status: complete
dateCreated: 20260424
dateUpdated: 20260424
findings:
  - id: F001
    severity: pass
    category: completeness
    summary: "All success criteria traced to tasks"
  - id: F002
    severity: concern
    category: completeness
    summary: "SC3 integrated test scenario not fully covered"
    location: Phase D — T10
  - id: F003
    severity: concern
    category: process
    summary: "Sparse explicit commit checkpoints"
    location: T0–T16
  - id: F004
    severity: pass
    category: sequencing
    summary: "Test-with pattern consistently followed"
  - id: F005
    severity: pass
    category: sequencing
    summary: "Task sequencing respects all dependencies"
  - id: F006
    severity: pass
    category: completeness
    summary: "All TD-7 protocol-error conditions covered by tests"
  - id: F007
    severity: note
    category: task-sizing
    summary: "T9 and T10 are large tasks but well-specified"
  - id: F008
    severity: pass
    category: scope
    summary: "No scope creep identified"
---

# Review: tasks — slice 112

**Verdict:** CONCERNS
**Model:** z-ai/glm-5.1

## Findings

### [PASS] All success criteria traced to tasks

Every success criterion (SC1–SC9) from the slice design has at least one corresponding task. SC1 (worked 2×2 f32+zstd example) → T8; SC2 (9 single-shot combos) → T8; SC3 (chunked non-square ≥4 chunks, all combos, non-sequential) → T10; SC4 (protocol-error catalog + ws.close(1002)) → T4/T6/T8/T10/T12; SC5 (duplicate seq same coords) → T10; SC6 (uint16 dequant) → T8; SC7 (renderer unchanged) → T11/T15; SC8 (no hex literals) → T1/T14; SC9 (quality gates) → T15.

### [CONCERN] SC3 integrated test scenario not fully covered

Success criterion SC3 requires the assembler to decode "a synthetic chunked terrain (≥ 4 chunks partitioning a non-square grid) at every dtype × compression combination, with chunks delivered in non-sequential (row_offset, col_offset) order." The T10 tests decompose these properties across separate tests but no single test combines all four: **non-square grid**, **≥4 chunks**, **all 9 dtype × compression combos**, and **non-sequential delivery**. Specifically: the "all 9 combos" test uses a 4×4 (square) grid; the "non-square grid" test uses an 8×12 grid but with only 3 strips (3 chunks, not ≥4); the "out-of-order chunks" test uses a 6×6 (square) grid. While each property is individually validated, the specific integrated scenario SC3 describes — where all properties are exercised together — is missing. Adding a test case such as an 8×12 grid with ≥4 non-uniform chunks, all 9 combos, delivered out-of-order would close this gap.

### [CONCERN] Sparse explicit commit checkpoints

Only T0 (`chore: add fzstd and lz4js`) and T16 (`docs: mark slice 112 complete`) include explicit commit instructions. Across 16 tasks spanning 6 phases, there are no directed commits at natural boundaries like after each test-with pair (T1+T2, T3+T4, T5+T6, T7+T8, T9+T10, T11+T12) or after the opcode audit (T14). A junior AI following the checklist literally could accumulate a large uncommitted changeset, risking significant work loss if something goes wrong mid-slice. Adding commit instructions at each phase boundary or after each implementation+test pair would mitigate this risk.

### [PASS] Test-with pattern consistently followed

Every implementation task is immediately followed by its corresponding test task: T1→T2, T3→T4, T5→T6, T7→T8, T9→T10, T11→T12. This is well-structured and ensures each component is validated before the next layer is built on top of it.

### [PASS] Task sequencing respects all dependencies

The dependency chain is sound: T0 (branch setup) → T1 (types, needed by everything) → T3 (decompress, needed by T7) → T5 (assembler skeleton, needed by T7) → T7 (single-shot, needed by T9) → T9 (chunked, needed by T11) → T11 (connection integration, needed by T12) → T13/T14/T15/T16. No circular dependencies exist. Phase ordering rationale in the context summary is clear and justified.

### [PASS] All TD-7 protocol-error conditions covered by tests

Every row in TD-7's protocol-error catalog has a corresponding test: reserved flag bits (T8), unknown dtype (T8), unknown compression (T8), TERRAIN_CHUNK without header (T10), TERRAIN_HEADER mid-chunk (T10), TERRAIN single-shot mid-chunk (T10), coverage validation failure — missing chunk and overlap (T10), malformed compressed payload (T4), TERRAIN* after STATE_UPDATE (T8, T10), unknown leading byte (T6), duplicate seq with different coords (T10). The recoverable case (duplicate seq, same coords) is also covered (T10). Connection-layer ws.close(1002) is exercised in T12.

### [NOTE] T9 and T10 are large tasks but well-specified

T9 (chunked path implementation, 4/5 effort) and T10 (chunked path tests, 4/5 effort) are the largest tasks. T9 encompasses header parsing, chunk parsing, bounds checking, duplicate detection, grid write-in, coverage validation, and state reset — a substantial implementation surface. However, the task description is extremely detailed with clear sub-steps, byte-level offsets, and unambiguous success criteria, making it completable by a junior AI without guesswork. Similarly, T10's ~15 test cases are individually well-specified. While these could theoretically be split (e.g., T9a: header parse + state transition, T9b: chunk parse + write, T9c: coverage validation + reset), the current granularity is acceptable given the quality of specification.

### [PASS] No scope creep identified

All tasks trace directly to slice design requirements, technical decisions, or necessary project infrastructure (branch setup, quality gates, closeout). T13 (live-server verification) maps to the slice's Verification Walkthrough section. T14 (opcode audit) maps to SC8. T15 (quality gates) maps to SC9. No tasks introduce functionality beyond what the slice design specifies.
