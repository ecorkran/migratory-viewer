/**
 * ViewerState singleton and mutation helpers.
 *
 * Ownership rule: only `src/net/connection.ts` calls `applySnapshot` and
 * `applyStateUpdate`. Every other module reads `viewerState` but must not
 * mutate it directly. This keeps the data flow one-directional and easy to
 * reason about.
 */

import { createInitialViewerState, type ViewerState } from './types';
import type { ParsedSnapshot, ParsedStateUpdate } from './protocol/types';

export const viewerState: ViewerState = createInitialViewerState();

/** Apply a SNAPSHOT message: replace world bounds, entity count, and all per-entity arrays. */
export function applySnapshot(state: ViewerState, parsed: ParsedSnapshot): void {
  state.worldWidth = parsed.worldWidth;
  state.worldHeight = parsed.worldHeight;
  state.entityCount = parsed.entityCount;
  state.positions = parsed.positions;
  state.velocities = parsed.velocities;
  state.profileIndices = parsed.profileIndices;
  state.currentTick = parsed.tick;
}

/**
 * Apply a STATE_UPDATE message: copy positions/velocities into existing buffers
 * (no reallocation). On length mismatch, log and return early — the caller
 * should force a reconnect to receive a fresh snapshot.
 */
export function applyStateUpdate(state: ViewerState, parsed: ParsedStateUpdate): void {
  if (
    state.positions === null ||
    state.velocities === null ||
    state.positions.length !== parsed.positions.length
  ) {
    console.warn(
      `[state] state update length mismatch: state has ${state.positions?.length ?? 'null'} floats, update has ${parsed.positions.length}`,
    );
    return;
  }
  state.positions.set(parsed.positions);
  state.velocities.set(parsed.velocities);
  state.currentTick = parsed.tick;
}
