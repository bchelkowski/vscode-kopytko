import './styles.css';
import type { AbilityAction, DeviceSummary, ExtMsg, RunProgress, ScriptListItem, TextEntryView, WebMsg } from './protocol';

interface VsCodeApi { postMessage(msg: WebMsg): void; }
declare function acquireVsCodeApi(): VsCodeApi;
const vscode = acquireVsCodeApi();

type ViewKind = 'remote' | 'scripts';
const viewKind = (document.body.dataset.view ?? 'remote') as ViewKind;

// ── shared state ─────────────────────────────────────────────────────────────

let device: DeviceSummary | undefined;
let holdThresholdMs = 1000;
let remoteModeOn = false;
let entries: TextEntryView[] = [];
let scripts: ScriptListItem[] = [];
let editingEntryId: string | undefined;
let runningScriptId: string | undefined;
let statusTimer: ReturnType<typeof setTimeout> | undefined;

// Transient filter/sort state (per list) — resets on reload, never persisted.
let entriesCheckedLabels: Set<string> | undefined;
const entriesKnownLabels = new Set<string>();
let entriesSortLabel = '';
let scriptsCheckedLabels: Set<string> | undefined;
const scriptsKnownLabels = new Set<string>();
let scriptsSortLabel = '';

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

/** A facet of labels shown in the filter/sort toolbar, optionally under its own heading (e.g. "Type" vs "Labels"). */
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

// ── helpers ──────────────────────────────────────────────────────────────────

