import * as crypto from 'crypto';
import * as http from 'http';

export interface HttpGetResponse {
  statusCode: number;
  body: string;
  headers: http.IncomingHttpHeaders;
}

/** Performs an HTTP POST request and resolves with the status code and response body. */
export function httpPost(
  url: string,
  timeoutMs: number,
  body?: string,
  headers?: Record<string, string>,
): Promise<HttpGetResponse> {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(url);
    const options: http.RequestOptions = {
      hostname: parsedUrl.hostname,
      port: parsedUrl.port,
      path: parsedUrl.pathname + parsedUrl.search,
      method: 'POST',
      headers: { ...headers },
      timeout: timeoutMs,
    };

    if (body) {
      options.headers = {
        ...options.headers,
        'Content-Length': Buffer.byteLength(body).toString(),
      };
    }

    const req = http.request(options, (res) => {
      let responseBody = '';
      res.on('data', (chunk: Buffer) => { responseBody += chunk.toString(); });
      res.on('end', () => {
        resolve({ statusCode: res.statusCode ?? 0, body: responseBody, headers: res.headers });
      });
    });

    req.on('timeout', () => {
      req.destroy();
      reject(new Error(`Request to ${url} timed out after ${timeoutMs}ms`));
    });

    req.on('error', (err) => {
      reject(err);
    });

    if (body) {
      req.write(body);
    }
    req.end();
  });
}

