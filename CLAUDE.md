# vscode-kopytko — CLAUDE.md

## Project overview

A VS Code extension providing language support for **BrightScript** (Roku) and the **Kopytko Framework**. Includes an LSP server with diagnostics, completion, hover, go-to-definition, formatting, and a built-in debugger.

Kopytko ecosystem repos:
- **Kopytko Framework**: https://github.com/getndazn/kopytko-framework
- **Kopytko Packager**: https://github.com/getndazn/kopytko-packager
- **Kopytko Unit Testing Framework**: https://github.com/getndazn/kopytko-unit-testing-framework
- **Kopytko Utils**: https://github.com/getndazn/kopytko-utils
- **BrightScript reference**: https://developer.roku.com/docs/references/brightscript/language/brightscript-language-reference.md

---

## Repository structure

```
packages/
├── brightscript-parser/              Shared BrightScript parser (lexer + CST + AST + scope)
│   ├── src/
│   │   ├── index.ts                Public API
│   │   ├── tokenKind.ts            Token type enum (~80 kinds)
│   │   ├── token.ts                Token interface + round-trip utilities
│   │   ├── trivia.ts               Whitespace/comment trivia types
│   │   ├── lexer.ts                Hand-written character scanner
│   │   ├── syntaxKind.ts           CST node type enum (~50 kinds)
│   │   ├── syntaxNode.ts           Lossless CST node class
│   │   ├── parser.ts               Recursive descent parser → CST (grouped statement dispatch)
│   │   ├── ast.ts                  Typed AST wrappers (40+ node types)
│   │   ├── visitor.ts              AstVisitor + walk() + findAll()
│   │   ├── scope.ts                Scope analysis (buildScopes, resolve); Reference.isWrite distinguishes pure writes from reads
│   │   └── diagnostics.ts          Parse error types
│   ├── test/                       437 tests (lexer, parser, AST, scope)
│   └── docs/
│       └── syntax-reference.md     BrightScript syntax catalog (valid/invalid)
├── formatter/                      Standalone BrightScript formatter (CLI + library)
│   ├── src/
│   │   ├── index.ts                Public API (formatText, checkFormatting)
│   │   ├── formatter.ts            Hybrid engine (batched CST passes + inline text passes)
│   │   ├── cst-passes/             27 structure-aware pass files + infrastructure
│   │   │   ├── index.ts            Export list for all CST passes
│   │   │   ├── infrastructure.ts   TextEdit, applyEdits, runCstPasses, walkTokens
│   │   │   └── ...                 casing, spacing, indentation, imports, comments, wrapping
│   │   ├── config.ts               FormattingConfig interface + defaults
│   │   ├── casing.ts               CasingConfig + transforms
│   │   ├── builtins.ts             BrightScript built-in function catalog
│   │   └── types.ts                FunctionDefinition interface
│   ├── bin/kopytko-format.ts        CLI entry point
│   └── test/                        227 tests (formatting + CST passes)
├── linter/                         Standalone BrightScript linter (CLI + library)
│   ├── src/
│   │   ├── linter.ts               Public API (lintProject; re-exports lintFile helpers)
│   │   ├── lintRunner.ts           Per-file dispatch + shared file analysis
│   │   ├── projectIndexer.ts       Project/package scanning and discovery
│   │   ├── analysis/
│   │   │   ├── fileAnalysis.ts     Single AST walk: scopes/nodes shared by all rules
│   │   │   └── ...                 Import, function, XML, sibling, test utilities
│   │   ├── rules/
│   │   │   ├── ast/                One descriptor module per AST rule
│   │   │   │   ├── index.ts        Self-describing AST rule registry
│   │   │   │   └── legacyRules.ts  Shared implementations re-exported by descriptors
│   │   │   ├── syntaxRules.ts      Trailing comma check (pre-parse)
│   │   │   └── index.ts            Rule registry composition
│   └── test/                        427 tests
src/
├── extension.ts                    Extension entry point; delegates activation wiring to client/activation
├── client/                         VS Code client (activation, debug adapter, device discovery, tree views)
│   ├── activation/                 language server, discovery, command, registry, debug registration
│   ├── debug/
│   │   ├── brightScriptDebugAdapter.ts  DAP request adapter
│   │   ├── sessionController.ts    Deploy/connect/session lifecycle
│   │   ├── protocolEventMapper.ts  Roku protocol update → DAP mapping
│   │   └── services/               Breakpoints, variables, path mapping
│   └── roku/
│       └── net/httpClient.ts       Shared HTTP + digest-auth helpers
└── server/
    ├── server.ts                   LSP bootstrap, provider construction, capabilities
    ├── registerHandlers.ts         All connection.on* handler registration
    ├── services/
    │   └── cacheInvalidation.ts    Watched-file/config invalidation and revalidation
    ├── providers/                  12 LSP providers (one per capability)
    │   ├── completionProvider.ts   Coordinator for completion helper modules
    │   ├── completion/             Context detection, builders, imports, members, tests
    │   ├── shared/symbolResolver.ts  Shared hover/signature/definition/rename resolver
    │   └── formattingProvider.ts   Thin LSP adapter → calls kopytko-formatter
    ├── brightscript/               Extension-specific BrightScript helpers
    │   ├── sgNodes.ts              86 SceneGraph nodes
    │   ├── functionIndex.ts        Function/sub parser + multi-scope collector
    │   ├── typeInference.ts        CreateObject / typed-param type resolver
    │   ├── casingUtils.ts          Parser casing API re-exports + VS Code snippet casing
    │   └── ...                     formattingConfig, mtopResolver, patternSiblings, xmlScriptParser
    ├── kopytko/
    │   ├── importResolver.ts       @import parser and resolver (with package cache)
    │   ├── moduleCatalog.ts        Dynamic Kopytko module export scanner
    │   └── testFramework.ts        Test framework API catalog
    └── utils/
        ├── brsFileCollector.ts     File walker
        ├── documentCache.ts        Per-document cache + getCachedParseResult()
        ├── fileParseCache.ts       Cross-document file text/parse/function cache
        ├── workspaceFunctionIndex.ts  Built at startup, updated incrementally
        ├── workspaceCallIndex.ts   Workspace-wide called-name index
        ├── workspaceUtils.ts       Search-root builder
        ├── fsWrapper.ts            Thin fs wrapper (enables Sinon stubbing in tests)
        └── textUtils.ts            Shared helpers (getWord, escapeRegex, stripStringLiterals)
test/                               Mirrors src/server/ structure; Mocha + Chai + Sinon
docs/                               Feature docs (see Documentation section below)
```

