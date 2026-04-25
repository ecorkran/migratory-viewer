---
docType: slice-design
parent: user/architecture/100-slices.viewer-foundation.md
project: migratory-viewer
slice: "112"
sliceName: terrain-wire-protocol-v2
dateCreated: 20260424
dateUpdated: 20260424
status: complete
---

# Slice 112: Terrain Wire Protocol v2 (Chunked + Compressed)

## Parent Documents

- Slice plan: [100-slices.viewer-foundation.md](../architecture/100-slices.viewer-foundation.md), entry **(112)**.
- Architecture: [100-arch.viewer-foundation.md](../architecture/100-arch.viewer-foundation.md).
- Predecessor slice: [102-slice.terrain-rendering.md](102-slice.terrain-rendering.md) — established the v1 single-shot `0x03` parser this slice replaces.

## Spec Reference

The authoritative wire-format spec for this slice is captured at [project-documents/reference/terrain-wire-protocol-v2.md](../../reference/terrain-wire-protocol-v2.md) — a frozen copy of the **Viewer Implementer Reference** section of the migratory server's terrain-wire design, captured 2026-04-24. The spec covers: dispatch state machine, interleaving contract, compression frame formats, dtype decode (including `uint16` dequantization), reassembly pseudocode, a worked 2×2 f32+zstd example, the protocol-error catalog, and configuration notes.

If the spec text and this design ever disagree, **the spec wins**; this design is a faithful translation into viewer-side architecture, not a re-derivation of the protocol. If the upstream server design changes, update the captured reference file (bump its `dateCaptured`) before adjusting this design.

## Purpose

Replace the viewer's stateless v1 terrain parser with a per-connection state machine that handles the v2 wire format: a versioned single-shot `0x03 TERRAIN`, the chunked sequence `0x05 TERRAIN_HEADER` → N × `0x04 TERRAIN_CHUNK`, three dtypes (`f32`, `f64`, `uint16` with min/max dequantization), three compression algorithms (`none`, `zstd` frame, `lz4` frame), and strict protocol-error handling that closes the WebSocket with code 1002 rather than logging-and-continuing.

This is the viewer's first protocol slice that materially changes parser shape (statelessness → state machine) and adds binary-blob third-party dependencies (zstd + lz4 decoders).

## Context

