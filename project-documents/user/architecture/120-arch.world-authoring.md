---
docType: architecture
layer: project
phase: 2
phaseName: architecture
project: migratory-viewer
initiative: 120
initiativeName: world-authoring
source: user/project-guides/001-initiative-plan.migratory-viewer.md
dateCreated: 20260425
dateUpdated: 20260425
status: in_progress
reviewLog:
  - 20260425 — first review (verdict CONCERNS, model z-ai/glm-5.1) at project-documents/user/reviews/120-review.arch.world-authoring.md. Findings F001-F009 addressed in first revision; see "Review Remediation" section below.
  - 20260425 — second review (verdict CONCERNS, model z-ai/glm-5.1) at project-documents/user/reviews/120-review.arch.world-authoring.md (file overwritten with second-pass findings, also F001-F010). All ten findings addressed in this revision.
archIndex: 120
component: world-authoring
---

# Architecture: World Authoring & Biome System

## Overview

Initiative 120 externalizes the viewer's visual configuration from compiled TypeScript into versioned YAML files, organized into three composable tiers. The goal is content velocity: editing a biome's color or swapping a texture should not require a code change, a build, or a code review. A second goal is *anticipating expansion* — the eventual immersive world will have many biomes (Minecraft-comparable count), each potentially with 3D props, audio, and per-region atmosphere overrides. The schema established here must scale from "one texture, nothing else" up to that endpoint without requiring a breaking redesign.

This is mechanical infrastructure work. No rendering algorithms change in slices 113–115; only the *source* of the parameters those algorithms already consume.

## System Context

```
                ┌──────────────────────────────────────────────┐
                │   profile (public/config/profiles/*.yaml)    │
                │   camera, perf caps, server URL              │
                │   declares: world: <name>                    │
                └─────────────────────┬────────────────────────┘
                                      │ resolves via manifest
                                      ▼
                ┌──────────────────────────────────────────────┐
                │   world (public/config/worlds/*.yaml)        │
                │   sky, sun, fog, terrain.slabDepth           │
                │   declares: defaultBiome: <name>             │
                └─────────────────────┬────────────────────────┘
                                      │ resolves via manifest
                                      ▼
                ┌──────────────────────────────────────────────┐
                │   biome (public/biomes/<name>/biome.yaml)    │
                │   surface/cliff textures, colors,            │
                │   slope-blend, atmosphereOverrides           │
                └─────────────────────┬────────────────────────┘
                                      │ deep-merge against defaults
                                      ▼
                ┌──────────────────────────────────────────────┐
                │   getConfig() → ViewerConfig (effective)     │
                │   consumed by all downstream rendering code  │
                └──────────────────────────────────────────────┘
```

The viewer fetches all three tier YAMLs at startup over HTTP (they are static files served from `public/`). The profile is selected at runtime by `?profile=<name>` URL query param, then `localStorage`, then the hardcoded `default` fallback. Multi-biome regions and edge blending are deferred to a far-future slice (server protocol extension required).

## Architecture Decisions

### Three composable tiers — profile, world, biome

**Decision:** Configuration is partitioned into three tiers with clear semantics, and each tier owns a disjoint **keyspace** — a fixed, enumerated set of top-level keys that are legal at that tier and *only* at that tier:

| Tier | Keyspace (top-level keys) |
|---|---|
| Profile | `schemaVersion`, `profile`, `description`, `camera`, `network`, `performance`, `debug`, `world` |
| World | `schemaVersion`, `world`, `description`, `sky`, `sun`, `fog`, `terrain` (with `slabDepth` and other geological constants), `defaultBiome` |
| Biome | `schemaVersion`, `biome`, `description`, `surface`, `cliff`, `slopeBlend`, `atmosphereOverrides`, `props`, `audio`, `particles` |

A YAML file at any tier that contains a top-level key outside its tier's keyspace is a load-time error pointing at the file, the offending key, and the tier it would belong to (if any). This is enforced by the schema validator, not by the merge step — the validator runs *per file*, before any merge happens. A profile cannot write `sky:` (world keyspace) or `surface:` (biome keyspace), even unintentionally.

**Rationale:** Each tunable belongs in exactly one place by default. "Where does this value come from?" has one answer per field. The line between world and biome is *atmosphere vs. surface*: atmosphere is what every observer sees regardless of where they're standing (sky color, sun direction); surface is what depends on the patch of terrain you're on (vegetation texture). Sky color is world-tier; cliff color is biome-tier. `slabDepth` lives under `terrain:` in the world tier (PM-confirmed) — it's a constant of the world's geological style, not a per-biome variation.

The keyspace separation also resolves a subtle silent-override risk: if the merge step is the only enforcement, then a typo'd or malicious profile field could leak into the wrong tier. With per-file keyspace validation, the merge step is purely a mechanical operation on already-validated, type-checked, tier-confined inputs. The merge cannot produce a configuration that violates tier semantics, because the inputs cannot violate them.

**Consequence:** Camera FOV in a biome.yaml is a schema error and must fail loudly at load time. Surface texture in a profile.yaml is the same. The `atmosphereOverrides` block (defined in the next ADR) is the *only* mechanism by which a biome can affect world-tier values, and even that is restricted to an explicit allowlist.

### Tiers compose by deep merge, with explicit override allowlists

**Decision:** Effective render config is computed by **deep merge** of three already-validated, *mergeable-subset* tier configs against hardcoded defaults. The merge order is:

```
hardcoded defaults  →  world  →  unwrap(biome.atmosphereOverrides)  →  profile
                       (1)              (2)                              (3)
```

Each `→` is a deep merge of the right-hand side into the accumulated left-hand side.

**The merge consumes the *mergeable subset* of each tier, not the raw YAML.** Each tier YAML contains both rendering parameters and *resolution-only* metadata. The validator splits each parsed file into two pieces:

