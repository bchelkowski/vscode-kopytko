import './styles.css';
import type { ChannelInfo, DeepLinkParam, ExtMsg, SavedSet, SendMode, WebMsg } from './protocol';
import { el, esc } from '../../webview/domUtils';

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

// Transient filter/sort state — resets on reload, never persisted.
let setsCheckedLabels: Set<string> | undefined;
const setsKnownLabels = new Set<string>();
let setsSortLabel = '';

// ── label filter/sort helpers ───────────────────────────────────────────────

function labelKey(label: string): string {
  return label.toLowerCase();
}

/** Splits comma-separated raw input into trimmed, case-insensitively-deduped labels. */
function parseLabels(raw: string): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const part of raw.split(',')) {
    const label = part.trim();
    if (label === '') continue;
    const key = labelKey(label);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(label);
  }
  return result;
}

/**
 * Wires a labels `<input>` so picking a `<datalist>` suggestion appends the
 * picked value after the last comma instead of the browser's native
 * behavior of replacing the entire field content with just the suggestion.
 */
function wireLabelsAutocomplete(input: HTMLInputElement): void {
  let previousValue = input.value;
  input.addEventListener('input', (ev) => {
    if ((ev as InputEvent).inputType === 'insertReplacementText') {
      const picked = input.value.trim();
      const rawParts = previousValue.split(',');
      rawParts.pop(); // drop the in-progress segment the suggestion completed
      const kept = rawParts.map((p) => p.trim()).filter((p) => p !== '');
      const newValue = `${[...kept, picked].join(', ')}, `;
      input.value = newValue;
      previousValue = newValue;
      input.setSelectionRange(newValue.length, newValue.length);
    } else {
      previousValue = input.value;
    }
  });
}

/** Distinct labels across every item's label list, case-insensitively deduped, alphabetically sorted. */
function distinctLabels(labelLists: string[][]): string[] {
  const seen = new Map<string, string>();
  for (const labels of labelLists) {
    for (const label of labels) {
      const key = labelKey(label);
      if (!seen.has(key)) seen.set(key, label);
    }
  }
  return [...seen.values()].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
}

/**
 * Reconciles the checked-labels filter against the current distinct-label list: a label seen
 * for the first time (not in `known`) is auto-checked (so freshly-labeled/created items stay
 * visible by default), while labels the user has manually unchecked before stay unchecked.
 * `known` is updated in place to the current label set.
 */
function syncCheckedLabels(checked: Set<string> | undefined, known: Set<string>, labels: string[]): Set<string> {
  const keys = labels.map(labelKey);
  const result = checked ?? new Set<string>();
  for (const key of keys) {
    if (!known.has(key)) result.add(key);
  }
  known.clear();
  for (const key of keys) known.add(key);
  return result;
}

/** Keeps items with no labels always visible; otherwise requires at least one checked label. */
function applyLabelFilter<T>(items: T[], labelsOf: (item: T) => string[], checked: Set<string>): T[] {
  return items.filter((item) => {
    const labels = labelsOf(item);
    if (labels.length === 0) return true;
    return labels.some((l) => checked.has(labelKey(l)));
  });
}

/** '' sorts by title; a specific label groups matching items first (each group alphabetical by title). */
function applyLabelSort<T>(items: T[], labelsOf: (item: T) => string[], titleOf: (item: T) => string, sortLabel: string): T[] {
  const byTitle = (a: T, b: T): number => titleOf(a).localeCompare(titleOf(b), undefined, { sensitivity: 'base' });
  if (sortLabel === '') return [...items].sort(byTitle);
  const key = labelKey(sortLabel);
  const withLabel: T[] = [];
  const withoutLabel: T[] = [];
  for (const item of items) {
    (labelsOf(item).some((l) => labelKey(l) === key) ? withLabel : withoutLabel).push(item);
  }
  withLabel.sort(byTitle);
  withoutLabel.sort(byTitle);
  return [...withLabel, ...withoutLabel];
}

/** A facet of labels shown in the filter/sort toolbar, optionally under its own heading. */
interface LabelGroup { heading?: string; labels: string[] }

/** Builds the checkbox items + sort <option>s for a filter/sort toolbar; preserves current selections. */
function renderFilterSortToolbar(
  menuId: string, sortSelectId: string, groups: LabelGroup[], checked: Set<string>, sortLabel: string,
): void {
  const nonEmpty = groups.filter((g) => g.labels.length > 0);
  const menu = el<HTMLDivElement>(menuId);
  if (menu) {
    const groupsHtml = nonEmpty.map((g) => {
      const heading = g.heading ? `<div class="dropdown-group-label">${esc(g.heading)}</div>` : '';
      const items = g.labels.map((l) => {
        const key = labelKey(l);
        return `<label class="dropdown-item"><input type="checkbox" class="label-filter-item" value="${esc(key)}" ${checked.has(key) ? 'checked' : ''}> ${esc(l)}</label>`;
      }).join('');
      return heading + items;
    }).join('');
    menu.innerHTML = `
      <div class="dropdown-actions">
        <button type="button" class="link-btn filter-all">All</button>
        <span>·</span>
        <button type="button" class="link-btn filter-none">Clear</button>
      </div>
      ${groupsHtml}`;
  }
  const select = el<HTMLSelectElement>(sortSelectId);
  if (select) {
    const optionsHtml = nonEmpty.map((g) => {
      const opts = g.labels.map((l) => `<option value="${esc(l)}" ${l === sortLabel ? 'selected' : ''}>Sort: ${esc(l)}</option>`).join('');
      return g.heading ? `<optgroup label="${esc(g.heading)}">${opts}</optgroup>` : opts;
    }).join('');
    select.innerHTML = `<option value="" ${sortLabel === '' ? 'selected' : ''}>Sort: Title</option>${optionsHtml}`;
  }
}

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
        <input id="set-labels" type="text" list="set-label-suggestions" placeholder="Labels (comma-separated)" spellcheck="false">
        <button id="btn-save-set">Save</button>
        <button id="btn-cancel-edit" class="secondary hidden">Cancel</button>
      </div>
      <div id="sets-toolbar" class="list-toolbar">
        <details class="dropdown" id="sets-filter-dd">
          <summary>Filter ▾</summary>
          <div class="dropdown-menu" id="sets-filter-menu"></div>
        </details>
        <select id="sets-sort"><option value="">Sort: Title</option></select>
      </div>
      <div id="sets-list"></div>
    </div>
  </div>
