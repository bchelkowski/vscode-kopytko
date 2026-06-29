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

const btnStart       = document.getElementById('btn-start') as HTMLButtonElement;
const btnStop        = document.getElementById('btn-stop') as HTMLButtonElement;
const btnNewSession  = document.getElementById('btn-new-session') as HTMLButtonElement;
const btnHeapSnapshot= document.getElementById('btn-heap') as HTMLButtonElement;
const btnSync        = document.getElementById('btn-sync') as HTMLButtonElement;
const liveBadge      = document.getElementById('live-badge')!;
const syncBadge      = document.getElementById('sync-badge')!;
const bufferSize     = document.getElementById('buffer-size')!;
const deviceInfo     = document.getElementById('device-info')!;
const sessionSelect  = document.getElementById('session-select') as HTMLSelectElement;
const lockBanner     = document.getElementById('lock-banner')!;
const statusBar      = document.getElementById('status-bar')!;
const perfettoFrame  = document.getElementById('perfetto-frame') as HTMLIFrameElement;
const placeholder    = document.getElementById('placeholder')!;
const topBar         = document.getElementById('top-bar')!;  // wraps toolbar + banners

// ── State ─────────────────────────────────────────────────────────────────────

let state: WebviewState = 'idle';
let lockOwner: 'diagnostics' | 'perfetto' | null = null;
let liveBuffer: Uint8Array = new Uint8Array(0);
/** Byte length of liveBuffer at the time of the last sync to the iframe. */
let lastSyncedBytes = 0;
let iframeReady = false;
let pingInterval: ReturnType<typeof setInterval> | null = null;
let isLiveMode = true;

const PERFETTO_ORIGIN  = 'https://ui.perfetto.dev';
const PING_INTERVAL_MS = 250;

// ── Frame resizing ────────────────────────────────────────────────────────────

function resizeFrame(): void {
  const topH = topBar.getBoundingClientRect().height;
  const h = Math.max(0, window.innerHeight - topH);
  perfettoFrame.style.height = h + 'px';
  placeholder.style.height   = h + 'px';
}

// Resize whenever the top bar changes (banners appear/disappear) or window resizes.
new ResizeObserver(resizeFrame).observe(topBar);
window.addEventListener('resize', resizeFrame);

// ── Iframe lifecycle ──────────────────────────────────────────────────────────

function showIframe(): void {
  perfettoFrame.style.display = 'block';
  placeholder.style.display = 'none';
  resizeFrame();
}

function showPlaceholder(): void {
  perfettoFrame.style.display = 'none';
  placeholder.style.display = 'flex';
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
  if (!iframeReady || liveBuffer.byteLength === 0) return;
  const estimatedDurationS = (Date.now() - (lastSyncTs || Date.now())) / 1000;
  if (estimatedDurationS <= 0) return;
  const viewportS = 5;
  const timeEnd   = estimatedDurationS + 0.5;
  const timeStart = Math.max(0, timeEnd - viewportS);
  perfettoFrame.contentWindow?.postMessage(
    { perfetto: { timeStart, timeEnd, viewPercentage: 0.9 } },
    PERFETTO_ORIGIN,
  );
}

let lastSyncTs = 0;

/** Push the current buffer to Perfetto and remember how much was synced. */
function syncNow(title: string): void {
  if (!iframeReady || liveBuffer.byteLength === 0) return;
  const snapshot = liveBuffer.buffer.slice(
    liveBuffer.byteOffset,
    liveBuffer.byteOffset + liveBuffer.byteLength,
  );
  sendToPerfetto(snapshot, title);
  lastSyncedBytes = liveBuffer.byteLength;
  lastSyncTs = Date.now();
  updateSyncBadge();
  setTimeout(() => scrollToLiveEdge(), 800);
}

// ── Buffer management ─────────────────────────────────────────────────────────

