import type {
  ExtMsg,
  WebMsg,
  WebviewState,
  SerializedPerfettoSession,
} from './protocol';

declare function acquireVsCodeApi(): {
  postMessage(msg: WebMsg): void;
  getState(): unknown;
  setState(state: unknown): void;
};

const vscode = acquireVsCodeApi();

// ── DOM refs ──────────────────────────────────────────────────────────────────

const toolbar = document.getElementById('toolbar')!;
const btnStart = document.getElementById('btn-start') as HTMLButtonElement;
const btnStop = document.getElementById('btn-stop') as HTMLButtonElement;
const btnNewSession = document.getElementById('btn-new-session') as HTMLButtonElement;
const btnHeapSnapshot = document.getElementById('btn-heap') as HTMLButtonElement;
const liveBadge = document.getElementById('live-badge')!;
const bufferSize = document.getElementById('buffer-size')!;
const deviceInfo = document.getElementById('device-info')!;
const sessionSelect = document.getElementById('session-select') as HTMLSelectElement;
const lockBanner = document.getElementById('lock-banner')!;
const statusBar = document.getElementById('status-bar')!;
const perfettoFrame = document.getElementById('perfetto-frame') as HTMLIFrameElement;
const placeholder = document.getElementById('placeholder')!;

void toolbar; // referenced via DOM — suppress unused warning

// ── State ─────────────────────────────────────────────────────────────────────

let state: WebviewState = 'idle';
let lockOwner: 'diagnostics' | 'perfetto' | null = null;
let liveBuffer: Uint8Array = new Uint8Array(0);
let refreshTimer: ReturnType<typeof setInterval> | null = null;
let iframeReady = false;
let pingInterval: ReturnType<typeof setInterval> | null = null;
let sessionStartNs = 0; // trace-time nanoseconds, estimated from first chunk arrival
let isLiveMode = true;

const PERFETTO_ORIGIN = 'https://ui.perfetto.dev';
const REFRESH_INTERVAL_MS = 3000;
const PING_INTERVAL_MS = 250;

// ── Iframe lifecycle ──────────────────────────────────────────────────────────

function showIframe(): void {
  perfettoFrame.style.display = 'block';
  placeholder.style.display = 'none';
}

function showPlaceholder(): void {
  perfettoFrame.style.display = 'none';
  placeholder.style.display = 'flex';
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
  // Transfer the ArrayBuffer (zero-copy) — avoids a large structured-clone
  // which Perfetto can misread as a slow network transfer.
  perfettoFrame.contentWindow?.postMessage(
    { perfetto: { buffer, title, keepApiOpen: true, localOnly: true } },
    PERFETTO_ORIGIN,
    [buffer],
  );
}

function scrollToLiveEdge(): void {
  if (!iframeReady || liveBuffer.byteLength === 0) return;
  // Perfetto trace time starts at 0 in the buffer; we don't know the exact
  // trace-clock end without parsing proto, so scroll to the estimated duration.
  // We estimate 1 second of trace per REFRESH_INTERVAL_MS of real time.
  const estimatedDurationS = (Date.now() - (sessionStartNs / 1e6 || Date.now())) / 1000;
  if (estimatedDurationS <= 0) return;
  const viewportS = 5; // show last 5 seconds
  const timeEnd = estimatedDurationS + 0.5;
  const timeStart = Math.max(0, timeEnd - viewportS);
  perfettoFrame.contentWindow?.postMessage(
    { perfetto: { timeStart, timeEnd, viewPercentage: 0.9 } },
    PERFETTO_ORIGIN,
  );
}

// ── Buffer management ─────────────────────────────────────────────────────────

function appendChunk(data: ArrayBuffer): void {
  const incoming = new Uint8Array(data);
  const combined = new Uint8Array(liveBuffer.byteLength + incoming.byteLength);
  combined.set(liveBuffer);
  combined.set(incoming, liveBuffer.byteLength);
  liveBuffer = combined;

  if (sessionStartNs === 0) sessionStartNs = Date.now() * 1e6;

  updateBufferInfo();
}

function updateBufferInfo(): void {
  const kb = (liveBuffer.byteLength / 1024).toFixed(1);
  bufferSize.textContent = `${kb} KB`;
}

function startRefreshTimer(): void {
  if (refreshTimer) return;
  refreshTimer = setInterval(() => {
    if (liveBuffer.byteLength === 0) return;
    // Slice into a fresh ArrayBuffer and transfer it to the iframe.
    // The transfer is zero-copy from the browser's perspective, which prevents
    // Perfetto's "network too slow" warning that occurs with structured-clone.
    // We keep liveBuffer intact (it's a Uint8Array, not an ArrayBuffer).
    const snapshot = liveBuffer.buffer.slice(
      liveBuffer.byteOffset,
      liveBuffer.byteOffset + liveBuffer.byteLength,
    );
    sendToPerfetto(snapshot, 'Kopytko Perfetto — Live');
    setTimeout(() => scrollToLiveEdge(), 800);
  }, REFRESH_INTERVAL_MS);
}

function stopRefreshTimer(): void {
  if (refreshTimer) {
    clearInterval(refreshTimer);
    refreshTimer = null;
  }
}

// ── UI updates ────────────────────────────────────────────────────────────────

