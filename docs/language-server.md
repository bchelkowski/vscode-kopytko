# Language Server

The extension bundles a dedicated Language Server Process (LSP) built with [`vscode-languageserver`](https://www.npmjs.com/package/vscode-languageserver). It communicates with the extension host over IPC.

## Architecture

```
VS Code Extension Host
  └── KopytkoLanguageClient (src/client/languageClient.ts)
        │  IPC
        └── Language Server Process (src/server/server.ts)
              ├── BrightScriptDiagnosticsProvider
              ├── BrightScriptCompletionProvider
              ├── BrightScriptHoverProvider
              ├── BrightScriptDefinitionProvider
              ├── KopytkoImportResolver
              └── (brightscript/builtins, kopytko/modules)
```

## Capabilities

### Hover (`textDocument/hover`)

Returns Markdown documentation when the cursor is over:

- **BrightScript built-in functions** — signature, category badge, description sourced from `src/server/brightscript/builtins.ts`
- **Kopytko module exports** — function name, module name, NPM package, signature, description sourced from `src/server/kopytko/modules.ts`

### Completion (`textDocument/completion`)

Three completion contexts:

1. **Kopytko annotation context** — when the line matches `' @…`, offers `@import` and `@import ... from` completions as snippets
2. **Module name context** — after `' @import <path> from `, offers known Kopytko NPM package names
3. **Default context** — offers all BrightScript built-in functions + language keywords

### Go-to-definition (`textDocument/definition`)

When the cursor is on a `' @import` line, resolves the path and returns a `Location` pointing to line 0 of the imported file. Falls through to `null` if unresolved.

### Diagnostics (`textDocument/publishDiagnostics`)

Diagnostics are computed on every document open and on every change. See [kopytko-imports.md](./kopytko-imports.md#diagnostic-codes) for the full list of diagnostic codes.

## Configuration passed to the server

The client passes the following `initializationOptions` to the server on startup:

| Option | Source |
|---|---|
| `workspaceFolders` | All open workspace folders |
| `sourceDir` | `kopytko.imports.sourceDir` setting |
| `resolveModules` | `kopytko.imports.resolveModules` setting |
| `trace` | `kopytko.languageServer.trace` setting |

## Debugging the Language Server

Set `kopytko.languageServer.trace` to `"verbose"` in settings to log all LSP messages to the **Kopytko BrightScript (Trace)** output channel.

For Node.js debugging, the server is launched with `--inspect=6009` in debug mode. Attach VS Code's debugger to port 6009 using:

```json
// .vscode/launch.json
{
  "type": "node",
  "request": "attach",
  "name": "Attach to Language Server",
  "port": 6009,
  "restart": true,
  "outFiles": ["${workspaceFolder}/out/server/**/*.js"]
}
```

## Adding New Providers

1. Create the provider class in `src/server/providers/`.
2. Wire it up in `src/server/server.ts` (instantiate, register the appropriate `connection.on*` handler).
3. Add unit tests in `test/providers/`.
4. Document the new capability in this file and in `docs/features.md`.
