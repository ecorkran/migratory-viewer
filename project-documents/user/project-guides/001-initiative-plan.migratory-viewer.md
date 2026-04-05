---
docType: initiative-plan
layer: project
project: migratory-viewer
source: user/project-guides/000-concept.migratory-viewer.md
dateCreated: 20260405
dateUpdated: 20260405
status: in_progress
---

# Initiative Plan: migratory-viewer

## Source
000-concept.migratory-viewer.md

## Index Convention
20-based (100, 120, 140). The viewer is a focused application — each initiative represents a coherent capability area with an expected 4–8 slices. A gap of 20 provides comfortable room for expansion without over-allocating index space.

## Initiatives

1. [ ] **(100) Viewer Foundation** — Core rendering pipeline: project scaffold, WebSocket consumer with binary protocol deserialization, entity rendering via Three.js instanced meshes, terrain and environment overlay rendering, camera system (orthographic + perspective), and HUD. Delivers a working viewer that connects to the world server, renders entities and terrain in real time, and provides basic navigation and status display. This is the complete v1 viewer. Dependencies: None (foundation). External: migratory slices 305, 306 (both complete). Status: in_progress

## Cross-Initiative Dependencies
None — single initiative. Future initiatives will depend on 100.

## Future Initiatives

These are anticipated capability areas identified in the concept document's future work and the viewer slice plan's future work section. They are not yet initiatives with architecture documents — they are recorded here so that when the time comes, the decomposition point is already identified.

- **(120) Replay and Analysis** — Load simulation log files (migratory 307, complete) and replay in the viewer with playback controls. Timeline scrubbing, step-through, speed control. The viewer becomes a debugging and post-hoc analysis tool in addition to a live client. Depends on: 100 (deserialization and rendering infrastructure). External: migratory 307.
- **(140) Interactive Controls** — Client-to-server commands: spawn/remove entities, adjust simulation parameters, pause/resume, change time scale. Entity and group inspection (click to see profile, forces, neighbors). Requires the world server's "Administrative Client Commands" future work. Depends on: 100.
- **(160) Advanced Rendering** — Multi-resolution entity rendering (aggregate cluster indicators), day/night and seasonal visual effects (lighting, fog, terrain color modulation), weather visualization. Depends on: 100. External: migratory 308 (temporal orchestration), multi-resolution simulation.
- **(180) Recording and Export** — Video capture (MediaRecorder API on canvas), high-resolution screenshot export, configurable recording presets for content creation. Depends on: 100.

## Notes
- The current slice plan (`100-slices.viewer-foundation.md`) is complete and covers the full scope of initiative 100.
- Future initiatives are listed to establish index reservations and dependency awareness. They are promoted to real initiatives (with architecture documents and slice plans) when their dependencies are met and the PM decides to pursue them.
- This project has significant external dependencies on migratory's server-side development. The initiative plan reflects what the viewer *can* do given the current state of the server, not what it *will* do once all server features are complete.
