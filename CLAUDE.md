# vscode-kopytko — CLAUDE.md

## Internal knowledge base (`findings/`)

Version-controlled working notes — read before acting, write after discovering.

| File | Read when |
|---|---|
| [findings/roku-device-api.md](findings/roku-device-api.md) | Any Roku device communication (ports, commands, response formats) |
| [findings/diagnostics-panel-architecture.md](findings/diagnostics-panel-architecture.md) | Touching `src/client/diagnostics/` or the webview |
| [findings/dev-environment.md](findings/dev-environment.md) | Build, test, compile, or F5 debug work |

Write to the relevant file immediately after finding a non-obvious constraint, gotcha, or pattern worth reusing. Keep entries concrete (real examples, file paths, the *why*).

---

## Project overview

VS Code extension for **BrightScript** (Roku) and the **Kopytko Framework** — LSP server (diagnostics, completion, hover, go-to-definition, formatting), built-in debugger, device discovery, and a runtime diagnostics panel.

Three standalone npm packages live in `packages/`: `kopytko-brightscript-parser`, `kopytko-formatter`, `kopytko-linter`.

---

## Repository structure

```
packages/brightscript-parser/   Shared parser: lexer, CST, AST, scope analysis, catalogs
packages/formatter/              Standalone formatter: CLI + library, 27 CST passes
packages/linter/                 Standalone linter: rule descriptors, fileAnalysis, project indexer
src/extension.ts                 Extension entry; delegates to client/activation/*
src/client/activation/           Wires all services on extension start
src/client/debug/                DAP adapter, session controller, protocol client (port 8081)
src/client/roku/                 Device discovery (SSDP, ECP), credential store, tree views
src/client/diagnostics/          Runtime diagnostics panel (transport, parsers, collectors, webview)
src/server/                      LSP server: 12 providers, document cache, import resolver
test/                            Mocha + Chai + Sinon; mirrors src/server/ structure
docs/                            Feature docs (see Documentation section)
findings/                        Internal session-accumulated knowledge (see above)
site/                            Astro 5 GitHub Pages site (bchelkowski.github.io/vscode-kopytko)
```

---

## Development

```bash
npm install          # install dependencies
npm run compile      # tsc (client + server) + esbuild (webview) — use before F5
npm run bundle       # production esbuild — used by vsce package
npm test             # Mocha + tsx, no compilation needed
npm run lint         # ESLint
```

`compile` outputs individual JS files for the Extension Development Host. `bundle` produces self-contained files for the published VSIX. Run `npm run compile` (or the WSL equivalent) before pressing F5 — see `findings/dev-environment.md` for the full build workflow.

For `packages/formatter` or `packages/linter` changes: `cd packages/<name> && npm test`.

---

## Definition of done

1. **Tests pass** — `npm test` exits 0. New behaviour has new tests. No test left broken.
2. **Documentation updated** — `docs/features.md`, the relevant topic doc, and the site page.

---

## Testing rules

- **Mirror source path**: `src/server/kopytko/importResolver.ts` → `test/kopytko/importResolver.test.ts`
- **Stub the filesystem** via `src/server/utils/fsWrapper.ts` — tests must never touch real disk.
- **Clear the document cache** in `afterEach`: call `invalidateAllCaches()` from `utils/documentCache`.
- **Cover happy path and error cases**. Run `npm test` before every commit.

---

## Documentation

| File | Covers |
|---|---|
| [docs/features.md](docs/features.md) | **Master list** — every implemented and planned feature with status |
| [docs/language-server.md](docs/language-server.md) | LSP architecture, 12 providers, casing config |
| [docs/kopytko-imports.md](docs/kopytko-imports.md) | @import resolution, document links, diagnostics |
| [docs/brightscript-components.md](docs/brightscript-components.md) | ro* catalog, interface methods, maintenance |
| [docs/brightscript-support.md](docs/brightscript-support.md) | Syntax highlighting, snippets, language config |
| [docs/formatting.md](docs/formatting.md) | Formatting rules, all `kopytko.format.*` settings |
| [docs/device-discovery.md](docs/device-discovery.md) | Device discovery, network scoping, password management |
| [docs/roku-debug.md](docs/roku-debug.md) | Debugger, launch config |
| [docs/diagnostics.md](docs/diagnostics.md) | Runtime diagnostics panel — data sources, collectors, NDJSON, settings |
| [packages/formatter/README.md](packages/formatter/README.md) | Formatter CLI, library API, CI integration |
| [docs/publishing.md](docs/publishing.md) | npm and VS Code Marketplace publishing |

