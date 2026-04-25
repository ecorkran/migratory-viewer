---
docType: review
layer: project
reviewType: arch
slice: world-authoring
project: squadron
verdict: UNKNOWN
sourceDocument: project-documents/user/architecture/120-arch.world-authoring.md
aiModel: z-ai/glm-5.1
status: complete
dateCreated: 20260425
dateUpdated: 20260425
findings:
  - id: F001
    severity: fail
    category: consistency
    summary: "Biome mergeable subset absent from slice 115 pipeline"
  - id: F002
    severity: fail
    category: consistency
    summary: "Data flow step ordering contradicts the fetch dependency chain"
  - id: F003
    severity: concern
    category: completeness
    summary: "Slice 114 biome selection mechanism is unspecified"
  - id: F004
    severity: concern
    category: completeness
    summary: "fetcher.ts has no documented mechanism to extract resolution-only keys from YAML"
  - id: F005
    severity: concern
    category: completeness
    summary: "atmosphereOverrides allowlist wildcard semantics are underspecified"
  - id: F006
    severity: concern
    category: completeness
    summary: "atmosphereOverrides can introduce unrecognized fields without detection"
  - id: F007
    severity: concern
    category: completeness
    summary: "localStorage write path is unspecified"
  - id: F008
    severity: concern
    category: consistency
    summary: "resetConfig() is mentioned in risks but absent from component architecture"
  - id: F009
    severity: note
    category: completeness
    summary: "Schema version target is ambiguous on allowlist changes"
  - id: F010
    severity: note
    category: completeness
    summary: "Concurrent initializeConfig() calls are undefined"
---

# Review: arch — slice 120

**Verdict:** UNKNOWN
**Model:** z-ai/glm-5.1

## Findings

### [FAIL] Biome mergeable subset absent from slice 115 pipeline

The tier-composition ADR defines the full pipeline as:

```
defaults ← world.mergeable ← unwrap(biome.atmosphereOverrides) ← profile.mergeable
```

And step 10 of the data flow restates this same order. The biome's **mergeable subset** — `surface`, `cliff`, `slopeBlend`, `props`, `audio`, `particles` (per the mergeable-subset table) — appears nowhere in this pipeline. Only the `atmosphereOverrides` extraction is shown for the biome's contribution.

An implementer following this document literally would produce a `ViewerConfig` that contains world-tier values (sky, sun, fog, terrain) and profile-tier values (camera, network, etc.) but **no biome-tier values at all** in slice 115. Surface textures, cliff textures, and slope-blend parameters would be missing from the effective config. The rendering would be broken.

The correct pipeline must include the biome's own keyspace as a distinct merge step, e.g.:

```
defaults ← world.mergeable ← biome.mergeable ← unwrap(biome.atmosphereOverrides) ← profile.mergeable
```

The merge order between `biome.mergeable` and `unwrap(biome.atmosphereOverrides)` is immaterial for correctness (they write to disjoint keyspaces — biome-tier vs. world-tier paths), but both must be shown. The slice 114 pipeline (`defaults → biome → profile`) correctly includes the biome as a whole stage; the slice 115 endpoint inexplicably drops it.

### [FAIL] Data flow step ordering contradicts the fetch dependency chain

Data flow steps 7 and 8 are:

- **Step 7** (slice 114+): `fetcher.ts fetches public/biomes/<biome>/biome.yaml`
- **Step 8** (slice 115+): `fetcher.ts fetches public/config/worlds/<world>.yaml`

In slice 115, both steps are active. The biome name `<biome>` comes from the world's `defaultBiome` field, which requires the world YAML to have been fetched and parsed first. But step 7 (biome fetch) is numbered before step 8 (world fetch), implying the biome is fetched first — which is impossible because the fetcher doesn't know which biome to fetch until the world is resolved.

The correct ordering for slice 115 is: fetch profile → parse profile to get `world` name → fetch world → parse world to get `defaultBiome` name → fetch biome. The numbered steps must reflect this, or the document must explicitly note that the step numbers reflect slice introduction order, not execution order.

### [CONCERN] Slice 114 biome selection mechanism is unspecified

The document states: "Slice 114 is allowed to be naive about which biome is active — it's whichever the world.yaml declares as `defaultBiome`." But in slice 114, there is **no world.yaml** — the world tier is still inside `defaults.ts`. The pipeline table for slice 114 says `defaults → biome → profile`, but:

- `defaults.ts` in slice 113 contains `camera, network, performance, debug, sky, sun, fog, terrain, surface, cliff, slopeBlend` — no `defaultBiome`.
- `defaultBiome` is a resolution-only key on the world tier.
- The manifest lists biomes but designates no default.
- Profiles "never pick biomes" per PM decision.

Nothing in the slice 114 design specifies how the system determines which biome to load. The `defaultBiome` resolution path (world.yaml → biome name → fetch) cannot function when world.yaml doesn't exist as a separate file. Either `defaults.ts` must gain a `defaultBiome` entry (not documented), or another selection mechanism must be specified.

