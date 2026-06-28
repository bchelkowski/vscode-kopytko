# LSP Server Architecture & How-To Guides

---

## Performance rules (mandatory for all LSP providers)

1. **Debounced diagnostics** — use `scheduleValidation()`, not `validateDocument()` (300ms stale-request-ID debounce). Direct calls block the UI thread on every keystroke.
2. **Document cache** — import from `utils/documentCache.ts`: `getCachedLines`, `getCachedTypeMap`, `getCachedAllFunctions`. Never call `text.split()`, `inferTypes()`, or `collectAllFunctions()` directly in a provider — these are expensive and uncached.
3. **Static data cached** — `getInstalledKopytkoPackages()`, `resolvePackageBaseDir()` are cached in the import resolver; `KopytkoModuleCatalog` scans once at startup. Both invalidate via `onDidChangeWatchedFiles`.
4. **Workspace function index** — use `WorkspaceFunctionIndex` for Find References and Rename. Never walk the workspace with `collectBrsFiles` in a provider.
5. **Catalog lookups** — `findComponent()`, `findBuiltin()`, `getComponentMethods()` are O(1) map lookups.
6. **Cache invalidation** — `CacheInvalidationService` handles `onDidChangeWatchedFiles` and clears/updates caches on disk changes. Document caches auto-invalidate on version change.

---

## New LSP feature checklist

1. Create `src/server/providers/<name>Provider.ts`
2. Wire in `server.ts` (instantiate + declare capability) and `registerHandlers.ts` (register handler)
3. Use the document cache — import from `utils/documentCache.ts`
4. Add tests in `test/providers/<name>Provider.test.ts`
5. Update `docs/features.md` (mark ✅) and `docs/language-server.md`

---

## Formatter: adding a new option

1. Add field to `FormattingConfig` in `packages/formatter/src/config.ts`
2. Wire it in `packages/formatter/src/formatter.ts`
3. Add VS Code setting in root `package.json` → `contributes.configuration`
4. Update `docs/formatting.md`

## Formatter: adding a new rule / CST pass

Edit `packages/formatter/src/formatter.ts` for inline text/regex passes, or add a file to `packages/formatter/src/cst-passes/` and export it from `cst-passes/index.ts` for structure-aware passes. Run tests with `cd packages/formatter && npm test`.

---

## BrightScript built-ins catalog

**File:** `packages/brightscript-parser/src/catalog/builtins.ts`

Each entry: `name`, `signature`, `returnType`, `description`, `category`. Add corresponding test assertions in the builtins tests.

---

## Component catalog

**File:** `packages/brightscript-parser/src/catalog/components.ts`

- Set `since` for new methods, `deprecated: true` for removed ones
- Update `CATALOG_LAST_VERIFIED` **only** after verifying against live Roku docs
- Update `docs/brightscript-components.md` + matching component catalog tests

---

## Kopytko module catalog

`src/server/kopytko/moduleCatalog.ts` scans installed packages at runtime. Tests in `test/kopytko/moduleCatalog.test.ts`.

---

## Key files reference

| Area | Key files |
|---|---|
| LSP entry | `src/server/server.ts`, `src/server/registerHandlers.ts` |
| Providers | `src/server/providers/` (12 providers) |
| Document cache | `src/server/utils/documentCache.ts` |
| Cache invalidation | `src/server/services/cacheInvalidation.ts` |
| Import resolution | `src/server/kopytko/importResolver.ts` |
| Built-in catalog | `packages/brightscript-parser/src/catalog/builtins.ts` |
| Component catalog | `packages/brightscript-parser/src/catalog/components.ts` |
| Formatting engine | `packages/formatter/src/formatter.ts` + `cst-passes/` |
| Test stub for fs | `src/server/utils/fsWrapper.ts` (Sinon-stubbable wrapper) |
| Test vscode mock | `test/roku/vscode-mock.ts` |