**Every change that adds, modifies, or removes a feature must update `docs/features.md`, the relevant topic doc, and the corresponding site page.**

---

## GitHub Pages site

Lives in `site/` (Astro 5 + Tailwind v4 + React islands), deploys to `https://bchelkowski.github.io/vscode-kopytko/`. Run via WSL: `cd site && npm run dev`.

| Change | Update |
|---|---|
| New/changed linter rule | `site/src/pages/linter.astro` — `RuleCard` entry |
| New/changed formatter option | `site/src/pages/formatter.astro` — `OptionCard` entry; also `FormatterPlayground.tsx` JSONC comment if enum |
| New parser export | `site/src/pages/parser.astro` — API reference groups |
| New extension feature/command/setting | `site/src/pages/extension.astro` — relevant section + settings table |
| New `TokenKind` or `SyntaxKind` | `tokenKindTable` in `parser.astro` + `brightscript-colors.tsx` + `TokenVisualizer.tsx` |
| New screenshot | Drop `.png` into `site/public/screenshots/` |

Site redeploys automatically on push to `main` (when `site/**` or `syntaxes/**` change) and at the end of each release workflow. Never deploy manually mid-release.

---

## Performance guidelines (LSP server)

1. **Debounced diagnostics** — use `scheduleValidation()`, not `validateDocument()` (300ms debounce).
2. **Document cache** — `getCachedLines`, `getCachedTypeMap`, `getCachedAllFunctions` from `utils/documentCache.ts`. Never call `text.split()` / `inferTypes()` / `collectAllFunctions()` directly in a provider.
3. **Static data cached** — `getInstalledKopytkoPackages()`, `resolvePackageBaseDir()`, `KopytkoModuleCatalog` are cached; invalidate via `onDidChangeWatchedFiles`.
4. **Workspace function index** — use `WorkspaceFunctionIndex` for Find References / Rename. Never walk the workspace with `collectBrsFiles` in a provider.
5. **Catalog lookups** — `findComponent()`, `findBuiltin()`, `getComponentMethods()` are O(1).
6. **Cache invalidation** — `CacheInvalidationService` handles `onDidChangeWatchedFiles`; document caches auto-invalidate on version change.

---

## Commit conventions

No `Co-authored-by:` lines. Use conventional commits.

| Scope | Changelog |
|---|---|
| `feat/fix/refactor(vscode-kopytko):` | Extension CHANGELOG |
| `feat/fix/refactor(formatter):` | Formatter CHANGELOG |
| `feat/fix/refactor(linter):` | Linter CHANGELOG |
| `feat/fix/refactor(brightscript-parser):` | Parser CHANGELOG |
| `feat(scope)!:` | Breaking Changes section |
| `chore(scope):` | Maintenance section |
| `test:` / unscoped | Not in any changelog |

---

## Package architecture

Three packages have strict, non-overlapping responsibilities:

| Question | Package |
|---|---|
| "Does this come from reading/analysing a `.brs` file?" | **brightscript-parser** |
| "Does this transform source text to make it prettier?" | **formatter** |
| "Does this check a rule and report a diagnostic?" | **linter** |

**Key check:** before adding a helper to the formatter or linter, ask *"Would another tool ever need this?"* If yes, it belongs in the parser. The parser is the single source of truth for all per-file structural facts (scope, references, catalogs).

---

## How-to

**New LSP feature:** create `src/server/providers/<name>Provider.ts` → wire in `server.ts` + `registerHandlers.ts` → use document cache → add tests in `test/providers/` → update `docs/features.md` + `docs/language-server.md`.

**New formatting option:** add field to `FormattingConfig` in `packages/formatter/src/config.ts` → wire in `formatter.ts` → add VS Code setting in root `package.json` → update `docs/formatting.md`.

**New formatting rule:** edit `packages/formatter/src/formatter.ts` or add a CST pass in `packages/formatter/src/cst-passes/` and export it from `cst-passes/index.ts`.

**Expand BrightScript built-ins:** edit `packages/brightscript-parser/src/catalog/builtins.ts`. Each entry: `name`, `signature`, `returnType`, `description`, `category`. Add test assertions.

**Maintain component catalog:** edit `packages/brightscript-parser/src/catalog/components.ts`. Set `since`, `deprecated`. Update `CATALOG_LAST_VERIFIED` only after verifying against live Roku docs. Update `docs/brightscript-components.md`.

**Expand Kopytko module catalog:** `src/server/kopytko/moduleCatalog.ts` scans installed packages at runtime. Tests in `test/kopytko/moduleCatalog.test.ts`.
