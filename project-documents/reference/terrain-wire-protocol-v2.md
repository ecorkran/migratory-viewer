---
docType: reference
project: migratory-viewer
source: migratory server — terrain-wire design (Viewer Implementer Reference section)
sourceProvidedBy: Project Manager
dateCaptured: 20260424
dateUpdated: 20260424
relatedSlice: user/slices/112-slice.terrain-wire-protocol-v2.md
status: frozen-with-confirmed-amendment
---

# Terrain Wire Protocol v2 — Viewer Implementer Reference

This document is a capture of the **Viewer Implementer Reference** section of the migratory server's terrain-wire design, as provided by the Project Manager on 2026-04-24 during slice 112 design. It is the authoritative spec for slice 112 implementation.

If this document and slice 112's [design](../user/slices/112-slice.terrain-wire-protocol-v2.md) ever disagree, **this document wins** — the design is a translation, not a re-derivation. If the design needs to deviate, update both and note the reason.

**Amendment status (as of 2026-04-24).** The "Viewer Implementer Reference" body below was originally pasted from the upstream server design. Slice 112's task breakdown identified that the original body specified the chunked-path *behavior* (state machine, reassembly pseudocode, error catalog, single-shot worked example) but did not enumerate byte offsets for `TERRAIN_HEADER (0x05)` or `TERRAIN_CHUNK (0x04)`. The migratory server team responded on 2026-04-24 with confirmed byte tables for both opcodes plus a chunked worked example, captured in the new "Confirmed Offsets — TERRAIN_HEADER and TERRAIN_CHUNK (added 2026-04-24)" section below. Per the server team, the upstream spec will be brought back into sync via migratory slice 317 Task 10.2; until then, the additions in this file are the canonical layouts for viewer slice 112 implementation.

If the upstream server design changes after this capture date, the Project Manager should re-paste the new version into this file and bump `dateCaptured` rather than editing in place.

---

## Viewer Implementer Reference

This section consolidates everything a non-Python client (browser / TypeScript / WASM renderer) needs to decode terrain. Everything below is normative — if this section and the Technical Decisions tables disagree, the tables win, and that is a documentation bug to file.

### Dispatch State Machine

On every message (`ArrayBuffer` frame) the server sends, read the first byte (`uint8`) and dispatch:

```
per-connection state:
  terrain_state = IDLE
  expected_chunks = 0
  received_chunks = []
  grid_metadata = null     # dtype, compression, rows, cols, origin, resolution,
                           # and (if uint16) elevation_min / elevation_max

on message bytes:
  type_byte = bytes[0]
  switch type_byte:
    0x01 SNAPSHOT     → parse per slice 306; update entity state
    0x02 STATE_UPDATE → parse per slice 306; update entity state
                         # STATE_UPDATE will not arrive until all terrain
                         # messages for this connection have been sent — see
                         # "Interleaving Contract" below.
    0x03 TERRAIN      → parse v2 header (see table); single-shot, done
                         assert terrain_state == IDLE
                         decompress + (if uint16) dequantize payload
                         hand full grid to renderer
    0x04 TERRAIN_CHUNK → assert terrain_state == EXPECTING_CHUNKS
                          parse 22-byte chunk header + compressed payload
                          append to received_chunks
                          if last_chunk_flag == 1:
                            assert len(received_chunks) == expected_chunks
                            reassemble (see pseudocode), hand to renderer
                            terrain_state = IDLE
    0x05 TERRAIN_HEADER → assert terrain_state == IDLE
                           parse header (see table); store grid_metadata
                           allocate grid[rows][cols] as float64
                           expected_chunks = chunk_count
                           received_chunks = []
                           terrain_state = EXPECTING_CHUNKS
    anything else     → protocol error; close connection with 1002
```

**Protocol errors close the connection.** WebSocket close code 1002 (protocol error) is the recommended signal. Do not attempt to recover in-stream; the server will not re-synchronize.

### Interleaving Contract

The client may rely on the following ordering guarantees from the server:

- For any one connection, all terrain messages (`TERRAIN`, or `TERRAIN_HEADER` followed by all `TERRAIN_CHUNK`s) precede the first `STATE_UPDATE`.
- `SNAPSHOT` (`0x01`) is always the first message received.
- No `SNAPSHOT` or `TERRAIN*` message will arrive mid-connection after `STATE_UPDATE`s have started (terrain is static and one-shot per connection).
- Chunks arrive in `sequence_number` order as sent, but the client **must not** rely on arrival order for reassembly — always reassemble via `row_offset` / `col_offset`. TCP preserves order over a single connection; this rule is forward-compat for potential UDP variants or view-driven out-of-order streaming.

