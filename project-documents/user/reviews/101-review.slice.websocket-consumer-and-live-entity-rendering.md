---
docType: review
layer: project
reviewType: slice
slice: websocket-consumer-and-live-entity-rendering
project: squadron
verdict: PASS
sourceDocument: project-documents/user/slices/101-slice.websocket-consumer-and-live-entity-rendering.md
aiModel: minimax/minimax-m2.7
status: complete
dateCreated: 20260406
dateUpdated: 20260406
findings:
  - id: F001
    severity: pass
    category: protocol-correctness
    summary: "All four validation rules correctly implemented"
    location: protocol/deserialize.ts
  - id: F002
    severity: pass
    category: protocol-correctness
    summary: "Binary protocol format matches architecture byte-for-byte"
    location: protocol/deserialize.ts
  - id: F003
    severity: pass
    category: state-management
    summary: "State ownership model enforced correctly"
    location: net/connection.ts, rendering/entities.ts
  - id: F004
    severity: pass
    category: architecture-structure
    summary: "Component structure matches architecture"
  - id: F005
    severity: pass
    category: dependencies
    summary: "External dependencies correctly identified"
  - id: F006
    severity: pass
    category: performance
    summary: "InstancedMesh allocation strategy matches performance goals"
  - id: F007
    severity: pass
    category: scope-management
    summary: "Scope boundaries respected"
  - id: F008
    severity: pass
    category: code-quality
    summary: "Little-endian enforcement through internal helpers"
  - id: F009
    severity: pass
    category: correctness
    summary: "Binary type configured before message handling"
    location: net/connection.ts
  - id: F010
    severity: pass
    category: integration
    summary: "Interface provision to dependent slices documented"
    location: Integration Points section
  - id: F011
    severity: note
    category: documentation
    summary: "ViewerState placement rationale documented"
    location: Technical Decisions, Module Placement section
  - id: F012
    severity: note
    category: documentation
    summary: "Entity behavior on disconnect documented as known limitation"
    location: Verification Walkthrough
---

# Review: slice — slice 101

**Verdict:** PASS
**Model:** minimax/minimax-m2.7

## Findings

### [PASS] All four validation rules correctly implemented

The slice implements all validation rules from the architecture:
1. Unknown message type byte rejection
2. Buffer length vs. claimed entity count verification
3. Entity count sanity cap (config.maxEntityCount)
4. Little-endian discipline via internal helper functions

The architecture explicitly requires these four rules. The slice matches exactly.

### [PASS] Binary protocol format matches architecture byte-for-byte

SNAPSHOT layout (25 + N×36 bytes) and STATE_UPDATE layout (9 + N×32 bytes) match the architecture specification exactly. The typed array approach using DataView for headers and Float64Array/Int32Array for payload sections is the correct implementation of the architecture's binary protocol decision.

### [PASS] State ownership model enforced correctly

The architecture defines net/connection.ts as the **sole writer** to ViewerState. The slice enforces this correctly:
- `net/connection.ts` calls `viewerState.applySnapshot()` and `viewerState.applyStateUpdate()`
- `rendering/entities.ts` reads only — `updateEntities()` reads from viewerState without writing
- SNAPSHOT replaces all fields atomically; STATE_UPDATE mutates only positions, velocities, currentTick

This is a clean implementation of the architecture's state ownership rules.

### [PASS] Component structure matches architecture

```
src/
├── main.ts
├── config.ts
├── types.ts
├── protocol/
│   ├── types.ts
│   └── deserialize.ts
├── net/
│   └── connection.ts
└── rendering/
    └── entities.ts
```

This matches the architecture's component structure exactly. The `protocol/` and `net/` directories come into existence in this slice as specified.

### [PASS] External dependencies correctly identified

The slice correctly references:
- **Slice 305 (WebSocket Client Layer)** — complete
- **Slice 306 (State Serialization and Protocol)** — complete
- **Reference files:** `user/reference/server/306-slice.state-serialization-and-protocol.md` and `user/reference/server/protocol.py`

All referenced server slices are marked complete in the architecture. No unresolved dependencies.

### [PASS] InstancedMesh allocation strategy matches performance goals

The slice allocates `InstancedMesh` once at `config.maxEntityCount` capacity and uses `mesh.count` to control rendered instances. This directly implements the architecture's performance target of avoiding per-snapshot mesh reallocation. The architecture explicitly mentions that InstancedMesh "issues a single draw call for all instances" — this approach enables that optimization.

### [PASS] Scope boundaries respected

The slice correctly excludes:
- Terrain displacement (slice 102)
- Environment overlays (slice 103)
- Connection status UI/HUD (slice 105)
- Performance profiling and buffer reuse (slice 106)
- Production build configuration (slice 107)
- Client-to-server commands (v1 is server-push only)

The "Excluded" section is thorough and consistent with the architecture's slice plan decomposition.

### [PASS] Little-endian enforcement through internal helpers

The slice implements `readU32LE`/`readF64LE` helper functions that always pass `true` for the littleEndian parameter. The architecture explicitly requires this as a "coding discipline requirement" and the slice correctly enforces it at the module boundary rather than relying on callers to remember.

### [PASS] Binary type configured before message handling

The slice sets `ws.binaryType = 'arraybuffer'` immediately after `new WebSocket()`. This is required because the default `'blob'` type would require async conversion. The architecture does not explicitly mention this detail, but the slice's implementation is necessary for correct binary frame handling.

### [PASS] Interface provision to dependent slices documented

The slice documents what it provides to slices 102, 103, and 105:
- ViewerState for terrain bounds and entity data
- Connection status for HUD
- Protocol deserializer for future extension

This integration mapping matches the architecture's data flow description and ensures dependent slices know what to consume.

### [NOTE] ViewerState placement rationale documented

The slice considers `protocol/types.ts` vs. `protocol/state.ts` vs. `src/types.ts` and documents the decision to place ViewerState in `src/types.ts` to follow slice 100's convention. While the architecture specifies `protocol/types.ts` for "protocol-specific message types," ViewerState is defined as shared infrastructure in the architecture's own State Ownership section. The slice's rationale is sound and consistent with the existing codebase convention.

### [NOTE] Entity behavior on disconnect documented as known limitation

The verification walkthrough states that entities "continue rendering their last known positions briefly" when disconnected, then documents this as "v1 behavior — clearing on disconnect is future work." The architecture specifies that "on reconnect, the server sends a fresh snapshot — the viewer resets its state entirely," but this applies to the reconnection flow, not to handling disconnection mid-session. The slice correctly documents this scope limitation rather than over-implementing.