---

## Development

```bash
npm install              # install dependencies
npm run compile          # compile extension + server (tsc — for debug/dev mode)
npm run bundle           # bundle for production (esbuild — used by vsce package)
npm test                 # run all tests (Mocha + tsx, no compilation needed)
npm run lint             # ESLint
```

`compile` outputs individual JS files used by the Extension Development Host (F5 in VS Code). `bundle` produces two self-contained files (`out/extension.js`, `out/server/server.js`) used in the published VSIX. `vscode:prepublish` calls `bundle` automatically when running `vsce package` or `vsce publish`.

### kopytko-formatter package

The formatting engine lives in `packages/formatter/` — a standalone npm package usable as a CLI tool and library, independent of VS Code.

```bash
cd packages/formatter
npm install              # install package dependencies
npm test                 # run 140+ formatter tests
npm run build            # compile to dist/
```

**CLI usage (recommended via npm scripts):**

```bash
kopytko-format --check "src/**/*.brs"   # CI — exit 1 if unformatted
kopytko-format --write "src/**/*.brs"   # fix files in place
```

When consuming the package, add npm scripts to your `package.json` instead of using `npx`:

```json
{
  "scripts": {
    "format": "kopytko-format --write \"src/**/*.brs\"",
    "format:check": "kopytko-format --check \"src/**/*.brs\""
  }
}
```

Config resolution (priority order): `--config <file>` → `kopytko-formatter.json` → `.vscode/settings.json` (`kopytko.format.*` and `kopytko.casing.*` keys).

### Windows + WSL

No extra steps needed. `kopytko-formatter` is installed from npm as a regular package (no symlink).

---

## Definition of done

A change is complete when:

1. **Tests pass** — `npm test` exits 0. New behaviour has new tests. No test left broken.
2. **Documentation updated** — affected doc files are current (see below).

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
| [docs/language-server.md](docs/language-server.md) | LSP architecture, all 12 providers, casing config, formatting |
| [docs/kopytko-imports.md](docs/kopytko-imports.md) | @import resolution, document links, diagnostics, sibling patterns |
| [docs/brightscript-components.md](docs/brightscript-components.md) | ro* component catalog, interface methods, maintenance guide |
| [docs/brightscript-support.md](docs/brightscript-support.md) | Syntax highlighting, snippets, language config |
| [docs/formatting.md](docs/formatting.md) | Document formatting rules, all `kopytko.format.*` settings |
| [docs/device-discovery.md](docs/device-discovery.md) | Device discovery architecture, commands, network scoping, password management |
| [docs/roku-debug.md](docs/roku-debug.md) | Device discovery, debugger, launch config |
| [packages/formatter/README.md](packages/formatter/README.md) | Standalone formatter: CLI usage, library API, CI integration |
| [docs/publishing.md](docs/publishing.md) | Step-by-step npm and VS Code Marketplace publishing guide |
| [site/src/pages/](site/src/pages/) | **GitHub Pages** — public-facing feature docs and API reference for the extension and all packages |