function esc(text: string): string {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function el<T extends HTMLElement>(id: string): T {
  return document.getElementById(id) as T;
}

function post(msg: WebMsg): void {
  vscode.postMessage(msg);
}

/** Transient status line shared by all views (errors stick around longer). */
function showStatus(text: string, isError: boolean): void {
  const status = el<HTMLSpanElement>('status-line');
  if (!status) return;
  status.textContent = text;
  status.classList.toggle('error', isError);
  if (statusTimer) clearTimeout(statusTimer);
  statusTimer = setTimeout(() => { status.textContent = ''; }, isError ? 6000 : 2500);
}

function renderDeviceBanner(): void {
  const dot = el<HTMLSpanElement>('status-dot');
  const label = el<HTMLSpanElement>('device-label');
  if (!dot || !label) return;
  dot.classList.toggle('online', device !== undefined);
  label.textContent = device ? `${device.name} @ ${device.ip}` : 'No active device';
  document.body.classList.toggle('no-device', device === undefined);
}

// ── remote view ──────────────────────────────────────────────────────────────

interface RemoteButton {
  key: string;
  label: string;
  title: string;
  area: string;
}

// Stroke-icon helper matching the official Roku remote-tool keypad glyphs.
const icon = (paths: string, filled = false): string =>
  `<svg viewBox="0 0 24 24" width="18" height="18" ${filled
    ? 'fill="currentColor" stroke="none"'
    : 'fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"'}>${paths}</svg>`;

// Layout mirrors Roku's remote-tool keypad: Back/Home, then the D-pad
// (Up / Left-OK-Right / Down), then Instant Replay/Options, then Rev/Play/Fwd.
const REMOTE_BUTTONS: RemoteButton[] = [
  { key: 'Back',          label: icon('<path d="M19 12H5"/><path d="M11 6l-6 6 6 6"/>'),                       title: 'Back',               area: 'back' },
  { key: 'Home',          label: icon('<path d="M4 11l8-7 8 7"/><path d="M6.5 9.5V20h11V9.5"/>'),             title: 'Home',               area: 'home' },
  { key: 'Up',            label: icon('<path d="M6 14.5l6-6 6 6"/>'),                                         title: 'Up',                 area: 'up' },
  { key: 'Left',          label: icon('<path d="M14.5 6l-6 6 6 6"/>'),                                        title: 'Left',               area: 'left' },
  { key: 'Select',        label: '<span class="ok-label">OK</span>',                                          title: 'OK / Select',        area: 'ok' },
  { key: 'Right',         label: icon('<path d="M9.5 6l6 6-6 6"/>'),                                          title: 'Right',              area: 'right' },
  { key: 'Down',          label: icon('<path d="M6 9.5l6 6 6-6"/>'),                                          title: 'Down',               area: 'down' },
  { key: 'InstantReplay', label: icon('<path d="M5.5 9a8 8 0 1 1-1.3 6.5"/><path d="M5.5 4v5h5"/>'),          title: 'Instant replay',     area: 'replay' },
  { key: 'Info',          label: icon('<path d="M12 5v14"/><path d="M6 8.5l12 7"/><path d="M18 8.5l-12 7"/>'), title: 'Options / Info (*)', area: 'info' },
  { key: 'Rev',           label: icon('<path d="M12 6v12l-9-6zM21 6v12l-9-6z"/>', true),                      title: 'Rewind',             area: 'rev' },
  { key: 'Play',          label: icon('<path d="M8 5v14l12-7z"/>', true),                                     title: 'Play / Pause',       area: 'play' },
  { key: 'Fwd',           label: icon('<path d="M3 6l9 6-9 6zM12 6l9 6-9 6z"/>', true),                       title: 'Fast forward',       area: 'fwd' },
];

function buildRemoteDom(): void {
  document.body.tabIndex = -1; // focusable so keyboard mode works right away
  document.body.innerHTML = `
<div id="toolbar">
  <span class="status-dot" id="status-dot"></span>
  <span id="device-label">No active device</span>
  <span id="status-line"></span>
</div>
<div id="remote">
  ${REMOTE_BUTTONS.map((b) => `
    <button class="remote-btn" data-key="${b.key}" title="${esc(b.title)}" style="grid-area: ${b.area}">
      ${b.label}
    </button>`).join('')}
</div>
<div id="text-send">
  <input id="text-input" type="text" placeholder="Type text to send…" spellcheck="false">
  <button id="btn-send" title="Type this text on the device, character by character">Send</button>
</div>
<label id="kb-toggle-row" title="When on, your keyboard drives the device: arrows/Enter/Escape navigate from anywhere in VS Code, and typing with this view focused goes to the device keyboard.">
  <input type="checkbox" id="kb-toggle">
  <span>Keyboard remote mode</span>
</label>
<div id="kb-hint" class="hidden">Arrows/Enter/Esc/Backspace navigate the device from anywhere. Typing lands on the device while this view is focused. <b>Ctrl+K</b> exits.</div>

<details id="saved-text" class="section-disclosure" open>
  <summary>Saved Text</summary>
  <div id="entries-toolbar" class="list-toolbar">
    <details class="dropdown" id="entries-filter-dd">
      <summary>Filter ▾</summary>
      <div class="dropdown-menu" id="entries-filter-menu"></div>
    </details>
    <select id="entries-sort"><option value="">Sort: Title</option></select>
  </div>
  <div id="entries-list"></div>
  <button id="btn-add-entry" class="secondary">+ Add entry</button>
  <div id="entry-form" class="hidden"></div>
</details>

<details id="device-actions" class="section-disclosure" open>
  <summary>Device actions</summary>
  <div class="action-list">
    ${ACTION_ROWS.map((r) => `
      <button class="device-action ${r.danger ? 'danger' : ''}" data-action="${r.action}">
        <span class="action-icon">${r.icon}</span>
        <span class="action-text">
          <span class="action-label">${esc(r.label)}</span>
          <span class="action-desc">${esc(r.description)}</span>
        </span>
      </button>`).join('')}
  </div>
</details>

<details id="secret-screens" class="section-disclosure" open>
  <summary>Secret screens</summary>
  <div class="action-list">
    ${SECRET_SCREENS.map((s) => `
      <div class="secret-screen-row">
        <span class="action-icon">${s.icon}</span>
        <span class="action-text">
          <span class="action-label">${esc(s.label)}</span>
          <span class="secret-screen-keys">${esc(s.keys)}</span>
          <span class="action-desc">${esc(s.description)}</span>
        </span>
      </div>`).join('')}
  </div>
</details>`;

  wireRemoteButtons();
  wireTextSend();
  wireKeyboardMode();
  wireAbilityButtons();
  wireEntriesAddButton();
  wireEntriesToolbar();
}

/**
 * Press-and-hold state machine per button: release before the threshold →
 * one keypress; timer elapses first → keydown now, keyup on release.
 */
function wireRemoteButtons(): void {
  for (const btn of document.querySelectorAll<HTMLButtonElement>('.remote-btn')) {
    const key = btn.dataset.key!;
    let holdTimer: ReturnType<typeof setTimeout> | undefined;
    let held = false;

    const cancelTimer = (): void => {
      if (holdTimer !== undefined) { clearTimeout(holdTimer); holdTimer = undefined; }
    };

    btn.addEventListener('pointerdown', (ev) => {
      if (device === undefined) return;
      ev.preventDefault();
      btn.setPointerCapture(ev.pointerId);
      held = false;
      cancelTimer();
      holdTimer = setTimeout(() => {
        held = true;
        btn.classList.add('held');
        post({ kind: 'keyHoldStart', key });
      }, holdThresholdMs);
    });

    const finish = (send: boolean): void => {
      cancelTimer();
      if (held) {
        held = false;
        btn.classList.remove('held');
        post({ kind: 'keyHoldEnd', key });
      } else if (send) {
        post({ kind: 'keyPress', key });
      }
    };

    btn.addEventListener('pointerup', (ev) => {
      if (device === undefined) return;
      ev.preventDefault();
      finish(true);
    });
    btn.addEventListener('pointercancel', () => finish(false));
    // Click handled through pointer events; suppress the synthetic click.
    btn.addEventListener('click', (ev) => ev.preventDefault());
  }
}

function wireTextSend(): void {
  const input = el<HTMLInputElement>('text-input');
  const send = el<HTMLButtonElement>('btn-send');

  const doSend = (): void => {
    const text = input.value;
    if (text === '' || device === undefined) return;
    input.disabled = true;
    send.disabled = true;
    post({ kind: 'sendText', text });
  };

  send.addEventListener('click', doSend);
  // Typing here stays local by design — the remote-mode capture skips this
  // input by id. No stopPropagation: it would hide the event from VS Code's
  // webview keyboard handling (clipboard shortcuts, keybinding re-dispatch).
  input.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter') {
      ev.preventDefault();
      doSend();
    }
  });
}

