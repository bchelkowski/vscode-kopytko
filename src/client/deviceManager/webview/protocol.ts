// Message protocol between the Device Manager sidebar views and the
// extension host. No imports — this file is bundled into the browser webview.

/** Active device summary pushed to every Device Manager view. */
export interface DeviceSummary {
  ip: string;
  name: string;
  isTV: boolean;
}

/** Saved text entry as exposed to the webview — passwords NEVER appear here. */
export interface TextEntryView {
  id: string;
  type: 'text' | 'credentials';
  title?: string;
  /** Present for type 'text'. */
  text?: string;
  /** Present for type 'credentials'. */
  login?: string;
  /** Present for type 'credentials': whether a password secret is stored. */
  hasPassword?: boolean;
  updatedAt: number;
}

/** Saved script list row. */
export interface ScriptListItem {
  id: string;
  title: string;
  format: 'rasp' | 'kopytko';
  updatedAt: number;
}

/** Per-step progress of a running script. */
export interface RunProgress {
  scriptId: string;
  index: number;
  total: number;
  label: string;
  status: 'running' | 'ok' | 'failed' | 'cancelled' | 'done';
  message?: string;
}

// ── extension → webview ─────────────────────────────────────────────────────

export type ExtMsg =
  | { kind: 'config'; holdThresholdMs: number }
  | { kind: 'device'; device?: DeviceSummary }
  | { kind: 'remoteMode'; on: boolean }
  | { kind: 'sendTextResult'; ok: boolean; message?: string }
  | { kind: 'entries'; entries: TextEntryView[] }
  | { kind: 'entryResult'; ok: boolean; id?: string; message?: string }
  | { kind: 'scripts'; scripts: ScriptListItem[] }
  | { kind: 'runProgress'; progress: RunProgress }
  | { kind: 'actionResult'; action: string; ok: boolean; message?: string }
  | { kind: 'busy'; on: boolean; label?: string };

// ── webview → extension ─────────────────────────────────────────────────────

/** Web-admin / quick actions triggered from the Device view. */
export type AbilityAction =
  | 'deviceInfo'
  | 'activeApp'
  | 'screenshot'
  | 'checkUpdate'
  | 'reboot'
  | 'installChannel'
  | 'deleteChannel'
  | 'packageChannel'
  | 'rekey';

export type WebMsg =
  | { kind: 'ready' }
  | { kind: 'keyPress'; key: string }
  | { kind: 'keyHoldStart'; key: string }
  | { kind: 'keyHoldEnd'; key: string }
  | { kind: 'sendText'; text: string }
  | { kind: 'toggleRemoteMode' }
  | {
      kind: 'saveEntry';
      entry: {
        id?: string;
        type: 'text' | 'credentials';
        title?: string;
        text?: string;
        login?: string;
        /** Only travels webview→host on save; empty string means "keep existing". */
        password?: string;
      };
    }
  | { kind: 'deleteEntry'; id: string }
  | { kind: 'sendEntryField'; id: string; field: 'text' | 'login' | 'password' }
  | { kind: 'newScript' }
  | { kind: 'importScript' }
  | { kind: 'runScript'; id: string }
  | { kind: 'cancelRun'; id: string }
  | { kind: 'editScript'; id: string }
  | { kind: 'deleteScript'; id: string }
  | { kind: 'exportScript'; id: string }
  | { kind: 'ability'; action: AbilityAction };