**Every change that adds, modifies, or removes a feature must update `docs/features.md`, the relevant topic doc, and the corresponding site page.**

---

## GitHub Pages site

The public documentation site lives in `site/` and deploys to `https://bchelkowski.github.io/vscode-kopytko/`. It must always reflect the true state of the extension and all packages. Treat `site/src/pages/` with the same discipline as `docs/*.md`.

### Stack

- **Astro 5** — static site generation
- **Tailwind CSS v4** via `@tailwindcss/vite` (CSS-first config, no `tailwind.config.mjs` needed)
- **React islands** — `client:load` components for the three interactive playgrounds
- **Shiki** — syntax highlighting for BrightScript code blocks (registered from `syntaxes/brightscript.tmLanguage.json` via the `@brs-grammar` Vite alias; language name is `'BrightScript'` with capital letters)
- **`kopytko-brightscript-parser`**, **`kopytko-formatter`**, **`kopytko-linter`** — all resolved from local TypeScript source via Vite aliases so the site is always in sync with the current codebase without waiting for an npm publish

### Vite aliases (in `site/astro.config.mjs`)

| Alias | Resolves to |
|---|---|
| `@brs-grammar` | `syntaxes/brightscript.tmLanguage.json` |
| `kopytko-brightscript-parser` | `packages/brightscript-parser/src/index.ts` |
| `kopytko-formatter` | `packages/formatter/src/index.ts` |
| `kopytko-linter` | `site/src/stubs/linter-browser.ts` (re-exports `lintFile`, `DEFAULT_RULE_CONFIG`) |
| `fs` / `node:fs` | `site/src/stubs/fs.ts` (empty stubs — linter only uses fs for CLI file scanning) |
| `path` / `node:path` | `site/src/stubs/path.ts` (browser-compatible path utilities) |

### Site structure

```
site/
├── src/
│   ├── pages/
│   │   ├── index.astro          Home — hero, ecosystem cards, stats
│   │   ├── extension.astro      VS Code extension features, commands, settings
│   │   ├── parser.astro         Parser API, live token visualizer
│   │   ├── linter.astro         All rules with code examples, live linter playground
│   │   └── formatter.astro      All options with before/after, live formatter playground
│   ├── components/
│   │   ├── Layout.astro         Nav + footer
│   │   ├── CodePanel.astro      Shiki-highlighted static code block
│   │   ├── BeforeAfter.astro    Side-by-side before/after diff
│   │   ├── RuleCard.astro       Linter rule with severity badge + examples
│   │   ├── OptionCard.astro     Formatter option with before/after
│   │   ├── Screenshot.astro     Screenshot with placeholder when file absent
│   │   ├── SyntaxInput.tsx      Editable textarea with live BrightScript syntax highlighting (overlay technique)
│   │   ├── TokenVisualizer.tsx  React island — live tokenizer (source view + token list)
│   │   ├── LinterPlayground.tsx React island — live linter using real lintFile()
│   │   └── FormatterPlayground.tsx  React island — live formatter with JSONC config editor
│   ├── utils/
│   │   ├── highlight.ts         Shiki highlighter singleton (used by static code blocks)
│   │   └── brightscript-colors.tsx  Shared token coloring for React islands
│   └── stubs/
│       ├── fs.ts                Empty browser fs stub
│       ├── path.ts              Browser-compatible path implementation
│       └── linter-browser.ts   Re-exports lintFile + DEFAULT_RULE_CONFIG for browser use
└── public/
    ├── kopytko-logo.svg         Logo (copied from images/)
    └── screenshots/             Add .png screenshots here; Screenshot.astro shows placeholders when absent
```

### Development

```bash
# From the site/ directory (run via WSL on Windows):
npm install   # first time only
npm run dev   # dev server at http://localhost:4321/vscode-kopytko/
npm run build # production build to site/dist/
npm run preview
```

### When to update the site

