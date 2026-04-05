---
docType: slice-design
slice: state-serialization-and-protocol
project: migratory
parent: user/architecture/300-slices.worldserver-foundation.md
dependencies: [305-websocket-client-layer]
interfaces: [307-simulation-logging-and-replay, 309-client-spatial-culling]
dateCreated: 20260404
dateUpdated: 20260404
status: complete
---

# Slice Design: State Serialization and Protocol

## Overview

This slice replaces the current JSON serialization in the WebSocket client layer with an efficient binary protocol. The current implementation converts NumPy float64 arrays to Python lists via `.tolist()` and serializes them as JSON text — readable but expensive at scale. At 10,000 entities and 20 Hz, that's 200K JSON-encoded floats per second per client.

This slice defines a typed binary wire protocol with minimal framing: a message type byte, tick metadata, entity count, and raw array buffers. Full snapshots are sent on connection; per-tick updates use the same binary format. The serialization functions are also used by slice 307 (Simulation Logging and Replay) for state capture, so they are designed as a shared module independent of WebSocket transport.

## Value

**Network efficiency.** JSON serialization of 10,000 entity positions (10K × 2 × 8-byte floats = 160 KB raw) produces ~500 KB of JSON text per message. Binary serialization produces ~160 KB — roughly 3× reduction before any compression. At 20 Hz with multiple clients, this difference is material.

**CPU efficiency.** `ndarray.tolist()` copies every float from C to Python objects, then `json.dumps()` serializes each one individually. Binary serialization uses `ndarray.tobytes()` which is a zero-copy memory view — orders of magnitude faster for large arrays.

**Shared serialization layer.** Slice 307 (logging/replay) needs to write entity state to disk. Defining serialization as a standalone module means both the client layer and the logging system use the same format, ensuring consistency and avoiding duplicate serialization code.

**Protocol extensibility.** The message type byte allows new message types (client commands in future, control messages, metadata) without breaking the format. The architecture document specifies this discriminator as a design requirement.

## Technical Scope

### Included
- Binary message protocol definition with type discriminator and framing
- `protocol.py` module with serialization and deserialization functions
- Two message types: `SNAPSHOT` (0x01) and `STATE_UPDATE` (0x02)
- Array layout descriptor encoding the shape and dtype of each array section
- `ClientManager` and `make_snapshot_builder()` updated to produce binary messages
- WebSocket transport switched from text frames to binary frames
- Deserialization functions for client-side consumption (Python reference implementation)
- Unit tests for round-trip serialization, edge cases, and integration with client layer

### Excluded
- Delta encoding (optimization for later — full state per tick is the baseline)
- Compression (WebSocket per-message deflate can be enabled at transport level independently)
- Client-to-server message types (v1 is server-push only)
- JavaScript/TypeScript client deserialization (client rendering is a separate initiative)
- Logging integration (slice 307 consumes the serialization module)

## Dependencies

### Prerequisites
- **(305) WebSocket Client Layer** — complete. Provides `ClientManager`, `ClientConnection`, `make_snapshot_builder()`, and the WebSocket server integration in `server.py`.

### Interfaces Required
- `migratory.engine.state.AgentState` — SoA container with typed NumPy arrays (positions float64 N×2, velocities float64 N×2, profile_indices int32 N, leadership float64 N)
- `migratory_server.clients.ClientManager` — broadcast and snapshot delivery to modify
- `migratory_server.config.WorldBoundsConfig` — world bounds metadata for snapshots
- `migratory_server.entities.EntityManager` — entity count and state access

## Architecture

### Component Structure

```
src/migratory_server/
├── protocol.py         # NEW: binary serialization/deserialization
├── clients.py          # MODIFIED: uses protocol.py for message building
├── server.py           # MODIFIED: minor — snapshot_builder returns bytes
└── ...
```

**New: `protocol.py`** — Standalone module containing the wire protocol definition: message type constants, framing logic, `serialize_snapshot()`, `serialize_state_update()`, and their deserialization counterparts. No dependency on WebSocket or asyncio — pure data transformation.

**Modified: `clients.py`** — `broadcast()` and `make_snapshot_builder()` call into `protocol.py` instead of building JSON dicts. Messages become `bytes` instead of `str`. The `ClientConnection.queue` type changes from `asyncio.Queue[str]` to `asyncio.Queue[bytes]`.

**Modified: `server.py`** — Minimal change: `snapshot_builder` now returns `bytes` instead of `str`. The WebSocket `send()` call handles both text and binary transparently.

### Data Flow

```
Serialization (server → wire):
  AgentState arrays (NumPy)
    → protocol.serialize_state_update(tick, entity_count, state)
    → bytes: [type_byte | tick_u32 | count_u32 | positions_raw | velocities_raw]
    → ClientManager.broadcast() enqueues bytes
    → _relay() sends binary WebSocket frame

Snapshot (server → new client):
  EntityManager + WorldBoundsConfig
    → protocol.serialize_snapshot(tick, world_bounds, entity_count, state)
    → bytes: [type_byte | tick_u32 | width_f64 | height_f64 | count_u32
              | positions_raw | velocities_raw | profile_indices_raw]
    → sent directly via websocket.send()

Deserialization (wire → client):
  bytes
    → protocol.deserialize_message(buffer)
    → returns (message_type, parsed_dict_with_numpy_arrays)
```

