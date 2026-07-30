/**
 * Configuration for BrightScript document formatting.
 *
 * Every field has a sensible default so that the formatter works out of the box
 * with zero configuration. Users opt into stricter formatting by setting
 * individual rules in their VS Code settings under `kopytko.format.*`.
 */
export interface FormattingConfig {
  // ── Indentation & Whitespace ─────────────────────────────────────────────
  /** Spaces per indent level. */
  indentSize: number;
  /** Use tabs instead of spaces. */
  useTabs: boolean;
  /** Line ending style. 'auto' preserves the document's existing endings. */
  lineEnding: 'lf' | 'crlf' | 'auto';
  /** Remove trailing whitespace from lines. */
  trimTrailingWhitespace: boolean;
  /** Ensure the file ends with a newline. */
  insertFinalNewline: boolean;
  /** Maximum consecutive blank lines allowed (excess removed). 0 = no limit. */
  maxEmptyLines: number;
  /** Number of blank lines to enforce between top-level function/sub declarations. */
  emptyLinesBetweenFunctions: number;
  /** Number of blank lines between AA method definitions inside a builder function. */
  emptyLinesBetweenMethods: number;
  /** Blank lines at the start/end of blocks: 'strip' removes them, 'enforce' adds one, 'preserve' leaves as-is. */
  emptyLinesAtBlockBoundaries: 'strip' | 'enforce' | 'preserve';

  // ── Compound Keywords ────────────────────────────────────────────────────
  /** 'spaced' = `end if`, 'compact' = `endif`. Applies to all end-keyword variants. */
  endKeywordStyle: 'spaced' | 'compact' | 'preserve';
  /** Controls `then` on if-lines. 'multiline-only' adds it only on multi-line ifs. */
  thenStyle: 'always' | 'never' | 'multiline-only' | 'singleline-only' | 'preserve';

  // ── Functions & Subs ─────────────────────────────────────────────────────
  /** Controls function vs sub for void procedures. 'sub' converts function() as Void to sub(). 'function' converts sub to function. 'allow-void' keeps function() as Void as-is. */
  functionVsSubForVoid: 'function' | 'sub' | 'allow-void' | 'preserve';
  /** Space before `(` in named function/sub definitions: `function foo()` vs `function foo ()`. */
  spaceBeforeNamedFunctionParens: boolean;
  /** Space before `(` in anonymous function expressions: `function()` vs `function ()`. */
  spaceBeforeAnonymousFunctionParens: boolean;
  /** Space before `(` in function calls: `doWork()` vs `doWork ()`. */
  spaceBeforeCallParens: boolean;
  /** Spaces inside `()` in calls and definitions. */
  spaceInsideParens: 'never' | 'always';
  /** Multi-line parameter alignment: 'indent' uses one level, 'align-to-paren' aligns to opening paren, 'preserve' leaves as-is. */
  paramAlignmentStyle: 'indent' | 'align-to-paren' | 'preserve';

  // ── Line Length & Wrapping ───────────────────────────────────────────────
  /** Max line length before the formatter wraps long strings. 0 = no limit. */
  maxLineLength: number;
  /** Long string handling: 'plus' breaks with + concatenation, 'array-join' breaks with [...].join(""), 'preserve' leaves as-is. */
  wrapLongStrings: 'preserve' | 'plus' | 'array-join';
  /** String concatenation style normalization: 'plus' enforces +, 'array-join' enforces [...].join(""), 'preserve' leaves as-is. */
  stringConcatStyle: 'preserve' | 'plus' | 'array-join';

