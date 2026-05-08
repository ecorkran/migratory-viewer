---
title: Shared-Memory State Transport — Wire & Region Contract
slice: 322
audience: viewer team (initiative 600)
status: authoritative
last_updated: 2026-05-08
note: |
  This document is the design-of-record for migratory slice 322
  (mmap region, HELLO handshake, TICK_AVAILABLE). The wire-format
  alignment subset originally bundled into slice 321 has shipped
  separately; for the *live* slice 321 wire change, see
  `321-notes.viewer-handoff.md` in this directory.
---

# Shared-Memory State Transport — Wire & Region Contract

This document is the binary contract between the migratory server
(producer, slice 321) and the same-machine viewer (consumer,
initiative 600). It is the single source of truth — if the server
implementation diverges from this doc, the doc is wrong and gets
updated; the viewer should not chase undocumented changes.

All multi-byte integers are **little-endian**. All offsets are in
bytes from the start of their containing structure (header or slot).
The server runs on darwin/linux; this contract assumes POSIX mmap
semantics.

## High-level model

- **Control plane** (websocket): HELLO handshake, SNAPSHOT, TERRAIN,
  TICK_AVAILABLE notifications.
- **Data plane** (mmap, this contract): per-tick agent state arrays,
  written by the simulation thread, read by the viewer process.

Lifecycle:

1. Viewer connects over websocket.
2. Server sends `SERVER_HELLO` (0x08) carrying capabilities including
   `shared_memory_path` (or null).
3. Viewer replies with `CLIENT_HELLO` (0x09) declaring whether it
   supports shared memory. The viewer should set
   `supports_shared_memory: true` only when (a) it is on the same
   host as the server *and* (b) it can `mmap()` the path read-only.
4. If both sides agree, server sends only `TICK_AVAILABLE` per tick;
   no `STATE_UPDATE` for this client. Otherwise the connection
   stays in classic websocket mode (`STATE_UPDATE` per tick, no
   `TICK_AVAILABLE`).
5. On every tick where shared-memory is active for *any* connected
   client, the server publishes the new state into the mmap region
   *before* sending `TICK_AVAILABLE`.

## Wire-message changes (slice 321 vs slice 320)

This is a **breaking** wire change. The server bumps
`schema_version` to `2` on `SNAPSHOT` and `STATE_UPDATE` and adds
the field at offset 10 in both. Viewers parsing the old 10-byte
`STATE_UPDATE` header or 26-byte `SNAPSHOT` header will fail
deserialization.

### `STATE_UPDATE` (0x02) — new 16-byte header

| Offset | Size | Type | Field           | Notes                              |
|--------|------|------|-----------------|------------------------------------|
| 0      | 1    | u8   | message_type    | `0x02`                             |
| 1      | 4    | u32  | tick_number     |                                    |
| 5      | 4    | u32  | entity_count    |                                    |
| 9      | 1    | u8   | position_dtype  | `1`=F32, `2`=F64                   |
| 10     | 1    | u8   | schema_version  | `2`                                |
| 11     | 5    | u8×5 | reserved        | zero-filled                        |
| 16     | …    | —    | positions       | `entity_count × 2 × dtype` bytes   |
| 16+P   | …    | —    | velocities      | `entity_count × 2 × dtype` bytes   |

`P = entity_count × 2 × sizeof(dtype)`. Positions and velocities
are 2D (x, y) — there is no z component on the wire.

### `SNAPSHOT` (0x01) — new 16-byte-aligned header

Same alignment principle. Fields: message_type, tick_number,
world_width (f64), world_height (f64), entity_count,
position_dtype, schema_version, padding to next 16-byte boundary.
Body follows: positions, velocities, profile_indices.

The reader should take `SNAPSHOT_HEADER_BYTES = 16` (or whatever
multiple of 16 the server emits — read it from the constant the
server publishes; do not hard-code if avoidable). The viewer's
parser should detect the header size from the first aligned chunk
rather than assuming.

### `TICK_AVAILABLE` (0x07) — new, 8 bytes total

