#!/usr/bin/env node
/**
 * Generates the machine-maintained context files:
 *
 *   MAP.md                              repo map — areas, entry points, exports, commands
 *   docs/reference/commands-and-settings.md   full command + setting reference
 *   README.md  (features section)       regenerated between HTML markers
 *
 * Everything structural is derived from the tree and package.json. The only
 * hand-written input is scripts/map-areas.json, which supplies the one-line
 * purpose of each directory — that cannot be derived from code.
 *
 *   node scripts/generate-map.mjs            write the files
 *   node scripts/generate-map.mjs --check    exit 1 if they are stale or an
 *                                            area has no description
 */

import { readFileSync, writeFileSync, readdirSync, statSync, mkdirSync } from 'node:fs';
import { join, dirname, relative, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CHECK = process.argv.includes('--check');

const UNDESCRIBED = '⚠️ UNDESCRIBED — add an entry to scripts/map-areas.json';
const SKIP_DIRS = new Set(['node_modules', 'dist', 'out', 'out-test', '.git', 'coverage', '.nyc_output']);
const CODE_EXT = /\.(ts|tsx)$/;

const read = (p) => readFileSync(join(ROOT, p), 'utf8');
const readJson = (p) => JSON.parse(read(p));
const posix = (p) => p.split('\\').join('/');

// ---------------------------------------------------------------- area scan

/** Directories containing at least one .ts/.tsx file, excluding tests. */
function scanAreas() {
  const roots = ['src'];
  for (const pkg of readdirSync(join(ROOT, 'packages'))) {
    for (const sub of ['src', 'bin']) {
      const p = `packages/${pkg}/${sub}`;
      try {
        if (statSync(join(ROOT, p)).isDirectory()) roots.push(p);
      } catch { /* not present */ }
    }
  }

  const areas = [];
  const walk = (rel) => {
    let entries;
    try {
      entries = readdirSync(join(ROOT, rel), { withFileTypes: true });
    } catch {
      return;
    }
    const files = entries.filter((e) => e.isFile() && CODE_EXT.test(e.name)).map((e) => e.name);
    if (files.length) areas.push({ dir: posix(rel), files: files.length });
    for (const e of entries) {
      if (e.isDirectory() && !SKIP_DIRS.has(e.name)) walk(join(rel, e.name));
    }
  };
  roots.forEach(walk);
  return areas.sort((a, b) => a.dir.localeCompare(b.dir));
}

// ------------------------------------------------------------- export scan

/**
 * Parses a package's index.ts into { group, symbols[] } records. Groups come
 * from the `// Section comment` lines the index files already use.
 */
function scanExports(pkgDir) {
  let src;
  try {
    src = read(`${pkgDir}/src/index.ts`);
  } catch {
    return [];
  }

  const groups = [];
  let label = 'Exports';
  // Collapse multi-line `export { ... } from '...'` into single logical lines.
  const flat = src.replace(/export\s*\{[^}]*\}\s*from/g, (m) => m.replace(/\s+/g, ' '));

  for (const line of flat.split('\n')) {
    const t = line.trim();
    if (!t) continue;

    const comment = t.match(/^\/\/\s*(.+)$/);
    if (comment && !comment[1].startsWith('/')) {
      const text = comment[1].trim();
      // Section headings are short and unpunctuated; prose comments are not.
      // Prose only appears in the file header, before any export, so a
      // mislabel there is harmless — groups exist only once an export lands.
      if (text.length <= 120 && !text.endsWith('.')) label = text;
      continue;
    }

    const named = t.match(/^export\s*\{(.+?)\}\s*from\s*['"](.+?)['"]/);
    const star = t.match(/^export\s*\*\s*from\s*['"](.+?)['"]/);
    if (!named && !star) continue;

    const from = (named ? named[2] : star[1]).replace(/^\.\//, '').replace(/\.js$/, '');
    const symbols = named
      ? named[1]
          .split(',')
          .map((s) => s.trim().replace(/^type\s+/, '').split(/\s+as\s+/)[0].trim())
          .filter(Boolean)
      : ['*'];

    let g = groups.find((x) => x.label === label);
    if (!g) groups.push((g = { label, symbols: [], from: new Set() }));
    g.symbols.push(...symbols);
    g.from.add(from);
  }
  return groups;
}

// ---------------------------------------------------------- package.json

function contributes() {
  const pkg = readJson('package.json');
  const c = pkg.contributes ?? {};

  let props = {};
  const conf = c.configuration;
  if (Array.isArray(conf)) for (const b of conf) Object.assign(props, b.properties ?? {});
  else props = conf?.properties ?? {};

  const settings = Object.entries(props).map(([key, v]) => ({
    key,
    type: Array.isArray(v.type) ? v.type.join('|') : (v.enum ? 'enum' : v.type ?? ''),
    default: v.default === undefined ? '' : JSON.stringify(v.default),
    desc: (v.markdownDescription ?? v.description ?? '').replace(/\s+/g, ' ').trim(),
  }));

  const commands = (c.commands ?? []).map((cmd) => ({
    command: cmd.command,
    title: cmd.title,
    category: cmd.category ?? '',
  }));

  return { pkg, settings, commands };
}

// ------------------------------------------------------------- renderers

const esc = (s) => String(s).replace(/\|/g, '\\|');
const HEADER = (name) =>
  `<!-- Generated by scripts/generate-map.mjs — do not edit by hand. Run \`npm run map\`. -->\n`;

function renderMap({ areas, descriptions, exportsByPkg, commands, pkg }) {
  const out = [];
  out.push(HEADER());
  out.push('# Repo map\n');
  out.push(
    `Structural index of \`${pkg.name}\` v${pkg.version}. **Read this to locate code** — it is regenerated from the tree and \`package.json\`, so it cannot drift.\n`
  );
  out.push(
    'For *how* a subsystem behaves and what has already gone wrong in it, read `findings/`. For user-facing behaviour, read `docs/` — but do not read `docs/` to learn the code.\n'
  );

  out.push('\n## Entry points\n');
  out.push('| Entry | Path |');
  out.push('|---|---|');
  out.push('| Extension | `src/extension.ts` |');
  out.push('| LSP server | `src/server/server.ts` |');
  for (const a of areas.filter((x) => /[Ww]ebview$/.test(x.dir))) {
    // Keep the trailing segment so sibling webviews (webview vs editorWebview)
    // under one feature stay distinguishable.
    const label = a.dir.replace(/^src\/client\//, '').replace(/\/webview$/, '');
    out.push(`| Webview — ${label} | \`${a.dir}/main.ts\` |`);
  }
  for (const a of areas.filter((x) => /\/bin$/.test(x.dir))) {
    let files = [];
    try {
      files = readdirSync(join(ROOT, a.dir)).filter((f) => CODE_EXT.test(f));
    } catch { /* ignore */ }
    for (const f of files) out.push(`| CLI — \`${basename(f, '.ts')}\` | \`${a.dir}/${f}\` |`);
  }

  out.push('\n## Areas\n');
  let section = '';
  out.push('| Directory | Files | Purpose |');
  out.push('|---|---:|---|');
  for (const a of areas) {
    const top = a.dir.startsWith('packages/') ? a.dir.split('/').slice(0, 2).join('/') : 'src';
    if (top !== section) {
      section = top;
      out.push(`| **${top}** | | |`);
    }
    out.push(`| \`${a.dir}\` | ${a.files} | ${esc(descriptions[a.dir] ?? UNDESCRIBED)} |`);
  }

  out.push('\n## Package exports\n');
  for (const [pkgDir, groups] of Object.entries(exportsByPkg)) {
    if (!groups.length) continue;
    const name = readJson(`${pkgDir}/package.json`).name;
    out.push(`\n### \`${name}\` — \`${pkgDir}/src/index.ts\`\n`);
    out.push('| Group | Symbols |');
    out.push('|---|---|');
    for (const g of groups) {
      const syms = [...new Set(g.symbols)];
      const shown = syms.includes('*')
        ? `everything from ${[...g.from].map((f) => `\`${f}\``).join(', ')}`
        : syms.map((s) => `\`${s}\``).join(', ');
      out.push(`| ${esc(g.label)} | ${esc(shown)} |`);
    }
  }

  out.push('\n## Commands\n');
  out.push(`${commands.length} contributed commands. Full list with settings: [docs/reference/commands-and-settings.md](docs/reference/commands-and-settings.md).\n`);
  out.push('| Command | Title |');
  out.push('|---|---|');
  for (const c of commands) out.push(`| \`${c.command}\` | ${esc(c.title)} |`);

  out.push('\n## npm scripts\n');
  out.push('| Script | Runs |');
  out.push('|---|---|');
  for (const [name, cmd] of Object.entries(pkg.scripts ?? {})) {
    const short = cmd.length > 90 ? `${cmd.slice(0, 87)}…` : cmd;
    out.push(`| \`npm run ${name}\` | \`${esc(short)}\` |`);
  }
  out.push('');
  return out.join('\n');
}

function renderReference({ settings, commands }) {
  const out = [];
  out.push(HEADER());
  out.push('# Commands & settings reference\n');
  out.push(
    'Generated from `package.json` `contributes`, which is the source of truth VS Code itself reads. Change a command or setting there and run `npm run map`.\n'
  );

  out.push(`\n## Commands (${commands.length})\n`);
  out.push('| Command | Title | Category |');
  out.push('|---|---|---|');
  for (const c of commands) out.push(`| \`${c.command}\` | ${esc(c.title)} | ${esc(c.category)} |`);

  out.push(`\n## Settings (${settings.length})\n`);
  out.push('| Setting | Type | Default | Description |');
  out.push('|---|---|---|---|');
  for (const s of settings) {
    out.push(`| \`${s.key}\` | ${esc(s.type)} | \`${esc(s.default)}\` | ${esc(s.desc)} |`);
  }
  out.push('');
  return out.join('\n');
}

/** Human labels for the `kopytko.<group>.` settings prefixes. */
const SETTING_GROUPS = {
  languageServer: 'Language Server',
  debug: 'Debugging',
  imports: 'Import Resolution',
  casing: 'Casing',
  deviceDiscovery: 'Device Discovery',
  deviceManager: 'Device Manager',
  diagnostics: 'Diagnostics (Runtime Telemetry)',
  perfetto: 'Perfetto (App Tracing)',
  console: 'Kopytko Console',
  network: 'Network Inspector',
  rokuPay: 'Roku Pay',
  lint: 'Linting',
  format: 'Formatting',
  _general: 'General',
};

/**
 * The README is the Marketplace page, so it carries the settings a user tunes
 * directly. `format.*` (50 options) and `lint.rules.*` are delegated to the
 * package READMEs — dumping them here would triple the page for no benefit.
 * docs/reference/commands-and-settings.md always has the complete set.
 */
const README_SETTING_EXCLUDES = [/^kopytko\.format\./, /^kopytko\.lint\.rules\./];

function renderSettingsSection(settings) {
  const groups = new Map();
  for (const s of settings) {
    if (README_SETTING_EXCLUDES.some((re) => re.test(s.key))) continue;
    const parts = s.key.split('.');
    const key = parts.length > 2 ? parts[1] : '_general';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(s);
  }

  const out = [];
  out.push('All settings use the `kopytko.` prefix in `.vscode/settings.json` or VS Code user settings.\n');
  out.push(
    'The 50 formatting options (`kopytko.format.*`) are documented in the [kopytko-formatter README](packages/formatter/README.md#vs-code-settings-reference), and lint rule severities in the [kopytko-linter README](packages/linter/README.md#configuration). For every setting in one table, see [docs/reference/commands-and-settings.md](docs/reference/commands-and-settings.md).'
  );

  const order = Object.keys(SETTING_GROUPS);
  const sorted = [...groups.keys()].sort((a, b) => {
    const ia = order.indexOf(a);
    const ib = order.indexOf(b);
    return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib) || a.localeCompare(b);
  });

  for (const g of sorted) {
    out.push(`\n### ${SETTING_GROUPS[g] ?? g}\n`);
    out.push('| Setting | Type | Default | Description |');
    out.push('|---|---|---|---|');
    for (const s of groups.get(g)) {
      out.push(`| \`${s.key}\` | \`${esc(s.type)}\` | \`${esc(s.default)}\` | ${esc(s.desc)} |`);
    }
  }
  return out.join('\n');
}

/** Replaces the body between `<!-- name:start -->` / `<!-- name:end -->`. */
function splice(text, name, body, source) {
  const START = `<!-- ${name}:start -->`;
  const END = `<!-- ${name}:end -->`;
  const s = text.indexOf(START);
  const e = text.indexOf(END);
  if (s === -1 || e === -1) return null;
  const generated = `${START}\n<!-- Generated from ${source} by scripts/generate-map.mjs — do not edit by hand. -->\n\n${body}\n\n${END}`;
  return text.slice(0, s) + generated + text.slice(e + END.length);
}

// ------------------------------------------------------------------ main

function main() {
  const descriptions = readJson('scripts/map-areas.json');
  const areas = scanAreas();
  const { pkg, settings, commands } = contributes();

  const exportsByPkg = {};
  for (const p of readdirSync(join(ROOT, 'packages'))) {
    exportsByPkg[`packages/${p}`] = scanExports(`packages/${p}`);
  }

  const missing = areas.filter((a) => !descriptions[a.dir]).map((a) => a.dir);
  const stale = [];

  const outputs = [
    ['MAP.md', renderMap({ areas, descriptions, exportsByPkg, commands, pkg })],
    ['docs/reference/commands-and-settings.md', renderReference({ settings, commands })],
  ];

  // The README's settings tables are a hand-typed copy of package.json and had
  // already drifted. Its Features list is deliberately NOT generated — that is a
  // curated marketing summary, not a duplicate of docs/features.md's status table.
  const missingMarkers = [];
  const readme = splice(
    read('README.md'),
    'settings',
    renderSettingsSection(settings),
    'package.json contributes.configuration'
  );
  if (readme === null) missingMarkers.push('settings');
  else outputs.push(['README.md', readme]);

  for (const [file, content] of outputs) {
    let current = null;
    try {
      current = read(file);
    } catch { /* new file */ }

    if (current === content) continue;
    if (CHECK) {
      stale.push(file);
      continue;
    }
    mkdirSync(join(ROOT, dirname(file)), { recursive: true });
    writeFileSync(join(ROOT, file), content);
    console.log(`updated ${file}`);
  }

  if (CHECK) {
    let failed = false;
    if (stale.length) {
      console.error(`Stale generated files: ${stale.join(', ')}`);
      console.error('Run `npm run map` and commit the result.');
      failed = true;
    }
    if (missing.length) {
      console.error(`\nDirectories with no purpose in scripts/map-areas.json:`);
      for (const d of missing) console.error(`  ${d}`);
      console.error('\nAdd a one-line purpose for each. This is deliberate — an');
      console.error('undescribed directory makes the map vague for everyone after you.');
      failed = true;
    }
    if (failed) process.exit(1);
    console.log(`map ok — ${areas.length} areas, ${commands.length} commands, ${settings.length} settings`);
    return;
  }

  if (missing.length) {
    console.warn(`\n${missing.length} directories have no purpose in scripts/map-areas.json:`);
    for (const d of missing) console.warn(`  ${d}`);
    console.warn('They are marked UNDESCRIBED in MAP.md and will fail `npm run map -- --check`.');
  }
  for (const name of missingMarkers) {
    console.warn(`README.md has no <!-- ${name}:start --> / <!-- ${name}:end --> markers; skipped.`);
  }
}

main();
