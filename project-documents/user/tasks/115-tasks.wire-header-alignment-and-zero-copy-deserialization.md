---
docType: tasks
slice: wire-header-alignment-and-zero-copy-deserialization
project: migratory-viewer
lld: user/slices/115-slice.wire-header-alignment-and-zero-copy-deserialization.md
dependencies:
  - 113-slice.entity-pipeline-performance
  - 114-slice.entity-position-dtype-negotiation-f32-f64
projectState: >
  Slices 100–105, 108, 110–114 complete. Branch main, clean tree.
  Producer-side migratory slice 321 wire-alignment subset is staged at commit
  9e7526d on branch 321-slice.shared-memory-state-transport, awaiting viewer
  readiness. There is no compatibility window: producer and viewer must deploy
  together. Slice 113's deferred T11/T12/T13 zero-copy work is unblocked by
  this slice's 16-byte-aligned headers.
dateCreated: 20260508
dateUpdated: 20260508
status: not_started
---

## Context Summary

- Working on slice 115: wire header alignment + zero-copy deserialization
- Producer pads STATE_UPDATE header to 16 bytes, SNAPSHOT header to 32 bytes;
  positions begin at 16-byte-aligned offsets, satisfying both `Float32Array`
  (4-byte) and `Float64Array` (8-byte) `byteOffset` requirements
- `schema_version = 2` at offset 10 (STATE_UPDATE) and offset 26 (SNAPSHOT) —
  different offsets because SNAPSHOT inherits f64 fields at bytes 5–20
- Reserved bytes (STATE_UPDATE 11–15, SNAPSHOT 27–31) are forward-compat slots;
  parser reads past them, must not validate or reject non-zero values
- `parseStateUpdate` and `parseSnapshot` switch from `buffer.slice()` to
  `new TypedArray(buffer, offset, count)` — zero-copy views into the wire buffer
- `applySnapshot` in `state.ts` must change to detach via `parsed.positions.slice()`
  because parsed views now alias the WebSocket message buffer (which the browser
  reuses on the next `onmessage`); `applyStateUpdate` already copies via `.set()`
  and is unchanged
- Schema version mismatch → `console.warn` + return `null` (tier-1, no disconnect),
  identical to the unknown-dtype path established in slice 114
- Authoritative reference: `user/reference/321-notes.viewer-handoff.md` (live wire);
  the deferred mmap design lives at `user/reference/322-reference.shared-memory-wire-contract.md`
- Coordinated deploy: viewer slice merges first, viewer team signals readiness,
  producer fast-forwards `9e7526d` to main in the same window
- Next planned slice: TBD (post-deploy)

---

## Tasks

### Branch setup

- [ ] **T1 — Create slice branch from main**
  - [ ] Verify clean working tree: `git status` shows no uncommitted changes
  - [ ] Verify on `main`: `git branch --show-current` outputs `main`
  - [ ] Create branch: `git checkout -b 115-slice.wire-header-alignment-and-zero-copy-deserialization`
  - [ ] Success: branch created, working tree clean, `git status` confirms branch

### Protocol constants

- [ ] **T2 — Add `WIRE_SCHEMA_VERSION` to `protocol/types.ts`**
  - [ ] Add `export const WIRE_SCHEMA_VERSION = 2 as const;` near the existing
    `MessageType` / `PositionDtype` constants
  - [ ] Add a comment clarifying this is the wire-protocol schema version
    (distinct from the mmap region's schema version, which lives in slice 322
    and is not consumed by the browser viewer)
  - [ ] Success: constant exported; no raw `2` literal expected anywhere in
    parser branches in subsequent tasks

- [ ] **T3 — Test the constant is exported and importable**
  - [ ] In `src/protocol/types.test.ts`, add a one-line assertion: `expect(WIRE_SCHEMA_VERSION).toBe(2)`
  - [ ] Success: test passes; import resolves

### STATE_UPDATE parser — header realignment + zero-copy

- [ ] **T4 — Update `STATE_UPDATE_HEADER_BYTES` and `parseStateUpdate` header reads**
  - [ ] In `src/protocol/deserialize.ts`, change `STATE_UPDATE_HEADER_BYTES` from `10` to `16`
  - [ ] After the existing `dtype = readU8(view, 9)` read, add `const schemaVersion = readU8(view, 10)`
  - [ ] Validate: if `schemaVersion !== WIRE_SCHEMA_VERSION`, `console.warn(\`[protocol] state update unsupported schema version: 0x\${schemaVersion.toString(16).padStart(2, '0')}\`)` and `return null`
  - [ ] Reserved bytes 11–15 are not read; do not add validation for them
  - [ ] Success: parser still compiles; `pnpm tsc --noEmit` clean