| Change | Update |
|---|---|
| New or changed linter rule | `site/src/pages/linter.astro` — add/update the `RuleCard` entry in the rules data array |
| New or changed formatter option | `site/src/pages/formatter.astro` — add/update the `OptionCard` entry; if the option has enum values, also update the JSONC comment annotation in `FormatterPlayground.tsx` |
| New parser export or capability | `site/src/pages/parser.astro` — add to the API reference groups |
| New extension feature, command, or setting | `site/src/pages/extension.astro` — update the relevant section and settings table |
| New `TokenKind` or `SyntaxKind` | Update `tokenKindTable` in `parser.astro` and the coloring maps in `brightscript-colors.tsx` and `TokenVisualizer.tsx` |
| Version bump | No site edit needed — versions are read dynamically from each `package.json` at build time |
| New screenshot available | Drop the `.png` into `site/public/screenshots/` matching the `src` prop on the `Screenshot` component |

### Interactive playground rules

The three React playgrounds (`TokenVisualizer`, `FormatterPlayground`, `LinterPlayground`) run the actual package code in the browser:

- **Token visualizer** — calls `tokenize()` + `parse()` (from the parser) on every keystroke. Uses parsed CST to colour `TypeName` tokens accurately without context-tracking heuristics.
- **Formatter playground** — calls `formatText()` with the config parsed from the JSONC editor. Config is JSONC (comments allowed); `stripJsonComments()` strips them before `JSON.parse()`.
- **Linter playground** — calls `lintFile()` with a browser stub `LintContext` (all filesystem callbacks return empty/null). Rules that need cross-file data (import resolution, XML, callbacks) silently produce no diagnostics, which is correct for a single-file playground. The rule toggle buttons control per-rule severity in the `LinterConfig.rules` map passed to `lintFile()`.

**Deployment:** The site rebuilds automatically on push to `main` when files under `site/**` or `syntaxes/**` change. Each release workflow (`release-*.yml`) also triggers a site redeploy as its final step, so the live site always reflects the just-published version. Never manually deploy the site mid-release; it happens automatically at the end.

---

## Performance guidelines

All new features must follow these patterns:

1. **Debounced diagnostics** — `onDidChangeContent` uses a 300ms stale-request-ID debounce. Use `scheduleValidation()`, not `validateDocument()`.
2. **Document cache** — use `getCachedLines`, `getCachedTypeMap`, `getCachedAllFunctions` from `utils/documentCache.ts`. Never call `text.split()`, `inferTypes()`, or `collectAllFunctions()` directly in a provider.
3. **Static data cached** — `getInstalledKopytkoPackages()` and `resolvePackageBaseDir()` are cached in the import resolver. `KopytkoModuleCatalog` scans once at startup. Both invalidate via `onDidChangeWatchedFiles`.
4. **Workspace function index** — `WorkspaceFunctionIndex` provides the file list for Find References and Rename. Never walk the workspace with `collectBrsFiles` in a provider.
5. **Map-backed catalog lookups** — `findComponent()`, `findBuiltin()`, `getComponentMethods()` are O(1) and cached.
6. **File watcher invalidation** — `CacheInvalidationService` handles `onDidChangeWatchedFiles` and clears/updates caches on disk changes. Document caches auto-invalidate on version change.

---

## Commit conventions

**No co-author lines (`Co-authored-by:`) in commit messages.** Use conventional commits: `feat:`, `fix:`, `docs:`, `test:`, `refactor:`, `chore:`.

**Changelog scopes** — the release workflows generate changelogs by filtering commit subjects. Use the appropriate scope so your commit appears in the right changelog:

| Scope | Appears in |
|---|---|
| `feat(vscode-kopytko):` / `fix(vscode-kopytko):` / `refactor(vscode-kopytko):` | Extension CHANGELOG |
| `feat(formatter):` / `fix(formatter):` / `refactor(formatter):` | Formatter CHANGELOG |
| `feat(linter):` / `fix(linter):` / `refactor(linter):` | Linter CHANGELOG |
| `feat(brightscript-parser):` / `fix(brightscript-parser):` / `refactor(brightscript-parser):` | BrightScript Parser CHANGELOG |
| Breaking change: add `!` after the scope — e.g. `feat(vscode-kopytko)!:` | `### Breaking Changes` section |
| `chore(vscode-kopytko):` / `chore(formatter):` / `chore(linter):` / `chore(brightscript-parser):` | `### Maintenance` section in the respective CHANGELOG |
| `test:`, `chore:` (unscoped), unscoped commits | Not included in any changelog |

---

## Adding a new LSP feature

1. Create `src/server/providers/<name>Provider.ts`.
2. Wire in `server.ts` (instantiate and declare capability) and `registerHandlers.ts` (register the handler).
3. **Use the document cache** — import from `utils/documentCache.ts`.
4. Add tests in `test/providers/<name>Provider.test.ts`.
5. Update `docs/features.md` (mark ✅) and `docs/language-server.md`.

