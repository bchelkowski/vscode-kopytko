import { expect } from 'chai';
import * as sinon from 'sinon';
import * as http from 'http';
import { EcpClient, parseAppsXml } from '../../../src/client/roku/discovery/ecpClient';
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
  // enableRendezvousTracking
  // ---------------------------------------------------------------------------

  describe('enableRendezvousTracking', () => {
    it('posts to /query/sgrendezvous/track and returns true on confirmed response', async () => {
      let requestMethod = '';
      let requestPath = '';
      const { server, port } = await createTestServer((req, res) => {
        requestMethod = req.method || '';
        requestPath = req.url || '';
        res.writeHead(200, { 'Content-Type': 'text/xml' });
        res.end('<rendezvous-tracking><tracking-enabled>true</tracking-enabled></rendezvous-tracking>');
      });

      try {
        const result = await client.enableRendezvousTracking('127.0.0.1', port);
        expect(result).to.be.true;
        expect(requestMethod).to.equal('POST');
        expect(requestPath).to.equal('/query/sgrendezvous/track');
      } finally {
        await closeServer(server);
      }
    });

    it('returns false when response does not confirm tracking enabled', async () => {
      const { server, port } = await createTestServer((_req, res) => {
        res.writeHead(200);
        res.end('<rendezvous-tracking><tracking-enabled>false</tracking-enabled></rendezvous-tracking>');
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
    it('posts to /query/sgrendezvous/untrack and returns true on 200', async () => {
      let requestPath = '';
      const { server, port } = await createTestServer((req, res) => {
        requestPath = req.url || '';
        res.writeHead(200);
        res.end('');
      });

      try {
        const result = await client.disableRendezvousTracking('127.0.0.1', port);
        expect(result).to.be.true;
        expect(requestPath).to.equal('/query/sgrendezvous/untrack');
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
    const RENDEZVOUS_XML = [
      '<?xml version="1.0" encoding="UTF-8" ?>',
      '<rendezvous-tracking>',
      '  <tracking-enabled>true</tracking-enabled>',
      '  <dropped-event-count>0</dropped-event-count>',
      '  <rendezvous>',
      '    <id>1</id>',
      '    <start-time>100</start-time>',
      '    <end-time>115</end-time>',
      '    <line>42</line>',
      '    <file>pkg:/components/Foo.brs</file>',
      '  </rendezvous>',
      '  <rendezvous>',
      '    <id>2</id>',
      '    <start-time>200</start-time>',
      '    <end-time>208</end-time>',
      '    <line>88</line>',
      '    <file>pkg:/components/Bar.brs</file>',
      '  </rendezvous>',
      '</rendezvous-tracking>',
    ].join('\n');

    it('gets /query/sgrendezvous and parses events', async () => {
      let requestPath = '';
      const { server, port } = await createTestServer((req, res) => {
        requestPath = req.url || '';
        res.writeHead(200, { 'Content-Type': 'text/xml' });
        res.end(RENDEZVOUS_XML);
      });

      try {
        const events = await client.queryRendezvousEvents('127.0.0.1', port);
        expect(requestPath).to.equal('/query/sgrendezvous');
        expect(events).to.have.length(2);

        expect(events[0].id).to.equal('1');
        expect(events[0].startTimeMs).to.equal(100);
        expect(events[0].endTimeMs).to.equal(115);
        expect(events[0].line).to.equal(42);
        expect(events[0].file).to.equal('pkg:/components/Foo.brs');

        expect(events[1].id).to.equal('2');
        expect(events[1].line).to.equal(88);
        expect(events[1].file).to.equal('pkg:/components/Bar.brs');
      } finally {
        await closeServer(server);
      }
    });

    it('returns empty array on non-200 response', async () => {
      const { server, port } = await createTestServer((_req, res) => {
        res.writeHead(503);
        res.end('');
      });

      try {
        const events = await client.queryRendezvousEvents('127.0.0.1', port);
        expect(events).to.have.length(0);
      } finally {
        await closeServer(server);
      }
    });

    it('returns empty array on connection error', async () => {
      const events = await client.queryRendezvousEvents('127.0.0.1', 1);
      expect(events).to.have.length(0);
    });

    it('returns empty array when XML has no event blocks', async () => {
      const { server, port } = await createTestServer((_req, res) => {
        res.writeHead(200);
        res.end('<rendezvous-tracking><tracking-enabled>true</tracking-enabled></rendezvous-tracking>');
      });

      try {
        const events = await client.queryRendezvousEvents('127.0.0.1', port);
        expect(events).to.have.length(0);
      } finally {
        await closeServer(server);
      }
    });

    it('skips event blocks missing required fields', async () => {
      const xml = [
        '<rendezvous-tracking>',
        '  <rendezvous><id>1</id><file>pkg:/Foo.brs</file></rendezvous>',
        '  <rendezvous><id>2</id><start-time>100</start-time><end-time>110</end-time><line>5</line><file>pkg:/Bar.brs</file></rendezvous>',
        '</rendezvous-tracking>',
      ].join('\n');
      const { server, port } = await createTestServer((_req, res) => {
        res.writeHead(200);
        res.end(xml);
      });

      try {
        const events = await client.queryRendezvousEvents('127.0.0.1', port);
        expect(events).to.have.length(1);
        expect(events[0].line).to.equal(5);
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