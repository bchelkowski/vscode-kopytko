#!/usr/bin/env node

import * as fs from 'fs';
import * as path from 'path';
import { EcpClient } from '../src/ecp/ecpClient';
import { InstallerClient } from '../src/installer/installerClient';
import { SsdpClient } from '../src/ssdp/ssdpClient';
import { enablePerfettoTracing, triggerHeapSnapshot } from '../src/ecp/tracing';
import type { SsdpDeviceFound } from '../src/types';

/**
 * Resolves package.json's version whether running compiled (`dist/bin/`, two
 * directories below the package root) or directly from TypeScript source via
 * tsx in tests (`bin/`, one directory below the package root).
 */
function resolveVersion(): string {
  for (const rel of ['../package.json', '../../package.json']) {
    try {
      return require(rel).version;
    } catch {
      // try the next candidate
    }
  }
  return 'unknown';
}

const VERSION = resolveVersion();

const BOOLEAN_FLAGS = new Set(['--force', '--json', '--help', '-h', '--version', '-v']);

export interface CliFlags {
  host?: string;
  port?: string;
  timeout?: string;
  password?: string;
  config?: string;
  app?: string;
  key?: string;
  text?: string;
  force: boolean;
  out?: string;
  zip?: string;
  pkg?: string;
  'signing-password'?: string;
  'app-name-version'?: string;
  'node-id'?: string;
  scope?: string;
  json: boolean;
  help: boolean;
  version: boolean;
  params: [string, string][];
}

export interface ParsedArgs {
  group?: string;
  op?: string;
  flags: CliFlags;
}

/** Parses `process.argv.slice(2)` into a group, an op, and a flag bag. */
export function parseArgs(argv: string[]): ParsedArgs {
  const flags: CliFlags = { force: false, json: false, help: false, version: false, params: [] };
  const positional: string[] = [];

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];

    if (arg === '--help' || arg === '-h') { flags.help = true; continue; }
    if (arg === '--version' || arg === '-v') { flags.version = true; continue; }
    if (arg === '--json') { flags.json = true; continue; }
    if (arg === '--force') { flags.force = true; continue; }

    if (arg === '--param') {
      const pair = argv[++i] ?? '';
      const eq = pair.indexOf('=');
      if (eq === -1) throw new Error(`--param must be in key=value form, got "${pair}"`);
      flags.params.push([pair.slice(0, eq), pair.slice(eq + 1)]);
      continue;
    }

    if (arg.startsWith('--') && !BOOLEAN_FLAGS.has(arg)) {
      const key = arg.slice(2) as keyof CliFlags;
      const value = argv[++i];
      if (value === undefined) throw new Error(`Missing value for ${arg}`);
      (flags as unknown as Record<string, unknown>)[key] = value;
      continue;
    }

    if (arg.startsWith('-')) {
      throw new Error(`Unknown option: ${arg}`);
    }

    positional.push(arg);
  }

  return { group: positional[0], op: positional[1], flags };
}

/** Config file / env var fallback — never reads VS Code or Kopytko project state (see README). */
export function resolveConfig(flags: CliFlags): { host?: string; password?: string; port?: number } {
  let fileConfig: { host?: string; password?: string; port?: number } = {};

  if (flags.config) {
    const configPath = path.resolve(flags.config);
    let raw: string;
    try {
      raw = fs.readFileSync(configPath, 'utf-8');
    } catch (err) {
      throw new Error(`Failed to read --config file at ${configPath}: ${(err as Error).message}`);
    }
    try {
      fileConfig = JSON.parse(raw);
    } catch (err) {
      throw new Error(`--config file at ${configPath} is not valid JSON: ${(err as Error).message}`);
    }
  }

  return {
    host: flags.host ?? fileConfig.host ?? process.env.ROKU_HOST,
    password: flags.password ?? fileConfig.password ?? process.env.ROKU_PASSWORD,
    port: flags.port ? parseInt(flags.port, 10) : fileConfig.port,
  };
}

export function requireHost(config: { host?: string }): string {
  if (!config.host) {
    throw new Error('No device host given — pass --host, set it in --config, or set ROKU_HOST.');
  }
  return config.host;
}

