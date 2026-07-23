import './styles.css';
import type { PayEndpoint, PayField } from '../endpoints';
import type { ExtMsg, PayAccept, PayFieldValue, PayLogEntry, ProfileView, WebMsg } from './protocol';

interface VsCodeApi { postMessage(msg: WebMsg): void; }
declare function acquireVsCodeApi(): VsCodeApi;
const vscode = acquireVsCodeApi();

// ── state ────────────────────────────────────────────────────────────────────

let endpoints: PayEndpoint[] = [];
let profiles: ProfileView[] = [];
let logs: PayLogEntry[] = [];
let selectedProfileId = '';
let selectedEndpointId = '';
let sending = false;
let editingProfileId: string | undefined;
let shownEntryId: string | undefined;
let confirmClearTimer: ReturnType<typeof setTimeout> | undefined;

/** Field values persist across endpoint switches (same-named fields carry over). */
const fieldValues = new Map<string, string | boolean>();

// ── DOM scaffold ─────────────────────────────────────────────────────────────

function buildDom(): void {
  document.body.innerHTML = `
<div id="error-banner" class="hidden"></div>
<div id="content">
  <div id="request-pane">
    <div class="section">
      <h3>Credential Profile</h3>
      <div id="profile-row">
        <select id="profile-select"></select>
        <button id="btn-profile-add" class="secondary" title="Create a new credential profile">Add</button>
        <button id="btn-profile-edit" class="secondary" title="Edit the selected profile">Edit</button>
        <button id="btn-profile-delete" class="secondary" title="Delete the selected profile (and its API key)">✕</button>
      </div>
      <div id="profile-status" class="muted"></div>
      <div id="profile-form" class="hidden">
        <label class="field-label" for="profile-name">Name</label>
        <input id="profile-name" type="text" placeholder="e.g. Production" spellcheck="false">
        <label class="field-label" for="profile-key">Partner API Key</label>
        <input id="profile-key" type="password" spellcheck="false" autocomplete="off">
        <div class="field-help muted">Stored in the OS keychain — never in settings or logs.</div>
        <label class="field-label" for="profile-ref">Partner Reference ID</label>
        <input id="profile-ref" type="text" spellcheck="false">
        <div id="profile-form-actions">
          <button id="btn-profile-save">Save profile</button>
          <button id="btn-profile-cancel" class="secondary">Cancel</button>
        </div>
      </div>
    </div>
    <div class="section">
      <h3>Request</h3>
      <select id="endpoint-select"></select>
      <div id="endpoint-desc" class="muted"></div>
      <div id="rate-note" class="muted"></div>
      <div id="url-preview"></div>
      <div id="field-rows"></div>
      <div id="send-row">
        <select id="accept-select" title="Response format requested via the Accept header">
          <option value="json">Accept: JSON</option>
          <option value="xml">Accept: XML</option>
        </select>
        <button id="btn-send">Send</button>
      </div>
    </div>
  </div>
  <div id="result-pane">
    <div class="section" id="response-section">
      <h3>Response</h3>
      <div id="response-box"><div class="empty">Send a request to see the response here.</div></div>
    </div>
    <div class="section" id="history-section">
      <div id="history-header">
        <h3>History</h3>
        <button id="btn-clear-logs" class="secondary" title="Delete all saved request/response entries">Clear all</button>
      </div>
      <div id="history-list"></div>
    </div>
  </div>
</div>`;
}