  // ── Arrays & Associative Arrays ──────────────────────────────────────────
  /** Spaces inside `{}`: `{ key: value }` vs `{key: value}`. */
  associativeArrayBracketSpacing: boolean;
  /** Spaces around commas separating key-value pairs inside inline `{}`. 'after' = `{a: 1, b: 2}`, 'before' = `{a: 1 ,b: 2}`, 'both' = `{a: 1 , b: 2}`, 'none' = `{a: 1,b: 2}`. Only applied to commas inside `{}` on the same line (not multi-line AAs). */
  associativeArrayCommaSpacing: 'after' | 'before' | 'both' | 'none' | 'preserve';
  /** Spaces around commas separating elements inside inline `[]`. Same values as `associativeArrayCommaSpacing`; applied to whichever bracket most immediately encloses the comma, so a `[{...}]` array of AAs gets each bracket's own setting. Only applied to commas on the same line as the surrounding `[`/`]` (not multi-line arrays). */
  arrayCommaSpacing: 'after' | 'before' | 'both' | 'none' | 'preserve';
  /** Spaces around commas separating arguments/parameters inside `()` — function calls and function/sub definitions alike. Same values as `associativeArrayCommaSpacing`. Only applied to commas on the same line as the surrounding `(`/`)` (not multi-line parameter/argument lists). */
  parenCommaSpacing: 'after' | 'before' | 'both' | 'none' | 'preserve';
  /** Trailing comma after the last item in multi-line arrays/AAs. */
  trailingComma: 'never' | 'always' | 'multiline';
  /** Comma separators between items in multi-line arrays. BrightScript allows omitting commas when items are on separate lines. */
  arrayCommaStyle: 'always' | 'never' | 'preserve';
  /** Comma separators between entries in multi-line AAs. BrightScript allows omitting commas when entries are on separate lines. */
  associativeArrayCommaStyle: 'always' | 'never' | 'preserve';
  /** When true, splits `[{` onto separate lines in multi-item arrays (improves readability). */
  arraySplitOpenBracket: boolean;
  /** Max number of keys before forcing an AA to multi-line. 0 = no limit. */
  associativeArraySingleLineThreshold: number;

  // ── Operators & Expressions ──────────────────────────────────────────────
  /** Spaces around binary operators (+, -, *, /, <>, <, >, and, or, mod). */
  spaceAroundOperators: boolean;
  /** Spaces around = in assignments. */
  spaceAroundAssignment: boolean;
  /** Space after unary `not`. */
  unarySpacing: boolean;

  // ── Comments ─────────────────────────────────────────────────────────────
  /** Normalize comment markers: `'` or `rem`, or preserve. */
  commentStyle: "'" | 'rem' | 'preserve';
  /** Enforce space after `'` or `rem`: `' comment` vs `'comment`. */
  spaceAfterCommentMarker: boolean;
  /** Max comment line length. 0 = no limit. */
  commentWidth: number;

  // ── Imports ──────────────────────────────────────────────────────────────
  /** Sort @import statements alphabetically (module name first, then path). */
  sortImports: boolean;
  /** Insert blank line between module imports and local imports. */
  /** Insert blank line after the last @import line (before code starts). */
  emptyLineAfterImports: boolean;

  // ── Empty Line Rules ───────────────────────────────────────────────────
  /** Insert empty line after function/sub opening line. */
  emptyLineAfterFunctionOpen: boolean;
  /** Insert empty line before end function/sub. */
  emptyLineBeforeFunctionClose: boolean;
  /** Empty line before return: 'always', 'not-alone' (skip when return is only statement in block), or false. */
  emptyLineBeforeReturn: 'always' | 'not-alone' | false;
  /** Enforce empty line before stand-alone comment blocks. */
  emptyLineBeforeComment: boolean;

  // ── Control Flow ─────────────────────────────────────────────────────────
  /** 'always' wraps if condition in parens, 'never' removes them. */
  parenthesisIfCase: 'preserve' | 'always' | 'never';
  /** else on its own line (true) vs same line as end if. */
  elseOnNewLine: boolean;
  /** Enforce spaces around `to` and `step` in for loops. */
  forLoopSpacing: boolean;

  // ── Miscellaneous ────────────────────────────────────────────────────────
  /** Flag or remove print debug statements. */
  printStatement: 'warn' | 'remove' | 'preserve';
  /** Move trailing comments. 'above' puts them on the line above. */
  lineCommentPosition: 'above' | 'inline' | 'preserve';

  // ── BrightScript Patterns ───────────────────────────────────────────────
  /** Enforce observeFieldScoped over observeField. 'always-scoped' converts to scoped, 'preserve' leaves as-is. */
  observeFieldStyle: 'always-scoped' | 'preserve';
  /** m-prefix field access style. 'dot' enforces m.field, 'bracket' enforces m["field"], 'preserve' leaves as-is. */
  mPrefixStyle: 'dot' | 'bracket' | 'preserve';
  /** Align = signs in consecutive assignment lines. */
  alignAssignments: boolean;
  /** Field access consistency on known objects. 'dot' prefers m.top.field, 'method' prefers m.top.getField("field"), 'preserve' leaves as-is. */
  fieldAccessConsistency: 'dot' | 'method' | 'preserve';

