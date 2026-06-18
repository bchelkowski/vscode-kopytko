# kopytko-linter

BrightScript linter for the [Kopytko ecosystem](https://github.com/bchelkowski/vscode-kopytko). Use as a CLI tool in CI pipelines or import as a library.

## Features

- **24 diagnostic rules** covering imports, identifiers, syntax, test structure, type annotations, and callbacks
- **Configurable severity** per rule (`error`, `warning`, `info`, `hint`, `off`)
- **Three output formats**: text (terminal), JSON, [SARIF](https://sarifweb.azurewebsites.net/) (GitHub Code Scanning)
- **Config file support**: `kopytko-linter.json` or `.vscode/settings.json`
- **Library API** for integration with editors and build tools

## Installation

```bash
npm install --save-dev kopytko-linter
```

## Recommended npm Scripts

Add these scripts to your project's `package.json` to run the linter with the locally installed version — no `npx` needed:

```json
{
  "scripts": {
    "lint:brs": "kopytko-lint",
    "lint:brs:check": "kopytko-lint --check",
    "lint:brs:fix": "kopytko-lint --fix"
  }
}
```

Then run:

```bash
npm run lint:brs          # lint and report
npm run lint:brs:check    # CI — exit 1 if any errors found
npm run lint:brs:fix      # auto-fix fixable issues
```

> **Why npm scripts over npx?** `npx` may download a different version than what's installed locally. npm scripts resolve binaries from `node_modules/.bin/`, guaranteeing the exact installed version is used.

## CLI Usage

```bash
# Lint the current project
kopytko-lint

# CI mode — exit with code 1 if any errors are found
kopytko-lint --check

# Output as JSON
kopytko-lint --format json

# Output SARIF for GitHub Code Scanning
kopytko-lint --format sarif > results.sarif

# Use a specific config file
kopytko-lint --config my-rules.json

# Override source directory
kopytko-lint --source-dir components
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
  "kopytko.lint.rules.identifier/shadows-builtin": "warning",
  "kopytko.lint.rules.type/missing-return-type": "error",
  "kopytko.lint.rules.type/missing-param-type": "error"
}
```

> **Shared read-only paths:** You can also set `kopytko.readOnlyPaths` as a shared fallback that applies to both formatting and linting. The linter uses `kopytko.lint.readOnlyPaths` when set, otherwise it falls back to `kopytko.readOnlyPaths`.

### Read-only Paths

Files matching read-only path patterns are excluded from linting. The linter checks `kopytko.lint.readOnlyPaths` first, falling back to `kopytko.readOnlyPaths` if the linter-specific setting is not configured.

```json
{
  "kopytko.lint.readOnlyPaths": [
    "**/node_modules/**",
    "**/generated/**",
    "**/legacy/**"
  ]
}
```

In `kopytko-linter.json`, use the `readOnlyPaths` key directly:

```json
{
  "readOnlyPaths": [
    "**/node_modules/**",
    "**/generated/**"
  ]
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
| `import/missing-promise-deps` | warning | `.resolvedValue()` / `.rejectedValue()` used in a test file without importing `PromiseResolve.brs` / `PromiseReject.brs` from `@dazn/kopytko-utils` |

### Identifier Rules

| Rule | Default | Description |
|---|---|---|
| `identifier/undefined-function` | error | Function call to unknown name |
| `identifier/wrong-arg-count` | error | Built-in function called with wrong number of arguments |
| `identifier/undefined-variable` | error | Variable used but never assigned in the enclosing scope |
| `identifier/shadows-builtin` | error | Variable name shadows a BrightScript built-in function |
| `identifier/shadows-function` | error | Variable or parameter shadows a user-defined function (local or `@import`-ed) |
| `identifier/unused-parameter` | warning | Function parameter never used in body (prefix `_` to suppress) |
| `identifier/unused-variable` | warning | Local variable defined but never read (prefix `_` to suppress) |

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

### Type Annotation Rules

| Rule | Default | Description |
|---|---|---|
| `type/missing-return-type` | warning | Function missing `as Type` return type annotation |
| `type/missing-param-type` | warning | Function parameter missing `as Type` annotation |

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
  run: npm run lint:brs:check
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

> **Important:** Use `npx kopytko-lint` (or `./node_modules/.bin/kopytko-lint`) rather than `npm run <script>` when redirecting SARIF output. `npm run` prepends a `> package@version scriptname` header line to stdout that corrupts the JSON. If you must use an npm script, pass `--silent` to suppress it: `npm run --silent lint:brs -- --format sarif > results.sarif`.

> The basic example assumes `lint:brs:check` is defined in your `package.json` scripts (see [Recommended npm Scripts](#recommended-npm-scripts) above). The SARIF example uses `npx` since it requires output redirection.

## License

MIT