function esc(text: string): string {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function el<T extends HTMLElement>(id: string): T {
  return document.getElementById(id) as T;
}

function selectedProfile(): ProfileView | undefined {
  return profiles.find((p) => p.id === selectedProfileId);
}

function selectedEndpoint(): PayEndpoint | undefined {
  return endpoints.find((e) => e.id === selectedEndpointId);
}

function showError(message: string | undefined): void {
  const banner = el<HTMLDivElement>('error-banner');
  banner.classList.toggle('hidden', !message);
  banner.textContent = message ?? '';
}

function postUiState(): void {
  const transactionId = fieldValues.get('transactionId');
  vscode.postMessage({
    kind: 'uiState',
    state: {
      lastProfileId: selectedProfileId || undefined,
      lastEndpointId: selectedEndpointId || undefined,
      lastTransactionId: typeof transactionId === 'string' && transactionId !== '' ? transactionId : undefined,
    },
  });
}

// ── profiles ─────────────────────────────────────────────────────────────────

function renderProfiles(): void {
  const select = el<HTMLSelectElement>('profile-select');
  if (profiles.length === 0) {
    select.innerHTML = '<option value="">(no profiles yet)</option>';
    selectedProfileId = '';
  } else {
    if (!profiles.some((p) => p.id === selectedProfileId)) {
      selectedProfileId = profiles[0].id;
    }
    select.innerHTML = profiles.map((p) =>
      `<option value="${esc(p.id)}" ${p.id === selectedProfileId ? 'selected' : ''}>${esc(p.name)}</option>`).join('');
  }

  el<HTMLButtonElement>('btn-profile-edit').disabled = !selectedProfileId;
  el<HTMLButtonElement>('btn-profile-delete').disabled = !selectedProfileId;

  const status = el<HTMLDivElement>('profile-status');
  const profile = selectedProfile();
  if (!profile) {
    status.innerHTML = 'Add a profile with your Partner API Key to get started.';
  } else if (profile.hasApiKey) {
    status.innerHTML = `<span class="ok-text">✓ API key saved</span>${profile.partnerReferenceId ? ` · ref: ${esc(profile.partnerReferenceId)}` : ''}`;
  } else {
    status.innerHTML = '<span class="warn">⚠ No API key saved — edit the profile and add one.</span>';
  }

  syncSendButton();
}

function openProfileForm(profile: ProfileView | undefined): void {
  editingProfileId = profile?.id;
  el<HTMLInputElement>('profile-name').value = profile?.name ?? '';
  const keyInput = el<HTMLInputElement>('profile-key');
  keyInput.value = '';
  keyInput.placeholder = profile?.hasApiKey ? '(saved — leave blank to keep)' : '(not set)';
  el<HTMLInputElement>('profile-ref').value = profile?.partnerReferenceId ?? '';
  el<HTMLDivElement>('profile-form').classList.remove('hidden');
  el<HTMLInputElement>('profile-name').focus();
}

function closeProfileForm(): void {
  editingProfileId = undefined;
  el<HTMLDivElement>('profile-form').classList.add('hidden');
}

// ── request form ─────────────────────────────────────────────────────────────

function renderEndpointSelect(): void {
  const groups: Array<{ label: string; category: PayEndpoint['category'] }> = [
    { label: 'Web Services', category: 'web-services' },
    { label: 'Subscription Recovery (test)', category: 'recovery-test' },
  ];
  el<HTMLSelectElement>('endpoint-select').innerHTML = groups.map((group) => {
    const options = endpoints.filter((e) => e.category === group.category).map((e) =>
      `<option value="${esc(e.id)}" ${e.id === selectedEndpointId ? 'selected' : ''}>${esc(e.label)}</option>`).join('');
    return `<optgroup label="${esc(group.label)}">${options}</optgroup>`;
  }).join('');
}

function fieldInputHtml(field: PayField): string {
  const id = `field-${field.name}`;
  const value = fieldValues.get(field.name);
  switch (field.type) {
    case 'boolean':
      return `<label class="check-row"><input id="${id}" data-field="${esc(field.name)}" type="checkbox" ${value === true ? 'checked' : ''}> ${esc(field.label)}</label>`;
    case 'number':
      return `<input id="${id}" data-field="${esc(field.name)}" type="number" step="any" value="${esc(String(value ?? ''))}" spellcheck="false">`;
    case 'date':
      return `<input id="${id}" data-field="${esc(field.name)}" type="date" value="${esc(String(value ?? ''))}">`;
    default:
      return `<input id="${id}" data-field="${esc(field.name)}" type="text" value="${esc(String(value ?? ''))}" spellcheck="false">`;
  }
}

function renderRequestForm(): void {
  const endpoint = selectedEndpoint();
  if (!endpoint) return;

  el<HTMLDivElement>('endpoint-desc').textContent = endpoint.description;
  const rateNote = el<HTMLDivElement>('rate-note');
  rateNote.textContent = endpoint.rateLimitNote;
  rateNote.className = endpoint.category === 'recovery-test' ? 'warn' : 'muted';

  const profile = selectedProfile();
  const rows = endpoint.fields.map((field) => {
    if (field.secret) {
      const state = profile?.hasApiKey
        ? '<span class="ok-text">✓ from profile</span>'
        : '<span class="warn">⚠ selected profile has no key</span>';
      return `<div class="field"><div class="field-label">${esc(field.label)}</div><div class="secret-indicator">${state}</div></div>`;
    }
    const required = field.required ? ' <span class="required">*</span>' : '';
    const label = field.type === 'boolean'
      ? ''
      : `<label class="field-label" for="field-${esc(field.name)}">${esc(field.label)}${required}</label>`;
    const help = field.help ? `<div class="field-help muted">${esc(field.help)}</div>` : '';
    return `<div class="field">${label}${fieldInputHtml(field)}${help}</div>`;
  }).join('');
  el<HTMLDivElement>('field-rows').innerHTML = rows;

  for (const input of document.querySelectorAll<HTMLInputElement>('#field-rows [data-field]')) {
    input.addEventListener('input', () => {
      fieldValues.set(input.dataset.field!, input.type === 'checkbox' ? input.checked : input.value);
      renderUrlPreview();
      if (input.dataset.field === 'transactionId') postUiState();
    });
  }

  renderUrlPreview();
  syncSendButton();
}

function renderUrlPreview(): void {
  const endpoint = selectedEndpoint();
  if (!endpoint) return;
  const url = endpoint.urlTemplate.replace(/\{([^}]+)\}/g, (_match, name: string) => {
    if (name === 'partnerAPIKey') return '****';
    const value = fieldValues.get(name);
    return typeof value === 'string' && value !== '' ? encodeURIComponent(value) : `{${name}}`;
  });
  el<HTMLDivElement>('url-preview').innerHTML =
    `<span class="method-badge ${endpoint.method === 'GET' ? 'get' : 'post'}">${endpoint.method}</span><span class="url-text">${esc(url)}</span>`;
}