  // ── Safety ─────────────────────────────────────────────────────────────────
  /** Parse the formatted output to verify it's still valid BrightScript.
   *  If syntax errors are detected, the original source is returned unchanged.
   *  Default: true. */
  verifySyntax: boolean;
}

/** Default formatting config — all rules set to preserve existing code style. */
export const DEFAULT_FORMATTING_CONFIG: FormattingConfig = {
  // Indentation & Whitespace
  indentSize: 4,
  useTabs: false,
  lineEnding: 'auto',
  trimTrailingWhitespace: true,
  insertFinalNewline: true,
  maxEmptyLines: 2,
  emptyLinesBetweenFunctions: 1,
  emptyLinesBetweenMethods: 1,
  emptyLinesAtBlockBoundaries: 'preserve',

  // Compound Keywords
  endKeywordStyle: 'preserve',
  thenStyle: 'preserve',

  // Functions & Subs
  functionVsSubForVoid: 'preserve',
  spaceBeforeNamedFunctionParens: false,
  spaceBeforeAnonymousFunctionParens: false,
  spaceBeforeCallParens: false,
  spaceInsideParens: 'never',
  paramAlignmentStyle: 'preserve',

  // Line Length & Wrapping
  maxLineLength: 120,
  wrapLongStrings: 'preserve',
  stringConcatStyle: 'preserve',

  // Arrays & AAs
  associativeArrayBracketSpacing: true,
  associativeArrayCommaSpacing: 'preserve',
  arrayCommaSpacing: 'preserve',
  parenCommaSpacing: 'preserve',
  trailingComma: 'never',
  arrayCommaStyle: 'preserve',
  associativeArrayCommaStyle: 'preserve',
  arraySplitOpenBracket: false,
  associativeArraySingleLineThreshold: 0,

  // Operators & Expressions
  spaceAroundOperators: true,
  spaceAroundAssignment: true,
  unarySpacing: true,

  // Comments
  commentStyle: 'preserve',
  spaceAfterCommentMarker: true,
  commentWidth: 0,

  // Imports
  sortImports: false,
  emptyLineAfterImports: false,

  // Empty Lines
  emptyLineAfterFunctionOpen: false,
  emptyLineBeforeFunctionClose: false,
  emptyLineBeforeReturn: false,
  emptyLineBeforeComment: false,

  // Control Flow
  parenthesisIfCase: 'preserve',
  elseOnNewLine: true,
  forLoopSpacing: true,

  // Miscellaneous
  printStatement: 'preserve',
  lineCommentPosition: 'preserve',

  // BrightScript Patterns
  observeFieldStyle: 'preserve',
  mPrefixStyle: 'preserve',
  alignAssignments: false,
  fieldAccessConsistency: 'preserve',

  // Safety
  verifySyntax: true,
};

/** Reads a FormattingConfig from a raw VS Code settings object. */
export function parseFormattingConfig(cfg: Record<string, unknown> | null | undefined): FormattingConfig {
  const result: FormattingConfig = { ...DEFAULT_FORMATTING_CONFIG };
  if (!cfg) return result;

  for (const key of Object.keys(DEFAULT_FORMATTING_CONFIG) as (keyof FormattingConfig)[]) {
    if (key === 'emptyLineBeforeReturn') continue;

    const value = cfg[key];
    const defaultValue = DEFAULT_FORMATTING_CONFIG[key];
    if (typeof defaultValue === 'number' && typeof value === 'number') {
      (result as Record<keyof FormattingConfig, unknown>)[key] = value;
    } else if (typeof defaultValue === 'boolean' && typeof value === 'boolean') {
      (result as Record<keyof FormattingConfig, unknown>)[key] = value;
    } else if (typeof defaultValue === 'string' && typeof value === 'string') {
      (result as Record<keyof FormattingConfig, unknown>)[key] = value;
    }
  }

  const emptyLineBeforeReturn = cfg.emptyLineBeforeReturn;
  if (emptyLineBeforeReturn === 'always' || emptyLineBeforeReturn === 'not-alone') {
    result.emptyLineBeforeReturn = emptyLineBeforeReturn;
  } else if (emptyLineBeforeReturn === true) {
    result.emptyLineBeforeReturn = 'always';
  } else {
    result.emptyLineBeforeReturn = false;
  }

  return result;
}
