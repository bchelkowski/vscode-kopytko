/**
 * Message protocol between the Roku Pay Web Services panel (extension host)
 * and its webview. Import-free apart from the equally import-free endpoint
 * catalog — this file is bundled into the browser webview.
 *
 * SECURITY: the partner API key never appears in any of these messages —
 * profiles cross the bridge as {@link ProfileView} (a `hasApiKey` flag only)
 * and log entries are masked host-side before they are stored or posted.
 */
import type { PayEndpoint } from '../endpoints';

export type PayAccept = 'json' | 'xml';

/** A form field value as collected by the webview. */
export type PayFieldValue = string | number | boolean;

/**
 * One request/response log entry. `url`/`requestBody`/`error` are ALWAYS
 * masked (API key replaced with `****`) before an entry is constructed.
 */
export interface PayLogEntry {
  id: string;
  timestamp: number;
  endpointId: string;
  endpointLabel: string;
  profileName: string;
  method: 'GET' | 'POST';
  url: string;
  accept: PayAccept;
  requestBody?: string;
  /** Absent when the request failed before an HTTP response (see `error`). */
  status?: number;
  statusText?: string;
  responseHeaders?: Record<string, string>;
  responseBody?: string;
  durationMs: number;
  error?: string;
}

/** Credential profile as seen by the webview — the key itself never crosses. */
export interface ProfileView {
  id: string;
  name: string;
  partnerReferenceId: string;
  hasApiKey: boolean;
  updatedAt: number;
}

/** Small prefill/selection state remembered across panel restarts. */
export interface PayUiState {
  lastProfileId?: string;
  lastEndpointId?: string;
  lastTransactionId?: string;
}

// ── extension → webview ─────────────────────────────────────────────────────

export type ExtMsg =
  | { kind: 'init'; endpoints: PayEndpoint[]; profiles: ProfileView[]; uiState: PayUiState; logs: PayLogEntry[] }
  | { kind: 'profiles'; profiles: ProfileView[] }
  | { kind: 'sending' }
  | { kind: 'sendResult'; entry: PayLogEntry }
  | { kind: 'logs'; entries: PayLogEntry[] }
  | { kind: 'error'; message: string };

// ── webview → extension ─────────────────────────────────────────────────────

export type WebMsg =
  | { kind: 'ready' }
  | { kind: 'saveProfile'; id?: string; name: string; partnerAPIKey?: string; partnerReferenceId: string }
  | { kind: 'deleteProfile'; id: string }
  | { kind: 'send'; profileId: string; endpointId: string; accept: PayAccept; values: Record<string, PayFieldValue> }
  | { kind: 'deleteLog'; id: string }
  | { kind: 'clearLogs' }
  | { kind: 'uiState'; state: PayUiState };
