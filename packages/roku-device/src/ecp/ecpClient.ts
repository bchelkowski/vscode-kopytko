import { RokuApp } from '../types';
import { buildDigestAuthHeader, httpGet, httpGetBuffer, httpPost, parseDigestChallenge } from '../net/httpClient';

export interface RendezvousEvent {
  id: string;
  startTimeMs: number;
  endTimeMs: number;
  line: number;
  file: string;
}

/**
 * Parses rendezvous event items and drop count from a GET /query/sgrendezvous XML response.
 *
 * Actual device response structure:
 * <sgrendezvous><data>
 *   <drop-count>0</drop-count>
 *   <item><id>1</id><start-tm>…</start-tm><end-tm>…</end-tm><line-number>…</line-number><file>…</file></item>
 * </data></sgrendezvous>
 */
function parseRendezvousXml(xml: string): { events: RendezvousEvent[]; dropCount: number } {
  const events: RendezvousEvent[] = [];

  const blockPattern = /<item\b[^>]*>([\s\S]*?)<\/item>/gi;
  let blockMatch: RegExpExecArray | null;

  while ((blockMatch = blockPattern.exec(xml)) !== null) {
    const tags = extractXmlTagsLocal(blockMatch[1]);

    const id = tags['id'] ?? '';
    const startRaw = tags['start-tm'] ?? '';
    const endRaw = tags['end-tm'] ?? '';
    const lineRaw = tags['line-number'] ?? '';
    const file = tags['file'] ?? '';

    if (!file || !lineRaw) continue;

    const startTimeMs = parseInt(startRaw, 10);
    const endTimeMs = parseInt(endRaw, 10);
    const line = parseInt(lineRaw, 10);

    if (isNaN(line)) continue;

    events.push({
      id,
      startTimeMs: isNaN(startTimeMs) ? 0 : startTimeMs,
      endTimeMs: isNaN(endTimeMs) ? 0 : endTimeMs,
      line,
      file,
    });
  }

  const dropCountMatch = xml.match(/<drop-count>(\d+)<\/drop-count>/);
  const dropCount = dropCountMatch ? parseInt(dropCountMatch[1], 10) : 0;

  return { events, dropCount };
}

function extractXmlTagsLocal(xml: string): Record<string, string> {
  const result: Record<string, string> = {};
  const tagPattern = /<([\w-]+)>([^<]*)<\/\1>/g;
  let match: RegExpExecArray | null;
  while ((match = tagPattern.exec(xml)) !== null) {
    result[match[1]] = match[2];
  }
  return result;
}

export interface FwBeaconEcpEvent {
  /** Beacon name as reported by the device, e.g. `app-launch-complete`, `vod-start-complete`. */
  name: string;
  /** Absolute epoch-ms timestamp the device recorded for this beacon. */
  timestampMs: number;
}

/**
 * Parses a GET /query/fwbeacons XML response.
 *
 * Actual device response structure — every child tag other than the fixed
 * status/metadata fields is a named beacon event wrapping its own `<timestamp>`:
 * <fwbeacons>
 *   <tracking-enabled>true</tracking-enabled>
 *   <plugin-id>dev</plugin-id>
 *   <plugin-title>DAZN</plugin-title>
 *   <drop-count>0</drop-count>
 *   <interval-drop-count>0</interval-drop-count>
 *   <count>2</count>
 *   <app-launch-complete><timestamp>1782980514114</timestamp></app-launch-complete>
 *   <vod-start-complete><timestamp>1782980514288</timestamp></vod-start-complete>
 *   <timestamp>1782980516220</timestamp>
 *   <status>OK</status>
 * </fwbeacons>
 *
 * Like /query/sgrendezvous, this drains the device's queue — each call only
 * returns events since the previous call (`count` resets to 0 with nothing new).
 */
const FW_BEACON_NON_EVENT_TAGS = new Set([
  'tracking-enabled', 'plugin-id', 'plugin-title',
  'drop-count', 'interval-drop-count', 'count', 'timestamp', 'status',
]);