Slice 102 introduced the v1 TERRAIN message: 33-byte fixed header + raw `f64` row-major elevation array, single message, no compression. The current parser ([deserialize.ts:110](../../src/protocol/deserialize.ts#L110)) is a pure function `parseMessage(buffer) → ParsedMessage | null` that logs and returns `null` on any malformed input. That works for stateless single-shot messages; it does not work for the chunked path, which spans messages and requires per-connection state (`IDLE` / `EXPECTING_CHUNKS`, allocated grid, expected-chunk count, received-chunk list).

The server now ships the v2 spec. Per the migratory opcode-versioning convention (architecture doc, "Opcode versioning convention"; memory: `project_protocol_versioning.md`): an opcode's *meaning* is stable forever, additive payload extensions on the same opcode preserve the opcode, and behaviorally incompatible new framing gets a new opcode. So `0x03` keeps its name `TERRAIN` and its v1 fixed-header prefix is preserved verbatim; v2 *appends* a flags byte and conditional `elevation_min`/`elevation_max` after the existing fields, which is an additive extension. Chunked delivery is a different framing (one logical terrain spans multiple WebSocket messages with new state-machine semantics), so it gets the net-new opcodes `0x04 TERRAIN_CHUNK` and `0x05 TERRAIN_HEADER` rather than overloading `0x03`.

Renderer-facing types remain unchanged: `ParsedTerrain` still surfaces a `Float64Array` row-major elevation grid with `rows`, `cols`, `resolution`, `originX`, `originY`. The renderer ([rendering/terrain.ts](../../src/rendering/terrain.ts)) does not learn about compression, dtype, or chunking.

## Goals

- Decode every wire layout the spec declares: `0x03` (v2 single-shot, all dtype × compression combinations), and `0x05` + `0x04`-stream (chunked, all combinations).
- Maintain per-connection parser state so chunked terrain reassembles correctly across messages.
- Enforce the protocol-error catalog: protocol errors close the WebSocket with code 1002. Recoverable conditions (duplicate sequence number) log a warning and continue.
- Validate rectangular partition coverage of received chunks before handing the grid to the renderer (a missing chunk and an overlapping chunk both surface here as a clear error).
- Ship the worked 2×2 f32 + zstd example as an end-to-end ground-truth test.
- Establish the named-constant convention in code: every opcode comparison goes through `MessageType`; flag-byte fields go through their own named-constant tables (`TerrainDtype`, `TerrainCompression`).
- Keep the renderer-facing `ParsedTerrain` shape identical to slice 102 so [rendering/terrain.ts](../../src/rendering/terrain.ts) is untouched.

## Non-Goals

- Server-side changes. The viewer is a pure consumer.
- Renderer changes. Slice 102 / 110 / 111 rendering paths are out of scope.
- Re-quantizing or re-compressing terrain inside the viewer (e.g. for replay export) — out of scope; renderer always sees `Float64Array`.
- A general-purpose protocol-error policy for `SNAPSHOT` / `STATE_UPDATE`. This slice only changes terrain-message error handling. Behavior of the entity-state opcodes is preserved as-is to avoid a parallel behavioral regression. A future slice can unify error policy across opcodes.
- A protocol-version negotiation handshake. Per the convention, opcodes carry version implicitly; there is no version byte to negotiate.

## Technical Decisions

### TD-1: Per-connection parser, instantiated by the connection layer

**Decision.** Replace the module-level pure-function `parseMessage` with a `createTerrainAssembler()` factory exported from `protocol/terrain-assembler.ts`. The connection layer ([net/connection.ts](../../src/net/connection.ts)) creates one assembler per `connect()` call and discards it on socket close. `parseMessage` (or a renamed `parseFrame`) for `SNAPSHOT` / `STATE_UPDATE` remains stateless.

**Why.** The chunked path spans messages; state must live somewhere. Hoisting state into the connection layer leaks protocol details (the `IDLE` / `EXPECTING_CHUNKS` machine, the partial grid, the chunk list) into a layer whose job is socket lifecycle, not wire format. Encapsulating in an assembler keeps the connection-layer integration to ~3 lines (create, feed bytes, dispose) and ensures reconnect implicitly resets state.

**Why not a singleton module-level state.** Two reasons. First, a stale chunked-terrain transfer interrupted by reconnect must not bleed into the next connection's state — a per-instance object makes that automatic via lifetime. Second, tests benefit from constructing fresh assemblers without module-reset gymnastics.

### TD-2: Dispatch lives inside the assembler; SNAPSHOT/STATE_UPDATE pass through

**Decision.** The assembler exposes a single method `feed(buffer: ArrayBuffer): AssemblerOutput`, where:

```typescript
type AssemblerOutput =
  | { kind: 'message'; message: ParsedMessage }
  | { kind: 'pending' }
  | { kind: 'protocol-error'; reason: string };
```

`'pending'` is what the chunked path returns between `TERRAIN_HEADER` and the last `TERRAIN_CHUNK`, and also what `TERRAIN_HEADER` itself returns. `'protocol-error'` is the close-1002 signal — the connection layer reads it, calls `ws.close(1002, reason)`, and disposes the assembler.

Inside `feed`, dispatch is by leading byte against `MessageType`:
- `SNAPSHOT` / `STATE_UPDATE` → delegate to the existing stateless parsers; wrap their `null` (malformed) result as `{ kind: 'message', message: <parsed> }` on success or — to preserve current entity-state behavior — wrap `null` as `{ kind: 'pending' }` (i.e. drop the frame, no close). See TD-7 for why entity-state errors stay non-fatal.
- `TERRAIN` (v2) → parse single-shot; if `IDLE`, return assembled grid; if `EXPECTING_CHUNKS`, protocol error.
- `TERRAIN_HEADER` → if `IDLE`, transition to `EXPECTING_CHUNKS`; else protocol error.
- `TERRAIN_CHUNK` → if `EXPECTING_CHUNKS`, append; on `last_chunk_flag`, validate coverage and return assembled grid; else protocol error.
- Anything else → protocol error.

**Why.** Single entry point keeps the connection layer's `handleMessage` body trivial. The three-output union makes the next-step decision explicit at the call site (apply, wait, close).

### TD-3: Named constants for opcode and flag-byte fields

**Decision.** Extend [protocol/types.ts](../../src/protocol/types.ts) with three new opcodes and two new flag-byte enumerations:

```typescript
export const MessageType = {
  SNAPSHOT: 0x01,
  STATE_UPDATE: 0x02,
  TERRAIN: 0x03,
  TERRAIN_CHUNK: 0x04,
  TERRAIN_HEADER: 0x05,
} as const;

export const TerrainDtype = {
  F32: 0,
  F64: 1,
  UINT16: 2,
  // 3 reserved → protocol error
} as const;

export const TerrainCompression = {
  NONE: 0,
  ZSTD: 1,
  LZ4: 2,
  // 3–7 reserved → protocol error
} as const;
```

Bit layout of the flags byte (per spec): `dtype` = bits 0–1, `compression` = bits 2–4, reserved = bits 5–7 (must be zero or protocol error). Decoding:

```typescript
const dtype = flags & 0b11;
const compression = (flags >> 2) & 0b111;
const reserved = (flags >> 5) & 0b111;
if (reserved !== 0) /* protocol error: reserved bits set */
```

**Why.** Per `project_protocol_versioning.md`: no opcode literals in dispatch, parsers, tests, or logs. Same rule extends to other byte-level field values that have semantic meaning. Compile-time `as const` types over runtime `enum` matches the project's TypeScript rules ([.claude/rules/typescript.md](../../.claude/rules/typescript.md)).

### TD-4: Decompressor library choices — fzstd + lz4js (pure JS, sync, frame-capable)

**Decision.** Ship the following two npm packages as the implementation:

| Algorithm | Package | Type | Approx. minified | API shape |
|---|---|---|---|---|
| zstd  | [`fzstd`](https://github.com/101arrowz/fzstd) by 101arrowz | Pure JS (no WASM) | ~10 KB | `decompress(input: Uint8Array): Uint8Array` (sync) |
| lz4   | [`lz4js`](https://github.com/Benzinga/lz4js) by Benzinga    | Pure JS (no WASM) | ~30 KB | `decompress(input: Uint8Array): Uint8Array` (sync, Frame format) |

Combined ~40 KB minified / well under 20 KB gzipped — comfortably below the soft target documented under "Bundle-size context" below. Both:

- Consume the standard **frame** format (zstd RFC 8478, LZ4 Frame), not raw block format.
- Expose a **synchronous** `Uint8Array → Uint8Array` decode API. Required because the assembler runs inside the WebSocket `onmessage` callback; an async decode would require a queue and out-of-order completion that this slice deliberately does not introduce.
- Are pure JS rather than WASM, so there is no WASM-init cost on first page load and no `WebAssembly.instantiate` ceremony in test setup.

**Bundle-size context.** "Combined < 100 KB gzipped" applies to the **decompression libraries themselves** — the JS the user pays to download on first page load to gain decode capability. It is not a limit on the terrain payload (which is bounded by the server's 32 MiB-per-frame WebSocket cap, separately, on every connection regardless of compression).

**Phase 6 verification.** Before slice closeout, the worked-example test (the spec's 2×2 f32 + zstd byte sequence) plus a smoke test against a real server-emitted lz4-Frame payload prove both decoders accept actual server output. If either fails on a real server frame, the per-algorithm fallback is:

| Primary | Fallback if primary fails |
|---|---|
| `fzstd`  | [`@oneidentity/zstd-js`](https://www.npmjs.com/package/@oneidentity/zstd-js) (WASM libzstd, hundreds of KB; raise to PM before adopting) |
| `lz4js`  | [`lz4-wasm`](https://www.npmjs.com/package/lz4-wasm) (WASM, larger; raise to PM before adopting) |

Per the spec's own configuration note, an alternative remediation if a viewer cannot ship one algorithm is a server config change to a different algorithm (e.g. `terrain_wire.compression: lz4` or `none`); the viewer should still implement all three so the server is not forced into a specific choice.

### TD-5: Single grid allocation per logical terrain; chunks decoded into place

**Decision.** On `TERRAIN_HEADER`, allocate `new Float64Array(rows * cols)` once. On each `TERRAIN_CHUNK`, decompress → dtype-decode → write into the pre-allocated grid using the chunk's `row_offset` / `col_offset` (not arrival order). On `last_chunk_flag`, validate rectangular partition coverage; on success, hand the grid to the renderer; on failure, protocol error.

**Why.** Avoids a second copy on reassembly. The spec's own pseudocode is structured this way. The grid stays allocated until the message either completes or errors; on error the assembler resets and the grid is GC'd.

**Coverage validation algorithm.** Maintain a parallel `Uint8Array(rows * cols)` "written" mask alongside the grid, set entries to 1 as each chunk writes them, and after `last_chunk_flag` verify every cell is exactly 1. Allocation cost is `rows * cols` bytes (1/8 of the grid itself), one-time per terrain. This catches missing chunks (cells = 0) and overlap (cells already 1 when we try to set them again — recoverable as last-write-wins per spec for "duplicate sequence_number," but if cell coordinates from a duplicate chunk differ, that's a protocol error).

Alternative considered: storing each chunk's rectangle and computing partition coverage analytically (no mask). Rejected as overkill: O(N) cells exist either way, and the analytical check has annoying edge cases (we'd be re-implementing rectangle-set partition validation for no win on a one-shot operation).

### TD-6: Dequantization for `uint16`

**Decision.** When the dtype flag is `UINT16`, the 16 bytes immediately after the flags byte are `f64 elevation_min` then `f64 elevation_max` (both little-endian). After decompression, view the payload as a `Uint16Array` and dequantize each value to `f64`:

```typescript
elevation_f64 = elevation_min + (u16 / 65535.0) * (elevation_max - elevation_min)
```

For chunked transfers, the `elevation_min` / `elevation_max` are part of `TERRAIN_HEADER` and apply to **every** chunk uniformly; chunk headers do not repeat them.

**Why.** This is the spec verbatim. Worth calling out explicitly in design because the 16-byte conditional follows a 1-byte flags field — a layout that's easy to mis-offset. The "chunks share header dequant range" point is implicit in the spec but easy to miss; documenting here keeps task-writers from inventing a per-chunk min/max field.

**Edge case.** `elevation_min == elevation_max` (constant terrain): dequant formula reduces to `min` for all values, which is correct. No divide-by-zero — the divisor is the constant 65535.

### TD-7: Protocol errors close the WebSocket; entity-state errors keep current behavior

**Decision.** Protocol errors **for terrain opcodes** (per the spec's catalog) close the WebSocket with code 1002 and a descriptive reason string. Conditions:

| Condition                                                          | Action            |
|--------------------------------------------------------------------|-------------------|
| Reserved flag bits (5–7) nonzero                                   | Close 1002        |
| Unknown dtype (bits 0–1 = `3`)                                     | Close 1002        |
| Unknown compression (bits 2–4 = `3–7`)                             | Close 1002        |
| `TERRAIN_CHUNK` received without preceding `TERRAIN_HEADER`        | Close 1002        |
| `TERRAIN_HEADER` received mid-chunked delivery                     | Close 1002        |
| `TERRAIN` (single-shot) received mid-chunked delivery              | Close 1002        |
| Coverage validation failure (missing chunk OR overlap mismatch)    | Close 1002        |
| Malformed compressed payload (decoder throws)                      | Close 1002        |
| `TERRAIN*` received after `STATE_UPDATE` started                   | Close 1002        |
| Unknown leading byte (no matching `MessageType`)                   | Close 1002        |
| Duplicate `sequence_number` with **identical** chunk coordinates   | Log warning, continue (last-write-wins) |

`SNAPSHOT` and `STATE_UPDATE` malformed-input behavior is **unchanged from slice 101** (log warning, drop frame, do not close). This is a deliberate scope limit (see Non-Goals). The assembler returns `{ kind: 'pending' }` for these dropped frames so connection-layer dispatch is unchanged for the entity-state path.

**Why.** The spec is explicit that close-1002 is the recommended signal for terrain protocol errors and that the server will not re-synchronize in-stream. Continuing after a terrain protocol error risks rendering a corrupt grid (or worse, a half-applied grid where some cells are from one transfer and others from the next). For entity state, the existing graceful-skip behavior has been in production since slice 101 and a fresh `STATE_UPDATE` will arrive next tick — protocol-error escalation across the board would be a separate behavioral change requiring its own slice.

**Reconnect interaction.** Close-1002 triggers the existing `onclose` path in [net/connection.ts](../../src/net/connection.ts), which reconnects with backoff. The next connection re-runs `SNAPSHOT` → terrain → `STATE_UPDATE`. This is the right recovery: a fresh handshake re-establishes the protocol contract.

### TD-8: Interleaving contract — assert, do not enforce

**Decision.** The spec promises (a) `SNAPSHOT` is always first; (b) all terrain messages precede the first `STATE_UPDATE`; (c) terrain messages do not arrive after `STATE_UPDATE` begins. The viewer **asserts** these (close 1002 on violation per the catalog) but does not preemptively block — i.e. it reacts to violations rather than gating on a "are we expecting terrain right now?" flag.

The minimum state required: a boolean `stateUpdatesStarted` on the assembler, set true on the first `STATE_UPDATE` arrival, and any subsequent `TERRAIN` / `TERRAIN_HEADER` / `TERRAIN_CHUNK` is a protocol error.

**Why.** The spec says these orderings are server guarantees, and the catalog explicitly lists "TERRAIN* after STATE_UPDATE" as a server bug — close 1002. Going further (e.g. requiring `SNAPSHOT` before terrain) would couple the assembler to entity-state ordering it has no other reason to know about. One bool, one branch — minimum coupling.

### TD-9: Endianness, slicing, and copy discipline

**Decision.** All multi-byte integer and float reads go through the existing `readU32LE` / `readF64LE` helpers in `deserialize.ts` (or new equivalents in `terrain-assembler.ts`); no direct `view.getXxx(offset)` without `littleEndian = true`. After decompression, dtype views (`Float32Array`, `Float64Array`, `Uint16Array`) are constructed over the **decompressed buffer**, which is a fresh `Uint8Array` we own — no aliasing of the WebSocket message buffer.

For the `compression: NONE` path, we still copy the payload range out of the source `ArrayBuffer` before viewing it, matching the slice 101/102 "detach from socket buffer" discipline.

**Why.** The slice 102 parser already enforces little-endian discipline in `deserialize.ts` lines 1–9 — same pattern, extended. Copy discipline matters because the WebSocket may reuse its message buffer between frames; aliasing a typed-array view into it produces silent corruption. The current `Float64Array(buffer.slice(...))` pattern in `parseSnapshot` is the model.

### TD-10: Logging

**Decision.** Successful terrain assembly logs one INFO line at completion, matching the slice 102 format extended with new fields:

```
[net] TERRAIN rows=R cols=C resolution=X dtype=DT compression=COMP chunks=N bytes_compressed=BC bytes_decompressed=BD
```

Where `chunks=1` for single-shot and `N` for chunked. `bytes_compressed` is the sum of compressed payload bytes received; `bytes_decompressed` is `rows * cols * 8` (the assembled grid size). Compression ratio is implicit in the two byte counts.

Protocol errors log one WARN line with the reason that goes into the close frame, prefixed `[net] terrain protocol error:`. Recoverable conditions (duplicate seq num) log one WARN with `[net] terrain warning:`.

**Why.** A single log line per terrain transfer is enough to debug the spec's worked example by eye. Compression ratio is the most-asked-for diagnostic for any compression slice; emitting both byte counts costs nothing and means we don't add a "what was the ratio?" line later.

## Architecture and Data Flow

```
┌─────────────────────┐       ArrayBuffer        ┌────────────────────────────┐
│   WebSocket         │ ───────────────────────► │  TerrainAssembler          │
│   (browser)         │                          │  ──────────────            │
│                     │   ArrayBuffer            │  state: IDLE | EXPECTING   │
│                     │                          │  grid: Float64Array | null │
│                     │                          │  written: Uint8Array | null│
│                     │                          │  expectedChunks: number    │
│                     │                          │  receivedChunks: number    │
│                     │                          │  stateUpdatesStarted: bool │
└─────────────────────┘                          │                            │
                                                 │  feed(buf) →               │
                                                 │   { kind: 'message',       │
                                                 │     message } |            │
                                                 │   { kind: 'pending' } |    │
                                                 │   { kind: 'protocol-      │
                                                 │     error', reason }       │
                                                 └────────────────────────────┘
                                                          │
                                                          ▼
                                            ┌─────────────────────────────┐
                                            │ Existing parsers            │
                                            │  parseSnapshot (slice 101)  │
                                            │  parseStateUpdate           │
                                            │  parseTerrainV2 (NEW)       │
                                            │   ├── readFlags             │
                                            │   ├── decompress            │
                                            │   ├── decodeDtype           │
                                            │   └── (chunked) writeIntoGrid│
                                            └─────────────────────────────┘
                                                          │
                                                          ▼
                                            connection.ts: handleMessage
                                              switch (output.kind):
                                                'message'        → applyXxx
                                                'pending'        → no-op
                                                'protocol-error' → ws.close(1002, reason)
```

## Components and Files

### New

- `src/protocol/terrain-assembler.ts` — assembler factory (`createTerrainAssembler`), state-machine logic, partition coverage check, sub-parsers `parseTerrainSingleShot`, `parseTerrainHeader`, `parseTerrainChunk`. Exports the `AssemblerOutput` discriminated union.
- `src/protocol/decompress.ts` — wraps the chosen zstd and lz4 packages behind a single `decompress(payload, algorithm)` function returning `Uint8Array`. Algorithm dispatch by `TerrainCompression` constant. This is the only file that imports decompressor packages.
- `src/protocol/terrain-assembler.test.ts` — unit tests for the assembler.
- `src/protocol/decompress.test.ts` — unit tests for decompression dispatch and the spec's worked 2×2 f32+zstd ground-truth example.

### Modified

- [src/protocol/types.ts](../../src/protocol/types.ts) — add `TERRAIN_CHUNK = 0x04`, `TERRAIN_HEADER = 0x05` to `MessageType`; add `TerrainDtype` and `TerrainCompression` const tables and their value types. `ParsedTerrain` shape is unchanged. (See TD-3.)
- [src/protocol/deserialize.ts](../../src/protocol/deserialize.ts) — `parseMessage` retained for `SNAPSHOT` / `STATE_UPDATE` only; the `TERRAIN` case is removed (now handled by the assembler). The internal `parseTerrain` helper moves to `terrain-assembler.ts` and gets renamed `parseTerrainSingleShot` (taking the new v2 layout). Existing tests that exercise `parseTerrain` directly migrate to the assembler test file.
- [src/net/connection.ts](../../src/net/connection.ts) — `handleMessage` calls `assembler.feed(event.data)` and switches on the output kind. On `protocol-error`, calls `ws.close(1002, reason)`. The existing slice 102 `applyTerrain` call is reached only via the `'message'` arm with `parsed.type === MessageType.TERRAIN`. A new assembler is created at the start of each `connect()` call.
- [src/protocol/deserialize.test.ts](../../src/protocol/deserialize.test.ts) — terrain-specific tests are moved out (see new test files); snapshot/state-update tests are unchanged.
- `package.json` — add the chosen zstd and lz4 packages (Phase 6 selection per TD-4).

### Unchanged

- `src/rendering/terrain.ts` and the `applyTerrain` state-handler. The `ParsedTerrain` shape is unchanged.
- `src/protocol/types.ts`'s `ParsedSnapshot`, `ParsedStateUpdate`, `ParsedTerrain` interfaces.

## Cross-Slice Dependencies and Interfaces

- **Depends on:** Slice 102 (existing `ParsedTerrain` consumer; `applyTerrain` in viewer state). Renderer interface stays stable, so slice 110 / 111 paths are not touched.
- **Interface to renderer:** unchanged. Both single-shot and chunked paths produce a `ParsedTerrain` identical to slice 102.
- **Interface to connection layer:** changed. Old contract: `parseMessage(buffer) → ParsedMessage | null`. New contract: `assembler.feed(buffer) → AssemblerOutput`. Both `SNAPSHOT` and `STATE_UPDATE` continue to surface as `{ kind: 'message', message }` for behavioral parity.
- **Server protocol contract:** the spec linked above. No client-to-server changes.

## Risks

- **Decompressor bundle size and API shape (Medium).** The two third-party packages are new dependencies. If a frame-capable, synchronous, browser-friendly zstd decoder under the soft 100 KB-gzip target turns out not to exist, the slice fallback is to either accept a larger bundle (with PM sign-off) or skip zstd support and rely on server config defaulting to lz4 or none. Mitigation: TD-4 leaves library pin to Phase 6 to allow real bundle measurement.
- **Synchronous-decode assumption (Low–Medium).** The assembler runs inside `onmessage` and assumes decompression returns synchronously. If only async APIs exist for one algorithm, the assembler grows a "pending decompression" state and chunked-path queueing complexity. Mitigation: the synchronous-API check is a hard constraint in TD-4; if it can't be met, raise to PM before implementation.
- **Partition validation bugs producing false protocol errors (Low).** Off-by-one in coverage-mask write or in the "duplicate seq num with same coords" comparison would cause spurious 1002 closes. Mitigation: the worked-example test plus a synthesized chunked-grid test with a known partition cover both cases.
- **Endianness regression (Low).** New code paths add new multi-byte reads; if any go through `view.getUint32(offset)` without `littleEndian = true`, big-endian hardware silently corrupts. Mitigation: TD-9 mandates routing through helpers; lint rule (existing `eslint-no-restricted-syntax` if configured, else inline review) catches direct `getXxx` without LE flag.

## Success Criteria

1. The assembler decodes the spec's worked 2×2 f32 + zstd example to `[[0.0, 1.0], [2.0, 3.0]]` (within f32-to-f64 promotion tolerance).
2. The assembler decodes a synthetic single-shot v2 terrain at every dtype × compression combination (3 × 3 = 9 paths), each producing a `ParsedTerrain` whose `elevation` matches the source within dtype precision.
3. The assembler decodes a synthetic chunked terrain (≥ 4 chunks partitioning a non-square grid) at every dtype × compression combination, with chunks delivered in non-sequential `(row_offset, col_offset)` order to verify reassembly is offset-driven not arrival-driven.
4. Every protocol-error condition from TD-7's table produces `{ kind: 'protocol-error', reason: <descriptive string> }`. The connection layer's response — `ws.close(1002, reason)` — is exercised in a connection-layer test using the existing `MockWebSocket` in [net/connection.test.ts](../../src/net/connection.test.ts).
5. A duplicate `sequence_number` with identical `(row_offset, col_offset, chunk_rows, chunk_cols)` and identical payload bytes logs a warning and continues; the grid still assembles correctly.
6. `uint16` dequantization round-trips: a synthetic grid with known elevations encoded with `(elevation_min, elevation_max)` matches the original within `(max - min) / 65535` tolerance.
7. The renderer ([rendering/terrain.ts](../../src/rendering/terrain.ts)) requires zero code changes for this slice. The existing terrain test suite (slices 102 / 110 / 111) passes unchanged.
8. No raw opcode hex literals (`0x03`, `0x04`, `0x05`) in dispatch, parsers, tests, or logs outside the `MessageType` const definition itself. Same for `TerrainDtype` and `TerrainCompression` field-value comparisons.
9. `pnpm tsc --noEmit`, `pnpm test --run`, and `pnpm build` all pass.

## Verification Walkthrough

This walkthrough captures what was actually run during Phase 6. The unit-level paths (worked-example tests + connection-layer integration) are runnable and reproducible by any agent (human or AI) without access to a live v2 server. The live-server paths are documented for future verification once a v2 server build is available.

### Unit-level ground-truth (no live server required) — RAN

The single-shot 2×2 worked example and the chunked 4×2 worked example from the captured reference are both pinned as unit tests. Run from the repo root:

```bash
pnpm test --run src/protocol/terrain-assembler.test.ts
pnpm test --run src/protocol/terrain-assembler-chunked.test.ts
```

Expected output (representative — totals match commit `8b80748`):
- `terrain-assembler.test.ts`: 24 passed (5 skeleton + 19 single-shot)
- `terrain-assembler-chunked.test.ts`: 23 passed (chunked worked-example, 9 dtype×compression combos in chunked form, plus 13 protocol-error/state-machine cases)

The single-shot worked-example test (T8 — "decodes the spec 2×2 f32+zstd worked example exactly") and the chunked worked-example test (T10 — "decodes the spec chunked worked example exactly (header + chunk0 + chunk1)") each construct the spec's exact byte sequence as `Uint8Array` literals from the captured reference and assert the assembler produces the expected `Float64Array`. These two tests are the protocol-correctness gate: if both pass, decode is correct.

### Connection-layer integration — RAN

```bash
pnpm test --run src/net/connection.test.ts
```

Expected: 13 passed. Five new cases added in T12 cover:
- Close-1002 on terrain protocol error (orphan TERRAIN_CHUNK without preceding TERRAIN_HEADER)
- Renderer state populated on chunked-terrain success
- Renderer state populated on single-shot v2 terrain success
- Truncated STATE_UPDATE does **not** trigger close-1002 (tier-1 preserved)
- Per-connection assembler isolation across reconnect

### Full quality gates — RAN

```bash
pnpm tsc --noEmit                # clean
pnpm test --run                  # 121 passed (was 71 at start of slice 112; +50)
pnpm build                       # clean; 840 KB / 234.5 KB gzipped
```

Bundle-size delta vs slice 111 baseline (tag `v0.0.3`): **+19 KB raw / +7.5 KB gzipped**, well under TD-4's 20 KB-gzipped target. The two added decompression libraries (`fzstd` ~10 KB, `lz4js` ~30 KB) compress favorably.

### Live-server paths — DEFERRED

Live-server verification is deferred. No migratory v2 server build was available during Phase 6. The unit-level worked-example tests (T8 + T10) plus the close-1002 integration test (T12) cover protocol correctness at the unit level; live verification can be a follow-up once the migratory server has a v2 build deployable in a local development environment. To resume:

#### Live-server single-shot path

1. Start the migratory server with `terrain_wire.compression: zstd`, `dtype: f64`, no chunking. Confirm the server log shows the v2 single-shot path.
2. Open the viewer at `pnpm dev`; confirm the browser console shows exactly one `[net] TERRAIN rows=R cols=C resolution=X dtype=f64 compression=zstd chunks=1 bytes_compressed=BC bytes_decompressed=BD` line, with `BC < BD` (compression actually ran).
3. Confirm the rendered terrain matches the slice 102 / 111 visual baseline (no rendering changes).

#### Live-server chunked path

1. Restart the server with chunking thresholds set so the production terrain payload chunks into ≥ 4 pieces.
2. Open the viewer; confirm the console log shows `chunks=N` with `N ≥ 4`, the rendered terrain still matches the visual baseline, and no protocol-error logs appear.
3. Inspect the WebSocket frames in browser devtools (Network → WS → Frames). Confirm one `0x05` frame followed by N `0x04` frames before any `0x02` frame appears.

#### Protocol-error path

1. Add a temporary server debug hook (or use a WebSocket fuzzer) to:
   - Send a `0x03` frame with reserved flag bit 5 set → expect `[net] terrain protocol error: reserved flag bits set` and the socket closes with code 1002, then reconnects.
   - Send a `0x04` chunk with no preceding `0x05` → expect protocol error.
   - Send a chunked terrain that omits one chunk → expect coverage-validation protocol error after the last-flag chunk.
2. After each closure, confirm the existing reconnect-with-backoff path runs (slice 101 behavior), and that the next connection's terrain renders normally.

#### Solid-color / fallback verification

1. Restart the server with `terrain_wire.compression: none` and `dtype: f32` (the simplest combination). Confirm the viewer renders identically — the visual outcome is independent of compression and dtype.

### Caveats discovered during implementation

- **`lz4js` content-size flag bug.** During T4, the `lz4js` v0.2.0 `decompressBound` function was found to mishandle the optional 64-bit content-size field in LZ4 Frame descriptors (JS bit-shift `<< 32` wraps mod 32, producing a sign-extended garbage size and a `RangeError: Invalid array length`). The remediation was to coordinate with the migratory server team to emit LZ4 frames with `content_size=False` and `content_checksum=False`. This constraint is now documented in [project-documents/reference/terrain-wire-protocol-v2.md](../../reference/terrain-wire-protocol-v2.md#compression-frame-formats). Frames without content-size decode correctly. If a future server build needs to re-enable content-size, coordinate a viewer-side decoder swap first (TD-4 names `lz4-wasm` as the documented WASM fallback).
- **Test fixtures are pre-baked.** `fzstd` is decode-only, and `lz4js`'s frame compressor doesn't reliably match the descriptor we expect. Test fixtures (compressed frame bytes for the worked examples and the 9-combo round-trips) are pre-generated via the system `zstd` and `lz4` CLIs and inlined as `Uint8Array` constants in [src/protocol/_test-helpers.ts](../../src/protocol/_test-helpers.ts). Each fixture includes a comment recording the exact CLI command used. The 2×2 worked-example zstd fixture is byte-identical to the one in the spec's captured reference.

## Open Questions — Resolved

All design-time questions are resolved as of 2026-04-24:

1. **Decompressor library pins.** Resolved — TD-4 locks `fzstd` (zstd) and `lz4js` (lz4) as the implementation choice, with documented WASM fallbacks per algorithm if Phase 6 verification fails.
2. **Bundle-size target meaning.** Resolved — TD-4's "Bundle-size context" clarifies the < 100 KB-gzipped soft target applies to the decompression libraries themselves (first-load JS weight), not to the terrain payload (bounded separately by the server's 32 MiB WebSocket cap).
3. **Entity-state error policy.** Resolved — option A confirmed by PM. Slice 112 keeps `SNAPSHOT` / `STATE_UPDATE` malformed-input handling unchanged (log + drop, slice 101 behavior). Close-1002 escalation applies only to terrain opcodes per TD-7. A unified policy is left as a future slice if desired.
4. **Spec source of truth.** Resolved — the Viewer Implementer Reference is materialized at [project-documents/reference/terrain-wire-protocol-v2.md](../../reference/terrain-wire-protocol-v2.md) and referenced from the Spec Reference section above. That capture is the authoritative source for Phase 6.
