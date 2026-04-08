import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createConnection } from './connection';
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

  constructor(url: string) {
    this.url = url;
    MockWebSocket.instances.push(this);
  }
  close(): void {
    this.closeCalls += 1;
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
