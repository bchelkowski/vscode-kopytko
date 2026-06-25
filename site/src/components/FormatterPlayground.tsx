import { useState, useMemo } from 'react';
import { formatText, DEFAULT_FORMATTING_CONFIG } from 'kopytko-formatter';
import type { FormattingConfig } from 'kopytko-formatter';
import SyntaxInput from './SyntaxInput';
import { renderHighlighted } from '../utils/brightscript-colors';

// ── Sample code ───────────────────────────────────────────────────────────────
const SAMPLE = `' @import /utils/z-helper.brs
' @import /utils/a-helper.brs
sub processData(data,count,name)
if count<>0 then
x=data.value+count
m["total"]=x
print "processing "+name
endif
for i=0 to count-1
  if data.items[i]<>invalid
    print data.items[i]
  endif
endfor
end sub`;

// ── Presets ───────────────────────────────────────────────────────────────────
const PRESETS: { label: string; config: Partial<FormattingConfig> }[] = [
  {
    label: 'Default',
    config: DEFAULT_FORMATTING_CONFIG,
  },
  {
    label: 'Strict',
    config: {
      ...DEFAULT_FORMATTING_CONFIG,
      indentSize: 4,
      endKeywordStyle: 'spaced',
      thenStyle: 'always',
      functionVsSubForVoid: 'sub',
      spaceAroundOperators: true,
      spaceAroundAssignment: true,
      sortImports: true,
      emptyLineAfterImports: true,
      trailingComma: 'multiline',
      commentStyle: "'",
      spaceAfterCommentMarker: true,
      mPrefixStyle: 'dot',
      printStatement: 'remove',
    },
  },
  {
    label: 'Compact',
    config: {
      ...DEFAULT_FORMATTING_CONFIG,
      indentSize: 2,
      endKeywordStyle: 'compact',
      thenStyle: 'never',
      maxEmptyLines: 1,
      emptyLinesBetweenFunctions: 0,
    },
  },
];


// ── JSONC comment stripper ────────────────────────────────────────────────────
// Removes // line comments but preserves // inside string literals.
function stripJsonComments(jsonc: string): string {
  return jsonc.replace(/("(?:[^"\\]|\\.)*")|\/\/[^\n]*/g, (_, str) => str ?? '');
}

// ── Initial annotated config ──────────────────────────────────────────────────
const INITIAL_CONFIG_TEXT = `{
  // Indentation & Whitespace
  "indentSize": 4,                          // number — spaces per indent level
  "useTabs": false,                         // true | false
  "lineEnding": "auto",                     // "auto" | "lf" | "crlf"
  "trimTrailingWhitespace": true,           // true | false
  "insertFinalNewline": true,               // true | false
  "maxEmptyLines": 2,                       // number — 0 = no limit
  "emptyLinesBetweenFunctions": 1,          // number
  "emptyLinesBetweenMethods": 1,            // number
  "emptyLinesAtBlockBoundaries": "preserve",// "preserve" | "strip" | "enforce"

  // Compound Keywords
  "endKeywordStyle": "preserve",            // "preserve" | "spaced" | "compact"
  "thenStyle": "preserve",                  // "preserve" | "always" | "never" | "multiline-only" | "singleline-only"

  // Functions & Subs
  "functionVsSubForVoid": "preserve",       // "preserve" | "function" | "sub" | "allow-void"
  "spaceBeforeNamedFunctionParens": false,  // true | false
  "spaceBeforeAnonymousFunctionParens": false, // true | false
  "spaceBeforeCallParens": false,           // true | false
  "spaceInsideParens": "never",             // "never" | "always"
  "paramAlignmentStyle": "preserve",        // "preserve" | "indent" | "align-to-paren"  (not yet implemented)

  // Line Length & Wrapping
  "maxLineLength": 120,                     // number — 0 = no limit
  "wrapLongStrings": "preserve",            // "preserve" | "plus" | "array-join"
  "stringConcatStyle": "preserve",          // "preserve" | "plus" | "array-join"

  // Arrays & Associative Arrays
  "associativeArrayBracketSpacing": true,   // true | false
  "associativeArrayCommaSpacing": "preserve",// "preserve" | "after" | "before" | "both" | "none"
  "trailingComma": "never",                 // "never" | "always" | "multiline"
  "arrayCommaStyle": "preserve",            // "preserve" | "always" | "never"
  "associativeArrayCommaStyle": "preserve", // "preserve" | "always" | "never"
  "arraySplitOpenBracket": false,           // true | false
  "associativeArraySingleLineThreshold": 0, // number — 0 = no threshold

  // Operators & Expressions
  "spaceAroundOperators": true,             // true | false
  "spaceAroundAssignment": true,            // true | false
  "unarySpacing": true,                     // true | false

  // Comments
  "commentStyle": "preserve",              // "preserve" | "'" | "rem"
  "spaceAfterCommentMarker": true,         // true | false
  "commentWidth": 0,                       // number — 0 = no limit

  // Imports
  "sortImports": false,                     // true | false
  "emptyLineAfterImports": false,           // true | false

  // Empty Lines
  "emptyLineAfterFunctionOpen": false,      // true | false
  "emptyLineBeforeFunctionClose": false,    // true | false
  "emptyLineBeforeReturn": false,           // false | "always" | "not-alone"
  "emptyLineBeforeComment": false,          // true | false

  // Control Flow
  "parenthesisIfCase": "preserve",         // "preserve" | "always" | "never"
  "elseOnNewLine": true,                    // true | false  (not yet implemented)
  "forLoopSpacing": true,                   // true | false

  // Miscellaneous
  "printStatement": "preserve",            // "preserve" | "remove"
  "lineCommentPosition": "preserve",       // "preserve" | "above" | "inline"

  // BrightScript Patterns
  "observeFieldStyle": "preserve",         // "preserve" | "always-scoped"
  "mPrefixStyle": "preserve",              // "preserve" | "dot" | "bracket"
  "alignAssignments": false,               // true | false
  "fieldAccessConsistency": "preserve"     // "preserve" | "dot" | "method"
}`;

