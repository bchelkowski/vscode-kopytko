import { expect } from 'chai';
import * as sinon from 'sinon';
import * as http from 'http';
import { EcpClient, buildEcpQueryString, parseAppsXml, parseActiveAppXml, parseMediaPlayerXml } from '../../src/ecp/ecpClient';
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
      '<?xml version="1.0" encoding="UTF-8" ?>',
      '<device-info>',
      '  <udn>unique-id</udn>',
      '  <serial-number>YN00AB123456</serial-number>',
      '  <device-id>AA:BB:CC:DD:EE:FF</device-id>',
      '  <friendly-device-name>Living Room Roku</friendly-device-name>',
      '  <user-device-name>Living Room TV</user-device-name>',
      '  <model-name>Roku Ultra</model-name>',
      '  <model-number>4800X</model-number>',
      '  <software-version>12.5.0</software-version>',
      '  <software-build>4200.45</software-build>',
      '  <developer-enabled>true</developer-enabled>',
      '  <keyed-developer-id>devid-YN00AB123456</keyed-developer-id>',
      '  <ecp-setting-mode>default</ecp-setting-mode>',
      '  <ui-resolution>1080p</ui-resolution>',
      '  <locale>en_US</locale>',
      '  <time-zone>United States/Eastern</time-zone>',
      '  <time-zone-offset>-300</time-zone-offset>',
      '  <is-tv>false</is-tv>',
      '</device-info>',
    ].join('\n');

    it('parses XML tags from a wrapped device-info response', async () => {
      const { server, port } = await createTestServer((_req, res) => {
        res.writeHead(200, { 'Content-Type': 'text/xml' });
        res.end(DEVICE_INFO_XML);
      });

      try {
        const info = await client.queryDeviceInfo('127.0.0.1', port);

        expect(info['serial-number']).to.equal('YN00AB123456');
        expect(info['device-id']).to.equal('AA:BB:CC:DD:EE:FF');
        expect(info['friendly-device-name']).to.equal('Living Room Roku');
        expect(info['user-device-name']).to.equal('Living Room TV');
        expect(info['model-name']).to.equal('Roku Ultra');
        expect(info['model-number']).to.equal('4800X');
        expect(info['software-version']).to.equal('12.5.0');
        expect(info['software-build']).to.equal('4200.45');
        expect(info['developer-enabled']).to.equal('true');
        expect(info['keyed-developer-id']).to.equal('devid-YN00AB123456');
        expect(info['ecp-setting-mode']).to.equal('default');
        expect(info['ui-resolution']).to.equal('1080p');
        expect(info['locale']).to.equal('en_US');
        expect(info['time-zone']).to.equal('United States/Eastern');
        expect(info['time-zone-offset']).to.equal('-300');
        expect(info['is-tv']).to.equal('false');
      } finally {
        await closeServer(server);
      }
    });

    it('does not include the outer device-info container tag in the result', async () => {
      const { server, port } = await createTestServer((_req, res) => {
        res.writeHead(200, { 'Content-Type': 'text/xml' });
        res.end(DEVICE_INFO_XML);
      });

      try {
        const info = await client.queryDeviceInfo('127.0.0.1', port);
        expect(info['device-info']).to.be.undefined;
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

    it('handles qop="auth" digest challenge (Roku real-device flow)', async () => {
      let authHeader = '';
      let callCount = 0;
      const { server, port } = await createTestServer((req, res) => {
        callCount++;
        if (callCount === 1) {
          // Real Roku devices send qop="auth" which requires cnonce + nc
          res.writeHead(401, {
            'WWW-Authenticate': 'Digest qop="auth", realm="rokudev", nonce="abcdef12"',
          });
          res.end();
        } else {
          authHeader = req.headers.authorization || '';
          res.writeHead(200);
          res.end('OK');
        }
      });

      try {
        const valid = await client.validatePassword('127.0.0.1', 'rokudev', port);
        expect(valid).to.be.true;
        expect(callCount).to.equal(2);
        expect(authHeader).to.include('qop=auth');
        expect(authHeader).to.include('cnonce=');
        expect(authHeader).to.include('nc=');
        expect(authHeader).to.include('username="rokudev"');
        expect(authHeader).to.include('realm="rokudev"');
        expect(authHeader).to.include('response=');
      } finally {
        await closeServer(server);
      }
    });

    it('returns false when qop="auth" auth response is 401 (wrong password)', async () => {
      const { server, port } = await createTestServer((_req, res) => {
        res.writeHead(401, {
          'WWW-Authenticate': 'Digest qop="auth", realm="rokudev", nonce="abcdef12"',
        });
        res.end();
      });

      try {
        const valid = await client.validatePassword('127.0.0.1', 'wrongpassword', port);
        expect(valid).to.be.false;
      } finally {
        await closeServer(server);
      }
    });
  });

  // ---------------------------------------------------------------------------
  // queryApps
  // ---------------------------------------------------------------------------

  describe('queryApps', () => {
    const APPS_XML = [
      '<?xml version="1.0" encoding="UTF-8" ?>',
      '<apps>',
      '  <app id="12" type="appl" version="70.2316.0">Netflix</app>',
      '  <app id="551012" type="appl" version="16.2.82">Apple TV</app>',
      '  <app id="dev" type="appl" version="3.30.3">My App</app>',
      '</apps>',
    ].join('\n');

    it('queries the correct URL path', async () => {
      let requestedUrl = '';
      const { server, port } = await createTestServer((req, res) => {
        requestedUrl = req.url || '';
        res.writeHead(200);
        res.end(APPS_XML);
      });

      try {
        await client.queryApps('127.0.0.1', port);
        expect(requestedUrl).to.equal('/query/apps');
      } finally {
        await closeServer(server);
      }
    });

    it('parses the apps list from XML', async () => {
      const { server, port } = await createTestServer((_req, res) => {
        res.writeHead(200);
        res.end(APPS_XML);
      });

      try {
        const apps = await client.queryApps('127.0.0.1', port);
        expect(apps).to.have.length(3);
        expect(apps[0]).to.deep.equal({ id: '12', name: 'Netflix', type: 'appl', version: '70.2316.0' });
        expect(apps[2]).to.deep.equal({ id: 'dev', name: 'My App', type: 'appl', version: '3.30.3' });
      } finally {
        await closeServer(server);
      }
    });

    it('returns empty array for no apps', async () => {
      const { server, port } = await createTestServer((_req, res) => {
        res.writeHead(200);
        res.end('<apps></apps>');
      });

      try {
        const apps = await client.queryApps('127.0.0.1', port);
        expect(apps).to.have.length(0);
      } finally {
        await closeServer(server);
      }
    });

    it('throws on non-200 status code', async () => {
      const { server, port } = await createTestServer((_req, res) => {
        res.writeHead(500);
        res.end('Error');
      });

      try {
        await client.queryApps('127.0.0.1', port);
        expect.fail('should have thrown');
      } catch (err) {
        expect((err as Error).message).to.include('status 500');
      } finally {
        await closeServer(server);
      }
    });
  });

  // ---------------------------------------------------------------------------
  // launchApp
  // ---------------------------------------------------------------------------

  describe('launchApp', () => {
    it('POSTs to /launch/{appId} with encoded query parameters', async () => {
      let requestedUrl = '';
      let requestedMethod = '';
      const { server, port } = await createTestServer((req, res) => {
        requestedUrl = req.url || '';
        requestedMethod = req.method || '';
        res.writeHead(200);
        res.end();
      });

      try {
        await client.launchApp('127.0.0.1', 'dev', { contentId: 'abc 123', mediaType: 'movie' }, port);
        expect(requestedMethod).to.equal('POST');
        expect(requestedUrl).to.equal('/launch/dev?contentId=abc%20123&mediaType=movie');
      } finally {
        await closeServer(server);
      }
    });

    it('omits the query string when no params are given', async () => {
      let requestedUrl = '';
      const { server, port } = await createTestServer((req, res) => {
        requestedUrl = req.url || '';
        res.writeHead(200);
        res.end();
      });

      try {
        await client.launchApp('127.0.0.1', '551012', {}, port);
        expect(requestedUrl).to.equal('/launch/551012');
      } finally {
        await closeServer(server);
      }
    });

    it('resolves on HTTP 204', async () => {
      const { server, port } = await createTestServer((_req, res) => {
        res.writeHead(204);
        res.end();
      });

      try {
        await client.launchApp('127.0.0.1', 'dev', {}, port);
      } finally {
        await closeServer(server);
      }
    });

    it('rejects with status and response body on HTTP 404', async () => {
      const { server, port } = await createTestServer((_req, res) => {
        res.writeHead(404);
        res.end('App not found');
      });

      try {
        await client.launchApp('127.0.0.1', '999999', {}, port);
        expect.fail('should have thrown');
      } catch (err) {
        expect((err as Error).message).to.include('status 404');
        expect((err as Error).message).to.include('App not found');
      } finally {
        await closeServer(server);
      }
    });

    it('rejects without a dangling separator when the error body is empty', async () => {
      const { server, port } = await createTestServer((_req, res) => {
        res.writeHead(503);
        res.end();
      });

      try {
        await client.launchApp('127.0.0.1', 'dev', {}, port);
        expect.fail('should have thrown');
      } catch (err) {
        expect((err as Error).message).to.equal('Launch failed: status 503');
      } finally {
        await closeServer(server);
      }
    });
  });

  // ---------------------------------------------------------------------------
  // sendInput
  // ---------------------------------------------------------------------------

  describe('sendInput', () => {
    it('POSTs to /input with encoded query parameters', async () => {
      let requestedUrl = '';
      let requestedMethod = '';
      const { server, port } = await createTestServer((req, res) => {
        requestedUrl = req.url || '';
        requestedMethod = req.method || '';
        res.writeHead(200);
        res.end();
      });

      try {
        await client.sendInput('127.0.0.1', { contentId: 'id-1', mediaType: 'live' }, port);
        expect(requestedMethod).to.equal('POST');
        expect(requestedUrl).to.equal('/input?contentId=id-1&mediaType=live');
      } finally {
        await closeServer(server);
      }
    });

    it('rejects with status and body on HTTP 403 (restricted ECP)', async () => {
      const { server, port } = await createTestServer((_req, res) => {
        res.writeHead(403);
        res.end('ECP command not allowed in Limited mode.');
      });

      try {
        await client.sendInput('127.0.0.1', { contentId: 'x' }, port);
        expect.fail('should have thrown');
      } catch (err) {
        expect((err as Error).message).to.include('status 403');
        expect((err as Error).message).to.include('Limited mode');
      } finally {
        await closeServer(server);
      }
    });
  });

  // ---------------------------------------------------------------------------
  // queryAppIcon
  // ---------------------------------------------------------------------------

  describe('queryAppIcon', () => {
    // PNG magic bytes followed by a 0xFF byte that would be mangled by a
    // string round-trip — proves the transport is binary-safe.
    const ICON_BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0xff, 0x00, 0xfe]);

    it('returns the raw image bytes and content type', async () => {
      let requestedUrl = '';
      const { server, port } = await createTestServer((req, res) => {
        requestedUrl = req.url || '';
        res.writeHead(200, { 'Content-Type': 'image/png' });
        res.end(ICON_BYTES);
      });

      try {
        const icon = await client.queryAppIcon('127.0.0.1', 'dev', port);
        expect(requestedUrl).to.equal('/query/icon/dev');
        expect(icon.contentType).to.equal('image/png');
        expect(icon.data.equals(ICON_BYTES)).to.equal(true);
      } finally {
        await closeServer(server);
      }
    });

    it('falls back to image/png when Content-Type is missing', async () => {
      const { server, port } = await createTestServer((_req, res) => {
        res.writeHead(200);
        res.end(ICON_BYTES);
      });

      try {
        const icon = await client.queryAppIcon('127.0.0.1', 'dev', port);
        expect(icon.contentType).to.equal('image/png');
      } finally {
        await closeServer(server);
      }
    });

    it('rejects on non-200 status', async () => {
      const { server, port } = await createTestServer((_req, res) => {
        res.writeHead(404);
        res.end();
      });

      try {
        await client.queryAppIcon('127.0.0.1', '999999', port);
        expect.fail('should have thrown');
      } catch (err) {
        expect((err as Error).message).to.include('status 404');
      } finally {
        await closeServer(server);
      }
    });
  });

  // ---------------------------------------------------------------------------
  // queryRegistry — HTTP 202 handling
  // ---------------------------------------------------------------------------

  describe('queryRegistry', () => {
    it('returns body on HTTP 200 (success)', async () => {
      const xml = '<plugin-registry><registry><sections></sections></registry></plugin-registry>';
      const { server, port } = await createTestServer((_req, res) => {
        res.writeHead(200);
        res.end(xml);
      });

      try {
        const body = await client.queryRegistry('127.0.0.1', 'dev', port);
        expect(body).to.equal(xml);
      } finally {
        await closeServer(server);
      }
    });

    it('returns body on HTTP 202 (failed — dev ID mismatch)', async () => {
      const xml = '<plugin-registry><status>FAILED</status><error>Specified dev ID does not match the device key</error></plugin-registry>';
      const { server, port } = await createTestServer((_req, res) => {
        res.writeHead(202);
        res.end(xml);
      });

      try {
        const body = await client.queryRegistry('127.0.0.1', '12345', port);
        expect(body).to.include('FAILED');
        expect(body).to.include('does not match');
      } finally {
        await closeServer(server);
      }
    });

    it('throws on other non-200/202 status codes', async () => {
      const { server, port } = await createTestServer((_req, res) => {
        res.writeHead(500);
        res.end('Error');
      });

      try {
        await client.queryRegistry('127.0.0.1', 'dev', port);
        expect.fail('should have thrown');
      } catch (err) {
        expect((err as Error).message).to.include('status 500');
      } finally {
        await closeServer(server);
      }
    });
  });

  // ---------------------------------------------------------------------------
  // querySgNodes / querySgNodesById
  // ---------------------------------------------------------------------------

  describe('querySgNodes', () => {
    it('defaults to GET /query/sgnodes/all', async () => {
      let requestedUrl = '';
      const { server, port } = await createTestServer((req, res) => {
        requestedUrl = req.url || '';
        res.writeHead(200);
        res.end('<All_Nodes node-count="1"/>');
      });

      try {
        await client.querySgNodes('127.0.0.1', port);
        expect(requestedUrl).to.equal('/query/sgnodes/all');
      } finally {
        await closeServer(server);
      }
    });

    it('sends GET /query/sgnodes/roots when scope is "roots"', async () => {
      let requestedUrl = '';
      const { server, port } = await createTestServer((req, res) => {
        requestedUrl = req.url || '';
        res.writeHead(200);
        res.end('<Root_Nodes node-count="1"/>');
      });

      try {
        await client.querySgNodes('127.0.0.1', port, 'roots');
        expect(requestedUrl).to.equal('/query/sgnodes/roots');
      } finally {
        await closeServer(server);
      }
    });

    it('throws on non-200 status', async () => {
      const { server, port } = await createTestServer((_req, res) => {
        res.writeHead(500);
        res.end();
      });

      try {
        await client.querySgNodes('127.0.0.1', port);
        expect.fail('should have thrown');
      } catch (err) {
        expect((err as Error).message).to.include('HTTP 500');
      } finally {
        await closeServer(server);
      }
    });
  });

  describe('querySgNodesById', () => {
    it('sends GET /query/sgnodes/nodes?node-id=<id>', async () => {
      let requestedUrl = '';
      const { server, port } = await createTestServer((req, res) => {
        requestedUrl = req.url || '';
        res.writeHead(200);
        res.end('<Nodes/>');
      });

      try {
        await client.querySgNodesById('127.0.0.1', '42', port);
        expect(requestedUrl).to.equal('/query/sgnodes/nodes?node-id=42');
      } finally {
        await closeServer(server);
      }
    });

    it('throws on non-200 status', async () => {
      const { server, port } = await createTestServer((_req, res) => {
        res.writeHead(404);
        res.end();
      });

      try {
        await client.querySgNodesById('127.0.0.1', '42', port);
        expect.fail('should have thrown');
      } catch (err) {
        expect((err as Error).message).to.include('HTTP 404');
      } finally {
        await closeServer(server);
      }
    });
  });

  // ---------------------------------------------------------------------------
  // queryR2d2Bitmaps
  // ---------------------------------------------------------------------------

  describe('queryR2d2Bitmaps', () => {
    it('returns the raw XML body on HTTP 200', async () => {
      const xml = '<r2d2_bitmaps><textures usedbytes="1024"/></r2d2_bitmaps>';
      const { server, port } = await createTestServer((_req, res) => {
        res.writeHead(200);
        res.end(xml);
      });

      try {
        const body = await client.queryR2d2Bitmaps('127.0.0.1', port);
        expect(body).to.equal(xml);
      } finally {
        await closeServer(server);
      }
    });

    it('throws on non-200 status', async () => {
      const { server, port } = await createTestServer((_req, res) => {
        res.writeHead(500);
        res.end();
      });

      try {
        await client.queryR2d2Bitmaps('127.0.0.1', port);
        expect.fail('should have thrown');
      } catch (err) {
        expect((err as Error).message).to.include('HTTP 500');
      } finally {
        await closeServer(server);
      }
    });
  });

  // ---------------------------------------------------------------------------
  // queryGraphicsFrameRate
  // ---------------------------------------------------------------------------

  describe('queryGraphicsFrameRate', () => {
    it('returns the raw XML body on HTTP 200', async () => {
      const xml = '<graphics-frame-rate><fps>60</fps></graphics-frame-rate>';
      const { server, port } = await createTestServer((_req, res) => {
        res.writeHead(200);
        res.end(xml);
      });

      try {
        const body = await client.queryGraphicsFrameRate('127.0.0.1', port);
        expect(body).to.equal(xml);
      } finally {
        await closeServer(server);
      }
    });

    it('throws on non-200 status', async () => {
      const { server, port } = await createTestServer((_req, res) => {
        res.writeHead(404);
        res.end();
      });

      try {
        await client.queryGraphicsFrameRate('127.0.0.1', port);
        expect.fail('should have thrown');
      } catch (err) {
        expect((err as Error).message).to.include('HTTP 404');
      } finally {
        await closeServer(server);
      }
    });
  });

  // ---------------------------------------------------------------------------
  // queryTvChannels / queryTvActiveChannel
  // ---------------------------------------------------------------------------

  describe('queryTvChannels', () => {
    it('returns the raw XML body on HTTP 200', async () => {
      const xml = '<tv-channels><channel/></tv-channels>';
      const { server, port } = await createTestServer((_req, res) => {
        res.writeHead(200);
        res.end(xml);
      });

      try {
        const body = await client.queryTvChannels('127.0.0.1', port);
        expect(body).to.equal(xml);
      } finally {
        await closeServer(server);
      }
    });

    it('throws on non-200 status', async () => {
      const { server, port } = await createTestServer((_req, res) => {
        res.writeHead(404);
        res.end();
      });

      try {
        await client.queryTvChannels('127.0.0.1', port);
        expect.fail('should have thrown');
      } catch (err) {
        expect((err as Error).message).to.include('HTTP 404');
      } finally {
        await closeServer(server);
      }
    });
  });

  describe('queryTvActiveChannel', () => {
    it('returns the raw XML body on HTTP 200', async () => {
      const xml = '<tv-active-channel><channel/></tv-active-channel>';
      const { server, port } = await createTestServer((_req, res) => {
        res.writeHead(200);
        res.end(xml);
      });

      try {
        const body = await client.queryTvActiveChannel('127.0.0.1', port);
        expect(body).to.equal(xml);
      } finally {
        await closeServer(server);
      }
    });

    it('throws on non-200 status', async () => {
      const { server, port } = await createTestServer((_req, res) => {
        res.writeHead(404);
        res.end();
      });

      try {
        await client.queryTvActiveChannel('127.0.0.1', port);
        expect.fail('should have thrown');
      } catch (err) {
        expect((err as Error).message).to.include('HTTP 404');
      } finally {
        await closeServer(server);
      }
    });
  });

  // ---------------------------------------------------------------------------
  // exitApp
  // ---------------------------------------------------------------------------

  describe('exitApp', () => {
    it('POSTs to /exit-app/{appId} by default', async () => {
      let requestedUrl = '';
      let requestedMethod = '';
      const { server, port } = await createTestServer((req, res) => {
        requestedUrl = req.url || '';
        requestedMethod = req.method || '';
        res.writeHead(200);
        res.end();
      });

      try {
        await client.exitApp('127.0.0.1', 'dev', false, port);
        expect(requestedMethod).to.equal('POST');
        expect(requestedUrl).to.equal('/exit-app/dev');
      } finally {
        await closeServer(server);
      }
    });

    it('POSTs to /exit-app/{appId}/true when force is set', async () => {
      let requestedUrl = '';
      const { server, port } = await createTestServer((req, res) => {
        requestedUrl = req.url || '';
        res.writeHead(200);
        res.end();
      });

      try {
        await client.exitApp('127.0.0.1', 'dev', true, port);
        expect(requestedUrl).to.equal('/exit-app/dev/true');
      } finally {
        await closeServer(server);
      }
    });

    it('resolves on HTTP 204', async () => {
      const { server, port } = await createTestServer((_req, res) => {
        res.writeHead(204);
        res.end();
      });

      try {
        await client.exitApp('127.0.0.1', 'dev', false, port);
      } finally {
        await closeServer(server);
      }
    });

    it('rejects with status and response body on HTTP 404 (app not running)', async () => {
      const { server, port } = await createTestServer((_req, res) => {
        res.writeHead(404);
        res.end('App not running');
      });

      try {
        await client.exitApp('127.0.0.1', 'dev', false, port);
        expect.fail('should have thrown');
      } catch (err) {
        expect((err as Error).message).to.include('status 404');
        expect((err as Error).message).to.include('App not running');
      } finally {
        await closeServer(server);
      }
    });
  });

  // ---------------------------------------------------------------------------
  // enableRendezvousTracking
  // ---------------------------------------------------------------------------

  describe('enableRendezvousTracking', () => {
    it('posts to /sgrendezvous/track and returns true on 200', async () => {
      let requestMethod = '';
      let requestPath = '';
      const { server, port } = await createTestServer((req, res) => {
        requestMethod = req.method || '';
        requestPath = req.url || '';
        res.writeHead(200, { 'Content-Type': 'text/xml' });
        res.end('<sgrendezvous><tracking-enabled>true</tracking-enabled><status>OK</status></sgrendezvous>');
      });

      try {
        const result = await client.enableRendezvousTracking('127.0.0.1', port);
        expect(result).to.be.true;
        expect(requestMethod).to.equal('POST');
        expect(requestPath).to.equal('/sgrendezvous/track');
      } finally {
        await closeServer(server);
      }
    });

    it('returns false on non-200 status', async () => {
      const { server, port } = await createTestServer((_req, res) => {
        res.writeHead(404);
        res.end('');
      });

      try {
        const result = await client.enableRendezvousTracking('127.0.0.1', port);
        expect(result).to.be.false;
      } finally {
        await closeServer(server);
      }
    });

    it('returns false on connection error', async () => {
      const result = await client.enableRendezvousTracking('127.0.0.1', 1);
      expect(result).to.be.false;
    });
  });

  // ---------------------------------------------------------------------------
  // disableRendezvousTracking
  // ---------------------------------------------------------------------------

  describe('disableRendezvousTracking', () => {
    it('posts to /sgrendezvous/untrack and returns true on 200', async () => {
      let requestPath = '';
      const { server, port } = await createTestServer((req, res) => {
        requestPath = req.url || '';
        res.writeHead(200);
        res.end('');
      });

      try {
        const result = await client.disableRendezvousTracking('127.0.0.1', port);
        expect(result).to.be.true;
        expect(requestPath).to.equal('/sgrendezvous/untrack');
      } finally {
        await closeServer(server);
      }
    });

    it('returns false on connection error', async () => {
      const result = await client.disableRendezvousTracking('127.0.0.1', 1);
      expect(result).to.be.false;
    });
  });

  // ---------------------------------------------------------------------------
  // queryRendezvousEvents
  // ---------------------------------------------------------------------------

  describe('queryRendezvousEvents', () => {
    // Matches the real Roku device response format
    const RENDEZVOUS_XML = [
      '<?xml version="1.0" encoding="UTF-8" ?>',
      '<sgrendezvous>',
      '  <data>',
      '    <tracking-enabled>true</tracking-enabled>',
      '    <drop-count>0</drop-count>',
      '    <count>2</count>',
      '    <item>',
      '      <id>1</id>',
      '      <start-tm>100</start-tm>',
      '      <end-tm>115</end-tm>',
      '      <line-number>42</line-number>',
      '      <file>pkg:/components/Foo.brs</file>',
      '    </item>',
      '    <item>',
      '      <id>2</id>',
      '      <start-tm>200</start-tm>',
      '      <end-tm>208</end-tm>',
      '      <line-number>88</line-number>',
      '      <file>pkg:/components/Bar.brs</file>',
      '    </item>',
      '  </data>',
      '  <timestamp>1782382759806</timestamp>',
      '  <status>OK</status>',
      '</sgrendezvous>',
    ].join('\n');

    it('gets /query/sgrendezvous and parses events', async () => {
      let requestPath = '';
      const { server, port } = await createTestServer((req, res) => {
        requestPath = req.url || '';
        res.writeHead(200, { 'Content-Type': 'text/xml' });
        res.end(RENDEZVOUS_XML);
      });

      try {
        const result = await client.queryRendezvousEvents('127.0.0.1', port);
        expect(requestPath).to.equal('/query/sgrendezvous');
        expect(result.events).to.have.length(2);
        expect(result.dropCount).to.equal(0);

        expect(result.events[0].id).to.equal('1');
        expect(result.events[0].startTimeMs).to.equal(100);
        expect(result.events[0].endTimeMs).to.equal(115);
        expect(result.events[0].line).to.equal(42);
        expect(result.events[0].file).to.equal('pkg:/components/Foo.brs');

        expect(result.events[1].id).to.equal('2');
        expect(result.events[1].line).to.equal(88);
        expect(result.events[1].file).to.equal('pkg:/components/Bar.brs');
      } finally {
        await closeServer(server);
      }
    });

    it('parses drop-count from response', async () => {
      const xml = [
        '<sgrendezvous><data>',
        '  <drop-count>42</drop-count>',
        '</data></sgrendezvous>',
      ].join('');
      const { server, port } = await createTestServer((_req, res) => {
        res.writeHead(200);
        res.end(xml);
      });

      try {
        const result = await client.queryRendezvousEvents('127.0.0.1', port);
        expect(result.dropCount).to.equal(42);
      } finally {
        await closeServer(server);
      }
    });

    it('returns empty results on non-200 response', async () => {
      const { server, port } = await createTestServer((_req, res) => {
        res.writeHead(503);
        res.end('');
      });

      try {
        const result = await client.queryRendezvousEvents('127.0.0.1', port);
        expect(result.events).to.have.length(0);
        expect(result.dropCount).to.equal(0);
      } finally {
        await closeServer(server);
      }
    });

    it('returns empty results on connection error', async () => {
      const result = await client.queryRendezvousEvents('127.0.0.1', 1);
      expect(result.events).to.have.length(0);
      expect(result.dropCount).to.equal(0);
    });

    it('returns empty events when XML has no item blocks', async () => {
      const { server, port } = await createTestServer((_req, res) => {
        res.writeHead(200);
        res.end('<sgrendezvous><data><tracking-enabled>true</tracking-enabled><count>0</count></data></sgrendezvous>');
      });

      try {
        const result = await client.queryRendezvousEvents('127.0.0.1', port);
        expect(result.events).to.have.length(0);
      } finally {
        await closeServer(server);
      }
    });

    it('skips item blocks missing required fields', async () => {
      const xml = [
        '<sgrendezvous><data>',
        '  <item><id>1</id><file>pkg:/Foo.brs</file></item>',
        '  <item><id>2</id><start-tm>100</start-tm><end-tm>110</end-tm><line-number>5</line-number><file>pkg:/Bar.brs</file></item>',
        '</data></sgrendezvous>',
      ].join('\n');
      const { server, port } = await createTestServer((_req, res) => {
        res.writeHead(200);
        res.end(xml);
      });

      try {
        const result = await client.queryRendezvousEvents('127.0.0.1', port);
        expect(result.events).to.have.length(1);
        expect(result.events[0].line).to.equal(5);
      } finally {
        await closeServer(server);
      }
    });
  });

  // ---------------------------------------------------------------------------
  // enableFwBeaconTracking / disableFwBeaconTracking
  // ---------------------------------------------------------------------------

  describe('enableFwBeaconTracking', () => {
    it('posts to /fwbeacons/track/<appId> and returns true on 200', async () => {
      let requestMethod = '';
      let requestPath = '';
      const { server, port } = await createTestServer((req, res) => {
        requestMethod = req.method || '';
        requestPath = req.url || '';
        res.writeHead(200, { 'Content-Type': 'text/xml' });
        res.end('<fwbeacons><tracking-enabled>true</tracking-enabled><status>OK</status></fwbeacons>');
      });

      try {
        const result = await client.enableFwBeaconTracking('127.0.0.1', 'dev', port);
        expect(result).to.be.true;
        expect(requestMethod).to.equal('POST');
        expect(requestPath).to.equal('/fwbeacons/track/dev');
      } finally {
        await closeServer(server);
      }
    });

    it('returns false on non-200 status', async () => {
      const { server, port } = await createTestServer((_req, res) => {
        res.writeHead(404);
        res.end('');
      });

      try {
        const result = await client.enableFwBeaconTracking('127.0.0.1', 'dev', port);
        expect(result).to.be.false;
      } finally {
        await closeServer(server);
      }
    });

    it('returns false on connection error', async () => {
      const result = await client.enableFwBeaconTracking('127.0.0.1', 'dev', 1);
      expect(result).to.be.false;
    });
  });

  describe('disableFwBeaconTracking', () => {
    it('posts to /fwbeacons/untrack/<appId> and returns true on 200', async () => {
      let requestPath = '';
      const { server, port } = await createTestServer((req, res) => {
        requestPath = req.url || '';
        res.writeHead(200);
        res.end('');
      });

      try {
        const result = await client.disableFwBeaconTracking('127.0.0.1', 'dev', port);
        expect(result).to.be.true;
        expect(requestPath).to.equal('/fwbeacons/untrack/dev');
      } finally {
        await closeServer(server);
      }
    });

    it('returns false on connection error', async () => {
      const result = await client.disableFwBeaconTracking('127.0.0.1', 'dev', 1);
      expect(result).to.be.false;
    });
  });

  // ---------------------------------------------------------------------------
  // queryFwBeacons
  // ---------------------------------------------------------------------------

  describe('queryFwBeacons', () => {
    // Matches a real device response (captured live via curl against /query/fwbeacons)
    const FW_BEACONS_XML = [
      '<?xml version="1.0" encoding="UTF-8" ?>',
      '<fwbeacons>',
      '\t<tracking-enabled>true</tracking-enabled>',
      '\t<plugin-id>dev</plugin-id>',
      '\t<plugin-title>DAZN</plugin-title>',
      '\t<drop-count>0</drop-count>',
      '\t<interval-drop-count>0</interval-drop-count>',
      '\t<count>2</count>',
      '\t<app-launch-complete>',
      '\t\t<timestamp>1782980514114</timestamp>',
      '\t</app-launch-complete>',
      '\t<vod-start-complete>',
      '\t\t<timestamp>1782980514288</timestamp>',
      '\t</vod-start-complete>',
      '\t<timestamp>1782980516220</timestamp>',
      '\t<status>OK</status>',
      '</fwbeacons>',
    ].join('\n');

    it('gets /query/fwbeacons and parses named beacon events', async () => {
      let requestPath = '';
      const { server, port } = await createTestServer((req, res) => {
        requestPath = req.url || '';
        res.writeHead(200, { 'Content-Type': 'text/xml' });
        res.end(FW_BEACONS_XML);
      });

      try {
        const result = await client.queryFwBeacons('127.0.0.1', port);
        expect(requestPath).to.equal('/query/fwbeacons');
        expect(result.dropCount).to.equal(0);
        expect(result.events).to.deep.equal([
          { name: 'app-launch-complete', timestampMs: 1782980514114 },
          { name: 'vod-start-complete', timestampMs: 1782980514288 },
        ]);
      } finally {
        await closeServer(server);
      }
    });

    it('returns an empty event list when count is 0 (no beacons since last poll)', async () => {
      const xml =
        '<fwbeacons><tracking-enabled>true</tracking-enabled><plugin-id>dev</plugin-id>' +
        '<drop-count>0</drop-count><interval-drop-count>0</interval-drop-count><count>0</count>' +
        '<timestamp>1782980542408</timestamp><status>OK</status></fwbeacons>';
      const { server, port } = await createTestServer((_req, res) => {
        res.writeHead(200);
        res.end(xml);
      });

      try {
        const result = await client.queryFwBeacons('127.0.0.1', port);
        expect(result.events).to.have.length(0);
      } finally {
        await closeServer(server);
      }
    });

    it('parses drop-count from response', async () => {
      const xml = '<fwbeacons><drop-count>7</drop-count><count>0</count></fwbeacons>';
      const { server, port } = await createTestServer((_req, res) => {
        res.writeHead(200);
        res.end(xml);
      });

      try {
        const result = await client.queryFwBeacons('127.0.0.1', port);
        expect(result.dropCount).to.equal(7);
      } finally {
        await closeServer(server);
      }
    });

    it('returns empty results on non-200 response', async () => {
      const { server, port } = await createTestServer((_req, res) => {
        res.writeHead(503);
        res.end('');
      });

      try {
        const result = await client.queryFwBeacons('127.0.0.1', port);
        expect(result.events).to.have.length(0);
        expect(result.dropCount).to.equal(0);
      } finally {
        await closeServer(server);
      }
    });

    it('returns empty results on connection error', async () => {
      const result = await client.queryFwBeacons('127.0.0.1', 1);
      expect(result.events).to.have.length(0);
      expect(result.dropCount).to.equal(0);
    });
  });

  // ---------------------------------------------------------------------------
  // queryAppState
  // ---------------------------------------------------------------------------

  describe('queryAppState', () => {
    it('returns "active" for a foreground app-state (verified live response shape)', async () => {
      const { server, port } = await createTestServer((_req, res) => {
        res.writeHead(200);
        res.end(
          '<app-state><app-id>dev</app-id><app-title>DAZN</app-title><app-version>3.30.5</app-version>' +
          '<app-dev-id>abc123</app-dev-id><state>active</state><status>OK</status></app-state>',
        );
      });
      try {
        const state = await client.queryAppState('127.0.0.1', 'dev', port);
        expect(state).to.equal('active');
      } finally {
        await closeServer(server);
      }
    });

    it('returns "background" for a backgrounded app-state', async () => {
      const { server, port } = await createTestServer((_req, res) => {
        res.writeHead(200);
        res.end('<app-state><app-id>dev</app-id><state>background</state><status>OK</status></app-state>');
      });
      try {
        const state = await client.queryAppState('127.0.0.1', 'dev', port);
        expect(state).to.equal('background');
      } finally {
        await closeServer(server);
      }
    });

    it('returns "unknown" on non-200 response', async () => {
      const { server, port } = await createTestServer((_req, res) => {
        res.writeHead(503);
        res.end('');
      });
      try {
        const state = await client.queryAppState('127.0.0.1', 'dev', port);
        expect(state).to.equal('unknown');
      } finally {
        await closeServer(server);
      }
    });

    it('returns "unknown" on connection error', async () => {
      const state = await client.queryAppState('127.0.0.1', 'dev', 1);
      expect(state).to.equal('unknown');
    });

    it('returns "unknown" for an unrecognized state value', async () => {
      const { server, port } = await createTestServer((_req, res) => {
        res.writeHead(200);
        res.end('<app-state><app-id>dev</app-id><state>weird</state><status>OK</status></app-state>');
      });
      try {
        const state = await client.queryAppState('127.0.0.1', 'dev', port);
        expect(state).to.equal('unknown');
      } finally {
        await closeServer(server);
      }
    });

    it('returns "unknown" for a FAILED status (e.g. querying an unauthorized app id)', async () => {
      const { server, port } = await createTestServer((_req, res) => {
        res.writeHead(200);
        res.end('<app-state><app-id>12</app-id><status>FAILED</status><error>Channel access not authorized: 12</error></app-state>');
      });
      try {
        const state = await client.queryAppState('127.0.0.1', '12', port);
        expect(state).to.equal('unknown');
      } finally {
        await closeServer(server);
      }
    });
  });

  // ---------------------------------------------------------------------------
  // keypress / keydown / keyup
  // ---------------------------------------------------------------------------

  describe('keypress / keydown / keyup', () => {
    it('sends POST /keypress/{key} for a named key', async () => {
      let requestPath: string | undefined;
      let requestMethod: string | undefined;
      const { server, port } = await createTestServer((req, res) => {
        requestPath = req.url;
        requestMethod = req.method;
        res.writeHead(200);
        res.end('');
      });

      try {
        await client.keypress('127.0.0.1', 'Home', port);
        expect(requestMethod).to.equal('POST');
        expect(requestPath).to.equal('/keypress/Home');
      } finally {
        await closeServer(server);
      }
    });

    it('sends POST /keydown/{key} and POST /keyup/{key}', async () => {
      const paths: string[] = [];
      const { server, port } = await createTestServer((req, res) => {
        paths.push(`${req.method} ${req.url}`);
        res.writeHead(200);
        res.end('');
      });

      try {
        await client.keydown('127.0.0.1', 'Right', port);
        await client.keyup('127.0.0.1', 'Right', port);
        expect(paths).to.deep.equal(['POST /keydown/Right', 'POST /keyup/Right']);
      } finally {
        await closeServer(server);
      }
    });

    it('does not re-encode pre-encoded Lit_ keys', async () => {
      let requestPath: string | undefined;
      const { server, port } = await createTestServer((req, res) => {
        requestPath = req.url;
        res.writeHead(200);
        res.end('');
      });

      try {
        await client.keypress('127.0.0.1', 'Lit_%E2%82%AC', port);
        // A re-encoded key would arrive as /keypress/Lit_%25E2%2582%25AC.
        expect(requestPath).to.equal('/keypress/Lit_%E2%82%AC');
      } finally {
        await closeServer(server);
      }
    });

    it('accepts 204 responses as success', async () => {
      const { server, port } = await createTestServer((_req, res) => {
        res.writeHead(204);
        res.end();
      });

      try {
        await client.keypress('127.0.0.1', 'Select', port);
      } finally {
        await closeServer(server);
      }
    });

    it('throws on non-2xx responses and includes the body', async () => {
      const { server, port } = await createTestServer((_req, res) => {
        res.writeHead(403);
        res.end('ECP command not allowed in Limited mode.');
      });

      try {
        await client.keypress('127.0.0.1', 'Home', port);
        expect.fail('should have thrown');
      } catch (err) {
        expect((err as Error).message).to.include('status 403');
        expect((err as Error).message).to.include('Limited mode');
      } finally {
        await closeServer(server);
      }
    });

    it('does not append a dangling separator when the error body is empty', async () => {
      const { server, port } = await createTestServer((_req, res) => {
        res.writeHead(404);
        res.end('');
      });

      try {
        await client.keyup('127.0.0.1', 'Home', port);
        expect.fail('should have thrown');
      } catch (err) {
        expect((err as Error).message).to.equal('keyup Home failed: status 404');
      } finally {
        await closeServer(server);
      }
    });
  });

  // ---------------------------------------------------------------------------
  // sendText
  // ---------------------------------------------------------------------------

  describe('sendText', () => {
    it('sends one keypress per code point, strictly in order, awaiting each response', async () => {
      const received: string[] = [];
      let delay = 40;
      const { server, port } = await createTestServer((req, res) => {
        const url = req.url ?? '';
        // Decreasing per-request delay: if requests were issued concurrently,
        // later characters would finish first and arrive out of order.
        const thisDelay = delay;
        delay = Math.max(0, delay - 15);
        setTimeout(() => {
          received.push(url);
          res.writeHead(200);
          res.end('');
        }, thisDelay);
      });

      try {
        await client.sendText('127.0.0.1', 'ab€', port);
        expect(received).to.deep.equal([
          '/keypress/Lit_a',
          '/keypress/Lit_b',
          '/keypress/Lit_%E2%82%AC',
        ]);
      } finally {
        await closeServer(server);
      }
    });

    it('stops at the first failure and does not send the remaining characters', async () => {
      const received: string[] = [];
      const { server, port } = await createTestServer((req, res) => {
        received.push(req.url ?? '');
        if (received.length === 2) {
          res.writeHead(503);
          res.end('');
        } else {
          res.writeHead(200);
          res.end('');
        }
      });

      try {
        await client.sendText('127.0.0.1', 'abcd', port);
        expect.fail('should have thrown');
      } catch (err) {
        expect((err as Error).message).to.include('status 503');
        expect(received).to.deep.equal(['/keypress/Lit_a', '/keypress/Lit_b']);
      } finally {
        await closeServer(server);
      }
    });

    it('sends nothing for an empty string', async () => {
      const received: string[] = [];
      const { server, port } = await createTestServer((req, res) => {
        received.push(req.url ?? '');
        res.writeHead(200);
        res.end('');
      });

      try {
        await client.sendText('127.0.0.1', '', port);
        expect(received).to.have.length(0);
      } finally {
        await closeServer(server);
      }
    });
  });

  // ---------------------------------------------------------------------------
  // queryActiveApp
  // ---------------------------------------------------------------------------

  describe('queryActiveApp', () => {
    it('parses the active app from GET /query/active-app', async () => {
      let requestPath: string | undefined;
      const { server, port } = await createTestServer((req, res) => {
        requestPath = req.url;
        res.writeHead(200);
        res.end('<active-app><app id="dev" type="appl" version="3.30.5">DAZN</app></active-app>');
      });

      try {
        const app = await client.queryActiveApp('127.0.0.1', port);
        expect(requestPath).to.equal('/query/active-app');
        expect(app).to.deep.equal({ id: 'dev', name: 'DAZN', type: 'appl', version: '3.30.5' });
      } finally {
        await closeServer(server);
      }
    });

    it('handles the home screen reporting an app with no attributes', async () => {
      const { server, port } = await createTestServer((_req, res) => {
        res.writeHead(200);
        res.end('<active-app><app>Roku</app></active-app>');
      });

      try {
        const app = await client.queryActiveApp('127.0.0.1', port);
        expect(app?.name).to.equal('Roku');
        expect(app?.id).to.be.undefined;
      } finally {
        await closeServer(server);
      }
    });

    it('throws on non-200 responses', async () => {
      const { server, port } = await createTestServer((_req, res) => {
        res.writeHead(503);
        res.end('');
      });

      try {
        await client.queryActiveApp('127.0.0.1', port);
        expect.fail('should have thrown');
      } catch (err) {
        expect((err as Error).message).to.include('status 503');
      } finally {
        await closeServer(server);
      }
    });
  });

  // ---------------------------------------------------------------------------
  // queryMediaPlayer
  // ---------------------------------------------------------------------------

  describe('queryMediaPlayer', () => {
    it('parses a playing media-player response', async () => {
      let requestPath: string | undefined;
      const { server, port } = await createTestServer((req, res) => {
        requestPath = req.url;
        res.writeHead(200);
        res.end(
          '<player error="false" state="play">' +
          '<plugin bandwidth="12000000 bps" id="dev" name="DAZN"/>' +
          '<format audio="aac" captions="none" container="dash" drm="widevine" video="hevc"/>' +
          '<position>1198000 ms</position><duration>7422000 ms</duration>' +
          '<is_live>false</is_live></player>',
        );
      });

      try {
        const info = await client.queryMediaPlayer('127.0.0.1', port);
        expect(requestPath).to.equal('/query/media-player');
        expect(info.state).to.equal('play');
        expect(info.error).to.equal(false);
        expect(info.plugin).to.deep.equal({ id: 'dev', name: 'DAZN', bandwidth: '12000000 bps' });
        expect(info.format).to.deep.equal({
          audio: 'aac', video: 'hevc', drm: 'widevine', captions: 'none', container: 'dash',
        });
        expect(info.positionMs).to.equal(1198000);
        expect(info.durationMs).to.equal(7422000);
        expect(info.isLive).to.equal(false);
      } finally {
        await closeServer(server);
      }
    });

    it('throws on non-200 responses', async () => {
      const { server, port } = await createTestServer((_req, res) => {
        res.writeHead(503);
        res.end('');
      });

      try {
        await client.queryMediaPlayer('127.0.0.1', port);
        expect.fail('should have thrown');
      } catch (err) {
        expect((err as Error).message).to.include('status 503');
      } finally {
        await closeServer(server);
      }
    });
  });
});