### Compression Frame Formats

- **zstd** payloads are **standard zstd frames** (RFC 8478, magic `0x28 B5 2F FD`). No dictionary. Any compliant zstd decoder (e.g. `fzstd` or a WASM build of `libzstd`) consumes them as-is.
- **lz4** payloads are **LZ4 Frame format** (magic `0x04 22 4D 18`), *not* raw LZ4 block format. Use a frame-capable decoder (e.g. `lz4js`, or WASM `lz4-wasm` in frame mode).
- **none** means the payload bytes are the raw dtype-cast elevation array; no decoder step.

Server choice is declared in the flags byte of the preceding `TERRAIN` (single-shot) or `TERRAIN_HEADER` (chunked) message — the client must not assume an algorithm across connections; server config can change.

### Dtype Decode

After decompression, interpret payload as `count` consecutive elements of the declared dtype, little-endian:

- **f32** → `Float32Array` view; promote to f64 in the renderer if needed.
- **f64** → `Float64Array` view directly.
- **uint16** → `Uint16Array` view; dequantize each element to f64 via:
  ```
  elevation_f64 = elevation_min + (u16_value / 65535.0) * (elevation_max - elevation_min)
  ```
  `elevation_min` / `elevation_max` come from the 16 bytes immediately following the flags byte in the preceding `TERRAIN` or `TERRAIN_HEADER`.

`count` is `rows × cols` for single-shot `TERRAIN`, or `chunk_rows × chunk_cols` for each `TERRAIN_CHUNK`.

### Reassembly Pseudocode (Chunked Path)

```
# After the last TERRAIN_CHUNK has been received:
grid = new Float64Array(rows * cols)  # zero-initialized; row-major

for each chunk in received_chunks:
    # Decompress
    if chunk.compression != NONE:
        raw = decompress(chunk.payload_compressed, algorithm=compression)
    else:
        raw = chunk.payload_compressed

    # Decode dtype → Float64Array of length (chunk_rows × chunk_cols)
    decoded = decode_dtype(raw, dtype, elevation_min, elevation_max)

    # Write into full grid
    for r in 0 .. chunk.chunk_rows - 1:
        src_offset = r * chunk.chunk_cols
        dst_offset = (chunk.row_offset + r) * cols + chunk.col_offset
        grid.set(decoded.subarray(src_offset, src_offset + chunk.chunk_cols), dst_offset)

# Validate coverage (defensive):
assert that the set of (row_offset, col_offset, chunk_rows, chunk_cols) rectangles
partitions [0, rows) × [0, cols) exactly — no overlaps, no gaps.

# Hand `grid` to renderer; build PlaneGeometry / height map with row-major interpretation.
```

**Coverage validation is recommended, not optional.** A missing chunk (dropped `sequence_number`) and a duplicate chunk both show up as partitioning violations; catching them here gives a clear error instead of a silent hole in the terrain.

### Worked Example: 2×2 f32 + zstd

For debugging a new decoder, the server produces a predictable byte layout. A 2×2 grid with elevations `[[0.0, 1.0], [2.0, 3.0]]` at `resolution=10.0`, `origin=(0.0, 0.0)`, f32 + zstd:

```
Bytes 0:     0x03                            # TERRAIN
Bytes 1-4:   0x02 0x00 0x00 0x00             # rows = 2
Bytes 5-8:   0x02 0x00 0x00 0x00             # cols = 2
Bytes 9-16:  0x00 0x00 0x00 0x00 0x00 0x00 0x24 0x40  # resolution = 10.0 (f64 LE)
Bytes 17-24: 0x00 0x00 0x00 0x00 0x00 0x00 0x00 0x00  # origin_x = 0.0
Bytes 25-32: 0x00 0x00 0x00 0x00 0x00 0x00 0x00 0x00  # origin_y = 0.0
Byte 33:     0x04                            # flags: dtype=f32 (00), compression=zstd (001), reserved=0
                                              # = (1 << 2) | 0 = 0b00000100
Bytes 34+:   <zstd frame starting with magic 0x28 B5 2F FD>
              decompressed payload = 16 bytes of f32 LE:
              0x00 0x00 0x00 0x00   # 0.0
              0x00 0x00 0x80 0x3F   # 1.0
              0x00 0x00 0x00 0x40   # 2.0
              0x00 0x00 0x40 0x40   # 3.0
```

