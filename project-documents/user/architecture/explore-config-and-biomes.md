---
docType: design-exploration
project: migratory-viewer
status: draft
dateCreated: 20260425
dateUpdated: 20260425
---

# Design Exploration: Config Externalization, Biome Packs, and World Authoring

## Purpose

Think through the layering and schema choices *before* committing to a slice plan. This is a 1-2 conversation pass to align on shape; the formal slice designs (113, 114, …) will follow once the exploration is signed off.

The PM has confirmed:
- Biome count will scale to many (Minecraft-comparable). Schema must support that without becoming unwieldy.
- Camera tuning is profile-scoped.
- Biome is "any physical characteristic of a world area."
- Sky color etc. is world-scoped (atmosphere) but biomes may modify locally.
- Visual parameters only at the world tier — *not* simulation parameters like gravity. Sim is server-owned.
- The minimum-viable biome pack is a single texture; everything else accretes.

## The three tiers

The hardest call in this design is *where each tunable lives*. Three tiers cleanly separate concerns:

### 1. Profile (viewer-local, ergonomic)

Things the *viewer user* tunes for their setup or preference. Different developers' machines, different demo scenarios, different perf budgets. Profiles do **not** affect what the world looks like.

Examples:
- Camera params: FOV, default pitch/yaw, dolly range, zoom limits, transition timings
- Lighting *intensity* knobs (when these are perf-related, not artistic)
- Performance caps: `terrainMaxCells`, `maxEntityCount`
- Server endpoint URL
- Debug flags: `allowOutOfBoundsView`, future devtool toggles

Profiles are **swappable at startup** via `VITE_PROFILE=highend` (or similar). Multiple are checked into the repo (`default`, `lowend`, `cinematic`); an `experiments/` subdir is gitignored for ad-hoc tweaks.

### 2. World (shared, atmospheric)

Things that describe the *whole world's atmosphere* — what every player would see regardless of where they're standing. The world is one logical place; biomes are *patches* on it. Sky and fog are world-tier because they unify the visual identity.

Examples:
- Sky color (hemisphere sky/ground)
- Background color
- Directional light direction and color (the "sun")
- Fog (when added): distance, color, falloff
- Ambient soundscape (eventually)
- Time-of-day controller params (eventually — but the *value* of time-of-day is sim state, not config)

A world has **one** active configuration at a time. The world config is selected at server-handshake time or hard-coded per environment for now. (We're in viewer-only territory; the server doesn't yet declare a world ID, but it will need to eventually.)

**Biomes can selectively override world atmosphere.** When you walk into a swamp biome, fog might thicken and tint green even though the world's default fog is light gray. Mechanism: biome.yaml has an optional `atmosphereOverrides` section; the renderer interpolates between world defaults and per-biome overrides based on which biome the camera is in (or, when biomes blend at edges, weighted average). Slice 114 establishes the override hook even if only color is overridable initially.

### 3. Biome (per-region, physical)

Things that describe what a *patch of terrain* physically looks and feels like. Multiple biomes coexist in one world; the server tells the client which biome each terrain cell belongs to (future protocol extension — out of slice 113/114 scope).

Examples (slice 114 minimum):
- Surface texture (diffuse, eventually normal/roughness/AO)
- Cliff texture (already separated in slice 110)
- Color tint / modifier (multiplied or added over the texture)
- Slope-blend thresholds (a desert and a forest classify "cliff" differently)
- Texture tiling scale

Examples (later slices, schema reserves slots):
- 3D props: trees, rocks, structures with placement rules
- Particle effects: blowing leaves, dust, fireflies
- Footstep / ambient audio per biome
- Fauna spawn hints (server-driven; client uses for visual previews)

## Layering rules — the calls that matter

These are the architectural decisions to commit to *now*, because reversing them later is expensive:

**(L1) Tiers compose by override, not by replacement.**
Effective render config = world defaults overlaid with active biome's overrides, all of it overlaid with profile-level perf caps. Every leaf field lives in exactly one tier *by default*; biomes get an explicit `atmosphereOverrides` opt-in to touch world fields. This avoids the worst failure mode — "where is this value actually coming from?" — by making override sources explicit in the YAML.

