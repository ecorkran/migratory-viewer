"""Binary wire protocol for migratory server state messages."""

from __future__ import annotations

import struct

import numpy as np
from numpy.typing import NDArray

from migratory.engine.state import AgentState
from migratory_server.config import WorldBoundsConfig

# Message type constants
SNAPSHOT: int = 0x01
STATE_UPDATE: int = 0x02


def serialize_state_update(
    tick_number: int,
    entity_count: int,
    state: AgentState,
) -> bytes:
    """Serialize a per-tick state update to binary.

    Format: [type_u8 | tick_u32 | count_u32 | positions_f64 | velocities_f64]
    Total size: 9 + entity_count * 32 bytes.
    """
    header = struct.pack("<BII", STATE_UPDATE, tick_number, entity_count)
    positions = np.ascontiguousarray(state.positions[:entity_count])
    velocities = np.ascontiguousarray(state.velocities[:entity_count])
    return header + positions.tobytes() + velocities.tobytes()


def serialize_snapshot(
    tick_number: int,
    world_bounds: WorldBoundsConfig,
    entity_count: int,
    state: AgentState,
) -> bytes:
    """Serialize a full state snapshot to binary.

    Format: [type_u8 | tick_u32 | width_f64 | height_f64 | count_u32
             | positions_f64 | velocities_f64 | profile_indices_i32]
    Total size: 25 + entity_count * 36 bytes.
    """
    header = struct.pack(
        "<BIddI",
        SNAPSHOT,
        tick_number,
        world_bounds.width,
        world_bounds.height,
        entity_count,
    )
    positions = np.ascontiguousarray(state.positions[:entity_count])
    velocities = np.ascontiguousarray(state.velocities[:entity_count])
    profile_indices = np.ascontiguousarray(state.profile_indices[:entity_count])
    return header + positions.tobytes() + velocities.tobytes() + profile_indices.tobytes()


def deserialize_message(buffer: bytes) -> tuple[int, dict]:
    """Deserialize a binary message, dispatching by type byte.

    Returns a (message_type, data_dict) tuple. Arrays in data_dict are
    NumPy arrays reconstructed from the raw buffer.

    Raises ValueError for unknown message type bytes.
    """
    msg_type = buffer[0]

    if msg_type == STATE_UPDATE:
        tick, entity_count = struct.unpack_from("<II", buffer, 1)
        positions: NDArray[np.float64] = np.frombuffer(
            buffer, dtype="<f8", count=entity_count * 2, offset=9
        ).reshape(entity_count, 2)
        vel_offset = 9 + entity_count * 16
        velocities: NDArray[np.float64] = np.frombuffer(
            buffer, dtype="<f8", count=entity_count * 2, offset=vel_offset
        ).reshape(entity_count, 2)
        return (
            STATE_UPDATE,
            {
                "tick": tick,
                "entity_count": entity_count,
                "positions": positions,
                "velocities": velocities,
            },
        )

    if msg_type == SNAPSHOT:
        tick, width, height, entity_count = struct.unpack_from("<IddI", buffer, 1)
        positions = np.frombuffer(
            buffer, dtype="<f8", count=entity_count * 2, offset=25
        ).reshape(entity_count, 2)
        vel_offset = 25 + entity_count * 16
        velocities = np.frombuffer(
            buffer, dtype="<f8", count=entity_count * 2, offset=vel_offset
        ).reshape(entity_count, 2)
        idx_offset = 25 + entity_count * 32
        profile_indices: NDArray[np.int32] = np.frombuffer(
            buffer, dtype="<i4", count=entity_count, offset=idx_offset
        )
        return (
            SNAPSHOT,
            {
                "tick": tick,
                "world_width": width,
                "world_height": height,
                "entity_count": entity_count,
                "positions": positions,
                "velocities": velocities,
                "profile_indices": profile_indices,
            },
        )

    raise ValueError(f"Unknown message type: {msg_type:#04x}")
