# vscode-kopytko — CLAUDE.md

## Where to look

| Question | Source |
|---|---|
| **Where does X live?** | [MAP.md](MAP.md) — generated repo map: directories, entry points, package exports, commands. Regenerate with `npm run map`; never edit by hand. |
| **How does X behave, and what has already gone wrong in it?** | `findings/` — see the routing table in [findings/README.md](findings/README.md). |
| **What does X do for a user?** | `docs/` and `site/` |

**`docs/` and `site/` are human-facing product documentation.** Update them when behaviour changes,
but **do not read them to answer a question about the code** — `MAP.md` and `findings/` are faster
and are what the code actually does.

## Internal knowledge base (`findings/`)

**Reading and writing `findings/` is a required step, not optional — treat it the same as updating `docs/`.**

**BEFORE starting any relevant task — read the applicable file first:**

| File | Required reading when |
|---|---|
| [findings/roku-device-api.md](findings/roku-device-api.md) | Any Roku device communication (ports, commands, response formats) |
| [findings/diagnostics-panel-architecture.md](findings/diagnostics-panel-architecture.md) | `src/client/diagnostics/`, or **any webview** — toolbars, uPlot, xterm, sidebar vs panel |
| [findings/network-inspector.md](findings/network-inspector.md) | `src/client/network/` — proxy, transparent redirect, rewrite rules |
| [findings/lsp-architecture.md](findings/lsp-architecture.md) | LSP server providers, formatter rules, built-in/component catalogs |
| [findings/dev-environment.md](findings/dev-environment.md) | Build, test, compile, or F5 debug work |
| [findings/device-manager-architecture.md](findings/device-manager-architecture.md) | `src/client/deviceManager/` — remote, RASP, abilities |

Each file opens with a **⛔ Never do this** section. Read it — those rules were paid for.

**AFTER completing any task — update the relevant file if you discovered anything non-obvious:** a constraint, a gotcha, a design decision, a pattern that worked. Keep entries concrete — real examples, file paths, the *why*. Vague notes have no value. **Update the reference file in place; do not append a dated entry.** [findings/README.md](findings/README.md) has the full writing rules; `findings/archive/` holds the old session journals and is not read by default.

---

## Project overview

VS Code extension for **BrightScript** (Roku) and the **Kopytko Framework** — LSP server, built-in
debugger, device discovery, and a set of runtime tools (diagnostics, console, network inspector,
device manager, Perfetto).

Four npm packages in `packages/` — `kopytko-brightscript-parser`, `kopytko-formatter`,
`kopytko-linter`, `kopytko-roku-device` — are published and consumed by the extension **as versioned
dependencies, not local sources** (see `docs/publishing.md`).

`kopytko-roku-device` is deliberately **Kopytko-ecosystem-unaware** (no CLI spawning, no
`.kopytkorc`) so Kopytko packages can depend on it. The CLI deployer and `.kopytkorc` reader
therefore stay in the extension (`src/client/roku/`).

---

## Repository structure

See [MAP.md](MAP.md) — every source directory with its purpose, generated from the tree so it
cannot drift. `test/` mirrors `src/server/`; `docs/` and `site/` are user-facing; `findings/` is
the internal knowledge base.

Adding a new source directory? Add its one-line purpose to `scripts/map-areas.json` — `npm run
lint` and CI fail on an undescribed directory.

---

## Development

```bash
npm install          # install dependencies
npm run compile      # tsc (client + server) + esbuild (webview) — use before F5
npm run bundle       # production esbuild — used by vsce package
npm test             # Mocha + tsx, no compilation needed
npm run lint         # generated-file check + ESLint
npm run map          # regenerate MAP.md + docs/reference + README settings block
```

Node/npm live **only inside WSL** on this machine — see `findings/dev-environment.md` for the
invocation, and for why `$?` after a `wsl.exe` call cannot be trusted.

`compile` outputs individual JS files for the Extension Development Host. `bundle` produces self-contained files for the published VSIX. See `findings/dev-environment.md` for the full build workflow, WSL setup, and F5 caveats.

For `packages/formatter`, `packages/linter`, `packages/brightscript-parser`, or `packages/roku-device` changes: `cd packages/<name> && npm test`. These packages are consumed by the extension via their published npm versions, not local sources — root compile/test/F5 do not pick up in-progress package edits. To verify a package change against the extension before publishing, use `npm link` or bump the extension's dependency to a locally packed tarball.

---

## Definition of done

1. **Tests pass** — `npm test` exits 0. New behaviour has new tests. No test left broken.
2. **Lint passes** — `npm run lint` exits 0. This also fails on a stale `MAP.md` or an undescribed source directory.
3. **Docs updated** — `docs/features.md` and the relevant topic doc reflect the change.
4. **Site updated** — the corresponding `site/src/pages/` page reflects the change.
5. **Findings updated** — if anything non-obvious was discovered, the relevant `findings/` file is updated **in place**.

Never hand-edit a generated file: `MAP.md`, `docs/reference/commands-and-settings.md`, or the
README block between `<!-- settings:start -->` / `<!-- settings:end -->`. Change the source
(`package.json`, `scripts/map-areas.json`) and run `npm run map`.

---

## Testing rules

- **Mirror source path**: `src/server/kopytko/importResolver.ts` → `test/kopytko/importResolver.test.ts`
- **Stub the filesystem** via `src/server/utils/fsWrapper.ts` — tests must never touch real disk.
- **Clear the document cache** in `afterEach`: call `invalidateAllCaches()` from `utils/documentCache`.
- **Cover happy path and error cases**. Run `npm test` before every commit.

---

## Documentation

**[docs/features.md](docs/features.md) is the master list** — every implemented and planned feature
with status. A feature is not done until it appears there.

Topic docs in `docs/`, named after their subject: `language-server`, `kopytko-imports`,
`brightscript-components`, `brightscript-support`, `formatting`, `device-discovery`, `roku-debug`,
`diagnostics`, `roku-console`, `roku-webadmin`, `device-manager`, `roku-pay`, `network-inspector`,
`roku-device-cli`, `publishing`. Package APIs are documented in `packages/*/README.md`.
`docs/reference/commands-and-settings.md` is **generated** — do not edit it.

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