function wireKeyboardMode(): void {
  el<HTMLInputElement>('kb-toggle').addEventListener('change', () => {
    post({ kind: 'toggleRemoteMode' });
  });

  // While remote mode is ON and this view is focused, printable characters go
  // to the device keyboard as Lit_ keys — no matter which element inside the
  // view has focus (a remote button, the checkbox, the view background), with
  // one exception: the Send text field keeps typing local, it has its own
  // buffered-send purpose. Navigation keys (arrows/Enter/…) are deliberately
  // NOT handled here: VS Code re-dispatches webview keyboard events to the
  // workbench, so the extension's remote-mode keybindings fire for them even
  // with this view focused — handling them here too would double-send.
  document.addEventListener('keydown', (ev) => {
    if (!remoteModeOn || device === undefined) return;
    const target = ev.target as HTMLElement | null;
    if (target?.id === 'text-input') return;
    if (ev.ctrlKey || ev.metaKey || ev.altKey) return;
    if (ev.key.length !== 1) return;
    ev.preventDefault();
    post({ kind: 'keyPress', key: `Lit_${encodeURIComponent(ev.key)}` });
  });
}

function applyRemoteMode(): void {
  const toggle = el<HTMLInputElement>('kb-toggle');
  if (toggle) toggle.checked = remoteModeOn;
  el<HTMLDivElement>('kb-hint')?.classList.toggle('hidden', !remoteModeOn);
  // Typing should work the moment the mode turns on — don't make the user
  // hunt for a focusable spot first.
  if (remoteModeOn && document.activeElement?.id !== 'text-input') {
    document.body.focus();
  }
}

function applyRemoteDevice(): void {
  renderDeviceBanner();
  for (const btn of document.querySelectorAll<HTMLButtonElement>('.remote-btn')) {
    btn.disabled = device === undefined;
  }
  const input = el<HTMLInputElement>('text-input');
  const send = el<HTMLButtonElement>('btn-send');
  if (input && !input.disabled) input.placeholder = device ? 'Type text to send…' : 'No active device';
  if (send) send.disabled = device === undefined;
}

// ── saved text entries ───────────────────────────────────────────────────────

function entryTitle(entry: TextEntryView): string {
  return entry.title ?? '';
}

/** The implicit `type` label plus custom labels — used for filter/sort/autocomplete. */
function entryLabels(entry: TextEntryView): string[] {
  return [entry.type, ...entry.labels];
}

function focusEntryForm(): void {
  el<HTMLDivElement>('entry-form').scrollIntoView({ behavior: 'smooth', block: 'start' });
  el<HTMLInputElement>('entry-title')?.focus();
}

function wireEntriesAddButton(): void {
  el<HTMLButtonElement>('btn-add-entry').addEventListener('click', () => {
    editingEntryId = undefined;
    renderEntryForm({ type: 'text' });
    focusEntryForm();
  });
}

