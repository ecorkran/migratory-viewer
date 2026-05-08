---
docType: slice-design
slice: wire-header-alignment-and-zero-copy-deserialization
project: migratory-viewer
parent: user/architecture/100-slices.viewer-foundation.md
dependencies:
  - 113-slice.entity-pipeline-performance
  - 114-slice.entity-position-dtype-negotiation-f32-f64
interfaces: []
dateCreated: 20260507
dateUpdated: 20260508
status: complete
effort: 2
---

# Slice Design: Wire Header Alignment and Zero-Copy Deserialization

## Overview

Migratory slice 321 (Wire-Format Alignment) introduces a breaking wire-format change.
The producer pads the `STATE_UPDATE` header to 16 bytes and the `SNAPSHOT` header to
32 bytes, and stamps `schema_version = 2` at offset 10 (STATE_UPDATE) and offset 26
(SNAPSHOT). Once positions begin at a 16-byte-aligned offset, the viewer can construct
`Float32Array` / `Float64Array` views directly over the incoming WebSocket `ArrayBuffer`
— the zero-copy deserialization path that was attempted and reverted in slice 113
because the old 10-byte header violated `Float32Array`'s 4-byte and `Float64Array`'s
8-byte offset requirements.

The producer-side change has shipped on branch `321-slice.shared-memory-state-transport`
(commit `9e7526d`) and is staged awaiting the viewer push; there is no compatibility
window. This slice is the viewer half of that coordinated deploy.

The mmap region, `TICK_AVAILABLE`, and `SERVER_HELLO` / `CLIENT_HELLO` portions of the
original combined design have been split out to migratory slice 322 and deferred
indefinitely — the browser viewer cannot consume them. References:
`user/reference/321-notes.viewer-handoff.md` (the producer team's authoritative handoff
for the *live* wire change) and `user/reference/322-reference.shared-memory-wire-contract.md`
(the deferred mmap design-of-record).

## Value

**Eliminates per-tick allocation churn.** The current `parseStateUpdate` calls
`buffer.slice()` twice (positions, velocities), each producing a fresh `ArrayBuffer`
and discarding the original on the next tick. At 100k entities f32 that is roughly
1.6 MB of short-lived allocation per tick; at 60 tps this is ~96 MB/s of GC pressure
in the hot path. Wrapping a typed-array view directly into the incoming buffer
removes both `.slice()` calls and the implied copy.

**Unblocks slice 113's third optimization.** T11/T12/T13 from slice 113 were marked
done in scope but reverted at implementation time because `new Float32Array(buf, 10, n)`
throws `RangeError` (10 % 4 ≠ 0). Slice 115 makes that constructor legal by virtue of
the new alignment.

**Keeps the viewer current with the wire contract.** Without this slice, when the
server ships `schema_version = 2`, the viewer mis-parses every message — header offsets
shift, `entityCount` reads from the wrong bytes, every frame is rejected for length
mismatch.

## Technical Scope

**Included:**

- `STATE_UPDATE_HEADER_BYTES = 16` and `SNAPSHOT_HEADER_BYTES = 32` — fixed constants
  per the slice 321 viewer handoff.
- `WIRE_SCHEMA_VERSION` constant in `protocol/types.ts`; strict check rejecting
  anything ≠ 2 in both `parseSnapshot` and `parseStateUpdate` (`console.warn` +
  return `null`, same tier-1 path used for unknown dtype).
- Zero-copy view construction in both parsers: replace
  `new TypedArray(buffer.slice(off, off+len))` with `new TypedArray(buffer, off, count)`.
- Test fixtures regenerated for the new header layout (the existing `buildSnapshot` /
  `buildStateUpdate` helpers in `protocol/deserialize.test.ts` are updated in place).
- New tests:
  - Round-trip f32 and f64 STATE_UPDATE / SNAPSHOT under the new layout.
  - Reject `schema_version != 2` (returns null, warns).
  - Buffer-identity assertion for STATE_UPDATE: `parsed.positions.buffer === incomingBuffer`.

