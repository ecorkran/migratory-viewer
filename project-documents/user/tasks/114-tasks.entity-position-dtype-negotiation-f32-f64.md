---
docType: tasks
slice: entity-position-dtype-negotiation-f32-f64
project: migratory-viewer
lld: user/slices/114-slice.entity-position-dtype-negotiation-f32-f64.md
dependencies: [101-slice.websocket-consumer-and-live-entity-rendering]
projectState: >
  Slices 100–102, 104–105, 108, 110–112 complete. Branch main, clean tree.
  Server has already deployed the dtype flag byte into SNAPSHOT and STATE_UPDATE.
  Viewer currently misinterprets f32 payloads as f64 — slice 114 fixes this.
dateCreated: 20260506
dateUpdated: 20260506
status: in_progress
---

## Context Summary

- Working on slice 114: entity position dtype negotiation (f32/f64)
- Server inserts a `u8` dtype flag into SNAPSHOT (offset 25) and STATE_UPDATE (offset 9); all payload bytes shift by 1
- `PositionDtype.F64 = 0x00`, `PositionDtype.F32 = 0x01` (confirmed against server `protocol.py:60-67`)
- f32 payload is 16 bytes/entity (pos+vel); f64 is 32 bytes/entity
- Profile indices in SNAPSHOT remain `Int32Array`, unaffected by dtype
- Union type `Float32Array | Float64Array` propagates through `ParsedSnapshot`, `ParsedStateUpdate`, `ViewerState`, `state.ts`, `rendering/entities.ts`
- Unknown dtype → `console.warn` + return `null` (tier-1, no disconnect)
- Slice 113 (zero-copy / render-skip) depends on this union type being in place; no further type changes needed after this slice
- Next planned slice: 113 (entity pipeline performance)

---

## Tasks

- [x] **T1 — Add `PositionDtype` constant to `protocol/types.ts`**
  - [ ] Add `export const PositionDtype = { F64: 0x00, F32: 0x01 } as const` after the `TerrainDtype` block
  - [ ] Add `export type PositionDtypeValue = (typeof PositionDtype)[keyof typeof PositionDtype]`
  - [ ] Success: `PositionDtype.F64 === 0` and `PositionDtype.F32 === 1`; no raw `0x00`/`0x01` hex literals for dtype anywhere outside this definition

- [x] **T2 — Widen `ParsedSnapshot` and `ParsedStateUpdate` interface fields**
  - [ ] In `protocol/types.ts`, change `ParsedSnapshot.positions` and `.velocities` from `Float64Array` to `Float32Array | Float64Array`
  - [ ] Change `ParsedStateUpdate.positions` and `.velocities` from `Float64Array` to `Float32Array | Float64Array`
  - [ ] Success: TypeScript compiler now flags any downstream code that assumes `Float64Array` (use these errors as a change checklist in subsequent tasks)

- [x] **T3 — Update `parseSnapshot` in `protocol/deserialize.ts`**
  - [ ] Rename `SNAPSHOT_HEADER_BYTES` from `25` to `26`
  - [ ] Replace `SNAPSHOT_PER_ENTITY_BYTES` (36) with two constants: `SNAPSHOT_PER_ENTITY_BYTES_F64 = 36` and `SNAPSHOT_PER_ENTITY_BYTES_F32 = 20`
  - [ ] Read dtype flag: `const dtype = readU8(view, 25)` (after `entityCount` at offset 21)
  - [ ] Validate dtype: if not a known `PositionDtype` value, `console.warn('[protocol] unknown position dtype: 0x...')` and `return null`
  - [ ] Compute `perEntityBytes` from dtype; compute `expectedBytes = 26 + entityCount * (perEntityBytes + 4)` (the `+4` is profile indices)
  - [ ] Update `posOffset = 26`, `velOffset = posOffset + entityCount * (perEntityBytes / 2)` (half of perEntityBytes is pos, half is vel — each is 2 components × element width)
  - [ ] Branch on dtype: construct `Float32Array` (f32) or `Float64Array` (f64) for positions and velocities via `buffer.slice()`
  - [ ] `idxOffset` shifts accordingly; `profileIndices` construction is unchanged (`Int32Array`)
  - [ ] Success: function compiles with no type errors; existing f64 callers unaffected at runtime