Adding a ground-truth unit test in the viewer that parses exactly this byte sequence and validates the decoded grid matches `[[0.0, 1.0], [2.0, 3.0]]` is the fastest way to catch endianness, offset, and dequantization errors before running against a live server.

### Confirmed Offsets — TERRAIN_HEADER and TERRAIN_CHUNK (added 2026-04-24)

This subsection captures byte-level layouts that were not in the original Viewer Implementer Reference paste but were confirmed by the migratory server team on 2026-04-24 in response to the slice 112 task-breakdown's flag that chunked-path offsets were under-specified. Per the server team, the upstream spec will be re-synced via migratory slice 317 Task 10.2; until then, the layouts here are canonical for viewer slice 112.

A nice property of the confirmed layout: bytes 0–33 of `TERRAIN_HEADER (0x05)` are byte-position-identical to bytes 0–33 of single-shot `TERRAIN (0x03)`. Only the leading opcode byte differs. This means the same fixed-prefix reader can decode either; the chunk-count and (conditional) dequant range follow the flags byte.

#### TERRAIN_HEADER (`0x05`) — 38 bytes (54 if dtype = uint16)

| Offset | Size | Field |
|---|---|---|
| 0  | 1 | `message_type = 0x05` |
| 1  | 4 | `rows` (u32 LE) |
| 5  | 4 | `cols` (u32 LE) |
| 9  | 8 | `resolution` (f64 LE) |
| 17 | 8 | `origin_x` (f64 LE) |
| 25 | 8 | `origin_y` (f64 LE) |
| 33 | 1 | `flags` (u8 — same dtype/compression/reserved layout as single-shot `TERRAIN`) |
| 34 | 4 | `chunk_count` (u32 LE) |
| 38 | 16 | `elevation_min` + `elevation_max` (2 × f64 LE) — present **only if** dtype == uint16 |

#### TERRAIN_CHUNK (`0x04`) — 22 bytes header + payload

| Offset | Size | Field |
|---|---|---|
| 0  | 1 | `message_type = 0x04` |
| 1  | 4 | `sequence_number` (u32 LE) |
| 5  | 4 | `row_offset` (u32 LE) |
| 9  | 4 | `col_offset` (u32 LE) |
| 13 | 4 | `chunk_rows` (u32 LE) |
| 17 | 4 | `chunk_cols` (u32 LE) |
| 21 | 1 | `last_chunk_flag` (u8 — `1` on the final chunk, else `0`) |
| 22+ | var | compressed chunk payload |

Chunks share the `dtype`, `compression`, and (if uint16) `elevation_min` / `elevation_max` declared in the preceding `TERRAIN_HEADER`; chunk headers do not repeat them.

#### Duplicate-Sequence-Number Policy (refinement of the Protocol Error Catalog row)

The original catalog row "Duplicate `sequence_number` → Last-write-wins; log warning, continue" has been refined to distinguish two sub-cases:

| Sub-case | Action |
|---|---|
| Duplicate `sequence_number` with **identical** `(row_offset, col_offset, chunk_rows, chunk_cols)` and identical payload | Benign retransmit — log warning, continue (last-write-wins) |
| Duplicate `sequence_number` with **different** coordinates | Server bug — close 1002 |

#### Worked Example: 4×2 f32 + zstd, two 2×2 row-strip chunks

A 4-row × 2-col grid with elevations `[[0.0, 1.0], [2.0, 3.0], [4.0, 5.0], [6.0, 7.0]]` at `resolution=10.0`, `origin=(0.0, 0.0)`, dtype=f32, compression=zstd, partitioned into two row-strips: chunk 0 covers rows 0–1, chunk 1 covers rows 2–3.

**TERRAIN_HEADER (`0x05`) — 38 bytes:**

```
Bytes 0:     0x05                            # TERRAIN_HEADER
Bytes 1-4:   0x04 0x00 0x00 0x00             # rows = 4
Bytes 5-8:   0x02 0x00 0x00 0x00             # cols = 2
Bytes 9-16:  0x00 0x00 0x00 0x00 0x00 0x00 0x24 0x40  # resolution = 10.0 (f64 LE)
Bytes 17-24: 0x00 0x00 0x00 0x00 0x00 0x00 0x00 0x00  # origin_x = 0.0
Bytes 25-32: 0x00 0x00 0x00 0x00 0x00 0x00 0x00 0x00  # origin_y = 0.0
Byte 33:     0x04                            # flags: dtype=f32, compression=zstd, reserved=0
Bytes 34-37: 0x02 0x00 0x00 0x00             # chunk_count = 2
                                              # (no elevation_min/max — dtype is f32, not uint16)
```

