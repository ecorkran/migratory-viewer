---
docType: review
layer: project
reviewType: slice
slice: terrain-surface-material
project: squadron
verdict: PASS
sourceDocument: project-documents/user/slices/110-slice.terrain-surface-material.md
aiModel: z-ai/glm-5.1
status: complete
dateCreated: 20260422
dateUpdated: 20260422
findings:
  - id: F001
    severity: pass
    category: architecture
    summary: "Component structure alignment"
  - id: F002
    severity: pass
    category: dependencies
    summary: "Dependency direction correctness"
  - id: F003
    severity: pass
    category: integration
    summary: "Integration points match consuming slice expectations"
  - id: F004
    severity: note
    category: naming
    summary: "BiomeConfig naming overlap with slice 109"
  - id: F005
    severity: pass
    category: technology-alignment
    summary: "WebGPU/TSL approach consistency"
  - id: F006
    severity: pass
    category: state-management
    summary: "State ownership and data flow compliance"
  - id: F007
    severity: pass
    category: breaking-changes
    summary: "groundColor removal properly scoped"
---

# Review: slice — slice 110

**Verdict:** PASS
**Model:** z-ai/glm-5.1

## Findings

### [PASS] Component structure alignment

The slice's changes map directly to the architecture's component structure: `BiomeConfig` and `ViewerConfig` changes in `config.ts`, material and handle logic in `rendering/terrain.ts`, lighting parameter tuning through `config.ts` into `rendering/scene.ts`. No new files are introduced outside the defined component tree, and each change lands in the architecturally appropriate module.

### [PASS] Dependency direction correctness

The slice correctly depends on slice 102 (Terrain Rendering) as a prerequisite, which aligns with the architecture's data flow — `terrain.ts` produces the mesh with computed vertex normals that this slice's `normalWorld.y` blending requires. The slice does not introduce any reverse dependencies or circular references. `BiomeConfig` is viewer-side configuration in `ViewerConfig`, not server-derived state, so it correctly stays outside the `ViewerState` ownership rules (where `net/connection.ts` is the sole writer).

### [PASS] Integration points match consuming slice expectations

The slice explicitly provides `TerrainMaterialHandle`, `BiomeConfig`, and the `updateBiome()` pattern to slice 111. This directly supports the architecture's slice plan entry for 111: "texture maps on surface material via `BiomeConfig`; triplanar UV sampling in TSL." The interface boundary design — returning a handle rather than exposing raw uniforms — gives slice 111 a clean extension point (e.g., `updateTextures()`).

### [NOTE] BiomeConfig naming overlap with slice 109

The architecture defines slice 109 (Biome Rendering) as "Biome-id coloring atop terrain," gated on server-side migratory slice 502. Slice 110's `BiomeConfig` is a local viewer-side visual configuration struct for slope-based blending — a different concept. While the architecture's slice plan explicitly planned for `BiomeConfig` in slice 110 (so there is no scope creep), the shared "Biome" prefix could cause confusion when slice 109 is implemented. When the server-driven biome protocol arrives, slice 109 will need to map server biome IDs to viewer-side appearance — potentially consuming or composing with this `BiomeConfig`. This is not a blocking issue, but worth awareness during slice 109 design.

### [PASS] WebGPU/TSL approach consistency

The use of `MeshStandardNodeMaterial` with TSL node graphs is consistent with the architecture's decision to use `WebGPURenderer` via `three/webgpu`. The architecture notes that the WebGPU path "unlocks compute shaders for future performance work" — the TSL node material approach is the correct Three.js abstraction for this renderer. The slice correctly identifies that `normalWorld`, `smoothstep`, and `mix` compile to both WGSL and GLSL, maintaining the architecture's WebGL 2 fallback guarantee.

### [PASS] State ownership and data flow compliance

The slice does not modify `ViewerState` or its ownership rules. `BiomeConfig` is added to `ViewerConfig` (static configuration), not `ViewerState` (server-derived runtime state). The `updateBiome()` method operates on rendering internals (uniform values), not on shared state. No component other than `terrain.ts` needs to read or write the material handle, so module-level storage of the handle does not violate the architecture's state ownership principles.

### [PASS] groundColor removal properly scoped

The removal of `groundColor` from `ViewerConfig` is acknowledged with a clear migration path: consumers (specifically `hud.ts`) must be updated to use `biomeConfig.surfaceColor`. The changes summary table explicitly calls this out. The replacement is architecturally sound — a single flat color is correctly superseded by the richer `BiomeConfig` that provides both surface and cliff colors.
