---
docType: slice-design
slice: entity-position-dtype-negotiation-f32-f64
project: migratory-viewer
parent: user/architecture/100-slices.viewer-foundation.md
dependencies: [101-slice.websocket-consumer-and-live-entity-rendering]
interfaces: [113-slice.entity-pipeline-performance]
dateCreated: 20260506
dateUpdated: 20260506
status: in_progress
---

# Slice Design: Entity Position dtype Negotiation (f32/f64)

## Overview

The migratory server has introduced a per-message dtype flag byte that declares whether entity positions and velocities are encoded as `float32` or `float64`. This slice updates the viewer to read that flag and branch accordingly, producing the correct typed array for each dtype. All downstream consumers (`ViewerState`, `state.ts`, `rendering/entities.ts`) accept the resulting union type with no rendering-path changes — Three.js `BufferAttribute` accepts both natively.

## Value

**Bandwidth reduction (architectural).** The f32 wire path halves per-tick payload size: at 10k entities, STATE_UPDATE drops from ~312 KB to ~156 KB. This directly reduces WebSocket throughput and positions the viewer for the performance work in slice 113.

**Server transition safety.** The server signals dtype per-message via `ServerConfig.simulation.agent_wire_dtype`. The viewer never negotiates or requests a dtype — it reads the flag on each message and adapts. Both dtypes must be supported simultaneously during any server-side rollout. Without this slice, the viewer silently misinterprets f32 payloads as f64 (wrong coordinates, broken rendering).

## Technical Scope

**Included:**
- `PositionDtype` constant in `protocol/types.ts`
- dtype flag read + offset shift in `parseSnapshot` and `parseStateUpdate` in `protocol/deserialize.ts`
- Union type `Float32Array | Float64Array` on `positions`/`velocities` in `ParsedSnapshot`, `ParsedStateUpdate`, `ViewerState`
- `applyStateUpdate` in `state.ts`: handle both typed array types
- `rendering/entities.ts`: accept union type (no logic change needed)
- Unit tests: parse f32 and f64 fixtures for both message types; unknown dtype → null

**Excluded:**
- Zero-copy buffer optimization (slice 113)
- Server-side changes
- dtype flag for terrain messages (already handled by `TerrainDtype`)
- Any UI indication of which dtype is active

## Dependencies

### Prerequisites
- **Slice 101** — establishes `parseSnapshot`, `parseStateUpdate`, `ViewerState`, and `applyStateUpdate`. This slice modifies all four.

### External
- migratory server f32 entity wire update — the server inserts the dtype flag byte at the offsets defined below. The server has already pushed this change.

## Architecture

### Wire Format Changes

The flag byte is inserted into both message types at a single well-defined offset. All fields after the flag shift by one byte.

**SNAPSHOT (0x01) — before (25-byte header):**
```
[u8 type=0x01 | u32 tick | f64 worldWidth | f64 worldHeight | u32 entityCount | payload...]
 0              1           5               13                21                25
```

**SNAPSHOT (0x01) — after (26-byte header):**
```
[u8 type | u32 tick | f64 worldWidth | f64 worldHeight | u32 entityCount | u8 dtype | payload...]
 0         1          5               13                21                 25         26
```

**STATE_UPDATE (0x02) — before (9-byte header):**
```
[u8 type=0x02 | u32 tick | u32 entityCount | payload...]
 0              1           5                9
```

**STATE_UPDATE (0x02) — after (10-byte header):**
```
[u8 type | u32 tick | u32 entityCount | u8 dtype | payload...]
 0         1          5                 9          10
```

**Payload widths by dtype:**

| dtype | PositionDtype value | bytes/component | bytes/entity (pos+vel = 2×2 components) |
|---|---|---|---|
| f64 | 0x00 | 8 | 32 |
| f32 | 0x01 | 4 | 16 |

Profile indices (SNAPSHOT only) remain `Int32Array` — 4 bytes/entity — and are unaffected by the dtype flag.

**Expected total bytes:**