export function requireFlag(flags: CliFlags, name: keyof CliFlags): string {
  const value = flags[name];
  if (value === undefined || value === '') throw new Error(`Missing required --${name} flag`);
  return value as string;
}

export function paramsToRecord(params: [string, string][]): Record<string, string> {
  return Object.fromEntries(params);
}

const ecp = new EcpClient();
const installer = new InstallerClient(ecp);

type Handler = (flags: CliFlags) => Promise<unknown>;

const ECP_OPS: Record<string, Handler> = {
  'device-info': (f) => ecp.queryDeviceInfo(requireHost(resolveConfig(f)), resolveConfig(f).port),
  apps: (f) => ecp.queryApps(requireHost(resolveConfig(f)), resolveConfig(f).port),
  'active-app': (f) => ecp.queryActiveApp(requireHost(resolveConfig(f)), resolveConfig(f).port),
  'media-player': (f) => ecp.queryMediaPlayer(requireHost(resolveConfig(f)), resolveConfig(f).port),
  icon: async (f) => {
    const config = resolveConfig(f);
    const { data, contentType } = await ecp.queryAppIcon(requireHost(config), requireFlag(f, 'app'), config.port);
    const out = requireFlag(f, 'out');
    fs.writeFileSync(out, data);
    return { savedTo: out, contentType, bytes: data.length };
  },
  launch: (f) => {
    const config = resolveConfig(f);
    return ecp.launchApp(requireHost(config), requireFlag(f, 'app'), paramsToRecord(f.params), config.port).then(() => ({ ok: true }));
  },
  input: (f) => {
    const config = resolveConfig(f);
    return ecp.sendInput(requireHost(config), paramsToRecord(f.params), config.port).then(() => ({ ok: true }));
  },
  keypress: (f) => {
    const config = resolveConfig(f);
    return ecp.keypress(requireHost(config), requireFlag(f, 'key'), config.port).then(() => ({ ok: true }));
  },
  keydown: (f) => {
    const config = resolveConfig(f);
    return ecp.keydown(requireHost(config), requireFlag(f, 'key'), config.port).then(() => ({ ok: true }));
  },
  keyup: (f) => {
    const config = resolveConfig(f);
    return ecp.keyup(requireHost(config), requireFlag(f, 'key'), config.port).then(() => ({ ok: true }));
  },
  text: (f) => {
    const config = resolveConfig(f);
    return ecp.sendText(requireHost(config), requireFlag(f, 'text'), config.port).then(() => ({ ok: true }));
  },
  'exit-app': (f) => {
    const config = resolveConfig(f);
    return ecp.exitApp(requireHost(config), requireFlag(f, 'app'), f.force, config.port).then(() => ({ ok: true }));
  },
  'tv-channels': (f) => ecp.queryTvChannels(requireHost(resolveConfig(f)), resolveConfig(f).port),
  'tv-active-channel': (f) => ecp.queryTvActiveChannel(requireHost(resolveConfig(f)), resolveConfig(f).port),
  registry: (f) => ecp.queryRegistry(requireHost(resolveConfig(f)), requireFlag(f, 'app'), resolveConfig(f).port),
  chanperf: (f) => ecp.queryChanperf(requireHost(resolveConfig(f)), resolveConfig(f).port),
  sgnodes: (f) => {
    const config = resolveConfig(f);
    if (f['node-id']) return ecp.querySgNodesById(requireHost(config), f['node-id'], config.port);
    const scope = f.scope === 'roots' ? 'roots' : 'all';
    return ecp.querySgNodes(requireHost(config), config.port, scope);
  },
  'app-object-counts': (f) => ecp.queryAppObjectCounts(requireHost(resolveConfig(f)), requireFlag(f, 'app'), resolveConfig(f).port),
  'app-state': (f) => ecp.queryAppState(requireHost(resolveConfig(f)), requireFlag(f, 'app'), resolveConfig(f).port),
  'rendezvous-track': (f) => ecp.enableRendezvousTracking(requireHost(resolveConfig(f)), resolveConfig(f).port).then((trackingEnabled) => ({ trackingEnabled })),
  'rendezvous-untrack': (f) => ecp.disableRendezvousTracking(requireHost(resolveConfig(f)), resolveConfig(f).port).then((ok) => ({ ok })),
  'rendezvous-query': (f) => ecp.queryRendezvousEvents(requireHost(resolveConfig(f)), resolveConfig(f).port),
  'fwbeacons-track': (f) => ecp.enableFwBeaconTracking(requireHost(resolveConfig(f)), requireFlag(f, 'app'), resolveConfig(f).port).then((trackingEnabled) => ({ trackingEnabled })),
  'fwbeacons-untrack': (f) => ecp.disableFwBeaconTracking(requireHost(resolveConfig(f)), requireFlag(f, 'app'), resolveConfig(f).port).then((ok) => ({ ok })),
  'fwbeacons-query': (f) => ecp.queryFwBeacons(requireHost(resolveConfig(f)), resolveConfig(f).port),
  'graphics-frame-rate': (f) => ecp.queryGraphicsFrameRate(requireHost(resolveConfig(f)), resolveConfig(f).port),
  'r2d2-bitmaps': (f) => ecp.queryR2d2Bitmaps(requireHost(resolveConfig(f)), resolveConfig(f).port),
  'perfetto-enable': (f) => {
    const config = resolveConfig(f);
    return enablePerfettoTracing(requireHost(config), requireFlag(f, 'app'), config.port).then(() => ({ ok: true }));
  },
  'perfetto-trigger-heap-snapshot': (f) => {
    const config = resolveConfig(f);
    return triggerHeapSnapshot(requireHost(config), requireFlag(f, 'app'), config.port).then(() => ({ ok: true }));
  },
};

