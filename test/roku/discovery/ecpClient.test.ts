import { expect } from 'chai';
import * as sinon from 'sinon';
import * as http from 'http';
import { EcpClient } from '../../../src/client/roku/discovery/ecpClient';
import { AddressInfo } from 'net';

/**
 * Creates a local HTTP server that responds with the given handler.
 * Returns the server and port it's listening on.
 */
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

describe('EcpClient', () => {
  let client: EcpClient;

  beforeEach(() => {
    client = new EcpClient();
  });

  afterEach(() => {
    sinon.restore();
  });

  // ---------------------------------------------------------------------------
  // queryDeviceInfo
  // ---------------------------------------------------------------------------

  describe('queryDeviceInfo', () => {
    const DEVICE_INFO_XML = [
      '<udn>unique-id</udn>',
      '<serial-number>YN00AB123456</serial-number>',
      '<friendly-device-name>Living Room Roku</friendly-device-name>',
      '<model-name>Roku Ultra</model-name>',
      '<model-number>4800X</model-number>',
      '<software-version>12.5.0</software-version>',
      '<developer-enabled>true</developer-enabled>',
      '<is-tv>false</is-tv>',
    ].join('\n');

    it('parses XML tags into a flat Record', async () => {
      const { server, port } = await createTestServer((_req, res) => {
        res.writeHead(200, { 'Content-Type': 'text/xml' });
        res.end(DEVICE_INFO_XML);
      });

      try {
        const info = await client.queryDeviceInfo('127.0.0.1', port);

        expect(info['serial-number']).to.equal('YN00AB123456');
        expect(info['friendly-device-name']).to.equal('Living Room Roku');
        expect(info['model-name']).to.equal('Roku Ultra');
        expect(info['model-number']).to.equal('4800X');
        expect(info['software-version']).to.equal('12.5.0');
        expect(info['developer-enabled']).to.equal('true');
        expect(info['is-tv']).to.equal('false');
      } finally {
        await closeServer(server);
      }
    });

    it('handles empty tag values', async () => {
      const xml = '<model-number></model-number><serial-number>ABC</serial-number>';
      const { server, port } = await createTestServer((_req, res) => {
        res.writeHead(200);
        res.end(xml);
      });

      try {
        const info = await client.queryDeviceInfo('127.0.0.1', port);

        expect(info['model-number']).to.equal('');
        expect(info['serial-number']).to.equal('ABC');
      } finally {
        await closeServer(server);
      }
    });

    it('throws on non-200 status code', async () => {
      const { server, port } = await createTestServer((_req, res) => {
        res.writeHead(500);
        res.end('Internal Server Error');
      });

      try {
        await client.queryDeviceInfo('127.0.0.1', port);
        expect.fail('should have thrown');
      } catch (err) {
        expect((err as Error).message).to.include('status 500');
      } finally {
        await closeServer(server);
      }
    });

    it('throws on timeout', async () => {
      const { server, port } = await createTestServer((_req, _res) => {
        // Never respond — let the request timeout
      });

      try {
        await client.queryDeviceInfo('127.0.0.1', port, 100);
        expect.fail('should have thrown');
      } catch (err) {
        expect((err as Error).message).to.include('timed out');
      } finally {
        await closeServer(server);
      }
    });

    it('throws on connection error', async () => {
      // Use a port that's not listening
      try {
        await client.queryDeviceInfo('127.0.0.1', 1, 500);
        expect.fail('should have thrown');
      } catch (err) {
        expect(err).to.be.instanceOf(Error);
      }
    });

    it('queries the correct URL path', async () => {
      let requestedUrl = '';
      const { server, port } = await createTestServer((req, res) => {
        requestedUrl = req.url || '';
        res.writeHead(200);
        res.end('<device-info><serial-number>X</serial-number></device-info>');
      });

      try {
        await client.queryDeviceInfo('127.0.0.1', port);
        expect(requestedUrl).to.equal('/query/device-info');
      } finally {
        await closeServer(server);
      }
    });
  });

  // ---------------------------------------------------------------------------
  // checkDeviceAlive
  // ---------------------------------------------------------------------------

  describe('checkDeviceAlive', () => {
    it('returns true on HTTP 200', async () => {
      const { server, port } = await createTestServer((_req, res) => {
        res.writeHead(200);
        res.end('OK');
      });

      try {
        const alive = await client.checkDeviceAlive('127.0.0.1', port);
        expect(alive).to.be.true;
      } finally {
        await closeServer(server);
      }
    });

    it('returns false on non-200 status', async () => {
      const { server, port } = await createTestServer((_req, res) => {
        res.writeHead(503);
        res.end('Service Unavailable');
      });

      try {
        const alive = await client.checkDeviceAlive('127.0.0.1', port);
        expect(alive).to.be.false;
      } finally {
        await closeServer(server);
      }
    });

    it('returns false on timeout', async () => {
      const { server, port } = await createTestServer((_req, _res) => {
        // Never respond
      });

      try {
        const alive = await client.checkDeviceAlive('127.0.0.1', port, 100);
        expect(alive).to.be.false;
      } finally {
        await closeServer(server);
      }
    });

    it('returns false on connection error', async () => {
      const alive = await client.checkDeviceAlive('127.0.0.1', 1, 500);
      expect(alive).to.be.false;
    });
  });

  // ---------------------------------------------------------------------------
  // validatePassword
  // ---------------------------------------------------------------------------

  describe('validatePassword', () => {
    it('returns true on successful digest auth', async () => {
      let callCount = 0;
      const { server, port } = await createTestServer((req, res) => {
        callCount++;
        if (callCount === 1) {
          res.writeHead(401, {
            'WWW-Authenticate': 'Digest realm="rokudev", nonce="abc123", algorithm=MD5',
          });
          res.end('Unauthorized');
        } else {
          expect(req.headers.authorization).to.include('Digest');
          res.writeHead(200);
          res.end('OK');
        }
      });

      try {
        const valid = await client.validatePassword('127.0.0.1', 'mypassword', port);
        expect(valid).to.be.true;
        expect(callCount).to.equal(2);
      } finally {
        await closeServer(server);
      }
    });

    it('returns false when auth response is 401 (wrong password)', async () => {
      const { server, port } = await createTestServer((_req, res) => {
        res.writeHead(401, {
          'WWW-Authenticate': 'Digest realm="rokudev", nonce="abc123", algorithm=MD5',
        });
        res.end('Unauthorized');
      });

      try {
        const valid = await client.validatePassword('127.0.0.1', 'wrongpassword', port);
        expect(valid).to.be.false;
      } finally {
        await closeServer(server);
      }
    });

    it('returns true if initial response is already 200 (no auth required)', async () => {
      const { server, port } = await createTestServer((_req, res) => {
        res.writeHead(200);
        res.end('OK');
      });

      try {
        const valid = await client.validatePassword('127.0.0.1', 'anypassword', port);
        expect(valid).to.be.true;
      } finally {
        await closeServer(server);
      }
    });

    it('returns false if www-authenticate header is missing', async () => {
      const { server, port } = await createTestServer((_req, res) => {
        res.writeHead(401);
        res.end('Unauthorized');
      });

      try {
        const valid = await client.validatePassword('127.0.0.1', 'password', port);
        expect(valid).to.be.false;
      } finally {
        await closeServer(server);
      }
    });

    it('returns false if www-authenticate is not digest', async () => {
      const { server, port } = await createTestServer((_req, res) => {
        res.writeHead(401, { 'WWW-Authenticate': 'Basic realm="rokudev"' });
        res.end('Unauthorized');
      });

      try {
        const valid = await client.validatePassword('127.0.0.1', 'password', port);
        expect(valid).to.be.false;
      } finally {
        await closeServer(server);
      }
    });

    it('returns false if digest challenge is missing realm or nonce', async () => {
      const { server, port } = await createTestServer((_req, res) => {
        res.writeHead(401, { 'WWW-Authenticate': 'Digest algorithm=MD5' });
        res.end('Unauthorized');
      });

      try {
        const valid = await client.validatePassword('127.0.0.1', 'password', port);
        expect(valid).to.be.false;
      } finally {
        await closeServer(server);
      }
    });

    it('returns false on connection error', async () => {
      const valid = await client.validatePassword('127.0.0.1', 'password', 1);
      expect(valid).to.be.false;
    });

    it('sends correct digest Authorization header on retry', async () => {
      let authHeader = '';
      let callCount = 0;
      const { server, port } = await createTestServer((req, res) => {
        callCount++;
        if (callCount === 1) {
          res.writeHead(401, {
            'WWW-Authenticate': 'Digest realm="rokudev", nonce="abc123", algorithm=MD5',
          });
          res.end();
        } else {
          authHeader = req.headers.authorization || '';
          res.writeHead(200);
          res.end('OK');
        }
      });

      try {
        await client.validatePassword('127.0.0.1', 'mypassword', port);

        expect(authHeader).to.include('username="rokudev"');
        expect(authHeader).to.include('realm="rokudev"');
        expect(authHeader).to.include('nonce="abc123"');
        expect(authHeader).to.include('response=');
      } finally {
        await closeServer(server);
      }
    });
  });
});
