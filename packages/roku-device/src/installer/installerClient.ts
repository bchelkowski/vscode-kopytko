import * as fs from 'fs/promises';
import { EcpClient } from '../ecp/ecpClient';
import {
  httpGetBufferDigest,
  httpPostMultipartDigest,
  type HttpGetResponse,
  type MultipartField,
} from '../net/httpClient';

const DEFAULT_PORT = 80;
const DEFAULT_ECP_PORT = 8060;
const DEFAULT_TIMEOUT_MS = 15000;
const USERNAME = 'rokudev';

const SCREENSHOT_URI_PATTERN = /"(pkgs\/dev\.jpg\?time=\d+)"/;
const PACKAGE_LINK_PATTERN = /<a\s+href="(pkgs\/[^"]+\.pkg)"/i;
const PROFILING_LINK_PATTERN = /"(pkgs\/[^"]+)"/;
const PACKAGE_FAILURE_PATTERN = /<font[^>]*>\s*Failed:\s*([^<]*)<\/font>/i;
const REKEY_MESSAGE_PATTERN = /<font color="red">([^<]*)<\/font>/i;

interface WebAdminMessage {
  text: string;
  text_type: string;
  type: string;
}

/**
 * Extracts the `params.messages` array embedded in the web-admin page's
 * inline script (`var params = JSON.parse('{"messages":[...],...}');`).
 *
 * Confirmed live (Roku Ultra, 2026-07) as the authoritative success/failure
 * signal for `/plugin_install`: a failed action (e.g. a malformed zip) still
 * returns HTTP 200, with the real failure reported here as a message with
 * `type: "error"` (e.g. `"Install Failure: Script directory ... does not
 * exist in plugin."`). A successful install reports `type: "success"`
 * (`"Install Success."`); re-uploading identical bytes reports `type:
 * "info"` (`"...not replacing."`) — neither of which should be treated as a
 * failure. Not confirmed whether `/plugin_inspect`/`/plugin_package` use this
 * same mechanism (untested — see `findings/roku-device-api.md`), so this is
 * used as a defense-in-depth check on top of, not instead of, each action's
 * own success/failure parsing.
 */
function extractWebAdminMessages(body: string): WebAdminMessage[] | undefined {
  const match = /JSON\.parse\('(.+?)'\)/s.exec(body);
  if (!match) return undefined;

  try {
    const params = JSON.parse(match[1]) as { messages?: WebAdminMessage[] | null };
    return params.messages ?? undefined;
  } catch {
    return undefined;
  }
}

/**
 * True for network errors caused by the remote end dropping the connection —
 * expected behavior for {@link InstallerClient.reboot} since the device does
 * not (and cannot) send a full HTTP response while it restarts.
 */
function isConnectionResetError(err: unknown): boolean {
  const code = (err as NodeJS.ErrnoException)?.code;
  if (code === 'ECONNRESET' || code === 'ECONNABORTED' || code === 'EPIPE') return true;
  const message = (err as Error)?.message ?? '';
  return /socket hang up/i.test(message);
}

/**
 * Client for the Roku developer web-admin page (`http://<ip>/`, HTTP Digest
 * auth, username always `rokudev`) — the Installer, Utilities, Packager, and
 * Update tabs a developer normally drives by hand in a browser.
 *
 * Distinct from {@link EcpClient}, which talks to the unauthenticated ECP
 * REST API on port 8060. This client's default port is 80.
 *
 * @see https://developer.roku.com/dev/docs/developer-setup
 */
export class InstallerClient {
  constructor(private readonly ecpClient: EcpClient = new EcpClient()) {}

  /**
   * Deletes the currently installed dev channel (Installer tab, "Delete").
   *
   * @throws If authentication fails or the device returns a non-2xx status.
   */
  async deleteChannel(
    ip: string,
    password: string,
    port: number = DEFAULT_PORT,
    timeoutMs: number = DEFAULT_TIMEOUT_MS,
  ): Promise<void> {
    const response = await this.postForm(
      ip, port, password, '/plugin_install',
      [{ name: 'mysubmit', value: 'Delete' }],
      timeoutMs,
    );

    this.ensureOk('Delete channel', ip, response);
  }

