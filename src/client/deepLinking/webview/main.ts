import './styles.css';
import type { ChannelInfo, DeepLinkParam, ExtMsg, SavedSet, SendMode, WebMsg } from './protocol';

interface VsCodeApi { postMessage(msg: WebMsg): void; }
declare function acquireVsCodeApi(): VsCodeApi;
const vscode = acquireVsCodeApi();

const MEDIA_TYPES = ['episode', 'live', 'movie', 'season', 'series', 'short-form', 'special'];

// Suggested parameter keys (free-form — these only feed the datalist).
const KEY_SUGGESTIONS = ['mediaType'];

// ── state ────────────────────────────────────────────────────────────────────

let channels: ChannelInfo[] = [];
let sets: SavedSet[] = [];
let selectedChannelId: string | undefined;
let editingSetId: string | undefined;
let toastTimer: ReturnType<typeof setTimeout> | undefined;

// ── DOM scaffold ─────────────────────────────────────────────────────────────

const PLACEHOLDER_ICON = `<svg viewBox="0 0 16 16" width="28" height="28" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round">
  <rect x="1.5" y="2.5" width="13" height="9" rx="1"/>
  <path d="M5.5 14h5M8 11.5V14M4.5 7.5l2-2 2 2 3-3"/>
</svg>`;

function buildDom(): void {
  document.body.innerHTML = `
<div id="toolbar">
  <div class="status-dot" id="status-dot"></div>
  <span id="device-label">No device</span>
  <button id="btn-refresh" title="Reload the channel list from the device">Refresh</button>
  <span id="toast"></span>
</div>
<div id="error-banner" class="hidden"></div>
<div id="content">
  <div id="channels-pane">
    <h3>Channels</h3>
    <div id="channel-grid"></div>
    <div id="channels-empty" class="empty hidden"></div>
  </div>
  <div id="side-pane">
    <div id="form-section">
      <h3>Deep Link</h3>
      <div id="selected-channel" class="muted">No channel selected</div>
      <label class="field-label" for="content-id">contentId</label>
      <input id="content-id" type="text" placeholder="e.g. movie-1234" spellcheck="false">
      <div class="field-label">Additional parameters</div>
      <div id="param-rows"></div>
      <button id="btn-add-param" class="secondary">+ Add parameter</button>
      <div id="action-row">
        <button id="btn-launch" title="POST /launch — starts or relaunches the selected channel with these parameters">Launch</button>
        <button id="btn-input" class="secondary" title="POST /input — delivers the parameters to the channel currently running in the foreground as an roInput event (no relaunch)">Send Input</button>
      </div>
    </div>
    <div id="sets-section">
      <h3>Saved Parameter Sets</h3>
      <div id="save-row">
        <input id="set-name" type="text" placeholder="Preset name" spellcheck="false">
        <button id="btn-save-set">Save</button>
        <button id="btn-cancel-edit" class="secondary hidden">Cancel</button>
      </div>
      <div id="sets-list"></div>
    </div>
  </div>
</div>
<datalist id="key-suggestions">${KEY_SUGGESTIONS.map((k) => `<option value="${k}">`).join('')}</datalist>
<datalist id="mediatype-values">${MEDIA_TYPES.map((v) => `<option value="${v}">`).join('')}</datalist>`;
}

