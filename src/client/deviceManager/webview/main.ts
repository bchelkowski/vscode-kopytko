import './styles.css';
import type { AbilityAction, DeviceSummary, ExtMsg, RunProgress, ScriptListItem, TextEntryView, WebMsg } from './protocol';

interface VsCodeApi { postMessage(msg: WebMsg): void; }
declare function acquireVsCodeApi(): VsCodeApi;
const vscode = acquireVsCodeApi();

type ViewKind = 'remote' | 'entries' | 'scripts' | 'abilities';
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
  cls?: string;
  area: string;
}

const REMOTE_BUTTONS: RemoteButton[] = [
  { key: 'Power',         label: '⏻',  title: 'Power (Roku TV only)', cls: 'power', area: 'power' },
  { key: 'Back',          label: '←',  title: 'Back',                 area: 'back' },
  { key: 'Home',          label: '⌂',  title: 'Home',                 area: 'home' },
  { key: 'Up',            label: '▲',  title: 'Up',                   cls: 'dpad', area: 'up' },
  { key: 'Left',          label: '◀',  title: 'Left',                 cls: 'dpad', area: 'left' },
  { key: 'Select',        label: 'OK', title: 'OK / Select',          cls: 'dpad ok', area: 'ok' },
  { key: 'Right',         label: '▶',  title: 'Right',                cls: 'dpad', area: 'right' },
  { key: 'Down',          label: '▼',  title: 'Down',                 cls: 'dpad', area: 'down' },
  { key: 'InstantReplay', label: '↻',  title: 'Instant replay',       area: 'replay' },
  { key: 'Info',          label: '✱',  title: 'Options / Info (*)',   area: 'info' },
  { key: 'Rev',           label: '⏪', title: 'Rewind',               area: 'rev' },
  { key: 'Play',          label: '⏯',  title: 'Play / Pause',         area: 'play' },
  { key: 'Fwd',           label: '⏩', title: 'Fast forward',         area: 'fwd' },
  { key: 'VolumeDown',    label: '🔉', title: 'Volume down (Roku TV only)', cls: 'volume', area: 'voldown' },
  { key: 'VolumeMute',    label: '🔇', title: 'Mute (Roku TV only)',        cls: 'volume', area: 'mute' },
  { key: 'VolumeUp',      label: '🔊', title: 'Volume up (Roku TV only)',   cls: 'volume', area: 'volup' },
];

