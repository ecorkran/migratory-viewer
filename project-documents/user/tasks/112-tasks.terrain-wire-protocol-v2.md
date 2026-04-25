---
docType: tasks
slice: "112"
sliceName: terrain-wire-protocol-v2
project: migratory-viewer
parent: user/slices/112-slice.terrain-wire-protocol-v2.md
spec: project-documents/reference/terrain-wire-protocol-v2.md
dependencies:
  - slice: "102"
    name: terrain-rendering
    role: predecessor — the v1 single-shot 0x03 parser this slice replaces
projectState: slice 111 complete and tagged v0.0.3; main is clean; 71 tests passing
dateCreated: 20260424
dateUpdated: 20260424
status: not_started
notes:
  - 20260424 — chunked-path byte layouts confirmed by migratory server team; T9 unblocked. Confirmed offsets captured in project-documents/reference/terrain-wire-protocol-v2.md under "Confirmed Offsets — TERRAIN_HEADER and TERRAIN_CHUNK (added 2026-04-24)". Upstream spec re-sync tracked under migratory slice 317 Task 10.2.
---

# Tasks: Slice 112 — Terrain Wire Protocol v2 (Chunked + Compressed)

## Context Summary

This task list implements [slice 112 design](../slices/112-slice.terrain-wire-protocol-v2.md) — the viewer-side ingest path for the v2 terrain wire protocol. The authoritative byte-layout spec is the captured reference at [project-documents/reference/terrain-wire-protocol-v2.md](../../reference/terrain-wire-protocol-v2.md); whenever the implementation needs an exact byte offset or flag-bit layout, that file wins.

Sequencing rationale:

1. **Types and constants first.** Every other file imports from `protocol/types.ts`. Establishing the new opcodes, dtype, and compression const tables up front means later tasks reference real symbols.
2. **Decompression module second.** `decompress.ts` is independent (no dependency on the assembler), trivial to unit-test, and is the slowest task to validate against real frames — front-loading it surfaces dependency issues early.
3. **Assembler in two stages.** Single-shot v2 `0x03` path before chunked `0x05` + `0x04`. The single-shot path exercises every dtype × compression combination in the simplest framing; chunked adds the state machine on top of a known-working decode path.
4. **Connection-layer integration last.** The assembler is wired into [net/connection.ts](../../src/net/connection.ts) only after every assembler unit test passes — keeps the connection-layer test surface focused on dispatch and close-1002 behavior.
5. **Architecture docs were already updated** during slice design (review remediation, F003). No additional architecture-doc task in this list — closeout only verifies they're still consistent.

Renderer-facing types are unchanged: `ParsedTerrain` keeps the slice 102 shape. `applyTerrain` and [rendering/terrain.ts](../../src/rendering/terrain.ts) are not touched. Slices 102 / 110 / 111 tests must continue passing unchanged through the entire breakdown.

**Branch.** Per project git rules: work on branch `112-slice.terrain-wire-protocol-v2` cut from `main`.

## Pre-Implementation Setup

- [ ] **T0. Branch + dependency install**
  - [ ] Verify on `main`, working tree clean (`git status`).
  - [ ] Create and check out `112-slice.terrain-wire-protocol-v2` from `main`.
  - [ ] `pnpm add fzstd lz4js` — install runtime decompressors. Verify `package.json` lists both under `dependencies`. Commit as `chore: add fzstd and lz4js for v2 terrain wire`.
  - [ ] Run `pnpm tsc --noEmit && pnpm test --run` to confirm baseline still green.
  - **Effort:** 1/5

## Phase A — Types and Constants

