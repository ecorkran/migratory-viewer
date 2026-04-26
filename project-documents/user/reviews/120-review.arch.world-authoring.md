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
    summary: "localStorage write timing contradicts manifest validation ordering"
  - id: F002
    severity: concern
    category: completeness
    summary: "atmosphereOverrides leaf validation must account for partial overrides"
  - id: F003
    severity: concern
    category: consistency
    summary: "Component Architecture Boundaries contradicts config accessor migration"
  - id: F004
    severity: note
    category: completeness
    summary: "assemble() parameter type underspecified for atmosphereOverrides"
  - id: F005
    severity: note
    category: technology
    summary: "js-yaml cannot provide line numbers for schema validation errors"
  - id: F006
    severity: note
    category: feasibility
    summary: "manifest.json generation writing to public/ may have Vite build-ordering fragility"
  - id: F007
    severity: note
    category: completeness
    summary: "Post-merge ViewerConfig lacks defense-in-depth validation"
---

# Review: arch — slice 120

**Verdict:** CONCERNS
**Model:** z-ai/glm-5.1

## Findings

### [CONCERN] localStorage write timing contradicts manifest validation ordering

The document states: "If the URL `?profile=` value is not in the manifest, `selection.ts` does **not** write to localStorage and `fetcher.ts` raises the manifest-missing-name error from `discovery.ts`." However, the Data Flow at Startup section shows step 3 (`selection.ts` resolves the profile name) occurring before step 4 (`fetcher.ts` fetches `manifest.json`). At step 3, `selection.ts` has no access to the manifest and cannot determine whether the name is valid. If `selection.ts` writes to localStorage in step 3 (as described: "If the URL form was used, selection.ts writes the resolved name back to localStorage"), an invalid name gets persisted before validation ever runs. On the next page load without `?profile=`, the invalid name would be read from localStorage, producing the same error in a loop — the user would need to manually clear localStorage or use `?profile=default` to escape.

The document must clarify the coordination mechanism: either `selection.ts` defers the write until `fetcher.ts` confirms the name is valid (requiring `fetcher.ts` or `index.ts` to trigger the write after step 5), or `selection.ts` always writes immediately and the document accepts the invalid-name-persistence behavior (which seems contrary to the stated intent).

### [CONCERN] atmosphereOverrides leaf validation must account for partial overrides

The biome validator "rebases the override subtree onto the world schema's definition for that root and runs the world validator's structural check on it." But `atmosphereOverrides` is inherently partial — a biome writes `atmosphereOverrides: { sky: { hemisphereGroundColor: "0x4a3a1a" } }` to override one field, not the entire `sky` subtree. If the world schema marks `sky.hemisphereSkyColor` as required, the leaf-validation step would reject this legitimate partial override because the required sibling field is missing.

The document never specifies whether required-field checks from the world schema are applied to overrides. They must not be — only fields *present* in the override should be type-checked against the world schema's definitions. Required-field enforcement belongs to the world validator validating `world.yaml`, not to the biome validator validating a partial override. Without this explicit exclusion, an implementer following the document literally would produce a validator that rejects all partial overrides of any world-tier subtree that has required fields.

### [CONCERN] Component Architecture Boundaries contradicts config accessor migration

The "Component Architecture Boundaries" section states: "What slice 113 does **not** touch: `src/state.ts` and the snapshot/state-update flow." But the "Why the module split" section says: "every existing call site that reads `config.foo` becomes `getConfig().foo`" and "Slice 113 owns this refactor in addition to the loader work, so the cost is paid once." If `src/state.ts` currently imports `config` from `src/config.ts`, it must be updated in slice 113 to call `getConfig()`. The "does not touch" claim and the "every call site migrates" claim cannot both be true. The document needs to reconcile this: either `src/state.ts` doesn't import config (and thus truly isn't touched), or it does and must be updated (making the Boundaries section inaccurate).

### [NOTE] assemble() parameter type underspecified for atmosphereOverrides

`loader.assemble({ profile, world?, biome? })` needs the biome's `atmosphereOverrides` to perform step (3) of the merge pipeline, but `atmosphereOverrides` is classified as "resolution-only" and lives in the `resolution` object returned by `parseBiome()`. The document never specifies how `assemble()` receives it. The parameter type should be explicit, e.g.:

```ts
assemble(inputs: {
  profile: ProfileMergeable,
  world?: WorldMergeable,
  biome?: { mergeable: BiomeMergeable; atmosphereOverrides: AtmosphereOverrides }
}): ViewerConfig
```

Without this, an implementer might pass only `biome.mergeable` to `assemble()`, silently dropping the atmosphereOverrides and producing an incorrect `ViewerConfig`. The `atmosphereOverrides` field straddles an awkward category — it's in the "resolution" object but directly affects the merge result — and the interface contract should make this explicit.

### [NOTE] js-yaml cannot provide line numbers for schema validation errors

The document promises errors "pointing at the file, line, and field" and "file, line, and field" for type validation failures. `js-yaml`'s `load()` function returns a plain JavaScript object that does not preserve source positions. Line numbers are available in `js-yaml`'s `YAMLException` for *parse* errors (malformed YAML), but not for *schema validation* errors (valid YAML with wrong types or unknown keys). After parsing, the validator operates on the deserialized object and has no line information. The document should either acknowledge that schema validation errors include the field path but not the line number, or specify an alternative approach (e.g., using `js-yaml`'s CST/AST API for position-aware validation, at the cost of significantly more complex implementation).

### [NOTE] manifest.json generation writing to public/ may have Vite build-ordering fragility

The `viteConfigManifest` plugin writes `manifest.json` into `public/config/`. During `vite build`, Vite copies the `public/` directory to `dist/`. Whether the plugin-written manifest is included depends on Vite's internal ordering of plugin hooks versus public-directory copy. If the copy happens before `buildStart` completes, the manifest would be missing from the build output. The document doesn't discuss this risk or any mitigation (e.g., using Vite's `emitFile` API as a fallback). In practice, Vite's `buildStart` runs before the copy phase, so this likely works — but it's an implicit dependency on Vite internals that could break across versions.

### [NOTE] Post-merge ViewerConfig lacks defense-in-depth validation

The document guarantees that per-file keyspace validation prevents cross-tier leaks before merge, and that `atmosphereOverrides` is correctly extracted. But the merge implementation is a hand-written deep-merge function, and the document explicitly warns: "An implementer must not deep-merge the raw biome config into the accumulator." A post-merge validation pass on the final `ViewerConfig` — checking that no unexpected top-level keys exist and that all required fields are present — would catch merge-implementation bugs that per-file validation cannot. The document relies entirely on the merge being correct rather than verifying the output, which is a defense-in-depth gap for a config system that promises strict validation.