function appendChunk(data: ArrayBuffer): void {
  const incoming = new Uint8Array(data);
  const combined = new Uint8Array(liveBuffer.byteLength + incoming.byteLength);
  combined.set(liveBuffer);
  combined.set(incoming, liveBuffer.byteLength);
  liveBuffer = combined;
  updateBufferInfo();
  updateSyncBadge();
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

function updateBufferInfo(): void {
  bufferSize.textContent = formatBytes(liveBuffer.byteLength);
}

function updateSyncBadge(): void {
  const unseen = liveBuffer.byteLength - lastSyncedBytes;
  if (unseen > 0 && isLiveMode && state === 'recording') {
    syncBadge.textContent = `+${formatBytes(unseen)} new`;
    syncBadge.style.display = 'inline';
  } else {
    syncBadge.style.display = 'none';
  }
  btnSync.disabled = !iframeReady || liveBuffer.byteLength === 0;
}

// ── UI state ──────────────────────────────────────────────────────────────────

function applyState(): void {
  const locked      = lockOwner === 'diagnostics';
  const isRecording = state === 'recording';
  const isDeploying = state === 'deploying';

  lockBanner.classList.toggle('visible', locked);

  btnStart.disabled       = locked || isRecording || isDeploying;
  btnStop.disabled        = !isRecording;
  btnNewSession.disabled  = locked || isDeploying;
  btnHeapSnapshot.disabled= !isRecording;

  liveBadge.classList.toggle('visible', isRecording && isLiveMode);
  statusBar.classList.toggle('visible', isDeploying);
  if (isDeploying) statusBar.textContent = 'Deploying app to device…';

  resizeFrame();
}

function formatDate(wall: number): string {
  return new Date(wall).toLocaleString();
}

function populateSessions(sessions: SerializedPerfettoSession[]): void {
  while (sessionSelect.options.length > 1) sessionSelect.remove(1);
  for (const s of sessions) {
    const opt = document.createElement('option');
    opt.value = s.dir;
    const label = s.appTitle ?? s.deviceIp;
    opt.textContent = `${label} – ${formatDate(s.startedWall)} (${formatBytes(s.traceBytes)})`;
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
      // Push whatever we have as soon as the iframe is ready.
      if (liveBuffer.byteLength > 0) {
        syncNow('Kopytko Perfetto — Live');
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
        deviceInfo.textContent =
          `${msg.device.name} (${msg.device.ip})` +
          (msg.device.appTitle ? ` · ${msg.device.appTitle}` : '');
      }
      isLiveMode = true;

      if (state === 'recording') {
        startPinging();
      } else {
        if (state === 'idle') {
          showPlaceholder();
          liveBuffer        = new Uint8Array(0);
          lastSyncedBytes   = 0;
          lastSyncTs        = 0;
          updateBufferInfo();
          updateSyncBadge();
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
      liveBadge.classList.remove('visible');
      syncBadge.style.display = 'none';
      startPinging();
      const replayData  = msg.data;
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

function resetBufferForNewSession(): void {
  liveBuffer       = new Uint8Array(0);
  lastSyncedBytes  = 0;
  lastSyncTs       = 0;
  iframeReady      = false;
  updateBufferInfo();
  updateSyncBadge();
  stopPinging();
}

btnStart.addEventListener('click', () => {
  resetBufferForNewSession();
  state = 'deploying';
  applyState();
  vscode.postMessage({ kind: 'start' });
});

btnStop.addEventListener('click', () => {
  vscode.postMessage({ kind: 'stop' });
  // Push final buffer to iframe so Perfetto shows the complete session.
  if (liveBuffer.byteLength > 0 && iframeReady) {
    syncNow('Kopytko Perfetto — Final');
  }
});

btnNewSession.addEventListener('click', () => {
  resetBufferForNewSession();
  state = 'deploying';
  applyState();
  vscode.postMessage({ kind: 'new-session' });
});

btnHeapSnapshot.addEventListener('click', () => {
  vscode.postMessage({ kind: 'heap-snapshot' });
});

// Sync: manually push the current buffer to the Perfetto iframe on demand.
btnSync.addEventListener('click', () => {
  syncNow('Kopytko Perfetto — Live');
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
resizeFrame();