- [ ] **T1. Extend `MessageType` and add `TerrainDtype` / `TerrainCompression` const tables**
  - [ ] In [src/protocol/types.ts](../../src/protocol/types.ts), add `TERRAIN_CHUNK: 0x04` and `TERRAIN_HEADER: 0x05` to the existing `MessageType` const-as-object.
  - [ ] Add new exported `TerrainDtype` const (`F32: 0`, `F64: 1`, `UINT16: 2`) with `as const` and a derived `TerrainDtypeValue` type.
  - [ ] Add new exported `TerrainCompression` const (`NONE: 0`, `ZSTD: 1`, `LZ4: 2`) with `as const` and a derived `TerrainCompressionValue` type.
  - [ ] Do **not** modify the existing `ParsedTerrain` interface — its shape stays identical.
  - [ ] No literal hex bytes (`0x04`, `0x05`) appear anywhere except inside these definitions.
  - **Success criteria:** `pnpm tsc --noEmit` clean; existing tests still pass; `MessageType.TERRAIN_HEADER === 0x05` and `MessageType.TERRAIN_CHUNK === 0x04` at runtime.
  - **Effort:** 1/5

- [ ] **T2. Tests for new constants**
  - [ ] Add `src/protocol/types.test.ts` (new file) — minimal smoke tests asserting the numeric values of every entry in `MessageType`, `TerrainDtype`, `TerrainCompression`. Reason: the rest of the slice references these constants by name; one test file pinning the numbers means a typo in any constant fails loudly here rather than silently in a downstream parser.
  - [ ] Single test per table is fine (`expect(MessageType).toEqual({SNAPSHOT: 0x01, ..., TERRAIN_HEADER: 0x05})`).
  - **Success criteria:** `pnpm test --run` passes with the new tests included.
  - **Effort:** 1/5

## Phase B — Decompression Module

- [ ] **T3. Implement `decompress.ts` with `none` / `zstd` / `lz4` dispatch**
  - [ ] Create `src/protocol/decompress.ts`. Export a single function `decompress(payload: Uint8Array, algorithm: TerrainCompressionValue): Uint8Array`.
  - [ ] For `TerrainCompression.NONE`: return `payload` unchanged (no copy — the caller owns the lifetime).
  - [ ] For `TerrainCompression.ZSTD`: import the sync decode entry point from `fzstd` and return its result.
  - [ ] For `TerrainCompression.LZ4`: import the sync frame-decode entry point from `lz4js` and return its result.
  - [ ] If the decoder throws, re-throw a `TypeError` with message prefixed `terrain decompress: <algorithm name> failed: <original message>`. Do not swallow.
  - [ ] No `any`. The two third-party packages may need a `.d.ts` shim if their published types are missing — if so, add `src/types/fzstd.d.ts` and/or `src/types/lz4js.d.ts` with minimal `declare module` exposing only the function we use.
  - **Success criteria:** `pnpm tsc --noEmit` clean; module exports `decompress` only; no other public symbols.
  - **Effort:** 2/5