</div>
<datalist id="key-suggestions">${KEY_SUGGESTIONS.map((k) => `<option value="${k}">`).join('')}</datalist>
<datalist id="mediatype-values">${MEDIA_TYPES.map((v) => `<option value="${v}">`).join('')}</datalist>
<datalist id="set-label-suggestions"></datalist>`;
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

function setLabels(s: SavedSet): string[] {
  return s.labels;
}

function renderSetsToolbar(): void {
  const labels = distinctLabels(sets.map(setLabels));
  setsCheckedLabels = syncCheckedLabels(setsCheckedLabels, setsKnownLabels, labels);
  renderFilterSortToolbar('sets-filter-menu', 'sets-sort', [{ labels }], setsCheckedLabels, setsSortLabel);
  el<HTMLDataListElement>('set-label-suggestions').innerHTML = labels.map((l) => `<option value="${esc(l)}">`).join('');
}

function wireSetsToolbar(): void {
  el<HTMLDivElement>('sets-filter-menu').addEventListener('click', (ev) => {
    const target = ev.target as HTMLElement;
    if (target.classList.contains('filter-all')) {
      setsCheckedLabels = new Set(distinctLabels(sets.map(setLabels)).map(labelKey));
      renderSetsToolbar();
      renderSets();
    } else if (target.classList.contains('filter-none')) {
      setsCheckedLabels = new Set();
      renderSetsToolbar();
      renderSets();
    }
  });
  el<HTMLDivElement>('sets-filter-menu').addEventListener('change', (ev) => {
    const cb = ev.target as HTMLInputElement;
    if (!cb.classList.contains('label-filter-item')) return;
    setsCheckedLabels ??= new Set();
    if (cb.checked) setsCheckedLabels.add(cb.value); else setsCheckedLabels.delete(cb.value);
    renderSets();
  });
  el<HTMLSelectElement>('sets-sort').addEventListener('change', (ev) => {
    setsSortLabel = (ev.target as HTMLSelectElement).value;
    renderSets();
  });
}

function renderSets(): void {
  const list = el<HTMLDivElement>('sets-list');
  if (sets.length === 0) {
    list.innerHTML = '<div class="empty">No saved sets yet — fill the form, name it, and hit Save.</div>';
    return;
  }

  const visible = applyLabelSort(
    applyLabelFilter(sets, setLabels, setsCheckedLabels ?? new Set(distinctLabels(sets.map(setLabels)).map(labelKey))),
    setLabels, (s) => s.name, setsSortLabel,
  );
  if (visible.length === 0) {
    list.innerHTML = '<div class="empty">No sets match the current filter.</div>';
    return;
  }

  list.innerHTML = visible.map((s) => {
    const missing = channels.length > 0 && !channels.some((c) => c.id === s.channelId);
    const summary = [s.contentId ? `contentId=${s.contentId}` : '', ...s.params.map((p) => `${p.key}=${p.value}`)]
      .filter(Boolean).join(' · ');
    const chips = s.labels.length > 0
      ? `<div class="chip-row">${s.labels.map((l) => `<span class="chip">${esc(l)}</span>`).join('')}</div>`
      : '';
    return `
    <div class="set-row" data-id="${esc(s.id)}">
      <div class="set-info">
        <span class="set-name">${esc(s.name)}</span>
        <span class="set-meta">${esc(s.channelName)} (${esc(s.channelId)})${missing ? ' <span class="warn">⚠ not installed</span>' : ''}</span>
        <span class="set-meta summary" title="${esc(summary)}">${esc(summary)}</span>
        ${chips}
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
    el<HTMLInputElement>('set-labels').value = set.labels.join(', ');
    el<HTMLInputElement>('set-name').focus();
  } else {
    editingSetId = undefined;
    el<HTMLInputElement>('set-name').value = '';
    el<HTMLInputElement>('set-labels').value = '';
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
        labels: parseLabels(el<HTMLInputElement>('set-labels').value),
      },
    });
    editingSetId = undefined;
    el<HTMLInputElement>('set-name').value = '';
    el<HTMLInputElement>('set-labels').value = '';
    syncSaveButton();
    showToast('Saved', true);
  });

  el('btn-cancel-edit').addEventListener('click', () => {
    editingSetId = undefined;
    el<HTMLInputElement>('set-name').value = '';
    el<HTMLInputElement>('set-labels').value = '';
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
      renderSetsToolbar();
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
wireSetsToolbar();
wireLabelsAutocomplete(el<HTMLInputElement>('set-labels'));
addParamRow('mediaType', '');
syncSaveButton();

// Close any open filter/sort dropdown when clicking outside it.
document.addEventListener('click', (ev) => {
  for (const dd of document.querySelectorAll<HTMLDetailsElement>('.dropdown[open]')) {
    if (!dd.contains(ev.target as Node)) dd.open = false;
  }
});
