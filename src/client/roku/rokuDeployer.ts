import * as fs from 'fs';
import * as path from 'path';
import { exec } from 'child_process';

export interface DeployOptions {
  rootDir: string;
  host: string;
  password: string;
  env?: string;
  /** Command to run for build+deploy. Default: 'npx kopytko start'. */
  startCommand?: string;
  onOutput?: (message: string) => void;
}

interface ManifestBackup {
  /** Project root directory. */
  rootDir: string;
  /** Absolute path to the local manifest override file. */
  manifestPath: string;
  /** Original file content, or undefined if the file didn't exist. */
  originalContent: string | undefined;
  /** Whether we modified .kopytkorc to add localManifestOverride. */
  modifiedKopytkorc: boolean;
  /** Original .kopytkorc content, if we modified it. */
  originalKopytkorc: string | undefined;
}

const DEBUG_MANIFEST_ENTRIES = `module.exports = { remotedebug: 1, remotedebug_connect_early: 1 };\n`;
const DEBUG_MANIFEST_FILENAME = 'kopytko-debug-local.js';
const DEFAULT_MANIFEST_DIR = 'manifest';
const DEFAULT_START_COMMAND = 'npx kopytko start';

/**
 * Builds and deploys the project to a Roku device with debug support enabled.
 *
 * 1. Injects `remotedebug=1` and `remotedebug_connect_early=1` into the
 *    project's local manifest override file (from `.kopytkorc`).
 * 2. Runs `kopytko start` (configurable) which builds and deploys using
 *    the project's own `@dazn/kopytko-packager`.
 * 3. Restores the original manifest override file.
 */
export async function deploy(options: DeployOptions): Promise<void> {
  const { rootDir, host, password, env = 'dev', onOutput } = options;
  const startCommand = options.startCommand || DEFAULT_START_COMMAND;
  const log = onOutput ?? (() => {});

  const backup = await injectDebugManifest(rootDir, env, log);

  try {
    log(`Running: ${startCommand}`);
    await runKopytkoStart(rootDir, startCommand, host, password, env, log);
    log('Build and deploy successful.');
  } finally {
    await restoreManifest(backup, log);
  }
}

/**
 * Injects debug manifest entries (`remotedebug=1`, `remotedebug_connect_early=1`)
 * into the project's local manifest override file.
 *
 * If `.kopytkorc` has `localManifestOverride` configured, modifies that file.
 * Otherwise, creates a new manifest file and temporarily adds the
 * `localManifestOverride` entry to `.kopytkorc`.
 */
async function injectDebugManifest(
  rootDir: string,
  env: string,
  log: (msg: string) => void,
): Promise<ManifestBackup> {
  const rcPath = path.join(rootDir, '.kopytkorc');
  const rc = readKopytkorc(rcPath);

  if (rc && typeof rc.localManifestOverride === 'string') {
    return injectIntoExistingOverride(rootDir, rc.localManifestOverride, env, log);
  }

  return injectWithNewOverride(rootDir, rcPath, rc, log);
}

/**
 * Case A: `.kopytkorc` has `localManifestOverride` configured.
 * Back up the existing file (if any) and write debug entries merged with the original.
 */
function injectIntoExistingOverride(
  rootDir: string,
  overridePath: string,
  env: string,
  log: (msg: string) => void,
): ManifestBackup {
  const resolvedPath = resolveManifestTemplate(overridePath, env);
  const absPath = path.join(rootDir, resolvedPath);

  let originalContent: string | undefined;

  if (fs.existsSync(absPath)) {
    originalContent = fs.readFileSync(absPath, 'utf-8');
    log(`Injecting debug manifest into existing ${resolvedPath}`);

    const debugContent = wrapExistingManifest(originalContent, absPath);
    fs.writeFileSync(absPath, debugContent, 'utf-8');
  } else {
    log(`Creating debug manifest at ${resolvedPath}`);
    ensureDirectory(path.dirname(absPath));
    fs.writeFileSync(absPath, DEBUG_MANIFEST_ENTRIES, 'utf-8');
  }

  return {
    rootDir,
    manifestPath: absPath,
    originalContent,
    modifiedKopytkorc: false,
    originalKopytkorc: undefined,
  };
}

/**
 * Case B: `.kopytkorc` has no `localManifestOverride`.
 * Create a debug manifest file and temporarily add the entry to `.kopytkorc`.
 */