## Expanding BrightScript built-ins

Edit `packages/brightscript-parser/src/catalog/builtins.ts`. Each entry: `name`, `signature`, `returnType`, `description`, `category`. Add test assertions in the matching builtins tests.

## Maintaining the component catalog

Edit `packages/brightscript-parser/src/catalog/components.ts`. Set `since` for new methods, `deprecated: true` for removed ones. **Update `CATALOG_LAST_VERIFIED`** only after verifying against live Roku docs. Update `docs/brightscript-components.md` and the matching component catalog tests.

## Expanding Kopytko module catalog

The dynamic `KopytkoModuleCatalog` in `src/server/kopytko/moduleCatalog.ts` scans installed packages at runtime. Tests in `test/kopytko/moduleCatalog.test.ts`.

## Package architecture — where logic belongs

The three packages have strict, non-overlapping responsibilities. When adding or moving code, apply this rule:

| Question | Answer |
|---|---|
| "Does this come from reading/analysing a `.brs` file?" | **brightscript-parser** |
| "Does this transform source text to make it prettier?" | **formatter** |
| "Does this check a rule and report a diagnostic?" | **linter** |

### `brightscript-parser` — source of truth for all file information

The parser is the shared foundation. It must expose every structural fact that any consumer (formatter, linter, LSP extension) could need. **If a consumer is re-deriving something from the CST that the parser could have computed once, move it to the parser.**

What belongs here:
- Lexer, CST, AST, typed node wrappers
- Scope analysis: `buildScopes`, `resolve`, `findScopeAtLine`
  - `Scope.references` carries `Reference.isWrite` — whether a reference is a pure `=` write vs a read
- Catalogs: builtins, components, casing rules, numeric literals, glob matching
- Parse diagnostics
- Any other per-file structural fact (e.g. import declarations, type annotations, declaration kinds)

What does NOT belong here: formatting config, linting config, rule logic, diagnostic codes.

### `formatter` — formatting logic only

The formatter imports the parser (for CST traversal and catalogs) but adds nothing to the parser's analysis. Its own code is exclusively about transforming whitespace, casing, indentation, and wrapping — never about what the code *means*.

What belongs here: CST passes that modify text, `FormattingConfig`, the CLI wrapper.

What does NOT belong here: scope analysis, variable tracking, semantic checks, any logic that could be reused by the linter or extension.

### `linter` — rule execution only

The linter imports the parser for everything file-analysis related (scope, AST, catalogs) and adds only rule-dispatch infrastructure on top. Rules themselves should be thin: consume the parser's output, check one property, emit a diagnostic.

What belongs here: rule descriptors, `checkXxx` functions, `lintRunner`, `fileAnalysis` (which caches the parser's scope/AST for rule reuse), project indexer, suppression logic.

What does NOT belong here: CST traversal helpers that re-derive facts the parser already exposes, duplicate scope-walking code, formatting config.

### Practical check

Before adding a helper to the formatter or linter, ask: *"Would another tool ever need this?"* If yes, it belongs in the parser. Examples of things that started in the linter/formatter but belong in the parser: `Reference.isWrite` (added after the linter needed it to distinguish writes from reads in the loop-variable-leak rule).

---

## Formatter architecture

The formatting engine is extracted into the standalone `packages/formatter/` package. The extension's `src/server/providers/formattingProvider.ts` is a thin LSP adapter that calls `formatText()` from the package. The engine is hybrid: CST-safe passes are exported from `src/cst-passes/index.ts` and inline text/regex passes remain in `formatter.ts`. Consecutive CST style passes are batched through `runCstPasses`, and parse results are cached per intermediate source so typical formatting parses around twice instead of repeatedly parsing per rule. Pass files are lint-clean TypeScript modules; do not add blanket unused-var disables.

**To modify formatting rules:** edit `packages/formatter/src/formatter.ts` and/or add a pass in `packages/formatter/src/cst-passes/`, then export it from `cst-passes/index.ts`. Run tests with `cd packages/formatter && npm test`.

**To add a new formatting option:** add the field to `FormattingConfig` in `packages/formatter/src/config.ts`, wire it in `formatter.ts`, add VS Code setting in root `package.json` under `contributes.configuration`, and update `docs/formatting.md`.

**Shared sources:** The `brightscript-parser` package is the canonical source for all file-structural information (see "Package architecture" above). Both `kopytko-formatter` and `kopytko-linter` import from it. The extension's `src/server/brightscript/` retains only extension-specific files (formatting config adapter, functionIndex for cross-file scope, typeInference for cursor helpers, xmlScriptParser for file system operations).