function syncSendButton(): void {
  const button = el<HTMLButtonElement>('btn-send');
  button.disabled = sending || !selectedProfile()?.hasApiKey;
  button.textContent = sending ? 'Sending…' : 'Send';
}

function sendRequest(): void {
  const endpoint = selectedEndpoint();
  const profile = selectedProfile();
  if (!endpoint || !profile || sending) return;

  showError(undefined);
  const values: Record<string, PayFieldValue> = {};
  for (const field of endpoint.fields) {
    if (field.secret) continue;
    const value = fieldValues.get(field.name);
    if (value !== undefined) values[field.name] = value;
  }
  vscode.postMessage({
    kind: 'send',
    profileId: profile.id,
    endpointId: endpoint.id,
    accept: el<HTMLSelectElement>('accept-select').value as PayAccept,
    values,
  });
}

// ── response viewer ──────────────────────────────────────────────────────────

// Roku Pay's backend serializes dates ASP.NET-AJAX style — "/Date(ms[+offset])/" —
// even inside XML. Humanize these tokens for display only; the stored raw body is untouched.
function humanizeDotNetDates(text: string): string {
  return text.replace(/\/Date\((-?\d+)(?:[+-]\d{4})?\)\//g, (match, msStr) => {
    const ms = Number(msStr);
    if (!Number.isFinite(ms)) return match;
    return new Date(ms).toISOString().slice(0, 19);
  });
}

function prettyBody(entry: PayLogEntry): string {
  const body = entry.responseBody ?? '';
  let text = body;
  if (entry.accept === 'json') {
    try {
      text = JSON.stringify(JSON.parse(body), null, 2);
    } catch {
      // Fall through to the raw body (error pages, XML despite Accept, …).
    }
  }
  return humanizeDotNetDates(text);
}