function applyState(): void {
  const locked = lockOwner === 'diagnostics';
  lockBanner.classList.toggle('visible', locked);

  const isRecording = state === 'recording';
  const isDeploying = state === 'deploying';
  const isStopped = state === 'stopped' || state === 'idle';

  btnStart.disabled = locked || isRecording || isDeploying;
  btnStop.disabled = !isRecording;
  btnNewSession.disabled = locked || isDeploying;
  btnHeapSnapshot.disabled = !isRecording;

  liveBadge.classList.toggle('visible', isRecording && isLiveMode);
  statusBar.classList.toggle('visible', isDeploying);
  if (isDeploying) statusBar.textContent = 'Deploying app to device…';
  void isStopped;
}

function formatDate(wall: number): string {
  return new Date(wall).toLocaleString();
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

function populateSessions(sessions: SerializedPerfettoSession[]): void {
  // Keep the placeholder option + rebuild the rest.
  while (sessionSelect.options.length > 1) sessionSelect.remove(1);

  for (const s of sessions) {
    const opt = document.createElement('option');
    opt.value = s.dir;
    const label = s.appTitle ?? s.deviceIp;
    const date = formatDate(s.startedWall);
    const size = formatBytes(s.traceBytes);
    opt.textContent = `${label} – ${date} (${size})`;
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
      // If we already have a buffer (live session was active when panel opened), push it now.
      if (liveBuffer.byteLength > 0) {
        const snapshot = liveBuffer.buffer.slice(liveBuffer.byteOffset, liveBuffer.byteOffset + liveBuffer.byteLength);
        sendToPerfetto(snapshot, 'Kopytko Perfetto — Live');
      }
    }
    return;
  }

  // Extension → webview
  const msg = event.data as ExtMsg;

  switch (msg.kind) {
    case 'lock': {
      lockOwner = msg.owner;
      applyState();
      break;
    }

    case 'state': {
      state = msg.state;
      if (msg.device) {
        deviceInfo.textContent = `${msg.device.name} (${msg.device.ip})${msg.device.appTitle ? ' · ' + msg.device.appTitle : ''}`;
      }
      isLiveMode = true;
      if (state === 'recording') {
        startPinging();
        startRefreshTimer();
      } else {
        stopRefreshTimer();
        if (state === 'idle') {
          showPlaceholder();
          liveBuffer = new Uint8Array(0);
          sessionStartNs = 0;
          updateBufferInfo();
        }
      }
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
      isLiveMode = false;
      stopRefreshTimer();
      liveBadge.classList.remove('visible');
      startPinging();
      // Once PONG arrives, we send the replay buffer.  Store it temporarily.
      const replayData = msg.data;
      const replayTitle = `${msg.session.appTitle ?? msg.session.deviceIp} – ${formatDate(msg.session.startedWall)}`;
      const onPong = (e: MessageEvent) => {
        if (e.source !== perfettoFrame.contentWindow || e.data !== 'PONG') return;
        window.removeEventListener('message', onPong);
        sendToPerfetto(replayData, replayTitle);
      };
      window.addEventListener('message', onPong);
      break;
    }

    case 'error': {
      // Show the error message, then reset to idle so buttons re-enable.
      // applyState() would hide the status bar (isDeploying=false), so we
      // set state first, call applyState for button states, then force the bar visible.
      state = 'idle';
      applyState();
      statusBar.textContent = `⚠ ${msg.message}`;
      statusBar.classList.add('visible');
      break;
    }
  }
});

// ── Button handlers ───────────────────────────────────────────────────────────

function resetBufferForNewSession(): void {
  liveBuffer = new Uint8Array(0);
  sessionStartNs = 0;
  updateBufferInfo();
  iframeReady = false;
  stopPinging();
  stopRefreshTimer();
}

btnStart.addEventListener('click', () => {
  resetBufferForNewSession();
  state = 'deploying';
  applyState();
  vscode.postMessage({ kind: 'start' });
});

btnStop.addEventListener('click', () => {
  stopRefreshTimer();
  vscode.postMessage({ kind: 'stop' });
  // Push final buffer immediately so Perfetto shows the complete trace.
  if (liveBuffer.byteLength > 0 && iframeReady) {
    const final = liveBuffer.buffer.slice(liveBuffer.byteOffset, liveBuffer.byteOffset + liveBuffer.byteLength);
    sendToPerfetto(final, 'Kopytko Perfetto — Final');
  }
});

btnNewSession.addEventListener('click', () => {
  // Optimistically set deploying so the status bar shows immediately.
  // The extension will also emit 'deploying' state, but this makes the UI
  // feel instant without waiting for the round-trip.
  resetBufferForNewSession();
  state = 'deploying';
  applyState();
  vscode.postMessage({ kind: 'new-session' });
});

btnHeapSnapshot.addEventListener('click', () => {
  vscode.postMessage({ kind: 'heap-snapshot' });
});

sessionSelect.addEventListener('change', () => {
  const dir = sessionSelect.value;
  if (!dir) {
    vscode.postMessage({ kind: 'load-live' });
  } else {
    vscode.postMessage({ kind: 'load-session', dir });
  }
});

// ── Init ──────────────────────────────────────────────────────────────────────

showPlaceholder();
applyState();
