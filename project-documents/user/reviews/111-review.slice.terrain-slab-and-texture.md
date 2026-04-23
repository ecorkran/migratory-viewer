---
docType: review
layer: project
reviewType: slice
slice: terrain-slab-and-texture
project: squadron
verdict: UNKNOWN
sourceDocument: project-documents/user/slices/111-slice.terrain-slab-and-texture.md
aiModel: z-ai/glm-5.1
status: complete
dateCreated: 20260423
dateUpdated: 20260423
findings:
  - id: F001
    severity: pass
    category: scope
    summary: "Scope aligns with architecture definition"
  - id: F002
    severity: pass
    category: dependencies
    summary: "Dependency directions and integration points correct"
  - id: F003
    severity: pass
    category: component-structure
    summary: "New slab.ts module is a justified rendering layer extension"
  - id: F004
    severity: note
    category: specification-completeness
    summary: "Multiple implementation-time decisions deferred"
  - id: F005
    severity: note
    category: technical-risk
    summary: "Texture tiling scale API not confirmed against Three.js r183+"
  - id: F006
    severity: note
    category: risk
    summary: "Open issue #1 may become a blocker for slab visual verification"
---

# Review: slice — slice 111

**Verdict:** UNKNOWN
**Model:** z-ai/glm-5.1

## Findings

### [PASS] Scope aligns with architecture definition

The architecture's slice table defines slice 111 entry reads: *"Geological slab depth (side walls + bottom); texture maps on surface material via `BiomeConfig`; triplanar UV sampling in TSL."* The slice design covers exactly this — five-mesh slab group, `BiomeConfig` texture field extensions, and triplanar projection via TSL nodes. Normal map support is a standard PBR extension of "texture maps" and does not constitute scope creep. Excluded items (runtime biome switching, LOD, multiple biomes) respect the architecture's deferral of protocol-driven biome rendering to slice 109 (gated on migratory slice 502).

### [PASS] Dependency directions and integration points correct

The slice correctly depends on slice 110's `BiomeConfig`, `TerrainMaterialHandle`, and `createTerrainMaterial`. It extends rather than replaces these contracts. The slab reads `slabDepth` from `ViewerConfig` and world dimensions from the snapshot-driven world-bounds change handler in `main.ts` — consistent with the architecture's state ownership rules where rendering components read from config and `ViewerState`. No rendering component writes back to `ViewerState` or protocol state. The `TextureLoader` usage stays within the rendering layer, loading static assets from `public/` (consistent with Vite's static asset serving per the architecture's Vite decision).

### [PASS] New slab.ts module is a justified rendering layer extension

The architecture's component structure lists `src/rendering/terrain.ts` but not `slab.ts`. However, the architecture also states that "the slice plan's implementation order, dependencies, and success criteria remain authoritative." The slice justifies the separation clearly: different mesh lifecycle (5 planes rebuilt on bounds change vs. terrain displaced geometry), different material (cliff-only, no slope blend), and adherence to the ~300-line file discipline. Adding a module within `src/rendering/` respects the architecture's layer boundaries — it does not introduce cross-cutting concerns or violate the rendering layer's responsibilities.

### [NOTE] Multiple implementation-time decisions deferred

Three design decisions are explicitly deferred to implementation:
1. **`updateBiome()` contract** — whether `TerrainMaterialHandle.updateBiome()` rebuilds the material internally when texture paths change, or whether a separate `rebuildMaterial()` call is required (option a vs. b). This affects the public interface of both `TerrainMaterialHandle` and `SlabHandle`.
2. **Color-tint vs. texture-replace** — whether the shader multiplies sampled texture color by the color uniform (tint) or fully replaces it. The slice acknowledges both are viable.
3. **Triplanar normal map compatibility** — whether TSL's `triplanarTexture` works correctly with `normalNode`, with a documented fallback to non-triplanar normal maps.

All three are bounded with described alternatives, so they do not block the design. However, decision #1 in particular affects the integration surface that consuming code will depend on. Resolving it before implementation would reduce the risk of interface churn.

### [NOTE] Texture tiling scale API not confirmed against Three.js r183+

The slice acknowledges that the exact TSL mechanism for controlling `triplanarTexture` tiling frequency is unverified. The `textureScale` field in `BiomeConfig` captures the intent correctly, and the mitigation (verify against Three.js source during implementation) is reasonable. This is a known unknown, not a design gap — flagging for awareness during implementation.

### [NOTE] Open issue #1 may become a blocker for slab visual verification

The slice correctly identifies that the slab walls will be the first near-vertical geometry in the scene, and that issue #1 (weak directional lighting contrast at low camera angles) may cause uniform/flat shading on slab walls. If this occurs, the slab's visual verification criterion ("slab walls show cliff color/texture") may be unsatisfiable without resolving #1 first. The slice notes this may elevate #1 from deferred to blocking. This is a good risk identification, not a design flaw.
