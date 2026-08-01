import { expect } from 'chai';
import * as http from 'http';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { AddressInfo } from 'net';
import { InstallerClient } from '../../src/installer/installerClient';

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

/**
 * Builds a request handler that answers 401 (with a digest challenge) on the
 * first call, then delegates to `onAuthenticated` on the second — mirroring
 * a real device's digest-auth dance for every test below.
 */
function digestServer(
  onAuthenticated: (req: http.IncomingMessage, res: http.ServerResponse, body: Buffer) => void,
) {
  let callCount = 0;
  return async (req: http.IncomingMessage, res: http.ServerResponse) => {
    callCount++;
    const body = await readRawBody(req);
    if (callCount === 1) {
      res.writeHead(401, { 'WWW-Authenticate': DIGEST_CHALLENGE });
      res.end();
    } else {
      onAuthenticated(req, res, body);
    }
  };
}

describe('InstallerClient', () => {
  let client: InstallerClient;
  let tmpDir: string;

  beforeEach(async () => {
    client = new InstallerClient();
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'installer-client-test-'));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  describe('deleteChannel', () => {
    it('sends mysubmit=Delete to /plugin_install and resolves on 200', async () => {
      let receivedPath = '';
      let receivedBody = '';
      const { server, port } = await createTestServer(digestServer((req, res, body) => {
        receivedPath = req.url ?? '';
        receivedBody = body.toString();
        res.writeHead(200);
        res.end('OK');
      }));

      try {
        await client.deleteChannel('127.0.0.1', 'pw', port);
        expect(receivedPath).to.equal('/plugin_install');
        expect(receivedBody).to.include('name="mysubmit"');
        expect(receivedBody).to.include('Delete');
      } finally {
        await closeServer(server);
      }
    });

    it('throws on a non-2xx status', async () => {
      const { server, port } = await createTestServer(digestServer((_req, res) => {
        res.writeHead(500);
        res.end('boom');
      }));

      try {
        let threw = false;
        try {
          await client.deleteChannel('127.0.0.1', 'pw', port);
        } catch (err) {
          threw = true;
          expect((err as Error).message).to.include('Delete channel failed');
        }
        expect(threw).to.be.true;
      } finally {
        await closeServer(server);
      }
    });

    it('throws a clear authentication error when the retry is still 401', async () => {
      const { server, port } = await createTestServer((_req, res) => {
        res.writeHead(401, { 'WWW-Authenticate': DIGEST_CHALLENGE });
        res.end();
      });

      try {
        let threw = false;
        try {
          await client.deleteChannel('127.0.0.1', 'wrong', port);
        } catch (err) {
          threw = true;
          expect((err as Error).message).to.include('Authentication failed');
        }
        expect(threw).to.be.true;
      } finally {
        await closeServer(server);
      }
    });

    it('resolves on HTTP 200 with a success-typed message (confirmed live device shape)', async () => {
      const { server, port } = await createTestServer(digestServer((_req, res) => {
        res.writeHead(200);
        res.end(
          '<script>var params = JSON.parse(\'{"messages":[{"text":"Delete Succeeded.","text_type":"text","type":"success"},' +
          '{"text":"Uninstall Success.","text_type":"text","type":"success"}],"packages":[]}\');</script>',
        );
      }));

      try {
        await client.deleteChannel('127.0.0.1', 'pw', port);
      } finally {
        await closeServer(server);
      }
    });
  });

  describe('installChannel', () => {
    it('uploads the zip as the archive field with mysubmit=Install', async () => {
      const zipBytes = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0xff, 0x00]);
      const zipPath = path.join(tmpDir, 'archive.zip');
      await fs.writeFile(zipPath, zipBytes);

      let receivedBody = Buffer.alloc(0);
      const { server, port } = await createTestServer(digestServer((_req, res, body) => {
        receivedBody = body;
        res.writeHead(200);
        res.end('OK');
      }));

      try {
        await client.installChannel('127.0.0.1', 'pw', zipPath, port);
        const text = receivedBody.toString('latin1');
        expect(text).to.include('name="mysubmit"');
        expect(text).to.include('Install');
        expect(text).to.include('filename="archive.zip"');
        expect(receivedBody.includes(zipBytes)).to.be.true;
      } finally {
        await closeServer(server);
      }
    });

    it('throws a distinct error when the zip file cannot be read', async () => {
      let threw = false;
      try {
        await client.installChannel('127.0.0.1', 'pw', path.join(tmpDir, 'missing.zip'), 1);
      } catch (err) {
        threw = true;
        expect((err as Error).message).to.include('Failed to read file at');
      }
      expect(threw).to.be.true;
    });

    it('throws with the real failure reason when the device reports an error-typed message despite HTTP 200 (confirmed live device shape)', async () => {
      const zipPath = path.join(tmpDir, 'archive.zip');
      await fs.writeFile(zipPath, Buffer.from([0x50, 0x4b, 0x03, 0x04]));

      const { server, port } = await createTestServer(digestServer((_req, res) => {
        res.writeHead(200);
        res.end(
          '<script>var params = JSON.parse(\'{"messages":[{"text":"Application Received: 4 bytes stored.","text_type":"text","type":"success"},' +
          '{"text":"Install Failure: Script directory does not exist in plugin.","text_type":"text","type":"error"}],"packages":[]}\');</script>',
        );
      }));

      try {
        let threw = false;
        try {
          await client.installChannel('127.0.0.1', 'pw', zipPath, port);
        } catch (err) {
          threw = true;
          expect((err as Error).message).to.include('Install Failure');
        }
        expect(threw).to.be.true;
      } finally {
        await closeServer(server);
      }
    });

    it('resolves on an "identical to previous version" info-typed message (confirmed live device shape)', async () => {
      const zipPath = path.join(tmpDir, 'archive.zip');
      await fs.writeFile(zipPath, Buffer.from([0x50, 0x4b, 0x03, 0x04]));

      const { server, port } = await createTestServer(digestServer((_req, res) => {
        res.writeHead(200);
        res.end(
          '<script>var params = JSON.parse(\'{"messages":[{"text":"Application Received: Identical to previous version -- not replacing.",' +
          '"text_type":"text","type":"info"}],"packages":[]}\');</script>',
        );
      }));

      try {
        await client.installChannel('127.0.0.1', 'pw', zipPath, port);
      } finally {
        await closeServer(server);
      }
    });
  });

  describe('rekey', () => {
    it('resolves when the response reports Success.', async () => {
      const pkgBytes = Buffer.from([0x01, 0x02, 0xff]);
      const pkgPath = path.join(tmpDir, 'archive.pkg');
      await fs.writeFile(pkgPath, pkgBytes);

      let receivedBody = Buffer.alloc(0);
      const { server, port } = await createTestServer(digestServer((_req, res, body) => {
        receivedBody = body;
        res.writeHead(200);
        res.end('<font color="red">Success.</font>');
      }));

      try {
        await client.rekey('127.0.0.1', 'pw', pkgPath, 'signingPw', port);
        const text = receivedBody.toString('latin1');
        expect(text).to.include('name="mysubmit"');
        expect(text).to.include('Rekey');
        expect(text).to.include('name="passwd"');
        expect(text).to.include('signingPw');
        expect(text).to.include('filename="archive.pkg"');
      } finally {
        await closeServer(server);
      }
    });

    it('throws with the captured message on a non-success response', async () => {
      const pkgPath = path.join(tmpDir, 'archive.pkg');
      await fs.writeFile(pkgPath, Buffer.from([0x01]));

      const { server, port } = await createTestServer(digestServer((_req, res) => {
        res.writeHead(200);
        res.end('<font color="red">Bad developer key.</font>');
      }));

      try {
        let threw = false;
        try {
          await client.rekey('127.0.0.1', 'pw', pkgPath, 'signingPw', port);
        } catch (err) {
          threw = true;
          expect((err as Error).message).to.include('Rekey failed: Bad developer key.');
        }
        expect(threw).to.be.true;
      } finally {
        await closeServer(server);
      }
    });

    it('throws on the exact failure response captured live (garbage pkg + wrong password, 2026-07-04)', async () => {
      const pkgPath = path.join(tmpDir, 'archive.pkg');
      await fs.writeFile(pkgPath, Buffer.from([0x01]));

      const { server, port } = await createTestServer(digestServer((_req, res) => {
        res.writeHead(200);
        // /plugin_inspect does NOT embed a params.messages JSON blob — only the
        // legacy hidden <font> div (confirmed live: zero JSON.parse occurrences).
        res.end(
          '<div style="display:none"><font color="red">Invalid file format.: iostream error</font></div>',
        );
      }));

      try {
        let threw = false;
        try {
          await client.rekey('127.0.0.1', 'pw', pkgPath, 'wrongSigningPw', port);
        } catch (err) {
          threw = true;
          expect((err as Error).message).to.include('Invalid file format.: iostream error');
        }
        expect(threw).to.be.true;
      } finally {
        await closeServer(server);
      }
    });

    it('throws an unexpected-response error when no red-font message is found', async () => {
      const pkgPath = path.join(tmpDir, 'archive.pkg');
      await fs.writeFile(pkgPath, Buffer.from([0x01]));

      const { server, port } = await createTestServer(digestServer((_req, res) => {
        res.writeHead(200);
        res.end('<html>no status here</html>');
      }));

      try {
        let threw = false;
        try {
          await client.rekey('127.0.0.1', 'pw', pkgPath, 'signingPw', port);
        } catch (err) {
          threw = true;
          expect((err as Error).message).to.include('unexpected response');
        }
        expect(threw).to.be.true;
      } finally {
        await closeServer(server);
      }
    });
  });

  describe('validateKey', () => {
    it('reports a match when the target key id equals the current one', async () => {
      const fakeEcpClient = { queryDeviceInfo: async () => ({ 'keyed-developer-id': 'abc123' }) };
      const installer = new InstallerClient(fakeEcpClient as never);

      const result = await installer.validateKey('127.0.0.1', 'abc123');
      expect(result.matches).to.be.true;
      expect(result.currentKeyId).to.equal('abc123');
    });

    it('reports no match when the target key id differs', async () => {
      const fakeEcpClient = { queryDeviceInfo: async () => ({ 'keyed-developer-id': 'abc123' }) };
      const installer = new InstallerClient(fakeEcpClient as never);

      const result = await installer.validateKey('127.0.0.1', 'other-key');
      expect(result.matches).to.be.false;
      expect(result.currentKeyId).to.equal('abc123');
    });

    it('propagates errors thrown by queryDeviceInfo', async () => {
      const fakeEcpClient = {
        queryDeviceInfo: async () => { throw new Error('device unreachable'); },
      };
      const installer = new InstallerClient(fakeEcpClient as never);

      let threw = false;
      try {
        await installer.validateKey('127.0.0.1', 'abc123');
      } catch (err) {
        threw = true;
        expect((err as Error).message).to.equal('device unreachable');
      }
      expect(threw).to.be.true;
    });
  });

  describe('takeScreenshot', () => {
    it('triggers the capture, downloads the jpg, and writes it to destPath', async () => {
      const jpegBytes = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x80]);
      let secondGetPath = '';

      const { server, port } = await createTestServer(async (req, res) => {
        if (req.method === 'POST') {
          await readRawBody(req);
          const authorized = !!req.headers.authorization;
          if (!authorized) {
            res.writeHead(401, { 'WWW-Authenticate': DIGEST_CHALLENGE });
            res.end();
            return;
          }
          res.writeHead(200);
          res.end('<a href="pkgs/dev.jpg?time=1700000000">screenshot</a>');
          return;
        }

        // GET (screenshot download)
        const authorized = !!req.headers.authorization;
        if (!authorized) {
          res.writeHead(401, { 'WWW-Authenticate': DIGEST_CHALLENGE });
          res.end();
          return;
        }
        secondGetPath = req.url ?? '';
        res.writeHead(200);
        res.end(jpegBytes);
      });

      try {
        const destPath = path.join(tmpDir, 'screenshot.jpg');
        await client.takeScreenshot('127.0.0.1', 'pw', destPath, port);

        expect(secondGetPath).to.equal('/pkgs/dev.jpg?time=1700000000');
        const written = await fs.readFile(destPath);
        expect(Buffer.compare(written, jpegBytes)).to.equal(0);
      } finally {
        await closeServer(server);
      }
    });

    it('throws when the trigger response has no recognizable download URI', async () => {
      const { server, port } = await createTestServer(digestServer((_req, res) => {
        res.writeHead(200);
        res.end('<html>no screenshot link</html>');
      }));

      try {
        let threw = false;
        try {
          await client.takeScreenshot('127.0.0.1', 'pw', path.join(tmpDir, 'out.jpg'), port);
        } catch (err) {
          threw = true;
          expect((err as Error).message).to.include('no download URI');
        }
        expect(threw).to.be.true;
      } finally {
        await closeServer(server);
      }
    });
  });

  describe('downloadProfilingData', () => {
    it('scrapes the download link and writes the profiling payload to destPath', async () => {
      const profilingBytes = Buffer.from('profiling-bytes-not-really-binary');

      const { server, port } = await createTestServer(async (req, res) => {
        if (req.method === 'POST') {
          await readRawBody(req);
          const authorized = !!req.headers.authorization;
          if (!authorized) {
            res.writeHead(401, { 'WWW-Authenticate': DIGEST_CHALLENGE });
            res.end();
            return;
          }
          res.writeHead(200);
          res.end('<a href="pkgs/dev-profile.bin">profile</a>');
          return;
        }

        const authorized = !!req.headers.authorization;
        if (!authorized) {
          res.writeHead(401, { 'WWW-Authenticate': DIGEST_CHALLENGE });
          res.end();
          return;
        }
        res.writeHead(200);
        res.end(profilingBytes);
      });

      try {
        const destPath = path.join(tmpDir, 'profile.bin');
        await client.downloadProfilingData('127.0.0.1', 'pw', destPath, port);

        const written = await fs.readFile(destPath);
        expect(Buffer.compare(written, profilingBytes)).to.equal(0);
      } finally {
        await closeServer(server);
      }
    });

    it('throws when no download link is found (unverified response shape)', async () => {
      const { server, port } = await createTestServer(digestServer((_req, res) => {
        res.writeHead(200);
        res.end('<html>nothing here</html>');
      }));

      try {
        let threw = false;
        try {
          await client.downloadProfilingData('127.0.0.1', 'pw', path.join(tmpDir, 'profile.bin'), port);
        } catch (err) {
          threw = true;
          expect((err as Error).message).to.include('could not find a download link');
        }
        expect(threw).to.be.true;
      } finally {
        await closeServer(server);
      }
    });
  });

  describe('packageChannel', () => {
    it('installs the zip first, then packages it and downloads the signed .pkg', async () => {
      const zipBytes = Buffer.from([0x50, 0x4b, 0x03, 0x04]);
      const zipPath = path.join(tmpDir, 'archive.zip');
      await fs.writeFile(zipPath, zipBytes);

      const pkgBytes = Buffer.from([0x99, 0x88, 0x77]);
      const requestOrder: string[] = [];
      let packageFields = '';

      const { server, port } = await createTestServer(async (req, res) => {
        if (req.method === 'POST') {
          const body = await readRawBody(req);
          const authorized = !!req.headers.authorization;
          if (!authorized) {
            res.writeHead(401, { 'WWW-Authenticate': DIGEST_CHALLENGE });
            res.end();
            return;
          }
          requestOrder.push(req.url ?? '');
          if (req.url === '/plugin_install') {
            res.writeHead(200);
            res.end('OK');
            return;
          }
          if (req.url === '/plugin_package') {
            packageFields = body.toString('latin1');
            res.writeHead(200);
            res.end('<a href="pkgs/myapp.pkg">download</a>');
            return;
          }
          res.writeHead(404);
          res.end();
          return;
        }

        // GET (signed pkg download)
        const authorized = !!req.headers.authorization;
        if (!authorized) {
          res.writeHead(401, { 'WWW-Authenticate': DIGEST_CHALLENGE });
          res.end();
          return;
        }
        res.writeHead(200);
        res.end(pkgBytes);
      });

      try {
        const destPkgPath = path.join(tmpDir, 'signed.pkg');
        await client.packageChannel('127.0.0.1', 'pw', zipPath, 'MyApp/1.0', 'signingPw', destPkgPath, port);

        expect(requestOrder).to.deep.equal(['/plugin_install', '/plugin_package']);
        expect(packageFields).to.include('name="app_name"');
        expect(packageFields).to.include('MyApp/1.0');
        expect(packageFields).to.include('name="passwd"');
        expect(packageFields).to.include('signingPw');
        expect(packageFields).to.include('name="pkg_time"');

        const written = await fs.readFile(destPkgPath);
        expect(Buffer.compare(written, pkgBytes)).to.equal(0);
      } finally {
        await closeServer(server);
      }
    });

    it('throws with the captured reason when packaging fails', async () => {
      const zipPath = path.join(tmpDir, 'archive.zip');
      await fs.writeFile(zipPath, Buffer.from([0x50, 0x4b]));

      const { server, port } = await createTestServer(async (req, res) => {
        const body = await readRawBody(req);
        const authorized = !!req.headers.authorization;
        if (!authorized) {
          res.writeHead(401, { 'WWW-Authenticate': DIGEST_CHALLENGE });
          res.end();
          return;
        }
        if (req.url === '/plugin_install') {
          res.writeHead(200);
          res.end('OK');
          return;
        }
        void body;
        res.writeHead(200);
        res.end('<font color="red">Failed: bad signing password</font>');
      });

      try {
        let threw = false;
        try {
          await client.packageChannel('127.0.0.1', 'pw', zipPath, 'MyApp/1.0', 'wrongSigningPw', path.join(tmpDir, 'out.pkg'), port);
        } catch (err) {
          threw = true;
          expect((err as Error).message).to.include('Package failed: bad signing password');
        }
        expect(threw).to.be.true;
      } finally {
        await closeServer(server);
      }
    });

    it('throws on the exact failure response captured live (wrong signing password, 2026-07-04)', async () => {
      const zipPath = path.join(tmpDir, 'archive.zip');
      await fs.writeFile(zipPath, Buffer.from([0x50, 0x4b]));

      const { server, port } = await createTestServer(async (req, res) => {
        await readRawBody(req);
        const authorized = !!req.headers.authorization;
        if (!authorized) {
          res.writeHead(401, { 'WWW-Authenticate': DIGEST_CHALLENGE });
          res.end();
          return;
        }
        if (req.url === '/plugin_install') {
          res.writeHead(200);
          res.end('OK');
          return;
        }
        res.writeHead(200);
        // Confirmed live: /plugin_package reports failure via BOTH the legacy
        // font tag AND the params.messages JSON array (unlike /plugin_inspect,
        // which only has the font tag) — ensureOk's messages check runs first.
        res.end(
          '<div style="display:none"><font color="red">Failed: Invalid Password.</font></div>' +
          '<script>var params = JSON.parse(\'{"messages":[{"text":"Failed: Invalid Password.",' +
          '"text_type":"text","type":"error"}]}\');</script>',
        );
      });

      try {
        let threw = false;
        try {
          await client.packageChannel('127.0.0.1', 'pw', zipPath, 'MyApp/1.0', 'wrongSigningPw', path.join(tmpDir, 'out.pkg'), port);
        } catch (err) {
          threw = true;
          expect((err as Error).message).to.include('Invalid Password.');
        }
        expect(threw).to.be.true;
      } finally {
        await closeServer(server);
      }
    });
  });

  describe('packageInstalledChannel', () => {
    it('packages and downloads the already-installed channel without ever hitting /plugin_install', async () => {
      const pkgBytes = Buffer.from([0x99, 0x88, 0x77]);
      const requestOrder: string[] = [];
      let packageFields = '';

      const { server, port } = await createTestServer(async (req, res) => {
        if (req.method === 'POST') {
          const body = await readRawBody(req);
          const authorized = !!req.headers.authorization;
          if (!authorized) {
            res.writeHead(401, { 'WWW-Authenticate': DIGEST_CHALLENGE });
            res.end();
            return;
          }
          requestOrder.push(req.url ?? '');
          if (req.url === '/plugin_package') {
            packageFields = body.toString('latin1');
            res.writeHead(200);
            res.end('<a href="pkgs/myapp.pkg">download</a>');
            return;
          }
          res.writeHead(404);
          res.end();
          return;
        }

        // GET (signed pkg download)
        const authorized = !!req.headers.authorization;
        if (!authorized) {
          res.writeHead(401, { 'WWW-Authenticate': DIGEST_CHALLENGE });
          res.end();
          return;
        }
        res.writeHead(200);
        res.end(pkgBytes);
      });

      try {
        const destPkgPath = path.join(tmpDir, 'signed.pkg');
        await client.packageInstalledChannel('127.0.0.1', 'pw', 'MyApp/1.0', 'signingPw', destPkgPath, port);

        expect(requestOrder).to.deep.equal(['/plugin_package']);
        expect(packageFields).to.include('name="app_name"');
        expect(packageFields).to.include('MyApp/1.0');
        expect(packageFields).to.include('name="passwd"');
        expect(packageFields).to.include('signingPw');
        expect(packageFields).to.include('name="pkg_time"');

        const written = await fs.readFile(destPkgPath);
        expect(Buffer.compare(written, pkgBytes)).to.equal(0);
      } finally {
        await closeServer(server);
      }
    });

    it('throws with the captured reason when packaging fails', async () => {
      const { server, port } = await createTestServer(async (req, res) => {
        const body = await readRawBody(req);
        const authorized = !!req.headers.authorization;
        if (!authorized) {
          res.writeHead(401, { 'WWW-Authenticate': DIGEST_CHALLENGE });
          res.end();
          return;
        }
        void body;
        res.writeHead(200);
        res.end('<font color="red">Failed: bad signing password</font>');
      });

      try {
        let threw = false;
        try {
          await client.packageInstalledChannel('127.0.0.1', 'pw', 'MyApp/1.0', 'wrongSigningPw', path.join(tmpDir, 'out.pkg'), port);
        } catch (err) {
          threw = true;
          expect((err as Error).message).to.include('Package failed: bad signing password');
        }
        expect(threw).to.be.true;
      } finally {
        await closeServer(server);
      }
    });
  });

  describe('checkForUpdate', () => {
    it('sends mysubmit=CheckUpdate to /plugin_swup and resolves on 200', async () => {
      let receivedPath = '';
      let receivedBody = '';
      const { server, port } = await createTestServer(digestServer((req, res, body) => {
        receivedPath = req.url ?? '';
        receivedBody = body.toString();
        res.writeHead(200);
        res.end('OK');
      }));

      try {
        await client.checkForUpdate('127.0.0.1', 'pw', port);
        expect(receivedPath).to.equal('/plugin_swup');
        expect(receivedBody).to.include('CheckUpdate');
      } finally {
        await closeServer(server);
      }
    });
  });

  describe('reboot', () => {
    it('sends mysubmit=Reboot to /plugin_swup and resolves on 200', async () => {
      let receivedBody = '';
      const { server, port } = await createTestServer(digestServer((_req, res, body) => {
        receivedBody = body.toString();
        res.writeHead(200);
        res.end('OK');
      }));

      try {
        await client.reboot('127.0.0.1', 'pw', port);
        expect(receivedBody).to.include('Reboot');
      } finally {
        await closeServer(server);
      }
    });

    it('resolves (does not throw) when the device drops the connection instead of responding', async () => {
      let callCount = 0;
      const { server, port } = await createTestServer(async (req, res) => {
        callCount++;
        await readRawBody(req);
        if (callCount === 1) {
          res.writeHead(401, { 'WWW-Authenticate': DIGEST_CHALLENGE });
          res.end();
        } else {
          req.socket.destroy();
        }
      });

      try {
        let threw = false;
        try {
          await client.reboot('127.0.0.1', 'pw', port);
        } catch {
          threw = true;
        }
        expect(threw).to.be.false;
      } finally {
        await closeServer(server);
      }
    });

    it('still throws on a genuine failure (persistent 401)', async () => {
      const { server, port } = await createTestServer((_req, res) => {
        res.writeHead(401, { 'WWW-Authenticate': DIGEST_CHALLENGE });
        res.end();
      });

      try {
        let threw = false;
        try {
          await client.reboot('127.0.0.1', 'wrongpw', port);
        } catch (err) {
          threw = true;
          expect((err as Error).message).to.include('Authentication failed');
        }
        expect(threw).to.be.true;
      } finally {
        await closeServer(server);
      }
    });
  });
});
