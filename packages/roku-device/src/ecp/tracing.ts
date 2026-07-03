import * as http from 'http';

const DEFAULT_PORT = 8060;
const REQUEST_TIMEOUT_MS = 5000;

/**
 * Sends a POST request to a Roku ECP tracing endpoint and returns the raw
 * response body.  Throws on HTTP errors (non-2xx) or network failures.
 */
function ecpPost(host: string, port: number, path: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { method: 'POST', host, port, path, timeout: REQUEST_TIMEOUT_MS },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => {
          const body = Buffer.concat(chunks).toString('utf-8');
          if ((res.statusCode ?? 0) >= 400) {
            reject(new Error(`ECP ${path} returned ${res.statusCode}: ${body.slice(0, 200)}`));
          } else {
            resolve(body);
          }
        });
      },
    );
    req.on('timeout', () => {
      req.destroy();
      reject(new Error(`ECP ${path} timed out`));
    });
    req.on('error', reject);
    req.end();
  });
}

/**
 * Enables Perfetto app tracing on the Roku device for the given channel.
 * Requires firmware 15.2+.  Throws if the device rejects the request.
 */
export async function enablePerfettoTracing(
  host: string,
  channelId = 'dev',
  port = DEFAULT_PORT,
): Promise<void> {
  await ecpPost(host, port, `/perfetto/enable/${channelId}`);
}

/**
 * Triggers a heap snapshot capture for the given channel.
 * Tracing must already be active.
 */
export async function triggerHeapSnapshot(
  host: string,
  channelId = 'dev',
  port = DEFAULT_PORT,
): Promise<void> {
  await ecpPost(host, port, `/perfetto/heapgraph/trigger/${channelId}`);
}