function esc(text: string): string {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function el<T extends HTMLElement>(id: string): T {
  return document.getElementById(id) as T;
}

// ── channels ─────────────────────────────────────────────────────────────────

function renderChannels(): void {
  const grid = el<HTMLDivElement>('channel-grid');
  grid.innerHTML = channels.map((ch) => `
    <button class="channel-card${ch.id === selectedChannelId ? ' selected' : ''}" data-id="${esc(ch.id)}" title="${esc(ch.name)} (${esc(ch.id)})">
      <span class="channel-icon">${ch.iconDataUri ? `<img src="${ch.iconDataUri}" alt="">` : PLACEHOLDER_ICON}</span>
      <span class="channel-name">${esc(ch.name)}</span>
      <span class="channel-meta">${esc(ch.id)}${ch.version ? ` · v${esc(ch.version)}` : ''}</span>
    </button>
  `).join('');
  updateSelectedChannel();
}

function updateSelectedChannel(): void {
  const box = el<HTMLDivElement>('selected-channel');
  const selected = channels.find((c) => c.id === selectedChannelId);

  for (const card of document.querySelectorAll<HTMLElement>('.channel-card')) {
    card.classList.toggle('selected', card.dataset.id === selectedChannelId);
  }

  if (selected) {
    box.classList.remove('muted');
    box.innerHTML = `
      <span class="channel-icon small">${selected.iconDataUri ? `<img src="${selected.iconDataUri}" alt="">` : PLACEHOLDER_ICON}</span>
      <span>${esc(selected.name)} <span class="channel-meta">(${esc(selected.id)})</span></span>`;
  } else if (selectedChannelId) {
    // A saved set referenced a channel that is not installed on this device.
    box.classList.remove('muted');
    box.innerHTML = `<span class="warn">⚠ Channel ${esc(selectedChannelId)} is not installed on this device</span>`;
  } else {
    box.classList.add('muted');
    box.textContent = 'No channel selected';
  }

  el<HTMLButtonElement>('btn-launch').disabled = !selectedChannelId;
}

// ── param rows ───────────────────────────────────────────────────────────────

function addParamRow(key = '', value = ''): void {
  const rows = el<HTMLDivElement>('param-rows');
  const row = document.createElement('div');
  row.className = 'param-row';
  row.innerHTML = `
    <input class="param-key" type="text" placeholder="key" list="key-suggestions" spellcheck="false">
    <input class="param-value" type="text" placeholder="value" spellcheck="false">
    <button class="param-remove secondary" title="Remove parameter">✕</button>`;

  const keyInput = row.querySelector<HTMLInputElement>('.param-key')!;
  const valueInput = row.querySelector<HTMLInputElement>('.param-value')!;
  keyInput.value = key;
  valueInput.value = value;

  const syncValueSuggestions = (): void => {
    if (keyInput.value.trim() === 'mediaType') {
      valueInput.setAttribute('list', 'mediatype-values');
    } else {
      valueInput.removeAttribute('list');
    }
  };
  keyInput.addEventListener('input', syncValueSuggestions);
  syncValueSuggestions();

  row.querySelector('.param-remove')!.addEventListener('click', () => row.remove());
  rows.appendChild(row);
}

function readParams(): DeepLinkParam[] {
  const params: DeepLinkParam[] = [];
  for (const row of document.querySelectorAll<HTMLElement>('.param-row')) {
    const key = row.querySelector<HTMLInputElement>('.param-key')!.value.trim();
    const value = row.querySelector<HTMLInputElement>('.param-value')!.value;
    if (key !== '') params.push({ key, value });
  }
  return params;
}

function setParams(params: DeepLinkParam[]): void {
  el<HTMLDivElement>('param-rows').innerHTML = '';
  for (const p of params) addParamRow(p.key, p.value);
}

// ── saved sets ───────────────────────────────────────────────────────────────

function renderSets(): void {
  const list = el<HTMLDivElement>('sets-list');
  if (sets.length === 0) {
    list.innerHTML = '<div class="empty">No saved sets yet — fill the form, name it, and hit Save.</div>';
    return;
  }

  list.innerHTML = sets.map((s) => {
    const missing = channels.length > 0 && !channels.some((c) => c.id === s.channelId);
    const summary = [s.contentId ? `contentId=${s.contentId}` : '', ...s.params.map((p) => `${p.key}=${p.value}`)]
      .filter(Boolean).join(' · ');
    return `
    <div class="set-row" data-id="${esc(s.id)}">
      <div class="set-info">
        <span class="set-name">${esc(s.name)}</span>
        <span class="set-meta">${esc(s.channelName)} (${esc(s.channelId)})${missing ? ' <span class="warn">⚠ not installed</span>' : ''}</span>
        <span class="set-meta summary" title="${esc(summary)}">${esc(summary)}</span>
      </div>
      <div class="set-actions">
        <button class="set-use" title="Load into the form and select the channel">Use</button>
        <button class="set-edit secondary" title="Load for editing — Save will update this set">Edit</button>
        <button class="set-delete secondary" title="Delete this set">✕</button>
      </div>
    </div>`;
  }).join('');
}

function loadSetIntoForm(set: SavedSet, forEdit: boolean): void {
  selectedChannelId = set.channelId;
  el<HTMLInputElement>('content-id').value = set.contentId;
  setParams(set.params);
  updateSelectedChannel();

  if (forEdit) {
    editingSetId = set.id;
    el<HTMLInputElement>('set-name').value = set.name;
  } else {
    editingSetId = undefined;
    el<HTMLInputElement>('set-name').value = '';
  }
  syncSaveButton();
}

function syncSaveButton(): void {
  el<HTMLButtonElement>('btn-save-set').textContent = editingSetId ? 'Update' : 'Save';
  el<HTMLButtonElement>('btn-cancel-edit').classList.toggle('hidden', !editingSetId);
}

// ── feedback ─────────────────────────────────────────────────────────────────

function showToast(text: string, ok: boolean): void {
  const toast = el<HTMLSpanElement>('toast');
  toast.textContent = text;
  toast.className = ok ? 'ok' : 'fail';
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toast.textContent = ''; toast.className = ''; }, 5000);
}

