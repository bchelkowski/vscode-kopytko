import { expect } from 'chai';
import * as sinon from 'sinon';
import { SsdpClient } from '../../src/ssdp/ssdpClient';

/** Valid M-SEARCH response from a Roku device. */
function makeSearchResponse(ip: string, port: number, serial: string): string {
  return [
    'HTTP/1.1 200 OK',
    'CACHE-CONTROL: max-age=3600',
    `LOCATION: http://${ip}:${port}/`,
    'ST: roku:ecp',
    `USN: uuid:roku:ecp:${serial}`,
    '',
    '',
  ].join('\r\n');
}

/** Valid NOTIFY alive message from a Roku device. */
function makeNotifyAlive(ip: string, port: number, serial: string): string {
  return [
    'NOTIFY * HTTP/1.1',
    'HOST: 239.255.255.250:1900',
    `LOCATION: http://${ip}:${port}/`,
    'NT: roku:ecp',
    'NTS: ssdp:alive',
    `USN: uuid:roku:ecp:${serial}`,
    'ST: roku:ecp',
    '',
    '',
  ].join('\r\n');
}

/** NOTIFY byebye message for a Roku device leaving. */
function makeNotifyByebye(ip: string, port: number, serial: string): string {
  return [
    'NOTIFY * HTTP/1.1',
    'HOST: 239.255.255.250:1900',
    `LOCATION: http://${ip}:${port}/`,
    'NT: roku:ecp',
    'NTS: ssdp:byebye',
    'ST: roku:ecp',
    `USN: uuid:roku:ecp:${serial}`,
    '',
    '',
  ].join('\r\n');
}

/**
 * Access private methods for unit testing via type bypass.
 * This allows us to test the parsing logic without actual sockets.
 */
function getPrivate(client: SsdpClient): Record<string, (...args: any[]) => any> {
  return client as unknown as Record<string, (...args: any[]) => any>;
}