| message | f64 | f32 |
|---|---|---|
| SNAPSHOT | `26 + entityCount × (32 + 4)` = `26 + N×36` | `26 + entityCount × (16 + 4)` = `26 + N×20` |
| STATE_UPDATE | `10 + entityCount × 32` | `10 + entityCount × 16` |

### Component Changes

**`protocol/types.ts`** — add `PositionDtype` constant and widen interface declarations:

```typescript
export const PositionDtype = {
  F64: 0x00,
  F32: 0x01,
} as const;

export type PositionDtypeValue = (typeof PositionDtype)[keyof typeof PositionDtype];
```

`ParsedSnapshot.positions`, `ParsedSnapshot.velocities`, `ParsedStateUpdate.positions`, `ParsedStateUpdate.velocities`: change from `Float64Array` to `Float32Array | Float64Array`.

**`protocol/deserialize.ts`** — the header constants and parse logic change as follows:

| Symbol | Old value | New value |
|---|---|---|
| `SNAPSHOT_HEADER_BYTES` | 25 | 26 |
| `SNAPSHOT_PER_ENTITY_BYTES_F64` | 36 | 36 (pos+vel=32, idx=4) |
| `SNAPSHOT_PER_ENTITY_BYTES_F32` | — | 20 (pos+vel=16, idx=4) |
| `STATE_UPDATE_HEADER_BYTES` | 9 | 10 |
| `STATE_UPDATE_PER_ENTITY_BYTES_F64` | 32 | 32 |
| `STATE_UPDATE_PER_ENTITY_BYTES_F32` | — | 16 |

The old `*_PER_ENTITY_BYTES` scalars become dtype-specific pairs; `expectedBytes` is computed after reading the dtype flag.

Read dtype at the documented offset; validate against `PositionDtype`; on unknown value: `console.warn` + return `null` (tier-1, same as other per-tick parse failures). Branch on dtype to build `Float32Array` or `Float64Array`. Position/velocity offsets advance by the correct per-entity width.

**`src/types.ts`** — `ViewerState.positions` and `ViewerState.velocities`: `Float64Array | null` → `Float32Array | Float64Array | null`.

**`src/state.ts`** — `applyStateUpdate`: the existing `state.positions.set(parsed.positions)` call works when both arrays share the same element type, but fails silently when dtypes differ across ticks (f64 state buffer receiving f32 update, or vice versa). The correct behavior:

- On snapshot, `state.positions` is assigned directly from the parsed snapshot (no copy needed in this slice — slice 113 handles zero-copy optimization).
- On state update, if `state.positions` type matches `parsed.positions` type AND lengths match: call `.set()` as today.
- If lengths match but types differ (dtype switch mid-connection): reassign rather than copy — replace `state.positions` and `state.velocities` with the new parsed arrays. This is a valid edge case during server rollout. Log a one-time warning.
- If lengths differ: existing reconnect warning path is unchanged.

`applySnapshot` already replaces positions/velocities entirely — no change needed there beyond the type widening.

**`src/rendering/entities.ts`** — `positions` and `velocities` are accessed via numeric indexing (`positions[i * 2]`). Both `Float32Array` and `Float64Array` support this identically. The parameter type annotation widens to `Float32Array | Float64Array`; no logic changes.

### Data Flow (updated)

```
WebSocket binary frame
  → parseSnapshot / parseStateUpdate
      → read dtype flag at offset 25 (SNAPSHOT) or 9 (STATE_UPDATE)
      → validate against PositionDtype; unknown → null
      → compute expectedBytes using dtype-specific per-entity width
      → validate buffer length
      → construct Float32Array | Float64Array for positions/velocities
      → return ParsedSnapshot | ParsedStateUpdate
  → connection.ts → applySnapshot / applyStateUpdate
      → ViewerState.positions/velocities: Float32Array | Float64Array
  → rendering/entities.ts: updateEntities
      → positions[i * 2] — works for both Float32Array and Float64Array
      → Three.js InstancedMesh.setMatrixAt — unaffected
```

## Integration Points

### Provides to Other Slices

- **Slice 113 (Entity Pipeline Performance):** The union type `Float32Array | Float64Array` on `ViewerState.positions/velocities` is the interface that slice 113's zero-copy path will produce. Designing it here means slice 113 needs no type changes.