**(L2) Schema is versioned from day one.**
Every YAML file has `schemaVersion: 1` at the top. Loader rejects unknown versions and unknown fields (strict by default — typo'd field names fail loudly, never silently). Same lesson as slice 112 wire protocol: breaking changes get a new version, never redefine the old one. Migration helpers can convert v1 → v2 when we get there.

**(L3) Biome packs are self-contained directories, not flat files.**
A biome is `biomes/<name>/biome.yaml` + that directory's `textures/`, `audio/`, `props/` subdirs. The YAML uses paths relative to its own directory. This means moving or sharing a biome pack is a single `cp -r`, and the eventual "drop a third-party biome pack into the worldpacks dir" UX works trivially. Discovery is by directory scan, not by central registry.

**(L4) The minimum-viable biome is honest.**
Slice 114 ships with a biome that has *only a surface texture* — no cliff texture, no color modifier, no anything else. Every other field is optional with sensible defaults pulled from the world tier or hard-coded fallbacks. This proves the layering works at the simplest possible end of the spectrum, and gives a template for community biome authors later.

**(L5) Profiles reference biomes by name, not by path.**
A profile says `world: alien-vegetation`, not `world: ../biomes/alien-vegetation/biome.yaml`. The discovery directory resolves names to paths. Same convention as Minecraft datapacks. This lets profiles survive biome-directory reorganization, and lets "pick a biome" eventually become a UI dropdown that lists discovered biomes.

**(L6) The viewer loads exactly one world config + one biome at a time, for now.**
Multi-biome rendering (regions, edge blending, server-driven biome maps) is a *much* later slice — probably slices 120+. Until then, the viewer treats "current biome" as a single config object. The schema supports the future ("biomes/" directory holds many) but the runtime selects one. This dodges the hardest architectural problem (how does the client know which biome a cell belongs to?) until the server side is ready.

## Schema sketches (illustrative — not final)

To make the layering concrete, here's roughly what the three file shapes look like at the start of slice 113/114. **These are sketches to argue about, not commitments.**

### Profile (`config/profiles/default.yaml`)

```yaml
schemaVersion: 1
profile: default
description: Balanced defaults for development.

camera:
  fov: 50
  defaultPitch: 24
  defaultYaw: 0
  pitchMin: 15
  pitchMax: 85
  zoomMin: 0.1
  zoomMax: 10
  dollyMinRatio: 0.05
  dollyMaxRatio: 3.0
  dollyDefaultRatio: 0.72
  modeTransitionSeconds: 0.5

network:
  serverUrl: ws://localhost:8765

performance:
  maxEntityCount: 200000
  terrainMaxCells: 4000000

debug:
  allowOutOfBoundsView: false

# Profile selects which world+biome to load.
world: default
defaultBiome: alien-vegetation
```

### World (`config/worlds/default.yaml`)

```yaml
schemaVersion: 1
world: default
description: Default migratory world atmosphere.

sky:
  hemisphereSkyColor: 0x1a1a4e
  hemisphereGroundColor: 0x0a1a0a
  hemisphereIntensity: 1.1
  backgroundColor: 0x0a0a0a

sun:
  color: 0xfff5d0
  intensity: 7.85   # was Math.PI * 2.5 — resolved at load time
  position: [-400, 600, 600]

# Future: fog, time-of-day, ambient audio.
```

### Biome (`biomes/alien-vegetation/biome.yaml`)

```yaml
schemaVersion: 1
biome: alien-vegetation
description: Alien green vegetation matching the concept art.

# Required: at least one texture path.
surface:
  diffuse: textures/surface-diffuse.jpg
  # Optional: normal, roughness, AO maps.
  normal: textures/surface-normal.jpg
  roughness: 0.92
  metalness: 0.0
  textureScale: 5.0
  # Optional: color modifier (multiplied over the texture).
  colorModifier: 0xffffff   # default = no modification

# Optional: separate cliff appearance. Inherits from surface if omitted.
cliff:
  diffuse: textures/cliff-diffuse.jpg
  normal: textures/cliff-normal.jpg
  roughness: 0.75
  metalness: 0.05
  textureScale: 1.0
  color: 0x231810

# Optional: how slope classifies cliff vs. surface.
slopeBlend:
  low: 0.65
  high: 0.90

# Optional: atmosphere overrides (touches world tier).
# atmosphereOverrides:
#   sky:
#     backgroundColor: 0x1a0a0a   # tinted toward red

# Reserved for future slices — must be empty or omitted in slice 114.
props: []
audio: {}
particles: {}
```

## Slice plan (proposed, for argument)

**Slice 113 — Config externalization plumbing.** Pure infrastructure. Reads `config/profiles/<name>.yaml`, validates against schema, hydrates into the existing `ViewerConfig` shape so downstream code is untouched. Profile selection via `VITE_PROFILE` env var (default: `default`). Three checked-in profiles: `default`, `lowend`, `cinematic`. Schema-version check + strict unknown-field rejection. **No biome work yet** — slice 113 just moves existing config out of [src/config.ts](src/config.ts) into YAML. **Effort: 2/5.** Risk: low — touching every consumer of `config` but in a mechanical way.

**Slice 114 — Minimum-viable biome packs.** Introduces the `biomes/<name>/` directory convention. Profile says `defaultBiome: <name>`; loader discovers and validates the biome pack; biome appearance is loaded into the existing `BiomeConfig` interface from slice 110. Migrates the current `DEFAULT_BIOME` into `biomes/alien-vegetation/`. Adds one second biome (`biomes/desert-rock/` or similar) to prove the swap-at-startup works and force the schema to actually be biome-agnostic. Reserves `props: []`, `audio: {}`, `particles: {}` slots in the schema for future slices but rejects non-empty values for now. **Effort: 3/5.**

**Slice 115 — World atmosphere + biome overrides.** Extracts world-tier config (sky, sun, eventually fog) into `config/worlds/<name>.yaml`. Implements the `atmosphereOverrides` mechanism in the renderer — biomes can override sky/fog locally. Currently this is only relevant when *which biome the camera is in* is known; for slice 115 it's a single-biome world, so overrides apply globally if the biome opts in. **Effort: 2/5.**

**Slice ~120+ (deferred) — Per-cell biome data + edge blending.** Server protocol extension to declare biome IDs per terrain cell. Renderer blends biome materials at edges (similar to slope-blend but biome-coordinate-based). Far out; not relevant to the 113-115 design except that slice 114's schema must not preclude it.

**Slice ~125+ (deferred) — 3D props.** Biome packs gain a populated `props:` section. Asset-loader slice. Schema slot is reserved by slice 114 so this becomes additive, not breaking.

## Open questions for the PM

1. **Profile vs. world separation strength.** I've drawn the line so profiles select a world (`world: default` field at the bottom of `profiles/default.yaml`). Does that feel right, or would you rather profiles and worlds be wholly orthogonal — e.g., env var picks a world, separate env var picks a profile? The "profile picks a world" design is simpler; the orthogonal design lets you A/B-test the same world under different camera setups without forking the world config. I lean toward profile-picks-world for slice 113, with the orthogonal design as an easy refactor later if the limitation bites.

2. **Color encoding in YAML.** YAML doesn't have a hex-color type. Three options: (a) hex strings (`"0x1a3d1a"`) parsed to numbers at load; (b) integers in YAML's hex syntax (`0x1a3d1a` — works in some YAML libs, not others); (c) RGB arrays (`[26, 61, 26]`). The schema sketches above use option (b) as the most concise but it's the least portable. I'd recommend option (a): explicit and parses identically across every YAML lib. Want me to commit to that in slice 113?

3. **Strict-mode validation depth.** The slice 113 plan rejects unknown top-level fields and unknown fields one level deep. Does the schema validator need to also enforce *types* (e.g., reject `fov: "wide"` when number expected) or just structure? Type checking adds 30-50 lines and a small test fixture. I lean toward yes — same loud-failure principle as slice 112's protocol errors. Cheap to add now; expensive to retrofit when bad profiles ship.

4. **Default-biome resolution when profile and world disagree.** A profile says `defaultBiome: alien-vegetation`. The world it points to also has a notion of "the biome you're in if no per-cell data is available." Which wins? My gut: profile is purely for camera/perf, *not* for picking biomes — the world declares its default biome, the profile just declares which world. Want me to remove `defaultBiome` from the profile sketch and put it on the world instead?

5. **Where does `slabDepth` live?** It's terrain-shape, not biome-appearance, but it's also not camera or sim. World tier? Or a fourth "terrain rendering" tier? I lean toward world — it's a constant for the whole world's geological style. But it could go on biome if different biomes should have different slab depths visible at world edges. Open call.

## Recommended path forward

1. PM reviews this exploration; we resolve the five open questions above.
2. I draft slice 113 design (`/cf:build` for slice 113 once the question answers are committed). Slice 114 follows.
3. We do **not** start implementation until both 113 and 114 designs are reviewed — the schema is the contract and getting it right is worth two design passes.
