---
docType: review
layer: project
reviewType: slice
slice: entity-position-dtype-negotiation-f32-f64
project: squadron
verdict: PASS
sourceDocument: project-documents/user/slices/114-slice.entity-position-dtype-negotiation-f32-f64.md
aiModel: minimax/minimax-m2.7
status: complete
dateCreated: 20260506
dateUpdated: 20260506
findings:
  - id: F001
    severity: pass
    category: uncategorized
    summary: "Slice correctly implements additive wire protocol change"
    location: 114-slice.entity-position-dtype-negotiation-f32-f64.md#Wire Format Changes
  - id: F002
    severity: pass
    category: uncategorized
    summary: "Tier-1 error handling correctly applied for unknown dtype"
    location: 114-slice.entity-position-dtype-negotiation-f32-f64.md#protocol/deserialize.ts
  - id: F003
    severity: pass
    category: uncategorized
    summary: "ViewerState type widening aligns with ownership model"
    location: 100-arch.viewer-foundation.md#State Ownership, 114-slice.entity-position-dtype-negotiation-f32-f64.md#src/types.ts
  - id: F004
    severity: pass
    category: uncategorized
    summary: "applyStateUpdate handles dtype switch edge case explicitly"
    location: 114-slice.entity-position-dtype-negotiation-f32-f64.md#src/state.ts
  - id: F005
    severity: pass
    category: uncategorized
    summary: "Integration point with slice 113 is correctly positioned"
    location: 114-slice.entity-position-dtype-negotiation-f32-f64.md#Provides to Other Slices
  - id: F006
    severity: pass
    category: uncategorized
    summary: "Bandwidth reduction stated with specific targets"
    location: 114-slice.entity-position-dtype-negotiation-f32-f64.md#Value
  - id: F007
    severity: pass
    category: uncategorized
    summary: "Component boundaries respected; no cross-layer violations"
    location: 114-slice.entity-position-dtype-negotiation-f32-f64.md#Component Changes
  - id: F008
    severity: pass
    category: uncategorized
    summary: "Render path requires no logic changes, verified correctly"
    location: 114-slice.entity-position-dtype-negotiation-f32-f64.md#src/rendering/entities.ts
---

# Review: slice — slice 114

**Verdict:** PASS
**Model:** minimax/minimax-m2.7

## Findings

### [PASS] Slice correctly implements additive wire protocol change

The slice adds a dtype flag byte to SNAPSHOT (0x01) and STATE_UPDATE (0x02) messages at offsets 25 and 9 respectively. This is an additive change: the header grows by 1 byte, fields shift but do not change size. The architecture's protocol versioning convention explicitly states: *"A *behaviorally incompatible* change...gets a new opcode. An *additive, backward-tolerant* change...preserves the opcode."* The dtype flag is additive and backward-tolerant — a f64-only server produces messages the old viewer would still parse (reading past the new flag), and a f32-only server is handled by the new viewer reading the flag. This is a correct application of the versioning policy.

### [PASS] Tier-1 error handling correctly applied for unknown dtype

The slice specifies unknown dtype values produce `null` with `console.warn` — tier-1 behavior. This matches the architecture's explicit rule: *"malformed **stateless, per-tick** messages are logged and discarded without disconnecting."* SNAPSHOT and STATE_UPDATE are confirmed stateless per-tick frames in the architecture's error handling section. The slice does not apply tier-2 close-1002, which is correct.

### [PASS] ViewerState type widening aligns with ownership model

The architecture defines `ViewerState.positions` and `ViewerState.velocities` as `Float64Array | null`. The slice widens these to `Float32Array | Float64Array | null`. The architecture's state ownership rules assign writing to `net/connection.ts` and reading to `rendering/entities.ts`; the union type is a clean public interface that both parties agree on. The widening is minimal and well-scoped.

### [PASS] applyStateUpdate handles dtype switch edge case explicitly

The slice documents three scenarios for `applyStateUpdate`: (1) type + length match — use `.set()`, (2) lengths match but types differ (dtype switch mid-connection) — reassign buffers with a one-time warning, (3) lengths differ — existing reconnect path. This is a well-reasoned edge case enumeration that prevents the silent truncation that would occur from cross-dtype `.set()` calls. The behavior is explicitly tied to the "Server transition safety" value statement in the Overview.

### [PASS] Integration point with slice 113 is correctly positioned

The slice establishes `Float32Array | Float64Array` as the union type on `ViewerState` before slice 113 (Entity Pipeline Performance) introduces zero-copy optimization. The slice document explicitly calls this out: *"Designing it here means slice 113 needs no type changes."* This is the correct dependency direction — the optimization layer (113) builds on the established interface rather than co-designing it.

### [PASS] Bandwidth reduction stated with specific targets

The slice provides specific payload size tables: at 10k entities, STATE_UPDATE drops from ~312 KB to ~156 KB. This directly supports the architecture's performance targets (WebSocket deserialization < 1ms per message; the f32 path reads half the data). The NFR is restated with a concrete metric.

### [PASS] Component boundaries respected; no cross-layer violations

Changes are scoped to `protocol/types.ts`, `protocol/deserialize.ts` (protocol layer), `src/types.ts`, `src/state.ts` (state ownership layer), and `rendering/entities.ts` (rendering layer). These align with the architecture's component layout. No changes to `net/connection.ts` or the data flow between modules are introduced beyond what the architecture defines.

### [PASS] Render path requires no logic changes, verified correctly

The slice confirms `positions[i * 2]` indexing works identically for `Float32Array` and `Float64Array`. The architecture's entity rendering detail specifies this access pattern, and Three.js `BufferAttribute` accepts both typed array types natively. No hidden dependencies or rendering-path surprises are introduced.
