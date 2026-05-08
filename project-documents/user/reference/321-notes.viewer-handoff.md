---
docType: notes
title: Slice 321 Viewer Handoff — Wire-Format Alignment
project: migratory
audience: browser viewer team
dateCreated: 20260508
---

# Slice 321 Viewer Handoff — Wire-Format Alignment

This is the message to send to the viewer team. Everything they need
to know to update their parser and ship in lockstep with the
producer push.

---

## What changed

The producer (Python world server) now emits **v2** STATE_UPDATE and
SNAPSHOT messages. This is a **breaking** change — a viewer parsing
the previous 10-byte STATE_UPDATE / 26-byte SNAPSHOT headers will
either misread positions or hit a deserialization error.

The change is shipping as slice **321** (Wire-Format Alignment).
Originally part of the larger Shared-Memory State Transport design,
but that design was split: the wire-format alignment shipped on its
own (this slice), and the mmap publisher / HELLO handshake / mmap
region work has been deferred to slice 322 indefinitely (no native
viewer to consume it). The viewer team only needs to care about the
wire-format change.

## STATE_UPDATE (0x02) — new 16-byte header

| Offset | Size | Type | Field            | Notes                              |
|-------:|-----:|------|------------------|------------------------------------|
| 0      | 1    | u8   | message_type     | `0x02`                             |
| 1      | 4    | u32  | tick_number      | little-endian                      |
| 5      | 4    | u32  | entity_count     | little-endian                      |
| 9      | 1    | u8   | position_dtype   | `0` = F64, `1` = F32               |
| 10     | 1    | u8   | schema_version   | `2`                                |
| 11     | 5    | u8×5 | reserved         | zero-filled                        |
| 16     | …    | —    | positions, then velocities          | dtype per byte 9                   |

Positions begin at **offset 16** instead of 10. Reserved bytes 11-15
are zero in v2; a future schema bump may use them.

## SNAPSHOT (0x01) — new 32-byte header

| Offset | Size | Type | Field            | Notes                              |
|-------:|-----:|------|------------------|------------------------------------|
| 0      | 1    | u8   | message_type     | `0x01`                             |
| 1      | 4    | u32  | tick_number      |                                    |
| 5      | 8    | f64  | world_width      | unchanged from v1                  |
| 13     | 8    | f64  | world_height     | unchanged from v1                  |
| 21     | 4    | u32  | entity_count     |                                    |
| 25     | 1    | u8   | position_dtype   |                                    |
| 26     | 1    | u8   | schema_version   | `2`                                |
| 27     | 5    | u8×5 | reserved         | zero-filled, pads to 32-byte boundary |
| 32     | …    | —    | positions, velocities, profile_indices | per existing v1 body layout |

Body (positions / velocities / profile_indices) begins at **offset
32** instead of 26. The body layout itself is unchanged from v1.

**Resolution of viewer team's F002 question:** `schema_version` is
at offset **26 in SNAPSHOT** (not 10 — that was a writeup error in
the original slice doc). The two messages have *different*
schema_version offsets — 10 in STATE_UPDATE, 26 in SNAPSHOT —
because SNAPSHOT inherited two f64 fields that occupy bytes 5-20.

## Schema version is strictly enforced

The deserializer raises immediately on `schema_version != 2`. There
is no graceful fallback. This means:

- A v1 viewer fed v2 bytes will read garbage (the schema_version
  byte appears as the first byte of position data). This is the
  failure mode you must avoid by updating before the producer
  push lands on the server you connect to.
- A v2 server fed a v1 client message would also reject it, but
  the only client→server messages today are TERRAIN-family which
  are not affected.
- Future schema bumps (v3) will be a strict break the same way.
  Reserved bytes are the additive escape hatch.

## What the viewer team needs to do

1. Update the STATE_UPDATE parser: `positions` view starts at
   byte offset 16 (was 10). Same dtype/count rules as before.
2. Update the SNAPSHOT parser: positions / velocities /
   profile_indices view starts at byte offset 32 (was 26).
3. Optionally validate `buf[10] === 2` (STATE_UPDATE) and
   `buf[26] === 2` (SNAPSHOT) before parsing — gives a cleaner
   error than misaligned position values when version drift
   happens.
4. Coordinate the deploy: the producer push and the viewer push
   should land together. There is no compatibility window.

## What the viewer team does NOT need to worry about

The deferred slice 322 work means **none of these are happening
right now**:

- No `SERVER_HELLO` (0x08) or `CLIENT_HELLO` (0x09) handshake.
  The producer does not emit these and does not wait for them.
- No `TICK_AVAILABLE` (0x07) notification. The producer continues
  to emit STATE_UPDATE per tick over websocket as before.
- No `mmap` region, no `shared_memory_path`, no shared-memory
  consumer mode. The browser viewer cannot mmap and that's fine —
  the producer is not publishing one.
- The opcodes `0x07` / `0x08` / `0x09` are reserved for the future
  slice 322 work. Treat them as unknown / drop on receipt for
  forward compatibility, but the producer will not send them.

## Authoritative reference

The full byte-level contract, including the slice 322 messages
that are *not* shipping, lives at:

`project-documents/user/reference/322-reference.shared-memory-wire-contract.md`

For the slice 321 (live) changes, only the "Wire-message changes
(slice 321 — shipped)" section applies. The rest of the document
is the design-of-record for slice 322.

## Why the change is worth making

At 30k+ F32 agents the per-frame parse + Three.js attribute upload
becomes the bottleneck (envelope work in
`user/notes/320-notes.transport-envelope-and-density-contention.md`).
A 16-byte-aligned STATE_UPDATE header lets the viewer take a
`Float32Array` view directly over the WebSocket frame buffer
without an intermediate copy or slice-and-realign step. The 32-byte
SNAPSHOT header has the same property for the connect-time path.
The schema_version byte costs nothing and prevents an entire class
of silent-misparse bug.

## Producer-side commit reference

Shipped as `9e7526d` ("feat(protocol): align STATE_UPDATE/SNAPSHOT
to 16-byte header, schema_version=2 (slice 321 step 1)") on branch
`321-slice.shared-memory-state-transport`. Will fast-forward to
main once the viewer team confirms readiness.