// ---------------------------------------------------------------------------
// parseAppsXml (standalone)
// ---------------------------------------------------------------------------

describe('parseAppsXml', () => {
  it('parses multiple app elements', () => {
    const xml = [
      '<apps>',
      '  <app id="12" type="appl" version="70.2316.0">Netflix</app>',
      '  <app id="dev" type="appl" version="1.0.0">My App</app>',
      '</apps>',
    ].join('\n');

    const apps = parseAppsXml(xml);
    expect(apps).to.have.length(2);
    expect(apps[0]).to.deep.equal({ id: '12', name: 'Netflix', type: 'appl', version: '70.2316.0' });
    expect(apps[1]).to.deep.equal({ id: 'dev', name: 'My App', type: 'appl', version: '1.0.0' });
  });

  it('handles empty apps list', () => {
    const apps = parseAppsXml('<apps></apps>');
    expect(apps).to.have.length(0);
  });

  it('handles app with no type or version attributes', () => {
    const xml = '<apps><app id="999">Simple App</app></apps>';
    const apps = parseAppsXml(xml);
    expect(apps).to.have.length(1);
    expect(apps[0].id).to.equal('999');
    expect(apps[0].name).to.equal('Simple App');
    expect(apps[0].type).to.be.undefined;
    expect(apps[0].version).to.be.undefined;
  });

  it('trims whitespace from app names', () => {
    const xml = '<apps><app id="1" type="appl" version="1.0">  Spaced Name  </app></apps>';
    const apps = parseAppsXml(xml);
    expect(apps[0].name).to.equal('Spaced Name');
  });
});

