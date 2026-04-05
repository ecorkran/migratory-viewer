---
docType: review
layer: project
reviewType: arch
slice: viewer-foundation
project: squadron
verdict: CONCERNS
sourceDocument: project-documents/user/architecture/100-arch.viewer-foundation.md
aiModel: z-ai/glm-5
status: complete
dateCreated: 20260405
dateUpdated: 20260405
findings:
  - id: F001
    severity: concern
    category: completeness
    summary: "Protocol parsing has no error handling strategy"
  - id: F002
    severity: concern
    category: completeness
    summary: "WebGL context loss not addressed"
  - id: F003
    severity: concern
    category: abstraction
    summary: "State ownership between components is implicit"
  - id: F004
    severity: note
    category: completeness
    summary: "Entity lifecycle between snapshots undefined"
  - id: F005
    severity: note
    category: technology
    summary: "Three.js version reference is outdated"
  - id: F006
    severity: note
    category: completeness
    summary: "Camera transition mechanism underspecified"
---

# Review: arch — slice 100

**Verdict:** CONCERNS
**Model:** z-ai/glm-5

## Findings

### [CONCERN] Protocol parsing has no error handling strategy

The `protocol/deserialize.ts` component parses binary data with computed byte offsets into `ArrayBuffer`. The document explicitly acknowledges that "a wrong offset silently corrupts data" as a rationale for TypeScript, but does not specify what happens when malformed data arrives from the network:
- Truncated messages where byte count doesn't match the claimed entity count
- Unrecognized message type bytes (0x00, 0x10+)
- Count fields that exceed reasonable limits (malicious or buggy server)
- Endianness mismatches (document says "little-endian throughout" but DataView defaults to big-endian if not specified)

Without explicit error handling, a malformed message could cause `DataView` to read garbage values, typed array views to wrap invalid buffer ranges, or the viewer to crash. The document should specify validation at parse boundaries and recovery behavior (disconnect and reconnect? log and ignore?).

### [CONCERN] WebGL context loss not addressed

Three.js applications are vulnerable to WebGL context loss when the browser reclaims GPU resources (tab backgrounded, system memory pressure, GPU driver reset). The document does not mention:
- Listening for `webglcontextlost` and `webglcontextrestored` events on the canvas
- Recovery strategy — does the viewer re-establish the scene, reconnect to the server, request a fresh snapshot?

For a real-time simulation viewer that may run for extended periods, context loss is a realistic failure mode. The architecture should specify whether this is handled and how.

### [CONCERN] State ownership between components is implicit

The data flow diagram shows parsed snapshot data dispatched to multiple consumers:
- `rendering/terrain.ts` receives world bounds
- `rendering/entities.ts` receives entity count and profile indices
- `ui/hud.ts` receives entity counts and profile breakdown

But the document doesn't specify where state is stored or how it's shared:
- `entities.ts` needs world bounds for terrain height lookup (documented in Entity Rendering Detail: "y is terrain height lookup")
- Multiple components need profile-to-color mapping
- HUD needs current tick and entity counts

Is there a central state store? Is state passed through function parameters? Is each component responsible for its own slice? The architecture should make state ownership explicit, particularly for shared values like world bounds.

### [NOTE] Entity lifecycle between snapshots undefined

The protocol design implies entity counts are stable between SNAPSHOT messages — STATE_UPDATE only carries positions and velocities, not add/remove events. The document should clarify:
- Does the server send a new SNAPSHOT when entity count changes?
- What happens if STATE_UPDATE count differs from the last SNAPSHOT count?
- Is entity creation/deletion out of scope for v1, or is this a protocol gap?

The connection lifecycle section says "On reconnect, the server sends a fresh snapshot — the viewer resets its state entirely" but doesn't address normal session entity lifecycle.

### [NOTE] Three.js version reference is outdated

The document specifies "Three.js version should be r128+ for stable InstancedMesh APIs." Current Three.js is r160+. While r128 (2021) works and has stable InstancedMesh, it misses four years of performance improvements, bug fixes, and API refinements. This is not blocking but the document should either:
- Target a current version (r155+)
- Acknowledge the older version is intentional for stability reasons

### [NOTE] Camera transition mechanism underspecified

The document states "Smooth animated transitions between modes let users explore both views naturally" but doesn't specify the mechanism. Slice 104 (Camera Modes) will presumably address this, but the architecture could note whether this requires:
- External library (GSAP, Tween.js)
- Three.js built-in utilities
- Custom lerp implementation

This is defensible as implementation detail, but worth flagging since camera transitions between orthographic and perspective projections are non-trivial.
