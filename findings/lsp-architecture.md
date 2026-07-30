# LSP Server Architecture & How-To Guides

---

## Performance rules (mandatory for all LSP providers)

1. **Debounced diagnostics** — use `scheduleValidation()`, not `validateDocument()` (300ms stale-request-ID debounce). Direct calls block the UI thread on every keystroke.
2. **Document cache** — import from `utils/documentCache.ts`: `getCachedLines`, `getCachedTypeMap`, `getCachedAllFunctions`. Never call `text.split()`, `inferTypes()`, or `collectAllFunctions()` directly in a provider — these are expensive and uncached.
3. **Static data cached** — `getInstalledKopytkoPackages()`, `resolvePackageBaseDir()` are cached in the import resolver; `KopytkoModuleCatalog` scans once at startup. Both invalidate via `onDidChangeWatchedFiles`.
4. **Workspace function index** — use `WorkspaceFunctionIndex` for Find References, Rename, and Workspace Symbol search (all query it, never walk the disk directly). There is no standalone `collectBrsFiles`/`brsFileCollector.ts` any more — it was a raw uncached workspace walk that `workspaceSymbolProvider.ts` used to call on every keystroke of "Go to Symbol in Workspace"; it was deleted once that provider was wired to the index like the others. If a provider seems to need a fresh full-workspace walk, that is a sign it should be reading from an index instead, not a reason to re-add a walker.
5. **Catalog lookups** — `findComponent()`, `findBuiltin()`, `getComponentMethods()` are O(1) map lookups.
6. **Cache invalidation** — `CacheInvalidationService` handles `onDidChangeWatchedFiles` and clears/updates caches on disk changes. Document caches auto-invalidate on version change.

---

## New LSP feature checklist

1. Create `src/server/providers/<name>Provider.ts`
2. Wire in `server.ts` (instantiate + declare capability) and `registerHandlers.ts` (register handler)
3. Use the document cache — import from `utils/documentCache.ts`
4. Add tests in `test/providers/<name>Provider.test.ts`
5. Update `docs/features.md` (mark ✅) and `docs/language-server.md`

### ⛔ Never add `.xml` to the client's `documentSelector`

`src/client/activation/languageServer.ts` selects `.brs` + `.kopytkorc` only, and that is load-bearing.
The selector is per-client, not per-capability: adding XML to it advertises **every** capability for
XML files. `documentFormattingProvider` is the dangerous one — our formatter returns nothing for XML
(`getBrsDocument` rejects it), but VS Code would still offer it as an XML formatter and can shadow the
built-in one. Semantic tokens and document symbols have the same shape of problem.

When a feature genuinely needs XML (type hierarchy does — SceneGraph `extends` lives in XML), register
that **one** capability dynamically instead, as `registerXmlTypeHierarchy()` in `server.ts` does:

```ts
connection.client.register(TypeHierarchyPrepareRequest.type, {
  documentSelector: [{ scheme: 'file', language: 'xml', pattern: '**/*.xml' }],
});
```

Two things to know before copying this:

- **The registration type is the *request* type** (`TypeHierarchyPrepareRequest.type`), not a
  `…RegistrationType` — no such export exists in `vscode-languageserver` v10. `TypeHierarchyFeature`
  in `vscode-languageclient` registers under `TypeHierarchyPrepareRequest.type`, so anything else is
  silently ignored. Gate the call on
  `params.capabilities.textDocument?.typeHierarchy?.dynamicRegistration`.
- **The document is not synced.** The client only sends `didOpen`/`didChange` for documents matching
  its own `documentSelector`, and dynamic server-side registration does not change that. So the
  handler must not use `services.getBrsDocument` — it gets `documents.get(uri)` (usually `undefined`
  for XML) and falls back to `readCachedFileText`. That text is disk state: unsaved XML edits are
  invisible, and a position can point at stale text. `typeHierarchyProvider.prepare` absorbs this by
  ending with a position-independent fallback ("the component this file declares") instead of
  returning nothing.

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

### Follow-up: a fourth failure mode — the wrong object entirely (2026-07-28, same day)

