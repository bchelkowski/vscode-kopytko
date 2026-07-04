import { expect } from 'chai';
import * as http from 'http';
import { AddressInfo } from 'net';
import {
  httpGetBufferDigest,
  httpPostMultipartDigest,
  buildMultipartBody,
} from '../../src/net/httpClient';

function createTestServer(
  handler: (req: http.IncomingMessage, res: http.ServerResponse) => void,
): Promise<{ server: http.Server; port: number }> {
  return new Promise((resolve) => {
    const server = http.createServer(handler);
    server.listen(0, '127.0.0.1', () => {
      const port = (server.address() as AddressInfo).port;
      resolve({ server, port });
    });
  });
}

function closeServer(server: http.Server): Promise<void> {
  return new Promise((resolve) => server.close(() => resolve()));
}

function readRawBody(req: http.IncomingMessage): Promise<Buffer> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks)));
  });
}

const DIGEST_CHALLENGE = 'Digest realm="rokudev", nonce="abc123", algorithm=MD5';
const DIGEST_CHALLENGE_QOP = 'Digest qop="auth", realm="rokudev", nonce="abcdef12"';

describe('httpClient — multipart + digest primitives', () => {
  describe('buildMultipartBody', () => {
    it('encodes string fields and a binary-safe file field', () => {
      const fileBytes = Buffer.from([0x00, 0xff, 0x10, 0x80, 0x7f]);
      const body = buildMultipartBody(
        [
          { name: 'mysubmit', value: 'Install' },
          { name: 'archive', file: { filename: 'archive.zip', contentType: 'application/octet-stream', data: fileBytes } },
        ],
        'BOUNDARY123',
      );

      const text = body.toString('latin1');
      expect(text).to.include('--BOUNDARY123');
      expect(text).to.include('Content-Disposition: form-data; name="mysubmit"');
      expect(text).to.include('Install');
      expect(text).to.include('filename="archive.zip"');
      expect(text).to.include('Content-Type: application/octet-stream');
      expect(text).to.include('--BOUNDARY123--');
      expect(body.includes(fileBytes)).to.be.true;
    });
  });

  describe('httpPostMultipartDigest', () => {
    it('sends no body on the first (expected-401) attempt', async () => {
      let firstRequestBodyLength = -1;
      let callCount = 0;
      const { server, port } = await createTestServer(async (req, res) => {
        callCount++;
        const raw = await readRawBody(req);
        if (callCount === 1) {
          firstRequestBodyLength = raw.length;
          res.writeHead(401, { 'WWW-Authenticate': DIGEST_CHALLENGE });
          res.end();
        } else {
          res.writeHead(200);
          res.end('OK');
        }
      });

      try {
        await httpPostMultipartDigest(
          `http://127.0.0.1:${port}/plugin_install`,
          'rokudev',
          'mypassword',
          [{ name: 'mysubmit', value: 'Delete' }],
          5000,
        );

        expect(firstRequestBodyLength).to.equal(0);
      } finally {
        await closeServer(server);
      }
    });

    it('delivers the full multipart body — including binary file bytes — exactly once on the authenticated retry', async () => {
      const fileBytes = Buffer.from([0x00, 0xff, 0xd8, 0xff, 0x10, 0x80]);
      let callCount = 0;
      let totalOccurrencesOfFileBytes = 0;
      let secondRequestBody = '';

      const countOccurrences = (haystack: Buffer, needle: Buffer): number => {
        let count = 0;
        let index = haystack.indexOf(needle);
        while (index !== -1) {
          count++;
          index = haystack.indexOf(needle, index + needle.length);
        }
        return count;
      };

      const { server, port } = await createTestServer(async (req, res) => {
        callCount++;
        const raw = await readRawBody(req);
        totalOccurrencesOfFileBytes += countOccurrences(raw, fileBytes);

        if (callCount === 1) {
          res.writeHead(401, { 'WWW-Authenticate': DIGEST_CHALLENGE });
          res.end();
        } else {
          secondRequestBody = raw.toString('latin1');
          res.writeHead(200);
          res.end('Install Success.');
        }
      });

      try {
        const response = await httpPostMultipartDigest(
          `http://127.0.0.1:${port}/plugin_install`,
          'rokudev',
          'mypassword',
          [
            { name: 'mysubmit', value: 'Install' },
            { name: 'archive', file: { filename: 'archive.zip', contentType: 'application/octet-stream', data: fileBytes } },
          ],
          5000,
        );

        expect(callCount).to.equal(2);
        expect(response.statusCode).to.equal(200);
        expect(response.body).to.equal('Install Success.');
        expect(secondRequestBody).to.include('name="mysubmit"');
        // The file payload must be delivered exactly once across both requests
        // combined — not zero (dropped on retry), not twice (re-streamed).
        expect(totalOccurrencesOfFileBytes).to.equal(1);
      } finally {
        await closeServer(server);
      }
    });

    it('handles qop="auth" digest challenge with cnonce and nc', async () => {
      let callCount = 0;
      let authHeader = '';
      const { server, port } = await createTestServer(async (req, res) => {
        callCount++;
        await readRawBody(req);
        if (callCount === 1) {
          res.writeHead(401, { 'WWW-Authenticate': DIGEST_CHALLENGE_QOP });
          res.end();
        } else {
          authHeader = req.headers.authorization || '';
          res.writeHead(200);
          res.end('OK');
        }
      });

      try {
        await httpPostMultipartDigest(
          `http://127.0.0.1:${port}/plugin_install`,
          'rokudev',
          'rokudev',
          [{ name: 'mysubmit', value: 'Delete' }],
          5000,
        );

        expect(callCount).to.equal(2);
        expect(authHeader).to.include('qop=auth');
        expect(authHeader).to.include('cnonce=');
        expect(authHeader).to.include('nc=');
      } finally {
        await closeServer(server);
      }
    });

    it('throws when the authenticated retry still returns 401 (wrong password)', async () => {
      const { server, port } = await createTestServer(async (req, res) => {
        await readRawBody(req);
        res.writeHead(401, { 'WWW-Authenticate': DIGEST_CHALLENGE });
        res.end();
      });

      try {
        const response = await httpPostMultipartDigest(
          `http://127.0.0.1:${port}/plugin_install`,
          'rokudev',
          'wrongpassword',
          [{ name: 'mysubmit', value: 'Delete' }],
          5000,
        );

        expect(response.statusCode).to.equal(401);
      } finally {
        await closeServer(server);
      }
    });

    it('rejects when the challenge response has no WWW-Authenticate header', async () => {
      const { server, port } = await createTestServer((_req, res) => {
        res.writeHead(401);
        res.end();
      });

      try {
        let threw = false;
        try {
          await httpPostMultipartDigest(
            `http://127.0.0.1:${port}/plugin_install`,
            'rokudev',
            'password',
            [{ name: 'mysubmit', value: 'Delete' }],
            5000,
          );
        } catch {
          threw = true;
        }
        expect(threw).to.be.true;
      } finally {
        await closeServer(server);
      }
    });

    it('sends only one request when the first response is not a 401', async () => {
      let callCount = 0;
      const { server, port } = await createTestServer((_req, res) => {
        callCount++;
        res.writeHead(200);
        res.end('OK');
      });

      try {
        const response = await httpPostMultipartDigest(
          `http://127.0.0.1:${port}/plugin_install`,
          'rokudev',
          'password',
          [{ name: 'mysubmit', value: 'Delete' }],
          5000,
        );

        expect(response.statusCode).to.equal(200);
        expect(callCount).to.equal(1);
      } finally {
        await closeServer(server);
      }
    });

    it('rejects on timeout', async () => {
      const { server, port } = await createTestServer(() => {
        // never responds
      });

      try {
        let threw = false;
        try {
          await httpPostMultipartDigest(
            `http://127.0.0.1:${port}/plugin_install`,
            'rokudev',
            'password',
            [{ name: 'mysubmit', value: 'Delete' }],
            200,
          );
        } catch (err) {
          threw = true;
          expect((err as Error).message).to.include('timed out');
        }
        expect(threw).to.be.true;
      } finally {
        await closeServer(server);
      }
    });
  });

  describe('httpGetBufferDigest', () => {
    it('performs the 401-then-retry dance and returns binary bytes', async () => {
      const jpegBytes = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x80]);
      let callCount = 0;

      const { server, port } = await createTestServer((req, res) => {
        callCount++;
        if (callCount === 1) {
          res.writeHead(401, { 'WWW-Authenticate': DIGEST_CHALLENGE });
          res.end();
        } else {
          expect(req.headers.authorization).to.include('Digest');
          res.writeHead(200, { 'Content-Type': 'image/jpeg' });
          res.end(jpegBytes);
        }
      });

      try {
        const response = await httpGetBufferDigest(
          `http://127.0.0.1:${port}/pkgs/dev.jpg?time=123`,
          'rokudev',
          'mypassword',
          5000,
        );

        expect(callCount).to.equal(2);
        expect(response.statusCode).to.equal(200);
        expect(Buffer.compare(response.body, jpegBytes)).to.equal(0);
      } finally {
        await closeServer(server);
      }
    });

    it('returns the response directly when no auth challenge is issued', async () => {
      const { server, port } = await createTestServer((_req, res) => {
        res.writeHead(200);
        res.end('unauthenticated ok');
      });

      try {
        const response = await httpGetBufferDigest(
          `http://127.0.0.1:${port}/pkgs/dev.jpg?time=123`,
          'rokudev',
          'mypassword',
          5000,
        );

        expect(response.statusCode).to.equal(200);
        expect(response.body.toString()).to.equal('unauthenticated ok');
      } finally {
        await closeServer(server);
      }
    });
  });
});
