---
docType: changelog
scope: project-wide
---

# Changelog
All notable changes to migratory-viewer will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.0.7] - 20260508

### Performance (slice 115 — Wire Header Alignment + Zero-Copy Deserialization)
- The viewer now reads STATE_UPDATE positions and velocities directly out of
  the WebSocket message buffer instead of copying them. At 100k entities
  the per-tick parse step no longer allocates ~1.6 MB of throwaway buffers,
  removing the dominant source of GC pressure in the receive path.
- This required a coordinated server-side change: the producer pads its
  STATE_UPDATE header to 16 bytes and its SNAPSHOT header to 32 bytes so
  position arrays start at offsets the browser can construct typed-array
  views over. Without that alignment the optimization is impossible.
- This unblocks the third optimization that was attempted and reverted in
  slice 113 — the original 10-byte STATE_UPDATE header was not 4- or 8-byte
  aligned, so `Float32Array` / `Float64Array` views over the wire buffer
  threw `RangeError` and the work had to be deferred until the wire format
  could be changed.

### Compatibility
- The viewer now requires a server emitting wire schema version 2 (producer
  shipped on commit `9e7526d`). There is no compatibility window: an older
  viewer connected to a v2 server (or vice versa) will see a stalled HUD
  with `[protocol] schema_version` warnings in the browser console. Update
  both sides together.

## [0.0.6] - 20260507

### Performance (slice 113 — Entity Pipeline Performance)
- Entity terrain heights are now cached on `ViewerState.entityHeights` and
  refreshed when the server sends new positions or terrain. Previously the
  viewer re-ran a bilinear terrain interpolation for every entity on every
  rendered frame — at 100k entities and 60 fps that was 6M interpolations/sec
  of redundant work. The render path now reads from a flat array.
- The render loop skips re-applying entity matrices on frames where no new
  server tick has arrived. The camera and scene continue to render every
  frame for smooth motion; only the per-entity matrix loop is gated. At a
  60 fps display with a 60 tps server, the matrix loop runs once per tick
  instead of once per frame.

### Notes
- A third planned optimization (zero-copy `parseStateUpdate`) was attempted
  and reverted. The STATE_UPDATE wire header is 10 bytes, which is not
  aligned to 4 bytes (Float32Array) or 8 bytes (Float64Array), so direct
  typed-array views into the WebSocket buffer throw `RangeError`. Eliminating
  the per-tick allocation requires a coordinated wire-format change and is
  deferred.

## [0.0.5] - 20260506

### Added
- The viewer now reads the entity position dtype flag the server sends on every message, and correctly handles both f32 and f64 entity data. Previously the viewer assumed f64 and would silently misinterpret f32 frames as garbage coordinates.
- When the server switches dtype mid-connection (e.g. during a rolling server update), the viewer adapts automatically rather than crashing.

### Fixed
- Entity positions were broken when the server was configured to send f32 entity data (`agent_wire_dtype = "f32"`). The wire format change had already been deployed server-side; this brings the viewer in sync.

### Performance
- f32 entity data is now supported end-to-end. At 10k entities, STATE_UPDATE frames drop from ~312 KB to ~156 KB when the server uses f32 — roughly half the WebSocket throughput per tick.

## [0.0.4] - 20260424

### Added (slice 112 — Terrain Wire Protocol v2)
- Per-connection terrain assembler at [src/protocol/terrain-assembler.ts](src/protocol/terrain-assembler.ts) implementing the v2 wire-protocol state machine: `IDLE` ↔ `EXPECTING_CHUNKS`, with strict ordering enforcement (SNAPSHOT first, all terrain before STATE_UPDATE).
- v2 single-shot `TERRAIN` (`0x03`) and chunked `TERRAIN_HEADER` (`0x05`) + `TERRAIN_CHUNK` (`0x04`) decode paths supporting all nine dtype × compression combinations (`f32` / `f64` / `uint16` × `none` / `zstd` / `lz4`). For `uint16` payloads, dequantization is `min + (u16 / 65535) * (max - min)` with a constant-terrain (`min == max`) special case to avoid NaN.
- Decompression dispatcher at [src/protocol/decompress.ts](src/protocol/decompress.ts) wrapping `fzstd` (zstd RFC 8478 frames) and `lz4js` (LZ4 Frame format). `none` returns the input unchanged; decoder failures are wrapped in a `TypeError` prefixed `terrain decompress: <algorithm> failed: …`.
- `TERRAIN_CHUNK = 0x04` and `TERRAIN_HEADER = 0x05` opcodes added to `MessageType`; new `TerrainDtype` and `TerrainCompression` const-as-object tables.
- Tier-2 protocol-error policy for terrain opcodes — reserved-bit set, unknown dtype/compression, out-of-state chunk, missing/duplicate/overlapping chunks, decoder failure, and length mismatches all close the WebSocket with code 1002 rather than the slice-101 log-and-skip pattern. SNAPSHOT and STATE_UPDATE retain their tier-1 (log + drop) behavior.
- Per-terrain-transfer INFO log line: `[net] TERRAIN rows=R cols=C resolution=X dtype=DT compression=COMP chunks=N bytes_compressed=BC bytes_decompressed=BD`.
- 50 new unit tests across `types.test.ts`, `decompress.test.ts`, `terrain-assembler.test.ts`, `terrain-assembler-chunked.test.ts`, and additions to `connection.test.ts`. Includes the spec's exact 2×2 worked example (single-shot) and 4×2 worked example (chunked) as ground-truth byte sequences.