### Consumes from Other Slices

- Slice 101 establishes the parse functions and `ViewerState`. This slice modifies them in place.

## Success Criteria

### Functional Requirements

- `parseSnapshot` returns `ParsedSnapshot` with `Float32Array` positions/velocities when dtype flag is `0x01` (F32), and `Float64Array` when `0x00` (F64).
- `parseStateUpdate` same behavior.
- Unknown dtype values produce `null` with a console warning; the viewer does not disconnect (tier-1).
- `ViewerState.positions/velocities` hold whichever typed array the latest message produced.
- `applyStateUpdate` correctly handles a dtype switch mid-connection without crashing.
- Entities render at correct positions under both dtypes (visual correctness unchanged).
- All 121 existing tests continue to pass.

### Technical Requirements

- `PositionDtype` constant defined in `protocol/types.ts` alongside `TerrainDtype`.
- No raw hex literals for dtype values outside the `PositionDtype` definition.
- Header byte constants updated to reflect the new 26/10-byte header sizes.
- `expectedBytes` validation uses dtype-specific per-entity width.
- New unit tests cover: f64 snapshot round-trip, f32 snapshot round-trip, f64 state update round-trip, f32 state update round-trip, unknown dtype → null for each message type.

### Verification Walkthrough

**1. Run the test suite — all tests pass:**
```
pnpm test
```
Actual output (2026-05-06):
```
Test Files  9 passed (9)
     Tests  127 passed (127)
  Start at  12:47:47
  Duration  388ms
```
121 pre-existing tests pass. 6 new tests added: f32 snapshot round-trip, unknown snapshot dtype, f64 state update round-trip (explicit), f32 state update round-trip, unknown state update dtype, dtype-switch via `applyStateUpdate`, same-dtype copy path.

**2. Connect viewer to a server sending f32 entities:**

Start the migratory server with `agent_wire_dtype = "f32"` in config. Start the viewer:
```
pnpm dev
```
Open the viewer in a browser. Entities should render at their correct positions — same visual output as before. The browser console should show no warnings about dtype.

**3. Verify bandwidth reduction (optional):**

Open Chrome DevTools → Network → WS connection. Observe STATE_UPDATE frame sizes. At 10k entities:
- f64: frames are ~312 KB each (header 10 + 10000 × 32 = 320010 bytes)
- f32: frames are ~156 KB each (header 10 + 10000 × 16 = 160010 bytes)

**4. Verify unknown dtype handling (covered by automated tests):**

Tests in `src/protocol/deserialize.test.ts` verify that setting the dtype byte to `0xFF` causes both `parseSnapshot` and `parseStateUpdate` to return `null` and emit `console.warn('[protocol] unknown position dtype: 0xff')`.

**5. Verify backward compatibility (f64 server):**

Connect to a server still sending f64. Entities render identically to pre-slice behavior. The dtype flag byte is `0x00` (F64), so the new code path selects `Float64Array` — exactly as before the slice.

## Implementation Notes

### Development Approach

Suggested order:
1. Add `PositionDtype` to `protocol/types.ts`; update `ParsedSnapshot` and `ParsedStateUpdate` interface field types
2. Update header byte constants and parse logic in `protocol/deserialize.ts`
3. Update `ViewerState` in `src/types.ts`
4. Update `applyStateUpdate` in `src/state.ts`
5. Widen types in `rendering/entities.ts`
6. Update existing snapshot/state-update unit tests; add new f32/unknown-dtype tests

The TypeScript compiler will flag every place where the old `Float64Array` type is assumed — use those errors as a complete checklist of required changes. Do not suppress them with casts.

### Special Considerations

**`applyStateUpdate` dtype switch:** the `.set()` method on a typed array copies values element-by-element and requires the source to be assignment-compatible. `Float64Array.set(Float32Array)` is valid (TypeScript allows it; values are upcast). `Float32Array.set(Float64Array)` is also valid but silently truncates precision. The safer approach on a dtype switch is to replace the buffer entirely (as described above) rather than rely on `.set()` cross-dtype behavior. Slice 113 will revisit this when zero-copy is introduced.
