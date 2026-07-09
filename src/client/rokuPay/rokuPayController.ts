import type * as vscode from 'vscode';
import { getEndpoint, type PayEndpoint, type PayField } from './endpoints';
import type { PayHttpResponse, RokuPayClient } from './rokuPayClient';
import type { RokuPayLogStore } from './rokuPayLogStore';
import type { RokuPayProfileInput, RokuPayProfileStore } from './rokuPayProfileStore';
import type { PayAccept, PayFieldValue, PayLogEntry, PayUiState, ProfileView } from './webview/protocol';

/**
 * Replaces every occurrence of the partner API key (raw AND URL-encoded)
 * with `****`. Applied to URLs, request bodies, and error messages before
 * anything is logged or posted to the webview.
 */
export function maskSecret(text: string, secret: string): string {
  if (!secret) return text;
  let masked = text.split(secret).join('****');
  const encoded = encodeURIComponent(secret);
  if (encoded !== secret) {
    masked = masked.split(encoded).join('****');
  }
  return masked;
}

export interface RokuPayControllerDeps {
  profiles: RokuPayProfileStore;
  log: RokuPayLogStore;
  client: RokuPayClient;
}

/**
 * Orchestrates Roku Pay requests: resolves the profile's API key (the raw
 * key exists only here and in SecretStorage), validates and coerces form
 * values, builds the URL/body, executes on the extension host, and persists
 * a MASKED log entry. Validation problems throw before any request is made;
 * network failures are logged as error entries.
 */
export class RokuPayController {
  constructor(private readonly deps: RokuPayControllerDeps) {}

  // ── profiles ──────────────────────────────────────────────────────────────

  get onProfilesChanged(): vscode.Event<void> { return this.deps.profiles.onDidChange; }

  getProfiles(): ProfileView[] { return this.deps.profiles.getViews(); }

  async saveProfile(input: RokuPayProfileInput): Promise<void> {
    if (!input.name.trim()) throw new Error('Profile name is required.');
    await this.deps.profiles.save({ ...input, name: input.name.trim() });
  }

  async deleteProfile(id: string): Promise<void> {
    await this.deps.profiles.delete(id);
  }

  // ── logs / ui state ───────────────────────────────────────────────────────

  get onLogsChanged(): vscode.Event<void> { return this.deps.log.onDidChange; }

  getLogs(): PayLogEntry[] { return this.deps.log.getAll(); }
  async deleteLog(id: string): Promise<void> { await this.deps.log.delete(id); }
  async clearLogs(): Promise<void> { await this.deps.log.clear(); }

  getUiState(): PayUiState { return this.deps.log.getUiState(); }
  async setUiState(state: PayUiState): Promise<void> { await this.deps.log.setUiState(state); }

  // ── send ──────────────────────────────────────────────────────────────────

  async send(
    profileId: string,
    endpointId: string,
    values: Record<string, PayFieldValue>,
    accept: PayAccept,
  ): Promise<PayLogEntry> {
    const endpoint = getEndpoint(endpointId);
    if (!endpoint) throw new Error(`Unknown endpoint: ${endpointId}`);

    const profile = this.deps.profiles.get(profileId);
    if (!profile) throw new Error('Select a credential profile first.');
    const apiKey = await this.deps.profiles.getApiKey(profileId);
    if (!apiKey) {
      throw new Error(`Profile "${profile.name}" has no Partner API Key saved — edit the profile and add one.`);
    }

    const coerced = coerceValues(endpoint, values);
    const url = buildUrl(endpoint, coerced, apiKey);
    const requestBody = buildBody(endpoint, coerced, apiKey);

    const headers: Record<string, string> = {
      accept: accept === 'xml' ? 'application/xml' : 'application/json',
    };
    if (requestBody !== undefined) headers['content-type'] = 'application/json';

    await this.rememberUiState(profileId, endpointId, values);

    const startedAt = Date.now();
    let response: PayHttpResponse | undefined;
    let error: string | undefined;
    try {
      response = await this.deps.client.execute({ method: endpoint.method, url, headers, body: requestBody });
    } catch (err) {
      // fetch failures can embed the request URL (and thus the key) — mask it.
      error = maskSecret(err instanceof Error ? err.message : String(err), apiKey);
    }

    return this.deps.log.add({
      timestamp: startedAt,
      endpointId: endpoint.id,
      endpointLabel: endpoint.label,
      profileName: profile.name,
      method: endpoint.method,
      url: maskSecret(url, apiKey),
      accept,
      requestBody: requestBody === undefined ? undefined : maskSecret(requestBody, apiKey),
      status: response?.status,
      statusText: response?.statusText,
      responseHeaders: response?.headers,
      responseBody: response === undefined ? undefined : maskSecret(response.body, apiKey),
      durationMs: response?.durationMs ?? Date.now() - startedAt,
      error,
    });
  }

  private async rememberUiState(
    profileId: string,
    endpointId: string,
    values: Record<string, PayFieldValue>,
  ): Promise<void> {
    const previous = this.deps.log.getUiState();
    const transactionId = values.transactionId;
    await this.deps.log.setUiState({
      lastProfileId: profileId,
      lastEndpointId: endpointId,
      lastTransactionId: typeof transactionId === 'string' && transactionId !== ''
        ? transactionId
        : previous.lastTransactionId,
    });
  }
}

// ── helpers ──────────────────────────────────────────────────────────────────

/**
 * Validates required fields and coerces raw form values by field type.
 * Empty optional values come back as `undefined` (omitted downstream);
 * unchecked optional booleans are omitted too — absent means the API default.
 */
function coerceValues(
  endpoint: PayEndpoint,
  values: Record<string, PayFieldValue>,
): Record<string, PayFieldValue | undefined> {
  const coerced: Record<string, PayFieldValue | undefined> = {};
  for (const field of endpoint.fields) {
    if (field.secret) continue;
    coerced[field.name] = coerceField(field, values[field.name]);
  }
  return coerced;
}

function coerceField(field: PayField, raw: PayFieldValue | undefined): PayFieldValue | undefined {
  if (raw === undefined || raw === '') {
    if (field.required) throw new Error(`${field.label} is required.`);
    return undefined;
  }
  switch (field.type) {
    case 'number': {
      const value = Number(raw);
      if (Number.isNaN(value)) throw new Error(`${field.label} must be a number.`);
      return value;
    }
    case 'boolean': {
      const value = raw === true || raw === 'true';
      return value ? true : undefined;
    }
    default:
      return String(raw);
  }
}

function buildUrl(
  endpoint: PayEndpoint,
  coerced: Record<string, PayFieldValue | undefined>,
  apiKey: string,
): string {
  return endpoint.urlTemplate.replace(/\{([^}]+)\}/g, (_match, name: string) => {
    const value = name === 'partnerAPIKey' ? apiKey : coerced[name];
    return encodeURIComponent(String(value ?? ''));
  });
}

/** JSON body for POST web-services endpoints; `undefined` when the endpoint has no body fields. */
function buildBody(
  endpoint: PayEndpoint,
  coerced: Record<string, PayFieldValue | undefined>,
  apiKey: string,
): string | undefined {
  const bodyFields = endpoint.fields.filter((field) => field.in === 'body');
  if (bodyFields.length === 0) return undefined;

  const body: Record<string, PayFieldValue> = {};
  for (const field of bodyFields) {
    if (field.secret) {
      body[field.name] = apiKey;
      continue;
    }
    const value = coerced[field.name];
    if (value !== undefined) body[field.name] = value;
  }
  return JSON.stringify(body);
}
