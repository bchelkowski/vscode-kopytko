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
  /** Enforce or remove `as Type` return annotations on functions. */
  returnTypeAnnotations: 'always' | 'never' | 'preserve';
  /** Enforce or remove `as Type` param annotations. */
  paramTypeAnnotations: 'always' | 'never' | 'preserve';
  /** Multi-line parameter alignment: 'indent' uses one level, 'align-to-paren' aligns to opening paren. */
  paramAlignmentStyle: 'indent' | 'align-to-paren';
  /** Line length at which to wrap parameters to multiple lines. 0 = never wrap. */
  wrapParamsThreshold: number;

  // ── Line Length & Wrapping ───────────────────────────────────────────────
  /** Maximum desired line length. */
  printWidth: number;
  /** Long string handling: 'plus' breaks with + concatenation, 'array-join' breaks with [...].join(""), 'preserve' leaves as-is. */
  wrapLongStrings: 'preserve' | 'plus' | 'array-join';
  /** String concatenation style normalization: 'plus' enforces +, 'array-join' enforces [...].join(""), 'preserve' leaves as-is. */
  stringConcatStyle: 'preserve' | 'plus' | 'array-join';
  /** Break long method/field chains onto new lines. */
  wrapLongChains: boolean;
  /** Multi-line array literals. 'auto' = multi-line when exceeding printWidth. */
  wrapArrays: 'auto' | 'always' | 'never';
  /** Multi-line AA literals {}. 'auto' = multi-line when exceeding printWidth. */
  wrapAssocArrays: 'auto' | 'always' | 'never';

  // ── Arrays & Associative Arrays ──────────────────────────────────────────
  /** Spaces inside `{}`: `{ key: value }` vs `{key: value}`. */
  bracketSpacing: boolean;
  /** Spaces around commas separating key-value pairs inside inline `{}`. 'after' = `{a: 1, b: 2}`, 'before' = `{a: 1 ,b: 2}`, 'both' = `{a: 1 , b: 2}`, 'none' = `{a: 1,b: 2}`. Only applied to commas inside `{}` on the same line (not multi-line AAs). */
  aaCommaSpacing: 'after' | 'before' | 'both' | 'none' | 'preserve';
  /** Trailing comma after the last item in multi-line arrays/AAs. */
  trailingComma: 'never' | 'always' | 'multiline';
  /** Comma separators between items in multi-line arrays. BrightScript allows omitting commas when items are on separate lines. */
  arrayCommaStyle: 'always' | 'never' | 'preserve';
  /** Comma separators between entries in multi-line AAs. BrightScript allows omitting commas when entries are on separate lines. */
  assocArrayCommaStyle: 'always' | 'never' | 'preserve';
  /** When true, splits `[{` onto separate lines in multi-item arrays (improves readability). */
  splitArrayOpenBracket: boolean;
  /** Align values in multi-line AAs. */
  arrayItemAlignment: 'off' | 'align';
  /** Max number of keys before forcing an AA to multi-line. 0 = no limit. */
  singleLineObjectThreshold: number;

  // ── Operators & Expressions ──────────────────────────────────────────────
  /** Spaces around binary operators (+, -, *, /, <>, <, >, and, or, mod). */
  spaceAroundOperators: boolean;
  /** Spaces around = in assignments. */
  spaceAroundAssignment: boolean;
  /** Space after unary `not`. */
  unarySpacing: boolean;
  /** Where to put operators on wrapped lines: 'before' or 'after' the break. */
  operatorLineBreakStyle: 'before' | 'after';

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

  // ── Blank Line Rules ─────────────────────────────────────────────────────
  /** Insert blank line after function/sub opening line. */
  blankLineAfterFunctionOpen: boolean;
  /** Insert blank line before end function/sub. */
  blankLineBeforeFunctionClose: boolean;
  /** Blank line before return: 'always', 'not-alone' (skip when return is only statement in block), or false. */
  blankLineBeforeReturn: 'always' | 'not-alone' | false;
  /** Enforce blank line before stand-alone comment blocks. */
  blankLineBeforeComment: boolean;
  /** Insert blank lines between visually distinct statement groups. */
  separateLogicBlocks: boolean;

  // ── Control Flow ─────────────────────────────────────────────────────────
  /** Max expression length for single-line if/then. 0 = never inline. */
  inlineIfThreshold: number;
  /** 'always' wraps if condition in parens, 'never' removes them. */
  parenthesisIfCase: 'preserve' | 'always' | 'never';
  /** Controls parentheses around the catch variable: `catch e` vs `catch (e)`. */
  catchParenStyle: 'always' | 'never' | 'preserve';
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
  /** Enforce observeFieldScoped over observeField. 'always-scoped' converts to scoped, 'warn' flags non-scoped, 'preserve' leaves as-is. */
  observeFieldStyle: 'always-scoped' | 'warn' | 'preserve';
  /** m-prefix field access style. 'dot' enforces m.field, 'bracket' enforces m["field"], 'preserve' leaves as-is. */
  mPrefixStyle: 'dot' | 'bracket' | 'preserve';
  /** Align = signs in consecutive assignment lines. */
  alignAssignments: boolean;
  /** Field access consistency on known objects. 'dot' prefers m.top.field, 'method' prefers m.top.getField("field"), 'preserve' leaves as-is. */
  fieldAccessConsistency: 'dot' | 'method' | 'preserve';
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
  returnTypeAnnotations: 'preserve',
  paramTypeAnnotations: 'preserve',
  paramAlignmentStyle: 'indent',
  wrapParamsThreshold: 0,

  // Line Length & Wrapping
  printWidth: 160,
  wrapLongStrings: 'preserve',
  stringConcatStyle: 'preserve',
  wrapLongChains: false,
  wrapArrays: 'never',
  wrapAssocArrays: 'never',

  // Arrays & AAs
  bracketSpacing: true,
  aaCommaSpacing: 'preserve',
  trailingComma: 'never',
  arrayCommaStyle: 'preserve',
  assocArrayCommaStyle: 'preserve',
  splitArrayOpenBracket: false,
  arrayItemAlignment: 'off',
  singleLineObjectThreshold: 0,

  // Operators & Expressions
  spaceAroundOperators: true,
  spaceAroundAssignment: true,
  unarySpacing: true,
  operatorLineBreakStyle: 'before',

  // Comments
  commentStyle: 'preserve',
  spaceAfterCommentMarker: true,
  commentWidth: 0,

  // Imports
  sortImports: false,
  emptyLineAfterImports: false,

  // Blank Lines
  blankLineAfterFunctionOpen: false,
  blankLineBeforeFunctionClose: false,
  blankLineBeforeReturn: false,
  blankLineBeforeComment: false,
  separateLogicBlocks: false,

  // Control Flow
  inlineIfThreshold: 0,
  parenthesisIfCase: 'preserve',
  catchParenStyle: 'preserve',
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
};