| Offset | Size | Type | Field           |
|--------|------|------|-----------------|
| 0      | 1    | u8   | message_type    | `0x07`
| 1      | 1    | u8   | schema_version  | `2`
| 2      | 2    | u8×2 | reserved        | zero-filled
| 4      | 4    | u32  | tick_number     |

Sent by the server on every tick where shared memory is active and
this client has `uses_shared_memory == true`. Websocket-only
clients do not receive this. Same-machine clients do not receive
`STATE_UPDATE`.

### `SERVER_HELLO` (0x08) — variable length

Sent server→viewer immediately on accept, before `SNAPSHOT`.

| Offset | Size | Type | Field                     |
|--------|------|------|---------------------------|
| 0      | 1    | u8   | message_type = `0x08`     |
| 1      | 1    | u8   | schema_version = `2`      |
| 2      | 1    | u8   | protocol_version          |
| 3      | 1    | u8   | position_dtype            |
| 4      | 1    | u8   | shared_memory_available   |
| 5      | 3    | u8×3 | reserved (zero-filled)    |
| 8      | 2    | u16  | path_len                  |
| 10     | …    | utf8 | shared_memory_path        |

`path_len = 0` and empty body when `shared_memory_available` is
false.

### `CLIENT_HELLO` (0x09) — fixed 8 bytes

Sent viewer→server in reply to `SERVER_HELLO`, within ~500 ms of
connect (server uses a bounded timeout). If the server times out
waiting for `CLIENT_HELLO`, the connection defaults to
`uses_shared_memory = false`.

| Offset | Size | Type | Field                       |
|--------|------|------|-----------------------------|
| 0      | 1    | u8   | message_type = `0x09`       |
| 1      | 1    | u8   | schema_version = `2`        |
| 2      | 1    | u8   | protocol_version            |
| 3      | 1    | u8   | supports_shared_memory      |
| 4      | 1    | u8   | desired_dtype               |
| 5      | 3    | u8×3 | reserved (zero-filled)      |

The viewer should set `supports_shared_memory = 1` only when it
both is on the same host *and* successfully opened+mmapped the
path from `SERVER_HELLO`. If the mmap attempt fails for any
reason, reply with `0` — the server will fall back to
`STATE_UPDATE` over websocket and the viewer keeps working.

## Shared-memory region layout

The server creates a file at `shared_memory_path`,
`ftruncate()`s it to `header_size + slot_count × slot_size_bytes`,
and `mmap()`s it. The viewer should open the file read-only and
mmap it the same length (read it from the header's
`slot_size_bytes` and `header_size_bytes` fields).

### Region structure

```
+------------------+  offset 0
|  Header (64 B)   |
+------------------+  offset 64
|  Slot 0          |  slot_size_bytes
+------------------+  offset 64 + slot_size_bytes
|  Slot 1          |  slot_size_bytes
+------------------+
```

`slot_count` is always `2` in this slice; treat it as authoritative
from the header rather than hard-coding.

### Header (64 bytes, all little-endian)

| Offset | Size | Type | Field             | Notes                                  |
|--------|------|------|-------------------|----------------------------------------|
| 0      | 4    | u32  | magic             | `0x4D49475F` ("MIG_") — sanity check   |
| 4      | 4    | u32  | schema_version    | `1` for the **mmap layout** (distinct from wire) |
| 8      | 4    | u32  | dtype_tag         | `1` = F32 (only value in this slice), `2` = F64 (future) |
| 12     | 4    | u32  | entity_capacity   | Maximum N fitting in one slot          |
| 16     | 4    | u32  | slot_count        | `2` in this slice                      |
| 20     | 4    | u32  | slot_size_bytes   | Size of one slot in bytes              |
| 24     | 4    | u32  | header_size_bytes | `64` in this slice                     |
| 28     | 4    | u32  | reserved_a        | Pad to 8-byte boundary                 |
| 32     | 8    | u64  | current_slot      | **Atomic.** Index (0 or 1) of slot most recently published |
| 40     | 8    | u64  | tick_number       | **Atomic.** Tick number of slot identified by `current_slot` |
| 48     | 8    | u64  | active_count      | Number of valid entities in current slot (≤ `entity_capacity`) |
| 56     | 8    | u64  | reserved_b        | Future use                             |