const INSTALLER_OPS: Record<string, Handler> = {
  screenshot: (f) => {
    const config = resolveConfig(f);
    const out = requireFlag(f, 'out');
    return installer
      .takeScreenshot(requireHost(config), requireFlag(f, 'password'), out, config.port)
      .then(() => ({ savedTo: out }));
  },
  install: (f) => {
    const config = resolveConfig(f);
    return installer
      .installChannel(requireHost(config), requireFlag(f, 'password'), requireFlag(f, 'zip'), config.port)
      .then(() => ({ ok: true }));
  },
  delete: (f) => {
    const config = resolveConfig(f);
    return installer.deleteChannel(requireHost(config), requireFlag(f, 'password'), config.port).then(() => ({ ok: true }));
  },
  rekey: (f) => {
    const config = resolveConfig(f);
    return installer
      .rekey(requireHost(config), requireFlag(f, 'password'), requireFlag(f, 'pkg'), requireFlag(f, 'signing-password'), config.port)
      .then(() => ({ ok: true }));
  },
  package: (f) => {
    const config = resolveConfig(f);
    const out = requireFlag(f, 'out');
    return installer
      .packageChannel(
        requireHost(config),
        requireFlag(f, 'password'),
        requireFlag(f, 'zip'),
        requireFlag(f, 'app-name-version'),
        requireFlag(f, 'signing-password'),
        out,
        config.port,
      )
      .then(() => ({ savedTo: out }));
  },
  update: (f) => {
    const config = resolveConfig(f);
    return installer.checkForUpdate(requireHost(config), requireFlag(f, 'password'), config.port).then(() => ({ ok: true }));
  },
  reboot: (f) => {
    const config = resolveConfig(f);
    return installer.reboot(requireHost(config), requireFlag(f, 'password'), config.port).then(() => ({ ok: true }));
  },
};

async function discover(flags: CliFlags): Promise<SsdpDeviceFound[]> {
  const client = new SsdpClient();
  const found: SsdpDeviceFound[] = [];
  client.on('found', (device) => found.push(device));

  // SsdpClient emits 'error' for per-interface socket failures (e.g. a
  // disabled/unreachable network interface) while other interfaces keep
  // scanning — an EventEmitter with zero 'error' listeners makes Node throw
  // it as an uncaught exception, crashing the whole process outside the
  // normal main().catch() error handling. Surface it as a warning instead;
  // the scan still completes (and may still find devices on other interfaces).
  client.on('error', (err) => console.error(`Warning: discover: ${err.message}`));

  const timeoutMs = flags.timeout ? parseInt(flags.timeout, 10) : 5000;
  await client.scan(timeoutMs);
  client.stop();
  return found;
}

