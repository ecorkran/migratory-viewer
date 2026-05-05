---
docType: slice-design
parent: user/architecture/120-slices.world-authoring.md
project: migratory-viewer
slice: "121"
sliceName: config-externalization-plumbing
dateCreated: 20260501
dateUpdated: 20260501
status: not_started
dependencies: ["100", "110", "111"]
interfaces: ["122", "123"]
---

# Slice 121: Config Externalization Plumbing

## Parent Documents

- Slice plan: [120-slices.world-authoring.md](../architecture/120-slices.world-authoring.md), entry **(121)**.
- Architecture: [120-arch.world-authoring.md](../architecture/120-arch.world-authoring.md) — the source of truth for ADRs, pipeline shape, module boundaries, and review remediation. This design implements the slice-121 row of the Pipeline-shape table and the Component Architecture section.

## Overview

Foundation slice for initiative 120. Replaces the [src/config.ts](../../src/config.ts) module-level singleton with a runtime-fetch-and-validate pipeline that loads YAML profiles from `public/config/profiles/`, deep-merges them onto hardcoded defaults, and exposes the result through a synchronous `getConfig()` accessor. Ships the entire `src/config/` module in its slice-121 shape (profile-only pipeline; world and biome content stays in `defaults.ts`), the Vite manifest plugin, three checked-in profiles, and the codebase-wide migration of every `import config` consumer to `getConfig()`.

This slice does not move biome or world content into YAML — that is slices 122 and 123. The merge function and module split, however, are written in their full slice-115/123 shape so subsequent slices add inputs to an existing pipeline rather than restructuring it.

## Value

**Architectural enablement.** Slice 121 alone delivers no user-visible feature — by design, renderer behavior is unchanged. What it delivers is the contract every later slice in the 120-series consumes:

- A pure, testable `loader.ts` over raw YAML strings that slices 122 and 123 extend with biome and world parsers.
- A schema-validation harness (`schema.ts`) that strictly rejects unknown keys, wrong types, and unknown `schemaVersion` — the loud-failure invariant from the parent architecture's "Schema is versioned from day one" ADR.
- A `getConfig()` accessor that breaks the module-singleton pattern, eliminating the test-isolation problem the architecture's "Why the module split" section identifies.
- Runtime profile selection via `?profile=<name>` URL param + `localStorage`, replacing the current build-time `VITE_SERVER_URL` substitution and unblocking content velocity (no rebuild to switch profiles).

The migration step (every `import config` consumer becomes `getConfig().foo`) is bundled inside this slice — leaving a half-migrated codebase would create exactly the problem the architecture is designed to prevent.

## Technical Scope

