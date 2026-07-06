// Message protocol between the Script Editor panel webview and the extension
// host. No vscode/Node imports — bundled into the browser webview. (The shared
// RASP types it references are themselves import-free.)

import type { RaspError } from '../rasp/raspTypes';

export interface EditorScript {
  /** Absent for a brand-new, never-saved script. */
  id?: string;
  title: string;
  /** `kopytko` is reserved for the future custom format — v1 ships RASP only. */
  format: 'rasp' | 'kopytko';
  source: string;
}

export interface EditorRunProgress {
  index: number;
  total: number;
  label: string;
  status: 'running' | 'ok' | 'failed' | 'cancelled' | 'done';
  message?: string;
}

// ── extension → webview ─────────────────────────────────────────────────────

export type ExtMsg =
  | { kind: 'load'; script: EditorScript }
  | { kind: 'saved'; id: string; title: string }
  | { kind: 'runProgress'; progress: EditorRunProgress }
  | { kind: 'device'; name?: string }
  /** A remote-control action to append as a script step (when recording is on). */
  | { kind: 'recordStep'; line: string };

// ── webview → extension ─────────────────────────────────────────────────────

export type WebMsg =
  | { kind: 'ready' }
  | { kind: 'save'; title: string; format: 'rasp' | 'kopytko'; source: string }
  | { kind: 'run'; title: string; format: 'rasp' | 'kopytko'; source: string }
  | { kind: 'cancelRun' }
  | { kind: 'export'; title: string; source: string }
  | { kind: 'dirty'; isDirty: boolean };

// Re-exported so the editor webview bundle gets the shared error shape from
// one place (raspTypes is import-free and safe for the browser bundle).
export type { RaspError };