/**
 * Prints an op's result. Several ECP ops (chanperf, sgnodes, r2d2-bitmaps,
 * graphics-frame-rate, registry, tv-channels, tv-active-channel) return the
 * device's raw XML body as a plain string rather than a parsed object —
 * `--json` is meaningless for those (JSON-escaping an XML document just
 * produces an unreadable quoted blob with literal `\n`/`\t`), so a string
 * result is always printed as-is, ignoring `--json`. Non-string results honor
 * `--json` for pretty vs. compact-ish structured output — both currently use
 * the same pretty-printed form; `--json` exists for callers that want to pipe
 * into `jq` or similar rather than read it directly.
 */
export function printResult(result: unknown, json: boolean): void {
  if (typeof result === 'string') {
    console.log(result);
    return;
  }
  if (result === undefined) {
    console.log(json ? 'null' : '(none)');
    return;
  }
  console.log(JSON.stringify(result, null, 2));
}

function printUsage(): void {
  console.log(`
kopytko-roku v${VERSION}
Terminal client for the Roku External Control Protocol and developer web-admin.

USAGE
  kopytko-roku discover [--timeout <ms>] [--json]
  kopytko-roku ecp <op> --host <ip> [--port <n>] [--json] [op flags...]
  kopytko-roku installer <op> --host <ip> --password <pw> [op flags...]

GLOBAL OPTIONS
  --config <path>   JSON file providing { "host", "password", "port" } defaults.
  --json            Print raw JSON instead of formatted output.
  --help, -h        Show this help message.
  --version, -v     Show version.

CONFIG RESOLUTION (highest priority first)
  1. Command-line flags (--host, --password, --port)
  2. --config <file>
  3. Environment variables: ROKU_HOST, ROKU_PASSWORD

  This is intentionally independent of VS Code settings / .kopytkorc — the
  roku-device package stays Kopytko-ecosystem- and editor-unaware.

ECP OPS
  device-info, apps, active-app, media-player, icon --app <id> --out <file>,
  launch --app <id> [--param k=v ...], input [--param k=v ...],
  keypress|keydown|keyup --key <KEY>, text --text "...",
  exit-app --app <id> [--force], tv-channels, tv-active-channel,
  registry --app <id>, chanperf, sgnodes [--scope all|roots] [--node-id <id>],
  app-object-counts --app <id>, app-state --app <id>,
  rendezvous-track|rendezvous-untrack|rendezvous-query,
  fwbeacons-track|fwbeacons-untrack --app <id>, fwbeacons-query,
  graphics-frame-rate, r2d2-bitmaps,
  perfetto-enable|perfetto-trigger-heap-snapshot --app <id>

INSTALLER OPS (require --password, developer web-admin on port 80)
  screenshot --out <file>, install --zip <path>, delete,
  rekey --pkg <path> --signing-password <pw>,
  package --zip <path> --app-name-version "Name/1.0" --signing-password <pw> --out <path>,
  update, reboot

EXAMPLES
  kopytko-roku discover
  kopytko-roku ecp device-info --host 192.168.1.50
  kopytko-roku ecp keypress --host 192.168.1.50 --key Home
  kopytko-roku ecp launch --host 192.168.1.50 --app dev --param contentId=42
  kopytko-roku installer screenshot --host 192.168.1.50 --password secret --out shot.jpg
`);
}

async function main(): Promise<void> {
  const parsed = parseArgs(process.argv.slice(2));

  if (parsed.flags.help) { printUsage(); return; }
  if (parsed.flags.version) { console.log(VERSION); return; }

  if (!parsed.group) { printUsage(); process.exitCode = 1; return; }

  if (parsed.group === 'discover') {
    const result = await discover(parsed.flags);
    printResult(result, parsed.flags.json);
    return;
  }

  const ops = parsed.group === 'ecp' ? ECP_OPS : parsed.group === 'installer' ? INSTALLER_OPS : undefined;
  if (!ops) throw new Error(`Unknown command group: ${parsed.group}`);

  if (!parsed.op || !ops[parsed.op]) {
    throw new Error(`Unknown ${parsed.group} op: ${parsed.op ?? '(none given)'}`);
  }

  const result = await ops[parsed.op](parsed.flags);
  printResult(result, parsed.flags.json);
}

if (require.main === module) {
  main().catch((err: unknown) => {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`Error: ${message}`);
    process.exitCode = 1;
  });
}