**Excluded:**

- Shared-memory region, `mmap`, double-buffering, commit-marker reads — browser
  cannot mmap external files; permanently out of scope.
- `TICK_AVAILABLE` (0x07), `SERVER_HELLO` (0x08), `CLIENT_HELLO` (0x09) — these only
  matter for the shared-memory fast path.
- Any change to TERRAIN (0x03) / TERRAIN_HEADER (0x05) / TERRAIN_CHUNK (0x04) wire
  formats. Slice 321 does not touch them.
- Any negotiation handshake. The viewer remains a passive reader: read `schema_version`
  off the wire, accept or reject.
- Connection-level behavior changes. The existing tier-1 path (parser returns null →
  assembler returns `pending` → message dropped) is retained.

## Dependencies

### Prerequisites

- **Slice 113** — established the deserializer patterns this slice modifies; its
  reverted T11/T12/T13 zero-copy attempt is the work this slice completes.
- **Slice 114** — introduced `PositionDtype` and the dtype-flag byte at offset 9
  (STATE_UPDATE) / 25 (SNAPSHOT). The new header keeps that byte at the same offset
  and adds `schema_version` immediately after it.

### External

- **Migratory slice 321 (Wire-Format Alignment)** — producer-side header padding and
  `schema_version = 2` stamping. Shipped as commit `9e7526d` on branch
  `321-slice.shared-memory-state-transport`, staged awaiting viewer readiness. The
  mmap/TICK_AVAILABLE/HELLO portions of the original combined design have been split
  out to slice 322 and deferred indefinitely. References:
  `project-documents/user/reference/321-notes.viewer-handoff.md` (live wire change,
  authoritative) and `project-documents/user/reference/322-reference.shared-memory-wire-contract.md`
  (deferred mmap design-of-record).

## Architecture

### Wire Format — STATE_UPDATE (0x02), 16-byte header

| Offset | Size | Type | Field          | Notes                                  |
|--------|------|------|----------------|----------------------------------------|
| 0      | 1    | u8   | message_type   | `0x02`                                 |
| 1      | 4    | u32  | tick_number    | LE                                     |
| 5      | 4    | u32  | entity_count   | LE                                     |
| 9      | 1    | u8   | position_dtype | `0x00`=F64, `0x01`=F32 (slice 114)     |
| 10     | 1    | u8   | schema_version | `2`                                    |
| 11     | 5    | u8×5 | reserved       | zero-filled (parser does not validate) |
| 16     | …    | —    | positions      | `entity_count × 2 × dtypeBytes`        |
| 16+P   | …    | —    | velocities     | `entity_count × 2 × dtypeBytes`        |

Where `dtypeBytes = 4` (F32) or `8` (F64) and `P = entity_count × 2 × dtypeBytes`.

Note offset 16 is divisible by both 4 and 8 — the precondition for zero-copy view
construction across both supported dtypes.

### Wire Format — SNAPSHOT (0x01), 32-byte header

| Offset | Size | Type | Field           | Notes                                          |
|--------|------|------|-----------------|------------------------------------------------|
| 0      | 1    | u8   | message_type    | `0x01`                                         |
| 1      | 4    | u32  | tick_number     | LE                                             |
| 5      | 8    | f64  | world_width     | LE — unchanged from v1                         |
| 13     | 8    | f64  | world_height    | LE — unchanged from v1                         |
| 21     | 4    | u32  | entity_count    | LE                                             |
| 25     | 1    | u8   | position_dtype  | dtype byte from slice 114 (offset preserved)   |
| 26     | 1    | u8   | schema_version  | `2`                                            |
| 27     | 5    | u8×5 | reserved        | zero-filled, pads to next 16-byte boundary     |
| 32     | …    | —    | positions       | `entity_count × 2 × dtypeBytes` (body starts)  |
| …      | …    | —    | velocities      | `entity_count × 2 × dtypeBytes`                |
| …      | …    | —    | profile_indices | `entity_count × 4`                             |

