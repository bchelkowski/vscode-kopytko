import './styles.css';
import { parseRasp } from '../rasp/raspParser';
import type { EditorRunProgress, EditorScript, ExtMsg, WebMsg } from './protocol';

interface VsCodeApi { postMessage(msg: WebMsg): void; }
declare function acquireVsCodeApi(): VsCodeApi;
const vscode = acquireVsCodeApi();

// ── state ────────────────────────────────────────────────────────────────────

let script: EditorScript = { title: '', format: 'rasp', source: '' };
let savedSource = '';
let savedTitle = '';
let isDirty = false;
let isRunning = false;
let validateTimer: ReturnType<typeof setTimeout> | undefined;

// ── snippets ─────────────────────────────────────────────────────────────────

const SNIPPETS: { label: string; title: string; text: string }[] = [
  { label: 'press', title: 'Press a remote key', text: '- press: home\n' },
  { label: 'text', title: 'Type text on the device keyboard', text: '- text: search term\n' },
  { label: 'pause', title: 'Wait N seconds', text: '- pause: 2\n' },
  { label: 'launch', title: 'Launch a channel with deep-link params', text: '- launch:\n    channel_name: My Channel\n    content_id: 12345\n    media_type: movie\n    timeout: 35\n' },
  { label: 'wait', title: 'Wait for the media player state', text: '- wait_for_player_state: play\n' },
  { label: 'loop', title: 'Repeat steps N times', text: '- loop:\n    iterations: 2\n    steps:\n    - press: down\n' },
  { label: 'validate', title: 'Assert stream codecs/DRM during playback', text: '- validate_streaming:\n    audio_codec: aac\n    video_codec: hevc\n    drm: widevine\n' },
  { label: 'block', title: 'Reusable step block (define once, replay with the alias)', text: '- step: &my_block\n    - press: up\n    - press: right\n- *my_block\n' },
];

// ── DOM ──────────────────────────────────────────────────────────────────────

function buildDom(): void {
  document.body.innerHTML = `
<div id="toolbar">
  <input id="title-input" type="text" placeholder="Script title" spellcheck="false">
  <select id="format-select" title="Script format — the kopytko automation format is coming in a future release">
    <option value="rasp">RASP (Roku Remote Tool)</option>
    <option value="kopytko" disabled>kopytko (coming soon)</option>
  </select>
  <span id="device-label" class="muted"></span>
  <button id="btn-save" title="Save to the Device Manager script library">Save</button>
  <button id="btn-run" title="Run on the active device">Run</button>
  <button id="btn-cancel" class="hidden" title="Cancel the running script">Cancel</button>
  <button id="btn-export" class="secondary" title="Export as a .rasp file compatible with the Roku Remote Tool">Export</button>
</div>
<div id="snippet-bar">
  ${SNIPPETS.map((s, i) => `<button class="snippet secondary" data-i="${i}" title="${esc(s.title)}">${esc(s.label)}</button>`).join('')}
</div>
<div id="editor-wrap">
  <textarea id="source" spellcheck="false" wrap="off" placeholder="params:\n    rasp_version: 1\nsteps:\n    - press: home"></textarea>
</div>
<div id="validation" class="ok">No errors.</div>
<div id="run-progress" class="hidden"></div>`;

  const source = el<HTMLTextAreaElement>('source');
  const title = el<HTMLInputElement>('title-input');

  source.addEventListener('input', () => {
    script.source = source.value;
    scheduleValidate();
    updateDirty();
  });
  title.addEventListener('input', () => {
    script.title = title.value;
    updateDirty();
  });

  // Tab inserts indentation instead of leaving the textarea.
  source.addEventListener('keydown', (ev) => {
    if (ev.key === 'Tab') {
      ev.preventDefault();
      const start = source.selectionStart;
      source.setRangeText('    ', start, source.selectionEnd, 'end');
      script.source = source.value;
      scheduleValidate();
      updateDirty();
    }
  });

  el<HTMLButtonElement>('btn-save').addEventListener('click', () => {
    post({ kind: 'save', title: script.title, format: script.format, source: script.source });
  });
  el<HTMLButtonElement>('btn-run').addEventListener('click', () => {
    post({ kind: 'run', title: script.title, format: script.format, source: script.source });
  });
  el<HTMLButtonElement>('btn-cancel').addEventListener('click', () => post({ kind: 'cancelRun' }));
  el<HTMLButtonElement>('btn-export').addEventListener('click', () => {
    post({ kind: 'export', title: script.title, source: script.source });
  });

  for (const btn of document.querySelectorAll<HTMLButtonElement>('.snippet')) {
    btn.addEventListener('click', () => {
      const snippet = SNIPPETS[Number(btn.dataset.i)];
      insertSnippet(snippet.text);
    });
  }
}

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

