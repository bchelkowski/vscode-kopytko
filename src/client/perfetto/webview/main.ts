import './styles.css';
import type {
  ExtMsg,
  WebMsg,
  WebviewState,
  SerializedPerfettoSession,
} from './protocol';
import { el, formatBytes } from '../../webview/domUtils';

declare function acquireVsCodeApi(): {
  postMessage(msg: WebMsg): void;
  getState(): unknown;
  setState(state: unknown): void;
};

const vscode = acquireVsCodeApi();

// ── DOM refs ──────────────────────────────────────────────────────────────────

const topBar       = el('top-bar');
const statusDot    = el('status-dot');
const deviceLabel  = el('device-label');
const sessionSelect= el<HTMLSelectElement>('session-select');
const btnToggle    = el<HTMLButtonElement>('btn-toggle');
const btnNewSession= el<HTMLButtonElement>('btn-new-session');
const btnSync      = el<HTMLButtonElement>('btn-sync');
const btnHeap      = el<HTMLButtonElement>('btn-heap');
const syncBadge    = el('sync-badge');
const bufferSize   = el('buffer-size');
const elapsedEl    = el('elapsed');
const lockBanner   = el('lock-banner');
const statusBar    = el('status-bar');
const perfettoFrame= el<HTMLIFrameElement>('perfetto-frame');
const placeholder  = el('placeholder');

// ── State ─────────────────────────────────────────────────────────────────────

let state: WebviewState     = 'idle';
let lockOwner: 'diagnostics' | 'perfetto' | null = null;
let panelMode: 'live' | 'replay' = 'live';
let liveBuffer: Uint8Array  = new Uint8Array(0);
let lastSyncedBytes         = 0;
let lastSyncTs              = 0;
let sessionStartWall        = 0;
let iframeReady             = false;
let pingInterval: ReturnType<typeof setInterval> | null = null;
let elapsedTimer: ReturnType<typeof setInterval> | undefined;

const PERFETTO_ORIGIN  = 'https://ui.perfetto.dev';
const PING_INTERVAL_MS = 250;

// ── Frame resizing ────────────────────────────────────────────────────────────

function resizeFrame(): void {
  const topH = topBar.getBoundingClientRect().height;
  const h    = Math.max(0, window.innerHeight - topH);
  const w    = window.innerWidth;
  perfettoFrame.style.height = h + 'px';
  perfettoFrame.style.width  = w + 'px';
  placeholder.style.height   = h + 'px';
  placeholder.style.width    = w + 'px';
}

new ResizeObserver(resizeFrame).observe(topBar);
window.addEventListener('resize', resizeFrame);

// ── Iframe lifecycle ──────────────────────────────────────────────────────────

function showIframe(): void {
  perfettoFrame.style.display = 'block';
  placeholder.style.display   = 'none';
  resizeFrame();
}

function showPlaceholder(): void {
  perfettoFrame.style.display = 'none';
  placeholder.style.display   = 'flex';
  resizeFrame();
}

function startPinging(): void {
  if (pingInterval) return;
  showIframe();
  iframeReady = false;
  pingInterval = setInterval(() => {
    perfettoFrame.contentWindow?.postMessage('PING', PERFETTO_ORIGIN);
  }, PING_INTERVAL_MS);
}

function stopPinging(): void {
  if (pingInterval) {
    clearInterval(pingInterval);
    pingInterval = null;
  }
}

function sendToPerfetto(buffer: ArrayBuffer, title: string): void {
  if (!iframeReady) return;
  perfettoFrame.contentWindow?.postMessage(
    { perfetto: { buffer, title, keepApiOpen: true, localOnly: true } },
    PERFETTO_ORIGIN,
    [buffer],
  );
}

function scrollToLiveEdge(): void {
  if (!iframeReady || !lastSyncTs) return;
  const estimatedDurationS = (Date.now() - lastSyncTs) / 1000 + (lastSyncedBytes / 50000);
  if (estimatedDurationS <= 0) return;
  const viewportS = 5;
  const timeEnd   = Math.max(viewportS, estimatedDurationS + 0.5);
  const timeStart = timeEnd - viewportS;
  perfettoFrame.contentWindow?.postMessage(
    { perfetto: { timeStart, timeEnd, viewPercentage: 0.9 } },
    PERFETTO_ORIGIN,
  );
}

