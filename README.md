# vscode-kopytko

A Visual Studio Code extension providing first-class language support for **BrightScript** (Roku's scripting language) and the **Kopytko Framework** ecosystem.

## Features

- Syntax highlighting and language configuration for `.brs` files
- IntelliSense completions for 60 `ro*` components, 78 interfaces, and ~700 methods
- Hover documentation for components, methods, built-in functions, and Kopytko exports
- `CreateObject` type inference — member completions appear automatically after `.`
- Diagnostics and go-to-definition for `@import` annotations
- Kopytko module catalog with package name completions
- **Roku device discovery** — scans the local network and shows available devices in the **Kopytko** sidebar
- **BrightScript debugger** — deploy, set breakpoints, inspect variables, step through code on a real Roku device

See [docs/features.md](docs/features.md) for the full feature list.

---

## Testing the extension in VS Code

These steps run the extension in VS Code's **Extension Development Host** — a separate VS Code window where the extension is live and you can interact with it as a real user would.

### Prerequisites

- [Node.js](https://nodejs.org/) 24 or later
- [Visual Studio Code](https://code.visualstudio.com/)

### 1. Install dependencies and compile

```bash
npm install
npm run compile
```

### 2. Open the project in VS Code

```bash
code .
```

### 3. Launch the Extension Development Host

Press **F5** (or go to **Run → Start Debugging**).

VS Code will open a second window titled **[Extension Development Host]**. The extension is now active in that window.

### 4. Open or create a BrightScript file

In the Extension Development Host window, open any `.brs` file or create one:

```brightscript
sub init()
    transfer = CreateObject("roUrlTransfer")
    transfer.
end sub
```

### 5. Exercise the features

| What to test | How |
|---|---|
| **Member completions** | Type `transfer.` — a method list should appear |
| **Hover on a component** | Hover over `roUrlTransfer` — docs card should appear |
| **Hover on a method** | Hover over `SetUrl` — signature and interface link should appear |
| **Built-in completions** | Start typing `Abs` or `Left` in a plain context |
| **Keyword completions** | Start typing `for` or `function` |
| **@import diagnostics** | Add `' @import /missing.brs` — a warning underline should appear |
| **@import go-to-definition** | Ctrl+click a valid `@import` path to jump to the file |
| **@import completions** | Type `' @import ` — snippet completions appear; add `from ` for module names |

### Reloading after a code change

After editing source files, run `npm run compile` again, then in the Extension Development Host window press **Ctrl+Shift+P** and choose **Developer: Reload Window** (or simply close and re-launch with F5).

For a faster loop, open two terminals and run the watchers in parallel:

```bash
npm run watch          # watches extension (client)
npm run watch:server   # watches language server
```

Changes are picked up automatically; reload the Host window to apply them.

---

## Running the automated test suite

```bash
npm test
```

Runs all unit tests with Mocha. No VS Code instance is needed — tests run in Node.js directly.

```bash
npm run test:coverage   # same, with nyc coverage report
```

---

## Project layout

```
src/
  extension.ts               Extension entry point
  client/
    languageClient.ts        LSP client
    debug/                   Debug adapter and protocol handling
    roku/                    Device discovery, SSDP, ECP, persistence, views
  server/
    server.ts                Language server entry point
    brightscript/            Component catalog, built-ins, type inference
    kopytko/                 @import resolver, module catalog
    providers/               Completion, hover, diagnostics, definition
test/                        Mocha unit tests (mirrors src/server/)
docs/                        Feature and reference documentation
syntaxes/                    TextMate grammar
snippets/                    VS Code snippets
```

---

---

## Roku device discovery

The **Roku Devices** panel in the **Kopytko** sidebar scans your local network using SSDP and lists all discovered Roku devices with their model, IP, and firmware version.

1. Expand **Roku Devices** in the **Kopytko** sidebar.
2. Click **↺** in the panel title to scan.
3. Right-click a device → **Set as Active Device** to make it the default deploy target.

The active device's IP is automatically injected into your `launch.json` when you start a debug session.

---

## Debugging on a Roku device

### Prerequisites

Enable **developer mode** on the Roku: on the remote press Home × 3, Up, Right, Left, Right, Left, Right. Note the device IP and set a developer password.

### `launch.json` configuration

```json
{
  "version": "0.2.0",
  "configurations": [
    {
      "type": "kopytko",
      "request": "launch",
      "name": "Run on Roku",
      "host": "192.168.1.100",
      "password": "rokudev",
      "rootDir": "${workspaceFolder}",
      "env": "dev"
    }
  ]
}
```

Press **F5** to start. The extension will:

1. Build the project using `@dazn/kopytko-packager` (reads `.kopytkorc`, runs plugins, generates manifest)
2. Inject `stop` statements at your breakpoints
3. Deploy to the Roku via kopytko-packager's AppDeployer
4. Connect to the BrightScript debug protocol on port 8081

### What you can do once paused

| Capability | How |
|---|---|
| Inspect variables | Variables panel — **Local** and **Global** scopes |
| View call stack | Call Stack panel — click any frame to switch context |
| Step over | F10 |
| Step into | F11 |
| Step out | Shift+F11 |
| Continue | F5 |
| Evaluate expression | Hover over a variable, or use the Debug Console |
| See `print` output | Debug Console — stdout forwarded in real time |
| See compilation errors | Debug Console — session terminates on compile failure |

See [docs/roku-debug.md](docs/roku-debug.md) for full details and architecture notes.

---

## Further reading

- [Feature overview](docs/features.md)
- [Roku device management and debugging](docs/roku-debug.md)
- [BrightScript component catalog](docs/brightscript-components.md)
- [Kopytko @import annotations](docs/kopytko-imports.md)
- [Language server architecture](docs/language-server.md)

---

## Formatting Settings Reference

The formatter is configured in `.vscode/settings.json` (workspace) or VS Code's user settings. Formatting settings use the `kopytko.format.` prefix; casing settings use `kopytko.casing.`.

See [docs/formatting.md](docs/formatting.md) for the complete reference with before/after examples.

### Indentation & Whitespace

| Setting | Type | Default | Description |
|---|---|---|---|
| `indentSize` | `number` | `4` | Spaces per indent level |
| `useTabs` | `boolean` | `false` | Use tabs instead of spaces |
| `lineEnding` | `string` | `"auto"` | Line ending: `lf`, `crlf`, `auto` |
| `trimTrailingWhitespace` | `boolean` | `true` | Strip trailing spaces |
| `insertFinalNewline` | `boolean` | `true` | Ensure newline at EOF |
| `maxEmptyLines` | `number` | `2` | Max consecutive blank lines (0 = no limit) |
| `emptyLinesBetweenFunctions` | `number` | `1` | Blank lines between function/sub declarations |
| `emptyLinesBetweenMethods` | `number` | `1` | Blank lines between AA method definitions |
| `emptyLinesAtBlockBoundaries` | `string` | `"preserve"` | `strip`, `enforce`, `preserve` |

### Compound Keywords

| Setting | Type | Default | Description |
|---|---|---|---|
| `endKeywordStyle` | `string` | `"preserve"` | `spaced` (end if), `compact` (endif), `preserve` |
| `thenStyle` | `string` | `"preserve"` | `always`, `never`, `multiline-only`, `singleline-only`, `preserve` |

### Functions & Subs

| Setting | Type | Default | Description |
|---|---|---|---|
| `functionVsSubForVoid` | `string` | `"preserve"` | `function`, `sub`, `allow-void`, `preserve` |
| `spaceBeforeNamedFunctionParens` | `boolean` | `false` | Space before `(` in named definitions |
| `spaceBeforeAnonymousFunctionParens` | `boolean` | `false` | Space before `(` in anonymous functions |
| `spaceBeforeCallParens` | `boolean` | `false` | Space before `(` in calls |
| `spaceInsideParens` | `string` | `"never"` | `never`, `always` |
| `paramAlignmentStyle` | `string` | `"preserve"` | `preserve`, `indent`, `align-to-paren` |

### Strings

| Setting | Type | Default | Description |
|---|---|---|---|
| `wrapLongStrings` | `string` | `"preserve"` | `preserve`, `plus`, `array-join` |
| `stringConcatStyle` | `string` | `"preserve"` | `preserve`, `plus`, `array-join` |

### Arrays & Associative Arrays

| Setting | Type | Default | Description |
|---|---|---|---|
| `associativeArrayBracketSpacing` | `boolean` | `true` | Spaces inside `{ }` |
| `associativeArrayCommaSpacing` | `string` | `"preserve"` | Spaces around commas in inline `{}` AAs: `preserve`, `after`, `before`, `both`, `none` |
| `trailingComma` | `string` | `"never"` | `never`, `always`, `multiline` |
| `arrayCommaStyle` | `string` | `"preserve"` | Multi-line array commas: `always`, `never`, `preserve` |
| `associativeArrayCommaStyle` | `string` | `"preserve"` | Multi-line AA commas: `always`, `never`, `preserve` |
| `associativeArraySingleLineThreshold` | `number` | `0` | Max keys before forcing multi-line (0 = no limit) |
| `arraySplitOpenBracket` | `boolean` | `false` | Split `[{` onto separate lines in multi-item arrays |

### Operators & Expressions

| Setting | Type | Default | Description |
|---|---|---|---|
| `spaceAroundOperators` | `boolean` | `true` | Spaces around `+`, `-`, `*`, `/`, `<>`, etc. (preserves `+=`, `-=`) |
| `spaceAroundAssignment` | `boolean` | `true` | Spaces around `=` in assignments (not `+=`, `-=`) |
| `unarySpacing` | `boolean` | `true` | Space after `not` |

### Comments

| Setting | Type | Default | Description |
|---|---|---|---|
| `commentStyle` | `string` | `"preserve"` | `'`, `rem`, `preserve` |
| `spaceAfterCommentMarker` | `boolean` | `true` | `' comment` vs `'comment` |
| `commentWidth` | `number` | `0` | Max comment line length (0 = no limit) |

### Imports

| Setting | Type | Default | Description |
|---|---|---|---|
| `sortImports` | `boolean` | `false` | Sort `@import` and `@mock` lines alphabetically (mocks placed after imports) |
| `emptyLineAfterImports` | `boolean` | `false` | Blank line after last `@import`/`@mock` annotation |

### Blank Lines

| Setting | Type | Default | Description |
|---|---|---|---|
| `emptyLineAfterFunctionOpen` | `boolean` | `false` | Blank line after function/sub opening |
| `emptyLineBeforeFunctionClose` | `boolean` | `false` | Blank line before end function/sub |
| `emptyLineBeforeReturn` | `string\|boolean` | `false` | `"always"`, `"not-alone"`, `false` |
| `emptyLineBeforeComment` | `boolean` | `false` | Blank line before comment blocks |

### Control Flow

| Setting | Type | Default | Description |
|---|---|---|---|
| `parenthesisIfCase` | `string` | `"preserve"` | `preserve`, `always`, `never` |
| `elseOnNewLine` | `boolean` | `true` | else on its own line |
| `forLoopSpacing` | `boolean` | `true` | Spaces around `to` and `step` |

### BrightScript Patterns

| Setting | Type | Default | Description |
|---|---|---|---|
| `observeFieldStyle` | `string` | `"preserve"` | `always-scoped`, `warn`, `preserve` |
| `mPrefixStyle` | `string` | `"preserve"` | `dot`, `bracket`, `preserve` |
| `alignAssignments` | `boolean` | `false` | Align `=` in consecutive assignments |
| `fieldAccessConsistency` | `string` | `"preserve"` | `dot`, `method`, `preserve` |

### Casing (`kopytko.casing.*`)

| Setting | Type | Default | Description |
|---|---|---|---|
| `builtin` | `string` | `"preserve"` | Casing for built-in functions |
| `keyword` | `string` | `"preserve"` | Casing for keywords (fallback for sub-categories) |
| `type` | `string` | — | Casing for type names; falls back to `keyword` |
| `literal` | `string` | — | Casing for `true`, `false`, `invalid`; falls back to `keyword` |
| `logicOperator` | `string` | — | Casing for `and`, `or`, `not`; falls back to `keyword` |
| `mathOperator` | `string` | — | Casing for `mod`; falls back to `keyword` |
| `method` | `string` | `"preserve"` | Casing for component method names |
| `userFunction` | `string` | `"preserve"` | Casing for user-defined functions |
| `userMethod` | `string` | `"preserve"` | Casing for user-defined AA methods |
| `exact` | `object` | `{}` | Per-identifier casing overrides |

Casing values: `preserve`, `upper-case`, `lower-case`, `capitalize`, `pascal-case`, `camel-case`.

### Miscellaneous

| Setting | Type | Default | Description |
|---|---|---|---|
| `printStatement` | `string` | `"preserve"` | `warn`, `remove`, `preserve` |
| `lineCommentPosition` | `string` | `"preserve"` | `above`, `inline`, `preserve` |

---

## Releasing

Both packages are released via **GitHub Actions** workflows (Actions tab → Run workflow → pick `patch`/`minor`/`major`).

### Release kopytko-formatter (npm)

1. Go to **Actions** → **Release kopytko-formatter** → **Run workflow**
2. Select `patch`, `minor`, or `major`
3. The workflow runs tests, bumps the version, updates the changelog, tags `kopytko-formatter-v{x.y.z}`, publishes to npm (OIDC provenance), and creates a GitHub Release

### Release kopytko-linter (npm)

1. Go to **Actions** → **Release kopytko-linter** → **Run workflow**
2. Select `patch`, `minor`, or `major`
3. The workflow runs tests, bumps the version, updates the changelog, tags `kopytko-linter-v{x.y.z}`, publishes to npm (OIDC provenance), and creates a GitHub Release

### Release vscode-kopytko (VS Code Marketplace)

1. Go to **Actions** → **Release vscode-kopytko** → **Run workflow**
2. Select `patch`, `minor`, or `major`
3. The workflow compiles, tests, bumps the version, updates the changelog, tags `v{x.y.z}`, publishes to the Marketplace, and creates a GitHub Release with the `.vsix` attached

### Release order

When the formatter changes affect the extension:

1. Release `kopytko-formatter` first
2. Update the extension's `kopytko-formatter` dependency version
3. Release `vscode-kopytko`

### Required secrets

| Secret | Purpose |
|---|---|
| `VSCE_PAT` | Azure DevOps PAT with Marketplace (Manage) scope |

npm uses OIDC provenance — no token needed. See [docs/publishing.md](docs/publishing.md) for full setup.