// ---------------------------------------------------------------------------
// buildEcpQueryString (standalone)
// ---------------------------------------------------------------------------

describe('buildEcpQueryString', () => {
  it('returns an empty string for an empty map', () => {
    expect(buildEcpQueryString({})).to.equal('');
  });

  it('joins multiple pairs with & and prefixes ?', () => {
    expect(buildEcpQueryString({ contentId: 'abc', mediaType: 'movie' }))
      .to.equal('?contentId=abc&mediaType=movie');
  });

  it('percent-encodes reserved characters in values', () => {
    expect(buildEcpQueryString({ contentId: 'a b&c=d?e' }))
      .to.equal('?contentId=a%20b%26c%3Dd%3Fe');
  });

  it('percent-encodes reserved characters in keys', () => {
    expect(buildEcpQueryString({ 'weird key&': 'v' }))
      .to.equal('?weird%20key%26=v');
  });

  it('percent-encodes non-ASCII characters as UTF-8', () => {
    expect(buildEcpQueryString({ title: 'zażółć' }))
      .to.equal('?title=za%C5%BC%C3%B3%C5%82%C4%87');
  });

  it('keeps empty values as bare key=', () => {
    expect(buildEcpQueryString({ contentId: '' })).to.equal('?contentId=');
  });
});

