---
docType: initiative-plan
layer: project
project: migratory-viewer
source: user/project-guides/000-concept.migratory-viewer.md
dateCreated: 20260405
dateUpdated: 20260425
status: in_progress
---

# Initiative Plan: migratory-viewer

## Source
000-concept.migratory-viewer.md

## Index Convention
20-based (100, 120, 140). The viewer is a focused application — each initiative represents a coherent capability area with an expected 4–8 slices. A gap of 20 provides comfortable room for expansion without over-allocating index space.

## Initiatives

1. [ ] **(100) Viewer Foundation** — Core rendering pipeline: project scaffold, WebSocket consumer with binary protocol deserialization, entity rendering via Three.js instanced meshes, terrain and environment overlay rendering, camera system (orthographic + perspective), and HUD. Delivers a working viewer that connects to the world server, renders entities and terrain in real time, and provides basic navigation and status display. This is the complete v1 viewer. Dependencies: None (foundation). External: migratory slices 305, 306 (both complete). Status: in_progress
2. [ ] **(120) World Authoring & Biome System** — Externalize visual configuration from source code into versioned YAML files organized into three composable tiers: **profile** (viewer-personal — camera tuning, perf caps, server endpoint), **world** (atmospheric — sky, sun, fog, default biome, terrain shape constants like slab depth), and **biome** (per-region physical appearance — textures, colors, slope-blend thresholds, eventually 3D props and audio). Tiers compose by *override*, not replacement: world declares atmosphere, biomes optionally override pieces of it via an explicit `atmosphereOverrides` block, profiles never touch atmosphere. Biome packs are self-contained directories (`biomes/<name>/biome.yaml` + assets), discovered by directory scan, referenced by name (Minecraft-datapack style). Schema is versioned (`schemaVersion: 1`) from day one with strict unknown-field rejection and runtime type validation — same loud-failure principle as slice 112's wire protocol; breaking changes get a new version, never redefine the old one. Minimum-viable biome ships with only a surface texture (everything else optional with defaults), proving the schema scales from trivial to elaborate. Initial slice plan: (113) config externalization plumbing — moves [src/config.ts](../../src/config.ts) into `config/profiles/*.yaml` with no biome semantics, three checked-in profiles (default/lowend/cinematic), `experiments/` subdir gitignored; (114) minimum-viable biome packs — `biomes/<name>/` directory convention, schema reserves `props: []` / `audio: {}` / `particles: {}` slots for future expansion but rejects non-empty values; (115) world atmosphere + biome overrides — extracts sky/sun/fog into `config/worlds/*.yaml`, implements the `atmosphereOverrides` mechanism. Anticipates much later expansion to per-cell biome data and edge blending (server protocol extension, far-future) and 3D prop assets (asset pipeline, far-future) — slice 114's reserved schema slots make those additions non-breaking. Dependencies: 100 (consumes the existing rendering pipeline; `BiomeConfig` from slice 110 becomes the data shape biome packs hydrate). External: none for the early slices; per-cell biomes will require a future migratory protocol extension. Risk: low — schema-first design, mechanical refactors, no rendering changes in 113-115.

## Cross-Initiative Dependencies
- (120) depends on (100). All current 120-series slices consume rendering and config infrastructure established in 100; no protocol changes are required for slices 113-115.
- Future initiatives (140, 160, 180, 200) depend on (100); independent of (120) unless they introduce new visual parameters, in which case those parameters extend the 120 schema rather than re-introducing source-level constants.

## Future Initiatives

These are anticipated capability areas identified in the concept document's future work and the viewer slice plan's future work section. They are not yet initiatives with architecture documents — they are recorded here so that when the time comes, the decomposition point is already identified.

- **(140) Replay and Analysis** — Load simulation log files (migratory 307, complete) and replay in the viewer with playback controls. Timeline scrubbing, step-through, speed control. The viewer becomes a debugging and post-hoc analysis tool in addition to a live client. Depends on: 100 (deserialization and rendering infrastructure). External: migratory 307.
- **(160) Interactive Controls** — Client-to-server commands: spawn/remove entities, adjust simulation parameters, pause/resume, change time scale. Entity and group inspection (click to see profile, forces, neighbors). Requires the world server's "Administrative Client Commands" future work. Depends on: 100.
- **(180) Advanced Rendering** — Multi-resolution entity rendering (aggregate cluster indicators), day/night and seasonal visual effects (lighting, fog, terrain color modulation), weather visualization. Depends on: 100, 120 (visual parameters extend the 120-series schema rather than introducing source-level constants). External: migratory 308 (temporal orchestration), multi-resolution simulation.
- **(200) Recording and Export** — Video capture (MediaRecorder API on canvas), high-resolution screenshot export, configurable recording presets for content creation. Depends on: 100.

## Notes
- The current slice plan (`100-slices.viewer-foundation.md`) is complete and covers the full scope of initiative 100.
- Future initiatives are listed to establish index reservations and dependency awareness. They are promoted to real initiatives (with architecture documents and slice plans) when their dependencies are met and the PM decides to pursue them.
- This project has significant external dependencies on migratory's server-side development. The initiative plan reflects what the viewer *can* do given the current state of the server, not what it *will* do once all server features are complete.