### [CONCERN] fetcher.ts has no documented mechanism to extract resolution-only keys from YAML

`fetcher.ts` must resolve the fetch chain: profile name → profile YAML → `world` key → world YAML → `defaultBiome` key → biome YAML. The `world` and `defaultBiome` values are resolution-only keys that the ADR says "never appear in `ViewerConfig`." But `loader.ts`'s public API takes raw YAML strings and returns a `ViewerConfig` — the resolution-only keys are consumed internally and discarded.

The document does not describe how `fetcher.ts` obtains `world` from the profile or `defaultBiome` from the world. Three options exist, none documented:

1. `fetcher.ts` parses YAML itself to extract these keys (duplicating `loader.ts`'s parse logic).
2. `loader.ts` exposes a separate per-tier parse-and-validate function that returns both the mergeable subset and the resolution-only keys.
3. `loader.ts`'s main function returns a tuple of `(ViewerConfig, resolutionKeys)` instead of just `ViewerConfig`.

Whichever approach is chosen affects `loader.ts`'s interface and `fetcher.ts`'s implementation. The current spec leaves this to the implementer to discover.

### [CONCERN] atmosphereOverrides allowlist wildcard semantics are underspecified

The allowlist uses `sky.*`, `sun.*`, `fog.*` notation, but the wildcard matching semantics are never defined:

- Does `sky.*` match only direct children of `sky` (e.g., `sky.hemisphereSkyColor`) or any depth (e.g., `sky.nested.sub.field`)?
- Is `*` a glob pattern, a regex, or a convention?
- Does `sky.*` match `sky` itself (the whole sub-object)?

The `ATMOSPHERE_OVERRIDE_ALLOWLIST` constant in `schema.ts` must implement concrete matching logic, but the document gives no specification for what that logic should be. If two implementers interpret `sky.*` differently (one as single-level, one as recursive), the validator's behavior diverges silently.

### [CONCERN] atmosphereOverrides can introduce unrecognized fields without detection

The allowlist validates that an override path falls under an allowed prefix (e.g., `sky.*`), but does not validate that the specific leaf field exists in the world schema. A biome that writes `atmosphereOverrides: { sky: { hemisphereSkyColro: "0x4a3a1a" } }` (typo: `Colro` instead of `Color`) would pass the allowlist check (it's under `sky.*`) and deep-merge a useless key into the effective config. The typo is invisible at load time and the override silently does nothing — precisely the failure mode the "strict schema validation" ADR is designed to prevent for all other YAML fields.

The document states "Unknown fields anywhere in the document are also a hard error," but this principle is not applied inside `atmosphereOverrides` — only the prefix is checked, not the field names. The biome validator should cross-reference override leaf keys against the world schema's known fields under each allowlisted path.

### [CONCERN] localStorage write path is unspecified

The selection cascade reads from `localStorage.getItem('migratory.profile')`, and the document justifies it: "Falling back to localStorage.getItem('migratory.profile') lets a stable choice persist across sessions." But nothing in the document describes what writes to this key. The URL `?profile=` parameter is described as read-only. No UI, no API call, no automatic persistence on profile selection is documented.

Without a write path, `localStorage.getItem('migratory.profile')` always returns `null`, making the entire localStorage fallback dead code. If the intent is that future work will populate it, that should be stated explicitly. If something writes to it today, the write mechanism must be specified.

### [CONCERN] resetConfig() is mentioned in risks but absent from component architecture

The Risks section states: "provide a test-only `resetConfig()` export that clears the stored result; document its use in the loader's test file." But the Component Architecture's file layout and module-responsibilities sections do not mention `resetConfig()` anywhere. It's unclear whether it lives in `index.ts`, in a separate test utility file, or elsewhere. Its export strategy (conditionally exported? always exported but documented as test-only?) is also unspecified.

Since this function mutates the module-private state that `getConfig()` reads, its placement and visibility are load-bearing for test isolation — the exact problem the risk section identifies.

### [NOTE] Schema version target is ambiguous on allowlist changes

The document states: "Adding a new path to the allowlist requires a versioned schema migration (`schemaVersion: 1` → `2`)." But it doesn't specify **which tier's** `schemaVersion` must be bumped. The biome's `schemaVersion` (the tier that writes atmosphereOverrides) is the natural candidate, since new paths enable new content in biome files. But the world's schema is also affected (new overridable paths mean new world-tier fields that can be overridden). The document should specify which file's version increments, or state that both must bump.

### [NOTE] Concurrent initializeConfig() calls are undefined

`initializeConfig()` is described as "called once during app boot," but no guard exists against it being called while already in progress (e.g., due to a race in app initialization code). If called twice concurrently, two fetch pipelines would run and the second would overwrite the first's result — or worse, the module-private state could be in a partially-written state. A simple guard (e.g., returning the existing promise if already called) would eliminate this, but the document doesn't specify the expected behavior.