| Tier | Mergeable subset (flows into `ViewerConfig`) | Resolution-only keys (consumed by loader, not merged) |
|---|---|---|
| Profile | `camera`, `network`, `performance`, `debug` | `schemaVersion`, `profile`, `description`, `world` |
| World | `sky`, `sun`, `fog`, `terrain` | `schemaVersion`, `world`, `description`, `defaultBiome` |
| Biome | `surface`, `cliff`, `slopeBlend`, `props`, `audio`, `particles` | `schemaVersion`, `biome`, `description`, `atmosphereOverrides` (extracted, not merged as-is) |

`atmosphereOverrides` is *not* in either column for biome — it's handled by step (2), which **extracts** its contents and merges them at their corresponding world-tier paths (e.g., `atmosphereOverrides.sky.*` becomes `sky.*` in the accumulator). The `atmosphereOverrides` wrapper key itself is discarded; it never appears in the final `ViewerConfig`. An implementer must not deep-merge the raw biome config into the accumulator — doing so would produce an invalid result with `atmosphereOverrides` nested inside the rendering keys.

The resulting `ViewerConfig` therefore contains only rendering-parameter keys. `defaultBiome`, `schemaVersion`, etc. never leak into `getConfig().*`. A downstream module that wants to know the active biome name reads it from a separate accessor (e.g., `getActiveBiomeName()`), not from `getConfig()`.

**Deep-merge value rules.** For every key path in the override, if the value is a primitive (number, string, boolean, hex-color string), it replaces the accumulated value at that path; if the value is a nested object, the merge recurses into it; if the value is an array, it **replaces** the accumulated array (no array concatenation). YAML `null` (`~` or explicit `null`) is a **deletion marker**: it removes the key from the accumulator entirely, allowing a higher tier to "unset" a value set by a lower tier. (Example: a biome that wants no fog at all writes `atmosphereOverrides: { fog: ~ }`, which deletes the `fog` key from the merged config; downstream code must treat `fog === undefined` as "no fog," not crash on a null-valued sub-field.) An author who wants to write a literal null primitive in a config does not have that option — every documented config field has a non-null type.

Worked example:

```
world.yaml:  sky: { hemisphereSkyColor: "0x1a1a4e", hemisphereGroundColor: "0x0a1a0a", hemisphereIntensity: 1.1 }
biome.yaml:  atmosphereOverrides: { sky: { hemisphereGroundColor: "0x4a3a1a" } }

result:      sky: { hemisphereSkyColor: "0x1a1a4e",   ← from world (unchanged)
                   hemisphereGroundColor: "0x4a3a1a",  ← from biome (overrides)
                   hemisphereIntensity: 1.1 }          ← from world (unchanged)
```

Authors do not have to repeat every field of a nested object to change one value. Adding a new sub-field to a world-tier nested object does not silently break biome overrides — overrides target leaf paths, not whole sub-objects.

**`atmosphereOverrides` has a fixed, narrow allowlist of overridable world-tier paths.** As of slice 115:

| Path | Overridable by biome? |
|---|---|
| `sky.*` (any leaf under `sky`) | ✅ yes |
| `sun.*` (any leaf under `sun`) | ✅ yes |
| `fog.*` (any leaf under `fog`, when `fog` ships) | ✅ yes |
| `terrain.slabDepth` | ❌ no — geological constant |
| `terrain.*` (any other terrain-shape constant) | ❌ no |
| `defaultBiome` | ❌ no — circular |

A biome's `atmosphereOverrides` block containing any path outside this allowlist is a load-time schema error. Adding a new path to the allowlist requires a versioned schema migration (`schemaVersion: 1` → `2`) — same loud-failure principle as the wire-protocol opcode-versioning convention.

**The allowlist lives in `schema.ts` as a single shared constant** (`ATMOSPHERE_OVERRIDE_ALLOWLIST`) referenced by both the biome validator and the world validator. The biome validator checks that every path under `atmosphereOverrides` is in the allowlist; the world validator references the same constant when constructing its own keyspace, so the two cannot drift. When a future slice adds a new world-tier top-level key (e.g., `weather`), the schema author makes one decision in one place — extend the allowlist or don't — and both validators pick up the new behavior. The biome validator therefore depends on `schema.ts`'s shared constant, not on the world validator's internal structure.

**The profile tier does not deep-merge into world or biome keyspaces.** Step 3 above (profile merge) only touches the profile keyspace defined in the previous ADR (`camera`, `network`, `performance`, `debug`). The merge implementation is keyspace-aware: when applying the profile, it only writes to its own keyspace's keys in the accumulator. This is enforced both by the per-file keyspace validator (a profile *cannot contain* world keys) and by the merge step (which would reject them even if they slipped through).

**Rationale:** Deep merge is what every layered-config system that anyone is happy with does (Kubernetes manifests, Vite config, ESLint config). Shallow merge forces authors to copy every sibling field, which is repetitive and breaks when the world tier adds new fields. Array replacement (rather than concatenation) is the safer default — concatenation is rarely what authors want and silently bloats lists when overrides accumulate.

The narrow allowlist for `atmosphereOverrides` is what closes finding F003: the override mechanism is bounded by name, not just by convention. `slabDepth` cannot be overridden by a biome because the validator refuses to accept it under `atmosphereOverrides`. If a future slice decides slab depth *should* vary by biome, that's a deliberate schema migration with a version bump, not a leak through an unbounded override.

