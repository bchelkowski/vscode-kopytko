# kopytko-linter

BrightScript linter for the [Kopytko ecosystem](https://github.com/bchelkowski/vscode-kopytko). Use as a CLI tool in CI pipelines or import as a library.

## Features

- **19 diagnostic rules** covering imports, identifiers, syntax, and test structure
- **Configurable severity** per rule (`error`, `warning`, `info`, `hint`, `off`)
- **Three output formats**: text (terminal), JSON, [SARIF](https://sarifweb.azurewebsites.net/) (GitHub Code Scanning)
- **Config file support**: `kopytko-linter.json` or `.vscode/settings.json`
- **Library API** for integration with editors and build tools

## Installation

```bash
npm install --save-dev kopytko-linter
```

## CLI Usage

```bash
# Lint the current project
npx kopytko-lint

# CI mode — exit with code 1 if any errors are found
npx kopytko-lint --check

# Output as JSON
npx kopytko-lint --format json

# Output SARIF for GitHub Code Scanning
npx kopytko-lint --format sarif > results.sarif

# Use a specific config file
npx kopytko-lint --config my-rules.json

# Override source directory
npx kopytko-lint --source-dir components
```

### CLI Options

| Option | Description |
|---|---|
| `--check` | Exit with code 1 if any errors are found (for CI) |
| `--fix` | Auto-fix fixable issues (unused imports, unused parameters) |
| `--format`, `-f` | Output format: `text` (default), `json`, `sarif` |
| `--config`, `-c` | Path to config file |
| `--source-dir` | Override source directory (default: from config or `src`) |
| `--no-color` | Disable colored terminal output |
| `--help`, `-h` | Show help |
| `--version`, `-v` | Show version |

## Configuration

### Config File Resolution

Configuration is resolved in this order:

1. `--config <file>` CLI flag
2. `kopytko-linter.json` in project root
3. `.vscode/settings.json` (`kopytko.lint.*` keys)
4. Default config (all rules enabled at default severity)

### Example `kopytko-linter.json`

```json
{
  "rules": {
    "import/unused": "off",
    "identifier/shadows-builtin": "warning",
    "syntax/trailing-comma": "error"
  },
  "sourceDir": "src",
  "resolveModules": true,
  "generatedPaths": ["/source/generated/**"],
  "generatedModules": [],
  "siblingPatterns": []
}
```

### VS Code Settings

Add `kopytko.lint.*` keys to `.vscode/settings.json`:

```json
{
  "kopytko.lint.sourceDir": "src",
  "kopytko.lint.rules.import/unused": "off",
  "kopytko.lint.rules.identifier/shadows-builtin": "warning"
}
```

## Rules

### Import Rules

| Rule | Default | Description |
|---|---|---|
| `import/duplicate` | error | Same import path imported twice |
| `import/missing-path` | error | `@import` / `@mock` with empty path |
| `import/path-not-absolute` | warning | Import path doesn't start with `/` |
| `import/wrong-comment-style` | error | `@import` written with `"` instead of `'` comment |
| `import/build-generated` | info | Unresolved path matches a configured generated-path pattern |
| `import/unresolved` | error | Cannot resolve import to a file on disk |
| `import/unused` | warning | Imported file's functions are never referenced |

### Identifier Rules

| Rule | Default | Description |
|---|---|---|
| `identifier/undefined-function` | error | Function call to unknown name |
| `identifier/wrong-arg-count` | error | Built-in function called with wrong number of arguments |
| `identifier/undefined-variable` | error | Variable used but never assigned in the enclosing scope |
| `identifier/shadows-builtin` | error | Variable name shadows a BrightScript built-in function |
| `identifier/unused-parameter` | warning | Function parameter never used in body (prefix `_` to suppress) |

### Syntax Rules

| Rule | Default | Description |
|---|---|---|
| `throw/invalid-value` | warning | `throw` with numeric, array, or `invalid` value |
| `throw/missing-message` | warning | Thrown associative array missing `message` field |
| `createobject/unknown-component` | warning | `CreateObject("...")` with unrecognized component name |
| `syntax/trailing-comma` | error | Trailing comma after `return` value |
| `syntax/flow-outside-loop` | error | `continue for`/`exit while` outside matching loop |

### Test Rules

| Rule | Default | Description |
|---|---|---|
| `test/missing-mock-annotation` | warning | `mockFunction("X")` targets a function not in any `@mock`'ed file |
| `test/missing-return-ts` | warning | `TestSuite__*` function missing `return ts` |

## Library API

```typescript
import { lintProject, lintFile, DEFAULT_LINTER_CONFIG } from 'kopytko-linter';
import type { LintContext, LintResult, LintDiagnostic } from 'kopytko-linter';

// Lint a whole project (standalone mode)
const result: LintResult = lintProject('/path/to/project');
console.log(`${result.errorCount} errors, ${result.warningCount} warnings`);

// Lint a single file (library mode — provide your own context)
const context: LintContext = {
  knownFuncNames: new Set(['init', 'myhelper']),
  parseImports: (text) => parseImports(text),
  resolveImportPath: (path) => /* resolve path */,
  importExists: (path) => /* check existence */,
  readFile: (path) => /* read file */,
  parseFunctionsFromFile: (path) => /* parse functions */,
  getSiblingFiles: (path) => /* find siblings */,
  isTestFile: (path) => path.endsWith('.test.brs'),
  generatedPaths: [],
  generatedModules: [],
  siblingPatterns: [],
};

const diagnostics: LintDiagnostic[] = lintFile(
  '/path/to/file.brs',
  fileContent,
  context,
  DEFAULT_LINTER_CONFIG,
);
```

## CI Integration

### GitHub Actions

```yaml
- name: Lint BrightScript
  run: npx kopytko-lint --check
```

### GitHub Code Scanning (SARIF)

```yaml
- name: Lint BrightScript
  run: npx kopytko-lint --format sarif > results.sarif

- name: Upload SARIF
  uses: github/codeql-action/upload-sarif@v3
  with:
    sarif_file: results.sarif
```

## License

MIT
