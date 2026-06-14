# kopytko-formatter

BrightScript formatter and code style checker for the [Kopytko ecosystem](https://github.com/bchelkowski/vscode-kopytko).

Use it as a **CLI tool** in CI pipelines, or import it as a **library** in your own tools.

## Installation

```bash
npm install --save-dev kopytko-formatter
```

## Recommended npm Scripts

Add these scripts to your project's `package.json` to run the formatter with the locally installed version — no `npx` needed:

```json
{
  "scripts": {
    "format": "kopytko-format --write \"src/**/*.brs\"",
    "format:check": "kopytko-format --check \"src/**/*.brs\""
  }
}
```

Then run:

```bash
npm run format          # format files in place
npm run format:check    # CI — exit 1 if any file needs formatting
```

> **Why npm scripts over npx?** `npx` may download a different version than what's installed locally. npm scripts resolve binaries from `node_modules/.bin/`, guaranteeing the exact installed version is used.

## CLI Usage

```bash
# Check mode — exit 1 if any file needs formatting (use in CI)
kopytko-format --check "src/**/*.brs"

# Write mode — format files in place
kopytko-format --write "src/**/*.brs"

# With explicit config
kopytko-format --check --config .kopytkorc "components/**/*.brs"
```

### Options

| Flag | Description |
|---|---|
| `--check` | Check mode — exit 1 if any file needs formatting |
| `--write` | Write formatted output back to files |
| `--config <path>` | Path to config file (JSON) |
| `--ignore <glob>` | Glob pattern of files to skip (repeatable) |
| `--help`, `-h` | Show help |
| `--version`, `-v` | Show version |

## Configuration

The formatter reads config from (in priority order):

1. `--config <file>` CLI flag
2. `kopytko-formatter.json` in the current directory
3. `.vscode/settings.json` — reads `kopytko.format.*` and `kopytko.casing.*` keys automatically (supports JSONC: inline `//` comments, block `/* */` comments, and trailing commas)

Config keys match the VS Code extension settings without the `kopytko.format.` prefix (for formatting rules) or `kopytko.casing.` prefix (for casing settings).

### Example `kopytko-formatter.json`

The config file can contain both formatting rules and casing settings:

```json
{
  "indentSize": 2,
  "endKeywordStyle": "spaced",
  "trimTrailingWhitespace": true,
  "insertFinalNewline": true,
  "spaceAroundOperators": true,
  "spaceAroundAssignment": true,
  "sortImports": true,
  "emptyLineAfterImports": true,
  "maxEmptyLines": 1,
  "emptyLinesBetweenFunctions": 1,
  "keywordCasing": "lower-case",
  "builtinCasing": "pascal-case",
  "typeCasing": "pascal-case",
  "literalCasing": "lower-case",
  "logicOperatorCasing": "upper-case",
  "ignore": [
    "**/node_modules/**",
    "**/dist/**",
    "**/_tests/**"
  ]
}
```

> **Note:** `keywordCasing`, `builtinCasing`, `typeCasing`, `literalCasing`, and `logicOperatorCasing` are casing settings (see `CasingConfig`). All other keys are formatting rules (see `FormattingConfig`). Casing values use kebab-case: `preserve`, `upper-case`, `lower-case`, `capitalize`, `pascal-case`, `camel-case`.

If your project already has formatting settings in `.vscode/settings.json`, no extra config file is needed — the CLI reads them directly.

### Ignoring files

Exclude paths from formatting via the `ignore` array in your config file or the `--ignore` CLI flag:

```bash
# CLI flag (repeatable)
kopytko-format --check --ignore "**/_tests/**" --ignore "**/dist/**" app

# Or in kopytko-formatter.json / .vscode/settings.json
# "ignore": ["**/_tests/**", "**/dist/**"]
```

Patterns use glob syntax: `*` matches within a path segment, `**` matches any depth.

## VS Code Settings Reference

When used inside the [Kopytko extension](https://github.com/bchelkowski/vscode-kopytko), the formatter is configured via VS Code settings using the `kopytko.format.` prefix. The tables below list all available settings.

### Indentation & Whitespace

| Setting | Type | Default | Description |
|---|---|---|---|
| `kopytko.format.indentSize` | `integer` | `4` | Number of spaces per indentation level |
| `kopytko.format.useTabs` | `boolean` | `false` | Use tabs instead of spaces for indentation |
| `kopytko.format.lineEnding` | `"lf" \| "crlf" \| "auto"` | `"auto"` | Line ending style; `auto` preserves the document's existing endings |
| `kopytko.format.trimTrailingWhitespace` | `boolean` | `true` | Remove trailing whitespace from lines |
| `kopytko.format.insertFinalNewline` | `boolean` | `true` | Ensure the file ends with a newline |
| `kopytko.format.maxEmptyLines` | `integer` | `2` | Maximum consecutive blank lines allowed; `0` = no limit |
| `kopytko.format.emptyLinesBetweenFunctions` | `integer` | `1` | Blank lines between top-level function/sub declarations |
| `kopytko.format.emptyLinesBetweenMethods` | `integer` | `1` | Blank lines between AA method definitions inside a builder function |
| `kopytko.format.emptyLinesAtBlockBoundaries` | `"strip" \| "enforce" \| "preserve"` | `"preserve"` | Blank lines at the start/end of blocks |

### Compound Keywords

| Setting | Type | Default | Description |
|---|---|---|---|
| `kopytko.format.endKeywordStyle` | `"spaced" \| "compact" \| "preserve"` | `"preserve"` | Compound end-keyword style: `spaced` = `end if`, `compact` = `endif` |
| `kopytko.format.thenStyle` | `"always" \| "never" \| "multiline-only" \| "singleline-only" \| "preserve"` | `"preserve"` | Controls `then` on if-lines |

### Functions & Subs

| Setting | Type | Default | Description |
|---|---|---|---|
| `kopytko.format.functionVsSubForVoid` | `"function" \| "sub" \| "allow-void" \| "preserve"` | `"preserve"` | Controls function vs sub for void procedures |
| `kopytko.format.spaceBeforeNamedFunctionParens` | `boolean` | `false` | Space before `(` in named function/sub definitions |
| `kopytko.format.spaceBeforeAnonymousFunctionParens` | `boolean` | `false` | Space before `(` in anonymous function expressions |
| `kopytko.format.spaceBeforeCallParens` | `boolean` | `false` | Space before `(` in function calls |
| `kopytko.format.spaceInsideParens` | `"never" \| "always"` | `"never"` | Spaces inside `()` in calls and definitions |
| `kopytko.format.paramAlignmentStyle` | `"indent" \| "align-to-paren" \| "preserve"` | `"preserve"` | Multi-line parameter alignment style |

### Strings

| Setting | Type | Default | Description |
|---|---|---|---|
| `kopytko.format.maxLineLength` | `integer` | `120` | Max line length before wrapping long strings; `0` = no limit |
| `kopytko.format.wrapLongStrings` | `"preserve" \| "plus" \| "array-join"` | `"preserve"` | How to break long string literals |
| `kopytko.format.stringConcatStyle` | `"preserve" \| "plus" \| "array-join"` | `"preserve"` | Normalize string concatenation style |

### Arrays & Associative Arrays

| Setting | Type | Default | Description |
|---|---|---|---|
| `kopytko.format.associativeArrayBracketSpacing` | `boolean` | `true` | Spaces inside `{}`: `{ key: value }` (true) vs `{key: value}` (false) |
| `kopytko.format.associativeArrayCommaSpacing` | `"preserve" \| "after" \| "before" \| "both" \| "none"` | `"preserve"` | Spaces around commas in inline associative arrays |
| `kopytko.format.trailingComma` | `"never" \| "always" \| "multiline"` | `"never"` | Trailing comma after the last item in multi-line arrays and AAs |
| `kopytko.format.arrayCommaStyle` | `"always" \| "never" \| "preserve"` | `"preserve"` | Comma separators in multi-line arrays |
| `kopytko.format.associativeArrayCommaStyle` | `"always" \| "never" \| "preserve"` | `"preserve"` | Comma separators in multi-line associative arrays |
| `kopytko.format.associativeArraySingleLineThreshold` | `integer` | `0` | Max keys before forcing an AA to multi-line; `0` = no limit |
| `kopytko.format.arraySplitOpenBracket` | `boolean` | `false` | Splits `[{` onto separate lines in multi-item arrays |

### Operators & Expressions

| Setting | Type | Default | Description |
|---|---|---|---|
| `kopytko.format.spaceAroundOperators` | `boolean` | `true` | Spaces around binary operators (`+`, `-`, `*`, `/`, `<>`, `and`, `or`, `mod`) |
| `kopytko.format.spaceAroundAssignment` | `boolean` | `true` | Spaces around `=` in assignments |
| `kopytko.format.unarySpacing` | `boolean` | `true` | Space after unary `not` |

### Comments

| Setting | Type | Default | Description |
|---|---|---|---|
| `kopytko.format.commentStyle` | `"'" \| "rem" \| "preserve"` | `"preserve"` | Normalize comment markers: `'` or `rem` |
| `kopytko.format.spaceAfterCommentMarker` | `boolean` | `true` | Enforce space after `'` or `rem` |
| `kopytko.format.commentWidth` | `integer` | `0` | Max comment line length; `0` = no limit |

### Imports

| Setting | Type | Default | Description |
|---|---|---|---|
| `kopytko.format.sortImports` | `boolean` | `false` | Sort `@import` statements alphabetically |
| `kopytko.format.emptyLineAfterImports` | `boolean` | `false` | Insert blank line after the last `@import` line |

### Blank Lines

| Setting | Type | Default | Description |
|---|---|---|---|
| `kopytko.format.emptyLineAfterFunctionOpen` | `boolean` | `false` | Insert empty line after function/sub opening line |
| `kopytko.format.emptyLineBeforeFunctionClose` | `boolean` | `false` | Insert empty line before end function/sub |
| `kopytko.format.emptyLineBeforeReturn` | `string \| boolean` | `false` | Empty line before `return` statements; `"not-alone"` skips single-statement blocks |
| `kopytko.format.emptyLineBeforeComment` | `boolean` | `false` | Enforce empty line before stand-alone comment blocks |

### Control Flow

| Setting | Type | Default | Description |
|---|---|---|---|
| `kopytko.format.parenthesisIfCase` | `"preserve" \| "always" \| "never"` | `"preserve"` | Wrap if-condition in parentheses |
| `kopytko.format.elseOnNewLine` | `boolean` | `true` | Place `else` on its own line |
| `kopytko.format.forLoopSpacing` | `boolean` | `true` | Enforce spaces around `to` and `step` in for loops |

### BrightScript Patterns

| Setting | Type | Default | Description |
|---|---|---|---|
| `kopytko.format.observeFieldStyle` | `"always-scoped" \| "warn" \| "preserve"` | `"preserve"` | Enforce `observeFieldScoped` over `observeField` |
| `kopytko.format.mPrefixStyle` | `"dot" \| "bracket" \| "preserve"` | `"preserve"` | Normalize `m`-prefix field access style |
| `kopytko.format.alignAssignments` | `boolean` | `false` | Align `=` signs in consecutive assignment lines |
| `kopytko.format.fieldAccessConsistency` | `"dot" \| "method" \| "preserve"` | `"preserve"` | Field access consistency on nodes (dot vs `getField`/`setField`) |

### Miscellaneous

| Setting | Type | Default | Description |
|---|---|---|---|
| `kopytko.format.printStatement` | `"warn" \| "remove" \| "preserve"` | `"preserve"` | Flag or remove `print` debug statements |
| `kopytko.format.lineCommentPosition` | `"above" \| "inline" \| "preserve"` | `"preserve"` | Move trailing comments: `above` puts them on the line above |

### Casing

Casing settings use the `kopytko.casing.` prefix and control identifier casing in both completions and formatting.

| Setting | Type | Default | Description |
|---|---|---|---|
| `kopytko.casing.builtin` | `string` | `"preserve"` | Casing for built-in function names |
| `kopytko.casing.keyword` | `string` | `"preserve"` | Casing for keywords (fallback for sub-categories) |
| `kopytko.casing.type` | `string` | — | Casing for type names; falls back to `keyword` |
| `kopytko.casing.literal` | `string` | — | Casing for `true`, `false`, `invalid`; falls back to `keyword` |
| `kopytko.casing.logicOperator` | `string` | — | Casing for `and`, `or`, `not`; falls back to `keyword` |
| `kopytko.casing.mathOperator` | `string` | — | Casing for `mod`; falls back to `keyword` |
| `kopytko.casing.method` | `string` | `"preserve"` | Casing for component method names |
| `kopytko.casing.userFunction` | `string` | `"preserve"` | Casing for user-defined functions |
| `kopytko.casing.userMethod` | `string` | `"preserve"` | Casing for user-defined AA methods |
| `kopytko.casing.exact` | `object` | `{}` | Per-identifier casing overrides |

Casing values: `preserve`, `upper-case`, `lower-case`, `capitalize`, `pascal-case`, `camel-case`.

## Library Usage

```typescript
import { formatText, checkFormatting, DEFAULT_FORMATTING_CONFIG } from 'kopytko-formatter';

// Format a BrightScript source string
const formatted = formatText(source, {
  ...DEFAULT_FORMATTING_CONFIG,
  indentSize: 2,
  endKeywordStyle: 'spaced',
});

// Check if source is already formatted (returns boolean)
const isClean = checkFormatting(source, DEFAULT_FORMATTING_CONFIG);
```

### API

#### `formatText(source, config, casing?, userFunctions?): string`

Formats BrightScript source code using a multi-pass engine (16 pass functions in 11 logical stages).

- `source` — raw BrightScript source text
- `config` — `FormattingConfig` object
- `casing` — optional `CasingConfig` for identifier casing rules
- `userFunctions` — optional array of known function definitions for casing normalization

#### `checkFormatting(source, config, casing?, userFunctions?): boolean`

Returns `true` if the source text is already formatted (no changes needed).

## GitHub Actions

```yaml
# .github/workflows/format-check.yml
name: Format Check
on: [push, pull_request]
jobs:
  format:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 24
      - run: npm ci
      - run: npm run format:check
```

> This assumes `format:check` is defined in your `package.json` scripts (see [Recommended npm Scripts](#recommended-npm-scripts) above).

## License

MIT