## Technical Decisions

### Wire Protocol Format

Every message begins with a 1-byte type discriminator:

| Type Byte | Name           | Description                          |
|-----------|----------------|--------------------------------------|
| `0x01`    | SNAPSHOT        | Full state for new client connection |
| `0x02`    | STATE_UPDATE    | Per-tick state push                  |

Reserved range `0x03–0x0F` for future server-to-client types. Range `0x10–0x1F` reserved for future client-to-server types.

#### STATE_UPDATE format (0x02)

```
Offset  Size     Field              Type
0       1        message_type       uint8 (0x02)
1       4        tick_number        uint32 little-endian
5       4        entity_count       uint32 little-endian
9       N×2×8    positions          float64 little-endian, row-major
9+N×16  N×2×8    velocities         float64 little-endian, row-major
```

Total size: `9 + entity_count × 32` bytes.

This is the minimum viable state update. Positions and velocities are what clients need to render and interpolate. Profile indices don't change between ticks (entity identity is stable in v1), so they're only in the snapshot.

#### SNAPSHOT format (0x01)

```
Offset  Size     Field              Type
0       1        message_type       uint8 (0x01)
1       4        tick_number        uint32 little-endian
5       8        world_width        float64 little-endian
13      8        world_height       float64 little-endian
21      4        entity_count       uint32 little-endian
25      N×2×8    positions          float64 little-endian, row-major
25+N×16 N×2×8    velocities         float64 little-endian, row-major
...     N×4      profile_indices    int32 little-endian
```

Total size: `25 + entity_count × 36` bytes.

The snapshot includes everything a new client needs to begin rendering: world geometry, entity positions/velocities, and profile assignments.

### Why Not msgpack/protobuf/flatbuffers?

The data being serialized is homogeneous NumPy arrays. These libraries add overhead (schema definitions, import dependencies, per-element encoding) that buys nothing when the payload is already a contiguous typed buffer. `ndarray.tobytes()` is effectively zero-copy — it returns a view of the underlying C array memory. No serialization library can beat "copy the memory block." The framing overhead (9-25 bytes of header) is negligible.

Adding a dependency for this would violate the project principle of resisting unnecessary complexity.

### Byte Order

Little-endian throughout. This matches NumPy's default on x86/ARM (the target platforms) and avoids byte-swapping overhead. The protocol is not intended for cross-architecture use — both server and clients run on standard desktop/server hardware.

If cross-platform compatibility becomes necessary, the snapshot header could include a byte-order marker. For now, little-endian is assumed.

### Array Layout: Row-Major, Contiguous

All arrays are serialized in C-contiguous (row-major) order. For an N×2 positions array, this means `[x0, y0, x1, y1, ..., xN, yN]` — N×2 float64 values in sequence. This matches NumPy's default layout and JavaScript's Float64Array interpretation, so both Python and JS clients can wrap the buffer directly without reshaping.

Before serialization, arrays are made contiguous via `np.ascontiguousarray()` if necessary. In practice, the SoA arrays from `AgentState` are already contiguous, so this is a safety check, not a performance concern.

### Queue Type Change

`ClientConnection.queue` changes from `asyncio.Queue[str]` to `asyncio.Queue[bytes]`. This is a type-only change — asyncio queues are type-agnostic at runtime. The `_relay()` function calls `websocket.send()` which accepts both `str` (text frame) and `bytes` (binary frame) transparently.

### Deserialization as Reference Implementation

Deserialization functions are included in `protocol.py` for three reasons:
1. Testing — round-trip tests prove the format works
2. Logging replay (slice 307) — the replay reader needs to deserialize
3. Reference — documents the format for client implementations in other languages

The deserialization functions return a dict with NumPy arrays (positions, velocities, etc.) reconstructed from the raw buffers. This mirrors the current JSON dict structure for easy integration.

### Snapshot Builder Signature Change

`make_snapshot_builder()` currently returns `Callable[[int], str]`. It changes to `Callable[[int], bytes]`. The `handle_connection()` method in `ClientManager` calls `websocket.send(snapshot)` — the websockets library handles binary frames when given `bytes`.

## Implementation Details

### protocol.py — Serialization Functions

```python
# Message type constants
SNAPSHOT: int = 0x01
STATE_UPDATE: int = 0x02

def serialize_state_update(
    tick_number: int,
    entity_count: int,
    state: AgentState,
) -> bytes:
    """Serialize a per-tick state update to binary."""
    ...

def serialize_snapshot(
    tick_number: int,
    world_bounds: WorldBoundsConfig,
    entity_count: int,
    state: AgentState,
) -> bytes:
    """Serialize a full state snapshot to binary."""
    ...

def deserialize_message(buffer: bytes) -> tuple[int, dict]:
    """Deserialize a binary message, dispatching by type byte."""
    ...
```