function parseFwBeaconsXml(xml: string): { events: FwBeaconEcpEvent[]; dropCount: number } {
  const events: FwBeaconEcpEvent[] = [];

  const blockPattern = /<([\w-]+)>\s*<timestamp>(\d+)<\/timestamp>\s*<\/\1>/g;
  let match: RegExpExecArray | null;
  while ((match = blockPattern.exec(xml)) !== null) {
    const [, tag, timestampRaw] = match;
    if (FW_BEACON_NON_EVENT_TAGS.has(tag)) continue;
    events.push({ name: tag, timestampMs: parseInt(timestampRaw, 10) });
  }

  const dropCountMatch = xml.match(/<drop-count>(\d+)<\/drop-count>/);
  const dropCount = dropCountMatch ? parseInt(dropCountMatch[1], 10) : 0;

  return { events, dropCount };
}

const DEFAULT_ECP_PORT = 8060;
const DEFAULT_TIMEOUT_MS = 3000;
const ALIVE_TIMEOUT_MS = 2000;
const AUTH_TIMEOUT_MS = 5000;

/**
 * Extracts all leaf XML tag values from a device-info XML document.
 * Matches `<tag-name>value</tag-name>` pairs where value contains no nested
 * tags. This correctly skips the outer `<device-info>` container tag that
 * Roku devices return wrapping all fields.
 */
function extractXmlTags(xml: string): Record<string, string> {
  const result: Record<string, string> = {};
  const tagPattern = /<([\w-]+)>([^<]*)<\/\1>/g;
  let match: RegExpExecArray | null;

  while ((match = tagPattern.exec(xml)) !== null) {
    result[match[1]] = match[2];
  }

  return result;
}

/**
 * Parses the XML response from `GET /query/apps` into an array of installed apps.
 *
 * Example response:
 * ```xml
 * <apps>
 *   <app id="12" type="appl" version="1.0.0">Netflix</app>
 *   <app id="dev" type="appl" version="2.0.0">My App</app>
 * </apps>
 * ```
 */
export function parseAppsXml(xml: string): RokuApp[] {
  const apps: RokuApp[] = [];
  const appPattern = /<app\s+([^>]*)>([^<]*)<\/app>/g;
  let match: RegExpExecArray | null;

  while ((match = appPattern.exec(xml)) !== null) {
    const attrs = match[1];
    const name = match[2].trim();

    const idMatch = attrs.match(/id="([^"]*)"/);
    const typeMatch = attrs.match(/type="([^"]*)"/);
    const versionMatch = attrs.match(/version="([^"]*)"/);

    if (idMatch) {
      apps.push({
        id: idMatch[1],
        name,
        type: typeMatch?.[1],
        version: versionMatch?.[1],
      });
    }
  }

  return apps;
}

/**
 * Builds an ECP query string (`?k=v&k2=v2`) from a key-value map.
 *
 * Keys and values are both `encodeURIComponent`-encoded. Returns an empty
 * string for an empty map so the result can be appended to a path directly.
 */
