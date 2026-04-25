---
docType: review
layer: project
reviewType: arch
slice: world-authoring
project: squadron
verdict: CONCERNS
sourceDocument: project-documents/user/architecture/120-arch.world-authoring.md
aiModel: z-ai/glm-5.1
status: complete
dateCreated: 20260425
dateUpdated: 20260425
findings:
  - id: F001
    severity: concern
    category: completeness
    summary: "Merge semantics for three-tier overlay are undefined"
  - id: F002
    severity: concern
    category: consistency
    summary: "Profile tier can silently override world and biome fields"
  - id: F003
    severity: concern
    category: abstraction
    summary: "atmosphereOverrides scope is unbounded — biome can override slabDepth"
  - id: F004
    severity: concern
    category: feasibility
    summary: "Build-time vs. runtime boundary is unresolved, contradicting the primary goal"
  - id: F005
    severity: concern
    category: completeness
    summary: "Runtime asset loading failures are unaddressed"
  - id: F006
    severity: concern
    category: completeness
    summary: "Hot reload behavior mentioned but not designed"
  - id: F007
    severity: concern
    category: technology
    summary: "Symlink/copy build strategy is a workaround, not a design"
  - id: F008
    severity: note
    category: extension-points
    summary: "Future multi-biome blending claims \"schema unchanged\" but interface changes"
  - id: F009
    severity: note
    category: antipattern
    summary: "src/config.ts triple role: types, defaults, and export point"
---

# Review: arch — slice 120

**Verdict:** CONCERNS
**Model:** z-ai/glm-5.1

## Findings

### [CONCERN] Merge semantics for three-tier overlay are undefined

The data flow (step 8) states "hardcoded defaults ← world ← biome.atmosphereOverrides ← profile" but never defines what "←" means operationally. If `world.yaml` declares `fog: { color: 0x88ccff, density: 0.02 }` and a biome's `atmosphereOverrides` declares `fog: { density: 0.04 }`, does the result contain `fog: { color: 0x88ccff, density: 0.04 }` (deep merge) or `fog: { density: 0.04 }` (shallow replacement)? This distinction is load-bearing — it determines whether biome authors must repeat every field of a nested object just to change one value, and whether adding a new sub-field to a world-tier nested object silently breaks biome overrides. The document uses the word "overlay" four times but never gives it a precise definition.

### [CONCERN] Profile tier can silently override world and biome fields

The document states "Profiles do not affect what the world looks like — only how this client renders / connects to it," and that "Camera FOV in a biome.yaml is a schema error." But the merge order places profile LAST, over everything else. If the merge is a naive field-level overlay (as implied by "everything is overlaid with profile-level perf caps"), nothing prevents a `default.yaml` from setting `skyColor` or `surfaceColor`. The schema validation per-tier can reject fields that belong to the wrong tier, but only if the validator knows which fields belong to which tier — and the document describes one validator per tier, not a cross-tier enforcement mechanism. The stated invariant ("each tunable belongs in exactly one place") is enforced by schema shape but violated by the merge order.

### [CONCERN] atmosphereOverrides scope is unbounded — biome can override slabDepth

The document explicitly states `slabDepth` is world-tier and "not a per-biome variation." But `atmosphereOverrides` is described as a biome's mechanism "by which a biome can touch world-tier fields," with no restriction on *which* world-tier fields. The YAML example shows `fog` overrides, but nothing in the schema prevents a biome from writing `atmosphereOverrides: { slabDepth: 0.5 }`. If the validator should reject this, the document doesn't say so — and if it's allowed, it contradicts the stated semantics. The boundary between "atmosphere" (overridable) and "geological constant" (not overridable) within world-tier is undefined.

### [CONCERN] Build-time vs. runtime boundary is unresolved, contradicting the primary goal

The document's primary goal: "editing a biome's color or swapping a texture should not require a code change, a build, or a code review." Yet `VITE_PROFILE` is a Vite env var, which is statically substituted at build time — changing it requires a rebuild. More critically, the document never states whether YAML files are parsed at build time (bundled into JS) or at runtime (fetched over HTTP). "Discovery is by directory scan" is a Node.js/Vite-plugin concept that has no browser equivalent. If YAML is bundled at build time, every config edit requires a rebuild, directly contradicting the stated goal. If YAML is fetched at runtime, the entire loading pipeline (fetch, cache, hot reload, error handling on network failure) is undescribed. This is not a detail — it determines whether the initiative's core value proposition works.

### [CONCERN] Runtime asset loading failures are unaddressed

Steps 2–7 of the data flow validate YAML structure and types, and the document states "any failure in steps 2–7 throws a specific error." But step 8 produces a hydrated `ViewerConfig` that contains texture paths (e.g., `textures/surface-diffuse.jpg`). What happens when Three.js attempts to load a texture that doesn't exist, or returns a corrupt image? The document is silent on runtime asset loading failures. The validator can check that a YAML field contains a string, but cannot verify the asset exists without filesystem access at validation time — and at runtime in the browser, it can't check until the HTTP request fails. There is no fallback strategy described (default texture? error texture? viewer refuses to start?).

### [CONCERN] Hot reload behavior mentioned but not designed

The document references "pnpm dev with hot reload" as a build pipeline concern and says slice 113 "will resolve the exact build-time strategy." But hot reload for config files has meaningful design implications: if a biome.yaml is edited and saved, does the entire three-tier config rehydrate? Does only the changed tier reload? If the edited YAML fails validation, does the viewer fall back to the last valid config, or does it crash? If atmosphereOverrides are removed, does the renderer revert to the world default immediately? These aren't build-pipeline details — they're runtime state management questions that affect the loader's architecture.

### [CONCERN] Symlink/copy build strategy is a workaround, not a design

The "Risks and Mitigations" section acknowledges the build pipeline complexity and proposes "YAML files live in config/ outside public/, biome assets live in public/biomes/ symlinked or copied from biomes/." Symlinks are problematic on Windows (require admin privileges by default, Git handles them inconsistently). Copying means two source-of-truth locations that can drift. The self-contained biome directory pattern (a stated architectural decision) is fundamentally in tension with Vite's `public/` convention — biomes want their assets collocated with their YAML, but Vite wants static assets in `public/`. This tension needs a resolved design, not a deferred workaround, because it affects every biome's directory structure from day one.

### [NOTE] Future multi-biome blending claims "schema unchanged" but interface changes

The document states that when per-cell biomes ship, "the schema commitment here is unchanged: overrides are explicit per biome, the renderer interpolates." The YAML schema may not change, but the downstream interface does: the renderer shifts from consuming one flat `ViewerConfig` to consuming multiple configs blended spatially. The claim that "existing rendering code consumes it unchanged" only holds for the single-biome present, not for the multi-biome future. This isn't a design error — it's an accepted future rearchitecture — but the document's framing understates the scope of that future work.

### [NOTE] src/config.ts triple role: types, defaults, and export point

The document assigns `src/config.ts` three responsibilities: (1) define the `ViewerConfig` interface, (2) provide hardcoded defaults for fallback, and (3) serve as the import point where downstream code reads the hydrated config. After the loader merges and validates, the result is "exported as ViewerConfig" from this same file. This means `src/config.ts` is both a static definition and a mutable export point. The document doesn't describe how the loader writes its result into this module — whether via module-level mutable state, a setter, or a re-export. Given the existing `import config from '../config'` pattern, this implies module-level side effects at startup, which is fragile in test contexts where you may need different configs per test.