- [ ] **T5 — Replace `buffer.slice()` with views in `parseStateUpdate`**
  - [ ] Compute `componentCount = entityCount * 2` once (positions and velocities have the same component count)
  - [ ] `posOffset = STATE_UPDATE_HEADER_BYTES` (now 16, satisfies 4- and 8-byte alignment)
  - [ ] `velOffset = posOffset + componentCount * (dtype === PositionDtype.F32 ? 4 : 8)`
  - [ ] Replace the existing slice-based construction with view construction:
    - `positions = dtype === PositionDtype.F32 ? new Float32Array(buffer, posOffset, componentCount) : new Float64Array(buffer, posOffset, componentCount)`
    - `velocities = dtype === PositionDtype.F32 ? new Float32Array(buffer, velOffset, componentCount) : new Float64Array(buffer, velOffset, componentCount)`
  - [ ] Verify no `buffer.slice(...)` calls remain anywhere in `parseStateUpdate`
  - [ ] Add a brief comment above the view construction explaining that the
    returned typed arrays alias the WebSocket message buffer and must be
    copied (via `applyStateUpdate`'s existing `.set()`) before the next
    `onmessage` fires
  - [ ] Success: `pnpm tsc --noEmit` clean; no slice() calls remain in the function

- [ ] **T6 — Update `buildStateUpdate` test fixture for the 16-byte header**
  - [ ] In `src/protocol/deserialize.test.ts`, update the `buildStateUpdate`
    helper to:
    - Default `schemaVersion` parameter to `2` (allow override for negative tests)
    - Write `dtype` at offset 9 (unchanged), `schemaVersion` at offset 10
    - Leave bytes 11–15 zero (default `ArrayBuffer` initialization)
    - Start payload at offset 16 (was 10)
    - Compute `totalBytes = 16 + entityCount * perEntityBytes`
  - [ ] Update existing STATE_UPDATE tests in this file to remain green —
    they should require no logic change since they call the helper, not raw
    bytes; only the helper's internal layout shifts
  - [ ] Success: existing STATE_UPDATE tests pass under the new header layout

- [ ] **T7 — Test STATE_UPDATE zero-copy buffer-identity (f32 and f64)**
  - [ ] In `deserialize.test.ts`, add a test: build a 4-entity f32 state update
    via `buildStateUpdate`, parse it, assert:
    - `parsed.positions instanceof Float32Array`
    - `parsed.positions.buffer === <the buffer returned by buildStateUpdate>`
    - `parsed.positions.byteOffset === 16`
    - `parsed.positions.length === 8` (4 entities × 2 components)
    - Values round-trip correctly
  - [ ] Add a parallel test for f64 with the same assertions (`Float64Array`,
    `byteOffset === 16`)
  - [ ] Success: both tests pass

- [ ] **T8 — Test STATE_UPDATE schema version rejection**
  - [ ] Add tests: build a state update with `schemaVersion = 1`, assert
    `parseMessage` returns `null` and a console warning was emitted
    (use `vi.spyOn(console, 'warn')`)
  - [ ] Add a parallel test for `schemaVersion = 3`
  - [ ] Add a test: build a state update with reserved bytes 11–15 set to
    non-zero values; assert parsing succeeds (forward-compat — parser must
    not validate reserved bytes)
  - [ ] Success: all three tests pass

- [ ] **T9 — Commit: STATE_UPDATE parser zero-copy + version check**
  - [ ] `git add src/protocol/types.ts src/protocol/types.test.ts src/protocol/deserialize.ts src/protocol/deserialize.test.ts`
  - [ ] Commit: `feat(protocol): align STATE_UPDATE to 16-byte header, zero-copy views, schema_version=2`
  - [ ] Success: `pnpm test` green after commit; working tree clean

### SNAPSHOT parser — header realignment + zero-copy

- [ ] **T10 — Update `SNAPSHOT_HEADER_BYTES` and `parseSnapshot` header reads**
  - [ ] In `src/protocol/deserialize.ts`, change `SNAPSHOT_HEADER_BYTES` from `26` to `32`
  - [ ] After the existing `dtype = readU8(view, 25)` read, add `const schemaVersion = readU8(view, 26)`
  - [ ] Validate: if `schemaVersion !== WIRE_SCHEMA_VERSION`, `console.warn(\`[protocol] snapshot unsupported schema version: 0x\${schemaVersion.toString(16).padStart(2, '0')}\`)` and `return null`
  - [ ] Reserved bytes 27–31 are not read; do not add validation for them
  - [ ] Success: parser compiles; `pnpm tsc --noEmit` clean

- [ ] **T11 — Replace `buffer.slice()` with views in `parseSnapshot`**
  - [ ] `posOffset = SNAPSHOT_HEADER_BYTES` (now 32, 16-byte aligned)
  - [ ] `componentCount = entityCount * 2`
  - [ ] `velOffset = posOffset + componentCount * (dtype === PositionDtype.F32 ? 4 : 8)`
  - [ ] `idxOffset = velOffset + componentCount * (dtype === PositionDtype.F32 ? 4 : 8)`
  - [ ] Replace existing slice-based constructions with view constructions for
    `positions`, `velocities`, and `profileIndices` (Int32Array; offset 32 +
    body content is automatically 4-byte aligned because `entityCount`,
    `componentCount`, and dtype-byte-widths produce a multiple of 4)
  - [ ] Verify no `buffer.slice(...)` calls remain anywhere in `parseSnapshot`
  - [ ] Add a brief comment explaining that the returned typed arrays alias
    the wire buffer and that `applySnapshot` is responsible for detaching
    via `.slice()`
  - [ ] Success: `pnpm tsc --noEmit` clean; no slice() calls remain in the function

- [ ] **T12 — Update `buildSnapshot` test fixture for the 32-byte header**
  - [ ] In `src/protocol/deserialize.test.ts`, update the `buildSnapshot`
    helper to:
    - Default `schemaVersion` parameter to `2` (allow override for negative tests)
    - Write `dtype` at offset 25 (unchanged), `schemaVersion` at offset 26
    - Leave bytes 27–31 zero (default `ArrayBuffer` initialization)
    - Start payload at offset 32 (was 26)
    - Compute `totalBytes = 32 + entityCount * (posVelBytesPerEntity + 4)`
  - [ ] Existing SNAPSHOT tests should remain green (they call the helper,
    not raw bytes)
  - [ ] Success: all existing SNAPSHOT tests pass under the new header

- [ ] **T13 — Test SNAPSHOT zero-copy buffer-identity (f32 and f64)**
  - [ ] In `deserialize.test.ts`, add a test: build a 4-entity f32 snapshot,
    parse it, assert:
    - `parsed.positions instanceof Float32Array`
    - `parsed.positions.buffer === <the buffer returned by buildSnapshot>`
    - `parsed.positions.byteOffset === 32`
    - `parsed.profileIndices instanceof Int32Array`
    - `parsed.profileIndices.buffer === <buffer>`
    - Values round-trip correctly
  - [ ] Add a parallel f64 test (`Float64Array`, `byteOffset === 32`)
  - [ ] Success: both tests pass

- [ ] **T14 — Test SNAPSHOT schema version rejection and reserved-byte tolerance**
  - [ ] Add tests: build a snapshot with `schemaVersion = 1`, assert null + warn
  - [ ] Add a parallel test for `schemaVersion = 3`
  - [ ] Add a test: build a snapshot with reserved bytes 27–31 set to non-zero
    values; assert parsing succeeds (forward-compat)
  - [ ] Success: all three tests pass

- [ ] **T15 — Commit: SNAPSHOT parser zero-copy + version check**
  - [ ] `git add src/protocol/deserialize.ts src/protocol/deserialize.test.ts`
  - [ ] Commit: `feat(protocol): align SNAPSHOT to 32-byte header, zero-copy views, schema_version=2`
  - [ ] Success: `pnpm test` green after commit; working tree clean

### State layer — `applySnapshot` detach

- [ ] **T16 — Update `applySnapshot` in `src/state.ts` to detach from wire buffer**
  - [ ] Locate `applySnapshot` (currently assigns `state.positions = parsed.positions` directly — this was safe when the parser called `buffer.slice()`, but is now a use-after-free hazard because parsed views alias the wire buffer)
  - [ ] Change the three direct assignments to use `.slice()` on the typed arrays:
    - `state.positions = parsed.positions.slice()`
    - `state.velocities = parsed.velocities.slice()`
    - `state.profileIndices = parsed.profileIndices.slice()`
  - [ ] Note: `.slice()` on a typed-array view returns a new typed array of
    the same kind (Float32Array → Float32Array, Float64Array → Float64Array,
    Int32Array → Int32Array), each backed by its own freshly allocated
    `ArrayBuffer` — exactly the detach we need
  - [ ] `applyStateUpdate` is unchanged: it already calls `.set()` to copy
    into the persistent `state.positions` buffer, which detaches from the
    wire buffer naturally
  - [ ] Success: `src/state.ts` compiles with no type errors

- [ ] **T17 — Test `applySnapshot` detaches from the wire buffer**
  - [ ] In `src/state.test.ts` (or the appropriate existing state test file),
    add a test:
    - Build a snapshot buffer via the test helper
    - Call `parseMessage` to get the parsed snapshot
    - Confirm `parsed.positions.buffer === <wire buffer>` (sanity: zero-copy is in effect)
    - Call `applySnapshot(state, parsed)`
    - Mutate the wire buffer's first position byte (e.g., `new Uint8Array(wireBuffer)[32] = 0xFF`)
    - Assert `state.positions[0]` is unchanged from the parsed value (proves detach)
    - Assert `state.positions.buffer !== wireBuffer` (proves separate ownership)
  - [ ] Success: test passes; mutation of the wire buffer does not affect state

- [ ] **T18 — Full typecheck and test pass**
  - [ ] Run `pnpm tsc --noEmit` — expect zero errors
  - [ ] Run `pnpm test` — expect all tests pass (134 baseline + ~10 new tests
    from T3, T7, T8, T13, T14, T17)
  - [ ] Success: both commands exit cleanly

- [ ] **T19 — Commit: state-layer detach fix**
  - [ ] `git add src/state.ts src/state.test.ts` (or whichever file holds the new T17 test)
  - [ ] Commit: `fix(state): detach applySnapshot buffers from wire ArrayBuffer (zero-copy safety)`
  - [ ] Success: commit created; working tree clean

### Smoke testing

- [ ] **T20 — Manual smoke test against v2-emitting server**
  - [ ] Coordinate with producer team: have them run a server built from
    commit `9e7526d` on branch `321-slice.shared-memory-state-transport`
  - [ ] Run `pnpm dev`; open viewer in a browser; connect to that server
  - [ ] Confirm: HUD tick counter advances normally
  - [ ] Confirm: entities render at correct positions on the terrain (no
    garbled / drifting positions, which would indicate offset misalignment)
  - [ ] Confirm: browser console shows zero `[protocol]` warnings during
    steady-state operation
  - [ ] Open Chrome DevTools → Memory → Performance recording for ~5 seconds;
    confirm per-tick allocation rate is materially lower than the pre-slice
    baseline (no per-tick `ArrayBuffer.slice()` allocations of
    `entityCount × 16` bytes)
  - [ ] Success: viewer renders correctly; HUD steady; no protocol warnings;
    allocation rate dropped

- [ ] **T21 — Smoke-test entity count scale (10k–100k)**
  - [ ] Reconnect to the v2 server with `entity_count` configured high
    (10k, then 50k, then 100k if server supports it)
  - [ ] Confirm at each entity count: viewer renders, HUD tick counter
    advances, no console warnings
  - [ ] At 100k entities, confirm via DevTools Performance that the per-tick
    parse path shows no `buffer.slice()` allocations from `parseStateUpdate`
    (the only remaining per-tick copy is `applyStateUpdate`'s `.set()`, which
    is unchanged by this slice; parser allocations should be effectively zero)
  - [ ] Success: viewer remains stable across entity counts; per-tick parser
    allocation churn is materially reduced vs. pre-slice baseline

### Wrap-up

- [ ] **T22 — Open PR and signal readiness to producer team**
  - [ ] Push branch: `git push -u origin 115-slice.wire-header-alignment-and-zero-copy-deserialization`
  - [ ] Open PR titled: `feat: slice 115 — wire header alignment + zero-copy deserialization`
  - [ ] In the PR description, link the slice design and reference
    `321-notes.viewer-handoff.md`; include the producer-side commit `9e7526d`
    and note the deploy must be coordinated (no compatibility window)
  - [ ] After merge to viewer `main`: notify producer team they may
    fast-forward `9e7526d` to producer `main`
  - [ ] Success: PR open with full context; producer team has the readiness signal