  /**
   * Installs (or replaces) the dev channel from a local zip package
   * (Installer tab, "Install").
   *
   * @param zipPath - Local path to the channel's zip archive (`manifest` at
   *   the archive root).
   * @throws If the zip cannot be read, authentication fails, or the device
   *   returns a non-2xx status.
   */
  async installChannel(
    ip: string,
    password: string,
    zipPath: string,
    port: number = DEFAULT_PORT,
    timeoutMs: number = DEFAULT_TIMEOUT_MS,
  ): Promise<void> {
    const data = await this.readFileOrThrow(zipPath);

    const response = await this.postForm(
      ip, port, password, '/plugin_install',
      [
        { name: 'mysubmit', value: 'Install' },
        { name: 'archive', file: { filename: 'archive.zip', contentType: 'application/octet-stream', data } },
      ],
      timeoutMs,
    );

    this.ensureOk('Install channel', ip, response);
  }

  /**
   * Rekeys the device using an already-packaged (signed) `.pkg` file and its
   * signing password (Utilities tab, "Rekey").
   *
   * @param pkgPath - Local path to the signed `.pkg` file produced by
   *   {@link packageChannel} (or an external signing step).
   * @param signingPassword - The developer key's signing password.
   * @throws If the pkg cannot be read, authentication fails, or the device's
   *   response does not report `"Success."`.
   */
  async rekey(
    ip: string,
    password: string,
    pkgPath: string,
    signingPassword: string,
    port: number = DEFAULT_PORT,
    timeoutMs: number = DEFAULT_TIMEOUT_MS,
  ): Promise<void> {
    const data = await this.readFileOrThrow(pkgPath);

    const response = await this.postForm(
      ip, port, password, '/plugin_inspect',
      [
        { name: 'mysubmit', value: 'Rekey' },
        { name: 'passwd', value: signingPassword },
        { name: 'archive', file: { filename: 'archive.pkg', contentType: 'application/octet-stream', data } },
      ],
      timeoutMs,
    );

    this.ensureOk('Rekey', ip, response);

    const match = REKEY_MESSAGE_PATTERN.exec(response.body);
    if (!match) {
      throw new Error(`Rekey: unexpected response from ${ip}`);
    }
    if (match[1] !== 'Success.') {
      throw new Error(`Rekey failed: ${match[1]}`);
    }
  }

  /**
   * Compares the device's current keyed developer ID against a target key ID
   * to determine whether a rekey is needed. Delegates entirely to
   * {@link EcpClient.queryDeviceInfo} — no duplicated device-info logic.
   *
   * @throws Whatever {@link EcpClient.queryDeviceInfo} throws (network error,
   *   timeout, non-200 status) — this is a data fetch, not a health check.
   */
  async validateKey(
    ip: string,
    targetKeyId: string,
    ecpPort: number = DEFAULT_ECP_PORT,
  ): Promise<{ matches: boolean; currentKeyId: string }> {
    const info = await this.ecpClient.queryDeviceInfo(ip, ecpPort);
    const currentKeyId = info['keyed-developer-id'] ?? '';

    return { matches: currentKeyId === targetKeyId, currentKeyId };
  }

