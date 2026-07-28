#!/usr/bin/env node
/**
 * Verifies the countable claims in README/docs/site against the real code.
 *
 * Every number here was found stale at least once: the parser README claimed 58
 * built-ins and 47 keywords (really 59 and 52), the site claimed 1100+ tests
 * (really 3000+) and 86 SceneGraph nodes (really 88). Hand-typed counts rot
 * silently because nothing reads them back.
 *
 * Run via `npm run check:claims`; also wired into `npm run lint` and CI.
 * Needs tsx (a devDependency) because the real values live in TypeScript source
 * — the packages' dist/ can be stale, which is exactly how the drift hid.
 */

import { readFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');
const countFiles = (dir, exclude = /^index\./) =>
  readdirSync(join(ROOT, dir)).filter((f) => /\.ts$/.test(f) && !exclude.test(f)).length;

/** Loads real export counts by running the TypeScript source through tsx. */
function catalogCounts() {
  const probe = 'scripts/.claims-probe.ts';
  writeFileSync(
    join(ROOT, probe),
    `import { BRIGHTSCRIPT_BUILTINS, BRIGHTSCRIPT_KEYWORDS, BRIGHTSCRIPT_COMPONENTS, BRIGHTSCRIPT_INTERFACES, SG_NODES } from '../packages/brightscript-parser/src/index.js';
import { DEFAULT_FORMATTING_CONFIG } from '../packages/formatter/src/index.js';
import { DEFAULT_RULE_CONFIG } from '../packages/linter/src/index.js';
const n = (x: any) => Array.isArray(x) ? x.length : Object.keys(x).length;
let interfaceMethods = 0;
for (const i of Object.values(BRIGHTSCRIPT_INTERFACES) as any[]) interfaceMethods += (i.methods ?? []).length;
console.log(JSON.stringify({
  builtins: n(BRIGHTSCRIPT_BUILTINS), keywords: n(BRIGHTSCRIPT_KEYWORDS),
  components: n(BRIGHTSCRIPT_COMPONENTS), interfaces: n(BRIGHTSCRIPT_INTERFACES),
  sgNodes: n(SG_NODES), formatterOptions: n(DEFAULT_FORMATTING_CONFIG), lintRules: n(DEFAULT_RULE_CONFIG),
  interfaceMethods,
}));\n`
  );
  try {
    // No `shell: true` — it triggers DEP0190 and is unnecessary; npx resolves
    // directly on the POSIX environments this runs in (WSL locally, CI).
    const out = execFileSync('npx', ['tsx', probe], { cwd: ROOT, encoding: 'utf8' });
    return JSON.parse(out.trim().split('\n').pop());
  } finally {
    try { unlinkSync(join(ROOT, probe)); } catch { /* already gone */ }
  }
}

const real = {
  ...catalogCounts(),
  providers: countFiles('src/server/providers'),
  cstPasses: countFiles('packages/formatter/src/cst-passes'),
};

/**
 * Each claim: where it appears, the regex capturing the number, and the real
 * value it must equal. Keep the regex tight enough that it matches one place.
 */
const CLAIMS = [
  ['packages/brightscript-parser/README.md', /`BRIGHTSCRIPT_BUILTINS` \| (\d+) built-in/, 'builtins'],
  ['packages/brightscript-parser/README.md', /`BRIGHTSCRIPT_KEYWORDS` \| (\d+) reserved/, 'keywords'],
  ['packages/brightscript-parser/README.md', /`BRIGHTSCRIPT_COMPONENTS` \| (\d+) ro\*/, 'components'],
  ['packages/brightscript-parser/README.md', /`BRIGHTSCRIPT_INTERFACES` \| (\d+) `if\*`/, 'interfaces'],
  ['packages/brightscript-parser/README.md', /with (\d+) method signatures between them/, 'interfaceMethods'],
  ['README.md', /(\d+) methods, \d+ built-in functions/, 'interfaceMethods'],
  ['packages/brightscript-parser/README.md', /\*\*Keywords\*\* \((\d+)\)/, 'keywords'],
  ['packages/brightscript-parser/README.md', /catalog of (\d+) node types/, 'sgNodes'],
  ['packages/linter/README.md', /\*\*(\d+) diagnostic rules\*\*/, 'lintRules'],
  ['packages/formatter/README.md', /\((\d+) fields/, 'formatterOptions'],
  ['README.md', /completions for (\d+) `ro\*` components/, 'components'],
  ['README.md', /(\d+) interfaces/, 'interfaces'],
  ['README.md', /(\d+) built-in functions/, 'builtins'],
  ['README.md', /(\d+)-type SceneGraph node catalog/, 'sgNodes'],
  ['README.md', /\*\*(\d+) diagnostic rules\*\*/, 'lintRules'],
  ['README.md', /(\d+) configurable options/, 'formatterOptions'],
  ['README.md', /linter with (\d+) rules/, 'lintRules'],
  ['docs/features.md', /\((\d+) CST passes/, 'cstPasses'],
  ['docs/features.md', /CST passes \+ text passes, (\d+) configurable options/, 'formatterOptions'],
  ['docs/formatting.md', /exports (\d+) CST pass files/, 'cstPasses'],
  ['findings/lsp-architecture.md', /`src\/server\/providers\/` \((\d+) providers\)/, 'providers'],
  ['site/src/pages/index.astro', /value: '(\d+)', label: 'Lint rules'/, 'lintRules'],
  ['site/src/pages/index.astro', /value: '(\d+)', label: 'Formatter options'/, 'formatterOptions'],
  ['site/src/pages/index.astro', /value: '(\d+)', label: 'ro\* components'/, 'components'],
  ['site/src/pages/index.astro', /value: '(\d+)', label: 'CST passes'/, 'cstPasses'],
  ['site/src/pages/parser.astro', /count: '(\d+) functions'/, 'builtins'],
  ['site/src/pages/parser.astro', /count: '(\d+) components'/, 'components'],
  ['site/src/pages/parser.astro', /count: '(\d+) nodes'/, 'sgNodes'],
];

const failures = [];
const unmatched = [];

for (const [file, re, key] of CLAIMS) {
  let text;
  try {
    text = read(file);
  } catch {
    unmatched.push(`${file} — file not found`);
    continue;
  }
  const m = text.match(re);
  if (!m) {
    unmatched.push(`${file} — pattern ${re} matched nothing (claim reworded? update scripts/check-doc-claims.mjs)`);
    continue;
  }
  const claimed = Number(m[1]);
  if (claimed !== real[key]) {
    failures.push(`${file}: claims ${claimed} ${key}, real value is ${real[key]}`);
  }
}

if (failures.length || unmatched.length) {
  if (failures.length) {
    console.error('Stale documentation claims:\n');
    for (const f of failures) console.error(`  ${f}`);
    console.error('\nFix the number in the file, or the code if the count is wrong.');
  }
  if (unmatched.length) {
    console.error(`${failures.length ? '\n' : ''}Claims that could not be located:\n`);
    for (const u of unmatched) console.error(`  ${u}`);
  }
  process.exit(1);
}

const summary = Object.entries(real).map(([k, v]) => `${k}=${v}`).join(' ');
console.log(`doc claims ok — ${CLAIMS.length} checked (${summary})`);