/** Inserts a step snippet on a fresh line at the caret, matching indentation. */
function insertSnippet(text: string): void {
  const source = el<HTMLTextAreaElement>('source');
  const value = source.value;
  let pos = source.selectionStart;

  // Move to the start of the next line so the snippet lands on its own line.
  const lineEnd = value.indexOf('\n', pos);
  pos = lineEnd === -1 ? value.length : lineEnd + 1;

  // Indent to match the `steps:` list (4 spaces, like the template).
  const indented = text.split('\n').map((line) => (line === '' ? '' : `    ${line}`)).join('\n');
  const insert = (pos > 0 && value[pos - 1] !== '\n' ? '\n' : '') + indented;

  source.setRangeText(insert, pos, pos, 'end');
  source.focus();
  script.source = source.value;
  scheduleValidate();
  updateDirty();
}

// ── validation ───────────────────────────────────────────────────────────────

function scheduleValidate(): void {
  if (validateTimer) clearTimeout(validateTimer);
  validateTimer = setTimeout(validate, 300);
}

function validate(): void {
  const box = el<HTMLDivElement>('validation');
  if (script.format !== 'rasp') {
    box.className = 'ok';
    box.textContent = 'Validation is only available for RASP scripts.';
    return;
  }

  const { script: parsed, errors } = parseRasp(script.source);
  if (parsed) {
    const stepCount = parsed.steps.length;
    box.className = 'ok';
    box.textContent = `✓ Valid RASP script — ${stepCount} top-level step${stepCount === 1 ? '' : 's'}.`;
  } else {
    box.className = 'error';
    box.innerHTML = errors.slice(0, 5).map((e) => {
      const where = e.line !== undefined ? `line ${e.line}` : e.path ?? '';
      return `<div>✕ ${where ? `<b>${esc(where)}</b>: ` : ''}${esc(e.message)}</div>`;
    }).join('');
  }
}

// ── dirty tracking ───────────────────────────────────────────────────────────

function updateDirty(): void {
  const dirty = script.source !== savedSource || script.title !== savedTitle;
  if (dirty !== isDirty) {
    isDirty = dirty;
    post({ kind: 'dirty', isDirty });
  }
}

// ── run progress ─────────────────────────────────────────────────────────────

function renderRunProgress(progress: EditorRunProgress): void {
  const box = el<HTMLDivElement>('run-progress');
  const run = el<HTMLButtonElement>('btn-run');
  const cancel = el<HTMLButtonElement>('btn-cancel');

  if (progress.status === 'running') {
    isRunning = true;
    box.classList.remove('hidden', 'error');
    box.textContent = `▶ ${progress.index + 1}/${progress.total} — ${progress.label}`;
  } else if (progress.status === 'failed') {
    isRunning = false;
    box.classList.remove('hidden');
    box.classList.add('error');
    box.textContent = `✕ Failed${progress.label ? ` at ${progress.label}` : ''}${progress.message ? `: ${progress.message}` : ''}`;
  } else if (progress.status === 'cancelled') {
    isRunning = false;
    box.classList.remove('hidden', 'error');
    box.textContent = '■ Cancelled';
  } else if (progress.status === 'done') {
    isRunning = false;
    box.classList.remove('hidden', 'error');
    box.textContent = '✓ Finished';
  }

  run.classList.toggle('hidden', isRunning);
  cancel.classList.toggle('hidden', !isRunning);
}

// ── messages ─────────────────────────────────────────────────────────────────

window.addEventListener('message', (event: MessageEvent<ExtMsg>) => {
  const msg = event.data;
  switch (msg.kind) {
    case 'load':
      script = msg.script;
      savedSource = msg.script.id !== undefined ? msg.script.source : '';
      savedTitle = msg.script.id !== undefined ? msg.script.title : '';
      el<HTMLInputElement>('title-input').value = script.title;
      el<HTMLSelectElement>('format-select').value = script.format;
      el<HTMLTextAreaElement>('source').value = script.source;
      validate();
      updateDirty();
      return;

    case 'saved':
      savedSource = script.source;
      savedTitle = msg.title;
      updateDirty();
      return;

    case 'runProgress':
      renderRunProgress(msg.progress);
      return;

    case 'device':
      el<HTMLSpanElement>('device-label').textContent = msg.name ? `→ ${msg.name}` : 'no active device';
      return;
  }
});

// ── boot ─────────────────────────────────────────────────────────────────────

buildDom();
post({ kind: 'ready' });