### In scope
- New `src/config/` module: nine TypeScript files per the parent's Component Architecture section (`types.ts`, `defaults.ts`, `schema.ts`, `loader.ts`, `fetcher.ts`, `discovery.ts`, `selection.ts`, `missing-texture.ts`, `index.ts`).
- `js-yaml` runtime dependency (production).
- `viteConfigManifest` Vite plugin (in-tree under `vite-plugins/` or similar) generating `public/config/manifest.json`.
- Three checked-in profiles under `public/config/profiles/`: `default.yaml`, `lowend.yaml`, `cinematic.yaml`. Profiles contain only the profile-tier keyspace (`schemaVersion`, `profile`, `description`, `camera`, `network`, `performance`, `debug`, `world`).
- A reserved-but-unused `world: default` resolution-only key in each profile (so slice 123's switch to world-driven biome selection is purely additive in YAML).
- `experiments/` directory under `public/config/`, gitignored, scanned by the manifest plugin and merged into the manifest's `profiles` map.
- Magenta-checker sentinel file (`public/assets/missing-texture.png`) and `missing-texture.ts` eager-loader. The sentinel ships now even though no biome textures are loaded yet — `missing-texture.ts` is part of `initializeConfig()`'s startup sequence and slice 122 plugs textures into the existing handler.
- App-boot wiring in [src/main.ts](../../src/main.ts): `await initializeConfig()` before any renderer or connection setup runs.
- Codebase-wide migration: every `config.foo` reference in the eight current consumers (and any test fixtures) becomes `getConfig().foo`.
- Unit tests covering `loader.ts` (fixture YAML strings → parsed-and-validated outputs), `schema.ts` (positive and negative validation cases), `discovery.ts` (manifest parsing + name resolution + missing-name errors), `selection.ts` (URL param vs. localStorage vs. fallback precedence).
- Integration test exercising `initializeConfig()` end-to-end with a mocked `globalThis.fetch`.

### Out of scope (deferred to slice 122 or 123)
- Any biome YAML, biome directory, or biome schema. `defaults.ts` continues to hold `BiomeConfig` (current `DEFAULT_BIOME` value) and `DEFAULT_BIOME_NAME`.
- Any world YAML or world schema. `defaults.ts` continues to hold sky/sun/fog/terrain values.
- The `atmosphereOverrides` mechanism. `loader.assemble()` accepts the input shape but the slice-121 caller never provides it.
- HEAD-request preflight (no biome textures to preflight yet — added in slice 122).
- Hot reload (parent ADR: non-goal for slices 121-123).
- An in-app profile picker UI (deferred far-future).

### Out of scope (architecture decision, not deferred)
- The `getConfig()` accessor never exposes `schemaVersion`, `profile`, `description`, or the resolution-only `world` key. Code that needs the active profile name calls a separate accessor on `index.ts` if added later; slice 121 ships only what current consumers need.

## Dependencies

### Prerequisites
- Slice 100 (Project Scaffold) — provides the Vite + TypeScript baseline this slice extends.
- Slice 110 / 111 (Terrain Surface Material / Slab and Texture) — defines the current `BiomeConfig` shape that `defaults.ts` mirrors. No code changes required from those slices; this slice only consumes their published TypeScript interface.

### Interfaces required from existing code
- The eight consumers (`main.ts`, `ui/hud.ts`, `protocol/deserialize.ts`, `protocol/terrain-assembler.ts`, `rendering/entities.ts`, `rendering/scene.ts`, `rendering/camera.ts`, `rendering/terrain.ts`) currently expect a synchronous `config: ViewerConfig` import. After this slice they will expect a synchronous `getConfig(): ViewerConfig` call that throws if `initializeConfig()` hasn't completed. The shape of the object returned is identical.
- Two test files (`src/state.test.ts`, `src/rendering/terrain.test.ts`, `src/rendering/entities.test.ts`) reach into config — they migrate to `getConfig()` plus a per-test `resetConfig()` + `initializeConfig({ override })` pattern (test-only API; see "Test isolation" below).

### Third-party dependencies
- **`js-yaml`** (production) — YAML parser. ~20 KB minified, no transitive deps. Architecture-decided in the parent. Pinned to a current minor version.
- No other new runtime deps. The Vite plugin uses Node built-ins only (`fs`, `path`).

## Architecture

### Component structure

The parent architecture document publishes the canonical file layout (Component Architecture section). This slice ships the slice-121 column of that layout:

```
src/config/
├── types.ts         # ViewerConfig, ProfileConfig, BiomeConfig, ProfileMergeable,
│                    # ProfileResolution, AtmosphereOverrides (empty-shape stub for now),
│                    # tier-specific TS interfaces. Pure types, no runtime code.
├── defaults.ts      # All current hardcoded values (mirrors src/config.ts today).
│                    # Includes DEFAULT_BIOME, DEFAULT_BIOME_NAME, sky/sun/fog/terrain,
│                    # camera, network, performance, debug — the slice-121 row of the
│                    # parent's Pipeline-shape table.
├── schema.ts        # Profile-tier validator, ATMOSPHERE_OVERRIDE_ALLOWLIST,
│                    # HEX_COLOR_RE. World and biome validators are stubs in this slice
│                    # — file structure is in place, slices 122/123 fill them in.
├── loader.ts        # parseProfile(yamlText) + assemble(inputs). World/biome parsers
│                    # are stubs that throw "not implemented in slice 121" if called.
├── fetcher.ts       # Manifest fetch + profile fetch. World/biome fetch stages are
│                    # absent (no manifest entries to drive them).
├── discovery.ts     # Manifest parsing, name → path resolution.
├── selection.ts     # Pure reader: ?profile= → localStorage → 'default'.
├── missing-texture.ts # Sentinel Promise<Texture>, eager-loaded at initializeConfig().
└── index.ts         # initializeConfig(), getConfig(), getActiveBiomeName(),
                     # resetConfig() (test-only). Module-private state.

public/
├── assets/
│   └── missing-texture.png    # 64×64 magenta-checker sentinel
└── config/
    ├── manifest.json          # generated by viteConfigManifest at dev/build
    ├── profiles/
    │   ├── default.yaml
    │   ├── lowend.yaml
    │   └── cinematic.yaml
    └── experiments/           # gitignored; .gitkeep so the dir exists in tree

vite.config.ts                 # registers viteConfigManifest plugin
vite-plugins/
└── config-manifest.ts         # the plugin source (~80 lines target)
```

`worlds/` and `biomes/` directories under `public/` are not created in slice 121 (the manifest plugin tolerates their absence — it scans only directories that exist).

### Data flow at startup (slice-121 shape)

The parent architecture's "Data Flow at Startup" numbers steps in execution order for the slice-115/123 endpoint. The slice-121 prefix runs steps 1–6, 9, 10, 12, 13. Steps 7, 8, 11 are skipped (no world fetch, no biome fetch, no DEV preflight — there are no biome texture paths to preflight yet).

```
1. main.ts calls await initializeConfig() before any renderer setup.
2. missing-texture.ts begins eager-loading the sentinel (Promise<Texture>) — kicked off
   even though no biome textures will load this slice; the promise machinery and the
   sentinel asset are exercised end-to-end so slice 122 has zero new wiring.
3. selection.ts resolves the candidate profile name (read-only):
   ?profile=<name>  →  localStorage('migratory.profile')  →  'default'
4. fetcher.ts fetches public/config/manifest.json; discovery.ts parses + validates
   manifest schemaVersion === 1.
5. discovery.ts confirms the candidate profile name is in the manifest. On miss:
   throws with the available-names list. On hit: index.ts writes the confirmed name to
   localStorage('migratory.profile'). An invalid ?profile= name is never persisted.
6. fetcher.ts fetches public/config/profiles/<profile>.yaml (path from discovery.ts)
   and calls loader.parseProfile(text). Returns { mergeable, resolution }; resolution
   carries `world: <name>` (unused in slice 121; preserved for slice 123).
9. fetcher.ts calls loader.assemble({ profile: parsed.mergeable }), which deep-merges
   defaults.ts → profile.mergeable. assemble() runs the final structural check on the
   merged ViewerConfig (defense-in-depth).
10. initializeConfig() awaits the sentinel promise from step 2. Sentinel load failure is
    fatal (build defect, per the asset-loading-failures ADR).
12. initializeConfig() stores the merged ViewerConfig and resolution objects in
    module-private state.
13. main.ts proceeds to renderer setup. Existing renderer/HUD/protocol code calls
    getConfig() to read values.
```

Total wire cost: one `manifest.json` + one profile YAML — sub-50ms on localhost.

### State management

`index.ts` holds three module-private slots:
- `mergedConfig: ViewerConfig | null`
- `resolution: { profile: ProfileResolution } | null` (slice 121 only carries the profile resolution; slice 123 adds `world`)
- `inFlight: Promise<void> | null`

`initializeConfig()` is idempotent: first call kicks off the fetch pipeline and stores the in-flight promise; concurrent calls await the same promise; subsequent calls after resolution return immediately. Errors are sticky — a rejected `initializeConfig()` keeps the rejection cached and re-rejects on every subsequent call until `resetConfig()` clears state. This matches the parent ADR's "concurrent `initializeConfig()` calls" resolution from third review F010.

`getConfig()` throws synchronously if `mergedConfig === null`. The error message names the bug class — `'getConfig() called before initializeConfig() resolved — fix boot order'` — because this is a development-time error, not a runtime data condition.

`resetConfig()` clears all three slots. Test-only; production code never imports it.

## Technical Decisions

### `assemble()` signature and pipeline shape (slice-121 path through it)

Per the parent's Component Architecture section, `assemble()`'s full signature is:

```ts
function assemble(inputs: {
  profile: ProfileMergeable;
  world?:  WorldMergeable;
  biome?:  { mergeable: BiomeMergeable; atmosphereOverrides: AtmosphereOverrides };
}): ViewerConfig
```

Slice 121 only ever passes `profile`. The merge code is written to walk the full five-stage pipeline `defaults → world.mergeable → biome.mergeable → unwrap(biome.atmosphereOverrides) → profile.mergeable` and skip stages whose inputs are absent. This is one `if (inputs.world)` per stage in `assemble()` — same code path slices 122 and 123 use without restructuring.

The deep-merge primitive (private to `loader.ts`) handles the value rules from the parent's "Tiers compose by deep merge" ADR: primitive replaces primitive, nested object recurses, array replaces array, YAML `null` (`~`) deletes the key from the accumulator. Slice 121 exercises only the primitive-replace and nested-object-recurse cases (profile fields are flat or shallow); the array-replace and null-delete cases are still covered by unit tests against fixture YAML so slices 122 and 123 don't have to add merge tests retroactively.

### Schema validation surface

`schema.ts` exports:
- `validateProfile(parsed: unknown): ProfileTier` — full validator: keyspace + structure + types + `schemaVersion: 1`. Throws `SchemaError` with file path and field path on any violation.
- `validateWorld(parsed: unknown): WorldTier` — stub that throws `'world validator not implemented in slice 121'` if called. Slice 123 fills it in.
- `validateBiome(parsed: unknown): BiomeTier` — stub that throws `'biome validator not implemented in slice 121'` if called. Slice 122 fills it in.
- `validateFull<T>(rootKey: string, obj: unknown): T` and `validatePartial<T>(rootKey: string, obj: unknown): T` — used by future biome leaf-validation. Slice 121 ships the function-shape but only `validateFull` is exercised by `validateProfile`.
- `ATMOSPHERE_OVERRIDE_ALLOWLIST = ['sky', 'sun', 'fog'] as const`. Used by slice 123's biome validator; defined here so slice 121 can verify the constant export and so import paths don't change between slices.
- `HEX_COLOR_RE = /^0x[0-9a-f]{6}$/`. Used by all three tiers.

The validator is hand-rolled (no Zod or similar). Per the parent ADR, ~30-50 lines per tier; profile is the smallest (~25 lines) because its keyspace is the smallest.

`SchemaError` is a discriminated-union error class:

```ts
type SchemaError =
  | { kind: 'unknown-key';     file: string; path: string; key: string; expectedTier: string | null }
  | { kind: 'wrong-type';      file: string; path: string; expected: string; got: string }
  | { kind: 'unknown-version'; file: string; got: number; supported: readonly number[] }
  | { kind: 'invalid-value';   file: string; path: string; got: unknown; reason: string };
```

Rendered as a single error message string for the blocking failure overlay.

### Profile YAML shape

```yaml
schemaVersion: 1
profile: default
description: "Default profile — balanced rendering for typical hardware."
world: default              # resolution-only; consumed by slice 123, ignored in slice 121

camera:
  perspectiveFov: 50
  defaultPitch: 24
  defaultYaw: 0
  pitchMin: 15
  pitchMax: 85
  dollyMinRatio: 0.05
  dollyMaxRatio: 3.0
  dollyDefaultRatio: 0.72
  modeTransitionSeconds: 0.5
  zoomMin: 0.1
  zoomMax: 10
  allowOutOfBoundsView: false

network:
  serverUrl: "ws://localhost:8765"

performance:
  defaultEntityCount: 500
  maxEntityCount: 200000
  terrainMaxCells: 4000000

debug:
  # Reserved keyspace; empty in default profile.
```

`lowend.yaml` overrides `performance.maxEntityCount` and `performance.terrainMaxCells` to lower values; `cinematic.yaml` overrides camera FOV / pitch / dolly ratios for a more dramatic angle. The exact values are determined during implementation; this design pins only the keyspace.

The current `import.meta.env.VITE_SERVER_URL` fallback at [src/config.ts:127](../../src/config.ts#L127) is replaced by `network.serverUrl` in YAML. The `VITE_SERVER_URL` env var path is deleted — the URL query param + localStorage path is the runtime override mechanism going forward (per the parent ADR's "Profile selection is a URL query parameter or `localStorage` value, not a Vite env var" decision).

### Manifest plugin

The plugin is a small Vite plugin (`vite-plugins/config-manifest.ts`):

```ts
export function configManifest(): Plugin {
  return {
    name: 'migratory-viewer:config-manifest',
    buildStart() { writeManifest(); },     // dev: initial generation
    closeBundle() { writeManifest(); },    // build: post-public-copy, pre-finalization
    configureServer(server) {
      server.watcher.add(['public/config/profiles', 'public/config/experiments']);
      server.watcher.on('add',    onChange);
      server.watcher.on('unlink', onChange);
      server.watcher.on('change', onChange);  // YAML edits don't change manifest, but rename does
      function onChange(path: string) {
        if (path.includes('public/config/')) writeManifest();
      }
    },
  };
}
```

`writeManifest()` scans `public/config/profiles/`, `public/config/experiments/`, `public/config/worlds/` (absent in slice 121 — tolerate `ENOENT`), and `public/biomes/` (absent in slice 121 — tolerate `ENOENT`); produces the JSON shape from the parent ADR's "Discovery uses a build-time-generated manifest" section; writes `public/config/manifest.json`. Name collisions between `profiles/` and `experiments/` (same basename) are a hard plugin-time error.

The slice-121 manifest contains:
```json
{
  "schemaVersion": 1,
  "profiles": {
    "default":   { "path": "/config/profiles/default.yaml" },
    "lowend":    { "path": "/config/profiles/lowend.yaml" },
    "cinematic": { "path": "/config/profiles/cinematic.yaml" }
  },
  "worlds": {},
  "biomes": {}
}
```

Empty `worlds` and `biomes` maps are intentional — `discovery.ts` returns an empty resolution table for absent maps; slice 122 populates `biomes`; slice 123 populates `worlds`.

### Selection precedence and localStorage write path

`selection.ts` is a **pure reader** (parent ADR fourth-review F001 resolution):

```ts
export function readCandidateProfile(window: Window): string {
  const fromUrl = new URLSearchParams(window.location.search).get('profile');
  if (fromUrl) return fromUrl;
  const fromStorage = window.localStorage.getItem('migratory.profile');
  if (fromStorage) return fromStorage;
  return 'default';
}
```

The localStorage **write** lives in `index.ts`, executed at data-flow step 5 — *after* `discovery.ts` confirms the name is in the manifest. An invalid `?profile=` name (not in the manifest) throws before the write, so it is never persisted.

Constants: `LOCAL_STORAGE_KEY = 'migratory.profile'` and `DEFAULT_PROFILE_NAME = 'default'`, both exported from `selection.ts` so tests reference one definition.

### Test isolation

`resetConfig()` is exported from `index.ts` at module top-level. It is documented as test-only and the production code never imports it. Existing tests that touch config (e.g., `state.test.ts` reads `config.maxEntityCount`) follow this pattern:

```ts
import { initializeConfig, getConfig, resetConfig } from '../config/index.ts';

beforeEach(async () => {
  resetConfig();
  // Tests can either mock fetch and let initializeConfig() run, or call a test
  // helper that bypasses the fetch chain by setting module-private state directly.
});
```

A test helper `__setConfigForTesting(cfg: ViewerConfig)` is exported alongside `resetConfig()` for tests that don't want to mock fetch — it directly populates `mergedConfig` and is the recommended path for unit tests of consumers (every existing consumer's test would otherwise need a manifest fixture). Per the TypeScript rules, this helper has its `// TODO: tighten exports if vitest gains environment support` mitigation in the source; the production codebase never references it.

## Implementation Details

### Migration plan

The migration is mechanical: `import config from '../config.ts'` becomes `import { getConfig } from '../config/index.ts'`, and every `config.foo` becomes `getConfig().foo`. The eight consumer files are listed in the table below with their `config.X` references summarized so tasks can size each file.

| File | Approx. references | Notes |
|---|---|---|
| [src/main.ts](../../src/main.ts) | 5 | Also gains the `await initializeConfig()` call before any other setup. |
| [src/rendering/camera.ts](../../src/rendering/camera.ts) | ~25 | Largest consumer (camera params dominate). Pure substitution. |
| [src/rendering/entities.ts](../../src/rendering/entities.ts) | ~6 | Cone geometry + profile palette + max instance count. |
| [src/rendering/terrain.ts](../../src/rendering/terrain.ts) | tbd | Slab depth, biome config, terrain max cells. Pure substitution. |
| [src/rendering/scene.ts](../../src/rendering/scene.ts) | tbd | Lighting + background color. Pure substitution. |
| [src/protocol/deserialize.ts](../../src/protocol/deserialize.ts) | 4 | `maxEntityCount` reads in the snapshot/state-update parsers. |
| [src/protocol/terrain-assembler.ts](../../src/protocol/terrain-assembler.ts) | tbd | `terrainMaxCells` cap. Pure substitution. |
| [src/ui/hud.ts](../../src/ui/hud.ts) | 2 | Profile color lookup. Pure substitution. |
| [src/state.ts](../../src/state.ts) | tbd | Mechanical substitutions only — no behavior change (parent ADR's "Component Architecture Boundaries" item). |

Tests (`src/state.test.ts`, `src/rendering/terrain.test.ts`, `src/rendering/entities.test.ts`) migrate to `__setConfigForTesting()` + `resetConfig()` per the test-isolation pattern above.

The old [src/config.ts](../../src/config.ts) file is **deleted** in the same commit as the consumer migration. There is no transition period where both the old singleton and the new accessor coexist — that would be a half-migrated codebase and the parent architecture explicitly disallows it.

### Behavior-preservation verification

Every `config.foo` in the old singleton becomes `getConfig().foo` after the merge of `defaults.ts → profile.mergeable`. With `default.yaml` selected (the default fallback), `defaults.ts` carrying every current value, and `default.yaml` overriding nothing meaningful (or carrying values byte-identical to the defaults), the merged `ViewerConfig` is value-equal to the old `config` singleton. The renderer, HUD, protocol, and state code all see the same numbers they did before. A targeted test compares the merged result against a snapshot of the old singleton's values to lock in this invariant for the slice-121 commit.

`?profile=lowend` and `?profile=cinematic` are the visible behavior changes the slice introduces — switching profiles now requires no rebuild, only a URL change.

### Vite config changes

`vite.config.ts` gains:
- The `configManifest()` plugin registration.
- Removal of any `define`/`envPrefix` configuration related to `VITE_SERVER_URL` (no longer needed).

The existing Vite asset-pipeline behavior for `public/` is unchanged — no symlinks, no copy steps.

### File structure for unit tests

```
src/config/
├── loader.test.ts          # parseProfile fixtures (good + bad), assemble pipeline
├── schema.test.ts          # validator positive + negative cases (unknown key, wrong
│                           # type, unknown schemaVersion, hex color grammar)
├── discovery.test.ts       # manifest parsing, name resolution, missing-name error
├── selection.test.ts       # URL > localStorage > fallback precedence
└── deep-merge.test.ts      # primitive replace, nested recurse, array replace,
                            # null-delete (the last two are exercised here even though
                            # slice 121 doesn't use them in production)
```

Integration test under `src/config/integration.test.ts` exercises `initializeConfig()` end-to-end with `globalThis.fetch` mocked to return manifest + profile YAML strings.

## Integration Points

### Provides to other slices

- `getConfig(): ViewerConfig` — the primary contract for every renderer/HUD/protocol consumer.
- `initializeConfig(): Promise<void>` — startup hook.
- `resetConfig() / __setConfigForTesting()` — test-only.
- `loader.parseProfile(text)` and `loader.assemble(inputs)` — slice 122 imports these and adds `parseBiome`. Slice 123 adds `parseWorld`.
- `schema.ATMOSPHERE_OVERRIDE_ALLOWLIST`, `schema.HEX_COLOR_RE`, `schema.validateFull`, `schema.validatePartial` — slices 122 and 123 fill in their tier validators around these.
- `fetcher.ts`'s coordinator — slice 122 adds the biome-fetch step at data-flow step 8; slice 123 adds the world-fetch step at data-flow step 7.
- `discovery.ts` — slices 122/123 read the `biomes` / `worlds` maps (already shipped empty).
- The `viteConfigManifest` plugin — slices 122/123 do not touch the plugin itself; they add directories under `public/`, the plugin already scans them on the next dev-server change or build.
- The `Promise<Texture>` sentinel — slice 122 plugs biome textures into the existing `onError` handler.

### Consumes from other slices

None directly. Slice 121 reads from existing rendering/protocol code only as the *target* of the migration (those modules don't change shape, they only change their config-import path). The current `BiomeConfig` and `ProfileConfig` shapes from [src/config.ts](../../src/config.ts) (slices 110/111) become the corresponding interfaces in `types.ts` byte-identical.

## Success Criteria

### Functional
- `initializeConfig()` resolves successfully with `?profile=` absent (uses `'default'`), `?profile=cinematic` (matches manifest entry), and `?profile=lowend` (matches manifest entry).
- `?profile=does-not-exist` produces a blocking, full-screen error overlay naming the requested profile and listing the available profiles. The viewer does not start.
- `localStorage.getItem('migratory.profile')` is `'cinematic'` after a session loaded with `?profile=cinematic`; loading the page without `?profile=` then resolves the cinematic profile via the localStorage fallback.
- A profile YAML with a typo'd field name (e.g., `cmaera:` instead of `camera:`) fails the load with an error pointing to the file, the offending key, and the expected tier. The viewer does not start.
- A profile YAML with a wrong-type field (e.g., `perspectiveFov: "wide"`) fails the load with an error pointing to file + field path + got/expected types. The viewer does not start.
- A profile YAML with an unknown `schemaVersion` (e.g., `99`) fails the load with an error naming the supported versions. The viewer does not start.
- Adding a YAML file to `public/config/experiments/` during `pnpm dev` makes it resolvable as `?profile=<basename>` without restarting the dev server.
- The renderer and HUD render byte-identical frames against the `default` profile compared to the pre-slice main branch (same scene, same colors, same camera, same entity colors).
- Sentinel asset (`public/assets/missing-texture.png`) eager-loads at boot — observable as a network request in DevTools that resolves before any renderer setup. (Slice 122 will exercise the sentinel via real biome-texture failures; in slice 121 only the eager-load is exercised.)

### Technical
- Unit tests: `loader.ts`, `schema.ts`, `discovery.ts`, `selection.ts`, deep-merge primitive — all green.
- Integration test for `initializeConfig()` end-to-end — green.
- All eight pre-existing consumer files migrated to `getConfig()`; old [src/config.ts](../../src/config.ts) deleted.
- All pre-existing tests that referenced the old `config` singleton migrated to `__setConfigForTesting()` + `resetConfig()` — all green.
- TypeScript strict mode passes (`tsc --noEmit`).
- Behavior-preservation test (snapshot of the old singleton's values vs. merged result with `default.yaml`) — green.
- No `any` introduced. `unknown` + type guards in the YAML parse boundary; discriminated unions in the `SchemaError` type.

### Verification walkthrough

This is the demo script the Project Manager runs to confirm the slice delivers what it claims. Each step is a concrete command or browser action with the expected observation.

**Setup (one-time):**
```bash
git checkout 121-slice.config-externalization-plumbing
pnpm install            # picks up js-yaml
pnpm test               # all unit + integration tests pass
pnpm build              # production build succeeds; dist/ contains dist/config/manifest.json
```

**Run 1: default profile.**
```bash
pnpm dev
```
Open `http://localhost:5173/` (no `?profile=` query). DevTools Network tab shows:
1. `manifest.json` — 200 OK, ~300 bytes JSON containing `profiles: { default, lowend, cinematic }`.
2. `default.yaml` — 200 OK.
3. `missing-texture.png` — 200 OK.

The viewer renders the scene byte-identical to main (same colors, same camera angle, same entity sizes). HUD shows the same profile-color legend as before.

**Run 2: profile switching at runtime.**
Reload the page with `?profile=cinematic`. Network tab shows `manifest.json` then `cinematic.yaml`. Camera FOV / pitch / dolly ratios reflect cinematic profile values (visibly different framing). No rebuild required.

`localStorage.getItem('migratory.profile')` in the DevTools console returns `'cinematic'`. Reload without `?profile=`; cinematic profile loads via the localStorage fallback (visibly the same framing as the previous load, manifest + cinematic.yaml fetched).

**Run 3: experiments directory.**
Create `public/config/experiments/my-test.yaml` with valid profile content, leave the dev server running. Reload `?profile=my-test`. The manifest plugin's file watcher has regenerated `manifest.json` to include `my-test` under `profiles`; the viewer loads with the experiment profile values.

Delete the file. Reload `?profile=my-test`. The viewer fails to start with a blocking error `profile "my-test" is not in the manifest (available: default, cinematic, lowend)`.

**Run 4: schema failure modes.**
Edit `public/config/profiles/default.yaml` to include a typo `cmaera:` (instead of `camera:`). Reload. Blocking error names the file, the unknown key, and that no tier accepts it.

Restore `camera:` and edit `perspectiveFov: 50` → `perspectiveFov: "wide"`. Reload. Blocking error names the file, field path `camera.perspectiveFov`, expected `number`, got `string`.

Restore the value and edit `schemaVersion: 1` → `schemaVersion: 99`. Reload. Blocking error names the file and lists supported versions `[1]`.

Revert all edits.

**Run 5: localStorage isolation on bad input.**
With localStorage already containing `'cinematic'` (from Run 2), reload with `?profile=does-not-exist`. The viewer fails to start with the available-names error. `localStorage.getItem('migratory.profile')` is *still* `'cinematic'` — the bad name was never persisted. Clear `?profile=` and reload; cinematic loads.

**Run 6: build-time manifest generation.**
```bash
rm -rf dist/
pnpm build
cat dist/config/manifest.json
```
The manifest contains the three checked-in profiles (no entries from `experiments/` if it's empty in the build context).

**Run 7: behavior-preservation snapshot.**
```bash
pnpm test src/config/behavior-preservation.test.ts
```
The snapshot compares every `getConfig().foo` value (with `default.yaml` selected) against a hand-typed snapshot of the pre-slice `config` singleton. All fields equal; test green.

If every step above produces the stated observation, the slice delivers what it claims.

## Risk Assessment

### Technical risks (genuine, not speculative)

- **Migration touches eight consumer files in one commit.** A typo or missed substitution shows up as a TypeScript error (`config.foo` is no longer in scope after the import changes) — strict mode catches this at `pnpm build`. Mitigation: complete the migration in the same commit as the deletion of the old `config.ts`; do not stage the changes incrementally. Tests provide the second line of defense.
- **Vite plugin file-watcher behavior.** `closeBundle` is the documented hook for the production path; the dev-server `chokidar` watcher behavior is the unknown. Mitigation: the plugin's failure mode is "manifest stale or missing," which manifests as a clear runtime error in `discovery.ts` (one of the existing failure paths), not silent corruption. If the watcher misses a directory-add event, the developer restarts `pnpm dev` — no data loss. The Run-3 verification step exercises the dev-server path.
- **`js-yaml`'s default schema.** `js-yaml` accepts YAML 1.1 by default, which has surprising boolean coercion (`yes`/`no`/`on`/`off`). Mitigation: parse with `yaml.load(text, { schema: yaml.JSON_SCHEMA })` to restrict to JSON-compatible values. Hex colors are strings (matching `HEX_COLOR_RE`), so YAML's number-coercion edge cases don't reach color fields.

### Mitigations not listed above
- **Test isolation across the suite.** `resetConfig()` is called in `beforeEach` of every test that touches config; the integration test resets module-private state explicitly.
- **No `any`.** Validator boundaries use `unknown` and narrow with discriminated unions.

## Implementation Notes

### Suggested implementation order within the slice

1. Create `src/config/types.ts` (port the current `ViewerConfig`/`ProfileConfig`/`BiomeConfig` interfaces; add `ProfileMergeable`, `ProfileResolution`, the empty `AtmosphereOverrides` shape).
2. Create `src/config/defaults.ts` (port every current hardcoded value from `src/config.ts`, including `DEFAULT_BIOME` and `DEFAULT_BIOME_NAME`). At this point `defaults.ts` is value-equal to the current singleton.
3. Create `src/config/schema.ts` with `validateProfile()`, `HEX_COLOR_RE`, `ATMOSPHERE_OVERRIDE_ALLOWLIST`, `validateFull/validatePartial`, and the `validateWorld/validateBiome` stubs. Add `schema.test.ts`.
4. Create `src/config/loader.ts` with `parseProfile()`, `assemble()`, the deep-merge primitive, and the world/biome stubs. Add `loader.test.ts` and `deep-merge.test.ts`.
5. Create `src/config/discovery.ts` and `selection.ts` with their tests.
6. Create `src/config/missing-texture.ts` with the eager-load Promise.
7. Create `src/config/index.ts` with `initializeConfig()`, `getConfig()`, `getActiveBiomeName()`, `resetConfig()`, `__setConfigForTesting()`. Add `integration.test.ts`.
8. Create the three profile YAMLs under `public/config/profiles/`.
9. Create `vite-plugins/config-manifest.ts` and register it in `vite.config.ts`.
10. Add `public/assets/missing-texture.png` (64×64 magenta-checker).
11. Wire `await initializeConfig()` into [src/main.ts](../../src/main.ts).
12. Migrate the eight consumers to `getConfig()`. Delete the old [src/config.ts](../../src/config.ts).
13. Migrate the three test files using config to `__setConfigForTesting()` + `resetConfig()`.
14. Add `behavior-preservation.test.ts` snapshot.
15. Run full suite + `pnpm build`. Verify against the walkthrough above.

This order keeps the working tree compilable at most steps — steps 1-10 add new code without touching consumers; the consumer migration in step 12 is the breaking change and the deletion of the old config in the same commit closes the window.

### Special considerations

- **`profile.world` is unused but reserved.** Slice 121 tolerates it in profile YAML (it's in the resolution-only key list). Slice 123's switch from `defaults.DEFAULT_BIOME_NAME` to `world.resolution.defaultBiome` does not require any profile YAML change — `profile.world` was already there. This is the architecture's "additive across slices" invariant in practice.
- **No `import.meta.env.DEV` preflight in slice 121.** The preflight is only useful for biome textures (which don't exist yet). Wiring it in `initializeConfig()` is deferred to slice 122 where the biome-texture list becomes non-empty.
- **Module-private state is per-process.** In a Vitest run, each test file shares a process by default. Tests that run in parallel must use `resetConfig()` in `beforeEach` — Vitest runs files in parallel but tests within a file serially, so per-test reset is sufficient.