### Changed (slice 112)
- [src/net/connection.ts](src/net/connection.ts) `handleMessage` now routes through a per-`connect()` assembler instance: `assembler.feed(buffer)` returns a discriminated union (`message` | `pending` | `protocol-error`); on `protocol-error` the WebSocket closes with code 1002 and the existing reconnect-with-backoff path runs. Per-connection assembler creation guarantees no chunked-state leak across reconnects.
- [src/protocol/deserialize.ts](src/protocol/deserialize.ts) `parseMessage` no longer dispatches on `TERRAIN` (`0x03`); terrain decode is now exclusively assembler-routed. The slice 102 v1 single-shot terrain parser and its test suite have been removed (replaced by v2 tests with full byte-layout coverage).

### Dependencies (slice 112)
- Added `fzstd@0.1.1` (~10 KB pure-JS zstd decoder).
- Added `lz4js@0.2.0` (~30 KB pure-JS LZ4 Frame decoder). Server-side LZ4 frames must be emitted with `content_size=False` and `content_checksum=False` (descriptor `0x60` family) — `lz4js` v0.2.0 has a bit-shift bug in its content-size handling. Constraint documented in [project-documents/reference/terrain-wire-protocol-v2.md](project-documents/reference/terrain-wire-protocol-v2.md).
- Bundle delta vs slice 111 (tag `v0.0.3`): +19 KB raw / +7.5 KB gzipped. Within TD-4's 20 KB-gzipped target.

## [0.7.0] - 20260424
### Added
- Geological slab beneath the terrain — four side walls tracking the terrain edge elevation profile plus a bottom face, unified with the top surface as a single closed indexed `BufferGeometry` in `terrain.ts`. Walls render as pure cliff appearance via the existing slope-blend (`normalWorld.y ≈ 0` resolves below `slopeBlendLow`).
- `slabDepth` field in `ViewerConfig` — depth of the slab below the lowest terrain point in world units (default `100`).
- Triplanar diffuse texture sampling on terrain top and walls via TSL `triplanarTexture(texture(map), null, null, scaleNode)`. World-space projection eliminates UV seams on slopes; no per-frame CPU cost.
- Tangent-space normal maps blended with the same slope factor and wrapped once with `normalMap()` (avoids `NormalMapNode` / `vec3` typing mismatch in `mix()`).
- `BiomeConfig` extended with optional `surfaceTexturePath`, `cliffTexturePath`, `surfaceNormalPath`, `cliffNormalPath` plus required `textureScale` and `cliffTextureScale` (independent tiling density for vegetation vs. rock).
- `TerrainMaterialHandle.updateBiome()` now detects texture-path changes and rebuilds the material (disposing the old one); uniform-only updates preserve the material reference. Single-method contract preserved per the slice design.
- 2K CC0 PBR textures shipped under `public/textures/biomes/default/` (surface + cliff diffuse and normal maps).

### Changed
- `applyTerrainToMesh` and `applyFlatPlane` now build a closed unified mesh (top + 4 walls + bottom) instead of just a top-surface plane. Vertex layout preserves the slice 110 invariant: first `rows*cols` vertices are the top surface in row-major order.
- `applyFlatPlane` no longer renders a literal flat plane — it builds a flat-topped slab with the same wall/bottom geometry as the TERRAIN path, for a consistent silhouette before terrain data arrives.

### Removed
- `src/rendering/slab.ts` and `src/rendering/slab.test.ts` (initial design proposed a separate slab module; mid-implementation revision unified everything into `terrain.ts` for guaranteed gap-free seams between top and walls).

## [0.6.0] - 20260422
### Added
- `BiomeConfig` interface in `config.ts` — PBR biome appearance parameters (surface/cliff colors, roughness, metalness, slope blend thresholds)
- `DEFAULT_BIOME` constant: alien vegetation preset matching the concept art reference
- `TerrainMaterialHandle` interface and `createTerrainMaterial(biome)` in `terrain.ts` — TSL slope-blend node graph on `MeshStandardNodeMaterial`; runtime biome switching via `updateBiome()` with no shader recompile
- `getTerrainMaterialHandle()` export for developer console access to `updateBiome`
- `renderer.debug.checkShaderErrors = true` in dev mode via `import.meta.env.DEV` guard