function wireEntriesToolbar(): void {
  el<HTMLDivElement>('entries-filter-menu').addEventListener('click', (ev) => {
    const target = ev.target as HTMLElement;
    if (target.classList.contains('filter-all')) {
      entriesCheckedLabels = new Set(distinctLabels(entries.map(entryLabels)).map(labelKey));
      renderEntriesToolbar();
      renderEntries();
    } else if (target.classList.contains('filter-none')) {
      entriesCheckedLabels = new Set();
      renderEntriesToolbar();
      renderEntries();
    }
  });
  el<HTMLDivElement>('entries-filter-menu').addEventListener('change', (ev) => {
    const cb = ev.target as HTMLInputElement;
    if (!cb.classList.contains('label-filter-item')) return;
    entriesCheckedLabels ??= new Set();
    if (cb.checked) entriesCheckedLabels.add(cb.value); else entriesCheckedLabels.delete(cb.value);
    renderEntries();
  });
  el<HTMLSelectElement>('entries-sort').addEventListener('change', (ev) => {
    entriesSortLabel = (ev.target as HTMLSelectElement).value;
    renderEntries();
  });
}

function renderEntriesToolbar(): void {
  const typeLabels = distinctLabels(entries.map((e) => [e.type]));
  const customLabels = distinctLabels(entries.map((e) => e.labels));
  entriesCheckedLabels = syncCheckedLabels(entriesCheckedLabels, entriesKnownLabels, [...typeLabels, ...customLabels]);
  renderFilterSortToolbar(
    'entries-filter-menu', 'entries-sort',
    [{ heading: 'Type', labels: typeLabels }, { heading: 'Labels', labels: customLabels }],
    entriesCheckedLabels, entriesSortLabel,
  );
}

function renderEntries(): void {
  const list = el<HTMLDivElement>('entries-list');
  if (!list) return;

  if (entries.length === 0) {
    list.innerHTML = '<div class="empty">No saved entries yet. Add reusable text or credentials to type them on the device with one click.</div>';
    return;
  }

  const visible = applyLabelSort(
    applyLabelFilter(entries, entryLabels, entriesCheckedLabels ?? new Set(distinctLabels(entries.map(entryLabels)).map(labelKey))),
    entryLabels, entryTitle, entriesSortLabel,
  );
  if (visible.length === 0) {
    list.innerHTML = '<div class="empty">No entries match the current filter.</div>';
    return;
  }

  list.innerHTML = visible.map((entry) => {
    const title = entryTitle(entry);
    // The implicit `type` value is rendered as a regular chip alongside custom labels —
    // no separate badge — so it always shows the same way whether it's the only "label"
    // an entry has or one of several.
    const chipsHtml = entryLabels(entry).map((l) => `<span class="chip">${esc(l)}</span>`).join('');
    // With a title, chips get their own row below the head. Without one, the chips take
    // over the head's title slot instead of leaving it empty.
    const headContent = title
      ? `<span class="card-title" title="${esc(title)}">${esc(title)}</span>`
      : `<div class="chip-row inline">${chipsHtml}</div>`;
    const belowHeadChips = title ? `<div class="chip-row">${chipsHtml}</div>` : '';
    const fields = entry.type === 'text'
      ? `<div class="entry-field">
           <span class="entry-value" title="${esc(entry.text ?? '')}">${esc(entry.text ?? '')}</span>
           <button class="entry-send" data-id="${entry.id}" data-field="text" title="Type this text on the device">Send</button>
         </div>`
      : `<div class="entry-field">
           <span class="entry-value" title="${esc(entry.login ?? '')}">${esc(entry.login ?? '')}</span>
           <button class="entry-send" data-id="${entry.id}" data-field="login" title="Type the login on the device">Send</button>
         </div>
         <div class="entry-field">
           <span class="entry-value muted">${entry.hasPassword ? '••••••••' : 'no password stored'}</span>
           <button class="entry-send" data-id="${entry.id}" data-field="password" title="Type the password on the device" ${entry.hasPassword ? '' : 'disabled'}>Send</button>
         </div>`;

    return `
<div class="card" data-id="${entry.id}">
  <div class="card-head">
    ${headContent}
    <button class="icon-btn entry-edit" data-id="${entry.id}" title="Edit">✎</button>
    <button class="icon-btn entry-delete" data-id="${entry.id}" title="Delete">✕</button>
  </div>
  ${belowHeadChips}
  ${fields}
</div>`;
  }).join('');

  for (const btn of list.querySelectorAll<HTMLButtonElement>('.entry-send')) {
    btn.addEventListener('click', () => {
      if (device === undefined) { showStatus('No active device.', true); return; }
      post({ kind: 'sendEntryField', id: btn.dataset.id!, field: btn.dataset.field as 'text' | 'login' | 'password' });
      showStatus('Sending…', false);
    });
  }
  for (const btn of list.querySelectorAll<HTMLButtonElement>('.entry-edit')) {
    btn.addEventListener('click', () => {
      const entry = entries.find((e) => e.id === btn.dataset.id);
      if (!entry) return;
      editingEntryId = entry.id;
      renderEntryForm(entry);
      focusEntryForm();
    });
  }
  for (const btn of list.querySelectorAll<HTMLButtonElement>('.entry-delete')) {
    btn.addEventListener('click', () => post({ kind: 'deleteEntry', id: btn.dataset.id! }));
  }
}