function injectWithNewOverride(
  rootDir: string,
  rcPath: string,
  rc: Record<string, unknown> | null,
  log: (msg: string) => void,
): ManifestBackup {
  const manifestRelPath = `/${DEFAULT_MANIFEST_DIR}/${DEBUG_MANIFEST_FILENAME}`;
  const absPath = path.join(rootDir, manifestRelPath);

  log(`No localManifestOverride configured — creating ${manifestRelPath}`);
  ensureDirectory(path.dirname(absPath));
  fs.writeFileSync(absPath, DEBUG_MANIFEST_ENTRIES, 'utf-8');

  const originalKopytkorc = fs.existsSync(rcPath)
    ? fs.readFileSync(rcPath, 'utf-8')
    : undefined;

  const updatedRc = { ...(rc ?? {}), localManifestOverride: manifestRelPath };
  fs.writeFileSync(rcPath, JSON.stringify(updatedRc, null, 2), 'utf-8');

  return {
    rootDir,
    manifestPath: absPath,
    originalContent: undefined,
    modifiedKopytkorc: true,
    originalKopytkorc,
  };
}

/**
 * Restores the original manifest override file and `.kopytkorc` if modified.
 */
async function restoreManifest(backup: ManifestBackup, log: (msg: string) => void): Promise<void> {
  try {
    if (backup.originalContent !== undefined) {
      fs.writeFileSync(backup.manifestPath, backup.originalContent, 'utf-8');
      log('Restored original local manifest override.');
    } else if (fs.existsSync(backup.manifestPath)) {
      fs.unlinkSync(backup.manifestPath);
      log('Removed debug manifest file.');
      // Also clean up any backup file created by wrapExistingManifest
      const backupFile = backup.manifestPath + '.kopytko-debug-backup.js';
      if (fs.existsSync(backupFile)) {
        fs.unlinkSync(backupFile);
      }
    }

    if (backup.modifiedKopytkorc) {
      const rcPath = path.join(backup.rootDir, '.kopytkorc');
      if (backup.originalKopytkorc !== undefined) {
        fs.writeFileSync(rcPath, backup.originalKopytkorc, 'utf-8');
      }
      log('Restored original .kopytkorc.');
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log(`Warning: failed to restore manifest: ${msg}`);
  }
}

/**
 * Wraps an existing manifest override file to merge debug entries.
 * Generates a module that re-exports the original content with
 * `remotedebug` and `remotedebug_connect_early` added.
 */
function wrapExistingManifest(originalContent: string, absPath: string): string {
  // Check if the original file uses a simple `module.exports = { ... }` pattern
  // If so, we can inject entries directly. Otherwise, use a wrapper approach.
  const simpleExportMatch = originalContent.match(
    /^([\s\S]*module\.exports\s*=\s*\{)([\s\S]*?)(\};?\s*)$/,
  );

  if (simpleExportMatch) {
    const [, before, middle, after] = simpleExportMatch;
    const trimmed = middle.trimEnd();
    const needsComma = trimmed.length > 0 && !trimmed.endsWith(',');
    return `${before}${middle}${needsComma ? ',' : ''}\n  remotedebug: 1,\n  remotedebug_connect_early: 1,\n${after}`;
  }

  // Complex file — create a backup and wrap it
  const backupPath = absPath + '.kopytko-debug-backup.js';
  fs.writeFileSync(backupPath, originalContent, 'utf-8');

  const backupRelative = './' + path.basename(backupPath);
  return [
    `// Generated by vscode-kopytko for debug session`,
    `const original = require('${backupRelative}');`,
    `module.exports = { ...original, remotedebug: 1, remotedebug_connect_early: 1 };`,
    '',
  ].join('\n');
}

/**
 * Runs `kopytko start` (or a custom command) to build and deploy the project.
 */
function runKopytkoStart(
  rootDir: string,
  command: string,
  host: string,
  password: string,
  env: string,
  log: (msg: string) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = exec(`${command} ${env}`, {
      cwd: rootDir,
      env: {
        ...process.env,
        ENV: env,
        ROKU_IP: host,
        ROKU_DEV_PASSWORD: password,
        ROKU_DEV_USER: 'rokudev',
      },
    });

    child.stdout?.on('data', (data: string | Buffer) => {
      const text = data.toString().trim();
      if (text) log(text);
    });
    child.stderr?.on('data', (data: string | Buffer) => {
      const text = data.toString().trim();
      if (text) log(`[stderr] ${text}`);
    });

    child.on('exit', (code) => {
      if (code !== 0) {
        reject(new Error(`kopytko start exited with code ${code}`));
        return;
      }
      resolve();
    });

    child.on('error', reject);
  });
}

// ── Helpers ────────────────────────────────────────────────────────────────

function readKopytkorc(rcPath: string): Record<string, unknown> | null {
  if (!fs.existsSync(rcPath)) return null;
  try {
    return JSON.parse(fs.readFileSync(rcPath, 'utf-8'));
  } catch {
    return null;
  }
}

function resolveManifestTemplate(templatePath: string, env: string): string {
  return templatePath.replace(/\$\{args\.env\}/g, env);
}

function ensureDirectory(dirPath: string): void {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