### Changed
- Terrain mesh material upgraded from `MeshLambertMaterial` to `MeshStandardNodeMaterial` with TSL slope-blend shader
- Lighting upgraded to alien-world aesthetic: deep blue-purple hemisphere sky (`0x1a1a4e`), near-black green ground bounce (`0x0a1a0a`), warm amber key light (`0xfff5d0`, `Math.PI * 1.5` intensity) from upper-left angle
- `groundColor` removed from `ViewerConfig`; surface color is now `biomeConfig.surfaceColor`

## [0.5.0] - 20260418
### Added
- Terrain rendering from TERRAIN (0x03) wire message (migratory slice 507): displaced `PlaneGeometry` with bilinear-interpolated elevation grid
- `getTerrainHeight(grid, x, z)` — bilinear interpolation with edge clamping; used for entity y-placement
- Entity cones now rest on terrain surface via `getTerrainHeight`; configurable vertical offset via `entityVerticalOffsetRatio`
- `terrainMaxCells` config cap (default 4 M cells) mirrors server's 32 MiB reasoning
- Flat-plane fallback (`applyFlatPlane`) preserves pre-slice-102 behavior when server omits TERRAIN
- `TerrainGrid` state field + `terrainRevision` counter drive incremental mesh rebuilds in render loop

## [0.4.1] - 20260410
### Added
- TPS (ticks per second) counter in HUD — measures actual server tick rate received over a 1-second rolling window, distinguishing simulation update rate from render FPS

## [0.4.0] - 20260410
### Added
- HUD overlay panel (`src/ui/hud.ts`, `src/ui/hud.css`) displaying connection status, tick counter, entity count, FPS, and profile legend with color swatches
- Connection status indicator with colored dot (green/yellow/red) and pulsing animation for reconnecting state
- FPS counter with exponential moving average smoothing
- Profile legend with per-profile entity counts and color swatches from `config.profileColors`
- `H` key toggles HUD visibility; click-through (`pointer-events: none`) preserves canvas interaction
- HUD updates before the render early-return, showing connection status while awaiting first snapshot

## [0.3.0] - 20260409
### Added
- World-bounds clamping: pan edges cannot cross world bounds, zoom-out capped at world-fit (zoom=1, full world height visible)
- `panStart`, `panMove`, `panEnd`, `zoomBy` action API exported from `camera.ts`
- `clampCameraToWorld` internal helper enforces position constraints after every camera mutation
- `config.allowOutOfBoundsView` debug flag disables zoom and pan clamps
- `src/input/camera-input.ts` module owns all DOM event binding for the camera

### Changed
- Pan input changed from middle/right-click to left-click drag
- `camera.ts` is now DOM-free — contains no `addEventListener` calls
- `handleResize` re-evaluates zoom-fit and clamps camera position after window resize

## [0.2.0] - 20260406
### Added
- Binary wire protocol deserializer for SNAPSHOT (0x01) and STATE_UPDATE (0x02) messages with little-endian discipline and parse-boundary validation (`src/protocol/`)
- `ViewerState` singleton with `applySnapshot` / `applyStateUpdate` mutation helpers — connection manager is the sole writer (`src/state.ts`)
- WebSocket connection manager with state machine (DISCONNECTED → CONNECTING → CONNECTED → RECONNECTING), exponential backoff with jitter (500ms → 30s cap), and forced reconnect on entity-count mismatch (`src/net/connection.ts`)
- Live entity rendering: `entities.ts` now consumes `ViewerState`, allocates `InstancedMesh` at `config.maxEntityCount` capacity, and refreshes profile colors only on snapshot
- `config.maxEntityCount` (default 200,000) — hard cap enforced by the parser
- vitest test runner with 29 unit tests covering deserialize, state mutations, connection lifecycle, and entity update logic

### Changed
- `entities.ts` no longer generates random test data; entity rendering is driven entirely by server snapshots
- `main.ts` wires `createConnection(viewerState)` and calls `updateEntities(mesh, viewerState)` per frame

## [0.1.0] - 20260406
### Added
- Vite + TypeScript project scaffold with pnpm
- Three.js WebGPURenderer with automatic WebGL 2 fallback (via `three/webgpu`)
- Orthographic top-down camera with mouse wheel zoom and right-click drag pan
- Flat ground plane terrain sized to world bounds (1000x1000)
- InstancedMesh rendering of 500 test entities (cones) with profile-based coloring
- Physically correct lighting (HemisphereLight + DirectionalLight)
- Render loop via `renderer.setAnimationLoop()` with `THREE.Timer`
- GPU device loss handling for both WebGPU and WebGL 2 fallback paths
- Centralized configuration module (`config.ts`) with typed defaults
- Console logging of active renderer backend (WebGPU vs WebGL 2)
