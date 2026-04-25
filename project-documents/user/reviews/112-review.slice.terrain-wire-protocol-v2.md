---
docType: review
layer: project
reviewType: slice
slice: terrain-wire-protocol-v2
project: squadron
verdict: CONCERNS
sourceDocument: project-documents/user/slices/112-slice.terrain-wire-protocol-v2.md
aiModel: z-ai/glm-5.1
status: complete
dateCreated: 20260424
dateUpdated: 20260424
findings:
  - id: F001
    severity: concern
    category: error-handling
    summary: "Protocol error handling contradicts architecture decision"
    location: TD-7
  - id: F002
    severity: concern
    category: dependencies
    summary: "Third-party runtime dependencies violate architecture constraint"
    location: TD-4
  - id: F003
    severity: concern
    category: architectural-alignment
    summary: "Architecture document needs updating for v2 protocol additions"
    location: Architecture §Component Architecture, §Data Flow, §Protocol Error Handling
  - id: F004
    severity: pass
    category: integration
    summary: "Renderer interface preserved correctly"
  - id: F005
    severity: pass
    category: dependency-direction
    summary: "Dependency direction is correct"
  - id: F006
    severity: pass
    category: scope
    summary: "Scope is well-bounded with clear non-goals"
  - id: F007
    severity: note
    category: protocol-design
    summary: "Opcode versioning claim appears internally contradictory"
    location: Context section
  - id: F008
    severity: pass
    category: state-management
    summary: "State ownership rules preserved"
---

# Review: slice — slice 112

**Verdict:** CONCERNS
**Model:** z-ai/glm-5.1

## Findings

### [CONCERN] Protocol error handling contradicts architecture decision

The architecture document states as a binding decision: *"Validate at parse boundaries; discard malformed frames without disconnecting"* and *"Recovery behavior: On any validation failure, log a warning with the failure reason and raw byte context, then discard the frame. Do not disconnect."* The slice's TD-7 introduces `ws.close(1002, reason)` for terrain protocol errors, directly contradicting this architecture-level decision. While the slice provides reasonable justification (corrupt grid risk, chunked state machine makes skip-and-continue dangerous) and scopes the change carefully to terrain opcodes only, the architecture document must be updated to reflect the new two-tier error policy. As written, implementing this slice would violate the architecture. The architecture's "Protocol Error Handling" section should be amended to distinguish between stateless message types (discard + log) and stateful/chunked message types (close 1002).

### [CONCERN] Third-party runtime dependencies violate architecture constraint

The architecture document explicitly states under External Dependencies: *"No other runtime dependencies in v1."* TD-4 adds `fzstd` (~10 KB) and `lz4js` (~30 KB) as runtime npm dependencies. This is necessitated by the v2 wire protocol's compression requirement, which didn't exist when the architecture was written, but the architecture's dependency section must be updated before or alongside this slice. The slice should explicitly flag that this requires an architecture amendment to the "Third-Party" table. The bundle-size analysis in TD-4 is thorough, but the architecture constraint is unconditional as written.

### [CONCERN] Architecture document needs updating for v2 protocol additions

The architecture document's component structure shows `protocol/` containing only `types.ts` and `deserialize.ts`. The slice introduces `terrain-assembler.ts` and `decompress.ts`. The data flow diagram shows `WebSocket → deserialize.ts → connection.ts`, but the slice routes all frames through `TerrainAssembler.feed()` instead. The "Protocol summary" only documents opcodes `0x01` and `0x02`; `0x03`/`0x04`/`0x05` are not listed. The `ViewerState` interface doesn't mention terrain-related fields. These are not violations by the slice itself, but the architecture document is now materially out of date. The slice should include a task to update the architecture document's component diagram, data flow, protocol summary, and dependency table to reflect the v2 additions, or an explicit follow-up should be noted.

### [PASS] Renderer interface preserved correctly

The slice explicitly maintains the `ParsedTerrain` shape (Float64Array elevation grid with rows, cols, resolution, originX, originY) identical to slice 102. The renderer (`rendering/terrain.ts`) requires zero code changes. This aligns with the architecture's layered component boundaries where the protocol layer is an internal detail and the rendering layer consumes stable parsed types.

### [PASS] Dependency direction is correct

The new protocol-layer files (`terrain-assembler.ts`, `decompress.ts`) depend only on each other, `types.ts`, and the third-party decompressor packages. They do not import from `rendering/`, `ui/`, or `net/`. The connection layer (`net/connection.ts`) depends on the assembler, maintaining the architecture's unidirectional data flow from network → protocol → state → rendering.

### [PASS] Scope is well-bounded with clear non-goals

The slice correctly limits itself to the viewer-side protocol changes. Non-goals explicitly exclude server-side changes, renderer changes, re-quantization, general protocol-error policy for entity-state opcodes, and protocol-version negotiation. This disciplined scoping prevents creep into slices 110/111 (terrain material) and avoids a behavioral regression in entity-state handling.

### [NOTE] Opcode versioning claim appears internally contradictory

The slice states: *"Per the migratory protocol-versioning convention, opcodes are stable forever and breaking changes get new opcodes."* It then describes `0x03 TERRAIN`'s payload format changing (gaining a flags byte and conditional dequant range). If breaking changes get new opcodes, a payload format change on `0x03` would seem to violate that convention. This is a server-side design decision reflected in the captured spec, not a viewer architecture issue, but it's worth noting that the convention as stated doesn't match the actual protocol evolution. The viewer is a passive consumer and correctly implements what the spec declares, so this is informational only.

### [PASS] State ownership rules preserved

The architecture specifies that `net/connection.ts` is the sole writer to `ViewerState`. The assembler does not write to `ViewerState`; it returns parsed results that the connection layer applies. On reconnect, the assembler is discarded and recreated, which aligns with the architecture's "reset state entirely rather than trying to reconcile stale data" policy. The `stateUpdatesStarted` boolean on the assembler is protocol-internal state, not viewer state, so it doesn't violate the ownership rules.