**TERRAIN_CHUNK[0] (`0x04`) — 22-byte header + zstd-compressed payload:**

```
Byte  0:     0x04                            # TERRAIN_CHUNK
Bytes 1-4:   0x00 0x00 0x00 0x00             # sequence_number = 0
Bytes 5-8:   0x00 0x00 0x00 0x00             # row_offset = 0
Bytes 9-12:  0x00 0x00 0x00 0x00             # col_offset = 0
Bytes 13-16: 0x02 0x00 0x00 0x00             # chunk_rows = 2
Bytes 17-20: 0x02 0x00 0x00 0x00             # chunk_cols = 2
Byte  21:    0x00                            # last_chunk_flag = 0 (more chunks follow)
Bytes 22+:   <zstd frame starting with magic 0x28 B5 2F FD>
              decompressed payload = 16 bytes of f32 LE:
              0x00 0x00 0x00 0x00   # 0.0
              0x00 0x00 0x80 0x3F   # 1.0
              0x00 0x00 0x00 0x40   # 2.0
              0x00 0x00 0x40 0x40   # 3.0
```

**TERRAIN_CHUNK[1] (`0x04`) — 22-byte header + zstd-compressed payload:**

```
Byte  0:     0x04                            # TERRAIN_CHUNK
Bytes 1-4:   0x01 0x00 0x00 0x00             # sequence_number = 1
Bytes 5-8:   0x02 0x00 0x00 0x00             # row_offset = 2
Bytes 9-12:  0x00 0x00 0x00 0x00             # col_offset = 0
Bytes 13-16: 0x02 0x00 0x00 0x00             # chunk_rows = 2
Bytes 17-20: 0x02 0x00 0x00 0x00             # chunk_cols = 2
Byte  21:    0x01                            # last_chunk_flag = 1 (final chunk)
Bytes 22+:   <zstd frame starting with magic 0x28 B5 2F FD>
              decompressed payload = 16 bytes of f32 LE:
              0x00 0x00 0x80 0x40   # 4.0
              0x00 0x00 0xA0 0x40   # 5.0
              0x00 0x00 0xC0 0x40   # 6.0
              0x00 0x00 0xE0 0x40   # 7.0
```

After feeding the header followed by both chunks (in either arrival order — reassembly is offset-driven) into a fresh assembler, the resulting `Float64Array` should equal `[0, 1, 2, 3, 4, 5, 6, 7]` row-major (within f32→f64 promotion exactness, which is exact for these integer values).

### Protocol Error Catalog

| Condition | Client Behavior |
|---|---|
| Reserved flag bits (5–7) nonzero | Close 1002; log "protocol version mismatch — update viewer" |
| Unknown dtype (bits 0–1 = `3`) | Close 1002 |
| Unknown compression (bits 2–4 = `3–7`) | Close 1002 |
| `TERRAIN_CHUNK` received without preceding `TERRAIN_HEADER` | Close 1002 |
| `TERRAIN_HEADER` received mid-chunked delivery | Close 1002 |
| Missing `sequence_number` after `last_chunk_flag == 1` | Close 1002 or render partial grid with warning (implementer choice — both are defensible) |
| Duplicate `sequence_number` | Last-write-wins; log warning, continue |
| Malformed compressed payload (decoder error) | Close 1002 |
| `TERRAIN*` received after `STATE_UPDATE` | Close 1002 (server bug; should never happen) |

Close-code 1002 is the recommended "protocol error" signal. Implementers may substitute a framework-appropriate equivalent; the server does not inspect close codes.

### Configuration That Affects the Viewer

The server's `terrain_wire` config (dtype, compression, chunking thresholds) is not negotiated with the client. The viewer decodes whatever the flags byte declares. Config drift between server and viewer manifests as a decoder error — no silent corruption.

If the viewer initiative identifies a compression algorithm it cannot ship (e.g. zstd WASM bundle too large), the remediation is a server config change (`terrain_wire.compression: lz4`), not a protocol change. The viewer should still implement zstd + lz4 + none to avoid forcing the server into a specific choice.