  /**
   * Captures a screenshot of the running dev channel and saves it to
   * `destPath` (Utilities tab, "Screenshot"). Requires the dev channel to be
   * running with the screensaver off.
   *
   * @throws If the trigger response doesn't contain the expected download
   *   URI, or the download itself fails.
   */
  async takeScreenshot(
    ip: string,
    password: string,
    destPath: string,
    port: number = DEFAULT_PORT,
    timeoutMs: number = DEFAULT_TIMEOUT_MS,
  ): Promise<void> {
    const triggerResponse = await this.postForm(
      ip, port, password, '/plugin_inspect',
      [{ name: 'mysubmit', value: 'Screenshot' }],
      timeoutMs,
    );

    this.ensureOk('Screenshot', ip, triggerResponse);

    const match = SCREENSHOT_URI_PATTERN.exec(triggerResponse.body);
    if (!match) {
      throw new Error(
        `Screenshot: no download URI in response from ${ip} — ` +
        'is the dev channel running with the screensaver off?',
      );
    }

    await this.downloadToFile(ip, port, password, `/${match[1]}`, destPath, timeoutMs);
  }

  /**
   * Downloads the device's profiling data export and saves it to `destPath`
   * (Utilities tab, "Profiling Data").
   *
   * The BrightScript profiler only produces data when the running channel's
   * `manifest` opts in (`bsprof_enable=1`, `bsprof_data_dest=local`/`network`
   * — see https://developer.roku.com/dev/docs/brightscript-profiler#manifest-entries).
   *
   * NOT YET EMPIRICALLY VERIFIED against a real device: neither reference
   * implementation (bchelkowski/roku-dev, getndazn/kopytko-packager)
   * implements `mysubmit=dloadProf`. This method currently assumes the same
   * "trigger, then scrape a relative download link out of the HTML response"
   * shape as {@link takeScreenshot}/{@link packageChannel} — if the device
   * instead returns the profiling payload directly in the trigger response,
   * this will throw rather than silently write a corrupt file. Update this
   * method and `findings/roku-device-api.md` once confirmed against
   * 192.168.137.46 (see the plan's flagged unknowns).
   *
   * @throws If no recognizable download link is found in the response, or
   *   the download itself fails.
   */
  async downloadProfilingData(
    ip: string,
    password: string,
    destPath: string,
    port: number = DEFAULT_PORT,
    timeoutMs: number = DEFAULT_TIMEOUT_MS,
  ): Promise<void> {
    const response = await this.postForm(
      ip, port, password, '/plugin_inspect',
      [{ name: 'mysubmit', value: 'dloadProf' }],
      timeoutMs,
    );

    this.ensureOk('Profiling data', ip, response);

    const linkMatch = PROFILING_LINK_PATTERN.exec(response.body);
    if (!linkMatch) {
      throw new Error(
        `Profiling data: could not find a download link in the response from ${ip} — ` +
        'this response shape has not been verified against a real device yet.',
      );
    }

    await this.downloadToFile(ip, port, password, `/${linkMatch[1]}`, destPath, timeoutMs);
  }

  /**
   * Uploads (installs) a zip package, then packages it into a signed `.pkg`
   * using the given app name/version and signing password, saving the
   * result to `destPkgPath` (Packager tab).
   *
   * @param zipPath - Local path to the channel's zip archive.
   * @param appNameVersion - e.g. `"MyApp/1.0"`.
   * @param signingPassword - The developer key's signing password.
   * @throws If the upload step fails, the packaging response reports a
   *   failure, or no download link is found.
   */
  async packageChannel(
    ip: string,
    password: string,
    zipPath: string,
    appNameVersion: string,
    signingPassword: string,
    destPkgPath: string,
    port: number = DEFAULT_PORT,
    timeoutMs: number = DEFAULT_TIMEOUT_MS,
  ): Promise<void> {
    await this.installChannel(ip, password, zipPath, port, timeoutMs);

    const response = await this.postForm(
      ip, port, password, '/plugin_package',
      [
        { name: 'mysubmit', value: 'Package' },
        { name: 'app_name', value: appNameVersion },
        { name: 'passwd', value: signingPassword },
        { name: 'pkg_time', value: Date.now().toString() },
      ],
      timeoutMs,
    );

    this.ensureOk('Package', ip, response);

    const failureMatch = PACKAGE_FAILURE_PATTERN.exec(response.body);
    if (failureMatch) {
      throw new Error(`Package failed: ${failureMatch[1].trim()}`);
    }

    const linkMatch = PACKAGE_LINK_PATTERN.exec(response.body);
    if (!linkMatch) {
      throw new Error(`Package: unexpected response from ${ip}`);
    }

    await this.downloadToFile(ip, port, password, `/${linkMatch[1]}`, destPkgPath, timeoutMs);
  }