function buildRemoteDom(): void {
  document.body.innerHTML = `
<div id="toolbar">
  <span class="status-dot" id="status-dot"></span>
  <span id="device-label">No active device</span>
  <span id="status-line"></span>
</div>
<div id="remote">
  ${REMOTE_BUTTONS.map((b) => `
    <button class="remote-btn ${b.cls ?? ''}" data-key="${b.key}" title="${esc(b.title)}" style="grid-area: ${b.area}">
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
<div id="kb-hint" class="hidden">Arrows/Enter/Esc/Backspace navigate the device from anywhere. Typing lands on the device while this view is focused. <b>Ctrl+K</b> exits.</div>`;

  wireRemoteButtons();
  wireTextSend();
  wireKeyboardMode();
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
  input.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter') {
      ev.preventDefault();
      doSend();
    }
    // Keep typing in the input local — never captured by remote mode.
    ev.stopPropagation();
  });
}

function wireKeyboardMode(): void {
  el<HTMLInputElement>('kb-toggle').addEventListener('change', () => {
    post({ kind: 'toggleRemoteMode' });
  });

  // While remote mode is ON and this view is focused, printable characters go
  // to the device keyboard as Lit_ keys. Navigation keys (arrows/Enter/…) are
  // deliberately NOT handled here: VS Code re-dispatches webview keyboard
  // events to the workbench, so the extension's remote-mode keybindings fire
  // for them even with this view focused — handling them here too would
  // double-send every navigation key.
  document.addEventListener('keydown', (ev) => {
    if (!remoteModeOn || device === undefined) return;
    const target = ev.target as HTMLElement | null;
    if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return;
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
}

function applyRemoteDevice(): void {
  renderDeviceBanner();
  const isTV = device?.isTV === true;
  for (const btn of document.querySelectorAll<HTMLButtonElement>('.remote-btn')) {
    btn.disabled = device === undefined;
    if (btn.dataset.key === 'Power') btn.classList.toggle('hidden', !isTV);
  }
  const input = el<HTMLInputElement>('text-input');
  const send = el<HTMLButtonElement>('btn-send');
  if (input && !input.disabled) input.placeholder = device ? 'Type text to send…' : 'No active device';
  if (send) send.disabled = device === undefined;
}

// ── entries view ─────────────────────────────────────────────────────────────

function buildEntriesDom(): void {
  document.body.innerHTML = `
<div id="toolbar">
  <span class="status-dot" id="status-dot"></span>
  <span id="device-label">No active device</span>
  <span id="status-line"></span>
</div>
<div id="entries-list"></div>
<button id="btn-add-entry" class="secondary">+ Add entry</button>
<div id="entry-form" class="hidden"></div>`;

  el<HTMLButtonElement>('btn-add-entry').addEventListener('click', () => {
    editingEntryId = undefined;
    renderEntryForm({ type: 'text' });
  });
}

function renderEntries(): void {
  const list = el<HTMLDivElement>('entries-list');
  if (!list) return;

  if (entries.length === 0) {
    list.innerHTML = '<div class="empty">No saved entries yet. Add reusable text or credentials to type them on the device with one click.</div>';
    return;
  }

  list.innerHTML = entries.map((entry) => {
    const title = entry.title || (entry.type === 'text' ? entry.text ?? '' : entry.login ?? '');
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
    <span class="card-title" title="${esc(title)}">${esc(title)}</span>
    <span class="badge">${entry.type === 'text' ? 'text' : 'credentials'}</span>
    <button class="icon-btn entry-edit" data-id="${entry.id}" title="Edit">✎</button>
    <button class="icon-btn entry-delete" data-id="${entry.id}" title="Delete">✕</button>
  </div>
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
<div class="action-row">
  <button id="btn-entry-save">Save</button>
  <button id="btn-entry-cancel" class="secondary">Cancel</button>
</div>`;

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

    if (selectedType === 'text') {
      const text = el<HTMLInputElement>('entry-text').value;
      if (text === '') { showStatus('Text is required.', true); return; }
      post({ kind: 'saveEntry', entry: { id: editingEntryId, type: 'text', title, text } });
    } else {
      const login = el<HTMLInputElement>('entry-login').value;
      const password = el<HTMLInputElement>('entry-password').value;
      if (login === '') { showStatus('Login is required.', true); return; }
      post({ kind: 'saveEntry', entry: { id: editingEntryId, type: 'credentials', title, login, password } });
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
<div id="scripts-list"></div>
<div id="run-progress" class="hidden"></div>`;

  el<HTMLButtonElement>('btn-new-script').addEventListener('click', () => post({ kind: 'newScript' }));
  el<HTMLButtonElement>('btn-import-script').addEventListener('click', () => post({ kind: 'importScript' }));
}

function renderScripts(): void {
  const list = el<HTMLDivElement>('scripts-list');
  if (!list) return;

  if (scripts.length === 0) {
    list.innerHTML = '<div class="empty">No saved scripts yet. Create automation scripts compatible with the Roku Remote Tool (RASP).</div>';
    return;
  }

  list.innerHTML = scripts.map((s) => `
<div class="card" data-id="${s.id}">
  <div class="card-head">
    <span class="card-title" title="${esc(s.title)}">${esc(s.title)}</span>
    <span class="badge">${s.format}</span>
  </div>
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

// ── abilities view ───────────────────────────────────────────────────────────

interface AbilityButton { action: AbilityAction; label: string; title: string; danger?: boolean }

const QUICK_ACTIONS: AbilityButton[] = [
  { action: 'deviceInfo', label: 'Device info', title: 'Open the full ECP device-info as a JSON document' },
  { action: 'activeApp', label: 'Active app', title: 'Show which channel is currently in the foreground' },
  { action: 'screenshot', label: 'Screenshot', title: 'Capture a screenshot of the running dev channel (requires developer password)' },
  { action: 'checkUpdate', label: 'Check update', title: 'Trigger a system update check (result shows on the device)' },
  { action: 'reboot', label: 'Reboot', title: 'Reboot the device', danger: true },
];

const WEB_ADMIN_ACTIONS: AbilityButton[] = [
  { action: 'installChannel', label: 'Install channel…', title: 'Sideload a channel zip (dev web-admin Installer)' },
  { action: 'deleteChannel', label: 'Delete channel', title: 'Remove the sideloaded dev channel', danger: true },
  { action: 'packageChannel', label: 'Package…', title: 'Install a zip and sign it into a .pkg (Packager)' },
  { action: 'rekey', label: 'Rekey…', title: 'Rekey the device with a signed .pkg' },
];

function buildAbilitiesDom(): void {
  const group = (title: string, buttons: AbilityButton[]): string => `
<h3>${title}</h3>
<div class="ability-group">
  ${buttons.map((b) => `
    <button class="ability-btn ${b.danger ? 'danger' : ''}" data-action="${b.action}" title="${esc(b.title)}">${esc(b.label)}</button>
  `).join('')}
</div>`;

  document.body.innerHTML = `
<div id="toolbar">
  <span class="status-dot" id="status-dot"></span>
  <span id="device-label">No active device</span>
  <span id="status-line"></span>
</div>
${group('Quick actions', QUICK_ACTIONS)}
${group('Web admin', WEB_ADMIN_ACTIONS)}`;

  for (const btn of document.querySelectorAll<HTMLButtonElement>('.ability-btn')) {
    btn.addEventListener('click', () => {
      post({ kind: 'ability', action: btn.dataset.action as AbilityAction });
    });
  }
}

function applyAbilitiesBusy(busy: boolean): void {
  for (const btn of document.querySelectorAll<HTMLButtonElement>('.ability-btn')) {
    btn.disabled = busy || device === undefined;
  }
}

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
      if (viewKind === 'remote') applyRemoteDevice();
      if (viewKind === 'scripts') renderScripts();
      if (viewKind === 'abilities') applyAbilitiesBusy(false);
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
      renderEntries();
      return;

    case 'entryResult':
      if (!msg.ok) showStatus(msg.message ?? 'Operation failed.', true);
      else if (msg.id !== undefined) showStatus('Sent.', false);
      return;

    case 'scripts':
      scripts = msg.scripts;
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
      if (viewKind === 'abilities') applyAbilitiesBusy(msg.on);
      return;
  }
});

// ── boot ─────────────────────────────────────────────────────────────────────

switch (viewKind) {
  case 'remote': buildRemoteDom(); break;
  case 'entries': buildEntriesDom(); break;
  case 'scripts': buildScriptsDom(); break;
  case 'abilities': buildAbilitiesDom(); break;
}
renderDeviceBanner();
post({ kind: 'ready' });
