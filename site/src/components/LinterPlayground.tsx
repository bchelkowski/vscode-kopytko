import { useState, useMemo } from 'react';
import SyntaxInput from './SyntaxInput';
// Real linter — fs/path are stubbed in astro.config.mjs so it runs in the browser.
// 'kopytko-linter' resolves to site/src/stubs/linter-browser.ts which re-exports
// lintFile, DEFAULT_RULE_CONFIG, and the required types.
import { lintFile, DEFAULT_RULE_CONFIG } from 'kopytko-linter';
import type { LintContext, LinterConfig, LintDiagnostic } from 'kopytko-linter';

// ── Browser-compatible LintContext stub ───────────────────────────────────────
// All filesystem / cross-file fields return empty values. Rules that need
// import resolution or XML (import/*, callback/*, mtop/*) simply produce no
// diagnostics, which is correct for a single-file playground.
const BROWSER_CONTEXT: LintContext = {
  knownFuncNames:          new Set<string>(),
  parseImports:            () => [],
  resolveImportPath:       () => null,
  importExists:            () => false,
  readFile:                () => null,
  parseFunctionsFromFile:  () => [],
  getSiblingFiles:         () => [],
  getTestSiblings:         () => [],
  isTestFile:              (p: string) => p.endsWith('.test.brs'),
  generatedPaths:          [],
  generatedModules:        [],
};

// ── Rule categories ───────────────────────────────────────────────────────────
const RULE_CATEGORIES: { label: string; rules: string[] }[] = [
  {
    label: 'Import',
    rules: [
      'import/duplicate', 'import/missing-path', 'import/path-not-absolute',
      'import/wrong-comment-style', 'import/unresolved', 'import/unused',
      'import/build-generated', 'import/missing-promise-deps',
    ],
  },
  {
    label: 'Identifier',
    rules: [
      'identifier/undefined-function', 'identifier/undefined-variable',
      'identifier/wrong-arg-count', 'identifier/shadows-builtin',
      'identifier/shadows-function', 'identifier/unused-parameter',
      'identifier/unused-variable', 'identifier/unused-function',
      'identifier/loop-variable-leak', 'identifier/duplicate-function',
    ],
  },
  {
    label: 'Syntax',
    rules: [
      'syntax/trailing-comma', 'syntax/flow-outside-loop', 'syntax/unreachable-code',
      'throw/invalid-value', 'throw/missing-message',
      'createobject/unknown-component',
    ],
  },
  {
    label: 'Type',
    rules: ['type/missing-return-type', 'type/missing-param-type'],
  },
  {
    label: 'Callback',
    rules: ['callback/undefined-observer-callback', 'callback/undefined-event-callback'],
  },
  {
    label: 'Test',
    rules: ['test/missing-mock-annotation', 'test/missing-return-ts'],
  },
  {
    label: 'm.top',
    rules: ['mtop/undefined-field'],
  },
];

// Rules that cannot fire without cross-file context — show them greyed out
const NEEDS_CONTEXT = new Set([
  'import/unresolved', 'import/unused', 'import/missing-promise-deps',
  'identifier/undefined-function', 'identifier/shadows-function',
  'identifier/unused-function', 'callback/undefined-observer-callback',
  'callback/undefined-event-callback', 'test/missing-mock-annotation',
  'test/missing-return-ts', 'mtop/undefined-field',
]);

// ── Sample code ───────────────────────────────────────────────────────────────
const SAMPLE = `' Edit this code — diagnostics update live.
' Rules requiring import/XML context are greyed out (can't run in the browser).

function add(a, b)
  str = a + b
  unused = "this value is never read"
  return str
end function

function multiply(x, y)
  result = x * y
  return result
end function

sub main()
  m.top.observeField("input", "onChanged")
end sub`;

// ── Severity colours ──────────────────────────────────────────────────────────
const SEV_ICON:   Record<string, string> = { error: '●', warning: '▲', info: '◆', hint: '○' };
const SEV_COLOR:  Record<string, string> = {
  error: '#f87171', warning: '#fbbf24', info: '#60a5fa', hint: '#94a3b8',
};
const SEV_BG:     Record<string, string> = {
  error: 'rgba(239,68,68,0.07)', warning: 'rgba(251,191,36,0.06)',
  info: 'rgba(96,165,250,0.06)', hint: 'rgba(148,163,184,0.05)',
};
const SEV_BORDER: Record<string, string> = {
  error: 'rgba(239,68,68,0.22)', warning: 'rgba(251,191,36,0.18)',
  info: 'rgba(96,165,250,0.18)', hint: 'rgba(148,163,184,0.15)',
};