Body layout (positions / velocities / profile_indices) is byte-identical to v1; only
the header changed. `schema_version` lives at a different offset than in STATE_UPDATE
(26 vs. 10) because SNAPSHOT inherits two f64 fields that occupy bytes 5–20 — there
is no offset 10 to put it at without moving an existing field. This was confirmed by
the producer team in the slice 321 viewer handoff.

### Wire Format — fields the viewer ignores

The 5 reserved bytes in STATE_UPDATE (offsets 11–15) and the 5 reserved bytes in
SNAPSHOT (offsets 27–31) are read past, not validated. They are zero in v2; a future
schema bump may use them. This keeps forward compatibility — a future additive change
can land in those bytes without forcing another header realignment.

### Component Changes

#### `src/protocol/types.ts`

Add the wire schema-version constant (decoupled from the mmap region's schema, per
321's "the two versions are independent" note):

```typescript
/** Migratory wire-protocol schema version. Bumped to 2 by slice 321. */
export const WIRE_SCHEMA_VERSION = 2 as const;
```

No change to `PositionDtype`, `MessageType`, or the `ParsedSnapshot` /
`ParsedStateUpdate` interfaces.

#### `src/protocol/deserialize.ts`

Header constants:

| Symbol                            | Old | New  |
|-----------------------------------|-----|------|
| `STATE_UPDATE_HEADER_BYTES`       | 10  | 16   |
| `SNAPSHOT_HEADER_BYTES`           | 26  | 32   |
| `STATE_UPDATE_PER_ENTITY_BYTES_*` | (unchanged) | (unchanged) |
| `SNAPSHOT_PER_ENTITY_BYTES_*`     | (unchanged) | (unchanged) |

`parseStateUpdate` (replacement logic):

```
1. Buffer length >= STATE_UPDATE_HEADER_BYTES (16)? Else null.
2. Read tick (offset 1, u32 LE).
3. Read entityCount (offset 5, u32 LE).
4. Read dtype (offset 9, u8). Validate against PositionDtype.
5. Read schemaVersion (offset 10, u8). Validate === WIRE_SCHEMA_VERSION (2).
   On mismatch: console.warn + return null. (No connection close — tier-1.)
6. Reject entityCount > config.maxEntityCount.
7. expectedBytes = STATE_UPDATE_HEADER_BYTES + entityCount * perEntityBytes(dtype).
   Reject mismatched length (existing path).
8. posOffset = STATE_UPDATE_HEADER_BYTES (16). componentCount = entityCount * 2.
9. positions = dtype === F32
     ? new Float32Array(buffer, posOffset, componentCount)
     : new Float64Array(buffer, posOffset, componentCount);
   velocities = (same pattern at velOffset = posOffset + componentCount * dtypeBytes).
10. Return ParsedStateUpdate (positions/velocities are now views over `buffer`).
```

Critical: **no `buffer.slice()` calls** in `parseStateUpdate`. The returned views
alias the WebSocket message buffer. The state layer (`applyStateUpdate` in `state.ts`)
already calls `state.positions.set(parsed.positions)` to copy into a persistent
buffer before the next message arrives, so the alias does not leak past the
event-handler invocation. (This contract was established in slice 113 and is
unchanged here.)

`parseSnapshot` (replacement logic):

```
1. Buffer length >= SNAPSHOT_HEADER_BYTES (32)? Else null.
2. Read tick, worldWidth, worldHeight, entityCount, dtype (offsets 1, 5, 13, 21, 25).
3. Read schemaVersion (offset 26, u8). Validate === WIRE_SCHEMA_VERSION (2).
   On mismatch: console.warn + return null.
4. Reject entityCount > config.maxEntityCount.
5. expectedBytes = SNAPSHOT_HEADER_BYTES + entityCount * perEntityBytes(dtype).
   Reject mismatched length.
6. posOffset = SNAPSHOT_HEADER_BYTES (32).
   velOffset = posOffset + componentCount * dtypeBytes.
   idxOffset = velOffset + componentCount * dtypeBytes.
7. Construct typed-array views over buffer (zero-copy, like STATE_UPDATE).
   profileIndices = new Int32Array(buffer, idxOffset, entityCount).
8. Return ParsedSnapshot.
```

For SNAPSHOT, `applySnapshot` in `state.ts` already replaces `state.positions` and
`state.velocities` with the parsed arrays directly (see slice 114 design). With
zero-copy views, `state.positions` would alias the WebSocket buffer, which is unsafe
across ticks. **The fix:** `applySnapshot` copies into newly allocated persistent
buffers (existing behavior was a direct assignment that worked because
`buffer.slice()` had already detached the bytes). With zero-copy, `applySnapshot`
must change to:

```typescript
state.positions = parsed.positions.slice();
state.velocities = parsed.velocities.slice();
state.profileIndices = parsed.profileIndices.slice();
```

`.slice()` on a typed-array view returns a new typed array of the same kind backed
by its own `ArrayBuffer` — `Float32Array` → `Float32Array`, `Float64Array` →
`Float64Array`, `Int32Array` → `Int32Array`. This is exactly the detach we need,
and it preserves the runtime dtype without an explicit branch on `PositionDtype`.
This is one allocation per snapshot — snapshots are infrequent, so the cost is
negligible, and detaching from the WebSocket buffer is required for correctness.

`applyStateUpdate` is unchanged: it already copies via `.set()` into the persistent
state buffer (the path that's been correct since slice 113).

#### `src/state.ts` — `applySnapshot` correctness fix

| Today | After this slice |
|---|---|
| `state.positions = parsed.positions;` (safe because parser had `buffer.slice()`d) | `state.positions = parsed.positions.slice();` (copy because parser views into wire buffer) |

Same pattern for `velocities` and `profileIndices`:

```typescript
state.positions = parsed.positions.slice();
state.velocities = parsed.velocities.slice();
state.profileIndices = parsed.profileIndices.slice();
```

`.slice()` on a typed-array view returns a new typed array of the same kind backed by
its own `ArrayBuffer` — exactly the detach we need.

#### `src/protocol/deserialize.test.ts` — fixture builders

Update `buildStateUpdate` to emit the 16-byte header:

```typescript
function buildStateUpdate(
  tick: number,
  positions: number[],
  velocities: number[],
  dtype: number = PositionDtype.F64,
  schemaVersion: number = 2,
): ArrayBuffer {
  // ...
  view.setUint8(0, MessageType.STATE_UPDATE);
  view.setUint32(1, tick, true);
  view.setUint32(5, entityCount, true);
  view.setUint8(9, dtype);
  view.setUint8(10, schemaVersion);
  // bytes 11-15 stay zero (default ArrayBuffer init)
  let off = 16;
  // ... payload
}
```

Update `buildSnapshot` analogously: 32-byte header, dtype at offset 25,
schema_version at offset 26, reserved bytes 27–31 zero-filled, payload starts at
byte 32. Accept a `schemaVersion` override parameter (defaulting to 2) so the
negative-case tests can drive bad versions without rewriting the builder.

### Cross-Slice Effects

- **`net/connection.ts`**: no change. Parser returning null already maps to
  `assembler.feed → {kind: 'pending'}` which `handleMessage` drops silently.
- **`rendering/entities.ts`**: no change. It indexes into typed-array buffers; the
  buffer backing the array (alias vs. owned copy) is irrelevant to the renderer.
- **Slice 113's `entityHeights` bake**: no change. It reads from `state.positions`
  after `applyStateUpdate` has copied via `.set()` into the persistent buffer.

## Data Flow

```
WebSocket onmessage (event.data: ArrayBuffer) — owned by browser, valid until next onmessage
  → assembler.feed(buffer)
    → parseStateUpdate(buffer, view)
       - reads schema_version, dtype, etc.
       - constructs Float32Array/Float64Array VIEW into buffer at offset 16  [zero-copy]
       - returns { positions: view, velocities: view, ... }
  → applyStateUpdate(state, parsed)
       - state.positions.set(parsed.positions)  [single copy into persistent buffer]
  → state.entityHeights bake [slice 113, unchanged]

(parsed.positions reference is dropped after applyStateUpdate returns. The wire
buffer can now be safely overwritten by the next onmessage.)
```

For SNAPSHOT, the path is similar but `applySnapshot` allocates a new persistent
buffer via `parsed.positions.slice()` (one-time per entity-count change).

## Migration Plan

This is a coordinated wire-format change with the producer. The producer's update
ships as commit `9e7526d` on branch `321-slice.shared-memory-state-transport` and is
staged awaiting viewer readiness — per the slice 321 viewer handoff, "the producer
push and the viewer push should land together. There is no compatibility window."

There is no graceful coexistence: a v1 producer talking to a v2 viewer (or vice
versa) results in the parser rejecting every message (length mismatch or
schema_version mismatch). That's acceptable because:

1. The viewer is a single deployable; we ship the producer update and the viewer
   update together.
2. The CLOSE-on-mismatch behavior is implicit: every message is dropped, the user
   sees a stalled viewer in the HUD (no tick advancement), and reconnecting won't
   help. This is louder than a partial decode and is the desired failure mode.

**Deploy coordination:**
1. This slice is implemented and merged to viewer `main`.
2. Viewer team signals readiness; producer team fast-forwards `9e7526d` to its `main`.
3. Both deploys happen in the same window. Anyone running an older viewer against
   the updated server (or vice versa) sees a stalled HUD until they update.

## Success Criteria

### Functional Requirements

- `parseStateUpdate` and `parseSnapshot` parse messages with the new aligned
  layout (16-byte STATE_UPDATE header, 32-byte SNAPSHOT header) and return correct
  `ParsedStateUpdate` / `ParsedSnapshot` for both f32 and f64 dtypes.
- `parseStateUpdate` returns positions/velocities that are zero-copy views into
  the input `ArrayBuffer`: `parsed.positions.buffer === incomingBuffer` and
  `parsed.positions.byteOffset === 16`.
- `parseSnapshot` returns positions that are zero-copy views with
  `parsed.positions.byteOffset === 32`.
- Both parsers reject `schema_version != 2` with `console.warn` and return `null`.
  The connection is not closed; the parser tier (tier-1) handles via drop-and-
  continue, identical to the existing unknown-dtype path.
- `applySnapshot` detaches from the wire buffer (so `state.positions` is not
  invalidated by the next message).
- All existing 134 tests continue to pass after fixture and parser updates.

### Technical Requirements

- `WIRE_SCHEMA_VERSION = 2` is the single source of truth for the version constant;
  no raw `2` literals in parser branches (per project rule "If a value is used in
  conditionals … define it once and reference that definition everywhere").
- `STATE_UPDATE_HEADER_BYTES = 16` and `SNAPSHOT_HEADER_BYTES = 32` are the single
  header constants for their respective messages.
- No `buffer.slice()` calls remain in `parseStateUpdate` or `parseSnapshot`. (Both
  body offsets are 16-byte aligned, so views over the wire buffer construct cleanly
  for both f32 and f64.)
- New tests cover:
  - `parseStateUpdate` f32 round-trip — buffer-identity assertion.
  - `parseStateUpdate` f64 round-trip — buffer-identity assertion.
  - `parseStateUpdate` rejects `schema_version = 1` (returns null, warns).
  - `parseStateUpdate` rejects `schema_version = 3` (returns null, warns).
  - `parseSnapshot` f32 round-trip — buffer-identity assertion (byteOffset === 32).
  - `parseSnapshot` f64 round-trip — buffer-identity assertion.
  - `parseSnapshot` rejects `schema_version = 1` (returns null, warns).
  - `parseSnapshot` accepts non-zero reserved bytes (forward-compat — viewer must
    not validate or reject reserved bytes 11–15 / 27–31).
  - `applySnapshot` detaches: after `applySnapshot`, mutating the parsed view's
    underlying buffer does not affect `state.positions`.

### Verification Walkthrough

**1. Run the full test suite — all tests pass.**

```bash
pnpm test
```

Actual (slice 115 implementation):

```
 Test Files  9 passed (9)
      Tests  145 passed (145)
```

Note: pre-slice baseline was 134 tests. Slice 115 adds 11 net new tests
(WIRE_SCHEMA_VERSION constant assertion; 2 STATE_UPDATE buffer-identity
tests f32+f64; 3 STATE_UPDATE schema_version + reserved-byte tests;
2 SNAPSHOT buffer-identity tests f32+f64; 3 SNAPSHOT schema_version +
reserved-byte tests; 1 applySnapshot wire-buffer detach end-to-end test)
and removes 1 obsolete test ("returns typed-array copies independent
from the source buffer") that asserted the v1 detach-by-`buffer.slice()`
contract — that contract is now inverted (parser intentionally returns
views; detachment is the state layer's job). Net delta: 134 → 145 (+11).

**2. Type-check clean.**

```bash
pnpm tsc --noEmit
```

Actual: exits 0, no output.

**3. Inspect the parser output directly (manual REPL or test harness).**

The buffer-identity contract is pinned by automated tests in
`src/protocol/deserialize.test.ts` (describe blocks
`parseStateUpdate — zero-copy buffer identity (slice 115)` and
`parseSnapshot — zero-copy buffer identity (slice 115)`). For interactive
inspection in a vitest test or debug invocation:

```typescript
const buf = buildStateUpdate(42, [1, 2, 3, 4], [0, 0, 0, 0], PositionDtype.F32);
const parsed = parseMessage(buf) as ParsedStateUpdate;
console.assert(parsed.positions.buffer === buf, 'must be a view into the wire buffer');
console.assert(parsed.positions.byteOffset === 16, 'positions start at offset 16');
console.assert(parsed.positions instanceof Float32Array, 'f32 dtype produces Float32Array');

const snapBuf = buildSnapshot(1, 1000, 1000, [1, 2], [0, 0], [0], PositionDtype.F32);
const snap = parseMessage(snapBuf) as ParsedSnapshot;
console.assert(snap.positions.buffer === snapBuf, 'snapshot view aliases wire buffer');
console.assert(snap.positions.byteOffset === 32, 'snapshot positions start at offset 32');
```

**4. Smoke-test against the v2-emitting server.**

Run a server built from producer commit `9e7526d` (the slice 321 wire-alignment
push). Then:

```bash
pnpm dev
```

Open the viewer, connect to the server. Confirm:
- HUD tick counter advances normally.
- Entities render at correct positions (garbled positions would indicate offset drift).
- Browser console: zero `[protocol]` warnings during steady-state operation.
- DevTools → Memory → Allocations: per-tick allocation rate is materially lower than
  pre-slice (no per-tick `ArrayBuffer.slice()` allocations).

Actual (smoke tested by Project Manager during T20): viewer connected to the
v2 server cleanly, rendered correctly, no protocol warnings. PM observation
recorded: further allocation/throughput optimization beyond this point would
require either WebTransport (replacing the WebSocket carrier) or a non-browser
viewer architecture that can use shared memory / mmap (i.e. the deferred
slice 322 path). Captured in Future Work.

**5. Negative-case version drift (covered by automated tests).**

The unit tests above (rejecting `schema_version = 1` / `3`) prove the strict-version
check is wired correctly. No live server is needed — wire drift would produce the
same "stalled HUD, console floods with `[protocol] schema_version` warnings"
symptom in production, by design.

### Caveats discovered during implementation

- **Fixture migration was broader than the task file scoped.** T6 was written
  as "update `buildStateUpdate` in `deserialize.test.ts`" but three other test
  files carry their own copies of `buildSnapshot` / `buildStateUpdate`
  (`terrain-assembler.test.ts`, `terrain-assembler-chunked.test.ts`,
  `net/connection.test.ts`). All four had to migrate together for tests to
  stay green at the T9 commit boundary. Future work: extract these builders
  into a shared `_test-helpers.ts` (alongside the terrain frame builders that
  already live there) so a future header bump only touches one place.
- **Commit boundaries T9 and T15 were partially merged.** The deserialize.ts
  file edit changes both parsers in one pass, and the fixture migrations span
  both message types — tests stay green only as a unit. T9 ended up containing
  both parser changes plus all fixture migrations plus the STATE_UPDATE-only
  tests; T15 contained only the SNAPSHOT-specific tests added afterward. The
  net history is still clean and bisectable.
- **One v1-era test was removed** (was: "returns typed-array copies
  independent from the source buffer" in `parseSnapshot`). It asserted the
  reverse of the new contract. The replacement coverage is the buffer-identity
  tests (T7, T13) plus the wire-buffer-detach test (T17).

## Implementation Notes

### Development Approach

Suggested order:

1. Add `WIRE_SCHEMA_VERSION` to `protocol/types.ts`.
2. Update `STATE_UPDATE_HEADER_BYTES` to 16 and `SNAPSHOT_HEADER_BYTES` to 32, and
   update `parseStateUpdate` and `parseSnapshot` to read `schema_version` at offsets
   10 and 26 respectively.
3. Replace `buffer.slice()` constructions with view constructions in both parsers.
4. Update `applySnapshot` in `state.ts` to detach via `.slice()` on the parsed
   typed arrays.
5. Update fixture builders in `deserialize.test.ts` to emit the new header layout
   (and accept a `schemaVersion` override for negative tests).
6. Add new tests for buffer identity, schema-version rejection, and snapshot
   header-size detection.
7. Run `pnpm tsc --noEmit` and `pnpm test`. Both must be clean.

The TypeScript compiler will not flag the alignment problem (it's a runtime
`RangeError`), so the buffer-identity test in step 6 is the only mechanical proof
that step 3 worked.

### Special Considerations

**WebSocket buffer aliasing.** The contract that wire-buffer views are valid only
until the next `onmessage` is the load-bearing assumption of the zero-copy path.
This is asserted by the existing `applyStateUpdate` `.set()` copy and by the new
`applySnapshot` `.slice()` copy. If a future change passes the parsed view to an
async path or stores it across ticks, the alias becomes a use-after-free
(positions silently mutate to whatever the next message contained). Mitigation: a
comment on `parseStateUpdate` and `parseSnapshot` flagging that returned views
alias the wire buffer and must be copied before the next event-handler turn.

**No mmap, no TICK_AVAILABLE, no HELLO.** This slice deliberately excludes the
deferred slice 322 work (mmap region, HELLO handshake, TICK_AVAILABLE notifications).
If a same-host non-browser viewer is built later (Tauri, Node CLI, etc.), it can
be a separate slice with its own design — the wire-alignment work shipped here is
reused without modification.

**Reserved bytes are forward-compat slots.** STATE_UPDATE bytes 11–15 and SNAPSHOT
bytes 27–31 are zero today. Per the slice 321 viewer handoff, "future schema bumps
(v3) will be a strict break the same way. Reserved bytes are the additive escape
hatch." The parser must not validate or reject non-zero reserved bytes — doing so
would force a header realignment for any additive change. A test (listed in the
Success Criteria) pins this behavior.
