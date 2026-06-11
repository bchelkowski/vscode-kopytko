# kopytko-formatter

BrightScript formatter and code style checker for the [Kopytko ecosystem](https://github.com/bchelkowski/vscode-kopytko).

Use it as a **CLI tool** in CI pipelines, or import it as a **library** in your own tools.

## Installation

```bash
npm install --save-dev kopytko-formatter
```

## CLI Usage

```bash
# Check mode — exit 1 if any file needs formatting (use in CI)
npx kopytko-format --check "src/**/*.brs"

# Write mode — format files in place
npx kopytko-format --write "src/**/*.brs"

# With explicit config
npx kopytko-format --check --config .kopytkorc "components/**/*.brs"
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
3. `.vscode/settings.json` — reads `kopytko.format.*` keys automatically (supports JSONC: inline `//` comments, block `/* */` comments, and trailing commas)

Config keys match the VS Code extension settings without the `kopytko.format.` prefix.

### Example `kopytko-formatter.json`

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
  "keywordCasing": "LowerCase",
  "builtinCasing": "PascalCase",
  "typeCasing": "PascalCase",
  "literalCasing": "LowerCase",
  "logicOperatorCasing": "UpperCase",
  "ignore": [
    "**/node_modules/**",
    "**/dist/**",
    "**/_tests/**"
  ]
}
```

If your project already has formatting settings in `.vscode/settings.json`, no extra config file is needed — the CLI reads them directly.

### Ignoring files

Exclude paths from formatting via the `ignore` array in your config file or the `--ignore` CLI flag:

```bash
# CLI flag (repeatable)
npx kopytko-format --check --ignore "**/_tests/**" --ignore "**/dist/**" app

# Or in kopytko-formatter.json / .vscode/settings.json
# "ignore": ["**/_tests/**", "**/dist/**"]
```

Patterns use glob syntax: `*` matches within a path segment, `**` matches any depth.

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

Formats BrightScript source code using an 11-pass engine.

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
      - run: npx kopytko-format --check "src/**/*.brs"
```

## License

MIT
