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
│   │   ├── parser.ts               Recursive descent parser → CST
│   │   ├── ast.ts                  Typed AST wrappers (40+ node types)
│   │   ├── visitor.ts              AstVisitor + walk() + findAll()
│   │   ├── scope.ts                Scope analysis (buildScopes, resolve)
│   │   └── diagnostics.ts          Parse error types
│   ├── test/                       384 tests (lexer, parser, AST, scope)
│   └── docs/
│       └── syntax-reference.md     BrightScript syntax catalog (valid/invalid)
├── kopytko-formatter/              Standalone BrightScript formatter (CLI + library)
│   ├── src/
│   │   ├── index.ts                Public API (formatText, checkFormatting)
│   │   ├── formatter.ts            Formatting engine (CST passes + regex text formatting)
│   │   ├── cst-passes/             CST-based formatting passes (12 passes)
│   │   │   ├── infrastructure.ts   TextEdit, applyEdits, runCstPasses, walkTokens
│   │   │   ├── endKeywordStyle.ts  endif ↔ end if
│   │   │   ├── casingPass.ts       Keyword/builtin/identifier casing
│   │   │   ├── commentNormalization.ts  rem ↔ ', space after marker
│   │   │   ├── printStatementRemoval.ts  Remove print/? statements
│   │   │   ├── importSorting.ts    Sort @import annotations
│   │   │   ├── trailingWhitespace.ts  Remove trailing spaces
│   │   │   ├── thenStyle.ts        Add/remove then keyword
│   │   │   ├── functionVsSub.ts    Convert function ↔ sub for void
│   │   │   ├── blankLines.ts       Limit consecutive blank lines
│   │   │   ├── spacing.ts          Space around operators
│   │   │   ├── indentation.ts      Depth-based indentation
│   │   │   └── trailingCommas.ts   Add/remove trailing commas
│   │   ├── config.ts               FormattingConfig interface + defaults
│   │   ├── casing.ts               CasingConfig + transforms
│   │   ├── builtins.ts             BrightScript built-in function catalog
│   │   └── types.ts                FunctionDefinition interface
│   ├── bin/kopytko-format.ts        CLI entry point
│   └── test/                        227 tests (formatting + CST passes)
├── kopytko-linter/                 Standalone BrightScript linter (CLI + library)
│   ├── src/
│   │   ├── linter.ts               Lint engine (parses with brightscript-parser)
│   │   ├── rules/
│   │   │   ├── astRules.ts         AST-based rules (15 rules using parser)
│   │   │   ├── syntaxRules.ts      Trailing comma check (pre-parse)
│   │   │   └── index.ts            Rule registry│   │   └── analysis/               Legacy analysis utilities (superseded by parser)
│   └── test/                        447 tests
src/
├── extension.ts                    Extension entry point
├── client/                         VS Code client (debug adapter, device discovery, tree views)
└── server/
    ├── server.ts                   LSP entry point (all handlers, debounce, cache wiring)
    ├── providers/                  12 LSP providers (one per capability)
    │   └── formattingProvider.ts   Thin LSP adapter → calls kopytko-formatter
    ├── brightscript/               BrightScript catalogs and parsers
    │   ├── builtins.ts             58 built-in functions, 53 keywords, keyword categories
    │   ├── components.ts           60 ro* components, 78 interfaces
    │   ├── sgNodes.ts              86 SceneGraph nodes
    │   ├── functionIndex.ts        Function/sub parser + multi-scope collector
    │   ├── typeInference.ts        CreateObject / typed-param type resolver
    │   ├── casingUtils.ts          Identifier casing (6 options + exact overrides)
    │   └── ...                     globMatcher, mtopResolver, patternSiblings, xmlScriptParser
    ├── kopytko/
    │   ├── importResolver.ts       @import parser and resolver (with package cache)
    │   ├── moduleCatalog.ts        Dynamic Kopytko module export scanner
    │   └── testFramework.ts        Test framework API catalog
    └── utils/
        ├── brsFileCollector.ts     File walker
        ├── documentCache.ts        Per-document cache + getCachedParseResult()
        ├── workspaceFunctionIndex.ts  Built at startup, updated incrementally
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