Two pre-existing tests in `test/brightscript/components.test.ts` and
`test/providers/completionProvider.test.ts` (written before the audit, asserting against the *old*
catalog) failed CI after the fix released: they expected `Values` on `roAssociativeArray` and
`GetResponseCode` on `roUrlTransfer`. Re-verifying both with pointed yes/no questions (not a bare
list dump) confirmed the audit's original deletions were right — but also surfaced a fourth failure
mode the sweep's fabricated/misfiled/missing taxonomy didn't cover:

4. **Wrong object.** `GetResponseCode`/`GetResponseHeaders`/`GetResponseHeadersArray` are real, but
   belong to `roUrlEvent` — the object an *async* `ifUrlTransfer` request (`AsyncGetToString`, …)
   delivers via the message port on completion, not the request object itself. The catalog had no
   `roUrlEvent` entry at all, so these methods were misfiled onto the request object because that
   was the only place completion could offer them — a plausible-looking home that happened to be
   wrong. Added `roUrlEvent`/`ifUrlEvent` (synthetic, like `ifSGNode` — Roku documents these methods
   directly on the component page with no separate interface page).

**Lesson: a hardcoded test asserting a method exists is not proof it belongs on that object.**
`Values` was genuinely fabricated (confirmed twice). `GetResponseCode` was real but on the wrong
object — request vs. response-event. When completion/catalog work touches an async API with a
paired "you get the result back on a different object" pattern (message-port events, promises,
callbacks), check which object actually documents the method before assuming the one under test is
right.

`CATALOG_LAST_VERIFIED` covers a full sweep, not a single interface — do not bump it for a
one-interface fix.

---

## Kopytko module catalog

`src/server/kopytko/moduleCatalog.ts` scans installed packages at runtime. Tests in `test/kopytko/moduleCatalog.test.ts`.
Its walk passes `walkTree(..., { skipNodeModules: false })` — every other workspace walker skips
`node_modules` to avoid descending into installed packages, but this walk's root *is* an installed
package's own base dir, so the default skip would silently make its own contents invisible.

## Directory walkers that stay separate from `dirWalker.ts`

`findComponentXml`'s two helpers in `xmlScriptParser.ts` (`findFileInTree`, `findXmlByComponentName`)
look like more copies of the same walk-and-collect pattern but are not: both are depth-limited
(`maxDepth`, since they run for every link in an `extends` chain) and **early-exit** — they check all
files at the current level before recursing into subdirectories, and return as soon as a match is
found, so a shallow match never pays for a full subtree walk. `dirWalker.ts`'s `walkTree` always visits
every file (it takes a void callback, not a predicate), so routing these through it would force a full
tree walk on every call — a real regression on a hot, repeatedly-called path. Leave them as-is unless
`walkTree` grows early-exit support.

---

## Workspace component index

`src/server/utils/workspaceComponentIndex.ts` maps SceneGraph component name → declaration and parent
→ subtypes, for type hierarchy. Two things it does differently from `WorkspaceCallIndex`, both
deliberate:

- **Built from `buildSearchRoots()`, not `getWorkspaceFolders()`.** `_walkDir` skips `node_modules`
  (as every workspace walk here does), so components shipped by installed Kopytko packages would be
  invisible — `extends="KopytkoSomething"` would resolve to nothing. Passing the package base dirs in
  as explicit roots is what makes them reachable: the skip only prevents *descending into*
  `node_modules`, it does not reject a root that already lives there.
- **The name map is rebuilt from the file map on every change**, rather than patched in place. A
  renamed component otherwise lingers under its old name forever, and the reverse (subtypes) map
  would keep an entry pointing at a component that no longer extends it.
- **Roots are de-duplicated before walking** (`dedupeRoots`). `buildSearchRoots()` returns both
  `<ws>` and `<ws>/<sourceDir>`, so without this the source tree is traversed twice. File *reads*
  dedupe through `readCachedFileText`; `readdirTyped` calls do not — `_walkDir` calls it directly.

### Duplicate component names — the check lives in the linter

`component/duplicate-name` reports the same `<component name>` declared by two XML files. It cannot
fall out of any existing lookup — `findComponentXml` and the import resolver are first-match searches
that stop at the first file they find, which is precisely why a duplicate is invisible and why the bug
it causes (a component silently overridden by load order) is so hard to trace from the symptom.