// ── Component ─────────────────────────────────────────────────────────────────
export default function LinterPlayground() {
  const [source, setSource] = useState(SAMPLE);
  // Start with all rules enabled
  const [disabled, setDisabled] = useState<Set<string>>(new Set());

  const diagnostics = useMemo<LintDiagnostic[]>(() => {
    try {
      // Build rule config: disabled rules → 'off', rest keep their default severity
      const rules = { ...DEFAULT_RULE_CONFIG };
      for (const id of disabled) (rules as Record<string, string>)[id] = 'off';

      const config: LinterConfig = {
        rules: rules as LinterConfig['rules'],
        sourceDir: 'src',
        resolveModules: false,
        generatedPaths: [],
        generatedModules: [],
        siblingPatterns: [],
        readOnlyPaths: [],
      };

      return lintFile('/playground/code.brs', source, BROWSER_CONTEXT, config);
    } catch {
      return [];
    }
  }, [source, disabled]);

  const toggle = (id: string) =>
    setDisabled(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  const counts = { error: 0, warning: 0, info: 0, hint: 0 };
  for (const d of diagnostics) counts[d.severity as keyof typeof counts]++;

  return (
    <div className="rounded-xl border border-[#1e2d4a] bg-[#0f1923] overflow-hidden">
      {/* Header */}
      <div className="px-4 py-3 border-b border-[#1e2d4a] bg-[#070b14]/50 flex items-center gap-3 flex-wrap">
        <span className="text-sm font-medium text-slate-300">Linter Playground</span>
        <span className="text-xs text-slate-500">Edit code and toggle rules — diagnostics update live</span>
        <div className="ml-auto flex items-center gap-3 text-xs">
          {counts.error > 0 && (
            <span style={{ color: SEV_COLOR.error }}>
              {SEV_ICON.error} {counts.error} error{counts.error !== 1 ? 's' : ''}
            </span>
          )}
          {counts.warning > 0 && (
            <span style={{ color: SEV_COLOR.warning }}>
              {SEV_ICON.warning} {counts.warning} warning{counts.warning !== 1 ? 's' : ''}
            </span>
          )}
          {diagnostics.length === 0 && <span className="text-green-400">✓ No issues</span>}
        </div>
      </div>

      {/* Editor + diagnostics */}
      <div className="grid grid-cols-1 md:grid-cols-2 divide-y md:divide-y-0 md:divide-x divide-[#1e2d4a]">
        <div>
          <div className="px-3 py-1.5 text-xs text-slate-500 border-b border-[#1e2d4a] bg-[#070b14]/30">
            Code — edit to experiment
          </div>
          <SyntaxInput value={source} onChange={setSource} height="18rem" />
        </div>

        <div className="overflow-auto h-72">
          <div className="px-3 py-1.5 text-xs text-slate-500 border-b border-[#1e2d4a] bg-[#070b14]/30 sticky top-0">
            Diagnostics
          </div>
          {diagnostics.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-52 gap-2 text-slate-500">
              <span className="text-2xl text-green-400">✓</span>
              <p className="text-sm">No issues with the active rules</p>
            </div>
          ) : (
            <div className="p-2 space-y-1.5">
              {diagnostics.map((d, i) => (
                <div
                  key={i}
                  className="rounded-lg px-3 py-2.5 text-xs"
                  style={{
                    background: SEV_BG[d.severity] ?? SEV_BG.hint,
                    border: `1px solid ${SEV_BORDER[d.severity] ?? SEV_BORDER.hint}`,
                  }}
                >
                  <div className="flex items-center gap-2 mb-1">
                    <span className="font-bold text-sm leading-none" style={{ color: SEV_COLOR[d.severity] ?? SEV_COLOR.hint }}>
                      {SEV_ICON[d.severity] ?? SEV_ICON.hint}
                    </span>
                    <code className="text-slate-300 font-mono">{d.rule}</code>
                    <span className="ml-auto text-slate-600 font-mono shrink-0">
                      line {(d.line ?? 0) + 1}
                    </span>
                  </div>
                  <p className="text-slate-400 leading-relaxed pl-4">{d.message}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Rule toggles */}
      <div className="border-t border-[#1e2d4a] p-4 bg-[#070b14]/20">
        <p className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-3">
          Rules — click to toggle. Greyed = requires import/XML context (won't fire in single-file mode).
        </p>
        <div className="space-y-2.5">
          {RULE_CATEGORIES.map(cat => (
            <div key={cat.label} className="flex flex-wrap items-center gap-1.5">
              <span className="text-xs text-slate-600 w-16 shrink-0">{cat.label}</span>
              {cat.rules.map(id => {
                const on = !disabled.has(id);
                const needsCtx = NEEDS_CONTEXT.has(id);
                const sev = (DEFAULT_RULE_CONFIG as Record<string, string>)[id] ?? 'warning';
                return (
                  <button
                    key={id}
                    onClick={() => toggle(id)}
                    title={needsCtx ? `${id} — requires cross-file context` : id}
                    className={`text-xs px-2 py-0.5 rounded border transition-colors ${
                      needsCtx
                        ? 'opacity-40 cursor-default bg-slate-800/40 border-slate-700/30 text-slate-500'
                        : on
                        ? sev === 'error'
                          ? 'bg-red-900/20 border-red-700/35 text-red-300'
                          : sev === 'warning'
                          ? 'bg-amber-900/20 border-amber-700/35 text-amber-300'
                          : 'bg-blue-900/20 border-blue-700/35 text-blue-300'
                        : 'bg-slate-800/40 border-slate-700/30 text-slate-500'
                    }`}
                  >
                    {id.split('/')[1]}
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