  /**
   * Triggers a device OS update check (Update tab, "Check for Update").
   */
  async checkForUpdate(
    ip: string,
    password: string,
    port: number = DEFAULT_PORT,
    timeoutMs: number = DEFAULT_TIMEOUT_MS,
  ): Promise<void> {
    const response = await this.postForm(
      ip, port, password, '/plugin_swup',
      [{ name: 'mysubmit', value: 'CheckUpdate' }],
      timeoutMs,
    );

    this.ensureOk('Check for update', ip, response);
  }

  /**
   * Reboots the device (Update tab, "Reboot").
   *
   * Confirmed live: on the tested device the reboot completes fast enough
   * that the HTTP response is still delivered normally (HTTP 200) before the
   * restart — uptime reset and the dev channel survived. As a defensive
   * fallback for firmware that instead drops the connection mid-restart, a
   * connection-reset-shaped network error during this call is also treated
   * as success. Genuine failures (e.g. a persistent 401 for a bad password)
   * still throw.
   */
  async reboot(
    ip: string,
    password: string,
    port: number = DEFAULT_PORT,
    timeoutMs: number = DEFAULT_TIMEOUT_MS,
  ): Promise<void> {
    try {
      const response = await this.postForm(
        ip, port, password, '/plugin_swup',
        [{ name: 'mysubmit', value: 'Reboot' }],
        timeoutMs,
      );

      this.ensureOk('Reboot', ip, response);
    } catch (err) {
      if (isConnectionResetError(err)) return;
      throw err;
    }
  }

  private async postForm(
    ip: string,
    port: number,
    password: string,
    path: string,
    fields: MultipartField[],
    timeoutMs: number,
  ): Promise<HttpGetResponse> {
    const url = `http://${ip}:${port}${path}`;
    return httpPostMultipartDigest(url, USERNAME, password, fields, timeoutMs);
  }

  private async downloadToFile(
    ip: string,
    port: number,
    password: string,
    path: string,
    destPath: string,
    timeoutMs: number,
  ): Promise<void> {
    const url = `http://${ip}:${port}${path}`;
    const { statusCode, body } = await httpGetBufferDigest(url, USERNAME, password, timeoutMs);

    if (statusCode !== 200) {
      throw new Error(`Download from ${ip}${path} failed: status ${statusCode}`);
    }

    await fs.writeFile(destPath, body);
  }

  private async readFileOrThrow(filePath: string): Promise<Buffer> {
    try {
      return await fs.readFile(filePath);
    } catch (err) {
      throw new Error(`Failed to read file at ${filePath}: ${(err as Error).message}`);
    }
  }

  /**
   * Verifies a response represents success. Beyond the HTTP status (a failed
   * `/plugin_install` action still returns 200 — confirmed live), this also
   * checks the embedded `params.messages` array for a `type: "error"` entry,
   * which is the real failure signal.
   */
  private ensureOk(action: string, ip: string, response: HttpGetResponse): void {
    if (response.statusCode === 401) {
      throw new Error(`Authentication failed for rokudev at ${ip} — check the developer password`);
    }

    if (response.statusCode < 200 || response.statusCode >= 300) {
      const detail = response.body.trim();
      throw new Error(`${action} failed: status ${response.statusCode}${detail ? ` — ${detail}` : ''}`);
    }

    const errorMessage = extractWebAdminMessages(response.body)?.find((message) => message.type === 'error');
    if (errorMessage) {
      throw new Error(`${action} failed: ${errorMessage.text}`);
    }
  }
}

export default InstallerClient;
