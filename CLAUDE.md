# vscode-kopytko — CLAUDE.md

## Internal knowledge base (`findings/`)

**Reading and writing `findings/` is a required step, not optional — treat it the same as updating `docs/`.**

**BEFORE starting any relevant task — read the applicable file(s) first:**

| File | Required reading when |
|---|---|
| [findings/roku-device-api.md](findings/roku-device-api.md) | Any Roku device communication (ports, commands, response formats) |
| [findings/diagnostics-panel-architecture.md](findings/diagnostics-panel-architecture.md) | Touching `src/client/diagnostics/` or the webview |
| [findings/lsp-architecture.md](findings/lsp-architecture.md) | LSP server providers, formatter rules, built-in/component catalogs |
| [findings/dev-environment.md](findings/dev-environment.md) | Build, test, compile, or F5 debug work |

**AFTER completing any task — update the relevant file if you discovered anything non-obvious:** a constraint, a gotcha, a design decision, a pattern that worked. Keep entries concrete — real examples, file paths, the *why*. Vague notes have no value.

---

## Project overview

VS Code extension for **BrightScript** (Roku) and the **Kopytko Framework** — LSP server (diagnostics, completion, hover, go-to-definition, formatting), built-in debugger, device discovery, and a runtime diagnostics panel.

Four standalone npm packages live in `packages/`: `kopytko-brightscript-parser`, `kopytko-formatter`, `kopytko-linter`, and `kopytko-roku-device`. All four are published to npm and consumed by the extension as versioned dependencies (see `docs/publishing.md`). `kopytko-roku-device` handles all Roku device communication and is deliberately Kopytko-ecosystem-unaware (no CLI spawning, no `.kopytkorc`) so Kopytko packages can depend on it — the Kopytko CLI deployer and `.kopytkorc` reader stay in the extension (`src/client/roku/rokuDeployer.ts`, `src/client/roku/kopytkorc.ts`).

---

## Repository structure

```
packages/brightscript-parser/   Shared parser: lexer, CST, AST, scope analysis, catalogs
packages/formatter/              Standalone formatter: CLI + library, 27 CST passes
packages/linter/                 Standalone linter: rule descriptors, fileAnalysis, project indexer
packages/roku-device/            All Roku device communication: SSDP, ECP, debug console (8080),
                                 debug protocol (8081), diagnostics parsers/collectors, Perfetto
src/extension.ts                 Extension entry; delegates to client/activation/*
src/client/activation/           Wires all services on extension start
src/client/debug/                DAP adapter + session controller (protocol client in packages/roku-device)
src/client/roku/                 VS Code glue: stores (Memento/SecretStorage), network monitor, tree views,
                                 Kopytko CLI deployer + .kopytkorc reader (kept out of packages/roku-device)
src/client/diagnostics/          Runtime diagnostics panel (session, storage, webview; transports in packages/roku-device)
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

`compile` outputs individual JS files for the Extension Development Host. `bundle` produces self-contained files for the published VSIX. See `findings/dev-environment.md` for the full build workflow, WSL setup, and F5 caveats.

For `packages/formatter`, `packages/linter`, `packages/brightscript-parser`, or `packages/roku-device` changes: `cd packages/<name> && npm test`. These packages are consumed by the extension via their published npm versions, not local sources — root compile/test/F5 do not pick up in-progress package edits. To verify a package change against the extension before publishing, use `npm link` or bump the extension's dependency to a locally packed tarball.

---

## Definition of done

1. **Tests pass** — `npm test` exits 0. New behaviour has new tests. No test left broken.
2. **Docs updated** — `docs/features.md` and the relevant topic doc reflect the change.
3. **Site updated** — the corresponding `site/src/pages/` page reflects the change.
4. **Findings updated** — if anything non-obvious was discovered, the relevant `findings/` file is updated.

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
| [docs/roku-webadmin.md](docs/roku-webadmin.md) | Developer web-admin automation (install/rekey/package/screenshot/update/reboot) |
| [docs/device-manager.md](docs/device-manager.md) | Device Manager — remote control, keyboard mode, saved text entries, RASP scripts, abilities hub |
| [docs/roku-pay.md](docs/roku-pay.md) | Roku Pay Web Services tool — cloud API endpoints, credential profiles, request history |
| [packages/formatter/README.md](packages/formatter/README.md) | Formatter CLI, library API, CI integration |
| [packages/roku-device/README.md](packages/roku-device/README.md) | Device communication package — SSDP, ECP, debug console/protocol, collectors, Perfetto |
| [docs/roku-device-cli.md](docs/roku-device-cli.md) | `kopytko-roku` terminal CLI — ECP + web-admin ops, config resolution, exit codes |
| [docs/publishing.md](docs/publishing.md) | npm and VS Code Marketplace publishing |

**Every change that adds, modifies, or removes a feature must update `docs/features.md`, the relevant topic doc, and the corresponding site page.**

**Every task that uncovers non-obvious knowledge must update the relevant `findings/` file.**

---

## GitHub Pages site

Lives in `site/` (Astro 5 + Tailwind v4 + React islands). Run via WSL: `cd site && npm run dev`.

| Change | Update |
|---|---|
| New/changed linter rule | `site/src/pages/linter.astro` — `RuleCard` entry |
| New/changed formatter option | `site/src/pages/formatter.astro` — `OptionCard` + `FormatterPlayground.tsx` JSONC comment if enum |
| New parser export | `site/src/pages/parser.astro` — API reference groups |
| New `roku-device` ECP/collector/CLI feature | `site/src/pages/roku-device.astro` — subsystems table, examples, CLI section |
| New extension feature/command/setting | `site/src/pages/extension.astro` |
| New `TokenKind` or `SyntaxKind` | `tokenKindTable` in `parser.astro` + `brightscript-colors.tsx` + `TokenVisualizer.tsx` |
| New screenshot | Drop `.png` into `site/public/screenshots/` |

Redeploys automatically on push to `main` (when `site/**` or `syntaxes/**` change) and at the end of each release workflow.

**The site must always reflect the true state of the extension and all packages. Treat `site/src/pages/` with the same discipline as `docs/*.md`.**

---

## Commit conventions

No `Co-authored-by:` lines. Use conventional commits.

| Scope | Changelog |
|---|---|
| `feat/fix/refactor(vscode-kopytko):` | Extension CHANGELOG |
| `feat/fix/refactor(formatter):` | Formatter CHANGELOG |
| `feat/fix/refactor(linter):` | Linter CHANGELOG |
| `feat/fix/refactor(brightscript-parser):` | Parser CHANGELOG |
| `feat/fix/refactor(roku-device):` | Roku device CHANGELOG |
| `feat(scope)!:` | Breaking Changes section |
| `chore(scope):` | Maintenance section |
| `test:` / unscoped | Not in any changelog |

---

## Package architecture

Four packages with strict, non-overlapping responsibilities:

| Question | Package |
|---|---|
| "Does this come from reading/analysing a `.brs` file?" | **brightscript-parser** |
| "Does this transform source text to make it prettier?" | **formatter** |
| "Does this check a rule and report a diagnostic?" | **linter** |
| "Does this talk to a Roku device over the network?" | **roku-device** |

**Key check:** before adding a helper to the formatter or linter, ask *"Would another tool ever need this?"* If yes, it belongs in the parser — the single source of truth for all per-file structural facts.

For LSP performance rules and step-by-step how-to guides (new provider, formatter rules, built-in catalogs), see `findings/lsp-architecture.md`.
