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
    summary: "`selection.ts` write-back logic contradicts execution ordering"
  - id: F002
    severity: concern
    category: completeness
    summary: "`atmosphereOverrides` leaf-validation semantics underspecified for partial objects and deletion markers"
  - id: F003
    severity: concern
    category: completeness
    summary: "Stale localStorage profile name leaves user stuck with no documented recovery"
  - id: F004
    severity: concern
    category: feasibility
    summary: "Validation error line numbers not achievable with `js-yaml` default parse output"
  - id: F005
    severity: note
    category: consistency
    summary: "File layout section doesn't specify which slice it depicts"
  - id: F006
    severity: note
    category: completeness
    summary: "`manifest.json` gitignore/commit status unspecified"
---

# Review: arch — slice 120

**Verdict:** CONCERNS
**Model:** z-ai/glm-5.1

## Findings

### [CONCERN] `selection.ts` write-back logic contradicts execution ordering

The runtime-fetch ADR states two incompatible behaviors for `selection.ts`:

1. "When the URL form resolves a name, also writes it back to localStorage" (selection.ts module responsibilities).
2. "If the URL `?profile=` value is not in the manifest, `selection.ts` does **not** write to localStorage" (runtime-fetch ADR, "Write path" paragraph).

The data flow at startup shows step 3 (`selection.ts` resolves the profile name) executing **before** step 4 (manifest fetch). `selection.ts` is described as "Function over Window" — it only accesses URL params and localStorage, not the manifest. Therefore `selection.ts` cannot implement behavior #2 because it has no way to check whether the profile name exists in the manifest.

If `selection.ts` writes eagerly (behavior #1), an invalid profile name from `?profile=typo` gets persisted to localStorage. On the next page load without `?profile=`, `selection.ts` resolves the stale name from localStorage, and `fetcher.ts` fails — leaving the user stuck. If `selection.ts` defers the write, it contradicts the document's assignment of write responsibility to `selection.ts`.

The fix is to move the localStorage write to `fetcher.ts` (or `index.ts`) after successful manifest resolution, but the document should reflect this.

### [CONCERN] `atmosphereOverrides` leaf-validation semantics underspecified for partial objects and deletion markers

The document states the biome validator "rebases the override subtree onto the world schema's definition for that root and runs the world validator's structural check on it." Two problems follow from this description:

**Partial objects.** The worked example shows a biome overriding only `atmosphereOverrides.sky.hemisphereGroundColor` while leaving `hemisphereSkyColor` and `hemisphereIntensity` untouched. If the world validator's "structural check" includes required-field validation, this partial override would fail (missing required siblings). The document never specifies whether the leaf validation uses a *partial-check mode* (only validates present fields for type correctness, skips required-field enforcement) or the full world validator. The worked example assumes partial-check, but the specification describes full validation.

**Deletion markers.** The deep-merge ADR defines YAML `null` as a deletion marker and gives the example `atmosphereOverrides: { fog: ~ }`. But if the leaf-validation step runs the world validator on `fog: ~`, the world schema would reject `null` as a value for `fog` (which is typed as an object). The document says "every documented config field has a non-null type," yet deletion markers require null to pass validation. Either null must be a special-cased value that bypasses type checking during leaf validation, or deletion markers can never be used inside `atmosphereOverrides`. The document doesn't specify which.

These two gaps interact: an implementer following the spec literally would build a leaf validator that rejects both partial overrides and deletion markers — breaking the worked example and a stated feature.

### [CONCERN] Stale localStorage profile name leaves user stuck with no documented recovery

If a profile name is persisted to localStorage (via the `?profile=` write-back path) and that profile is later removed from the manifest, the next page load without `?profile=` resolves the stale name from localStorage. `fetcher.ts` raises a manifest-missing-name error and the viewer does not start.

The document specifies no fallback or recovery mechanism for this case. The user must know to either append `?profile=default` to the URL or manually clear `localStorage['migratory.profile']`. The error message from `discovery.ts` lists available profiles, but the document doesn't specify that it should include recovery instructions (e.g., "Clear localStorage or visit `?profile=default`").

A simple mitigation: when the localStorage-resolved name fails manifest validation, fall back to `'default'` with a console warning, rather than hard-failing. Alternatively, the error message should include explicit recovery steps. Either way, the document should specify the behavior.

### [CONCERN] Validation error line numbers not achievable with `js-yaml` default parse output

The schema-versioning ADR promises that type-check errors fail "with a specific error pointing to the file, line, and field." However, `js-yaml`'s `load()` API returns plain JavaScript objects with no position information. While `js-yaml` provides line/column data in its `YAMLException` for *parse* errors (malformed YAML), custom validation errors (correct YAML, wrong structure or types) have no position data because the validator operates on the deserialized object, not the source text.

Achieving line-level error reporting for schema validation errors would require either: (a) using `js-yaml`'s low-level listener API to capture positions during parsing and building a position map keyed by value identity — significant extra complexity not acknowledged in the document; or (b) switching to a YAML library that preserves CST positions (e.g., the `yaml` npm package), which contradicts the `js-yaml` dependency choice.

The document should either commit to the extra implementation work for line-accurate errors, relax the promise to "file and field path" (which is achievable without positions), or specify the position-tracking strategy.

### [NOTE] File layout section doesn't specify which slice it depicts

The "File layout" section shows `public/config/worlds/default.yaml` as "checked in," but the pipeline-shape-across-slices table says world-tier content lives in `defaults.ts` through slice 114 and only moves to `world.yaml` in slice 115. A reader implementing slice 114 would be confused about whether `public/config/worlds/default.yaml` should exist. The layout should either be annotated as the slice-115 endpoint state or include per-slice annotations.

### [NOTE] `manifest.json` gitignore/commit status unspecified

The Vite plugin `viteConfigManifest` generates `public/config/manifest.json` at dev-server start and build time. The document doesn't specify whether this file is gitignored or committed. If committed, it's a build artifact in the repo that can drift out of sync with directory contents. If gitignored, developers cloning the repo must run `pnpm dev` or `vite build` before the app can load (the manifest won't exist otherwise). Either choice is reasonable, but the document should state which and justify it.