export function buildEcpQueryString(params: Record<string, string>): string {
  const pairs = Object.entries(params)
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`);

  return pairs.length > 0 ? `?${pairs.join('&')}` : '';
}

/**
 * ECP (External Control Protocol) client for communicating with Roku devices.
 *
 * Uses the Roku ECP REST API over HTTP (default port 8060) to query device
 * information and check device connectivity. Also supports Roku developer
 * password validation via HTTP Digest Authentication on port 80.
 *
 * @see https://developer.roku.com/docs/developer-program/dev-tools/external-control-api.md
 */
export class EcpClient {
  /**
   * Queries the full device information from a Roku device.
   *
   * Sends `GET /query/device-info` and parses the XML response into a flat
   * key-value map of all returned tags (e.g. `friendly-device-name`,
   * `model-name`, `serial-number`, etc.).
   *
   * @param ip - The IP address of the Roku device.
   * @param port - ECP port (default: 8060).
   * @param timeoutMs - Request timeout in milliseconds (default: 3000).
   * @returns A record mapping XML tag names to their text content.
   * @throws On network errors, timeouts, or non-200 responses.
   */
  async queryDeviceInfo(
    ip: string,
    port: number = DEFAULT_ECP_PORT,
    timeoutMs: number = DEFAULT_TIMEOUT_MS,
  ): Promise<Record<string, string>> {
    const url = `http://${ip}:${port}/query/device-info`;
    const { statusCode, body } = await httpGet(url, timeoutMs);

    if (statusCode !== 200) {
      throw new Error(`Device at ${ip}:${port} returned status ${statusCode}`);
    }

    return extractXmlTags(body);
  }

  /**
   * Checks whether a Roku device is reachable and responding.
   */
  async checkDeviceAlive(
    ip: string,
    port: number = DEFAULT_ECP_PORT,
    timeoutMs: number = ALIVE_TIMEOUT_MS,
  ): Promise<boolean> {
    try {
      const url = `http://${ip}:${port}/query/device-info`;
      const { statusCode } = await httpGet(url, timeoutMs);

      return statusCode === 200;
    } catch {
      return false;
    }
  }

  /**
   * Queries the list of installed channels from a Roku device.
   *
   * Sends `GET /query/apps` and parses the XML response into a list
   * of installed applications. The sideloaded app appears as id="dev".
   *
   * @returns An array of installed apps.
   * @throws On network errors, timeouts, or non-200 responses.
   */
  async queryApps(
    ip: string,
    port: number = DEFAULT_ECP_PORT,
    timeoutMs: number = DEFAULT_TIMEOUT_MS,
  ): Promise<RokuApp[]> {
    const url = `http://${ip}:${port}/query/apps`;
    const { statusCode, body } = await httpGet(url, timeoutMs);

    if (statusCode !== 200) {
      throw new Error(`Apps query failed: status ${statusCode}`);
    }

    return parseAppsXml(body);
  }

  /**
   * Launches (or relaunches) a channel, optionally with deep-link parameters.
   *
   * Sends `POST /launch/<appId>?contentId=…&mediaType=…`. Any 2xx status
   * (devices return 200 or 204) is treated as success. Deep-link parameters
   * reach the channel via its `main()` arguments / `roInput` on relaunch.
   *
   * @param ip - The IP address of the Roku device.
   * @param appId - Channel id (store id, or `dev` for the sideloaded app).
   * @param params - Query parameters, e.g. `{ contentId: '…', mediaType: 'movie' }`.
   * @param port - ECP port (default: 8060).
   * @param timeoutMs - Request timeout in milliseconds (default: 3000).
   * @throws On network errors, timeouts, or non-2xx responses — a 403 usually
   *   means ECP is restricted ("Control by mobile apps" disabled on-device),
   *   a 404 means the channel is not installed. The response body is included
   *   in the error message when present.
   */
  async launchApp(
    ip: string,
    appId: string,
    params: Record<string, string> = {},
    port: number = DEFAULT_ECP_PORT,
    timeoutMs: number = DEFAULT_TIMEOUT_MS,
  ): Promise<void> {
    const url = `http://${ip}:${port}/launch/${encodeURIComponent(appId)}${buildEcpQueryString(params)}`;
    const { statusCode, body } = await httpPost(url, timeoutMs);

    if (statusCode < 200 || statusCode >= 300) {
      throw new Error(`Launch failed: status ${statusCode}${body.trim() ? ` — ${body.trim()}` : ''}`);
    }
  }

  /**
   * Sends deep-link parameters to the channel currently running in the foreground.
   *
   * Sends `POST /input?contentId=…&mediaType=…`. The device delivers the
   * parameters to the running channel as an `roInput` event — the channel is
   * NOT relaunched. There is no app id: ECP always routes to the foreground
   * channel.
   *
   * @param ip - The IP address of the Roku device.
   * @param params - Query parameters, e.g. `{ contentId: '…', mediaType: 'live' }`.
   * @param port - ECP port (default: 8060).
   * @param timeoutMs - Request timeout in milliseconds (default: 3000).
   * @throws On network errors, timeouts, or non-2xx responses (see {@link launchApp}).
   */
  async sendInput(
    ip: string,
    params: Record<string, string>,
    port: number = DEFAULT_ECP_PORT,
    timeoutMs: number = DEFAULT_TIMEOUT_MS,
  ): Promise<void> {
    const url = `http://${ip}:${port}/input${buildEcpQueryString(params)}`;
    const { statusCode, body } = await httpPost(url, timeoutMs);

    if (statusCode < 200 || statusCode >= 300) {
      throw new Error(`Input failed: status ${statusCode}${body.trim() ? ` — ${body.trim()}` : ''}`);
    }
  }

  /**
   * Fetches a channel's icon image.
   *
   * Sends `GET /query/icon/<appId>` and returns the raw image bytes plus the
   * `Content-Type` reported by the device (falls back to `image/png` when the
   * header is missing).
   *
   * @param ip - The IP address of the Roku device.
   * @param appId - Channel id (store id, or `dev` for the sideloaded app).
   * @param port - ECP port (default: 8060).
   * @param timeoutMs - Request timeout in milliseconds (default: 3000).
   * @throws On network errors, timeouts, or non-200 responses.
   */
  async queryAppIcon(
    ip: string,
    appId: string,
    port: number = DEFAULT_ECP_PORT,
    timeoutMs: number = DEFAULT_TIMEOUT_MS,
  ): Promise<{ data: Buffer; contentType: string }> {
    const url = `http://${ip}:${port}/query/icon/${encodeURIComponent(appId)}`;
    const { statusCode, body, headers } = await httpGetBuffer(url, timeoutMs);

    if (statusCode !== 200) {
      throw new Error(`Icon query failed: status ${statusCode}`);
    }

    return { data: body, contentType: headers['content-type'] ?? 'image/png' };
  }

  /**
   * Queries the device registry for a given channel.
   *
   * Sends `GET /query/registry/<channelId>` and returns the raw XML body.
   * Use `channelId = "dev"` for the sideloaded app. Requires developer mode.
   *
   * Returns the XML body for both HTTP 200 (success) and HTTP 202
   * (failure — e.g. dev ID mismatch). The caller should parse the body
   * and check the `<status>` tag to distinguish success from failure.
   *
   * @returns The raw XML response body.
   * @throws On network errors, timeouts, or unexpected HTTP status codes.
   */
  async queryRegistry(
    ip: string,
    channelId: string,
    port: number = DEFAULT_ECP_PORT,
    timeoutMs: number = DEFAULT_TIMEOUT_MS,
  ): Promise<string> {
    const url = `http://${ip}:${port}/query/registry/${encodeURIComponent(channelId)}`;
    const { statusCode, body } = await httpGet(url, timeoutMs);

    if (statusCode !== 200 && statusCode !== 202) {
      throw new Error(`Registry query failed: status ${statusCode}`);
    }

    return body;
  }

  /**
   * Enables rendezvous tracking on a Roku device via ECP.
   *
   * Sends `POST /sgrendezvous/track`. Returns `true` when the device
   * confirms tracking is enabled.
   */
  async enableRendezvousTracking(
    ip: string,
    port: number = DEFAULT_ECP_PORT,
  ): Promise<boolean> {
    try {
      const url = `http://${ip}:${port}/sgrendezvous/track`;
      const { statusCode } = await httpPost(url, DEFAULT_TIMEOUT_MS);
      return statusCode === 200;
    } catch {
      return false;
    }
  }

  /**
   * Disables rendezvous tracking on a Roku device via ECP.
   *
   * Sends `POST /sgrendezvous/untrack`. Returns `true` on success.
   */
  async disableRendezvousTracking(
    ip: string,
    port: number = DEFAULT_ECP_PORT,
  ): Promise<boolean> {
    try {
      const url = `http://${ip}:${port}/sgrendezvous/untrack`;
      const { statusCode } = await httpPost(url, DEFAULT_TIMEOUT_MS);
      return statusCode === 200;
    } catch {
      return false;
    }
  }

  /**
   * Queries queued rendezvous events from a Roku device via ECP.
   *
   * Sends `GET /query/sgrendezvous`. The device returns up to 1,000 events
   * since tracking was enabled or since the previous query (draining the queue).
   * Also returns `dropCount` — events lost due to buffer overflow since last query.
   * Returns empty results on network errors or when no events are queued.
   */
  async queryRendezvousEvents(
    ip: string,
    port: number = DEFAULT_ECP_PORT,
  ): Promise<{ events: RendezvousEvent[]; dropCount: number }> {
    try {
      const url = `http://${ip}:${port}/query/sgrendezvous`;
      const { statusCode, body } = await httpGet(url, DEFAULT_TIMEOUT_MS);
      if (statusCode !== 200) return { events: [], dropCount: 0 };
      return parseRendezvousXml(body);
    } catch {
      return { events: [], dropCount: 0 };
    }
  }

  /**
   * Queries per-channel CPU + memory via ECP (`/query/chanperf`).
   * Returns the raw XML body for the caller to parse.
   */
  async queryChanperf(
    ip: string,
    port: number = DEFAULT_ECP_PORT,
  ): Promise<string> {
    const { statusCode, body } = await httpGet(
      `http://${ip}:${port}/query/chanperf`,
      DEFAULT_TIMEOUT_MS,
    );
    if (statusCode !== 200) throw new Error(`chanperf: HTTP ${statusCode}`);
    return body;
  }

  /**
   * Queries the SceneGraph node tree via ECP (`/query/sgnodes/all`).
   * Returns the raw XML body for the caller to parse.
   */
  async querySgNodes(
    ip: string,
    port: number = DEFAULT_ECP_PORT,
  ): Promise<string> {
    const { statusCode, body } = await httpGet(
      `http://${ip}:${port}/query/sgnodes/all`,
      DEFAULT_TIMEOUT_MS,
    );
    if (statusCode !== 200) throw new Error(`sgnodes: HTTP ${statusCode}`);
    return body;
  }

  /**
   * Queries per-object-type BrightScript object counts and memory via ECP
   * (`/query/app-object-counts/<appId>`). Scoped to a specific app id (the
   * sideloaded channel is `dev`). Returns the raw XML body for the caller to
   * parse; while the channel is backgrounded the device answers with
   * `<status>FAILED</status>` in the body (HTTP 200), same as chanperf/sgnodes.
   */
  async queryAppObjectCounts(
    ip: string,
    appId: string,
    port: number = DEFAULT_ECP_PORT,
  ): Promise<string> {
    const { statusCode, body } = await httpGet(
      `http://${ip}:${port}/query/app-object-counts/${encodeURIComponent(appId)}`,
      DEFAULT_TIMEOUT_MS,
    );
    if (statusCode !== 200) throw new Error(`app-object-counts: HTTP ${statusCode}`);
    return body;
  }

  /**
   * Queries an app's lifecycle state via ECP (`/query/app-state/<appId>`).
   *
   * Returns `'active'` (foreground), `'background'`, or `'inactive'` based on
   * the device's `<state>` tag. Requires "Control by mobile apps" to be
   * enabled on the device — never throws; returns `'unknown'` on any failure
   * (device offline, setting disabled, unrecognized response) so polling
   * collectors can keep going without special-casing this endpoint.
   *
   * Verified live response shape (Roku Ultra, firmware 15.2.4):
   * ```xml
   * <app-state>
   *   <app-id>dev</app-id><app-title>DAZN</app-title><app-version>3.30.5</app-version>
   *   <app-dev-id>...</app-dev-id>
   *   <state>background</state>
   *   <status>OK</status>
   * </app-state>
   * ```
   * On failure (e.g. querying an app ID other than the active dev channel):
   * `<app-state><app-id>12</app-id><status>FAILED</status><error>...</error></app-state>`
   */
  async queryAppState(
    ip: string,
    appId: string,
    port: number = DEFAULT_ECP_PORT,
  ): Promise<'active' | 'background' | 'inactive' | 'unknown'> {
    try {
      const { statusCode, body } = await httpGet(
        `http://${ip}:${port}/query/app-state/${encodeURIComponent(appId)}`,
        DEFAULT_TIMEOUT_MS,
      );
      if (statusCode !== 200) return 'unknown';
      if (!/<status>\s*OK\s*<\/status>/i.test(body)) return 'unknown';
      const m = /<state>\s*([^<\s]+)\s*<\/state>/i.exec(body);
      const state = m?.[1]?.toLowerCase();
      if (state === 'active' || state === 'background' || state === 'inactive') return state;
      return 'unknown';
    } catch {
      return 'unknown';
    }
  }

  /**
   * Enables framework beacon tracking for an app via ECP.
   *
   * Sends `POST /fwbeacons/track/<appId>`. Returns `true` when the device
   * confirms tracking is enabled. Mirrors `enableRendezvousTracking`, but
   * scoped to a specific app id (the sideloaded channel is `dev`).
   */
  async enableFwBeaconTracking(
    ip: string,
    appId: string,
    port: number = DEFAULT_ECP_PORT,
  ): Promise<boolean> {
    try {
      const url = `http://${ip}:${port}/fwbeacons/track/${encodeURIComponent(appId)}`;
      const { statusCode } = await httpPost(url, DEFAULT_TIMEOUT_MS);
      return statusCode === 200;
    } catch {
      return false;
    }
  }

  /**
   * Disables framework beacon tracking for an app via ECP.
   *
   * Sends `POST /fwbeacons/untrack/<appId>`, mirroring the `track`/`untrack`
   * pair used for rendezvous. Not independently confirmed live (only `track`
   * and `query` were observed) — safe either way since callers swallow failures.
   */
  async disableFwBeaconTracking(
    ip: string,
    appId: string,
    port: number = DEFAULT_ECP_PORT,
  ): Promise<boolean> {
    try {
      const url = `http://${ip}:${port}/fwbeacons/untrack/${encodeURIComponent(appId)}`;
      const { statusCode } = await httpPost(url, DEFAULT_TIMEOUT_MS);
      return statusCode === 200;
    } catch {
      return false;
    }
  }

  /**
   * Queries queued framework beacon events from a Roku device via ECP.
   *
   * Sends `GET /query/fwbeacons`. Like rendezvous, this drains the device's
   * event queue since tracking was enabled or since the previous query.
   * Returns empty results on network errors or when no events are queued.
   */
  async queryFwBeacons(
    ip: string,
    port: number = DEFAULT_ECP_PORT,
  ): Promise<{ events: FwBeaconEcpEvent[]; dropCount: number }> {
    try {
      const url = `http://${ip}:${port}/query/fwbeacons`;
      const { statusCode, body } = await httpGet(url, DEFAULT_TIMEOUT_MS);
      if (statusCode !== 200) return { events: [], dropCount: 0 };
      return parseFwBeaconsXml(body);
    } catch {
      return { events: [], dropCount: 0 };
    }
  }

  /**
   * Validates a developer password against a Roku device using HTTP Digest
   * Authentication.
   *
   * Roku devices expose a development server on port 80 that requires digest
   * auth with username `rokudev`. This method performs the two-step digest
   * handshake:
   * 1. Sends an unauthenticated GET to receive the 401 challenge.
   * 2. Computes the digest response and retries with the Authorization header.
   *
   * @param ip - The IP address of the Roku device.
   * @param password - The developer password to validate.
   * @param port - Dev server port (default: 80).
   * @returns `true` if authentication succeeds (HTTP 200), `false` if rejected (HTTP 401).
   * @throws On network errors or timeouts (not on auth failure).
   */
  async validatePassword(
    ip: string,
    password: string,
    port: number = 80,
  ): Promise<boolean> {
    const uri = '/';
    const url = `http://${ip}:${port}${uri}`;

    try {
      const challengeRes = await httpGet(url, AUTH_TIMEOUT_MS);

      if (challengeRes.statusCode !== 401) {
        return challengeRes.statusCode === 200;
      }

      const wwwAuth = challengeRes.headers['www-authenticate'];

      if (!wwwAuth || !wwwAuth.toLowerCase().includes('digest')) {
        return false;
      }

      const { realm, nonce, qop } = parseDigestChallenge(wwwAuth);

      if (!realm || !nonce) {
        return false;
      }

      const authHeader = buildDigestAuthHeader('rokudev', password, realm, nonce, 'GET', uri, qop);
      const authRes = await httpGet(url, AUTH_TIMEOUT_MS, { Authorization: authHeader });

      return authRes.statusCode === 200;
    } catch {
      return false;
    }
  }
}

export default EcpClient;