/** Performs an HTTP GET request and resolves with the status code and response body. */
export function httpGet(
  url: string,
  timeoutMs: number,
  headers?: Record<string, string>,
): Promise<HttpGetResponse> {
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

export interface HttpBufferResponse {
  statusCode: number;
  body: Buffer;
  headers: http.IncomingHttpHeaders;
}

/**
 * Performs an HTTP GET request and resolves with the raw response bytes.
 * Use instead of {@link httpGet} for binary payloads (e.g. channel icons) —
 * string concatenation would corrupt multi-byte sequences.
 */
export function httpGetBuffer(
  url: string,
  timeoutMs: number,
  headers?: Record<string, string>,
): Promise<HttpBufferResponse> {
  return new Promise((resolve, reject) => {
    const req = http.get(url, { headers, timeout: timeoutMs }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => { chunks.push(chunk); });
      res.on('end', () => {
        resolve({ statusCode: res.statusCode ?? 0, body: Buffer.concat(chunks), headers: res.headers });
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

function md5(data: string): string {
  return crypto.createHash('md5').update(data).digest('hex');
}

/** Parses a `WWW-Authenticate: Digest ...` header into its key-value parameters. */
export function parseDigestChallenge(header: string): Record<string, string> {
  const params: Record<string, string> = {};
  const paramPattern = /(\w+)="([^"]*?)"/g;
  let match: RegExpExecArray | null;

  while ((match = paramPattern.exec(header)) !== null) {
    params[match[1]] = match[2];
  }

  return params;
}

/** Builds an HTTP Digest Authorization header value. */
export function buildDigestAuthHeader(
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

export interface MultipartField {
  name: string;
  /** String field value. Mutually exclusive with `file`. */
  value?: string;
  /** File payload. Mutually exclusive with `value`. */
  file?: { filename: string; contentType: string; data: Buffer };
}

/**
 * Builds a `multipart/form-data` request body from a list of fields.
 * File field bytes are copied verbatim — binary-safe.
 */
export function buildMultipartBody(fields: MultipartField[], boundary: string): Buffer {
  const parts: Buffer[] = [];

  for (const field of fields) {
    parts.push(Buffer.from(`--${boundary}\r\n`));

    if (field.file) {
      parts.push(Buffer.from(
        `Content-Disposition: form-data; name="${field.name}"; filename="${field.file.filename}"\r\n` +
        `Content-Type: ${field.file.contentType}\r\n\r\n`,
      ));
      parts.push(field.file.data);
      parts.push(Buffer.from('\r\n'));
    } else {
      parts.push(Buffer.from(
        `Content-Disposition: form-data; name="${field.name}"\r\n\r\n${field.value ?? ''}\r\n`,
      ));
    }
  }

  parts.push(Buffer.from(`--${boundary}--\r\n`));

  return Buffer.concat(parts);
}

/** Performs a raw HTTP request with an optional binary body, resolving with the raw response bytes. */
function rawRequest(
  options: http.RequestOptions,
  bodyBuffer?: Buffer,
): Promise<HttpBufferResponse> {
  return new Promise((resolve, reject) => {
    const req = http.request(options, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => { chunks.push(chunk); });
      res.on('end', () => {
        resolve({ statusCode: res.statusCode ?? 0, body: Buffer.concat(chunks), headers: res.headers });
      });
    });

    req.on('timeout', () => {
      req.destroy();
      reject(new Error(`Request to ${options.path} timed out after ${options.timeout}ms`));
    });

    req.on('error', (err) => {
      reject(err);
    });

    if (bodyBuffer) {
      req.write(bodyBuffer);
    }
    req.end();
  });
}

/**
 * Performs the Roku developer web-admin's digest-auth handshake for a single
 * request, replicating the "no body on the first (expected-401) challenge
 * request, full body only on the authenticated retry" behavior of the
 * reference `roku-dev` CLI — this avoids ever sending a large file body
 * twice, since the challenge response never depends on the request body.
 *
 * If the first attempt is not a 401 (e.g. the endpoint doesn't require auth),
 * that response is returned as-is and no second request is sent.
 */
async function requestWithDigestAuth(
  method: 'GET' | 'POST',
  url: string,
  username: string,
  password: string,
  timeoutMs: number,
  authenticatedBody?: Buffer,
  authenticatedHeaders?: Record<string, string>,
): Promise<HttpBufferResponse> {
  const parsedUrl = new URL(url);
  const uri = (parsedUrl.pathname || '/') + parsedUrl.search;
  const baseOptions: http.RequestOptions = {
    hostname: parsedUrl.hostname,
    port: parsedUrl.port,
    path: uri,
    method,
    timeout: timeoutMs,
  };

  const challenge = await rawRequest(baseOptions);

  if (challenge.statusCode !== 401) {
    return challenge;
  }

  const wwwAuth = challenge.headers['www-authenticate'];

  if (!wwwAuth || !wwwAuth.toLowerCase().includes('digest')) {
    throw new Error(`Digest auth challenge missing or unsupported at ${url}`);
  }

  const { realm, nonce, qop } = parseDigestChallenge(wwwAuth);

  if (!realm || !nonce) {
    throw new Error(`Digest auth challenge from ${url} is missing realm or nonce`);
  }

  const authHeader = buildDigestAuthHeader(username, password, realm, nonce, method, uri, qop);
  const headers: Record<string, string> = { Authorization: authHeader, ...authenticatedHeaders };

  if (authenticatedBody) {
    headers['Content-Length'] = authenticatedBody.length.toString();
  }

  return rawRequest({ ...baseOptions, headers }, authenticatedBody);
}

/**
 * Performs a digest-auth-protected `multipart/form-data` POST — the Roku
 * developer web-admin's Installer/Utilities/Packager/Update tabs (port 80,
 * username always `rokudev`).
 *
 * @see requestWithDigestAuth for the no-body-on-first-attempt auth handshake.
 */
export async function httpPostMultipartDigest(
  url: string,
  username: string,
  password: string,
  fields: MultipartField[],
  timeoutMs: number,
): Promise<HttpGetResponse> {
  const boundary = `----RokuDeviceFormBoundary${crypto.randomBytes(16).toString('hex')}`;
  const bodyBuffer = buildMultipartBody(fields, boundary);
  const contentType = `multipart/form-data; boundary=${boundary}`;

  const { statusCode, body, headers } = await requestWithDigestAuth(
    'POST',
    url,
    username,
    password,
    timeoutMs,
    bodyBuffer,
    { 'Content-Type': contentType },
  );

  return { statusCode, body: body.toString('utf8'), headers };
}

/**
 * Performs a digest-auth-protected GET for binary payloads (e.g. the
 * screenshot JPEG or signed `.pkg` downloads from the Roku developer
 * web-admin). GET analogue of {@link httpPostMultipartDigest}.
 */
export function httpGetBufferDigest(
  url: string,
  username: string,
  password: string,
  timeoutMs: number,
): Promise<HttpBufferResponse> {
  return requestWithDigestAuth('GET', url, username, password, timeoutMs);
}