Note: the **mmap region's** `schema_version` (header offset 4) is
`1` and is independent from the **wire protocol's** `schema_version`
(`2`). They evolve separately. Do not conflate them.

### Slot layout (`slot_size_bytes` total, 16-byte aligned)

Each slot's first 8 bytes serve double duty as both the start of
the positions array *and* a **commit marker** that protects
against torn reads (see "Read protocol" below).

```
slot start:
+------------------------+  offset 0  (also = positions[0..2] in F32)
| commit marker / pos[0] |  8 bytes
+------------------------+  offset 8
| positions[1..N]        |  remaining (N-1) × 8 bytes
+------------------------+  offset N × 8
| velocities[0..N]       |  N × 8 bytes  (F32 vx, vy)
+------------------------+  offset N × 16
| profile_indices[0..N]  |  N × 4 bytes  (i32)
+------------------------+
| pad to 16-byte boundary|
+------------------------+
```

For F32 (the only dtype in this slice):
- positions = `entity_capacity × 2 × 4` bytes (x, y)
- velocities = `entity_capacity × 2 × 4` bytes (vx, vy)
- profile_indices = `entity_capacity × 4` bytes (i32)

`slot_size_bytes` = `ceil((20 × N) / 16) × 16`.

The **commit marker** is the slot's first 8 bytes interpreted as
two u32s:
- bytes [0..4]: `tick_number_low_word` — low 32 bits of the
  publish's tick number
- bytes [4..8]: `active_count_low_word` — low 32 bits of the
  active count

The reader uses these to detect a publish that landed mid-read.

⚠ Implication for viewers: position[0] (the first agent's x, y)
overlaps the commit marker's bytes. The reader should read the
commit marker *first* (as two u32s), then take a Float32Array view
over the rest of the position array starting at slot offset 8 for
agents 1..N — and read agent 0's position as a separate
Float32Array view over slot offsets 0..8 *after* commit-marker
validation. Or, equivalently, just take the full Float32Array
view, validate the commit marker via DataView reads on the same
bytes, and trust the values once validated. The values are
correct as F32 floats; the commit-marker interpretation is a
*reinterpretation* of the same bytes — they don't overwrite each
other.

## Write protocol (server, for reference)

The server runs this on the simulation thread once per tick:

1. `next_slot = (current_slot + 1) & 1`
2. `np.copyto` positions, velocities, profile_indices into `next_slot`.
3. Write the slot's commit marker (slot's first 8 bytes:
   `tick_number_low_word`, `active_count_low_word`).
4. Header atomic store: `tick_number = new_tick`,
   `active_count = new_count`.
5. Header atomic store: `current_slot = next_slot`. **Publish point.**

The reader's job is to detect the rare race where it reads
`current_slot` between steps 2 and 5 of the *next* publish.
Because the writer always writes into the slot the reader is
*not* currently reading, the only torn-read window is during the
commit-marker write itself.

## Read protocol (viewer, the contract)

On each `TICK_AVAILABLE`:

1. `tick = u32 from TICK_AVAILABLE payload`
2. `slot_index = Atomics.load(currentSlotI32, currentSlotIdx)`
   (treat `current_slot` as a 4-byte aligned i32 for
   `Atomics.load`; the upper 4 bytes of the u64 are always zero
   in this slice).
3. `header_tick = read u64 at header offset 40` (low 32 bits are
   sufficient for matching).
4. Take typed-array views over slot at `header_size_bytes +
   slot_index × slot_size_bytes`:
   - `positions: Float32Array(buffer, slot_offset,
     entity_capacity × 2)`
   - `velocities: Float32Array(buffer, slot_offset +
     entity_capacity × 8, entity_capacity × 2)`
   - `profile_indices: Int32Array(buffer, slot_offset +
     entity_capacity × 16, entity_capacity)`