**Consequence:** Slice 114 ships the `atmosphereOverrides` schema slot but rejects any non-empty content (the override mechanism doesn't exist until slice 115). Slice 115 implements the deep-merge step and the allowlist enforcement.

**Pipeline shape across slices.** The four-stage pipeline above is the slice-115 endpoint. Earlier slices run a *prefix* of it — same code path, same merge function, just with fewer inputs:

| Slice | `defaults.ts` contains | Pipeline stages active | Notes |
|---|---|---|---|
| 113 | All current hardcoded values: `camera`, `network`, `performance`, `debug`, **`sky`, `sun`, `fog`, `terrain`, `surface`, `cliff`, `slopeBlend`** (mirrors what's in [src/config.ts](../../src/config.ts) today). | `defaults → profile` only. Loader skips world/biome fetches because manifest lists none. | Profile YAMLs externalize. World/biome are still hardcoded inside `defaults.ts`. |
| 114 | `defaults.ts` loses the biome-tier keys (`surface`, `cliff`, `slopeBlend`); they move into `public/biomes/<name>/biome.yaml`. | `defaults → biome → profile`. World still in defaults. | First biome.yaml ships; loader gains the biome fetch step. |
| 115 | `defaults.ts` loses the world-tier keys (`sky`, `sun`, `fog`, `terrain`); they move into `public/config/worlds/<name>.yaml`. | Full pipeline: `defaults → world → unwrap(biome.atmosphereOverrides) → profile`. | World fetch + atmosphereOverrides extraction land together. |

The merge function is written in slice 113 to accept any subset of the four inputs and apply only the stages whose inputs are present. Slice 114 and 115 add inputs to an existing pipeline rather than restructuring it; `defaults.ts` shrinks as content moves into YAML. This makes each slice's diff small and preserves the invariant that `getConfig()` returns the same effective values before and after each migration step (renderer behavior unchanged across all three slices).

### Schema is versioned from day one

**Decision:** Every YAML file declares `schemaVersion: 1` as its first content field. The loader validates the version against a known set; unknown versions are a hard error. Unknown fields anywhere in the document are also a hard error.

**Rationale:** Same loud-failure principle as slice 112's wire-protocol opcode-versioning: breaking changes get a new version, never a silent redefinition of an existing field. A typo'd field name that silently uses a default is the worst failure mode for a config system — the file looks right, the rendering looks wrong, the cause is invisible. Strict mode catches it on load. Migration helpers will handle v1 → v2 conversions when we get there; until then, every file in the repo is v1.

**Type validation is also strict.** A schema validator type-checks every field at load time: `fov: "wide"` when a number was expected fails the load with a specific error pointing to the file, line, and field. PM-confirmed for slice 113. This is cheap to add now (~30-50 lines + a small fixture) and expensive to retrofit once bad profiles ship to other developers.

### YAML and biome assets are runtime-fetched, not bundled

**Decision:** All YAML config files and all biome assets (textures, eventually audio and props) are served as **static files** under the viewer's web root and **fetched at runtime over HTTP** by the loader. They are not bundled into the JavaScript output, not parsed at build time, and not statically substituted via `import.meta.env`. Editing a YAML file or swapping a texture requires only a page refresh, not a rebuild.

Concretely, after slice 113 lands:

```
public/
├── config/
│   ├── profiles/<name>.yaml
│   ├── worlds/<name>.yaml
│   └── manifest.json          ← discovery index (see below)
└── biomes/
    └── <name>/
        ├── biome.yaml
        └── textures/*.jpg
```

`config/` and `biomes/` directories under `public/` are served verbatim by Vite's dev server and copied verbatim into `dist/` by `vite build`. The same paths work in development and production. There is no symlink, no copy step beyond Vite's normal `public/` handling, and no two-source-of-truth drift.

**Discovery uses a build-time-generated manifest, not a runtime directory scan.** A small Vite plugin (`viteConfigManifest`) runs at dev-server start and at build time, scans `public/config/profiles/`, `public/config/experiments/`, `public/config/worlds/`, and `public/biomes/`, and writes `public/config/manifest.json` listing the discovered names and their YAML paths. The browser fetches this manifest to resolve names → paths. The plugin re-runs on file changes during dev, so adding or renaming a biome directory updates the manifest without a manual rebuild.

`experiments/` is gitignored, but the plugin still scans it locally and merges its profiles into the manifest's `profiles` map under the same namespace as checked-in profiles — `?profile=my-experiment` resolves identically to `?profile=cinematic`. A name collision between `profiles/` and `experiments/` is a hard plugin-time error (the developer must rename one). In CI/production builds where `experiments/` is empty or absent, the manifest simply contains no entries from it.

The manifest is a JSON object with this shape:

```json
{
  "schemaVersion": 1,
  "profiles": {
    "default":    { "path": "/config/profiles/default.yaml" },
    "cinematic":  { "path": "/config/profiles/cinematic.yaml" },
    "lowend":     { "path": "/config/profiles/lowend.yaml" },
    "my-scratch": { "path": "/config/experiments/my-scratch.yaml" }
  },
  "worlds": {
    "default":    { "path": "/config/worlds/default.yaml" }
  },
  "biomes": {
    "alien-vegetation": { "path": "/biomes/alien-vegetation/biome.yaml" },
    "desert-rock":      { "path": "/biomes/desert-rock/biome.yaml" }
  }
}
```

`discovery.ts` resolves a name by looking it up in the appropriate sub-map and returning the `path`. A missing name produces the error `profile "X" is not in the manifest (available: default, cinematic, lowend, my-scratch)` — listing alternatives so the developer can self-correct. The `path` field is structured (rather than a bare string) so future per-entry metadata (e.g., human-readable labels for an in-app picker UI) can be added without a manifest schema bump. The manifest's own `schemaVersion: 1` is checked at fetch time, same loud-failure principle as the YAML tiers.

**Profile selection is a URL query parameter or `localStorage` value, not a Vite env var.** Reading `?profile=cinematic` from the URL means a developer can switch profiles without a rebuild. Falling back to `localStorage.getItem('migratory.profile')` lets a stable choice persist across sessions. The hardcoded fallback is `default`. (Note: `VITE_PROFILE` was the original sketch in the exploration doc; it was wrong because Vite env vars are baked at build time. Fix: runtime selection.)

**Rationale:** The primary stated goal of the 120-series is *content velocity* — editing a biome's color or swapping a texture should not require a code change, a build, or a code review. Build-time bundling of YAML or env-var-baked profile selection both directly contradict that goal. Runtime fetching from `public/` is the only design that delivers the goal.

There are two costs:
- **Cold-start cost.** The viewer makes ~3-4 small HTTP requests in serial before rendering: `manifest.json`, `<profile>.yaml`, `<world>.yaml`, `<biome>.yaml`. Each is a few hundred bytes; on localhost or any modern CDN this is sub-50ms total. The texture fetches that follow are the same ones the existing slice 110 path already does.
- **No static type-checking of YAML against TypeScript.** TypeScript cannot verify that a runtime-fetched YAML file's shape matches the `ViewerConfig` interface. The schema validator (next ADR) compensates: every fetch is followed by strict structural validation that mirrors the TS interface. The validator is the type system at the YAML→runtime boundary, the same way the wire-protocol parser is the type system at the WebSocket→runtime boundary.

This decision dissolves the "build-pipeline tension" risk previously logged: there is no tension, because biome assets and YAML live together under `public/biomes/<name>/`, the way they want to. Vite serves them as-is.

**Consequence for tests:** Unit tests that exercise the loader use fixture YAML strings, not HTTP. Integration tests can spin up the dev server or use a path-based file:// URL. The loader's API takes raw YAML text, not a URL — the HTTP fetches live in a separate `fetcher.ts` coordinator (see Component Architecture below), which is the only module in the new code that does I/O. This split is what makes the loader trivially mockable: tests construct fixture YAML strings and call the loader directly, never going through HTTP or `fetcher.ts`.

### Biome packs are self-contained directories

**Decision:** A biome is a directory: `biomes/<name>/biome.yaml` plus that directory's `textures/`, eventually `audio/` and `props/`. The YAML uses paths *relative to its own directory*. Discovery is by directory scan — drop a new directory into `biomes/`, it's available; remove one, it's gone.

**Rationale:** This is the Minecraft datapack pattern, chosen because it's known to scale. Self-contained means a biome can be moved or shared with `cp -r`. Directory scan means no central registry to maintain. Relative paths mean a biome pack doesn't break when the parent directory moves. The eventual UX of "drop a third-party biome pack into the worldpacks dir" works trivially.

**Consequence:** The viewer build pipeline needs to handle biome assets at build time (for `pnpm build`) and at dev-server time (for `pnpm dev` with hot reload). Vite's `public/` convention is the obvious home, but biomes need to live alongside their YAML — slice 113 will resolve the exact build-time strategy.

### Profiles reference worlds and biomes by name, not by path

**Decision:** A profile declares `world: default`, not `world: ../worlds/default.yaml`. A world declares `defaultBiome: alien-vegetation`, not `defaultBiome: ../../biomes/alien-vegetation/biome.yaml`. The discovery directory resolves names to paths.

**Rationale:** Names survive directory reorganization; paths don't. Names enable an eventual "pick a biome" UI dropdown that lists discovered biomes by name. Names are the same convention every comparable system uses (Minecraft, every plugin manager, etc.). PM-confirmed: `defaultBiome` lives on the **world**, not the profile — profiles never pick biomes.

**Consequence:** Name collisions are a hard error at load time. Two `biomes/foo/` from different sources is a setup the user must resolve.

### YAML hex colors as strings

**Decision:** Color literals in YAML are hex strings: `surfaceColor: "0x1a3d1a"`. Parsed to numbers at load time.

**Rationale:** YAML doesn't have a native hex-number type. Three options exist:
- (a) Hex strings parsed at load.
- (b) Integers in YAML's `0x...` syntax — works in some libraries, not others.
- (c) RGB arrays.

Option (a) is portable across every YAML library and reads identically to the existing source-code form (`0x1a3d1a`). PM-confirmed. The loader is responsible for parsing; downstream code receives the same JavaScript number it does today.

**Strict grammar.** Color strings must match the regex `/^0x[0-9a-f]{6}$/`. That is: literal `0x` prefix (lowercase), followed by exactly six lowercase hex digits, no alpha channel, no `#` prefix, no uppercase. The schema validator rejects any other form at load time with a specific error pointing to the file, field, and offending value (e.g., `surface.color: "#1a3d1a" is not a valid color (expected /^0x[0-9a-f]{6}$/)`). The narrow grammar makes "are these two colors equal" a string-equality question and avoids a class of canonicalization bugs. The regex is exported from `schema.ts` as `HEX_COLOR_RE` so the validator and any future test/tooling reference one definition.

### Single profile, single world, single biome at runtime — for now

**Decision:** The viewer loads exactly one profile (resolved from URL `?profile=<name>` query param, then `localStorage.getItem('migratory.profile')`, then the hardcoded fallback `default`), which selects exactly one world, which selects exactly one default biome. Multiple biomes existing in `public/biomes/` is supported and expected; **only one is active at a time** until per-cell biome data exists.

**Rationale:** Multi-biome rendering — regions of terrain belonging to different biomes, blended at edges — is a hard problem with two dependencies: (1) a server protocol extension declaring biome IDs per terrain cell, and (2) a renderer extension blending materials at biome boundaries. Both are far-future. Until then, "current biome" is a single config object. The schema and discovery manifest support the future (`public/biomes/` holds many) but the runtime selects one.

**Consequence:** Slice 114 is allowed to be naive about which biome is active — it's whichever the world.yaml declares as `defaultBiome`. Slices that introduce multi-biome rendering will extend this; the file format is forward-compatible (see "Future-compatibility scope" below for the renderer-interface caveat).

### Hot reload of config is a non-goal for slices 113-115

**Decision:** Editing a YAML file or biome asset and saving it does **not** trigger an in-place reload of the running viewer in slices 113-115. The author refreshes the page (or restarts `pnpm dev`) to pick up the change. Vite's normal asset-change detection still works for textures the renderer is already aware of, but the config-tier reload pipeline is *not* hot-pathed.

**Rationale:** Hot reload of layered config has real design surface: when a biome.yaml is edited and saved, does the entire three-tier config rehydrate or only the changed tier? If the edited YAML fails validation, does the viewer fall back to the last valid config or crash? If `atmosphereOverrides` are removed, does the renderer revert to the world default immediately or on next biome transition? Each of these has reasonable answers, but the answers depend on a usage model we don't have data for yet. The right time to design hot reload is after slice 115 has shipped and we've actually felt the pain of "edit, refresh, edit, refresh." Doing it earlier is speculative.

The page-refresh path is fast: the loader's three HTTP fetches plus validation run in well under 100ms on a localhost dev server. Refresh is acceptable friction for the first three slices.

**Consequence:** Slices 113-115 must not write code paths that *assume* hot reload (e.g., subscribing to file-watcher events). The loader is a one-shot startup component. A future slice (probably co-incident with the in-app biome-picker UI) introduces hot reload deliberately, and that slice owns the design questions above.

### Reserved schema slots for future expansion

**Decision:** Slice 114's biome.yaml schema **reserves** keys for `props`, `audio`, and `particles` even though slice 114 ships none of those features. The validator accepts these keys but rejects non-empty values:

```yaml
props: []      # OK — slice 114 accepts empty list
audio: {}      # OK — slice 114 accepts empty object
# props: [some_tree] would fail load with "props are not yet supported"
```

**Rationale:** Reserving the key namespace means a future slice that adds 3D props is a *purely additive* change to the schema (and a code change to the validator and renderer). Not reserving the keys means the future slice has to either bump `schemaVersion` (every existing biome migrates) or pick a new key shape (potentially conflicting with author intuition). Reserving is free now and saves a migration later. Same thinking as the wire-protocol opcode-versioning convention from slice 112.

### Asset-loading failures fall back to obvious sentinels

**Decision:** Texture references in a biome.yaml are **schema-validated as paths** at config load time, but the actual asset existence is verified at *texture-load* time by Three.js. Two failure paths exist, and each has a defined behavior:

- **Texture not found / 404 / corrupt image.** The loader substitutes an obviously-broken **magenta-and-black checkerboard** sentinel texture (the industry-standard "missing texture" indicator, used by Source Engine, Unity, Godot, and most game engines). The viewer continues rendering with the sentinel in place of the missing texture. A console error names the biome, the field, and the URL that failed: `[biome alien-vegetation] surface.diffuse: failed to load /biomes/alien-vegetation/textures/surface-diffuse.jpg (404)`.
- **YAML config validation failure.** The viewer **does not start**. A blocking, full-screen error overlay names the file, the field, and the validation error. This is consistent with the schema-versioning ADR's loud-failure principle. There is no "degraded mode" for invalid config — invalid config is a developer error, not a runtime data error.

The asymmetry is deliberate: a missing texture is an *asset-pipeline* problem (someone forgot to commit the file, or fat-fingered the path), recoverable visually, and the magenta sentinel makes it impossible to ship by accident. An invalid config is a *schema* problem and the viewer cannot meaningfully proceed.

**Optional dev-mode preflight:** The loader, when running under `import.meta.env.DEV`, additionally issues HTTP HEAD requests for every texture path declared in the active biome immediately after config validation, before rendering starts. Any 404 surfaces as a console warning *before* the renderer would have hit the same 404 — useful when a texture is referenced by a path that's only loaded under specific camera angles. Production builds skip the preflight (one extra round of HEAD requests is wasted bandwidth in production where assets are CDN-cached).

**Rationale:** Three.js's `TextureLoader` already has an `onError` callback; the magenta sentinel is one extra `Texture` allocated once at viewer startup and referenced from the error handler. The dev-mode preflight is ~10 lines of code. Both are cheap; together they cover finding F005's failure mode (texture-not-found → silent black render or runtime crash) with explicit, observable behavior.

The magenta-checker convention is industry-standard *because* it's hard to confuse with intended art and hard to miss in screenshots — exactly the properties needed for "obviously-broken" sentinel art.

**Consequence for slice 114:** Slice 114 ships the magenta-checker sentinel as a 64×64 PNG under `public/assets/missing-texture.png`. The loader holds a single shared `Texture` instance pointing at it. Three.js's caching ensures it's only decoded once.

**Sentinel readiness gates biome texture loading.** Three.js's `TextureLoader` is async, so the sentinel is not usable until its own image has decoded. `missing-texture.ts` exposes `getSentinel(): Promise<Texture>` and an internal eager-load that begins at `initializeConfig()` time, before any biome texture loading starts. Biome texture loading awaits the sentinel promise once at startup (the same promise is reused — no per-texture await), then proceeds in parallel; any subsequent `onError` handler synchronously references the already-resolved `Texture`. If the sentinel itself fails to load (a viewer-build problem, not a content problem), `initializeConfig()` rejects with an explicit error: shipping a viewer without its missing-texture sentinel is a build defect, not a runtime condition to recover from.

## Component Architecture

The 120-series introduces these new modules. Existing rendering code in `src/rendering/` and `src/state.ts` is unchanged — they still receive a hydrated `ViewerConfig` of the same shape, but reach it through an accessor function rather than a module-level singleton import.

### File layout

```
public/
├── config/
│   ├── manifest.json              # generated by viteConfigManifest plugin at dev/build
│   ├── profiles/
│   │   ├── default.yaml           # checked in
│   │   ├── lowend.yaml            # checked in
│   │   └── cinematic.yaml         # checked in
│   ├── worlds/
│   │   └── default.yaml           # checked in
│   └── experiments/               # gitignored — scratch profiles for local iteration; scanned by the manifest plugin
└── biomes/
    ├── alien-vegetation/          # migrated from existing DEFAULT_BIOME in slice 114
    │   ├── biome.yaml
    │   └── textures/
    │       ├── surface-diffuse.jpg
    │       ├── surface-normal.jpg
    │       ├── cliff-diffuse.jpg
    │       └── cliff-normal.jpg
    └── desert-rock/               # second biome introduced in slice 114 to prove genericity
        ├── biome.yaml
        └── textures/

src/config/
├── types.ts                       # ViewerConfig + tier-specific TS interfaces (pure types, no runtime code)
├── defaults.ts                    # hardcoded defaults — fallback values when YAML omits a field
├── schema.ts                      # per-tier schema + validators + ATMOSPHERE_OVERRIDE_ALLOWLIST + HEX_COLOR_RE
├── loader.ts                      # parse → validate → merge pipeline (pure: takes raw YAML text, returns ViewerConfig)
├── fetcher.ts                     # the only HTTP-doing module: fetches manifest + tier YAMLs and hands text to loader
├── discovery.ts                   # manifest parsing + name → path resolution (pure over a parsed manifest)
├── selection.ts                   # URL-param / localStorage / fallback profile picker
├── missing-texture.ts             # magenta-checker sentinel Texture management
└── index.ts                       # exports getConfig() and initializeConfig() — no module-level singleton

vite.config.ts                     # adds viteConfigManifest plugin for manifest.json generation
```

### Module responsibilities

- **`types.ts`** is pure TypeScript types. No runtime code. Importable freely from anywhere; never causes side effects.
- **`defaults.ts`** is hardcoded fallback values matching the current source-of-truth in [src/config.ts](../../src/config.ts). Pure data; no I/O.
- **`schema.ts`** holds three validators (profile, world, biome), each enforcing its tier's keyspace, structure, types, and the `schemaVersion: 1` constraint. Also exports the shared `ATMOSPHERE_OVERRIDE_ALLOWLIST` (consumed by both biome and world validators) and the `HEX_COLOR_RE` color-string grammar (see "YAML hex colors as strings" ADR).
- **`loader.ts`** is a pure pipeline over **already-fetched YAML text strings**. Its public function takes `(profileYaml: string, worldYaml: string | undefined, biomeYaml: string | undefined)` and returns a `ViewerConfig` (or throws). Internally it parses each input with `js-yaml`, runs the per-tier validator, then deep-merges in the order defined by the tier-composition ADR. No HTTP, no global state, fully synchronous after the YAML strings are in hand. Tests construct fixture strings and call this directly.
- **`fetcher.ts`** is the only module in `src/config/` that performs I/O. It owns: HTTP GET of `public/config/manifest.json`, HTTP GET of the active profile/world/biome YAML files (paths resolved by `discovery.ts`), and the `fetch` error → typed-error translation. It calls `loader.ts` with the fetched text strings and returns the loader's result. This is the "fetch and parse coordinator" referenced in the runtime-fetch ADR. Mocking `fetcher.ts` (or stubbing `globalThis.fetch`) is how integration tests exercise the full pipeline; unit tests bypass `fetcher.ts` entirely and call `loader.ts` directly.
- **`discovery.ts`** parses a fetched manifest object and resolves names to paths. Pure over a parsed manifest — `fetcher.ts` does the HTTP, `discovery.ts` interprets the result.
- **`selection.ts`** reads `?profile=<name>`, falls back to `localStorage.getItem('migratory.profile')`, falls back to `'default'`. Pure function over `Window` (mockable in tests).
- **`missing-texture.ts`** owns the single shared magenta-checker `Texture` and the `onError` handler used by every biome texture load.
- **`index.ts`** exports two functions: `initializeConfig()` (async, called once during app boot, runs the loader and stores the result in module-private state) and `getConfig()` (sync, returns the stored result, throws if `initializeConfig()` hasn't completed). All downstream code calls `getConfig()` — there is no `import config from '../config'` singleton anymore. **This is a behavior-preserving migration**: every existing call site that reads `config.foo` becomes `getConfig().foo`.

### Why the module split

The existing [src/config.ts](../../src/config.ts) holds three responsibilities that must be untangled to ship slice 113 cleanly: (1) the `ViewerConfig` and related interfaces (pure types), (2) the hardcoded values (data), (3) the import point that downstream code reaches for. Conflating them with module-level mutable state would create exactly the test-isolation problem the review flagged: tests would have to mutate a shared `config` export, and parallel tests would race.

The chosen split:
- Types are static. Imported anywhere, no side effects.
- Defaults are static data. Imported by the loader.
- The accessor (`getConfig()`) wraps a module-private variable that's set exactly once by `initializeConfig()`. Tests can call `initializeConfig({ override: ... })` (or a test-only equivalent that bypasses HTTP) to inject specific configs. There is no `import config` to mutate.

This is a marginally bigger code change than "keep the singleton, add a loader," but it eliminates a category of subtle bugs (test interdependence, surprise re-imports) at the cost of a one-time grep-and-replace across the codebase. Slice 113 owns this refactor in addition to the loader work, so the cost is paid once and amortized across every future config change.

## Data Flow at Startup

```
 1. App boot calls initializeConfig() before rendering starts.
 2. missing-texture.ts begins eager-loading the magenta-checker sentinel (Promise<Texture>).
 3. selection.ts resolves the active profile name:
      URL ?profile=<name>  →  localStorage('migratory.profile')  →  'default'
 4. fetcher.ts fetches public/config/manifest.json; discovery.ts parses + validates manifest schemaVersion.
 5. fetcher.ts fetches public/config/profiles/<profile>.yaml (path from discovery.ts).
 6. loader.ts parses + profile-validates: keyspace, schemaVersion, structure, types. Hard error on any failure.
 7. (slice 114+) fetcher.ts fetches public/biomes/<biome>/biome.yaml; loader.ts parses + biome-validates
        (biome keyspace + atmosphereOverrides allowlist + reserved-slot empty check).
 8. (slice 115+) fetcher.ts fetches public/config/worlds/<world>.yaml (name from profile.world);
        loader.ts parses + world-validates.
 9. loader.ts splits each parsed tier into resolution-only keys vs. mergeable subset.
10. loader.ts deep-merges in order: defaults ← world.mergeable ← unwrap(biome.atmosphereOverrides) ← profile.mergeable.
        Pipeline stages whose inputs are absent (slices 113, 114) are skipped — same code path, fewer inputs.
11. initializeConfig() awaits the sentinel promise from step 2 (it is almost certainly already resolved).
12. (DEV only) Preflight HEAD requests against every biome texture path; warn on 404.
13. initializeConfig() stores the resulting ViewerConfig in module-private state.
14. App proceeds to renderer setup; existing code calls getConfig() to read values.
        Biome-texture loads use the sentinel as their onError fallback (sentinel is now ready).
```

Any failure in steps 4–10 throws a specific error pointing at the offending file/field/line and the viewer does **not** start. A failure in step 11 (sentinel never loads) is also fatal — see the asset-loading-failures ADR. Step 12 is informational only — its warnings do not block startup, since the magenta-checker fallback handles the actual missing-texture case at render time.

The total wire cost on a cold load is one `manifest.json`, one profile, one world, one biome YAML — four small text fetches that are sub-50ms on localhost or a CDN. The loader runs once per page load; subsequent navigation within the SPA uses the in-memory result.

## Initial Slice Plan

Detailed slice plan lives at [120-slices.world-authoring.md](120-slices.world-authoring.md) (to be created). Summary:

| Slice | Scope | Dependencies | Effort |
|---|---|---|---|
| 113 | Config externalization plumbing. New `src/config/` module per the Component Architecture (types, defaults, schema, loader, discovery, selection, missing-texture sentinel, index with `getConfig()` accessor). `viteConfigManifest` plugin generating `public/config/manifest.json`. Three checked-in profiles. Strict per-tier schema validators (keyspace + structure + types + schemaVersion). Codebase migration from `import config` singleton to `getConfig()` accessor. | 100 (existing `ViewerConfig`) | 3/5 |
| 114 | Minimum-viable biome packs. `public/biomes/<name>/` directory convention, biome schema with reserved `props` / `audio` / `particles` slots (rejects non-empty), two biomes shipped (current + one new) to prove genericity. Magenta-checker missing-texture sentinel ships here. | 113 | 3/5 |
| 115 | World atmosphere tier + `atmosphereOverrides` mechanism. Extracts sky/sun/fog into `public/config/worlds/*.yaml`. Implements deep-merge with allowlisted override paths. Renderer consumes the merged result; biome→world override flow is functional. | 113, 114 | 2/5 |

Slice 113's effort moved from 2/5 to 3/5 in this revision: the runtime-fetch-not-bundle decision adds the Vite plugin and the manifest design, and the `src/config.ts`-triple-role decomposition adds the codebase-wide accessor migration.

Far-future (no slice numbers reserved):

- Per-cell biome data + edge blending — requires migratory server protocol extension + renderer multi-material blending. Likely two slices: protocol/data on the receive side, renderer on the visual side. See "Future-compatibility scope" below.
- 3D prop assets — populates the `props` schema slot. Asset-loader slice. Schema is forward-compatible by construction.
- Hot reload of config — owned by a slice co-incident with the in-app biome-picker UI, not before. See the hot-reload non-goal ADR.

## Future-compatibility scope

The `schemaVersion: 1` commitment guarantees that **biome.yaml, world.yaml, and profile.yaml files written today will still load successfully** under future versions of the viewer. The schema does not commit to:

- **The renderer's consumption interface.** Today the renderer consumes one flat hydrated `ViewerConfig` via `getConfig()`. When per-cell biomes ship, the renderer will instead consume *multiple* biome configs blended spatially, which is a real interface change in `src/rendering/`. Existing biome.yaml files will load identically; what changes is how the renderer combines them. This is an honest rearchitecture, not a free addition.
- **Any specific module structure inside `src/config/`.** That's an implementation detail; `getConfig()` is the contract.
- **The output shape of new top-level keys when they're added.** Reserving `props: []` today means future use of `props:` won't conflict at the YAML level, but the *schema* of a populated `props:` list is owned by whichever slice ships 3D prop support.

This ADR-level commitment is narrower than "everything keeps working forever," and is intentionally so. The schema is a stable file format; the renderer interface evolves with the rendering features.

## Component Architecture Boundaries

What slice 113 does **not** touch:
- Rendering code in `src/rendering/`
- `src/state.ts` and the snapshot/state-update flow
- Wire protocol in `src/protocol/`
- The terrain assembler from slice 112
- Any browser-side runtime behavior beyond reading config files

What slice 114 does **not** touch:
- The renderer's biome-application mechanism (already exists from slice 110)
- Terrain assembly or rendering math

What slice 115 does **not** touch:
- Per-cell biome data (deferred far-future)
- The biome pack format itself (only adds the override hook)

This separation keeps each slice mechanically reviewable and independently revertible.

## Third-Party Dependencies

- **YAML parser.** `js-yaml` (~20 KB minified, no dependencies, mature). The schema validation layer sits on top — `js-yaml` only handles parsing, not validation.
- No other new runtime dependencies in the 120-series base. Future slices may add an asset-loader library or audio library, but those are scoped to those slices.

## Risks and Mitigations

- **Schema lock-in.** The schema published in slice 113/114 is committed to forever (subject only to versioned migrations). Mitigation: reserve future-feature slots (`props`, `audio`, `particles`) up front; design the override allowlist deliberately in slice 115 even though only sky/sun/fog are initially overridable; make the validator strict so accidental shape drift fails loudly.
- **Profile/world/biome triplet drift.** If a profile points at a missing world, or a world points at a missing biome, the viewer must fail loudly with a specific error rather than silently using defaults. Mitigation: discovery uses the manifest-driven name resolution, which knows the full set of available names at fetch time and can produce the specific "profile X references world Y, but Y is not in the manifest" error before any merge happens. Validator tests cover all three drift patterns.
- **Vite plugin maintenance.** `viteConfigManifest` is a small in-tree plugin (probably <100 lines). Mitigation: keep it strictly as a directory-scan-to-JSON utility — no parsing, no validation, no opinions about content. Validation lives entirely in the runtime loader, where it can be unit-tested without Vite. The plugin's only failure mode is "manifest.json is missing or out of date," which manifests as a clear runtime error in `discovery.ts`.
- **Test isolation around `getConfig()`.** Module-private state in `index.ts` is shared across the test process. Mitigation: provide a test-only `resetConfig()` export that clears the stored result; document its use in the loader's test file; structure the loader as a pure function so most tests don't need `initializeConfig()` at all (they test `loader.ts` directly with fixture YAML strings).

## Review Remediation

### First review (2026-04-25)

The first architectural review (verdict CONCERNS, [120-review.arch.world-authoring.md](../reviews/120-review.arch.world-authoring.md) at the time, model z-ai/glm-5.1) raised nine findings. The first revision of this document addressed each:

| Finding | Severity | Resolution |
|---|---|---|
| F001 — Merge semantics undefined | concern | New ADR specifying deep-merge semantics with worked example. Arrays replace; nested objects recurse; primitives overwrite. |
| F002 — Profile can silently override world/biome | concern | Three-tiers ADR now defines explicit per-tier keyspaces. Cross-tier writes fail at validation, not merge. |
| F003 — `atmosphereOverrides` scope unbounded | concern | Override ADR now publishes a narrow allowlist. `terrain.slabDepth` is explicitly not overridable. New paths require `schemaVersion` migration. |
| F004 — Build-time vs runtime boundary | concern | New ADR commits to runtime fetching of YAML and assets from `public/`. Profile selection moves to URL query param + localStorage, not Vite env var. |
| F005 — Asset-loading failures unaddressed | concern | New ADR defines magenta-checker sentinel for missing textures + dev-mode HEAD preflight. Config validation failures still hard-fail. |
| F006 — Hot reload mentioned but not designed | concern | Explicitly added as a non-goal for slices 113-115; deferred to a later slice with the in-app biome-picker UI. |
| F007 — Symlink/copy build strategy is a workaround | concern | Dissolved by F004's resolution: assets and YAML both live under `public/`, no symlinks needed. Risk removed. |
| F008 — Multi-biome "schema unchanged" understated | note | New "Future-compatibility scope" section honestly distinguishes file-format compatibility (preserved) from renderer-interface compatibility (will change). |
| F009 — `src/config.ts` triple role | note | Component Architecture splits `src/config.ts` into `types.ts` / `defaults.ts` / `index.ts` (with `getConfig()` accessor). No module-level singleton mutation. |

### Second review (2026-04-25)

A second review pass against the first revision (verdict CONCERNS, same review file, same model) raised ten new findings. This revision addresses each:

| Finding | Severity | Resolution |
|---|---|---|
| F001 — Loader interface contradicts itself (fetches vs. raw text) | concern | Module split: `loader.ts` is pure and takes raw YAML text strings; `fetcher.ts` is the only I/O module and is the "fetch and parse coordinator." Module-responsibilities section names every component and its boundary. |
| F002 — Merge step doesn't define which keys flow into the result | concern | Tier-composition ADR now publishes per-tier mergeable-subset vs. resolution-only key tables. Resolution-only keys (`schemaVersion`, `defaultBiome`, `world`, `description`, `profile`, `biome`) never appear in `ViewerConfig`. |
| F003 — No null/unset semantics in deep-merge | concern | Tier-composition ADR defines YAML `null` (`~`) as a deletion marker that removes the key from the accumulator. Worked-example wording added. |
| F004 — `experiments/` has no discovery path | concern | Manifest plugin scan list now includes `public/config/experiments/`; manifest merges experiment profiles into the same `profiles` map. Name collisions are a hard plugin-time error. |
| F005 — `atmosphereOverrides` merge is non-standard, only by example | concern | Tier-composition ADR explicitly states step (2) extracts `atmosphereOverrides` contents and merges them at the corresponding world-tier paths, discarding the wrapper. The pipeline diagram shows this as `unwrap(biome.atmosphereOverrides)`. |
| F006 — Slice 113 must produce a valid ViewerConfig before world tier exists | concern | New "Pipeline shape across slices" table: `defaults.ts` starts holding all current hardcoded values; pipeline runs `defaults → profile` in slice 113, gains the biome stage in 114, gains the world + unwrap stages in 115. Same merge function throughout, applied to whichever inputs are present. |
| F007 — Biome validator coupled to world schema for allowlist | concern | `ATMOSPHERE_OVERRIDE_ALLOWLIST` lives in `schema.ts` as a single shared constant referenced by both validators. New world-tier keys are an allowlist decision in one place. |
| F008 — `manifest.json` structure undefined | note | Runtime-fetch ADR now includes a JSON example with `schemaVersion`, `profiles`, `worlds`, `biomes` maps. Each entry is a structured object (`{ "path": "..." }`) so future per-entry metadata can be added without a manifest schema bump. |
| F009 — Hex color string format underspecified | note | Hex-colors ADR pins the grammar to `/^0x[0-9a-f]{6}$/` (lowercase, six hex digits, no alpha, no `#`). Regex is exported from `schema.ts` as `HEX_COLOR_RE`. |
| F010 — Sentinel texture loading is async but onError assumes it's available | note | Sentinel-loading begins at `initializeConfig()` step 2 (before any biome texture load). `missing-texture.ts` exposes a `Promise<Texture>` that biome loading awaits once at startup. Sentinel load failure is fatal (build defect, not runtime condition). |

## Slice Plan Mapping

When [120-slices.world-authoring.md](120-slices.world-authoring.md) lands, this section will gain a status table mirroring the 100-arch convention.