The formatting engine lives in `packages/kopytko-formatter/` — a standalone npm package usable as a CLI tool and library, independent of VS Code.

```bash
cd packages/kopytko-formatter
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
| [packages/kopytko-formatter/README.md](packages/kopytko-formatter/README.md) | Standalone formatter: CLI usage, library API, CI integration |
| [docs/publishing.md](docs/publishing.md) | Step-by-step npm and VS Code Marketplace publishing guide |

**Every change that adds, modifies, or removes a feature must update `docs/features.md` and the relevant topic doc.**

---

## Performance guidelines

All new features must follow these patterns:

1. **Debounced diagnostics** — `onDidChangeContent` uses a 300ms stale-request-ID debounce. Use `scheduleValidation()`, not `validateDocument()`.
2. **Document cache** — use `getCachedLines`, `getCachedTypeMap`, `getCachedAllFunctions` from `utils/documentCache.ts`. Never call `text.split()`, `inferTypes()`, or `collectAllFunctions()` directly in a provider.
3. **Static data cached** — `getInstalledKopytkoPackages()` and `resolvePackageBaseDir()` are cached in the import resolver. `KopytkoModuleCatalog` scans once at startup. Both invalidate via `onDidChangeWatchedFiles`.
4. **Workspace function index** — `WorkspaceFunctionIndex` provides the file list for Find References and Rename. Never walk the workspace with `collectBrsFiles` in a provider.
5. **Map-backed catalog lookups** — `findComponent()`, `findBuiltin()`, `getComponentMethods()` are O(1) and cached.
6. **File watcher invalidation** — `onDidChangeWatchedFiles` in `server.ts` clears caches on disk changes. Document caches auto-invalidate on version change.

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
| `chore:`, `test:`, unscoped commits | Not included in any changelog |

---

## Adding a new LSP feature

1. Create `src/server/providers/<name>Provider.ts`.
2. Wire in `server.ts` (instantiate, register handler, declare capability).
3. **Use the document cache** — import from `utils/documentCache.ts`.
4. Add tests in `test/providers/<name>Provider.test.ts`.
5. Update `docs/features.md` (mark ✅) and `docs/language-server.md`.

## Expanding BrightScript built-ins

Edit `src/server/brightscript/builtins.ts`. Each entry: `name`, `signature`, `returnType`, `description`, `category`. Add test assertions in `test/brightscript/builtins.test.ts`.

## Maintaining the component catalog

Edit `src/server/brightscript/components.ts`. Set `since` for new methods, `deprecated: true` for removed ones. **Update `CATALOG_LAST_VERIFIED`** only after verifying against live Roku docs. Update `docs/brightscript-components.md` and `test/brightscript/components.test.ts`.

## Expanding Kopytko module catalog

The dynamic `KopytkoModuleCatalog` in `src/server/kopytko/moduleCatalog.ts` scans installed packages at runtime. Tests in `test/kopytko/moduleCatalog.test.ts`.

## Formatter architecture

The formatting engine is extracted into the standalone `packages/kopytko-formatter/` package. The extension's `src/server/providers/formattingProvider.ts` is a thin LSP adapter that calls `formatText()` from the package.

**To modify formatting rules:** edit `packages/kopytko-formatter/src/formatter.ts`. Run tests with `cd packages/kopytko-formatter && npm test`.

**To add a new formatting option:** add the field to `FormattingConfig` in `packages/kopytko-formatter/src/config.ts`, wire it in `formatter.ts`, add VS Code setting in root `package.json` under `contributes.configuration`, and update `docs/formatting.md`.

**Shared sources:** The `brightscript-parser` package is the canonical source for builtins, components, casing, numericLiterals, and globMatcher. Both `kopytko-formatter` and `kopytko-linter` import from it. The extension's `src/server/brightscript/` retains only extension-specific files (functionIndex for cross-file scope, typeInference for cursor helpers, xmlScriptParser for file system operations).
