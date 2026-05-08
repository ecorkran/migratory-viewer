/**
 * ViewerState singleton and mutation helpers.
 *
 * Ownership rule: only `src/net/connection.ts` calls `applySnapshot` and
 * `applyStateUpdate`. Every other module reads `viewerState` but must not
 * mutate it directly. This keeps the data flow one-directional and easy to
 * reason about.
 */

import { createInitialViewerState, type TerrainGrid, type ViewerState } from './types';
import type { ParsedSnapshot, ParsedStateUpdate, ParsedTerrain } from './protocol/types';
import { getTerrainHeight } from './rendering/terrain';

export const viewerState: ViewerState = createInitialViewerState();

/** Recompute entityHeights from current positions and terrain. No-op if positions or heights are null. */
function bakeEntityHeights(state: ViewerState): void {
  if (state.positions === null || state.entityHeights === null) return;
  for (let i = 0; i < state.entityCount; i++) {
    const x = state.positions[i * 2];
    const y = state.positions[i * 2 + 1];
    state.entityHeights[i] = getTerrainHeight(state.terrain, x, y);
  }
}

/**
 * Apply a SNAPSHOT message: replace world bounds, entity count, and all
 * per-entity arrays. Detaches via `.slice()` because slice 115's parser
 * returns views aliasing the WebSocket message buffer, which the browser
 * reuses on the next `onmessage`. `.slice()` on a typed-array view returns
 * a new typed array of the same kind (Float32→Float32, Float64→Float64,
 * Int32→Int32) backed by its own ArrayBuffer — exactly the detach we need,
 * with no explicit branch on dtype.
 */
export function applySnapshot(state: ViewerState, parsed: ParsedSnapshot): void {
  state.worldWidth = parsed.worldWidth;
  state.worldHeight = parsed.worldHeight;
  state.entityCount = parsed.entityCount;
  state.positions = parsed.positions.slice();
  state.velocities = parsed.velocities.slice();
  state.profileIndices = parsed.profileIndices.slice();
  state.currentTick = parsed.tick;
  state.entityHeights = new Float32Array(parsed.entityCount);
  bakeEntityHeights(state);
}

/** Apply a TERRAIN message: store the elevation grid and increment the revision counter. */
export function applyTerrain(state: ViewerState, parsed: ParsedTerrain): void {
  const grid: TerrainGrid = {
    rows: parsed.rows,
    cols: parsed.cols,
    resolution: parsed.resolution,
    originX: parsed.originX,
    originY: parsed.originY,
    elevation: parsed.elevation,
  };
  state.terrain = grid;
  state.terrainRevision += 1;
  if (state.positions !== null && state.entityHeights !== null) {
    bakeEntityHeights(state);
  }
}

/**
 * Apply a STATE_UPDATE message: copy positions/velocities into existing buffers
 * (no reallocation). On length mismatch, log and return early — the caller
 * should force a reconnect to receive a fresh snapshot.
 *
 * If the dtype changes mid-connection (e.g. f64 snapshot followed by f32 update),
 * the buffers are replaced rather than copied to avoid silent precision truncation.
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

  if (state.positions.constructor !== parsed.positions.constructor) {
    // dtype switch mid-connection: replace buffers rather than copy cross-dtype
    console.warn('[state] position dtype changed mid-connection — replacing buffers');
    state.positions = parsed.positions;
    state.velocities = parsed.velocities;
  } else {
    state.positions.set(parsed.positions);
    state.velocities.set(parsed.velocities);
  }
  state.currentTick = parsed.tick;
  bakeEntityHeights(state);
}