Implementation uses Python's `struct` module for the fixed-size header fields and `ndarray.tobytes()` / `np.frombuffer()` for array sections. No external dependencies.

### clients.py — Modifications

**`broadcast()`** — Replace the `json.dumps({...})` block with a call to `protocol.serialize_state_update()`. The result is `bytes` instead of `str`.

**`make_snapshot_builder()`** — Replace the `json.dumps({...})` in the inner `build_snapshot()` with `protocol.serialize_snapshot()`. Return type becomes `Callable[[int], bytes]`.

**`ClientConnection`** — Queue type annotation changes to `asyncio.Queue[bytes]`.

**`_relay()`** — No functional change. `websocket.send(message)` works with both `str` and `bytes`.

### server.py — Minimal Changes

The `snapshot_builder` variable type changes from `Callable[[int], str]` to `Callable[[int], bytes]`. No other changes needed — the snapshot builder is called, its result is sent, and `websocket.send()` handles binary.

## Integration Points

### Provides to Other Slices

- **`protocol.py` serialization functions** — Slice 307 (Logging and Replay) imports `serialize_state_update()` and `deserialize_message()` to write and read simulation state logs. The binary format is the canonical state representation on disk.
- **Message type constants** — Future slices adding new message types (client commands, metadata) extend the type discriminator range without changing existing serialization code.
- **Binary wire protocol** — Slice 309 (Client Spatial Culling) can build per-client binary messages using the same serialization functions with filtered entity subsets.

### Consumes from Other Slices

- **(305) WebSocket Client Layer** — `ClientManager`, `ClientConnection`, `make_snapshot_builder()`, `_relay()`, and the WebSocket server lifecycle
- **(302) Entity Management** — `EntityManager`, `AgentState` arrays
- **(300) Server Bootstrap** — `ServerConfig`, `WorldBoundsConfig`

## Success Criteria

### Functional Requirements
- State updates are sent as binary WebSocket frames (not text)
- Snapshots are sent as binary WebSocket frames on client connection
- Deserialization reconstructs NumPy arrays identical to the originals (positions, velocities, profile_indices for snapshots; positions, velocities for updates)
- Existing WebSocket integration tests pass with binary protocol (updated assertions)
- Zero-entity edge case: serialization produces valid minimal messages, deserialization returns empty arrays
- Message type byte correctly discriminates between snapshot and state update

### Technical Requirements
- `protocol.py` has no dependency on asyncio, websockets, or server internals — pure data transformation
- Round-trip tests (serialize → deserialize → compare) for both message types
- Edge case tests: zero entities, single entity, large entity count
- Existing server integration tests updated for binary protocol
- No new external dependencies (uses only `struct` and `numpy`)

### Verification Walkthrough

1. **Unit tests pass:**
   ```
   uv run pytest tests/ -v -k protocol
   ```
   All protocol round-trip and edge case tests pass.

2. **Full test suite passes:**
   ```
   uv run pytest tests/ -v
   ```
   All existing tests pass (WebSocket integration tests updated for binary).

3. **Server starts and clients receive binary messages:**
   ```
   uv run python -m migratory_server
   ```
   Connect a WebSocket client (e.g., `websocat`). First message is a binary frame (snapshot). Subsequent messages are binary frames (state updates). Verify with:
   ```
   websocat -b ws://127.0.0.1:8765
   ```
   Binary output confirms non-text frames.

4. **Round-trip verification in Python:**
   ```python
   from migratory_server.protocol import serialize_state_update, deserialize_message
   # Build a test state, serialize, deserialize, compare arrays
   ```
   Positions and velocities match exactly (binary round-trip is lossless for IEEE 754 floats).

## Implementation Notes

### Development Approach

Suggested order:

1. **Protocol module** — Create `protocol.py` with message type constants, `serialize_state_update()`, `serialize_snapshot()`, and `deserialize_message()`. Write round-trip unit tests.
2. **Client layer update** — Update `clients.py`: change `broadcast()` and `make_snapshot_builder()` to use protocol functions. Update queue type annotation.
3. **Server integration** — Update `server.py` type annotations. Update WebSocket integration tests for binary messages.
4. **Edge cases and finalization** — Zero-entity tests, large-count tests. Full suite verification.

### Special Considerations

- **WebSocket integration test updates** — Tests in `test_server.py` currently parse messages with `json.loads()`. These must switch to `protocol.deserialize_message()`. The assertions check the same fields but through the binary protocol's deserialized dict.
- **`test_clients.py` updates** — Tests that inspect queued messages or snapshot output must expect `bytes` instead of `str`. Deserialization through `protocol.deserialize_message()` enables the same logical assertions.
- **Tick number range** — `uint32` supports tick numbers up to ~4.29 billion. At 20 Hz, that's ~6.8 years of continuous operation. Sufficient for v1.
- **Entity count range** — `uint32` supports up to ~4.29 billion entities. Well beyond the 10K-50K operating range.
- **Backward compatibility** — This is a breaking protocol change. There are no deployed clients depending on the JSON format. The JSON format exists only in the test suite, which is updated alongside the protocol change.