// ── Component ─────────────────────────────────────────────────────────────────
export default function FormatterPlayground() {
  const [source, setSource]         = useState(SAMPLE);
  const [configText, setConfigText] = useState(INITIAL_CONFIG_TEXT);
  const [configError, setConfigError] = useState<string | null>(null);
  const [fmtError, setFmtError]     = useState<string | null>(null);

  const config = useMemo<FormattingConfig>(() => {
    try {
      const parsed = JSON.parse(stripJsonComments(configText));
      setConfigError(null);
      return { ...DEFAULT_FORMATTING_CONFIG, ...parsed };
    } catch (e) {
      setConfigError(e instanceof Error ? e.message : 'Invalid JSON');
      return DEFAULT_FORMATTING_CONFIG;
    }
  }, [configText]);

  const formatted = useMemo(() => {
    try {
      setFmtError(null);
      return formatText(source, config);
    } catch (e) {
      setFmtError(e instanceof Error ? e.message : 'Formatting error');
      return source;
    }
  }, [source, config]);

  const outputNodes = useMemo(() => renderHighlighted(formatted), [formatted]);

  const applyPreset = (preset: typeof PRESETS[number]) => {
    // Rebuild the annotated config with the preset values applied
    const { verifySyntax: _v, ...values } = preset.config as FormattingConfig;
    // Replace just the values in the annotated text, preserving comments
    let text = INITIAL_CONFIG_TEXT;
    for (const [key, val] of Object.entries(values)) {
      // Match "key": <old value>  and replace the value part only
      text = text.replace(
        new RegExp(`("${key}"\\s*:\\s*)([^,\\n\\/]+)`),
        (_, prefix) => `${prefix}${JSON.stringify(val)}`
      );
    }
    setConfigText(text);
  };

  return (
    <div className="rounded-xl border border-[#1e2d4a] bg-[#0f1923] overflow-hidden">
      {/* Header */}
      <div className="px-4 py-3 border-b border-[#1e2d4a] bg-[#070b14]/50 flex items-center gap-3 flex-wrap">
        <span className="text-sm font-medium text-slate-300">Formatter Playground</span>
        <span className="text-xs text-slate-500">Edit code or config JSON — output updates live</span>
        <div className="ml-auto flex items-center gap-2">
          <span className="text-xs text-slate-600 mr-1">Presets:</span>
          {PRESETS.map(p => (
            <button
              key={p.label}
              onClick={() => applyPreset(p)}
              className="text-xs px-2.5 py-1 rounded bg-slate-800/60 border border-slate-700/50 text-slate-300 hover:border-violet-500/50 hover:text-violet-300 transition-colors"
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {/* Code panes */}
      <div className="grid grid-cols-1 md:grid-cols-2 divide-y md:divide-y-0 md:divide-x divide-[#1e2d4a]">
        <div>
          <div className="px-3 py-1.5 text-xs text-slate-500 border-b border-[#1e2d4a] bg-[#070b14]/30">
            Input
          </div>
          <SyntaxInput value={source} onChange={setSource} height="16rem" />
        </div>
        <div>
          <div className="px-3 py-1.5 text-xs border-b border-[#1e2d4a] bg-[#070b14]/30 flex justify-between">
            <span className="text-slate-500">Formatted output</span>
            {fmtError && <span className="text-red-400 text-xs">{fmtError}</span>}
          </div>
          <pre
            className="p-4 text-sm leading-relaxed overflow-auto m-0 whitespace-pre"
            style={{ fontFamily: '"JetBrains Mono", "Fira Code", monospace', height: '16rem' }}
          >
            {outputNodes}
          </pre>
        </div>
      </div>

      {/* Config editor */}
      <div className="border-t border-[#1e2d4a]">
        <div className="px-3 py-1.5 text-xs border-b border-[#1e2d4a] bg-[#070b14]/30 flex justify-between items-center">
          <span className="text-slate-500">
            Config (JSONC) — all options with valid values in comments, edit any value
          </span>
          {configError && <span className="text-red-400 text-xs">{configError}</span>}
        </div>
        <textarea
          value={configText}
          onChange={e => setConfigText(e.target.value)}
          spellCheck={false}
          rows={10}
          className="w-full bg-[#0d1117] p-4 text-xs text-slate-300 resize-none outline-none leading-relaxed focus:bg-[#111820] transition-colors"
          style={{ fontFamily: 'JetBrains Mono, Fira Code, monospace' }}
        />
      </div>
    </div>
  );
}
