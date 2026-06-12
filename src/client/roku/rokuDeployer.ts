import * as fs from 'fs';
import * as path from 'path';
import { fork } from 'child_process';

export interface DeployOptions {
  rootDir: string;
  host: string;
  password: string;
  env?: string;
  /** Enable the socket-based debug protocol (remotedebug=1). Default true. */
  remoteDebug?: boolean;
  onOutput?: (message: string) => void;
}

/**
 * Builds the project using kopytko-packager (reads .kopytkorc, runs plugins,
 * generates manifest), then deploys the resulting zip to the Roku device
 * with the socket-based debug protocol enabled.
 */
export async function deploy(options: DeployOptions): Promise<void> {
  const { rootDir, host, password, env = 'dev', remoteDebug = true, onOutput } = options;
  const log = onOutput ?? (() => {});

  // 1. Build using kopytko-packager (reads .kopytkorc, runs plugins, archives)
  log('Building with kopytko-packager…');
  const archivePath = await runKopytkoBuild(rootDir, env, log);

  // 2. Uninstall current app (ignore errors if none installed)
  log(`Deploying to ${host}…`);
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const AppDeployer = require('@dazn/kopytko-packager/src/core/app-deployer');
  const deployer = new AppDeployer({ rokuIP: host, rokuDevUser: 'rokudev', rokuDevPassword: password });
  await deployer.uninstallCurrentApp();

  // 3. Install with remotedebug flags for the socket-based debugger
  if (remoteDebug) {
    await installWithRemoteDebug(host, password, path.resolve(rootDir, archivePath));
  } else {
    await deployer.installApp(path.resolve(rootDir, archivePath));
  }

  log('Deploy successful.');
}

/**
 * Installs the app archive with `remotedebug=1` and `remotedebug_connect_early=1`
 * form fields, enabling the socket-based debug protocol on port 8081.
 * Uses kopytko-packager's digest auth utilities directly since AppDeployer
 * doesn't support extra form fields.
 */
async function installWithRemoteDebug(host: string, password: string, archivePath: string): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { postFormWithDigestAuth } = require('@dazn/kopytko-packager/src/core/digest-auth');

  const fields = [
    { name: 'mysubmit', value: 'Replace' },
    { name: 'archive', value: fs.readFileSync(archivePath), filename: 'archive.zip', contentType: 'application/octet-stream' },
    { name: 'remotedebug', value: '1' },
    { name: 'remotedebug_connect_early', value: '1' },
  ];

  const response = await postFormWithDigestAuth(
    `http://${host}/plugin_install`,
    fields,
    { user: 'rokudev', pass: password },
    { resolveWithFullResponse: true },
  );

  if (response.body && response.body.includes('Install Failure')) {
    const messageMatch = /'Set message content', '([^']+)'/g;
    const messages = Array.from(response.body.matchAll(messageMatch), (m: RegExpMatchArray) => m[1]);
    throw new Error(`Install failed: ${messages.join(' ') || 'unknown error'}`);
  }
}

/**
 * Runs `kopytko-packager` build script in a child process with the correct
 * working directory and environment. This ensures `.kopytkorc` is read,
 * plugins are executed, and the archive is created at the configured path.
 */
function runKopytkoBuild(rootDir: string, env: string, log: (msg: string) => void): Promise<string> {
  return new Promise((resolve, reject) => {
    const buildScript = require.resolve('@dazn/kopytko-packager/scripts/build.js');

    const child = fork(buildScript, [env], {
      cwd: rootDir,
      env: { ...process.env, ENV: env },
      silent: true,
    });

    child.stdout?.on('data', (data: Buffer) => {
      const text = data.toString().trim();
      if (text) log(text);
    });
    child.stderr?.on('data', (data: Buffer) => {
      const text = data.toString().trim();
      if (text) log(`[stderr] ${text}`);
    });

    child.on('exit', (code) => {
      if (code !== 0) {
        reject(new Error(`kopytko build exited with code ${code}`));
        return;
      }

      // Read the archive path from .kopytkorc (or use default)
      const archivePath = readArchivePath(rootDir, env);
      const fullPath = path.resolve(rootDir, archivePath);

      if (!fs.existsSync(fullPath)) {
        reject(new Error(`Build completed but archive not found at ${fullPath}`));
        return;
      }

      resolve(archivePath);
    });

    child.on('error', reject);
  });
}

/**
 * Reads the archive path from .kopytkorc, falling back to the default.
 */
function readArchivePath(rootDir: string, _env: string): string {
  const rcPath = path.join(rootDir, '.kopytkorc');
  if (fs.existsSync(rcPath)) {
    try {
      const rc = JSON.parse(fs.readFileSync(rcPath, 'utf-8'));
      if (rc.archivePath) {
        // Simple template resolution for common patterns
        return rc.archivePath
          .replace(/\$\{[^}]+\}/g, 'dev')
          .replace(/^\//, '');
      }
    } catch { /* use default */ }
  }
  return 'dist/kopytko_archive.zip';
}