function renderEntryForm(entry: Partial<TextEntryView>): void {
  const form = el<HTMLDivElement>('entry-form');
  const isEdit = editingEntryId !== undefined;
  const type = entry.type ?? 'text';
  const suggestions = distinctLabels(entries.map((e) => e.labels));

  form.classList.remove('hidden');
  form.innerHTML = `
<h3>${isEdit ? 'Edit entry' : 'New entry'}</h3>
<label class="field-label" for="entry-type">Type</label>
<select id="entry-type" ${isEdit ? 'disabled' : ''}>
  <option value="text" ${type === 'text' ? 'selected' : ''}>Text</option>
  <option value="credentials" ${type === 'credentials' ? 'selected' : ''}>Credentials</option>
</select>
<label class="field-label" for="entry-title">Title (optional)</label>
<input id="entry-title" type="text" value="${esc(entry.title ?? '')}" spellcheck="false">
<div id="entry-type-fields"></div>
<label class="field-label" for="entry-labels">Labels (comma-separated)</label>
<input id="entry-labels" type="text" list="entry-label-suggestions" value="${esc((entry.labels ?? []).join(', '))}" spellcheck="false">
<datalist id="entry-label-suggestions">${suggestions.map((l) => `<option value="${esc(l)}">`).join('')}</datalist>
<div class="action-row">
  <button id="btn-entry-save">Save</button>
  <button id="btn-entry-cancel" class="secondary">Cancel</button>
</div>`;

  wireLabelsAutocomplete(el<HTMLInputElement>('entry-labels'));

  const renderTypeFields = (t: string): void => {
    el<HTMLDivElement>('entry-type-fields').innerHTML = t === 'text'
      ? `<label class="field-label" for="entry-text">Text</label>
         <input id="entry-text" type="text" value="${esc(entry.text ?? '')}" spellcheck="false">`
      : `<label class="field-label" for="entry-login">Email / login</label>
         <input id="entry-login" type="text" value="${esc(entry.login ?? '')}" spellcheck="false">
         <label class="field-label" for="entry-password">Password${isEdit && entry.hasPassword ? ' (leave blank to keep current)' : ''}</label>
         <input id="entry-password" type="password" value="" spellcheck="false">`;
  };
  renderTypeFields(type);

  el<HTMLSelectElement>('entry-type').addEventListener('change', (ev) => {
    renderTypeFields((ev.target as HTMLSelectElement).value);
  });

  el<HTMLButtonElement>('btn-entry-save').addEventListener('click', () => {
    const selectedType = el<HTMLSelectElement>('entry-type').value as 'text' | 'credentials';
    const title = el<HTMLInputElement>('entry-title').value.trim() || undefined;
    const labels = parseLabels(el<HTMLInputElement>('entry-labels').value);

    if (selectedType === 'text') {
      const text = el<HTMLInputElement>('entry-text').value;
      if (text === '') { showStatus('Text is required.', true); return; }
      post({ kind: 'saveEntry', entry: { id: editingEntryId, type: 'text', title, labels, text } });
    } else {
      const login = el<HTMLInputElement>('entry-login').value;
      const password = el<HTMLInputElement>('entry-password').value;
      if (login === '') { showStatus('Login is required.', true); return; }
      post({ kind: 'saveEntry', entry: { id: editingEntryId, type: 'credentials', title, labels, login, password } });
    }
    closeEntryForm();
  });

  el<HTMLButtonElement>('btn-entry-cancel').addEventListener('click', closeEntryForm);
}

function closeEntryForm(): void {
  editingEntryId = undefined;
  const form = el<HTMLDivElement>('entry-form');
  form.classList.add('hidden');
  form.innerHTML = '';
}

// ── scripts view ─────────────────────────────────────────────────────────────

