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

### ⛔ Never write catalog entries from memory

`ifDateTime` shipped **seven fabricated method names** and one method that does not exist at all:

| We had | Reality |
|---|---|
| `AsLongMilliseconds` | `AsMillisecondsLong` |
| `AsLongSeconds` | `AsSecondsLong` |
| `FromLongSeconds` | `FromSecondsLong` |
| `GetISOString` | `ToISOString` |
| `GetISOStringWithMilliseconds(fmt)` | `ToISOString(fmt)` overload |
| `GetLocalDateTime` / `GetLocalTime` | `asDateStringLoc` / `asTimeStringLoc` |
| `GetDayOfYear` | does not exist |

**Why it is easy to get wrong: Roku's own naming is inconsistent.** `ifDateTime` uses a trailing
`Long` (`AsMillisecondsLong`) while `ifDeviceInfo` uses `AsLong` (`GetUptimeMillisecondsAsLong`) —
both verified live. Generalising either convention to the other interface produces a plausible name
that does not exist, and a wrong completion is worse than a missing one because the user trusts it.

Two more traps seen on the real pages: Roku documents `AsSecondsLong` as returning **`Object`** and
`AsMillisecondsLong` as **`Long`** (neither is a BrightScript type keyword — the catalog uses
`LongInteger` and notes the discrepancy in the description), and it writes `asDateStringLoc` /
`asTimeStringLoc` with a **lowercase first letter** while every sibling is PascalCase. Match the
documented casing — there is precedent (the 16 `e*` socket status methods).

**Always fetch the interface's page before editing its entry**, and pin the result with a test that
compares `getComponentMethods()` against the documented list (see the tests in
`packages/brightscript-parser/test/analysis.test.ts`).

### Full audit result (2026-07-28)

All 80 interfaces were diffed against their live docs pages. **21 were wrong** — 51 methods removed,
14 added, method total 691 → 654. Three distinct failure modes, which need different fixes:

1. **Fabricated** — the name is on no Roku page (`GetFirmwareVersion`, `ToUpper`, `MoveFile`,
   `GetChildByName`, `GetExtension`, …). Delete.
2. **Misfiled** — real, but documented on a different interface the same component implements.
   `IsEmpty` sat on `ifStringOps` (really `ifString`), `Count` on `ifXMLList` (really `ifArray`),
   and eight `ifHttpAgent` header/cookie methods were copied into `ifUrlTransfer` while
   `roUrlTransfer` did not even list `ifHttpAgent`. **Fix by correcting the component's `interfaces`
   array, not by deleting the method** — otherwise completions disappear.
3. **Missing** — documented but absent (`TotalMicroseconds`, `getGlobalNode`, `ShrinkToFit`, …).

**`ifSGNode` is synthetic.** Roku has no such interface — `roSGNode` implements `ifSGNodeChildren`,
`ifSGNodeField`, `ifSGNodeDict`, `ifSGNodeFocus`, `ifSGNodeBoundingRect`, and
`ifSGNodeHttpAgentAccess`. Our single 34-method aggregate works for completion but the name is ours,
not Roku's; it is the one interface the audit could not diff. Splitting it is a breaking API change.

**How to re-run the audit:** fetch each interface's page asking only for bare method names, write one
`<ifName>.txt` per interface, and diff `getComponentMethods()` against it. The one-shot doc summariser
sometimes truncates — when a name looks real, re-query that page specifically before deleting it.
That check is what caught `AddHeader` as misfiled rather than fabricated.

`CATALOG_LAST_VERIFIED` covers a full sweep, not a single interface — do not bump it for a
one-interface fix.

---

## Kopytko module catalog

`src/server/kopytko/moduleCatalog.ts` scans installed packages at runtime. Tests in `test/kopytko/moduleCatalog.test.ts`.

---

---

## Documented counts are machine-checked

Any number in a README/docs/site page that counts something in the code (built-ins, keywords, ro*
components, interfaces, SceneGraph nodes, lint rules, formatter options, CST passes, LSP providers)
is verified by `scripts/check-doc-claims.mjs`, run from `npm run lint` and CI.

- **Adding to a catalog or rule set? Update the number too** — CI will tell you which file.
- **Rewording a sentence that contains one of these counts breaks the regex.** The check reports it
  as "pattern matched nothing" rather than passing silently; fix the pattern in the CLAIMS table.
- It loads the **TypeScript source via tsx, not `dist/`** — deliberately. The packages' `dist/` can
  be weeks stale (it was, when this was written), which is exactly how the drift went unnoticed.

---

## Key files reference

| Area | Key files |
|---|---|
| LSP entry | `src/server/server.ts`, `src/server/registerHandlers.ts` |
| Providers | `src/server/providers/` (16 providers) |
| Document cache | `src/server/utils/documentCache.ts` |
| Cache invalidation | `src/server/services/cacheInvalidation.ts` |
| Import resolution | `src/server/kopytko/importResolver.ts` |
| Built-in catalog | `packages/brightscript-parser/src/catalog/builtins.ts` |
| Component catalog | `packages/brightscript-parser/src/catalog/components.ts` |
| Formatting engine | `packages/formatter/src/formatter.ts` + `cst-passes/` |
| Test stub for fs | `src/server/utils/fsWrapper.ts` (Sinon-stubbable wrapper) |
| Test vscode mock | `test/roku/vscode-mock.ts` |
