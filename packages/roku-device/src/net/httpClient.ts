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