**It is not a per-file rule, and it is not extension-only.** The canonical implementation is
`kopytko-linter`'s `src/analysis/duplicateComponents.ts`, a pure function over
`ComponentDeclaration[]`. `runLint` calls it once per project after the per-file pass (`kopytko-lint`
reports it at the default `warning`; raise the rule to `error` in `.kopytkolintrc` for `--check` to
fail the build on it — see the *Duplicate Component Names* section above);
`services/componentDiagnostics.ts` calls it against `WorkspaceComponentIndex` (so the editor shows it
on save). A rule cannot do this — `RuleContext` is one `.brs` file — which is why it is a project-wide
pass in `runLint` rather than an entry in `ALL_RULE_GROUPS`.

Both call sites import the check straight from `kopytko-linter` (>= 1.7.0, released alongside this
feature). There was a transitional period where the extension's dependency lagged the linter release
and `src/server/brightscript/duplicateComponents.ts` carried a byte-for-byte mirror so the extension
could ship without waiting on a publish — that file is now deleted; do not recreate it. If this ever
recurs (a linter-side check the extension needs before the next linter release), mirror in exactly one
file with a header stating the version to delete it at, and grep for the mirror's own filename before
assuming it's still needed — `git log -- <path>` shows when it was added and removed last time.

Three things this got wrong before it worked:

- **`dedupeRoots` must model reachability, not string prefixes.** Kopytko package base dirs are
  `<ws>/node_modules/<pkg>/<dir>` — a sub-path of the workspace root, but one `_walkDir` will never
  descend into. Collapsing them as "already covered" silently un-indexes every package component.
  `walkReaches()` re-applies the walker's own skip rules to the relative segments. A test that
  asserted a package component was still found is what caught it.
- **`updateFile` needs the same scope test as `build`.** The client watches `**/*.xml` across the
  whole workspace, so the watcher offers paths the build deliberately skipped (`node_modules` outside
  a package base dir, dot-directories). Indexing them on write makes the index depend on what changed
  since startup — a duplicate-name warning that vanishes on restart. `_isInScope` replays the stored
  roots through `walkReaches`. Deletions stay ungated: dropping an entry is always safe.
- **The rule defaults to `warning`, and `kopytko-lint --check` exits non-zero on errors only.** So it
  does not fail CI out of the box — that is deliberate (a mis-scoped build-output dir would flag every
  component in the project), but it means "it runs in CI" is only true for reporting/SARIF unless the
  project raises it to `error`.

- **Filter excluded paths *before* counting, not after.** A build pipeline that copies `app/` into a
  staging dir turns every component in the project into a "duplicate". The check honours
  `kopytko.lint.readOnlyPaths`, and a name whose only remaining declaration is non-excluded must not
  be reported at all. Filtering after the `length > 1` test would still warn on the surviving file.
- **Published diagnostics are sticky per URI.** `sendDiagnostics` replaces the list for a URI, so a
  resolved duplicate needs an explicit empty publish. The service tracks `_publishedUris` for exactly
  this. Note this is also the one place the server publishes diagnostics for a file that is **not** a
  synced document — which works, and is what makes reporting on XML possible at all.

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
| Providers | `src/server/providers/` (17 providers) |
| Document cache | `src/server/utils/documentCache.ts` |
| Cache invalidation | `src/server/services/cacheInvalidation.ts` |
| Import resolution | `src/server/kopytko/importResolver.ts` |
| Directory walk (skip dot-dirs/node_modules, callback per file) | `src/server/utils/dirWalker.ts` — shared by `WorkspaceFunctionIndex`, `WorkspaceCallIndex`, `WorkspaceComponentIndex`, `KopytkoModuleCatalog` (passes `skipNodeModules: false` — its root is already inside `node_modules`, see below) |
| Built-in catalog | `packages/brightscript-parser/src/catalog/builtins.ts` |
| Component catalog | `packages/brightscript-parser/src/catalog/components.ts` |
| Formatting engine | `packages/formatter/src/formatter.ts` + `cst-passes/` |
| Test stub for fs | `src/server/utils/fsWrapper.ts` (Sinon-stubbable wrapper) |
| Test vscode mock | `test/roku/vscode-mock.ts` |