function buildScriptsDom(): void {
  document.body.innerHTML = `
<div id="toolbar">
  <span class="status-dot" id="status-dot"></span>
  <span id="device-label">No active device</span>
  <span id="status-line"></span>
</div>
<div class="action-row">
  <button id="btn-new-script">+ New script</button>
  <button id="btn-import-script" class="secondary" title="Import a .rasp file (Roku Remote Tool format)">Import</button>
</div>
<div id="scripts-toolbar" class="list-toolbar">
  <details class="dropdown" id="scripts-filter-dd">
    <summary>Filter ▾</summary>
    <div class="dropdown-menu" id="scripts-filter-menu"></div>
  </details>
  <select id="scripts-sort"><option value="">Sort: Title</option></select>
</div>
<div id="scripts-list"></div>
<div id="run-progress" class="hidden"></div>`;

  el<HTMLButtonElement>('btn-new-script').addEventListener('click', () => post({ kind: 'newScript' }));
  el<HTMLButtonElement>('btn-import-script').addEventListener('click', () => post({ kind: 'importScript' }));
  wireScriptsToolbar();
}

function scriptLabels(s: ScriptListItem): string[] {
  return s.labels;
}

function wireScriptsToolbar(): void {
  el<HTMLDivElement>('scripts-filter-menu').addEventListener('click', (ev) => {
    const target = ev.target as HTMLElement;
    if (target.classList.contains('filter-all')) {
      scriptsCheckedLabels = new Set(distinctLabels(scripts.map(scriptLabels)).map(labelKey));
      renderScriptsToolbar();
      renderScripts();
    } else if (target.classList.contains('filter-none')) {
      scriptsCheckedLabels = new Set();
      renderScriptsToolbar();
      renderScripts();
    }
  });
  el<HTMLDivElement>('scripts-filter-menu').addEventListener('change', (ev) => {
    const cb = ev.target as HTMLInputElement;
    if (!cb.classList.contains('label-filter-item')) return;
    scriptsCheckedLabels ??= new Set();
    if (cb.checked) scriptsCheckedLabels.add(cb.value); else scriptsCheckedLabels.delete(cb.value);
    renderScripts();
  });
  el<HTMLSelectElement>('scripts-sort').addEventListener('change', (ev) => {
    scriptsSortLabel = (ev.target as HTMLSelectElement).value;
    renderScripts();
  });
}

function renderScriptsToolbar(): void {
  const labels = distinctLabels(scripts.map(scriptLabels));
  scriptsCheckedLabels = syncCheckedLabels(scriptsCheckedLabels, scriptsKnownLabels, labels);
  renderFilterSortToolbar('scripts-filter-menu', 'scripts-sort', [{ labels }], scriptsCheckedLabels, scriptsSortLabel);
}

function renderScripts(): void {
  const list = el<HTMLDivElement>('scripts-list');
  if (!list) return;

  if (scripts.length === 0) {
    list.innerHTML = '<div class="empty">No saved scripts yet. Create automation scripts compatible with the Roku Remote Tool (RASP).</div>';
    return;
  }

  const visible = applyLabelSort(
    applyLabelFilter(scripts, scriptLabels, scriptsCheckedLabels ?? new Set(distinctLabels(scripts.map(scriptLabels)).map(labelKey))),
    scriptLabels, (s) => s.title, scriptsSortLabel,
  );
  if (visible.length === 0) {
    list.innerHTML = '<div class="empty">No scripts match the current filter.</div>';
    return;
  }

  list.innerHTML = visible.map((s) => `
<div class="card" data-id="${s.id}">
  <div class="card-head">
    ${s.title ? `<span class="card-title" title="${esc(s.title)}">${esc(s.title)}</span>` : ''}
    <span class="badge">${s.format}</span>
  </div>
  ${s.labels.length > 0 ? `<div class="chip-row">${s.labels.map((l) => `<span class="chip">${esc(l)}</span>`).join('')}</div>` : ''}
  <div class="action-row">
    ${runningScriptId === s.id
      ? `<button class="script-cancel" data-id="${s.id}" title="Cancel the running script">Cancel</button>`
      : `<button class="script-run" data-id="${s.id}" title="Run on the active device" ${runningScriptId !== undefined || device === undefined ? 'disabled' : ''}>Run</button>`}
    <button class="icon-btn script-edit" data-id="${s.id}" title="Edit in the script editor">✎</button>
    <button class="icon-btn script-export" data-id="${s.id}" title="Export as .rasp file">⇩</button>
    <button class="icon-btn script-delete" data-id="${s.id}" title="Delete">✕</button>
  </div>
</div>`).join('');

  const wire = (selector: string, handler: (id: string) => void): void => {
    for (const btn of list.querySelectorAll<HTMLButtonElement>(selector)) {
      btn.addEventListener('click', () => handler(btn.dataset.id!));
    }
  };
  wire('.script-run', (id) => post({ kind: 'runScript', id }));
  wire('.script-cancel', (id) => post({ kind: 'cancelRun', id }));
  wire('.script-edit', (id) => post({ kind: 'editScript', id }));
  wire('.script-export', (id) => post({ kind: 'exportScript', id }));
  wire('.script-delete', (id) => post({ kind: 'deleteScript', id }));
}

