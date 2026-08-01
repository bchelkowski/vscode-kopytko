import { RokuApp } from '../types';
import { buildDigestAuthHeader, httpGet, httpGetBuffer, httpPost, parseDigestChallenge } from '../net/httpClient';
import { textToLitKeys } from './keys';

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
 *   <plugin-title>Acme</plugin-title>
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

/** The currently running (foreground) app as reported by `GET /query/active-app`. */
export interface ActiveAppInfo {
  /** Channel id. Absent on the plain home screen on some firmware versions. */
  id?: string;
  /** Channel display name (e.g. `Roku` for the home screen). */
  name: string;
  type?: string;
  version?: string;
}

/**
 * Parses a `GET /query/active-app` XML response.
 *
 * ```xml
 * <active-app>
 *   <app id="dev" type="appl" version="3.30.5">Acme</app>
 * </active-app>
 * ```
 * The home screen may report `<app>Roku</app>` with no attributes.
 * Returns `undefined` when no `<app>` element is present.
 */
export function parseActiveAppXml(xml: string): ActiveAppInfo | undefined {
  const match = /<app\b([^>]*)>([^<]*)<\/app>/.exec(xml);
  if (!match) return undefined;

  const [, attrs, name] = match;
  return {
    id: /id="([^"]*)"/.exec(attrs)?.[1],
    name: name.trim(),
    type: /type="([^"]*)"/.exec(attrs)?.[1],
    version: /version="([^"]*)"/.exec(attrs)?.[1],
  };
}

/** Parsed `GET /query/media-player` response. */
export interface MediaPlayerInfo {
  /** Player state: `none`, `open`, `play`, `pause`, `buffer`, `close`, `stop`, … */
  state: string;
  /** `true` when the player reports an error condition. */
  error: boolean;
  /** The channel that owns the player, when one is active. */
  plugin?: { id?: string; name?: string; bandwidth?: string };
  /** Stream format attributes; only present while media is loaded. */
  format?: { audio?: string; video?: string; drm?: string; captions?: string; container?: string };
  /** Playback position in milliseconds, when reported. */
  positionMs?: number;
  /** Stream duration in milliseconds, when reported (absent for live). */
  durationMs?: number;
  /** `true` when the device flags the stream as live. */
  isLive?: boolean;
}

/**
 * Parses a `GET /query/media-player` XML response.
 *
 * Representative shape (attributes vary by firmware — parse leniently):
 * ```xml
 * <player error="false" state="play">
 *   <plugin bandwidth="…" id="dev" name="Acme"/>
 *   <format audio="aac" captions="none" container="…" drm="none" video="hevc"/>
 *   <position>1198000 ms</position>
 *   <duration>7422000 ms</duration>
 *   <is_live>false</is_live>
 * </player>
 * ```
 * `<position>`/`<duration>` values carry a ` ms` suffix.
 */