5. Read commit marker from slot's first 8 bytes via DataView:
   - `marker_tick_low = view.getUint32(slot_offset, true)`
   - `marker_active = view.getUint32(slot_offset + 4, true)`
6. Validate: `marker_tick_low === (header_tick & 0xFFFFFFFF)`. If
   true, the slot is consistent — proceed to render with
   `active_count = marker_active`. If false, the writer beat the
   reader between steps 2 and 5: re-read `current_slot` and try
   *once* more. If still mismatched, skip this tick (the next
   `TICK_AVAILABLE` is imminent).

Use only the first `active_count` entries of each array for
rendering — the remainder of the slot is stale or zero.

## Node.js implementation notes (non-normative)

These are starting points; the viewer team should pick what fits.

### mmap

- **`mmap-io`** — small libc wrapper. Opens a file descriptor and
  returns a `Buffer` (which is a `Uint8Array` view over an
  underlying `ArrayBuffer`). The `Buffer.buffer` property gives
  you that `ArrayBuffer`, which you can hand to typed-array
  constructors for zero-copy views.
- The viewer should mmap **read-only** (`PROT_READ`). The server
  is the sole writer.

### Atomic loads

- `Atomics.load(int32View, currentSlotIdx)` is the right primitive
  for the `current_slot` field. Aligned 4-byte loads on x86/ARM
  are atomic at the hardware level; `Atomics.load` adds the
  acquire fence that the JS memory model requires.
- Note that `Atomics` traditionally wants a `SharedArrayBuffer`,
  but it works on regular `ArrayBuffer`s backed by mmap on
  current Node versions. If your Node version refuses, fall back
  to `view.getInt32(offset, true)` — on the platforms we target,
  the load is atomic in practice for aligned i32, and the worst
  case is a one-tick visible delay.

### Typed-array views over mmap

```js
const buf = mmapBuffer.buffer; // ArrayBuffer
const headerOffset = mmapBuffer.byteOffset;
const slotOffset = headerOffset + headerSizeBytes + slotIndex * slotSizeBytes;
const positions = new Float32Array(buf, slotOffset, entityCapacity * 2);
```

This is zero-copy — the typed array is a view, not a copy. Hand
`positions` straight to `InstancedMesh.instanceMatrix.array` (or
similar) without intermediate allocation.

### Three.js integration

`InstancedMesh.instanceMatrix.array` expects a `Float32Array` of
length `instanceCount × 16` (4×4 matrices). The mmap gives you
positions as length-`N×2`. You'll need to either:
- (a) write a small JS shim that reads from the F32 view and
  writes into the matrix array each frame, or
- (b) use a custom shader that reads agent x, y from a
  `DataTexture` populated from the F32 view (avoids the per-frame
  matrix-array copy and is the path that scales beyond 30k).

Option (b) is the path that gets the viewer past the
30k-agent ingest ceiling identified in the post-slice-320
envelope notes.

## Out of scope for this contract

- Z-coordinate / 3D positions — slice 321 ships 2D only.
- F64 positions — `dtype_tag = 2` is reserved but not implemented;
  this slice is F32-only.
- Profile schema — `profile_indices` is an i32 lookup into a
  profile table delivered separately (existing mechanism, not
  changed by slice 321).
- Multiple writers — the contract assumes single-writer
  (simulation thread). Cross-machine viewers continue using
  websocket `STATE_UPDATE` and never see the mmap.

## Versioning

If the server bumps the **mmap region's** `schema_version`
(header offset 4) the viewer must refuse to mmap and fall back to
websocket — the layout changes incompatibly.

If the server bumps the **wire protocol's** `schema_version` on
`SNAPSHOT`/`STATE_UPDATE`/HELLO messages, the viewer must
refuse the connection — the deserializer cannot guess the new
field offsets.

The two versions are independent: shared-memory layout can change
without touching wire format and vice versa.
