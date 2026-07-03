import * as fs from 'fs';
import * as path from 'path';
import { exec } from 'child_process';

export interface DeployOptions {
  rootDir: string;
  host: string;
  password: string;
  env?: string;
  /** Skip debug manifest injection (remotedebug=1). Default: false. */
  debugMode?: boolean;
  /** Command to run for build+deploy. Default: 'npx kopytko start'. */
  startCommand?: string;
  onOutput?: (message: string) => void;
}

export type PerfettoDeployOptions = Omit<DeployOptions, 'debugMode'>;

type ManifestOverrides = Record<string, number | string | boolean>;

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

const DEBUG_OVERRIDES: ManifestOverrides = { remotedebug: 1, remotedebug_connect_early: 1 };
const DEBUG_MANIFEST_FILENAME = 'kopytko-debug-local.js';
const PERFETTO_OVERRIDES: ManifestOverrides = { run_as_process: 1 };
const PERFETTO_MANIFEST_FILENAME = 'kopytko-perfetto-local.js';
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
  const debugMode = options.debugMode !== false;
  const startCommand = options.startCommand || DEFAULT_START_COMMAND;
  const log = onOutput ?? (() => {});

  if (!debugMode) {
    log(`Running: ${startCommand}`);
    await runKopytkoStart(rootDir, startCommand, host, password, env, log);
    log('Build and deploy successful.');
    return;
  }

  const backup = await injectManifest(rootDir, env, log, DEBUG_OVERRIDES, DEBUG_MANIFEST_FILENAME);

  try {
    log(`Running: ${startCommand}`);
    await runKopytkoStart(rootDir, startCommand, host, password, env, log);
    log('Build and deploy successful.');
  } finally {
    await restoreManifest(backup, log);
  }
}

/**
 * Builds and deploys the project with `run_as_process=1` injected into the
 * local manifest override — required for Roku Perfetto app tracing (firmware 15.2+).
 *
 * Restores the original manifest in a `finally` block, even on failure.
 */
export async function deployForPerfetto(options: PerfettoDeployOptions): Promise<void> {
  const { rootDir, host, password, env = 'dev', onOutput } = options;
  const startCommand = options.startCommand || DEFAULT_START_COMMAND;
  const log = onOutput ?? (() => {});

  const backup = await injectManifest(rootDir, env, log, PERFETTO_OVERRIDES, PERFETTO_MANIFEST_FILENAME);

  try {
    log(`Running: ${startCommand}`);
    await runKopytkoStart(rootDir, startCommand, host, password, env, log);
    log('Build and deploy successful.');
  } finally {
    await restoreManifest(backup, log);
  }
}

/**
 * Non-debug deploy — builds and uploads the project without debug manifest injection.
 */
export async function upload(options: Omit<DeployOptions, 'debugMode'>): Promise<void> {
  return deploy({ ...options, debugMode: false });
}

/**
 * Injects manifest overrides into the project's local manifest override file.
 *
 * If `.kopytkorc` has `localManifestOverride` configured, modifies that file.
 * Otherwise, creates a new manifest file and temporarily adds the
 * `localManifestOverride` entry to `.kopytkorc`.
 */
async function injectManifest(
  rootDir: string,
  env: string,
  log: (msg: string) => void,
  overrides: ManifestOverrides,
  filename: string,
): Promise<ManifestBackup> {
  const rcPath = path.join(rootDir, '.kopytkorc');
  const rc = readKopytkorc(rcPath);

  if (rc && typeof rc.localManifestOverride === 'string') {
    return injectIntoExistingOverride(rootDir, rc.localManifestOverride, env, log, overrides, filename);
  }

  return injectWithNewOverride(rootDir, rcPath, rc, log, overrides, filename);
}

/**
 * Case A: `.kopytkorc` has `localManifestOverride` configured.
 * Back up the existing file (if any) and write overrides merged with the original.
 */
function injectIntoExistingOverride(
  rootDir: string,
  overridePath: string,
  env: string,
  log: (msg: string) => void,
  overrides: ManifestOverrides,
  filename: string,
): ManifestBackup {
  const resolvedPath = resolveManifestTemplate(overridePath, env);
  const absPath = path.join(rootDir, resolvedPath);

  let originalContent: string | undefined;

  if (fs.existsSync(absPath)) {
    originalContent = fs.readFileSync(absPath, 'utf-8');
    log(`Injecting manifest overrides into existing ${resolvedPath}`);

    const patched = wrapExistingManifest(originalContent, absPath, overrides);
    fs.writeFileSync(absPath, patched, 'utf-8');
  } else {
    log(`Creating manifest override at ${resolvedPath}`);
    ensureDirectory(path.dirname(absPath));
    fs.writeFileSync(absPath, overridesToModule(overrides), 'utf-8');
  }

  void filename; // filename only used when creating a brand-new override file
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
 * Create a manifest file and temporarily add the `localManifestOverride` entry to `.kopytkorc`.
 */
function injectWithNewOverride(
  rootDir: string,
  rcPath: string,
  rc: Record<string, unknown> | null,
  log: (msg: string) => void,
  overrides: ManifestOverrides,
  filename: string,
): ManifestBackup {
  const manifestRelPath = `/${DEFAULT_MANIFEST_DIR}/${filename}`;
  const absPath = path.join(rootDir, manifestRelPath);

  log(`No localManifestOverride configured — creating ${manifestRelPath}`);
  ensureDirectory(path.dirname(absPath));
  fs.writeFileSync(absPath, overridesToModule(overrides), 'utf-8');

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
 * Wraps an existing manifest override file to merge the given overrides.
 * For a simple `module.exports = { ... }` pattern, injects entries inline.
 * For complex files, creates a backup and generates a wrapper module.
 */
function wrapExistingManifest(
  originalContent: string,
  absPath: string,
  overrides: ManifestOverrides,
): string {
  const simpleExportMatch = originalContent.match(
    /^([\s\S]*module\.exports\s*=\s*\{)([\s\S]*?)(\};?\s*)$/,
  );

  if (simpleExportMatch) {
    const [, before, middle, after] = simpleExportMatch;
    const trimmed = middle.trimEnd();
    const needsComma = trimmed.length > 0 && !trimmed.endsWith(',');
    const injected = Object.entries(overrides)
      .map(([k, v]) => `  ${k}: ${typeof v === 'string' ? JSON.stringify(v) : String(v)},`)
      .join('\n');
    return `${before}${middle}${needsComma ? ',' : ''}\n${injected}\n${after}`;
  }

  // Complex file — create a backup and wrap it
  const backupPath = absPath + '.kopytko-debug-backup.js';
  fs.writeFileSync(backupPath, originalContent, 'utf-8');

  const backupRelative = './' + path.basename(backupPath);
  const spreadEntries = Object.entries(overrides)
    .map(([k, v]) => `${k}: ${typeof v === 'string' ? JSON.stringify(v) : String(v)}`)
    .join(', ');
  return [
    `// Generated by vscode-kopytko`,
    `const original = require('${backupRelative}');`,
    `module.exports = { ...original, ${spreadEntries} };`,
    '',
  ].join('\n');
}

/** Generates a standalone `module.exports = { ... }` file from an overrides map. */
function overridesToModule(overrides: ManifestOverrides): string {
  const entries = Object.entries(overrides)
    .map(([k, v]) => `  ${k}: ${typeof v === 'string' ? JSON.stringify(v) : String(v)},`)
    .join('\n');
  return `module.exports = {\n${entries}\n};\n`;
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
    const child = exec(command, {
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