// ---------------------------------------------------------------------------
// parseActiveAppXml (standalone)
// ---------------------------------------------------------------------------

describe('parseActiveAppXml', () => {
  it('parses id, type, version and name', () => {
    const app = parseActiveAppXml('<active-app><app id="562859" type="appl" version="1.0.0">Roku Home</app></active-app>');
    expect(app).to.deep.equal({ id: '562859', name: 'Roku Home', type: 'appl', version: '1.0.0' });
  });

  it('returns undefined when there is no app element', () => {
    expect(parseActiveAppXml('<active-app></active-app>')).to.be.undefined;
  });

  it('trims whitespace from the name', () => {
    const app = parseActiveAppXml('<active-app><app id="dev">  My App  </app></active-app>');
    expect(app?.name).to.equal('My App');
  });
});

// ---------------------------------------------------------------------------
// parseMediaPlayerXml (standalone)
// ---------------------------------------------------------------------------

describe('parseMediaPlayerXml', () => {
  it('reports state "none" with no plugin/format for an idle player', () => {
    const info = parseMediaPlayerXml('<player error="false" state="none"></player>');
    expect(info.state).to.equal('none');
    expect(info.error).to.equal(false);
    expect(info.plugin).to.be.undefined;
    expect(info.format).to.be.undefined;
    expect(info.positionMs).to.be.undefined;
    expect(info.durationMs).to.be.undefined;
    expect(info.isLive).to.be.undefined;
  });

  it('flags error="true"', () => {
    const info = parseMediaPlayerXml('<player error="true" state="close"></player>');
    expect(info.error).to.equal(true);
    expect(info.state).to.equal('close');
  });

  it('lowercases the state value', () => {
    expect(parseMediaPlayerXml('<player error="false" state="Play"></player>').state).to.equal('play');
  });

  it('tolerates missing attributes inside plugin/format elements', () => {
    const info = parseMediaPlayerXml('<player error="false" state="play"><plugin id="dev"/><format video="hevc"/></player>');
    expect(info.plugin?.id).to.equal('dev');
    expect(info.plugin?.name).to.be.undefined;
    expect(info.format?.video).to.equal('hevc');
    expect(info.format?.drm).to.be.undefined;
  });

  it('returns state "none" for malformed input with no player element', () => {
    const info = parseMediaPlayerXml('garbage');
    expect(info.state).to.equal('none');
    expect(info.error).to.equal(false);
  });

  it('parses is_live', () => {
    expect(parseMediaPlayerXml('<player error="false" state="play"><is_live>true</is_live></player>').isLive).to.equal(true);
  });
});