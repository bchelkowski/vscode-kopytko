# Contributing to vscode-kopytko

## Prerequisites

- [Node.js](https://nodejs.org/) 24 or later
- [Visual Studio Code](https://code.visualstudio.com/)

## Development

```bash
npm install              # install dependencies
npm run compile          # compile extension + server (tsc — for debug/dev mode)
npm run bundle           # bundle for production (esbuild — used by vsce package)
npm test                 # run all tests (Mocha + tsx, no compilation needed)
npm run lint             # ESLint
```

`compile` outputs individual JS files used by the Extension Development Host (F5 in VS Code). `bundle` produces two self-contained files (`out/extension.js`, `out/server/server.js`) used in the published VSIX.

---

## Testing the Extension in VS Code

These steps run the extension in VS Code's **Extension Development Host** — a separate VS Code window where the extension is live and you can interact with it as a real user would.

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

## Running the Automated Test Suite

```bash
npm test
```

Runs all unit tests with Mocha. No VS Code instance is needed — tests run in Node.js directly.

```bash
npm run test:coverage   # same, with nyc coverage report
```

---

## Project Layout

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
packages/
  kopytko-formatter/         Standalone BrightScript formatter (CLI + library)
  kopytko-linter/            Standalone BrightScript linter (CLI + library)
```

---

## Architecture & Detailed Guidelines

See [CLAUDE.md](CLAUDE.md) for in-depth architecture documentation, testing rules, performance guidelines, commit conventions, and step-by-step guides for adding new features.
