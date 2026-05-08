---
docType: review
layer: project
reviewType: slice
slice: wire-header-alignment-and-zero-copy-deserialization
project: squadron
verdict: PASS
sourceDocument: project-documents/user/slices/115-slice.wire-header-alignment-and-zero-copy-deserialization.md
aiModel: minimax/minimax-m2.7
status: complete
dateCreated: 20260507
dateUpdated: 20260507
findings:
  - id: F001
    severity: note
    category: performance
    summary: "Zero-copy approach aligns with architecture's performance intent"
    location: project-documents/user/slices/115-slice.wire-header-alignment-and-zero-copy-deserialization.md#Value
  - id: F002
    severity: concern
    category: specification-consistency
    summary: "SNAPSHOT `schema_version` placement requires pre-implementation confirmation"
    location: project-documents/user/slices/115-slice.wire-header-alignment-and-zero-copy-deserialization.md#Wire Format — SNAPSHOT (0x01)
  - id: F003
    severity: pass
    category: error-handling
    summary: "Tier-1 error handling policy correctly implemented"
    location: project-documents/user/slices/115-slice.wire-header-alignment-and-zero-copy-deserialization.md#Technical Scope
  - id: F004
    severity: pass
    category: correctness
    summary: "Buffer lifetime safety is correctly handled for STATE_UPDATE and SNAPSHOT"
    location: project-documents/user/slices/115-slice.wire-header-alignment-and-zero-copy-deserialization.md#src/state.ts — applySnapshot correctness fix
  - id: F005
    severity: pass
    category: interface-compatibility
    summary: "Typed array dtype support extends, not violates, architecture's type strategy"
    location: project-documents/user/slices/115-slice.wire-header-alignment-and-zero-copy-deserialization.md#Technical Scope
  - id: F006
    severity: pass
    category: integration
    summary: "Cross-slice effects are correctly enumerated"
    location: project-documents/user/slices/115-slice.wire-header-alignment-and-zero-copy-deserialization.md#Cross-Slice Effects
  - id: F007
    severity: pass
    category: development-process
    summary: "Development order correctly prioritizes type constant before parser changes"
    location: project-documents/user/slices/115-slice.wire-header-alignment-and-zero-copy-deserialization.md#Implementation Notes
  - id: F008
    severity: pass
    category: scope
    summary: "Out-of-scope exclusions are well-reasoned and respect architectural boundaries"
    location: project-documents/user/slices/115-slice.wire-header-alignment-and-zero-copy-deserialization.md#Technical Scope
  - id: F009
    severity: pass
    category: testing
    summary: "Test coverage comprehensively validates zero-copy contract"
    location: project-documents/user/slices/115-slice.wire-header-alignment-and-zero-copy-deserialization.md#Success Criteria
---

# Review: slice — slice 115

**Verdict:** PASS
**Model:** minimax/minimax-m2.7

## Findings

### [NOTE] Zero-copy approach aligns with architecture's performance intent

The architecture's "WebSocket deserialization < 1ms per message" target is not explicitly restated, but the slice's core motivation (eliminating per-tick `buffer.slice()` calls that generate ~96 MB/s GC pressure) directly targets this requirement. The explicit memory pressure metric provides measurable validation that the optimization serves the NFR.

### [CONCERN] SNAPSHOT `schema_version` placement requires pre-implementation confirmation

The slice correctly identifies an internal inconsistency in the referenced migratory slice 321: its text says "schema_version at offset 10 in both" messages, but offset 10 in the existing SNAPSHOT layout (after slice 114) falls within the already-occupied `world_width` f64 field (offsets 5–12). The slice's proposed workaround (offset 26) is the only position that preserves existing fields, but this is an assumption about producer behavior that must be validated.

The design appropriately includes a pre-implementation action flagging this contradiction. Until the producer team confirms the actual byte position, the SNAPSHOT parser offsets remain undetermined.

### [PASS] Tier-1 error handling policy correctly implemented

`schema_version` mismatch on both SNAPSHOT and STATE_UPDATE results in `console.warn + return null` without connection close. This matches the architecture's tier-1 policy: "stateless, per-tick frames... log and discard without disconnecting." The tier-1 path through `assembler.feed → {kind: 'pending'} → message dropped` is explicitly preserved.

### [PASS] Buffer lifetime safety is correctly handled for STATE_UPDATE and SNAPSHOT

The architecture's `ViewerState` holds positions/velocities as persistent arrays, and the data flow shows these are updated each tick. For STATE_UPDATE, the zero-copy views alias the wire buffer, but `applyStateUpdate` copies via `.set()` before the next `onmessage` — this contract (established in slice 113) is unchanged.

For SNAPSHOT, the slice identifies the subtle issue: `applySnapshot` previously benefited from the parser's `buffer.slice()` creating a detached copy. With zero-copy views, `applySnapshot` must explicitly copy using `.slice()` on typed arrays. The proposed fix (`state.positions = parsed.positions.slice()`) is correct — `.slice()` on a typed array returns a new typed array backed by its own `ArrayBuffer`, safely detaching from the wire buffer.

### [PASS] Typed array dtype support extends, not violates, architecture's type strategy

The architecture's `ViewerState` specifies `Float64Array`, and slice 114 introduced a dtype negotiation flag at offset 9. This slice implements both F32 and F64 support as specified by that prior work. The `Ctor` pattern in `applySnapshot` correctly branches on runtime dtype. No architectural constraint is violated — the architecture did not mandate F64-only; it documented F64 as the current wire format.

### [PASS] Cross-slice effects are correctly enumerated

Explicitly calling out that `net/connection.ts`, `rendering/entities.ts`, and slice 113's `entityHeights` bake are unchanged is correct. These components read from the persistent `state.positions` after `applyStateUpdate` copies into it — the zero-copy path at parse time is invisible at these layers.

### [PASS] Development order correctly prioritizes type constant before parser changes

The recommended development sequence adds `WIRE_SCHEMA_VERSION` to `protocol/types.ts` first, then updates header constants, then replaces `buffer.slice()` with views, then fixes `applySnapshot`, then updates fixtures and tests. This ordering ensures the single-source-of-truth constant is available when the parser branches are modified, satisfying the architecture's rule about defining values once and referencing everywhere.

### [PASS] Out-of-scope exclusions are well-reasoned and respect architectural boundaries

Explicitly excluding mmap regions, `TICK_AVAILABLE`, and `SERVER_HELLO`/`CLIENT_HELLO` is correct. The architecture describes the viewer as a "browser-based" application; mmap access is unavailable by platform constraint. The cross-slice note ("a same-host non-browser viewer built later can reuse the wire-alignment work") correctly isolates the shared concern without over-engineering.

### [PASS] Test coverage comprehensively validates zero-copy contract

The buffer-identity assertion (`parsed.positions.buffer === incomingBuffer` with `byteOffset === 16`) provides mechanical proof that the typed array view is a direct alias, not a copy. This is the correct test for the zero-copy guarantee. The detach test for `applySnapshot` (mutating the view's underlying buffer does not affect `state.positions`) validates the safety fix.
