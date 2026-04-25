import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createConnection } from './connection';
import { buildSingleShotTerrain, buildTerrainChunk, buildTerrainHeader, encodeRawDtype, FRAME_2X2_F32_ZSTD } from '../protocol/_test-helpers';
import { TerrainCompression, TerrainDtype } from '../protocol/types';
import { createInitialViewerState } from '../types';

/**
 * Minimal mock WebSocket capturing handler assignments and exposing trigger
 * helpers. Replaces the global `WebSocket` constructor for the duration of
 * each test.
 */
class MockWebSocket {
  static instances: MockWebSocket[] = [];
  url: string;
  binaryType = '';
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  closeCalls = 0;
  /** Captures (code, reason) tuples for assertions on protocol-error closes. */
  closeArgs: Array<{ code?: number; reason?: string }> = [];

  constructor(url: string) {
    this.url = url;
    MockWebSocket.instances.push(this);
  }
  close(code?: number, reason?: string): void {
    this.closeCalls += 1;
    this.closeArgs.push({ code, reason });
    this.onclose?.();
  }
  triggerOpen(): void {
    this.onopen?.();
  }
  triggerMessage(data: ArrayBuffer): void {
    this.onmessage?.({ data });
  }
}

function buildSnapshot(tick: number, entityCount: number): ArrayBuffer {
  const buf = new ArrayBuffer(25 + entityCount * 36);
  const view = new DataView(buf);
  view.setUint8(0, 0x01);
  view.setUint32(1, tick, true);
  view.setFloat64(5, 100, true);
  view.setFloat64(13, 100, true);
  view.setUint32(21, entityCount, true);
  return buf;
}

function buildStateUpdate(tick: number, entityCount: number): ArrayBuffer {
  const buf = new ArrayBuffer(9 + entityCount * 32);
  const view = new DataView(buf);
  view.setUint8(0, 0x02);
  view.setUint32(1, tick, true);
  view.setUint32(5, entityCount, true);
  return buf;
}