- [ ] **T4. Tests for `decompress.ts`**
  - [ ] Create `src/protocol/decompress.test.ts`.
  - [ ] **Test:** `NONE` returns the input unchanged (same bytes, length matches).
  - [ ] **Test:** `ZSTD` round-trips a known plaintext: encode a fixed `Uint8Array` with a hand-built or stored zstd frame (use a small fixture `[0x00, 0x00, 0x00, 0x00]` payload f32 LE matching the spec's worked example), decompress, assert byte-equal to plaintext. If generating a zstd frame at test-time isn't trivial, hard-code the spec's worked-example zstd bytes as the fixture.
  - [ ] **Test:** `LZ4` round-trips a known plaintext using a similarly hard-coded LZ4 Frame fixture (small enough to inline as a `Uint8Array.of(...)`).
  - [ ] **Test:** Decoder throw produces a wrapped `TypeError` with the expected prefix. Force a failure by feeding garbage bytes (`Uint8Array.of(0xff, 0xff, 0xff, 0xff)`) to ZSTD.
  - [ ] **Note for fixture generation:** if generating valid frames at test-time proves awkward, generate them once via a one-off Node script using the same library and paste the resulting hex into the test. Document the source command in a comment.
  - **Success criteria:** All four tests pass; total test count up by exactly 4.
  - **Effort:** 2/5

## Phase C — Single-Shot v2 TERRAIN Path

- [ ] **T5. Add the assembler skeleton: factory, types, IDLE-state dispatch on `0x01` / `0x02`**
  - [ ] Create `src/protocol/terrain-assembler.ts`. Export a factory `createTerrainAssembler()` returning an object with method `feed(buffer: ArrayBuffer): AssemblerOutput`.
  - [ ] Define and export the discriminated union:
    ```typescript
    export type AssemblerOutput =
      | { kind: 'message'; message: ParsedMessage }
      | { kind: 'pending' }
      | { kind: 'protocol-error'; reason: string };
    ```
  - [ ] Internal state: `state: 'IDLE' | 'EXPECTING_CHUNKS'`, `stateUpdatesStarted: boolean` (initially `false`). Chunked-specific state (grid, mask, expectedChunks, headerMeta) introduced in T9.
  - [ ] On `feed`: read leading byte. If `MessageType.SNAPSHOT` or `STATE_UPDATE`: delegate to the existing `parseSnapshot` / `parseStateUpdate` (move them out of `deserialize.ts`'s unexported scope to an exported sub-API, OR import them via a small refactor — choose whichever requires the smaller diff in `deserialize.ts`). On `null` from those parsers, return `{kind: 'pending'}` (preserves slice 101 tier-1 behavior). On success, set `stateUpdatesStarted = true` if message is `STATE_UPDATE`, return `{kind: 'message', message}`.
  - [ ] On any byte not in `MessageType`: return `{kind: 'protocol-error', reason: 'unknown opcode 0x<hex>'}`.
  - [ ] Do not yet implement the `TERRAIN` / `TERRAIN_HEADER` / `TERRAIN_CHUNK` cases — return `{kind: 'protocol-error', reason: 'not implemented in T5'}` for those, with a `// TODO T6/T9` marker. (Tests in T6/T10 will replace these stubs.)
  - **Success criteria:** Module compiles; SNAPSHOT and STATE_UPDATE round-trip via `feed` produce the same `ParsedMessage` as direct `parseMessage` calls.
  - **Effort:** 2/5

- [ ] **T6. Tests for assembler skeleton (delegation + unknown opcode)**
  - [ ] Create `src/protocol/terrain-assembler.test.ts`.
  - [ ] **Test:** Feed a valid `SNAPSHOT` buffer (build via the same helper used in [src/net/connection.test.ts](../../src/net/connection.test.ts)). Assert output `kind === 'message'`, `message.type === MessageType.SNAPSHOT`.
  - [ ] **Test:** Feed a valid `STATE_UPDATE`. Assert `'message'` output and that subsequent calls have `stateUpdatesStarted` observably true (assert via the next test rather than exposing the flag).
  - [ ] **Test:** Feed a malformed `SNAPSHOT` (truncated header). Assert `kind === 'pending'` (tier-1 behavior — drop, do not close).
  - [ ] **Test:** Feed `Uint8Array.of(0x42).buffer`. Assert `{kind: 'protocol-error', reason: /unknown opcode 0x42/}`.
  - [ ] **Test:** Two assemblers from `createTerrainAssembler()` are independent (state in one does not leak to the other).
  - **Success criteria:** Five tests pass.
  - **Effort:** 2/5

- [ ] **T7. Implement v2 `0x03 TERRAIN` single-shot decode**
  - [ ] In `terrain-assembler.ts`, add internal helper `parseTerrainSingleShot(buffer: ArrayBuffer): ParsedTerrain | { error: string }`.
  - [ ] Header layout per the captured spec (Worked Example section): bytes 1–4 rows (u32 LE), 5–8 cols (u32 LE), 9–16 resolution (f64 LE), 17–24 originX (f64 LE), 25–32 originY (f64 LE), byte 33 flags.
  - [ ] Decode flags: `dtype = flags & 0b11`, `compression = (flags >> 2) & 0b111`, `reserved = (flags >> 5) & 0b111`. If `reserved !== 0`, return `{error: 'reserved flag bits set (protocol version mismatch — update viewer)'}`. If dtype is 3 (unknown), return `{error: 'unknown dtype'}`. If compression > 2, return `{error: 'unknown compression'}`.
  - [ ] If dtype is `UINT16`, read `elevation_min` (f64 LE at offset 34) and `elevation_max` (f64 LE at offset 42); payload starts at byte 50. Otherwise payload starts at byte 34.
  - [ ] Slice the compressed payload bytes out (use `buffer.slice` to detach from the WebSocket buffer per TD-9), call `decompress(payload, compression)`, then dtype-decode using a new internal helper `decodeDtype(decompressed: Uint8Array, dtype, count, elevationMin?, elevationMax?): Float64Array`.
  - [ ] `decodeDtype` cases: F32 → wrap as `Float32Array` and copy into a `Float64Array`; F64 → wrap as `Float64Array` (copy via `.slice()` to detach); UINT16 → wrap as `Uint16Array`, dequantize each value to f64 via `min + (u / 65535) * (max - min)`.
  - [ ] Validate sanity: `rows > 0`, `cols > 0`, `resolution > 0`, `rows * cols <= config.terrainMaxCells`. On failure, return `{error: ...}`. (These remain protocol errors under the new policy.)
  - [ ] If decompression throws (T3's wrapped `TypeError`), catch and convert to `{error: 'malformed compressed payload: <message>'}`.
  - [ ] In `feed`'s `MessageType.TERRAIN` branch: if `state === 'EXPECTING_CHUNKS'`, return `{kind: 'protocol-error', reason: 'TERRAIN single-shot received mid-chunked delivery'}`. If `stateUpdatesStarted`, return `{kind: 'protocol-error', reason: 'TERRAIN received after STATE_UPDATE began'}`. Otherwise call `parseTerrainSingleShot`; on success, log the spec INFO line (TD-10) and return `{kind: 'message', message}`. On error, return `{kind: 'protocol-error', reason}`.
  - **Success criteria:** Module compiles; the single-shot path handles all 9 dtype × compression combinations.
  - **Effort:** 3/5

- [ ] **T8. Tests for single-shot v2 decode**
  - [ ] **Test (worked example):** Build the spec's exact 2×2 f32 + zstd byte sequence as a `Uint8Array` literal (header + flags byte `0x04` + the spec-listed zstd frame bytes). Feed to a fresh assembler. Assert `kind === 'message'`, `message.type === MessageType.TERRAIN`, `rows === 2`, `cols === 2`, `resolution === 10`, and `Array.from(message.elevation) === [0, 1, 2, 3]` within Float32 precision (use `toBeCloseTo` per element).
  - [ ] **Test (round-trip 9 combos):** A helper `buildSingleShotTerrain(rows, cols, elevations, dtype, compression)` that synthesizes a v2 frame given those parameters. Use it to feed a small (e.g. 3×3) grid through every dtype × compression combination (9 cases). Assert each decodes to a `Float64Array` matching the source within dtype precision (f32 / uint16 tolerances; f64 exact).
  - [ ] **Test (reserved bit set):** Construct a frame with flags = `0b00100000` (reserved bit 5). Assert `{kind: 'protocol-error', reason: /reserved flag bits/}`.
  - [ ] **Test (unknown dtype):** flags with `dtype = 3`. Assert `{kind: 'protocol-error', reason: /unknown dtype/}`.
  - [ ] **Test (unknown compression):** flags with `compression = 3`. Assert protocol-error.
  - [ ] **Test (uint16 dequant tolerance):** Synthesize a 4×4 grid with known elevations in `[0, 100]`, encode as uint16 with min=0, max=100, decode, assert each value within `100 / 65535 ≈ 0.00153` tolerance.
  - [ ] **Test (uint16 constant terrain):** elevation_min == elevation_max → dequant produces all `min` values, no NaN.
  - [ ] **Test (TERRAIN after STATE_UPDATE):** Feed STATE_UPDATE first, then a single-shot TERRAIN. Assert protocol-error with reason mentioning state-update ordering.
  - [ ] **Test (truncated payload):** Single-shot frame whose declared compression is `NONE` and dtype is `F64`, but buffer is one byte short of `header + rows * cols * 8`. Assert protocol-error with reason mentioning length mismatch.
  - **Success criteria:** All tests pass; `buildSingleShotTerrain` test helper is exported from the test file (or a sibling `_test-helpers.ts` if that's cleaner) for reuse in T10.
  - **Effort:** 3/5

## Phase D — Chunked TERRAIN Path

- [ ] **T9. Implement chunked path: `0x05 TERRAIN_HEADER` + `0x04 TERRAIN_CHUNK`**
  - [ ] Byte layouts for both opcodes are confirmed in [project-documents/reference/terrain-wire-protocol-v2.md](../../reference/terrain-wire-protocol-v2.md), section "Confirmed Offsets — TERRAIN_HEADER and TERRAIN_CHUNK (added 2026-04-24)". Implement against that table; if any offset below appears to disagree with the reference, the reference wins.
  - [ ] Extend assembler internal state with: `grid: Float64Array | null`, `written: Uint8Array | null` (coverage mask), `expectedChunks: number`, `receivedChunks: number`, `headerMeta: {rows, cols, resolution, originX, originY, dtype, compression, elevationMin?, elevationMax?} | null`, `seenSequenceNumbers: Map<number, {rowOffset, colOffset, chunkRows, chunkCols}>` (for duplicate detection per spec).
  - [ ] **Header parse (`0x05`, 38 bytes; 54 bytes if dtype = uint16).** Bytes 0–33 are byte-position-identical to single-shot `0x03` (the same fixed-prefix reader works for both). Then: `chunk_count` (u32 LE) at byte 34; optional `elevation_min`/`elevation_max` (2× f64 LE) at bytes 38–53 only when dtype = UINT16.
  - [ ] On `0x05`: if `state !== 'IDLE'`, protocol error. If `stateUpdatesStarted`, protocol error. Validate flags + dimensions identically to T7. Allocate `grid = new Float64Array(rows * cols)` and `written = new Uint8Array(rows * cols)`. Store `headerMeta`, `expectedChunks = chunk_count`, `receivedChunks = 0`, set `state = 'EXPECTING_CHUNKS'`. Return `{kind: 'pending'}`.
  - [ ] **Chunk parse (`0x04`, 22-byte header + payload).** Layout: `sequence_number` (u32 LE, byte 1), `row_offset` (u32 LE, byte 5), `col_offset` (u32 LE, byte 9), `chunk_rows` (u32 LE, byte 13), `chunk_cols` (u32 LE, byte 17), `last_chunk_flag` (u8, byte 21). Payload starts byte 22.
  - [ ] On `0x04`: if `state !== 'EXPECTING_CHUNKS'`, protocol error. Decompress + dtype-decode the payload using `headerMeta.dtype` and `headerMeta.compression` (chunks share the header's dtype, compression, and dequant range). Verify decoded length === `chunkRows * chunkCols`; on mismatch, protocol error.
  - [ ] **Bounds check:** `rowOffset + chunkRows <= headerMeta.rows`, `colOffset + chunkCols <= headerMeta.cols`. On violation, protocol error.
  - [ ] **Duplicate detection** (per the reference's refined two-case policy): if `seenSequenceNumbers.has(sequence_number)`: compare stored coordinates to current. If identical, log warning `[net] terrain warning: duplicate chunk seq=N (last-write-wins)` and continue with the write. If different, protocol error (`duplicate sequence_number with different coordinates`). Otherwise record `(seq → {rowOffset, colOffset, chunkRows, chunkCols})`.
  - [ ] **Write into grid:** for each `r` in `0..chunkRows-1`, copy `decoded.subarray(r * chunkCols, (r+1) * chunkCols)` into `grid` at offset `(rowOffset + r) * headerMeta.cols + colOffset`. For each cell written, set `written[i] = 1`. If `written[i]` was already `1` from a *non-duplicate* chunk (i.e. coordinates didn't match a recorded seq num), that's an overlap protocol error.
  - [ ] Increment `receivedChunks`. If `last_chunk_flag === 1`: assert `receivedChunks === expectedChunks` (mismatch → protocol error). Validate every cell of `written` is exactly `1` (any `0` → `missing chunk coverage gap at index I` protocol error). On full success, build the `ParsedTerrain` from `headerMeta` and `grid`, log the spec INFO line, reset all chunked state, set `state = 'IDLE'`, return `{kind: 'message', message}`.
  - [ ] If not last: return `{kind: 'pending'}`.
  - **Success criteria:** Module compiles. Single-shot path from T7 still passes its tests (no regression). All offset reads pass through the existing LE helpers (TD-9).
  - **Effort:** 4/5

- [ ] **T10. Tests for chunked path**
  - [ ] Add a helper `buildChunkedTerrain(rows, cols, elevations, chunkLayout, dtype, compression)` to the test helpers. `chunkLayout` is an array of `{rowOffset, colOffset, chunkRows, chunkCols, sequenceNumber, isLast}` describing the rectangular partition. The helper produces one `0x05` frame and N `0x04` frames matching the confirmed-offsets layout.
  - [ ] **Test (chunked worked example — ground truth):** Build the spec's exact 4×2 f32+zstd two-row-strip example from the reference's "Worked Example: 4×2 f32 + zstd, two 2×2 row-strip chunks" section as `Uint8Array` literals (header + both chunks). Feed header + chunk[0] + chunk[1] to a fresh assembler. Assert the first two `feed` calls return `{kind: 'pending'}`, the third returns `{kind: 'message'}` with `rows === 4`, `cols === 2`, `elevation` equal to `Float64Array.of(0,1,2,3,4,5,6,7)` within f32 precision (use `toBeCloseTo` per element). Mirror this with a second variant feeding the chunks in **reverse** order (chunk[1] before chunk[0]) — assert the same final grid (offset-driven reassembly).
  - [ ] **Test (basic 4-chunk grid):** 6×6 grid partitioned into four 3×3 quadrants, dtype f64, compression none. Feed `0x05` then four `0x04`s in arrival order. Assert intermediate calls return `{kind: 'pending'}`. Final call returns `{kind: 'message', message}` with elevation matching the source exactly.
  - [ ] **Test (out-of-order chunks):** Same partition, but feed chunks in reverse seq order. Assert reassembly is offset-driven and produces the identical grid.
  - [ ] **Test (non-square grid + non-uniform partition):** 8×12 grid, partition into `{0,0,8,4}, {0,4,8,4}, {0,8,8,4}` (three vertical strips). f32 + zstd. Assert correct reassembly.
  - [ ] **Test (all 9 dtype × compression combos in chunked form):** Use a small 4×4 grid partitioned into 4 quadrants, run all 9 combinations.
  - [ ] **Test (missing chunk):** Send `0x05` declaring `expectedChunks=4`, then send only 3 chunks with the third marked `isLast=1`. Assert protocol-error with reason mentioning chunk count or coverage.
  - [ ] **Test (overlap):** Two non-duplicate chunks claim overlapping regions (different seq numbers, same `(rowOffset, colOffset)`). Final chunk's last-flag triggers coverage-mask check; assert overlap is caught either at write time or at finalization.
  - [ ] **Test (duplicate seq same coords):** Send chunk with seq=2, then send seq=2 again with identical coordinates and identical bytes. Assert no protocol error; assembled grid is correct.
  - [ ] **Test (duplicate seq different coords):** Send seq=2 at one location, then seq=2 at a different `(rowOffset, colOffset)`. Assert protocol-error.
  - [ ] **Test (TERRAIN_HEADER mid-chunk):** Send `0x05`, one chunk, then another `0x05`. Assert protocol-error with reason mentioning out-of-state header.
  - [ ] **Test (TERRAIN_CHUNK without header):** Fresh assembler, send `0x04` directly. Assert protocol-error with reason mentioning missing header.
  - [ ] **Test (TERRAIN single-shot mid-chunk):** Send `0x05`, then a `0x03` single-shot. Assert protocol-error.
  - [ ] **Test (chunk bounds out-of-range):** chunk with `rowOffset + chunkRows > headerMeta.rows`. Assert protocol-error.
  - [ ] **Test (chunked terrain after STATE_UPDATE):** Send STATE_UPDATE first, then `0x05`. Assert protocol-error.
  - **Success criteria:** All tests pass. Combined with T8's tests, every row in TD-7's protocol-error catalog (except those exclusive to compression decoder failure, covered by T4) is exercised.
  - **Effort:** 4/5

## Phase E — Connection-Layer Integration

- [ ] **T11. Wire the assembler into [net/connection.ts](../../src/net/connection.ts)**
  - [ ] Inside `connect(url)`, instantiate `const assembler = createTerrainAssembler()` after `ws.binaryType = 'arraybuffer'` and before `ws.onmessage` is wired.
  - [ ] Replace the `handleMessage` body. New flow:
    ```
    if not ArrayBuffer: warn + return (unchanged)
    const out = assembler.feed(event.data)
    switch (out.kind):
      'pending'         → return
      'protocol-error'  → console.warn(`[net] terrain protocol error: ${out.reason}`); ws.close(1002, out.reason); return
      'message'         → existing per-opcode dispatch (applySnapshot / applyTerrain / applyStateUpdate, with the entity-count-mismatch reconnect retained)
    ```
  - [ ] Remove the now-unused `parseMessage` import (or keep `parseMessage` exported for any non-WebSocket consumers — confirm by grep there are none in `src/`).
  - [ ] Remove the `TERRAIN` case from `parseMessage` in [src/protocol/deserialize.ts](../../src/protocol/deserialize.ts), since terrain is now exclusively assembler-routed. Move (do not duplicate) `parseTerrain` into `terrain-assembler.ts` if not already done in T7. The `parseSnapshot` and `parseStateUpdate` helpers remain in `deserialize.ts`.
  - [ ] Verify no opcode hex literals remain in `connection.ts` outside of comments.
  - **Success criteria:** `pnpm tsc --noEmit` clean; full test suite passes; the worked-example unit test (T8) and chunked tests (T10) still pass; existing `connection.test.ts` tests still pass.
  - **Effort:** 2/5

- [ ] **T12. Tests for connection-layer integration**
  - [ ] Extend `src/net/connection.test.ts` with new cases (do not delete existing tests — slice 101 / 102 behavioral parity must remain green).
  - [ ] **Test (close 1002 on terrain protocol error):** Use the existing `MockWebSocket`. Feed a `0x05` followed by a `0x04` from a *different* logical chunked transfer (mismatched header). Assert that `mockWs.close` was called with code `1002` and a reason string. Assert subsequent reconnect path engages (existing reconnect tests as a reference for assertion shape).
  - [ ] **Test (renderer state populated on chunked success):** Feed a small chunked terrain through the connection layer. Assert `viewerState.terrain` is non-null with the expected `rows`/`cols`/`elevation`.
  - [ ] **Test (single-shot v2 still drives `applyTerrain`):** Confirm a v2 single-shot frame populates `viewerState.terrain` identically to the slice 102 v1 path was supposed to. (Slice 102 set `viewerState.terrain` from a v1 frame; this confirms behavioral parity for the renderer.)
  - [ ] **Test (entity-state malformed unchanged):** Feed a truncated `STATE_UPDATE`. Assert `mockWs.close` is **not** called (tier-1 behavior preserved).
  - [ ] **Test (assembler is per-connection):** Open, disconnect, reconnect. Assert state from the first assembler does not bleed into the second (e.g. by sending half a chunked terrain on the first connection, disconnecting, then sending a fresh single-shot on the second — assert no protocol error).
  - **Success criteria:** All new tests pass; existing connection tests untouched.
  - **Effort:** 3/5

## Phase F — Closeout

- [ ] **T13. Visual / live-server verification (per slice Verification Walkthrough)**
  - [ ] Coordinate with PM to identify a server build emitting v2 terrain. The server-side timing for v2 is "expected before viewer Phase 6 begins" per the slice design — if no live v2 server is available at this point, **mark this task partial and proceed**; the unit-level worked-example test (T8) is the protocol-correctness gate, and live verification can be a follow-up.
  - [ ] **If v2 server available:** run through the slice's "Live-server single-shot path" and "Live-server chunked path" walkthroughs. Confirm one INFO log per terrain transfer with the documented format (TD-10), no protocol-error logs, terrain renders identically to slice 111 visual baseline.
  - [ ] **Optional:** drive a server-side debug hook to emit a deliberately corrupted frame (reserved-bit set) and confirm the close-1002 + reconnect behavior end-to-end in the browser.
  - **Success criteria:** Either visual confirmation, or an explicit note that live verification is deferred (with the worked-example test cited as the unit-level proof of decode correctness).
  - **Effort:** 2/5

- [ ] **T14. Repository-wide opcode-literal audit**
  - [ ] `rg "0x0[1-5]" src/ project-documents/user/architecture/ project-documents/user/slices/` (or equivalent grep) and review each hit. Outside the `MessageType` definition itself, captured spec, and architecture protocol-summary section, no hits should remain. Also check the design and tasks files of slice 112 itself for stray literals.
  - [ ] If any are found, replace with `MessageType.<NAME>` references and re-run tests.
  - **Success criteria:** Audit produces zero unexpected hits, or all hits are replaced and tests still pass.
  - **Effort:** 1/5

- [ ] **T15. Quality gates**
  - [ ] `pnpm tsc --noEmit` — clean.
  - [ ] `pnpm test --run` — all tests pass; record the new total count (was 71 at start of slice).
  - [ ] `pnpm build` — clean. Note the bundle-size delta from `fzstd` + `lz4js`; it should be in the < 20 KB gzipped range per TD-4. If it's materially larger, raise to PM.
  - [ ] Manually exercise the viewer (existing slice 111 visual baseline) one more time to confirm no rendering regression.
  - **Success criteria:** All three gates green; test count > 71.
  - **Effort:** 1/5

- [ ] **T16. Slice closeout**
  - [ ] Update slice design `status: complete`, `dateUpdated: <today>`. Refine the Verification Walkthrough section in the slice file to reflect what actually shipped (any deviations from the planned approach get documented here, same convention as slice 111).
  - [ ] Update [100-slices.viewer-foundation.md](../architecture/100-slices.viewer-foundation.md): check off slice 112's box, bump `dateUpdated`.
  - [ ] Update task file `status: complete`, `dateUpdated: <today>`. Mark every task in this file complete.
  - [ ] Add a `CHANGELOG.md` entry for this slice (one section, summary of v2 protocol support + dependency additions + tier-2 close-1002 policy for terrain).
  - [ ] Commit as `docs: mark slice 112 complete; update CHANGELOG and slice plan`.
  - [ ] If PM requests a version tag, bump `package.json` to `0.0.4` and tag `v0.0.4 — slice 112 (terrain wire protocol v2)` after a separate `chore: bump version to 0.0.4` commit. Push branch + tag.
  - **Success criteria:** All status fields updated; main branch (after PR/merge) has a clean closeout commit; tests still pass on `main`.
  - **Effort:** 1/5

## Open Questions / Blockers

- [x] ~~**Chunked-message byte layouts.**~~ Resolved 2026-04-24. Migratory server team confirmed `TERRAIN_HEADER (0x05)` and `TERRAIN_CHUNK (0x04)` byte tables; bytes 0–33 of `0x05` are byte-position-identical to single-shot `0x03`, with `chunk_count` at byte 34 and the conditional `elevation_min`/`elevation_max` pair at bytes 38–53 only when dtype = UINT16. `0x04` is exactly the layout T9 had assumed. Confirmation captured in [project-documents/reference/terrain-wire-protocol-v2.md](../../reference/terrain-wire-protocol-v2.md) under "Confirmed Offsets — TERRAIN_HEADER and TERRAIN_CHUNK (added 2026-04-24)", which also includes a chunked worked example (4×2 f32 + zstd, two row-strip chunks) and the refined two-case duplicate-sequence-number policy. Upstream spec re-sync is tracked under migratory slice 317 Task 10.2; the additions in our captured reference are canonical until that re-sync lands. **T9 unblocked.**
- [ ] **Live v2 server availability.** T13 depends on a server build emitting v2 frames. If unavailable, T13 falls back to "verified at unit level only" with the worked-example tests (T8 single-shot and T10 chunked) as the protocol-correctness gates.