function renderResponse(entry: PayLogEntry | undefined): void {
  shownEntryId = entry?.id;
  const box = el<HTMLDivElement>('response-box');
  if (!entry) {
    box.innerHTML = '<div class="empty">Send a request to see the response here.</div>';
    renderHistory();
    return;
  }

  const ok = entry.error === undefined && entry.status !== undefined && entry.status < 400;
  const statusLine = entry.error !== undefined
    ? `<span class="status-badge err">Network error</span>`
    : `<span class="status-badge ${ok ? 'ok' : 'err'}">${entry.status} ${esc(entry.statusText ?? '')}</span>`;

  const headerRows = Object.entries(entry.responseHeaders ?? {}).map(([key, value]) =>
    `<tr><td>${esc(key)}</td><td>${esc(value)}</td></tr>`).join('');

  box.innerHTML = `
    <div class="response-status">
      ${statusLine}
      <span class="muted">${entry.durationMs} ms · ${esc(new Date(entry.timestamp).toLocaleString())}</span>
    </div>
    <div class="response-meta">
      <span class="method-badge ${entry.method === 'GET' ? 'get' : 'post'}">${entry.method}</span>
      <span class="url-text">${esc(entry.url)}</span>
    </div>
    <div class="response-meta muted">${esc(entry.endpointLabel)} · profile: ${esc(entry.profileName)}</div>
    ${entry.error !== undefined ? `<div class="response-error">${esc(entry.error)}</div>` : ''}
    ${entry.requestBody !== undefined ? `
      <details class="response-details">
        <summary>Request body</summary>
        <pre>${esc(prettyRequestBody(entry.requestBody))}</pre>
      </details>` : ''}
    ${headerRows !== '' ? `
      <details class="response-details">
        <summary>Response headers</summary>
        <table class="headers-table">${headerRows}</table>
      </details>` : ''}
    ${entry.responseBody !== undefined ? `<pre class="response-body">${esc(prettyBody(entry))}</pre>` : ''}`;

  renderHistory();
}

function prettyRequestBody(body: string): string {
  try {
    return JSON.stringify(JSON.parse(body), null, 2);
  } catch {
    return body;
  }
}

// ── history ──────────────────────────────────────────────────────────────────

function renderHistory(): void {
  const list = el<HTMLDivElement>('history-list');
  el<HTMLButtonElement>('btn-clear-logs').disabled = logs.length === 0;

  if (logs.length === 0) {
    list.innerHTML = '<div class="empty">No requests yet — the last 200 are kept here.</div>';
    return;
  }

  list.innerHTML = logs.map((entry) => {
    const ok = entry.error === undefined && entry.status !== undefined && entry.status < 400;
    const status = entry.error !== undefined ? 'ERR' : String(entry.status ?? '?');
    return `
    <div class="history-row${entry.id === shownEntryId ? ' selected' : ''}" data-id="${esc(entry.id)}">
      <span class="method-badge ${entry.method === 'GET' ? 'get' : 'post'}">${entry.method}</span>
      <div class="history-info">
        <span class="history-title">${esc(entry.endpointLabel)}</span>
        <span class="history-meta muted">${esc(new Date(entry.timestamp).toLocaleString())} · ${esc(entry.profileName)} · ${entry.durationMs} ms</span>
      </div>
      <span class="status-badge ${ok ? 'ok' : 'err'}">${esc(status)}</span>
      <button class="history-delete secondary" title="Delete this entry">✕</button>
    </div>`;
  }).join('');
}

// ── events ───────────────────────────────────────────────────────────────────

