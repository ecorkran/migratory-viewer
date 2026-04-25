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
    category: consistency
    summary: "Loader interface contradicts itself — fetches YAML or accepts raw text?"
  - id: F002
    severity: concern
    category: completeness
    summary: "Merge step does not specify which tier keys are excluded from the ViewerConfig result"
  - id: F003
    severity: concern
    category: completeness
    summary: "No \"unset\" or \"null-override\" semantics in the deep-merge model"
  - id: F004
    severity: concern
    category: completeness
    summary: "`experiments/` directory has no discovery or loading path"
  - id: F005
    severity: concern
    category: completeness
    summary: "atmosphereOverrides merge is a non-standard operation described only by example"
  - id: F006
    severity: concern
    category: consistency
    summary: "Slice 113 must produce a valid ViewerConfig without the world tier that arrives in slice 115"
  - id: F007
    severity: concern
    category: dependencies
    summary: "Biome validator is coupled to world-tier schema structure for atmosphereOverrides allowlist"
  - id: F008
    severity: note
    category: completeness
    summary: "manifest.json structure is undefined"
  - id: F009
    severity: note
    category: completeness
    summary: "Hex color string format is underspecified for a strict validator"
  - id: F010
    severity: note
    category: completeness
    summary: "Sentinel texture loading is async but the onError contract assumes it's available"
---

# Review: arch — slice 120

**Verdict:** CONCERNS
**Model:** z-ai/glm-5.1

## Findings

### [CONCERN] Loader interface contradicts itself — fetches YAML or accepts raw text?

The module-responsibility section states: **"`loader.ts` orchestrates: fetch profile YAML → validate → fetch world → validate → fetch biome → validate → deep-merge against `defaults.ts` → return the resulting `ViewerConfig`.** This describes a component that performs HTTP fetches.

The "YAML and biome assets are runtime-fetched" ADR's consequence-for-tests section states: **"The loader's API takes raw YAML text, not a URL, so the tier above (the 'fetch and parse' coordinator) is mockable trivially."** This describes a component that receives pre-fetched text, and implies a separate "coordinator" above it.

No such coordinator appears in the Component Architecture's file layout or module-responsibility list. If the loader fetches, it needs `discovery.ts` as a dependency and its test interface is different than if it receives raw text. If a coordinator exists, it's an unnamed, undescribed component that owns the fetch-then-delegate flow. These two descriptions cannot both be true for the same `loader.ts`, and the choice determines the module graph and testing strategy. The document must pick one and name every component involved.

### [CONCERN] Merge step does not specify which tier keys are excluded from the ViewerConfig result

The merge order `defaults → world → biome.atmosphereOverrides → profile` is described as deep-merging each tier into an accumulator. But each tier YAML contains metadata and resolution keys that are not rendering parameters: `schemaVersion`, `description`, `world` (profile), `defaultBiome` (world), `biome` (biome). If the deep merge naively includes these, they leak into the `ViewerConfig` consumed by the renderer, creating an implicit coupling surface where downstream code might read `config.defaultBiome`.

The document never states which keys are consumed-for-resolution-only vs. merged-into-the-result. The `ViewerConfig` type in `types.ts` presumably doesn't include `defaultBiome` or `schemaVersion`, but the merge step that produces a `ViewerConfig` is described as a generic deep merge — a generic deep merge would include every key. The validator's keyspace enforcement ensures a profile can't contain `sky:`, but it says nothing about stripping `defaultBiome` from the world before merge. This gap must be closed: either the merge step explicitly whitelists which keys per tier flow into the accumulator, or each tier's validator produces a "mergeable" subset stripped of metadata keys, and that subset's shape is what the merge consumes.

### [CONCERN] No "unset" or "null-override" semantics in the deep-merge model

The deep-merge ADR specifies that primitives replace, objects recurse, and arrays replace. There is no mechanism for a higher tier to *remove* a value set by a lower tier. If `world.yaml` sets `fog: { density: 0.5, color: "0x888888" }` and a biome wants no fog at all, there is no way to express this. Setting `density: 0` is semantically different from "no fog." YAML `null` (`fog: null` or `fog: ~`) is a real YAML value that a biome author will try; the document doesn't define whether `null` in an override means "remove this key from the accumulator" or is itself a value that overwrites (making the downstream code receive `null` instead of an object). Every layered-config system that succeeds (Kubernetes, ESLint) eventually needs a deletion marker. Deferring this means the first author who needs it will hack around it, and that hack becomes de facto behavior.

### [CONCERN] `experiments/` directory has no discovery or loading path