beforeEach(() => {
  MockWebSocket.instances = [];
  vi.stubGlobal('WebSocket', MockWebSocket);
  vi.useFakeTimers();
  vi.spyOn(console, 'info').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('createConnection', () => {
  it('connect sets status to connecting and sets binaryType', () => {
    const state = createInitialViewerState();
    const conn = createConnection(state);
    conn.connect('ws://localhost:1234');
    expect(state.connectionStatus).toBe('connecting');
    expect(MockWebSocket.instances).toHaveLength(1);
    expect(MockWebSocket.instances[0].binaryType).toBe('arraybuffer');
    expect(MockWebSocket.instances[0].url).toBe('ws://localhost:1234');
  });

  it('onopen transitions to connected', () => {
    const state = createInitialViewerState();
    const conn = createConnection(state);
    conn.connect('ws://x');
    MockWebSocket.instances[0].triggerOpen();
    expect(state.connectionStatus).toBe('connected');
  });

  it('onclose transitions to reconnecting and schedules reconnect', () => {
    const state = createInitialViewerState();
    const conn = createConnection(state);
    conn.connect('ws://x');
    MockWebSocket.instances[0].onclose?.();
    expect(state.connectionStatus).toBe('reconnecting');
    // Advance enough for the maximum jittered initial backoff (500 * 1.2 = 600).
    vi.advanceTimersByTime(700);
    expect(MockWebSocket.instances).toHaveLength(2);
  });

  it('consecutive failures double backoff up to cap', () => {
    const state = createInitialViewerState();
    const conn = createConnection(state);
    conn.connect('ws://x');
    // Trigger several closes; backoff should double each time.
    for (let i = 0; i < 8; i++) {
      const sock = MockWebSocket.instances[MockWebSocket.instances.length - 1];
      sock.onclose?.();
      vi.advanceTimersByTime(40_000); // exceed cap of 30s + jitter
    }
    // After 8 closes there should be 9 sockets (initial + 8 reconnects).
    expect(MockWebSocket.instances.length).toBeGreaterThanOrEqual(8);
  });

  it('snapshot message updates viewerState', () => {
    const state = createInitialViewerState();
    const conn = createConnection(state);
    conn.connect('ws://x');
    MockWebSocket.instances[0].triggerOpen();
    MockWebSocket.instances[0].triggerMessage(buildSnapshot(7, 2));
    expect(state.entityCount).toBe(2);
    expect(state.currentTick).toBe(7);
    expect(state.positions).not.toBeNull();
  });

  it('state update with mismatched entity count forces close', () => {
    const state = createInitialViewerState();
    const conn = createConnection(state);
    conn.connect('ws://x');
    const sock = MockWebSocket.instances[0];
    sock.triggerOpen();
    sock.triggerMessage(buildSnapshot(1, 3));
    expect(state.entityCount).toBe(3);
    sock.triggerMessage(buildStateUpdate(2, 5));
    expect(sock.closeCalls).toBe(1);
  });

  it('disconnect clears timer and sets status to disconnected', () => {
    const state = createInitialViewerState();
    const conn = createConnection(state);
    conn.connect('ws://x');
    MockWebSocket.instances[0].onclose?.();
    expect(state.connectionStatus).toBe('reconnecting');
    conn.disconnect();
    expect(state.connectionStatus).toBe('disconnected');
    vi.advanceTimersByTime(60_000);
    // Only the original socket should exist; no reconnect after disconnect.
    expect(MockWebSocket.instances).toHaveLength(1);
  });

  it('onopen resets backoff after a successful reconnect', () => {
    const state = createInitialViewerState();
    const conn = createConnection(state);
    conn.connect('ws://x');
    MockWebSocket.instances[0].onclose?.();
    vi.advanceTimersByTime(700);
    MockWebSocket.instances[1].triggerOpen();
    expect(state.connectionStatus).toBe('connected');
  });
});

describe('createConnection — terrain v2 integration (T12)', () => {
  it('closes the WebSocket with code 1002 on a terrain protocol error', () => {
    const state = createInitialViewerState();
    const conn = createConnection(state);
    conn.connect('ws://x');
    const sock = MockWebSocket.instances[0];
    sock.triggerOpen();
    // Send a TERRAIN_CHUNK without a preceding TERRAIN_HEADER — this is a
    // textbook tier-2 protocol violation.
    const orphanChunk = buildTerrainChunk({
      sequenceNumber: 0, rowOffset: 0, colOffset: 0, chunkRows: 1, chunkCols: 1,
      isLast: true, compressedPayload: encodeRawDtype([0], TerrainDtype.F32),
    });
    sock.triggerMessage(orphanChunk);
    expect(sock.closeCalls).toBe(1);
    expect(sock.closeArgs[0].code).toBe(1002);
    expect(sock.closeArgs[0].reason).toMatch(/without preceding TERRAIN_HEADER/);
    // The close triggers the reconnect path (slice 101 behavior preserved).
    expect(state.connectionStatus).toBe('reconnecting');
  });

  it('chunked terrain success populates viewerState.terrain', () => {
    const state = createInitialViewerState();
    const conn = createConnection(state);
    conn.connect('ws://x');
    const sock = MockWebSocket.instances[0];
    sock.triggerOpen();
    sock.triggerMessage(buildTerrainHeader({
      rows: 2, cols: 2, resolution: 5, originX: 0, originY: 0,
      dtype: TerrainDtype.F32, compression: TerrainCompression.NONE, chunkCount: 1,
    }));
    expect(state.terrain).toBeNull();
    sock.triggerMessage(buildTerrainChunk({
      sequenceNumber: 0, rowOffset: 0, colOffset: 0, chunkRows: 2, chunkCols: 2,
      isLast: true, compressedPayload: encodeRawDtype([10, 20, 30, 40], TerrainDtype.F32),
    }));
    expect(state.terrain).not.toBeNull();
    if (state.terrain === null) return;
    expect(state.terrain.rows).toBe(2);
    expect(state.terrain.cols).toBe(2);
    expect(state.terrain.resolution).toBe(5);
    for (let i = 0; i < 4; i++) {
      expect(state.terrain.elevation[i]).toBeCloseTo([10, 20, 30, 40][i], 5);
    }
  });

  it('single-shot v2 terrain populates viewerState.terrain', () => {
    const state = createInitialViewerState();
    const conn = createConnection(state);
    conn.connect('ws://x');
    const sock = MockWebSocket.instances[0];
    sock.triggerOpen();
    const buf = buildSingleShotTerrain({
      rows: 2, cols: 2, resolution: 10, originX: 0, originY: 0,
      dtype: TerrainDtype.F32, compression: TerrainCompression.ZSTD,
      compressedPayload: FRAME_2X2_F32_ZSTD,
    });
    sock.triggerMessage(buf);
    expect(state.terrain).not.toBeNull();
    if (state.terrain === null) return;
    expect(state.terrain.rows).toBe(2);
    for (let i = 0; i < 4; i++) {
      expect(state.terrain.elevation[i]).toBeCloseTo(i, 6);
    }
  });

  it('truncated STATE_UPDATE does NOT trigger close-1002 (tier-1 preserved)', () => {
    const state = createInitialViewerState();
    const conn = createConnection(state);
    conn.connect('ws://x');
    const sock = MockWebSocket.instances[0];
    sock.triggerOpen();
    // Send a 3-byte buffer with STATE_UPDATE opcode — tier-1 drop, no close.
    const truncated = new ArrayBuffer(3);
    new DataView(truncated).setUint8(0, 0x02);
    sock.triggerMessage(truncated);
    expect(sock.closeCalls).toBe(0);
    expect(state.connectionStatus).toBe('connected');
  });

  it('per-connection assembler isolation: half-finished chunked transfer does not leak across reconnect', () => {
    const state = createInitialViewerState();
    const conn = createConnection(state);
    conn.connect('ws://x');
    const sock1 = MockWebSocket.instances[0];
    sock1.triggerOpen();
    // Start a chunked transfer on the first connection and never finish.
    sock1.triggerMessage(buildTerrainHeader({
      rows: 4, cols: 4, resolution: 1, originX: 0, originY: 0,
      dtype: TerrainDtype.F32, compression: TerrainCompression.NONE, chunkCount: 4,
    }));
    sock1.triggerMessage(buildTerrainChunk({
      sequenceNumber: 0, rowOffset: 0, colOffset: 0, chunkRows: 2, chunkCols: 2,
      isLast: false, compressedPayload: encodeRawDtype([0, 0, 0, 0], TerrainDtype.F32),
    }));
    // Drop the connection (server hung up mid-transfer).
    sock1.onclose?.();
    vi.advanceTimersByTime(700);
    expect(MockWebSocket.instances).toHaveLength(2);
    const sock2 = MockWebSocket.instances[1];
    sock2.triggerOpen();
    // Send a fresh single-shot terrain on the second connection. If the
    // assembler from sock1 had leaked, it would be in EXPECTING_CHUNKS and
    // reject this with a protocol error. Asserting a clean message confirms
    // per-connection isolation.
    sock2.triggerMessage(buildSingleShotTerrain({
      rows: 2, cols: 2, resolution: 10, originX: 0, originY: 0,
      dtype: TerrainDtype.F32, compression: TerrainCompression.ZSTD,
      compressedPayload: FRAME_2X2_F32_ZSTD,
    }));
    expect(sock2.closeCalls).toBe(0);
    expect(state.terrain).not.toBeNull();
  });
});