function syncNow(title: string): void {
  if (!iframeReady || liveBuffer.byteLength === 0) return;
  const snapshot = liveBuffer.buffer.slice(
    liveBuffer.byteOffset,
    liveBuffer.byteOffset + liveBuffer.byteLength,
  );
  sendToPerfetto(snapshot, title);
  lastSyncedBytes = liveBuffer.byteLength;
  lastSyncTs      = Date.now();
  updateSyncBadge();
  setTimeout(() => scrollToLiveEdge(), 800);
}

// ── Buffer ────────────────────────────────────────────────────────────────────

function appendChunk(data: ArrayBuffer): void {
  const incoming = new Uint8Array(data);
  const combined = new Uint8Array(liveBuffer.byteLength + incoming.byteLength);
  combined.set(liveBuffer);
  combined.set(incoming, liveBuffer.byteLength);
  liveBuffer = combined;
  updateBufferInfo();
  updateSyncBadge();
}

function updateBufferInfo(): void {
  bufferSize.textContent = liveBuffer.byteLength > 0 ? formatBytes(liveBuffer.byteLength) : '';
}

function updateSyncBadge(): void {
  const unseen = liveBuffer.byteLength - lastSyncedBytes;
  if (unseen > 0 && panelMode === 'live' && state === 'recording') {
    syncBadge.textContent = `+${formatBytes(unseen)}`;
    syncBadge.style.display = 'inline';
  } else {
    syncBadge.style.display = 'none';
  }
  btnSync.disabled = !iframeReady || liveBuffer.byteLength === 0;
}

// ── Elapsed timer ─────────────────────────────────────────────────────────────

function startElapsed(): void {
  clearInterval(elapsedTimer);
  elapsedTimer = setInterval(() => {
    if (state !== 'recording' || !sessionStartWall) return;
    const secs = Math.floor((Date.now() - sessionStartWall) / 1000);
    const m = Math.floor(secs / 60);
    const s = String(secs % 60).padStart(2, '0');
    elapsedEl.textContent = `${m}:${s}`;
  }, 1000);
}

function stopElapsed(): void {
  clearInterval(elapsedTimer);
  elapsedEl.textContent = '';
}

// ── UI state ──────────────────────────────────────────────────────────────────

function applyState(): void {
  const locked      = lockOwner === 'diagnostics';
  const isRecording = state === 'recording';
  const isDeploying = state === 'deploying';
  const isReplay    = panelMode === 'replay';

  lockBanner.classList.toggle('visible', locked);

  statusDot.classList.toggle('recording', isRecording && !isReplay);
  statusDot.classList.toggle('replay',    isReplay);

  // Toggle button: "Start" → "Stop" when recording
  btnToggle.textContent = isRecording ? 'Stop' : 'Start';
  btnToggle.classList.toggle('stop', isRecording);
  btnToggle.disabled = locked || isDeploying || isReplay;

  btnNewSession.textContent = isReplay ? 'Back to Live' : 'New Session';
  btnNewSession.disabled    = locked || isDeploying;

  btnHeap.disabled = !isRecording;

  statusBar.classList.toggle('visible', isDeploying);
  if (isDeploying) statusBar.textContent = 'Deploying app to device…';

  // Update the live option label in the selector
  const liveOpt = sessionSelect.options[0];
  if (liveOpt) {
    if (isRecording) {
      liveOpt.textContent = '● Live session';
    } else if (isDeploying) {
      liveOpt.textContent = '◌ Deploying…';
    } else {
      liveOpt.textContent = 'Kopytko Perfetto';
    }
  }

  resizeFrame();
}

function updateDeviceLabel(
  device?: { name: string; ip: string; appTitle?: string },
  app?: string,
): void {
  if (device) {
    const label = app ?? device.appTitle ?? device.name;
    deviceLabel.textContent = `${label} @ ${device.ip}`;
  } else {
    deviceLabel.textContent = 'No device selected';
  }
}

function formatDate(wall: number): string {
  return new Date(wall).toLocaleString();
}

function populateSessions(sessions: SerializedPerfettoSession[]): void {
  // Keep only the live option (index 0).
  while (sessionSelect.options.length > 1) sessionSelect.remove(1);
  for (const s of sessions) {
    const opt = document.createElement('option');
    opt.value = s.dir;
    const dur = s.endedWall
      ? ` ${Math.round((s.endedWall - s.startedWall) / 1000)}s`
      : '';
    opt.textContent = `${s.appTitle ?? s.deviceIp}  ${formatDate(s.startedWall)}${dur}  (${formatBytes(s.traceBytes)})`;
    sessionSelect.appendChild(opt);
  }
}

