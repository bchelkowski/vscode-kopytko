import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { fork, execSync } from 'child_process';

export interface BreakpointInjection {
  /** Absolute path to the source file */
  filePath: string;
  /** 1-indexed line numbers where `stop` should be inserted */
  lines: number[];
}

export interface DeployOptions {
  rootDir: string;
  host: string;
  password: string;
  env?: string;
  breakpoints?: BreakpointInjection[];
  onOutput?: (message: string) => void;
}

/**
 * Builds the project using kopytko-packager (reads .kopytkorc, runs plugins,
 * generates manifest), optionally injects `stop` statements for breakpoints,
 * then deploys the resulting zip to the Roku device.
 */
export async function deploy(options: DeployOptions): Promise<void> {
  const { rootDir, host, password, env = 'dev', breakpoints = [], onOutput } = options;
  const log = onOutput ?? (() => {});

  // 1. Build using kopytko-packager (reads .kopytkorc, runs plugins, archives)
  log('Building with kopytko-packager…');
  const archivePath = await runKopytkoBuild(rootDir, env, log);

  // 2. If breakpoints are set, inject `stop` statements into the archive
  if (breakpoints.length > 0) {
    log('Injecting breakpoints…');
    await injectBreakpointsIntoArchive(archivePath, rootDir, breakpoints, env);
  }

  // 3. Deploy to Roku using kopytko-packager's AppDeployer (digest auth)
  log(`Deploying to ${host}…`);
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const AppDeployer = require('@dazn/kopytko-packager/src/core/app-deployer');
  const deployer = new AppDeployer({ rokuIP: host, rokuDevUser: 'rokudev', rokuDevPassword: password });
  await deployer.uninstallCurrentApp();
  await deployer.installApp(path.resolve(rootDir, archivePath));
  log('Deploy successful.');
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

/**
 * Injects `stop` statements into .brs files inside the built archive.
 * Unpacks the zip, modifies files, and re-archives.
 */
async function injectBreakpointsIntoArchive(
  archivePath: string,
  rootDir: string,
  breakpoints: BreakpointInjection[],
  env: string,
): Promise<void> {
  // Read sourceDir from .kopytkorc to compute relative paths
  let sourceDir = 'app';
  const rcPath = path.join(rootDir, '.kopytkorc');
  if (fs.existsSync(rcPath)) {
    try {
      const rc = JSON.parse(fs.readFileSync(rcPath, 'utf-8'));
      const envConfig = rc.environments?.[env] ?? {};
      sourceDir = (envConfig.sourceDir ?? rc.sourceDir ?? '/app').replace(/^\//, '');
    } catch { /* use default */ }
  }

  const fullArchivePath = path.resolve(rootDir, archivePath);
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kopytko-bp-'));

  try {
    // Unzip
    execSync(`unzip -o "${fullArchivePath}" -d "${tempDir}"`, { stdio: 'pipe' });

    // Inject stops
    for (const bp of breakpoints) {
      const rel = path.relative(path.join(rootDir, sourceDir), bp.filePath);
      const tempFile = path.join(tempDir, rel);
      if (!fs.existsSync(tempFile)) continue;

      const lines = fs.readFileSync(tempFile, 'utf8').split('\n');
      const sorted = [...new Set(bp.lines)].sort((a, b) => b - a);
      for (const lineNum of sorted) {
        const idx = lineNum - 1;
        if (idx >= 0 && idx < lines.length) {
          lines.splice(idx, 0, 'stop');
        }
      }
      fs.writeFileSync(tempFile, lines.join('\n'), 'utf8');
    }

    // Re-archive
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const Archiver = require('@dazn/kopytko-packager/src/core/archiver');
    fs.unlinkSync(fullArchivePath);
    await new Archiver().archive(fullArchivePath, tempDir);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}