function renderRunProgress(progress: RunProgress): void {
  const box = el<HTMLDivElement>('run-progress');
  if (!box) return;

  if (progress.status === 'running') {
    runningScriptId = progress.scriptId;
    box.classList.remove('hidden');
    box.classList.remove('error');
    box.textContent = `▶ ${progress.index + 1}/${progress.total} — ${progress.label}`;
  } else if (progress.status === 'failed') {
    runningScriptId = undefined;
    box.classList.remove('hidden');
    box.classList.add('error');
    box.textContent = `✕ Failed${progress.label ? ` at ${progress.label}` : ''}${progress.message ? `: ${progress.message}` : ''}`;
  } else if (progress.status === 'cancelled') {
    runningScriptId = undefined;
    box.classList.remove('hidden');
    box.classList.remove('error');
    box.textContent = '■ Cancelled';
  } else if (progress.status === 'done') {
    runningScriptId = undefined;
    box.classList.remove('hidden');
    box.classList.remove('error');
    box.textContent = '✓ Finished';
  }
  renderScripts();
}

// ── device actions ───────────────────────────────────────────────────────────

interface ActionRow {
  action: AbilityAction;
  icon: string;
  label: string;
  description: string;
  danger?: boolean;
}

// One flat, labeled list. The order is a deliberate workflow order (capture
// → build/sign → keep the OS current → disruptive actions last), not
// alphabetical — don't "tidy" this into categories.
const ACTION_ROWS: ActionRow[] = [
  { action: 'screenshot', icon: icon('<rect x="3" y="7" width="18" height="13" rx="2"/><path d="M8 7l1.5-2.5h5L16 7"/><circle cx="12" cy="13.5" r="3.5"/>'), label: 'Screenshot', description: 'Capture the running dev channel (requires developer password)' },
  { action: 'installChannel', icon: icon('<path d="M12 3v11"/><path d="M8 10l4 4 4-4"/><path d="M4 17v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3"/>'), label: 'Upload channel', description: 'Sideload a channel zip (dev web-admin Installer)' },
  { action: 'packageChannel', icon: icon('<path d="M21 8l-9-5-9 5 9 5 9-5z"/><path d="M3 8v8l9 5 9-5V8"/><path d="M12 13v8"/>'), label: 'Package', description: 'Install a zip and sign it into a .pkg (Packager)' },
  { action: 'rekey', icon: icon('<circle cx="8" cy="15" r="3.5"/><path d="M10.8 12.2L19 4"/><path d="M15.5 8.5l2.5 2.5"/><path d="M18 6l2.5 2.5"/>'), label: 'Rekey', description: 'Rekey the device with a signed .pkg' },
  { action: 'checkUpdate', icon: icon('<path d="M4 12a8 8 0 0 1 14-5.3M20 12a8 8 0 0 1-14 5.3"/><path d="M18 3v4h-4"/><path d="M6 21v-4h4"/>'), label: 'Software update', description: 'Trigger a system update check (result shows on the device)' },
  { action: 'reboot', icon: icon('<path d="M12 3v6"/><path d="M6.3 6.3a8 8 0 1 0 11.4 0"/>'), label: 'Restart', description: 'Reboot the device', danger: true },
  { action: 'deleteChannel', icon: icon('<path d="M4 7h16"/><path d="M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/><path d="M6 7l1 13a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-13"/><path d="M10 11v6"/><path d="M14 11v6"/>'), label: 'Delete channel', description: 'Remove the sideloaded dev channel', danger: true },
];

function wireAbilityButtons(): void {
  for (const btn of document.querySelectorAll<HTMLButtonElement>('.device-action')) {
    btn.addEventListener('click', () => {
      post({ kind: 'ability', action: btn.dataset.action as AbilityAction });
    });
  }
}

function applyAbilitiesBusy(busy: boolean): void {
  for (const btn of document.querySelectorAll<HTMLButtonElement>('.device-action')) {
    btn.disabled = busy || device === undefined;
  }
}

// ── secret screens (reference only — never auto-pressed) ───────────────────────

interface SecretScreenRow {
  icon: string;
  label: string;
  keys: string;
  description: string;
}