function showError(message: string | undefined): void {
  const banner = el<HTMLDivElement>('error-banner');
  banner.classList.toggle('hidden', !message);
  banner.textContent = message ?? '';
}

function setStatus(cls: 'ok' | 'err' | 'loading', deviceLabel: string): void {
  el<HTMLDivElement>('status-dot').className = `status-dot ${cls}`;
  el<HTMLSpanElement>('device-label').textContent = deviceLabel;
}

function showChannelsEmpty(text: string | undefined): void {
  const empty = el<HTMLDivElement>('channels-empty');
  empty.classList.toggle('hidden', !text);
  empty.textContent = text ?? '';
}

// ── events ───────────────────────────────────────────────────────────────────

function wireEvents(): void {
  el('btn-refresh').addEventListener('click', () => {
    vscode.postMessage({ kind: 'refresh' });
  });

  el('channel-grid').addEventListener('click', (e) => {
    const card = (e.target as HTMLElement).closest<HTMLElement>('.channel-card');
    if (!card) return;
    selectedChannelId = card.dataset.id;
    updateSelectedChannel();
  });

  el('btn-add-param').addEventListener('click', () => addParamRow());

  el('btn-launch').addEventListener('click', () => send('launch'));
  el('btn-input').addEventListener('click', () => send('input'));

  el('btn-save-set').addEventListener('click', () => {
    const name = el<HTMLInputElement>('set-name').value.trim();
    if (!name) {
      showToast('Give the parameter set a name first', false);
      el('set-name').focus();
      return;
    }
    if (!selectedChannelId) {
      showToast('Select a channel first', false);
      return;
    }
    const channel = channels.find((c) => c.id === selectedChannelId);
    vscode.postMessage({
      kind: 'saveSet',
      set: {
        id: editingSetId,
        name,
        channelId: selectedChannelId,
        channelName: channel?.name ?? sets.find((s) => s.id === editingSetId)?.channelName ?? selectedChannelId,
        contentId: el<HTMLInputElement>('content-id').value.trim(),
        params: readParams(),
      },
    });
    editingSetId = undefined;
    el<HTMLInputElement>('set-name').value = '';
    syncSaveButton();
    showToast('Saved', true);
  });

  el('btn-cancel-edit').addEventListener('click', () => {
    editingSetId = undefined;
    el<HTMLInputElement>('set-name').value = '';
    syncSaveButton();
  });

  el('sets-list').addEventListener('click', (e) => {
    const target = e.target as HTMLElement;
    const row = target.closest<HTMLElement>('.set-row');
    if (!row) return;
    const set = sets.find((s) => s.id === row.dataset.id);
    if (!set) return;

    if (target.closest('.set-use')) loadSetIntoForm(set, false);
    else if (target.closest('.set-edit')) loadSetIntoForm(set, true);
    else if (target.closest('.set-delete')) vscode.postMessage({ kind: 'deleteSet', id: set.id });
  });
}

function send(mode: SendMode): void {
  if (mode === 'launch' && !selectedChannelId) return;
  showError(undefined);
  vscode.postMessage({
    kind: 'send',
    mode,
    channelId: selectedChannelId ?? '',
    contentId: el<HTMLInputElement>('content-id').value.trim(),
    params: readParams(),
  });
}

// ── extension messages ───────────────────────────────────────────────────────

window.addEventListener('message', (event: MessageEvent<ExtMsg>) => {
  const msg = event.data;
  switch (msg.kind) {
    case 'loading':
      setStatus('loading', 'Loading…');
      showChannelsEmpty('Loading channels…');
      break;

    case 'channels':
      channels = msg.channels;
      setStatus('ok', `${msg.deviceName} @ ${msg.device}`);
      showError(undefined);
      showChannelsEmpty(channels.length === 0 ? 'No channels installed on this device.' : undefined);
      renderChannels();
      renderSets(); // refresh "not installed" warnings
      break;

    case 'noDevice':
      channels = [];
      setStatus('err', 'No device');
      el<HTMLDivElement>('channel-grid').innerHTML = '';
      showChannelsEmpty('No active Roku device — select one in the Roku Devices view.');
      updateSelectedChannel();
      break;

    case 'sets':
      sets = msg.sets;
      renderSets();
      break;

    case 'sendResult':
      showToast(
        msg.ok
          ? (msg.mode === 'launch' ? 'Launch sent ✓' : 'Input sent ✓')
          : (msg.message ?? 'Request failed'),
        msg.ok,
      );
      break;

    case 'error':
      setStatus('err', 'Error');
      showError(msg.message);
      showChannelsEmpty(undefined);
      break;
  }
});

// ── init ─────────────────────────────────────────────────────────────────────

buildDom();
wireEvents();
addParamRow('mediaType', '');
syncSaveButton();