describe('SsdpClient', () => {
  let client: SsdpClient;

  beforeEach(() => {
    client = new SsdpClient();
  });

  afterEach(() => {
    client.stop();
    sinon.restore();
  });

  // ---------------------------------------------------------------------------
  // Response parsing (via private parseSearchResponse)
  // ---------------------------------------------------------------------------

  describe('parseSearchResponse', () => {
    it('parses a valid M-SEARCH response into SsdpDeviceFound', () => {
      const priv = getPrivate(client);
      const response = makeSearchResponse('192.168.1.10', 8060, 'YN00AB123456');
      const device = priv.parseSearchResponse(response);

      expect(device).to.not.be.undefined;
      expect(device!.ip).to.equal('192.168.1.10');
      expect(device!.port).to.equal(8060);
      expect(device!.serialNumber).to.equal('YN00AB123456');
    });

    it('extracts IP from LOCATION URL', () => {
      const priv = getPrivate(client);
      const response = makeSearchResponse('10.0.0.42', 9090, 'SERIAL001');
      const device = priv.parseSearchResponse(response);

      expect(device!.ip).to.equal('10.0.0.42');
      expect(device!.port).to.equal(9090);
    });

    it('extracts serial from USN header', () => {
      const priv = getPrivate(client);
      const response = makeSearchResponse('192.168.1.10', 8060, 'X00500ABCDE');
      const device = priv.parseSearchResponse(response);

      expect(device!.serialNumber).to.equal('X00500ABCDE');
    });

    it('returns undefined when LOCATION is missing', () => {
      const priv = getPrivate(client);
      const noLocation = [
        'HTTP/1.1 200 OK',
        'ST: roku:ecp',
        'USN: uuid:roku:ecp:SN001',
        '',
        '',
      ].join('\r\n');
      const device = priv.parseSearchResponse(noLocation);

      expect(device).to.be.undefined;
    });

    it('returns undefined when USN is missing', () => {
      const priv = getPrivate(client);
      const noUsn = [
        'HTTP/1.1 200 OK',
        'LOCATION: http://192.168.1.10:8060/',
        'ST: roku:ecp',
        '',
        '',
      ].join('\r\n');
      const device = priv.parseSearchResponse(noUsn);

      expect(device).to.be.undefined;
    });

    it('returns undefined when USN has wrong format', () => {
      const priv = getPrivate(client);
      const badUsn = [
        'HTTP/1.1 200 OK',
        'LOCATION: http://192.168.1.10:8060/',
        'USN: uuid:some:other:format',
        '',
        '',
      ].join('\r\n');
      const device = priv.parseSearchResponse(badUsn);

      expect(device).to.be.undefined;
    });

    it('defaults to port 8060 when LOCATION has no port', () => {
      const priv = getPrivate(client);
      const noPort = [
        'HTTP/1.1 200 OK',
        'LOCATION: http://192.168.1.10/',
        'USN: uuid:roku:ecp:SN001',
        '',
        '',
      ].join('\r\n');
      const device = priv.parseSearchResponse(noPort);

      expect(device).to.not.be.undefined;
      expect(device!.port).to.equal(8060);
    });
  });

  // ---------------------------------------------------------------------------
  // Header parsing
  // ---------------------------------------------------------------------------

  describe('parseHeaders', () => {
    it('parses HTTP-style headers into a Map with lower-cased keys', () => {
      const priv = getPrivate(client);
      const text = [
        'HTTP/1.1 200 OK',
        'LOCATION: http://192.168.1.10:8060/',
        'Cache-Control: max-age=3600',
        'ST: roku:ecp',
        'USN: uuid:roku:ecp:SN001',
      ].join('\r\n');

      const headers = priv.parseHeaders(text) as Map<string, string>;

      expect(headers.get('location')).to.equal('http://192.168.1.10:8060/');
      expect(headers.get('cache-control')).to.equal('max-age=3600');
      expect(headers.get('st')).to.equal('roku:ecp');
      expect(headers.get('usn')).to.equal('uuid:roku:ecp:SN001');
    });

    it('handles empty lines gracefully', () => {
      const priv = getPrivate(client);
      const text = 'HTTP/1.1 200 OK\r\n\r\nST: roku:ecp\r\n';
      const headers = priv.parseHeaders(text) as Map<string, string>;

      expect(headers.get('st')).to.equal('roku:ecp');
    });
  });

  // ---------------------------------------------------------------------------
  // NOTIFY handling
  // ---------------------------------------------------------------------------

  describe('handleNotify', () => {
    it('emits "found" on ssdp:alive NOTIFY after debounce', (done) => {
      const priv = getPrivate(client);

      client.on('found', (device) => {
        expect(device.ip).to.equal('192.168.1.20');
        expect(device.serialNumber).to.equal('SN002');
        done();
      });

      const msg = Buffer.from(makeNotifyAlive('192.168.1.20', 8060, 'SN002'));
      priv.handleNotify(msg);
    });

    it('emits "lost" on ssdp:byebye NOTIFY', (done) => {
      const priv = getPrivate(client);

      client.on('lost', (ip) => {
        expect(ip).to.equal('192.168.1.20');
        done();
      });

      const msg = Buffer.from(makeNotifyByebye('192.168.1.20', 8060, 'SN002'));
      priv.handleNotify(msg);
    });

    it('ignores non-Roku NOTIFY messages', () => {
      const priv = getPrivate(client);
      const foundSpy = sinon.spy();
      client.on('found', foundSpy);

      const nonRoku = [
        'NOTIFY * HTTP/1.1',
        'HOST: 239.255.255.250:1900',
        'LOCATION: http://192.168.1.99:80/',
        'NT: upnp:rootdevice',
        'NTS: ssdp:alive',
        'USN: uuid:some:other:device',
        'ST: upnp:rootdevice',
        '',
        '',
      ].join('\r\n');

      priv.handleNotify(Buffer.from(nonRoku));

      // debounce timer would fire — but since ST != roku:ecp, it shouldn't add anything
      expect(foundSpy.called).to.be.false;
    });

    it('ignores non-NOTIFY messages', () => {
      const priv = getPrivate(client);
      const foundSpy = sinon.spy();
      client.on('found', foundSpy);

      priv.handleNotify(Buffer.from('GET / HTTP/1.1\r\n\r\n'));

      expect(foundSpy.called).to.be.false;
    });

    it('debounces alive events per IP', (done) => {
      const priv = getPrivate(client);
      const foundSpy = sinon.spy();
      client.on('found', foundSpy);

      const msg = Buffer.from(makeNotifyAlive('192.168.1.20', 8060, 'SN001'));

      // Send multiple alive messages rapidly
      priv.handleNotify(msg);
      priv.handleNotify(msg);
      priv.handleNotify(msg);

      // After debounce period, should only emit once
      setTimeout(() => {
        expect(foundSpy.callCount).to.equal(1);
        done();
      }, 600);
    });
  });

  // ---------------------------------------------------------------------------
  // IP/Port extraction helpers
  // ---------------------------------------------------------------------------

  describe('extractIpFromLocation', () => {
    it('extracts IP from valid URL', () => {
      const priv = getPrivate(client);
      expect(priv.extractIpFromLocation('http://192.168.1.10:8060/')).to.equal('192.168.1.10');
    });

    it('returns undefined for invalid URL', () => {
      const priv = getPrivate(client);
      expect(priv.extractIpFromLocation('not-a-url')).to.be.undefined;
    });
  });

  describe('extractPortFromLocation', () => {
    it('extracts port from URL', () => {
      const priv = getPrivate(client);
      expect(priv.extractPortFromLocation('http://192.168.1.10:9090/')).to.equal(9090);
    });

    it('defaults to 8060 when no port specified', () => {
      const priv = getPrivate(client);
      expect(priv.extractPortFromLocation('http://192.168.1.10/')).to.equal(8060);
    });

    it('defaults to 8060 for invalid URL', () => {
      const priv = getPrivate(client);
      expect(priv.extractPortFromLocation('bad-url')).to.equal(8060);
    });
  });

  describe('extractSerialFromUsn', () => {
    it('extracts serial from standard USN format', () => {
      const priv = getPrivate(client);
      expect(priv.extractSerialFromUsn('uuid:roku:ecp:YN00AB123456')).to.equal('YN00AB123456');
    });

    it('returns undefined for non-Roku USN', () => {
      const priv = getPrivate(client);
      expect(priv.extractSerialFromUsn('uuid:some:other:device')).to.be.undefined;
    });

    it('is case insensitive', () => {
      const priv = getPrivate(client);
      expect(priv.extractSerialFromUsn('uuid:Roku:ECP:SN001')).to.equal('SN001');
    });
  });

  // ---------------------------------------------------------------------------
  // Network interface enumeration
  // ---------------------------------------------------------------------------

  describe('getInterfaceAddresses', () => {
    it('returns an array of strings', () => {
      const priv = getPrivate(client);
      const addresses = priv.getInterfaceAddresses() as string[];

      expect(addresses).to.be.an('array');
      expect(addresses.length).to.be.greaterThan(0);
      for (const addr of addresses) {
        expect(addr).to.be.a('string');
      }
    });
  });

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  describe('lifecycle', () => {
    it('stop clears all timers and state', () => {
      const priv = getPrivate(client);

      // Add some debounce timers
      priv.debouncedAlive({ ip: '192.168.1.10', port: 8060, serialNumber: 'SN001' });
      client.stop();

      // After stop, debounce map should be cleared
      const debounceMap = (client as any).aliveDebounce as Map<string, unknown>;
      expect(debounceMap.size).to.equal(0);
    });
  });
});