// Purely informational — type these into the physical remote yourself.
// Deliberately NOT wired to a button: some of these sequences only respond
// to genuine physical/IR remote input, not ECP-simulated keypresses (Enable
// dev mode and Screenshots & Ads never triggered via ECP despite the exact
// same key list working by hand), and even the ones that did trigger via
// ECP on this device aren't guaranteed to on other models or after a future
// OS update — not worth risking a button that might silently do nothing.
const SECRET_SCREENS: SecretScreenRow[] = [
  { icon: icon('<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1"/>'), label: 'Enable dev mode', keys: 'Home ×3, Up ×2, Right, Left, Right, Left, Right', description: 'Opens the Developer Application Installer screen — finish the prompts on-device.' },
  { icon: icon('<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 8h8M8 12h8M8 16h5"/>'), label: 'Channel info', keys: 'Home ×3, Up ×2, Left, Right, Left, Right, Left', description: 'Shows metadata, version numbers, and developer tracking IDs for installed channels.' },
  { icon: icon('<rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="8.5" cy="10" r="1.5"/><path d="M21 15l-5-5-4 4-3-3-5 5"/>'), label: 'Screenshots & Ads', keys: 'Home ×5, Up, Right, Down, Left, Up', description: 'Ad-banner behavior toggles, cycling theme logs, and screenshot capture.' },
  { icon: icon('<path d="M12 3l10 18H2L12 3z"/><path d="M12 10v4"/><path d="M12 17h.01"/>'), label: 'Reset & Update', keys: 'Home ×5, Fwd ×3, Rev ×2', description: 'Opens a diagnostic panel offering Factory Reset (wipes the registry) or Soft Reset/Software Update.' },
  { icon: icon('<path d="M12 3l9 5-9 5-9-5 9-5z"/><path d="M3 13l9 5 9-5"/><path d="M3 8l9 5 9-5"/>'), label: 'Clear cache', keys: 'Home ×5, Up, Rev ×2, Fwd ×2', description: 'Clears temporary system caches and forces a hard reboot (not a registry clear); can take up to ~1 minute.' },
];

// ── message dispatch ─────────────────────────────────────────────────────────

window.addEventListener('message', (event: MessageEvent<ExtMsg>) => {
  const msg = event.data;
  switch (msg.kind) {
    case 'config':
      holdThresholdMs = msg.holdThresholdMs;
      return;

    case 'device':
      device = msg.device;
      renderDeviceBanner();
      if (viewKind === 'remote') {
        applyRemoteDevice();
        applyAbilitiesBusy(false);
      }
      if (viewKind === 'scripts') renderScripts();
      return;

    case 'remoteMode':
      remoteModeOn = msg.on;
      if (viewKind === 'remote') applyRemoteMode();
      return;

    case 'sendTextResult': {
      const input = el<HTMLInputElement>('text-input');
      const send = el<HTMLButtonElement>('btn-send');
      if (input) {
        input.disabled = false;
        if (msg.ok) input.value = '';
        input.focus();
      }
      if (send) send.disabled = device === undefined;
      showStatus(msg.ok ? 'Text sent.' : `Send failed: ${msg.message ?? 'unknown error'}`, !msg.ok);
      return;
    }

    case 'entries':
      entries = msg.entries;
      renderEntriesToolbar();
      renderEntries();
      return;

    case 'entryResult':
      if (!msg.ok) showStatus(msg.message ?? 'Operation failed.', true);
      else if (msg.id !== undefined) showStatus('Sent.', false);
      return;

    case 'scripts':
      scripts = msg.scripts;
      renderScriptsToolbar();
      renderScripts();
      return;

    case 'runProgress':
      renderRunProgress(msg.progress);
      return;

    case 'actionResult':
      if (!msg.ok) showStatus(msg.message ?? `${msg.action} failed.`, true);
      else if (msg.message) showStatus(msg.message, false);
      return;

    case 'busy':
      if (viewKind === 'remote') applyAbilitiesBusy(msg.on);
      return;
  }
});

// Close any open filter/sort dropdown when clicking outside it.
document.addEventListener('click', (ev) => {
  for (const dd of document.querySelectorAll<HTMLDetailsElement>('.dropdown[open]')) {
    if (!dd.contains(ev.target as Node)) dd.open = false;
  }
});

// ── boot ─────────────────────────────────────────────────────────────────────

switch (viewKind) {
  case 'remote': buildRemoteDom(); break;
  case 'scripts': buildScriptsDom(); break;
}
renderDeviceBanner();
post({ kind: 'ready' });