// ── Message handler ───────────────────────────────────────────────────────────

window.addEventListener('message', (event) => {
  // Perfetto iframe → webview (PONG)
  if (event.source === perfettoFrame.contentWindow) {
    if (event.data === 'PONG') {
      stopPinging();
      iframeReady = true;
      if (liveBuffer.byteLength > 0) {
        syncNow(panelMode === 'replay' ? 'Kopytko Perfetto — Replay' : 'Kopytko Perfetto — Live');
      }
    }
    return;
  }

  const msg = event.data as ExtMsg;

  switch (msg.kind) {
    case 'lock': {
      lockOwner = msg.owner;
      applyState();
      break;
    }

    case 'state': {
      state = msg.state;
      if (msg.sessionStartWall) sessionStartWall = msg.sessionStartWall;
      updateDeviceLabel(msg.device, msg.device?.appTitle);
      panelMode = 'live';

      if (state === 'recording') {
        startPinging();
        startElapsed();
      } else {
        stopElapsed();
        if (state === 'idle') {
          showPlaceholder();
          liveBuffer      = new Uint8Array(0);
          lastSyncedBytes = 0;
          lastSyncTs      = 0;
          sessionStartWall= 0;
          updateBufferInfo();
          updateSyncBadge();
        }
      }
      sessionSelect.value = '';
      applyState();
      break;
    }

    case 'chunk': {
      appendChunk(msg.data);
      break;
    }

    case 'sessions': {
      populateSessions(msg.sessions);
      break;
    }

    case 'replay': {
      panelMode    = 'replay';
      stopElapsed();
      syncBadge.style.display = 'none';
      startPinging();
      const replayData  = msg.data;
      const s           = msg.session;
      const replayTitle = `${s.appTitle ?? s.deviceIp}  ${formatDate(s.startedWall)}`;
      updateDeviceLabel({ name: s.deviceIp, ip: s.deviceIp, appTitle: s.appTitle }, s.appTitle);
      sessionSelect.value = s.dir;
      applyState();
      const onPong = (e: MessageEvent) => {
        if (e.source !== perfettoFrame.contentWindow || e.data !== 'PONG') return;
        window.removeEventListener('message', onPong);
        sendToPerfetto(replayData, replayTitle);
      };
      window.addEventListener('message', onPong);
      break;
    }

    case 'error': {
      state = 'idle';
      applyState();
      statusBar.textContent = `⚠ ${msg.message}`;
      statusBar.classList.add('visible');
      resizeFrame();
      break;
    }
  }
});

// ── Button handlers ───────────────────────────────────────────────────────────

function resetLiveBuffer(): void {
  liveBuffer      = new Uint8Array(0);
  lastSyncedBytes = 0;
  lastSyncTs      = 0;
  iframeReady     = false;
  stopPinging();
  updateBufferInfo();
  updateSyncBadge();
}

btnToggle.addEventListener('click', () => {
  if (state === 'recording') {
    vscode.postMessage({ kind: 'stop' });
    if (liveBuffer.byteLength > 0 && iframeReady) {
      syncNow('Kopytko Perfetto — Final');
    }
  } else {
    resetLiveBuffer();
    state = 'deploying';
    applyState();
    vscode.postMessage({ kind: 'start' });
  }
});

btnNewSession.addEventListener('click', () => {
  if (panelMode === 'replay') {
    vscode.postMessage({ kind: 'load-live' });
    return;
  }
  resetLiveBuffer();
  state = 'deploying';
  applyState();
  vscode.postMessage({ kind: 'new-session' });
});

btnSync.addEventListener('click', () => syncNow('Kopytko Perfetto — Live'));

btnHeap.addEventListener('click', () => vscode.postMessage({ kind: 'heap-snapshot' }));

sessionSelect.addEventListener('change', () => {
  const dir = sessionSelect.value;
  if (!dir) {
    panelMode = 'live';
    applyState();
    vscode.postMessage({ kind: 'load-live' });
  } else {
    vscode.postMessage({ kind: 'load-session', dir });
  }
});

// ── Init ──────────────────────────────────────────────────────────────────────

showPlaceholder();
applyState();
resizeFrame();