- [x] **T4 — Test `parseSnapshot` f64 path**
  - [ ] In the existing snapshot test file, update any hardcoded buffer size or offset expectations to match the new 26-byte header
  - [ ] Confirm the f64 round-trip: add or update an assertion that `positions` is `instanceof Float64Array` and values match the fixture (f64 path explicitly exercised)
  - [ ] Confirm existing f64 snapshot tests pass: `pnpm test --reporter=verbose` shows all snapshot tests green
  - [ ] Success: f64 parse path explicitly asserted; all previously passing snapshot tests still pass

- [x] **T5 — Test `parseSnapshot` f32 path and unknown dtype**
  - [ ] Add a test: build a minimal SNAPSHOT buffer with dtype byte `0x01` (F32), 2 entities, correct f32 payload; assert `positions` is `instanceof Float32Array` and values match
  - [ ] Add a test: build a SNAPSHOT buffer with dtype byte `0xFF`; assert return value is `null` and a console warning is emitted
  - [ ] Success: both new tests pass; `pnpm test` remains fully green

- [x] **T6 — Update `parseStateUpdate` in `protocol/deserialize.ts`**
  - [ ] Rename `STATE_UPDATE_HEADER_BYTES` from `9` to `10`
  - [ ] Replace `STATE_UPDATE_PER_ENTITY_BYTES` (32) with `STATE_UPDATE_PER_ENTITY_BYTES_F64 = 32` and `STATE_UPDATE_PER_ENTITY_BYTES_F32 = 16`
  - [ ] Read dtype flag: `const dtype = readU8(view, 9)` (after `entityCount` at offset 5)
  - [ ] Validate dtype: same warn-and-null pattern as T3
  - [ ] Compute `expectedBytes = 10 + entityCount * perEntityBytes`
  - [ ] Update `posOffset = 10`; `velOffset = posOffset + entityCount * (perEntityBytes / 2)`
  - [ ] Branch on dtype to construct `Float32Array` or `Float64Array`
  - [ ] Success: function compiles; existing f64 state update callers unaffected at runtime

- [x] **T7 — Test `parseStateUpdate` f64 path**
  - [ ] Update existing f64 state update tests to match the new 10-byte header (buffer sizes, offset expectations)
  - [ ] Confirm the f64 round-trip: add or update an assertion that `positions` is `instanceof Float64Array` and values match the fixture (f64 path explicitly exercised)
  - [ ] Confirm all existing state update tests pass: `pnpm test` green
  - [ ] Success: f64 parse path explicitly asserted; no previously passing state update test is broken

- [x] **T8 — Test `parseStateUpdate` f32 path and unknown dtype**
  - [ ] Add a test: build a minimal STATE_UPDATE buffer with dtype `0x01` (F32), 2 entities, correct f32 payload; assert `positions` is `instanceof Float32Array` and values match
  - [ ] Add a test: dtype byte `0xFF` → return `null` + console warning
  - [ ] Success: both new tests pass; `pnpm test` fully green

- [x] **T9 — Commit: protocol layer complete**
  - [ ] `git add src/protocol/types.ts src/protocol/deserialize.ts` and any updated test files
  - [ ] Commit: `feat: add PositionDtype and f32/f64 branching to deserializer`
  - [ ] Success: commit created; `pnpm test` still green after commit