export function parseMediaPlayerXml(xml: string): MediaPlayerInfo {
  const playerAttrs = /<player\b([^>]*)>/.exec(xml)?.[1] ?? '';
  const attr = (attrs: string, name: string): string | undefined =>
    new RegExp(`${name}="([^"]*)"`).exec(attrs)?.[1];

  const info: MediaPlayerInfo = {
    state: attr(playerAttrs, 'state')?.toLowerCase() ?? 'none',
    error: attr(playerAttrs, 'error') === 'true',
  };

  const pluginAttrs = /<plugin\b([^>]*)\/?>/.exec(xml)?.[1];
  if (pluginAttrs !== undefined) {
    info.plugin = {
      id: attr(pluginAttrs, 'id'),
      name: attr(pluginAttrs, 'name'),
      bandwidth: attr(pluginAttrs, 'bandwidth'),
    };
  }

  const formatAttrs = /<format\b([^>]*)\/?>/.exec(xml)?.[1];
  if (formatAttrs !== undefined) {
    info.format = {
      audio: attr(formatAttrs, 'audio'),
      video: attr(formatAttrs, 'video'),
      drm: attr(formatAttrs, 'drm'),
      captions: attr(formatAttrs, 'captions'),
      container: attr(formatAttrs, 'container'),
    };
  }

  const ms = (tag: string): number | undefined => {
    const raw = new RegExp(`<${tag}>\\s*(\\d+)\\s*ms\\s*</${tag}>`).exec(xml)?.[1];
    return raw !== undefined ? parseInt(raw, 10) : undefined;
  };
  info.positionMs = ms('position');
  info.durationMs = ms('duration');

  const isLiveRaw = /<is_live>\s*(true|false)\s*<\/is_live>/.exec(xml)?.[1];
  if (isLiveRaw !== undefined) info.isLive = isLiveRaw === 'true';

  return info;
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

/** Optional filters for {@link EcpClient.queryRegistry}. */
export interface RegistryQueryOptions {
  /** Adds `u=1` — percent-escapes registry values in the response. */
  escaped?: boolean;
  /** Adds `k=key1|key2` — only return these registry keys. */
  keys?: string[];
  /** Adds `s=sec1|sec2` — only return these registry sections. */
  sections?: string[];
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
   * Simulates pressing and releasing a remote-control key.
   *
   * Sends `POST /keypress/{key}`. The key is either a named key (see
   * {@link EcpKeys}) or a `Lit_`-prefixed literal character. Lit_ values must
   * arrive already URL-encoded (`Lit_%E2%82%AC`) — this method does NOT
   * re-encode the key, since named keys are URL-safe and Lit_ segments are
   * pre-encoded by {@link textToLitKeys}.
   *
   * @throws On network errors, timeouts, or non-2xx responses — a 403 means
   *   ECP is restricted ("Control by mobile apps" set to Limited on-device).
   */
  async keypress(
    ip: string,
    key: string,
    port: number = DEFAULT_ECP_PORT,
    timeoutMs: number = DEFAULT_TIMEOUT_MS,
  ): Promise<void> {
    await this.sendKeyCommand(ip, 'keypress', key, port, timeoutMs);
  }

  /**
   * Simulates pressing (and holding) a remote-control key.
   *
   * Sends `POST /keydown/{key}`. The device treats the key as held until a
   * matching {@link keyup} arrives — callers are responsible for always
   * sending the release. Same key encoding rules as {@link keypress}.
   */
  async keydown(
    ip: string,
    key: string,
    port: number = DEFAULT_ECP_PORT,
    timeoutMs: number = DEFAULT_TIMEOUT_MS,
  ): Promise<void> {
    await this.sendKeyCommand(ip, 'keydown', key, port, timeoutMs);
  }

  /**
   * Simulates releasing a remote-control key previously sent via {@link keydown}.
   *
   * Sends `POST /keyup/{key}`. Same key encoding rules as {@link keypress}.
   */
  async keyup(
    ip: string,
    key: string,
    port: number = DEFAULT_ECP_PORT,
    timeoutMs: number = DEFAULT_TIMEOUT_MS,
  ): Promise<void> {
    await this.sendKeyCommand(ip, 'keyup', key, port, timeoutMs);
  }

  private async sendKeyCommand(
    ip: string,
    command: 'keypress' | 'keydown' | 'keyup',
    key: string,
    port: number,
    timeoutMs: number,
  ): Promise<void> {
    const url = `http://${ip}:${port}/${command}/${key}`;
    const { statusCode, body } = await httpPost(url, timeoutMs);

    if (statusCode < 200 || statusCode >= 300) {
      throw new Error(`${command} ${key} failed: status ${statusCode}${body.trim() ? ` — ${body.trim()}` : ''}`);
    }
  }

  /**
   * Types a text string on the device's on-screen keyboard.
   *
   * Encodes the text as `Lit_` key values (one per Unicode code point) and
   * sends them as strictly sequential `POST /keypress/Lit_…` requests — each
   * request is awaited before the next is sent, so characters arrive in order.
   * Stops at the first failure.
   *
   * @throws The first {@link keypress} error encountered; characters after the
   *   failing one are not sent.
   */
  async sendText(
    ip: string,
    text: string,
    port: number = DEFAULT_ECP_PORT,
    timeoutMs: number = DEFAULT_TIMEOUT_MS,
  ): Promise<void> {
    for (const key of textToLitKeys(text)) {
      await this.keypress(ip, key, port, timeoutMs);
    }
  }

  /**
   * Queries the currently running (foreground) app.
   *
   * Sends `GET /query/active-app`. The home screen reports itself as an app
   * (name `Roku`, possibly without an id on some firmware versions).
   *
   * @returns The active app, or `undefined` when the response has no `<app>`.
   * @throws On network errors, timeouts, or non-200 responses.
   */
  async queryActiveApp(
    ip: string,
    port: number = DEFAULT_ECP_PORT,
    timeoutMs: number = DEFAULT_TIMEOUT_MS,
  ): Promise<ActiveAppInfo | undefined> {
    const url = `http://${ip}:${port}/query/active-app`;
    const { statusCode, body } = await httpGet(url, timeoutMs);

    if (statusCode !== 200) {
      throw new Error(`Active app query failed: status ${statusCode}`);
    }

    return parseActiveAppXml(body);
  }

  /**
   * Queries the state of the device's media player.
   *
   * Sends `GET /query/media-player` and parses the player state, owning
   * channel, stream format (codecs/DRM), and position/duration. With no
   * media loaded the device reports `state="none"`.
   *
   * @throws On network errors, timeouts, or non-200 responses.
   */
  async queryMediaPlayer(
    ip: string,
    port: number = DEFAULT_ECP_PORT,
    timeoutMs: number = DEFAULT_TIMEOUT_MS,
  ): Promise<MediaPlayerInfo> {
    const url = `http://${ip}:${port}/query/media-player`;
    const { statusCode, body } = await httpGet(url, timeoutMs);

    if (statusCode !== 200) {
      throw new Error(`Media player query failed: status ${statusCode}`);
    }

    return parseMediaPlayerXml(body);
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
   * @param options - ⚠️ Docs-derived, never confirmed live (see `findings/roku-device-api.md`):
   *   `escaped` adds `u=1` (percent-escapes registry values in the response); `keys` adds
   *   `k=key1|key2` (only return these keys); `sections` adds `s=sec1|sec2` (only return these
   *   sections). All three come from Roku's published ECP docs, not a device capture.
   * @returns The raw XML response body.
   * @throws On network errors, timeouts, or unexpected HTTP status codes.
   */
  async queryRegistry(
    ip: string,
    channelId: string,
    options: RegistryQueryOptions = {},
    port: number = DEFAULT_ECP_PORT,
    timeoutMs: number = DEFAULT_TIMEOUT_MS,
  ): Promise<string> {
    const queryParams: Record<string, string> = {};
    if (options.escaped) queryParams.u = '1';
    if (options.keys?.length) queryParams.k = options.keys.join('|');
    if (options.sections?.length) queryParams.s = options.sections.join('|');

    const url = `http://${ip}:${port}/query/registry/${encodeURIComponent(channelId)}${buildEcpQueryString(queryParams)}`;
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
   * Queries the SceneGraph node tree via ECP.
   *
   * `scope: 'all'` sends `GET /query/sgnodes/all` (every node created by the
   * app); `scope: 'roots'` sends `GET /query/sgnodes/roots` (only un-parented
   * nodes). Returns the raw XML body for the caller to parse.
   */
  async querySgNodes(
    ip: string,
    port: number = DEFAULT_ECP_PORT,
    scope: 'all' | 'roots' = 'all',
  ): Promise<string> {
    const { statusCode, body } = await httpGet(
      `http://${ip}:${port}/query/sgnodes/${scope}`,
      DEFAULT_TIMEOUT_MS,
    );
    if (statusCode !== 200) throw new Error(`sgnodes: HTTP ${statusCode}`);
    return body;
  }

  /**
   * Queries the rendered UI node tree of the foreground app via ECP
   * (`GET /query/app-ui`). Returns the raw XML body
   * (`<app-ui><status>OK</status><topscreen>…`) for the caller to parse.
   *
   * Unlike sgnodes, this endpoint reports failure in-band with HTTP 200 —
   * `<status>FAILED</status><error>No active app</error>` when no app is
   * running — so that case throws with the device-reported error text.
   */
  async queryAppUi(
    ip: string,
    port: number = DEFAULT_ECP_PORT,
  ): Promise<string> {
    const { statusCode, body } = await httpGet(
      `http://${ip}:${port}/query/app-ui`,
      DEFAULT_TIMEOUT_MS,
    );
    if (statusCode !== 200) throw new Error(`app-ui: HTTP ${statusCode}`);
    if (/<status>\s*FAILED\s*<\/status>/i.test(body)) {
      const error = body.match(/<error>([^<]*)<\/error>/i)?.[1]?.trim();
      throw new Error(`app-ui: ${error || 'device reported FAILED'}`);
    }
    return body;
  }

  /**
   * Queries SceneGraph nodes matching a specific node id via ECP
   * (`/query/sgnodes/nodes?node-id=<id>`). Returns the raw XML body for the
   * caller to parse.
   */
  async querySgNodesById(
    ip: string,
    nodeId: string,
    port: number = DEFAULT_ECP_PORT,
  ): Promise<string> {
    const url = `http://${ip}:${port}/query/sgnodes/nodes${buildEcpQueryString({ 'node-id': nodeId })}`;
    const { statusCode, body } = await httpGet(url, DEFAULT_TIMEOUT_MS);
    if (statusCode !== 200) throw new Error(`sgnodes/nodes: HTTP ${statusCode}`);
    return body;
  }

  /**
   * Queries texture/bitmap memory usage via ECP (`/query/r2d2-bitmaps`).
   * Returns the raw XML body for the caller to parse. Requires developer
   * mode + "Control by mobile apps" enabled.
   */
  async queryR2d2Bitmaps(
    ip: string,
    port: number = DEFAULT_ECP_PORT,
  ): Promise<string> {
    const { statusCode, body } = await httpGet(
      `http://${ip}:${port}/query/r2d2-bitmaps`,
      DEFAULT_TIMEOUT_MS,
    );
    if (statusCode !== 200) throw new Error(`r2d2-bitmaps: HTTP ${statusCode}`);
    return body;
  }

  /**
   * Queries recent rendered graphics frame rate via ECP
   * (`/query/graphics-frame-rate`, Roku OS 12.0+). Returns the raw XML body
   * for the caller to parse. Requires developer mode + "Control by mobile
   * apps" enabled.
   */
  async queryGraphicsFrameRate(
    ip: string,
    port: number = DEFAULT_ECP_PORT,
  ): Promise<string> {
    const { statusCode, body } = await httpGet(
      `http://${ip}:${port}/query/graphics-frame-rate`,
      DEFAULT_TIMEOUT_MS,
    );
    if (statusCode !== 200) throw new Error(`graphics-frame-rate: HTTP ${statusCode}`);
    return body;
  }

  /**
   * Queries the TV tuner channel list via ECP (`/query/tv-channels`).
   * Roku TV models only — returns the raw XML body for the caller to parse.
   * Requires "Control by mobile apps" enabled.
   */
  async queryTvChannels(
    ip: string,
    port: number = DEFAULT_ECP_PORT,
    timeoutMs: number = DEFAULT_TIMEOUT_MS,
  ): Promise<string> {
    const { statusCode, body } = await httpGet(`http://${ip}:${port}/query/tv-channels`, timeoutMs);
    if (statusCode !== 200) throw new Error(`tv-channels: HTTP ${statusCode}`);
    return body;
  }

  /**
   * Queries the currently tuned TV channel and signal info via ECP
   * (`/query/tv-active-channel`). Roku TV models only — returns the raw XML
   * body for the caller to parse. Requires "Control by mobile apps" enabled.
   */
  async queryTvActiveChannel(
    ip: string,
    port: number = DEFAULT_ECP_PORT,
    timeoutMs: number = DEFAULT_TIMEOUT_MS,
  ): Promise<string> {
    const { statusCode, body } = await httpGet(`http://${ip}:${port}/query/tv-active-channel`, timeoutMs);
    if (statusCode !== 200) throw new Error(`tv-active-channel: HTTP ${statusCode}`);
    return body;
  }

  /**
   * Suspends or terminates a running channel via ECP.
   *
   * Sends `POST /exit-app/<appId>` (suspends via Instant Resume if the
   * channel supports it, otherwise terminates), or `POST /exit-app/<appId>/true`
   * when `force` is set (bypasses Instant Resume and always terminates).
   *
   * @throws On network errors, timeouts, or non-2xx responses — a 404 means
   *   the channel is not currently running.
   */
  async exitApp(
    ip: string,
    appId: string,
    force: boolean = false,
    port: number = DEFAULT_ECP_PORT,
    timeoutMs: number = DEFAULT_TIMEOUT_MS,
  ): Promise<void> {
    const path = `/exit-app/${encodeURIComponent(appId)}${force ? '/true' : ''}`;
    const { statusCode, body } = await httpPost(`http://${ip}:${port}${path}`, timeoutMs);

    if (statusCode < 200 || statusCode >= 300) {
      throw new Error(`Exit app failed: status ${statusCode}${body.trim() ? ` — ${body.trim()}` : ''}`);
    }
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
   *   <app-id>dev</app-id><app-title>Acme</app-title><app-version>3.30.5</app-version>
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
