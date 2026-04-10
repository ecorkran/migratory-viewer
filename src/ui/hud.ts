import './hud.css';
import type { ViewerState, ConnectionStatus } from '../types';
import config from '../config';

/** Cached DOM references for the HUD elements updated each frame. */
export interface HudElements {
  container: HTMLDivElement;
  connectionDot: HTMLSpanElement;
  connectionLabel: HTMLSpanElement;
  tickValue: HTMLSpanElement;
  entityCountValue: HTMLSpanElement;
  fpsValue: HTMLSpanElement;
  tpsValue: HTMLSpanElement;
  profileSection: HTMLDivElement;
}

/** Map connection status to the corresponding CSS dot class. */
const DOT_CLASS: Record<ConnectionStatus, string> = {
  connected: 'hud-connection-dot dot-connected',
  connecting: 'hud-connection-dot dot-connecting',
  reconnecting: 'hud-connection-dot dot-reconnecting',
  disconnected: 'hud-connection-dot dot-disconnected',
};

// --- Module-level state for updateHud ---
let smoothFps = 0;
let lastConnectionStatus: ConnectionStatus | null = null;
let cachedEntityCount = -1;
let lastTick = -1;
const tickTimestamps: number[] = [];

/** Create the HUD DOM elements and attach to the document. */
export function createHud(): HudElements {
  const container = document.createElement('div');
  container.id = 'hud';

  // --- Connection status section ---
  const statusSection = document.createElement('div');
  statusSection.className = 'hud-section hud-status';

  const connectionDot = document.createElement('span');
  connectionDot.className = 'hud-connection-dot dot-disconnected';

  const connectionLabel = document.createElement('span');
  connectionLabel.className = 'hud-connection-label';
  connectionLabel.textContent = 'disconnected';

  statusSection.appendChild(connectionDot);
  statusSection.appendChild(connectionLabel);

  // --- Stats section ---
  const statsSection = document.createElement('div');
  statsSection.className = 'hud-section hud-stats';

  const tickRow = document.createElement('div');
  const tickValue = document.createElement('span');
  tickValue.className = 'hud-tick';
  tickValue.textContent = '0';
  tickRow.textContent = 'Tick: ';
  tickRow.appendChild(tickValue);

  const entityRow = document.createElement('div');
  const entityCountValue = document.createElement('span');
  entityCountValue.className = 'hud-entity-count';
  entityCountValue.textContent = '0';
  entityRow.textContent = 'Entities: ';
  entityRow.appendChild(entityCountValue);

  const fpsRow = document.createElement('div');
  const fpsValue = document.createElement('span');
  fpsValue.className = 'hud-fps';
  fpsValue.textContent = '--';
  fpsRow.textContent = 'FPS: ';
  fpsRow.appendChild(fpsValue);

  const tpsRow = document.createElement('div');
  const tpsValue = document.createElement('span');
  tpsValue.className = 'hud-tps';
  tpsValue.textContent = '--';
  tpsRow.textContent = 'TPS: ';
  tpsRow.appendChild(tpsValue);

  statsSection.appendChild(tickRow);
  statsSection.appendChild(entityRow);
  statsSection.appendChild(fpsRow);
  statsSection.appendChild(tpsRow);

  // --- Profile legend section ---
  const profileSection = document.createElement('div');
  profileSection.className = 'hud-section hud-profiles';

  // Assemble
  container.appendChild(statusSection);
  container.appendChild(statsSection);
  container.appendChild(profileSection);
  document.body.appendChild(container);

  // --- H key toggle ---
  document.addEventListener('keydown', (event: KeyboardEvent) => {
    const tag = (event.target as HTMLElement).tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA') return;
    if ((event.target as HTMLElement).isContentEditable) return;

    if (event.key === 'h' || event.key === 'H') {
      container.style.display = container.style.display === 'none' ? '' : 'none';
    }
  });

  return {
    container,
    connectionDot,
    connectionLabel,
    tickValue,
    entityCountValue,
    fpsValue,
    tpsValue,
    profileSection,
  };
}

/** Update all HUD readouts. Called once per frame from the render loop. */
export function updateHud(hud: HudElements, state: ViewerState, delta: number): void {
  // --- Connection status (only update DOM on change) ---
  if (state.connectionStatus !== lastConnectionStatus) {
    lastConnectionStatus = state.connectionStatus;
    hud.connectionDot.className = DOT_CLASS[state.connectionStatus];
    hud.connectionLabel.textContent = state.connectionStatus;
  }

  // --- Tick and entity count ---
  hud.tickValue.textContent = String(state.currentTick);
  hud.entityCountValue.textContent = String(state.entityCount);

  // --- FPS counter (EMA smoothing) ---
  if (delta > 0) {
    const instantFps = 1 / delta;
    smoothFps = smoothFps * 0.95 + instantFps * 0.05;
    hud.fpsValue.textContent = String(Math.round(smoothFps));
  } else {
    hud.fpsValue.textContent = '--';
  }

  // --- TPS counter (ticks per second received from server) ---
  const now = performance.now();
  if (state.currentTick !== lastTick) {
    lastTick = state.currentTick;
    tickTimestamps.push(now);
  }
  const windowStart = now - 1000;
  while (tickTimestamps.length > 0 && tickTimestamps[0] < windowStart) {
    tickTimestamps.shift();
  }
  hud.tpsValue.textContent = tickTimestamps.length > 0 ? String(tickTimestamps.length) : '--';

  // --- Profile legend (rebuild only on entity count change) ---
  if (state.entityCount !== cachedEntityCount) {
    cachedEntityCount = state.entityCount;
    hud.profileSection.textContent = '';

    if (state.profileIndices !== null) {
      const counts = new Map<number, number>();
      for (let i = 0; i < state.profileIndices.length; i++) {
        const idx = state.profileIndices[i];
        counts.set(idx, (counts.get(idx) ?? 0) + 1);
      }

      const sortedKeys = Array.from(counts.keys()).sort((a, b) => a - b);
      for (const profileIndex of sortedKeys) {
        const row = document.createElement('div');
        row.className = 'hud-profile-row';

        const swatch = document.createElement('span');
        swatch.className = 'hud-color-swatch';
        const color = profileIndex < config.profileColors.length
          ? config.profileColors[profileIndex]
          : 0x888888;
        swatch.style.backgroundColor = `#${color.toString(16).padStart(6, '0')}`;

        const label = document.createElement('span');
        label.textContent = `Profile ${profileIndex}: ${counts.get(profileIndex)}`;

        row.appendChild(swatch);
        row.appendChild(label);
        hud.profileSection.appendChild(row);
      }
    }
  }
}
