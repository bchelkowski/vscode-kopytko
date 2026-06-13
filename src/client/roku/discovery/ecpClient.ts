import * as http from 'http';
import * as crypto from 'crypto';

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
 * Performs an HTTP GET request and resolves with the status code and response body.
 */
function httpGet(
  url: string,
  timeoutMs: number,
  headers?: Record<string, string>,
): Promise<{ statusCode: number; body: string; headers: http.IncomingHttpHeaders }> {
  return new Promise((resolve, reject) => {
    const req = http.get(url, { headers, timeout: timeoutMs }, (res) => {
      let body = '';
      res.on('data', (chunk: Buffer) => { body += chunk.toString(); });
      res.on('end', () => {
        resolve({ statusCode: res.statusCode ?? 0, body, headers: res.headers });
      });
    });

    req.on('timeout', () => {
      req.destroy();
      reject(new Error(`Request to ${url} timed out after ${timeoutMs}ms`));
    });

    req.on('error', (err) => {
      reject(err);
    });
  });
}

/**
 * Computes an MD5 hex digest of the given string.
 */
function md5(data: string): string {
  return crypto.createHash('md5').update(data).digest('hex');
}

/**
 * Parses a `WWW-Authenticate: Digest ...` header into its key-value parameters.
 */
function parseDigestChallenge(header: string): Record<string, string> {
  const params: Record<string, string> = {};
  const paramPattern = /(\w+)="([^"]*?)"/g;
  let match: RegExpExecArray | null;

  while ((match = paramPattern.exec(header)) !== null) {
    params[match[1]] = match[2];
  }

  return params;
}

/**
 * Builds an HTTP Digest Authorization header value.
 *
 * Supports both qop="auth" (RFC 2617 full form with cnonce/nc) and the
 * legacy form without qop. Roku devices use qop="auth".
 *
 * @see RFC 2617 — HTTP Digest Access Authentication
 */
function buildDigestAuthHeader(
  username: string,
  password: string,
  realm: string,
  nonce: string,
  method: string,
  uri: string,
  qop?: string,
): string {
  const ha1 = md5(`${username}:${realm}:${password}`);
  const ha2 = md5(`${method}:${uri}`);

  if (qop && qop.split(',').map((q) => q.trim()).includes('auth')) {
    const cnonce = crypto.randomBytes(4).toString('hex');
    const nc = '00000001';
    const response = md5(`${ha1}:${nonce}:${nc}:${cnonce}:auth:${ha2}`);
    return (
      `Digest username="${username}", realm="${realm}", nonce="${nonce}", uri="${uri}", ` +
      `qop=auth, nc=${nc}, cnonce="${cnonce}", response="${response}"`
    );
  }

  const response = md5(`${ha1}:${nonce}:${ha2}`);
  return `Digest username="${username}", realm="${realm}", nonce="${nonce}", uri="${uri}", response="${response}"`;
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
   * Queries the device registry for a given channel.
   *
   * Sends `GET /query/registry/<channelId>` and returns the raw XML body.
   * Use `channelId = "dev"` for the sideloaded app. Requires developer mode.
   *
   * @returns The raw XML response body.
   * @throws On network errors, timeouts, or non-200 responses.
   */
  async queryRegistry(
    ip: string,
    channelId: string,
    port: number = DEFAULT_ECP_PORT,
    timeoutMs: number = DEFAULT_TIMEOUT_MS,
  ): Promise<string> {
    const url = `http://${ip}:${port}/query/registry/${encodeURIComponent(channelId)}`;
    const { statusCode, body } = await httpGet(url, timeoutMs);

    if (statusCode !== 200) {
      throw new Error(`Registry query failed: status ${statusCode}`);
    }

    return body;
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
