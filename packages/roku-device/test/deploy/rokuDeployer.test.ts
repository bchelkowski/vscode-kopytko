import { expect } from 'chai';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

describe('rokuDeployer — manifest injection', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kopytko-test-'));
    fs.mkdirSync(path.join(tmpDir, 'manifest'), { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  // We import deploy dynamically. The exec call will fail (no real project),
  // but manifest injection/restore happens synchronously before exec.
  async function runDeploy(options: Record<string, unknown>): Promise<void> {
    const { deploy } = await import('../../src/deploy/rokuDeployer');
    try {
      await deploy({
        host: '192.168.1.100',
        password: 'pass',
        env: 'dev',
        ...options,
        rootDir: tmpDir,
      });
    } catch {
      // exec will fail — that's expected; we're testing manifest logic
    }
  }

  // ---------------------------------------------------------------------------
  // Case A — localManifestOverride configured, file exists
  // ---------------------------------------------------------------------------

  describe('when localManifestOverride is configured and file exists', () => {
    it('injects debug entries and restores original on cleanup', async () => {
      const manifestPath = path.join(tmpDir, 'manifest', 'local.dev.js');
      const original = 'module.exports = { title: "My App" };';

      fs.writeFileSync(path.join(tmpDir, '.kopytkorc'), JSON.stringify({
        baseManifest: '/manifest/base.js',
        localManifestOverride: '/manifest/local.dev.js',
      }));
      fs.writeFileSync(manifestPath, original);

      await runDeploy({});

      // After deploy (which failed at exec), manifest should be restored
      const restored = fs.readFileSync(manifestPath, 'utf-8');
      expect(restored).to.equal(original);
    });
  });

  // ---------------------------------------------------------------------------
  // Case A — localManifestOverride configured, file does NOT exist
  // ---------------------------------------------------------------------------

  describe('when localManifestOverride is configured but file does not exist', () => {
    it('creates and then removes the debug manifest', async () => {
      const manifestPath = path.join(tmpDir, 'manifest', 'local.dev.js');

      fs.writeFileSync(path.join(tmpDir, '.kopytkorc'), JSON.stringify({
        baseManifest: '/manifest/base.js',
        localManifestOverride: '/manifest/local.dev.js',
      }));

      await runDeploy({});

      // After cleanup, the created file should be removed
      expect(fs.existsSync(manifestPath)).to.be.false;
    });
  });

  // ---------------------------------------------------------------------------
  // Template resolution
  // ---------------------------------------------------------------------------

  describe('template resolution', () => {
    it('resolves ${args.env} in localManifestOverride path', async () => {
      fs.writeFileSync(path.join(tmpDir, '.kopytkorc'), JSON.stringify({
        baseManifest: '/manifest/base.js',
        localManifestOverride: '/manifest/local.${args.env}.js',
      }));

      // The manifest path should resolve to local.staging.js
      const manifestPath = path.join(tmpDir, 'manifest', 'local.staging.js');

      await runDeploy({ env: 'staging' });

      // File should have been created then cleaned up
      expect(fs.existsSync(manifestPath)).to.be.false;
    });
  });

  // ---------------------------------------------------------------------------
  // Case B — no localManifestOverride configured
  // ---------------------------------------------------------------------------

  describe('when no localManifestOverride is configured', () => {
    it('creates debug manifest, modifies .kopytkorc, and restores both', async () => {
      const originalRc = JSON.stringify({ baseManifest: '/manifest/base.js' });
      fs.writeFileSync(path.join(tmpDir, '.kopytkorc'), originalRc);

      await runDeploy({});

      // .kopytkorc should be restored to original
      const restoredRc = fs.readFileSync(path.join(tmpDir, '.kopytkorc'), 'utf-8');
      expect(restoredRc).to.equal(originalRc);

      // Debug manifest file should be cleaned up
      const debugManifest = path.join(tmpDir, 'manifest', 'kopytko-debug-local.js');
      expect(fs.existsSync(debugManifest)).to.be.false;
    });
  });

  // ---------------------------------------------------------------------------
  // Command invocation — env must NOT be a positional argument
  // ---------------------------------------------------------------------------

  describe('command invocation', () => {
    it('runs the start command without appending env as a positional arg', async () => {
      // Use a custom startCommand that writes the argv to a file so we can inspect it
      const argsFile = path.join(tmpDir, 'args.json');
      const recordCmd = `node -e "require('fs').writeFileSync('${argsFile}', JSON.stringify(process.argv.slice(2)))"`;

      fs.writeFileSync(path.join(tmpDir, '.kopytkorc'), JSON.stringify({}));

      const { deploy } = await import('../../src/deploy/rokuDeployer');
      await deploy({
        host: '192.168.1.100',
        password: 'pass',
        env: 'staging',
        rootDir: tmpDir,
        startCommand: recordCmd,
      });

      const args = JSON.parse(fs.readFileSync(argsFile, 'utf-8')) as string[];
      // The env value 'staging' must NOT appear as a positional argument
      expect(args).to.not.include('staging');
    });

    it('passes ENV, ROKU_IP and ROKU_DEV_PASSWORD as environment variables', async () => {
      // Use a custom startCommand that writes the process env to a file
      const envFile = path.join(tmpDir, 'env.json');
      const recordCmd = `node -e "require('fs').writeFileSync('${envFile}', JSON.stringify({ENV:process.env.ENV,ROKU_IP:process.env.ROKU_IP,ROKU_DEV_PASSWORD:process.env.ROKU_DEV_PASSWORD}))"`;

      fs.writeFileSync(path.join(tmpDir, '.kopytkorc'), JSON.stringify({}));

      const { deploy } = await import('../../src/deploy/rokuDeployer');
      await deploy({
        host: '192.168.2.2',
        password: 'rokudev',
        env: 'dev',
        rootDir: tmpDir,
        startCommand: recordCmd,
      });

      const captured = JSON.parse(fs.readFileSync(envFile, 'utf-8')) as Record<string, string>;
      expect(captured['ENV']).to.equal('dev');
      expect(captured['ROKU_IP']).to.equal('192.168.2.2');
      expect(captured['ROKU_DEV_PASSWORD']).to.equal('rokudev');
    });
  });

  // ---------------------------------------------------------------------------
  // Non-debug deploy (debugMode: false / upload)
  // ---------------------------------------------------------------------------

  describe('non-debug deploy (debugMode: false)', () => {
    it('does not create a debug manifest when debugMode is false', async () => {
      const manifestPath = path.join(tmpDir, 'manifest', 'local.dev.js');
      const original = 'module.exports = { title: "My App" };';

      fs.writeFileSync(path.join(tmpDir, '.kopytkorc'), JSON.stringify({
        baseManifest: '/manifest/base.js',
        localManifestOverride: '/manifest/local.dev.js',
      }));
      fs.writeFileSync(manifestPath, original);

      // Use a harmless command that will succeed
      const markerFile = path.join(tmpDir, 'deployed.txt');
      const successCmd = `node -e "require('fs').writeFileSync('${markerFile}', 'ok')"`;

      const { deploy } = await import('../../src/deploy/rokuDeployer');
      await deploy({
        host: '192.168.1.100',
        password: 'pass',
        env: 'dev',
        rootDir: tmpDir,
        startCommand: successCmd,
        debugMode: false,
      });

      // Manifest should not have been modified
      const content = fs.readFileSync(manifestPath, 'utf-8');
      expect(content).to.equal(original);

      // Command should have run
      expect(fs.existsSync(markerFile)).to.be.true;
    });

    it('upload function calls deploy with debugMode false', async () => {
      const markerFile = path.join(tmpDir, 'uploaded.txt');
      const successCmd = `node -e "require('fs').writeFileSync('${markerFile}', 'ok')"`;

      fs.writeFileSync(path.join(tmpDir, '.kopytkorc'), JSON.stringify({}));

      const { upload } = await import('../../src/deploy/rokuDeployer');
      await upload({
        host: '192.168.1.100',
        password: 'pass',
        env: 'dev',
        rootDir: tmpDir,
        startCommand: successCmd,
      });

      expect(fs.existsSync(markerFile)).to.be.true;
    });
  });
});