- [x] **T10 — Widen `ViewerState` in `src/types.ts`**
  - [ ] Change `positions: Float64Array | null` → `Float32Array | Float64Array | null`
  - [ ] Change `velocities: Float64Array | null` → `Float32Array | Float64Array | null`
  - [ ] `createInitialViewerState` initializes both to `null` — no change needed
  - [ ] Success: `src/types.ts` compiles; TypeScript now flags any code outside this file that assumed `Float64Array` on these fields

- [x] **T11 — Update `applyStateUpdate` in `src/state.ts`**
  - [ ] Widen the function signature / internal references to accept `Float32Array | Float64Array` where positions/velocities are used
  - [ ] Replace the `state.positions.set(parsed.positions)` call with dtype-aware logic per the slice design:
    - If `state.positions` constructor matches `parsed.positions` constructor AND lengths match: use `.set()` as today
    - If lengths match but constructors differ (dtype switch): reassign `state.positions = parsed.positions` and `state.velocities = parsed.velocities`; log `[state] position dtype changed mid-connection — replacing buffers`
    - If lengths differ: existing warn-and-return path is unchanged
  - [ ] `applySnapshot` already replaces fields directly — only needs type annotation update, no logic change
  - [ ] Success: `src/state.ts` compiles with no type errors or casts

- [x] **T12 — Test `applyStateUpdate` dtype-switch path**
  - [ ] Add a test: apply a f64 snapshot to establish `state.positions` as `Float64Array`, then apply a f32 state update; assert `state.positions` is now `instanceof Float32Array` and holds correct values
  - [ ] Add a test: same dtype on both snapshot and update — confirms normal `.set()` path still works
  - [ ] Success: both tests pass; `pnpm test` fully green

- [x] **T13 — Widen types in `src/rendering/entities.ts`**
  - [ ] In `updateEntities`, the `positions` and `velocities` fields come from `ViewerState` — updating `ViewerState` (T10) will surface any type error here automatically
  - [ ] Fix any TypeScript errors reported by the compiler (expected: parameter or local variable annotations referencing `Float64Array` explicitly)
  - [ ] Confirm no logic changes are needed — numeric index access works identically for both typed array types
  - [ ] Success: `src/rendering/entities.ts` compiles with no type errors; no `as` casts introduced

- [x] **T14 — Full typecheck and test pass**
  - [ ] Run `pnpm tsc --noEmit` — zero errors
  - [ ] Run `pnpm test` — all 121+ tests pass (121 pre-existing + at least 6 new tests from T5, T8, T12)
  - [ ] Success: both commands exit cleanly

- [x] **T15 — Commit: state and rendering layer complete**
  - [ ] `git add src/types.ts src/state.ts src/rendering/entities.ts` and any updated test files
  - [ ] Commit: `feat: propagate Float32Array | Float64Array union through ViewerState and state layer`
  - [ ] Success: commit created; working tree clean

- [ ] **T16 — Manual smoke test (f32 server)**
  - [ ] Start the migratory server with `agent_wire_dtype = "f32"` in config
  - [ ] Run `pnpm dev` and open the viewer in a browser
  - [ ] Confirm entities render at correct positions with no console warnings about dtype
  - [ ] Open Chrome DevTools → Network → WS; confirm STATE_UPDATE frames are ~156 KB at 10k entities (half the f64 size)
  - [ ] Success: viewer renders correctly under f32; no errors in console

- [ ] **T17 — Manual smoke test (f64 server, backward compatibility)**
  - [ ] Connect viewer to a server sending f64 (default or explicitly configured)
  - [ ] Confirm entities render at correct positions (visually match expected world layout); no JS errors or console warnings in DevTools
  - [ ] Confirm STATE_UPDATE frames in DevTools Network → WS are ~312 KB at 10k entities (f64 size, unchanged from pre-slice)
  - [ ] Confirm tick rate and frame rate counters in the HUD are stable (no dropped ticks or frame stutters vs. pre-slice baseline)
  - [ ] Success: f64 path renders correctly; frame sizes, entity positions, and HUD counters all consistent with pre-slice behavior