The file layout lists `public/config/experiments/ — gitignored — scratch profiles for local iteration`, but no mechanism connects this directory to the discovery system. The `viteConfigManifest` plugin scans `public/config/profiles/`, `public/config/worlds/`, and `public/biomes/` — `experiments/` is not in the scan list. The `selection.ts` module resolves a profile name through the manifest. If experiment profiles aren't in the manifest, `?profile=my-experiment` will fail with "not in manifest." Either the plugin must also scan `experiments/`, or there must be a separate loading path for experiment profiles, or the directory reference should be removed until its mechanism is designed. As written, it's a feature mention with no supporting architecture.

### [CONCERN] atmosphereOverrides merge is a non-standard operation described only by example

The merge step `defaults → world → biome.atmosphereOverrides → profile` includes a step that is not a standard deep merge: `biome.atmosphereOverrides` is a *biome-tier* key whose *values* are *world-tier* keys. The merge must unpack `atmosphereOverrides.sky` and merge it into the accumulator's `sky` — this is a structural transformation, not a recursive key-by-key merge of the biome config into the accumulator. The worked example shows the result, but the operational rule is never stated explicitly. An implementer reading "each `→` is a deep merge" would deep-merge the biome config (including `atmosphereOverrides` as a top-level key) into the accumulator, producing an invalid config with `atmosphereOverrides` nested inside `sky`. The document must state: step (2) extracts the contents of `atmosphereOverrides` and deep-merges them at their corresponding world-tier paths, discarding the `atmosphereOverrides` wrapper key itself.

### [CONCERN] Slice 113 must produce a valid ViewerConfig without the world tier that arrives in slice 115

The merge pipeline is defined as `defaults → world → biome.atmosphereOverrides → profile`. Slice 115 is when the world tier (sky, sun, fog) is first externalized. Slice 113 ships the loader, validators, and `getConfig()` accessor. What does the slice 113 loader merge? If it runs the full pipeline, the world and biome tiers don't exist as YAML files yet, so steps 2 and 3 of the pipeline have no inputs. If it skips them, then the slice 113 loader is a different pipeline than the slice 115 loader, and the "slice 115 adds atmosphereOverrides" framing is misleading — slice 115 actually *adds the entire world and biome merge steps*. The document needs to state what `defaults.ts` contains in slice 113 (presumably it holds all current hardcoded values including sky/sun/fog/terrain/surface), and how the loader pipeline is stubbed or simplified for slice 113, so that the slice 115 change is genuinely additive rather than a pipeline restructuring.

### [CONCERN] Biome validator is coupled to world-tier schema structure for atmosphereOverrides allowlist

The `atmosphereOverrides` allowlist (`sky.*`, `sun.*`, `fog.*`) is validated by the biome schema validator. This means the biome validator must know the structure of world-tier keys — specifically, which world-tier top-level keys exist and which are allowlisted for override. If a future slice adds a new world-tier key (e.g., `weather`), the biome validator must be updated to know about it (either to allowlist it or to reject it from `atmosphereOverrides`). This creates a hidden cross-tier dependency: the biome validator depends on the world schema. The document doesn't acknowledge this coupling or propose a structure that keeps allowlist knowledge in one place. A reasonable fix is to have the allowlist live in `schema.ts` as a shared constant referenced by both validators, rather than embedded in the biome validator alone.

### [NOTE] manifest.json structure is undefined

The manifest is the central discovery artifact — the browser fetches it to resolve names to paths — but its JSON schema is never shown. The Vite plugin "writes `public/config/manifest.json` listing the discovered names and their YAML paths" is the only specification. The manifest's shape determines how `discovery.ts` resolves names and how errors are reported when a name is missing. A two-line JSON example would close this gap.

### [NOTE] Hex color string format is underspecified for a strict validator

The document commits to strict type validation and says colors are hex strings like `"0x1a3d1a"`. But the exact format is ambiguous: is `"0x1A3D1A"` valid (uppercase)? Is `"0x1a3d1aff"` valid (8-char with alpha)? Is `"#1a3d1a"` valid? A strict validator must accept or reject these deterministically. Since the validator is the type-system-at-the-boundary, the hex-color grammar should be specified — a regex pattern or a parsing rule.

### [NOTE] Sentinel texture loading is async but the onError contract assumes it's available

`missing-texture.ts` owns a "single shared `Texture` instance" loaded from `public/assets/missing-texture.png`. Three.js's `TextureLoader` is async. If a biome texture fails to load before the sentinel texture has finished loading, the `onError` handler would reference an unloaded or partially-loaded texture. The document doesn't address this race: the sentinel should be loaded eagerly (before any biome textures) and its readiness should gate the biome-texture loading, or the onError handler must handle the case where the sentinel itself isn't ready.