/** Reads a FormattingConfig from a raw VS Code settings object. */
export function parseFormattingConfig(cfg: Record<string, unknown> | null | undefined): FormattingConfig {
  if (!cfg) return { ...DEFAULT_FORMATTING_CONFIG };

  const d = DEFAULT_FORMATTING_CONFIG;
  const str = (key: string, def: string): string => {
    const v = cfg[key];
    return typeof v === 'string' ? v : def;
  };
  const num = (key: string, def: number): number => {
    const v = cfg[key];
    return typeof v === 'number' ? v : def;
  };
  const bool = (key: string, def: boolean): boolean => {
    const v = cfg[key];
    return typeof v === 'boolean' ? v : def;
  };

  return {
    indentSize: num('indentSize', d.indentSize),
    useTabs: bool('useTabs', d.useTabs),
    lineEnding: str('lineEnding', d.lineEnding) as FormattingConfig['lineEnding'],
    trimTrailingWhitespace: bool('trimTrailingWhitespace', d.trimTrailingWhitespace),
    insertFinalNewline: bool('insertFinalNewline', d.insertFinalNewline),
    maxEmptyLines: num('maxEmptyLines', d.maxEmptyLines),
    emptyLinesBetweenFunctions: num('emptyLinesBetweenFunctions', d.emptyLinesBetweenFunctions),
    emptyLinesBetweenMethods: num('emptyLinesBetweenMethods', d.emptyLinesBetweenMethods),
    emptyLinesAtBlockBoundaries: str('emptyLinesAtBlockBoundaries', d.emptyLinesAtBlockBoundaries) as FormattingConfig['emptyLinesAtBlockBoundaries'],

    endKeywordStyle: str('endKeywordStyle', d.endKeywordStyle) as FormattingConfig['endKeywordStyle'],
    thenStyle: str('thenStyle', d.thenStyle) as FormattingConfig['thenStyle'],

    functionVsSubForVoid: str('functionVsSubForVoid', d.functionVsSubForVoid) as FormattingConfig['functionVsSubForVoid'],
    spaceBeforeNamedFunctionParens: bool('spaceBeforeNamedFunctionParens', d.spaceBeforeNamedFunctionParens),
    spaceBeforeAnonymousFunctionParens: bool('spaceBeforeAnonymousFunctionParens', d.spaceBeforeAnonymousFunctionParens),
    spaceBeforeCallParens: bool('spaceBeforeCallParens', d.spaceBeforeCallParens),
    spaceInsideParens: str('spaceInsideParens', d.spaceInsideParens) as FormattingConfig['spaceInsideParens'],
    returnTypeAnnotations: str('returnTypeAnnotations', d.returnTypeAnnotations) as FormattingConfig['returnTypeAnnotations'],
    paramTypeAnnotations: str('paramTypeAnnotations', d.paramTypeAnnotations) as FormattingConfig['paramTypeAnnotations'],
    paramAlignmentStyle: str('paramAlignmentStyle', d.paramAlignmentStyle) as FormattingConfig['paramAlignmentStyle'],
    wrapParamsThreshold: num('wrapParamsThreshold', d.wrapParamsThreshold),

    printWidth: num('printWidth', d.printWidth),
    wrapLongStrings: str('wrapLongStrings', d.wrapLongStrings) as FormattingConfig['wrapLongStrings'],
    stringConcatStyle: str('stringConcatStyle', d.stringConcatStyle) as FormattingConfig['stringConcatStyle'],
    wrapLongChains: bool('wrapLongChains', d.wrapLongChains),
    wrapArrays: str('wrapArrays', d.wrapArrays) as FormattingConfig['wrapArrays'],
    wrapAssocArrays: str('wrapAssocArrays', d.wrapAssocArrays) as FormattingConfig['wrapAssocArrays'],

    bracketSpacing: bool('bracketSpacing', d.bracketSpacing),
    aaCommaSpacing: str('aaCommaSpacing', d.aaCommaSpacing) as FormattingConfig['aaCommaSpacing'],
    trailingComma: str('trailingComma', d.trailingComma) as FormattingConfig['trailingComma'],
    arrayCommaStyle: str('arrayCommaStyle', d.arrayCommaStyle) as FormattingConfig['arrayCommaStyle'],
    assocArrayCommaStyle: str('assocArrayCommaStyle', d.assocArrayCommaStyle) as FormattingConfig['assocArrayCommaStyle'],
    splitArrayOpenBracket: bool('splitArrayOpenBracket', d.splitArrayOpenBracket),
    arrayItemAlignment: str('arrayItemAlignment', d.arrayItemAlignment) as FormattingConfig['arrayItemAlignment'],
    singleLineObjectThreshold: num('singleLineObjectThreshold', d.singleLineObjectThreshold),

    spaceAroundOperators: bool('spaceAroundOperators', d.spaceAroundOperators),
    spaceAroundAssignment: bool('spaceAroundAssignment', d.spaceAroundAssignment),
    unarySpacing: bool('unarySpacing', d.unarySpacing),
    operatorLineBreakStyle: str('operatorLineBreakStyle', d.operatorLineBreakStyle) as FormattingConfig['operatorLineBreakStyle'],

    commentStyle: str('commentStyle', d.commentStyle) as FormattingConfig['commentStyle'],
    spaceAfterCommentMarker: bool('spaceAfterCommentMarker', d.spaceAfterCommentMarker),
    commentWidth: num('commentWidth', d.commentWidth),

    sortImports: bool('sortImports', d.sortImports),
    emptyLineAfterImports: bool('emptyLineAfterImports', d.emptyLineAfterImports),

    blankLineAfterFunctionOpen: bool('blankLineAfterFunctionOpen', d.blankLineAfterFunctionOpen),
    blankLineBeforeFunctionClose: bool('blankLineBeforeFunctionClose', d.blankLineBeforeFunctionClose),
    blankLineBeforeReturn: (() => {
      const v = cfg['blankLineBeforeReturn'];
      if (v === 'always' || v === 'not-alone') return v;
      if (v === true) return 'always';
      return false;
    })(),
    blankLineBeforeComment: bool('blankLineBeforeComment', d.blankLineBeforeComment),
    separateLogicBlocks: bool('separateLogicBlocks', d.separateLogicBlocks),

    inlineIfThreshold: num('inlineIfThreshold', d.inlineIfThreshold),
    parenthesisIfCase: str('parenthesisIfCase', d.parenthesisIfCase) as FormattingConfig['parenthesisIfCase'],
    catchParenStyle: str('catchParenStyle', d.catchParenStyle) as FormattingConfig['catchParenStyle'],
    elseOnNewLine: bool('elseOnNewLine', d.elseOnNewLine),
    forLoopSpacing: bool('forLoopSpacing', d.forLoopSpacing),

    printStatement: str('printStatement', d.printStatement) as FormattingConfig['printStatement'],
    lineCommentPosition: str('lineCommentPosition', d.lineCommentPosition) as FormattingConfig['lineCommentPosition'],

    observeFieldStyle: str('observeFieldStyle', d.observeFieldStyle) as FormattingConfig['observeFieldStyle'],
    mPrefixStyle: str('mPrefixStyle', d.mPrefixStyle) as FormattingConfig['mPrefixStyle'],
    alignAssignments: bool('alignAssignments', d.alignAssignments),
    fieldAccessConsistency: str('fieldAccessConsistency', d.fieldAccessConsistency) as FormattingConfig['fieldAccessConsistency'],
  };
}