function wireEvents(): void {
  el<HTMLSelectElement>('profile-select').addEventListener('change', (ev) => {
    selectedProfileId = (ev.target as HTMLSelectElement).value;
    const profile = selectedProfile();
    if (profile) fieldValues.set('partnerReferenceId', profile.partnerReferenceId);
    renderProfiles();
    renderRequestForm();
    postUiState();
  });

  el('btn-profile-add').addEventListener('click', () => openProfileForm(undefined));
  el('btn-profile-edit').addEventListener('click', () => {
    const profile = selectedProfile();
    if (profile) openProfileForm(profile);
  });
  el('btn-profile-delete').addEventListener('click', () => {
    if (selectedProfileId) vscode.postMessage({ kind: 'deleteProfile', id: selectedProfileId });
  });

  el('btn-profile-save').addEventListener('click', () => {
    const name = el<HTMLInputElement>('profile-name').value.trim();
    if (!name) {
      showError('Give the profile a name first.');
      el('profile-name').focus();
      return;
    }
    showError(undefined);
    const key = el<HTMLInputElement>('profile-key').value;
    vscode.postMessage({
      kind: 'saveProfile',
      id: editingProfileId,
      name,
      partnerAPIKey: key === '' ? undefined : key,
      partnerReferenceId: el<HTMLInputElement>('profile-ref').value.trim(),
    });
    closeProfileForm();
  });
  el('btn-profile-cancel').addEventListener('click', () => closeProfileForm());

  el<HTMLSelectElement>('endpoint-select').addEventListener('change', (ev) => {
    selectedEndpointId = (ev.target as HTMLSelectElement).value;
    renderRequestForm();
    postUiState();
  });

  el('btn-send').addEventListener('click', () => sendRequest());

  el('history-list').addEventListener('click', (ev) => {
    const target = ev.target as HTMLElement;
    const row = target.closest<HTMLElement>('.history-row');
    if (!row) return;
    const entry = logs.find((e) => e.id === row.dataset.id);
    if (!entry) return;

    if (target.closest('.history-delete')) {
      vscode.postMessage({ kind: 'deleteLog', id: entry.id });
      if (shownEntryId === entry.id) renderResponse(undefined);
      return;
    }
    renderResponse(entry);
  });

  // Two-step confirm: first click arms, second click within 3s clears.
  el<HTMLButtonElement>('btn-clear-logs').addEventListener('click', () => {
    const button = el<HTMLButtonElement>('btn-clear-logs');
    if (button.dataset.armed === 'true') {
      if (confirmClearTimer) clearTimeout(confirmClearTimer);
      button.dataset.armed = 'false';
      button.textContent = 'Clear all';
      vscode.postMessage({ kind: 'clearLogs' });
      renderResponse(undefined);
    } else {
      button.dataset.armed = 'true';
      button.textContent = 'Confirm clear?';
      confirmClearTimer = setTimeout(() => {
        button.dataset.armed = 'false';
        button.textContent = 'Clear all';
      }, 3000);
    }
  });
}

// ── extension messages ───────────────────────────────────────────────────────

window.addEventListener('message', (event: MessageEvent<ExtMsg>) => {
  const msg = event.data;
  switch (msg.kind) {
    case 'init': {
      endpoints = msg.endpoints;
      profiles = msg.profiles;
      logs = msg.logs;

      selectedProfileId = msg.uiState.lastProfileId && profiles.some((p) => p.id === msg.uiState.lastProfileId)
        ? msg.uiState.lastProfileId
        : (profiles[0]?.id ?? '');
      selectedEndpointId = msg.uiState.lastEndpointId && endpoints.some((e) => e.id === msg.uiState.lastEndpointId)
        ? msg.uiState.lastEndpointId
        : (endpoints[0]?.id ?? '');
      if (msg.uiState.lastTransactionId) fieldValues.set('transactionId', msg.uiState.lastTransactionId);
      const profile = selectedProfile();
      if (profile) fieldValues.set('partnerReferenceId', profile.partnerReferenceId);

      renderProfiles();
      renderEndpointSelect();
      renderRequestForm();
      renderHistory();
      if (profiles.length === 0) openProfileForm(undefined);
      break;
    }

    case 'profiles': {
      const hadNone = profiles.length === 0;
      profiles = msg.profiles;
      renderProfiles();
      if (hadNone && profiles.length > 0) {
        const profile = selectedProfile();
        if (profile) fieldValues.set('partnerReferenceId', profile.partnerReferenceId);
      }
      renderRequestForm();
      break;
    }

    case 'sending':
      sending = true;
      syncSendButton();
      break;

    case 'sendResult':
      sending = false;
      syncSendButton();
      renderResponse(msg.entry);
      break;

    case 'logs':
      logs = msg.entries;
      renderHistory();
      break;

    case 'error':
      sending = false;
      syncSendButton();
      showError(msg.message);
      break;
  }
});

// ── init ─────────────────────────────────────────────────────────────────────

buildDom();
wireEvents();
vscode.postMessage({ kind: 'ready' });
