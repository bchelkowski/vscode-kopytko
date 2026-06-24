# Language Server

The extension bundles a dedicated Language Server Process (LSP) built with [`vscode-languageserver`](https://www.npmjs.com/package/vscode-languageserver). It communicates with the extension host over IPC.

## Architecture

```
VS Code Extension Host
  └── KopytkoLanguageClient (src/client/languageClient.ts)
        │  IPC
        └── Language Server Process (src/server/server.ts)
              ├── registerHandlers.ts (connection.on* registration)
              ├── services/cacheInvalidation.ts (watched-file/config invalidation)
              ├── BrightScriptDiagnosticsProvider
              ├── BrightScriptCompletionProvider
              │     └── providers/completion/
              │           ├── completionContexts.ts
              │           ├── completionBuilders.ts
              │           ├── memberCompletion.ts
              │           ├── importCompletion.ts
              │           └── testCompletion.ts
              ├── BrightScriptHoverProvider
              ├── BrightScriptDefinitionProvider
              ├── BrightScriptDocumentLinkProvider
              ├── BrightScriptDocumentSymbolProvider
              ├── BrightScriptWorkspaceSymbolProvider
              ├── BrightScriptSignatureHelpProvider
              ├── BrightScriptReferencesProvider
              ├── BrightScriptRenameProvider
              ├── BrightScriptCodeActionProvider
              ├── BrightScriptFormattingProvider
              ├── BrightScriptSemanticTokensProvider
              ├── BrightScriptFoldingRangeProvider
              ├── BrightScriptSelectionRangeProvider
              ├── providers/shared/symbolResolver.ts
              ├── KopytkoImportResolver
              ├── KopytkoModuleCatalog
              ├── WorkspaceFunctionIndex
              ├── WorkspaceCallIndex
              └── (parser package catalogs: builtins, components, casing,
                   numericLiterals, globMatcher;
                   extension helpers: brightscript/functionIndex,
                   brightscript/xmlScriptParser, brightscript/casingUtils,
                   brightscript/typeInference, brightscript/patternSiblings,
                   brightscript/sgNodes, brightscript/mtopResolver,
                   utils/documentCache, utils/fileParseCache, utils/textUtils)
```

`server.ts` now focuses on bootstrap: creating providers, declaring capabilities, loading configuration, and kicking off workspace indexes. `registerHandlers.ts` owns the LSP request/response handlers, while `CacheInvalidationService` owns watched-file and configuration invalidation. Hover, signature help, definition, and rename share `providers/shared/symbolResolver.ts` for built-in/component/Kopytko/user-function lookup.

## Caching & performance

The server avoids recomputation on hot paths (completion fires per keystroke, hover per mouse-move) through several cooperating caches:

- **Per-document cache** (`utils/documentCache.ts`) — keyed by `{uri, version, contentLength}`, stores the split lines, parsed CST, scope tree, type map, `@import` list, and the collected function / inner-method sets for a document, evicting the least-recently-used entry. Providers read through the `getCached*` helpers instead of calling `split()`, `parse()`, `buildScopes()`, or the collectors directly.
- **Cross-document file parse cache** (`utils/fileParseCache.ts`) — reads and parses each `.brs`/`.xml` file **once** and shares its text (`readCachedFileText`), function definitions (`getCachedFunctionDefs`), and inner methods (`getCachedInnerMethodDefs`) across every document and provider. `WorkspaceFunctionIndex`, `WorkspaceCallIndex`, Find References, Rename, and the import-chain collectors all consume it; `readCachedDir` similarly caches directory listings for import-path completion. The document under the cursor always parses its own **live** buffer — the cache is only consulted for other (imported / sibling / `extends`) files, so an unsaved edit is never served stale.
- **`WorkspaceCallIndex`** (`utils/workspaceCallIndex.ts`) — built once at startup after `WorkspaceFunctionIndex`, then updated incrementally on file changes. Maintains a per-file set of called function names (direct calls, `observeField`/`observeFieldScoped`/`callFunc` string callbacks, Kopytko `events: { prop: "fn" }` AA patterns, and SceneGraph `<interface><function>` XML declarations); `getCalledNames()` returns a lazily-built workspace-wide union. Consumed by the `identifier/unused-function` diagnostic rule, which reads the pre-built set in O(1) — no computation at keystroke time.
- **Component-XML resolution cache** — `findComponentXml` memoizes `componentName → XML path` (including misses), keyed by search roots, avoiding repeated recursive directory walks while resolving `extends` chains.

**Invalidation.** `CacheInvalidationService` coordinates invalidation. Configuration changes refresh settings, clear caches through `refreshConfiguration()`, and revalidate open documents. On a watched-file change the service is more surgical: it updates/removes `.brs` files in `WorkspaceFunctionIndex` and `WorkspaceCallIndex`, evicts changed `.xml` files from the file parse cache, then calls `invalidateDocumentCaches()` so per-document derived state is recomputed while unaffected files stay warm. A `package.json`/`node_modules` change invalidates the package cache, rescans `KopytkoModuleCatalog`, and falls back to `invalidateAllCaches()` because many package files can change without individual events. Diagnostics are additionally debounced (300 ms) via `scheduleValidation()`.

## Capabilities

### Hover (`textDocument/hover`)

Returns Markdown documentation when the cursor is over:

- **BrightScript built-in functions** — signature, category badge, description sourced from `packages/brightscript-parser/src/catalog/builtins.ts`
- **BrightScript component names** — description, interface list, Roku docs link, catalog last-verified date
- **BrightScript component methods** — signature, return type, interface attribution, Roku docs link
- **BrightScript numeric literals** — type identification for all literal formats: hex integers (`&HFF` → Integer), floats (`2.01`, `1.23E+30`, `2!` → Float), doubles (`1.23D-12`, `2.3#` → Double), long integers (`42&`, `&hABCDEF&` → LongInteger)
- **Variables with inferred primitive types** — when a variable is assigned from a numeric literal (e.g. `flags = &HFF`), hovering the variable shows its inferred type (Integer)
- **Kopytko module exports** — function name, module name (derived from the source file name), NPM package, and signature; sourced from the dynamic `KopytkoModuleCatalog` (see below)
- **User-defined functions** — function name, source file path, and full declaration signature with parameter names and types; resolved from the current file, `@import` chain, XML sibling scripts, and pattern-based sibling files
- **`source/` directory functions** — function name, `source/<file>` path, and signature; resolved from workspace-wide `WorkspaceFunctionIndex` (O(1) cached lookup)

### Completion (`textDocument/completion`)

Completion contexts (evaluated in priority order):

1. **Module name context** — after `' @import <path> from `, offers known Kopytko NPM package names
2. **Import path context** — after `' @import /`, lists the immediate children of the current directory level (not a recursive walk). Directories appear as `name/` with `CompletionItemKind.Folder` and carry a retrigger command so selecting one immediately opens the next level. Files appear as `name.brs` with `CompletionItemKind.File`. Hidden entries (names starting with `.`) are skipped. Each item carries a `textEdit` that replaces the full path token from the leading `/`, so mid-word completions work correctly. When the annotation already has a `from <package>` clause, the walk is rooted at that package's `node_modules/<package>/<kopytkoModuleDir>` directory instead of `sourceDir`.
3. **Kopytko annotation context** — when the line matches `' @…` **or a bare `@`** (apostrophe optional), offers annotation snippets. Two snippet types are offered:
   - `@import` — inserts `' @import /${1:path/to/file.brs}` (internal import, path as tab stop)
   - `@import … from <package>` — one item per **installed** Kopytko NPM package found in `node_modules`; inserts `' @import /${1:path/to/file.brs} from <package>` with the package pre-filled and the path as the only tab stop
   
   In both cases a `textEdit` replaces the whole annotation prefix typed so far (from the apostrophe or `@` to the cursor), preserving any leading indentation. Uninstalled packages are never offered in this context.
4. **Type annotation context** — when the cursor follows `as ` (e.g. `function foo(x as ` or `function foo() as `), offers all 11 BrightScript primitive/special types (`Boolean`, `Double`, `Dynamic`, `Float`, `Function`, `Integer`, `Interface`, `LongInteger`, `Object`, `String`, `Void`) plus all ro\* component names as valid parameter types. Primitive types sort above component names. Primitive type names respect the `kopytko.casing.keyword` setting; component names are never re-cased.
5. **`CreateObject("…")` string context** — when the cursor is inside the first string argument of `CreateObject("…")`, suggests all known BrightScript component names (e.g. `roArray`, `roUrlTransfer`). Component names only appear in this context, not in general completions.
6. **Inline constructor call** — after `FunctionName().`, resolves the function as the owner and suggests its inner methods (AA method assignments like `prototype.doWork = function()`).
7. **`m.top.` context** — when the cursor is after `m.top.` (with optional partial identifier already typed), offers all members accessible through the SceneGraph component's node reference. See [m.top member completion](#mtop-member-completion) below.
8. **Member access context** — after `receiver.`, infers the receiver's component type via `CreateObject` or typed-parameter analysis and returns that component's methods. For user-defined "class" patterns (variable assigned from a function call, e.g. `obj = MyClass()`), suggests inner methods owned by that constructor function. If no methods can be resolved for a dot-access context, returns empty — default completions are never shown after a dot.
9. **Default context** — offers BrightScript built-in functions, language keywords, Kopytko module exports, **user-defined functions** from the current file's scope (own definitions, `@import` chain, XML siblings, pattern siblings, extends chain), **`source/` directory functions** (workspace-wide, deduped against the import chain), and **local variables** (function parameters, local assignments, and for-loop iteration variables). Results are deduplicated by name (case-insensitive) — builtins and keywords take priority over user-defined names.

Completion identifiers are formatted according to the casing configuration (see [Identifier Casing](#identifier-casing) below). Component names in `CreateObject()` are never re-cased — the Roku runtime is case-sensitive for string literals.

#### m.top member completion

When the cursor is positioned after `m.top.` in a `.brs` file that belongs to a SceneGraph component, the extension resolves the full set of accessible members and offers them as completion items:

| Source | Items offered |
|---|---|
| Component's own XML `<interface>` | `<field>` entries (kind: Field) and `<function>` entries (kind: Function) |
| User-defined parent components (via `extends`) | Their `<interface>` fields, recursively |
| Roku native SG node catalog | Fields and methods for the native ancestor in the hierarchy (e.g. `Group`, `Node`) |

**Resolution walk:**
1. Find the component XML file in the same directory as the `.brs` file.
2. Parse its `<interface>` section for `<field>` and `<function>` declarations.
3. Read the `extends` attribute.
4. If the parent is a **user-defined component**, locate its XML and repeat from step 2.
5. If the parent is a **Roku native SG node** (e.g. `Group`, `LayoutGroup`, `Node`), look it up in the built-in catalog and collect all of its fields and methods, then walk up the native catalog's own `extends` chain.

Because all SG nodes ultimately inherit from `Node`, methods like `observeFieldScoped`, `unobserveFieldScoped`, `findNode`, `setFocus`, and `hasFocus` are always offered as long as the component chain terminates in a known native node.

**Catalog:** `src/server/brightscript/sgNodes.ts`. Covers: `Animation`, `AnimationBase`, `ArrayGrid`, `Audio`, `BusySpinner`, `Button`, `ButtonGroup`, `ChannelStore`, `CheckList`, `ColorFieldInterpolator`, `ComponentLibrary`, `ContentNode`, `Dialog`, `DynamicCustomKeyboard`, `DynamicKeyGrid`, `DynamicKeyboard`, `DynamicKeyboardBase`, `DynamicMiniKeyboard`, `DynamicPinPad`, `FloatFieldInterpolator`, `Font`, `GridPanel`, `Group`, `InfoPane`, `Keyboard`, `KeyboardDialog`, `Label`, `LabelBase`, `LabelList`, `LayoutGroup`, `ListPanel`, `MarkupGrid`, `MarkupList`, `MaskGroup`, `MiniKeyboard`, `MonospaceLabel`, `MultiStyleLabel`, `Node`, `Overhang`, `OverhangPanelSetScene`, `Panel`, `PanelSet`, `ParallelAnimation`, `PinDialog`, `PinPad`, `Poster`, `PosterGrid`, `ProgressDialog`, `Rectangle`, `RowList`, `Scene`, `ScrollableText`, `ScrollingLabel`, `SequentialAnimation`, `SimpleLabel`, `SoundEffect`, `StandardDialog`, `StandardKeyboardDialog`, `StandardMessageDialog`, `StandardPinPadDialog`, `StandardProgressDialog`, `StdDlgAreaBase`, `StdDlgBulletTextItem`, `StdDlgButton`, `StdDlgButtonArea`, `StdDlgContentArea`, `StdDlgCustomItem`, `StdDlgDeterminateProgressItem`, `StdDlgGraphicItem`, `StdDlgItemBase`, `StdDlgKeyboardItem`, `StdDlgMultiStyleTextItem`, `StdDlgProgressItem`, `StdDlgSideCardArea`, `StdDlgTextItem`, `StdDlgTitleArea`, `TargetGroup`, `TargetList`, `TargetSet`, `TextEditBox`, `TimeGrid`, `Timer`, `Vector2DFieldInterpolator`, `Video`, `VoiceTextEditBox`, `ZoomRowList`.

#### Ask-to-insert `@import` on Kopytko export completion

When a Kopytko module export function (e.g. `setState`, `navigate`, `emit`) is selected from the default completion list, the language server checks whether the file already contains the corresponding `@import` annotation. If not, an `additionalTextEdit` is applied automatically, inserting the annotation at the top of the file:

```brightscript
' @import /Renderer.brs from @dazn/kopytko-framework
```

**How it works:**

- Kopytko export completions are offered only for **installed** packages — packages present in `node_modules` whose `package.json` declares a `kopytkoModuleDir` field.
- For each installed package, the server walks the package's `kopytkoModuleDir` recursively and parses every `.brs` file with `parseFunctionDefs` to extract all exported functions and subs. This is fully dynamic — no static catalog entry is needed.
- Each completion item carries the exact file-relative import path (e.g. `/utils/getProperty.brs`) and `npmPackage` in its `data` payload.
- On `completionItem/resolve`, the server checks the live document text for an existing `' @import <path> from <package>` line. If absent, a `TextEdit` inserting the annotation at line 0, character 0 is returned as `additionalTextEdits`.
- If the annotation is already present, no edit is applied — accepting the completion only inserts the function name at the cursor.

### Go-to-definition (`textDocument/definition`)

Three sub-cases resolved in order:

1. **`@import` line** — resolves the import path and navigates to line 0 of the imported file. Works anywhere on the annotation line (not just the path token).

2. **Associative-array method** — when the cursor is on the method name in a `obj.method()` call (or on a method name in its definition), the provider looks up inner-method definitions across all visible files. Two assignment patterns are recognised:
   - `prototype.method = function|sub (...)` — field assignment on an existing AA
   - `method: function|sub (...)`            — inline key in an AA literal (`return { method: function() … }`)

   Lookup is case-insensitive and covers the same scope as function lookup (see below). If no inner-method definition is found, the provider falls through to the top-level function lookup — this handles the common `m.topLevelFn()` pattern where a top-level function is callable through the `m` scope object.

3. **Function / sub name** — collects all function and sub definitions visible from the current file and jumps to the matching definition. The search covers:
   - The current `.brs` file itself
   - All files transitively reachable via `@import` annotations (including imports inside node_modules packages)
   - All `.brs` siblings listed in the same SceneGraph XML component (`<script type="text/brightscript" uri="..."/>`)
   - **`source/` directory functions** (fallback — workspace-wide O(1) lookup via `WorkspaceFunctionIndex`)

   Lookup is case-insensitive (BrightScript is case-insensitive).

### Signature Help (`textDocument/signatureHelp`)

Triggered by `(` and `,`. Shows a parameter hint popup while the cursor is inside a function call.

**Covered sources (evaluated in priority order):**

1. **Component methods** — type-inferred from `CreateObject` or typed parameter annotations; same inference as completion and hover.
2. **BrightScript built-in functions** — signatures from `packages/brightscript-parser/src/catalog/builtins.ts`.
3. **Kopytko module exports** — signatures from the dynamic `KopytkoModuleCatalog` (see below).
4. **User-defined functions** — walks the same scope as go-to-definition: the current file, files transitively reachable via `@import`, and XML sibling scripts.
5. **`source/` directory functions** — fallback lookup via `WorkspaceFunctionIndex` (O(1) cached).

**Active parameter tracking:** commas between the opening `(` and the cursor are counted at the top call depth. Commas inside nested calls or array literals (`[…]`) do not advance the parameter index of the outer call. The active parameter is clamped to the last declared parameter so the hint remains useful even when more arguments are supplied than declared.

**Label format:** The signature label is the full declaration normalized to `funcName(params…) as ReturnType` — the leading `function`/`sub` keyword is stripped so labels are consistent regardless of source.

### Document Links (`textDocument/documentLink`)

Each `@import` annotation that resolves to a real file is turned into a document link. The link range covers only the path token (e.g. `/components/Foo.brs`), keeping the underline tight and semantically correct — the path is what you are navigating to. Ctrl/Cmd+click on the path opens the resolved file.

Import paths that match a `kopytko.imports.generatedPaths` glob pattern are excluded — no link is produced for them since the file does not exist on disk.

### Diagnostics (`textDocument/publishDiagnostics`)

Diagnostics are computed on every document open and on every change.

#### `@import` diagnostics

See [kopytko-imports.md](./kopytko-imports.md#diagnostic-codes) for the full list of import diagnostic codes, including the `import/build-generated` informational hint for build-time generated files.

#### Undefined function call diagnostic

| Code | Severity | Description |
|---|---|---|
| `identifier/undefined-function` | Error | A bare function call (`word(…)`) references a name that cannot be found in scope. |

**Scope checked:** the current file and all files transitively reachable via `@import` annotations (including imports inside `node_modules` Kopytko packages). When `kopytko.imports.siblingPatterns` is configured, functions defined in or transitively imported by pattern-matched sibling files (e.g. `Foo.template.brs` when editing `Foo.component.brs`) are also included in scope.

**SceneGraph component inheritance:** when the file belongs to a SceneGraph component that `extends` another component (e.g. `<component name="MyComp" extends="KopytkoGroup">`), functions defined in the parent component's BRS files and their `@import` chains are added to scope. The parent lookup walks the `extends` chain recursively (grandparent, great-grandparent, …). Parent component XML files are searched across all configured workspace source directories and installed Kopytko package directories.

BrightScript XML component siblings that share the same `<script>` tag list but are **not** declared via `extends` are intentionally **excluded** from this check. Only the `extends` chain and the `@import` chain form the diagnostic scope boundary.

**What is NOT flagged:**
- Method calls on objects: `arr.Push(x)` — only the left side of a `.` can be type-inferred; right-side calls are skipped to avoid false positives.
- BrightScript built-in functions (`Abs`, `CreateObject`, `ParseJson`, …).
- Language keywords that can appear in call position (`print`, `tab`, `type`, …).
- Names on `dim` lines — `dim arr(10)` uses `name(size)` syntax, not a call.
- Anything inside a string literal or comment.
- **Calls inside Roku entry-point functions** (`Main`, `RunUserInterface`, `RunScreenSaver` — case-insensitive). These functions are invoked directly by the Roku firmware and have access to every globally compiled BrightScript function without `@import`. The exemption also covers anonymous callbacks nested inside the entry point.
- **The entire `main.brs` file** (case-insensitive filename). This is the Roku application entry-point file — all functions in it run with global scope and can call any compiled function without `@import`.

**Important:** Kopytko module exports are **not** globally suppressed. A call to `setState()` or any other Kopytko function will produce an `identifier/undefined-function` warning unless the function is reachable via the `@import` chain. This ensures the diagnostic drives correct `@import` hygiene — use the Quick-fix `Ask to insert @import` offered by completion, or add the import manually.

#### Built-in function arity diagnostic

| Code | Severity | Description |
|---|---|---|
| `identifier/wrong-arg-count` | Error | A BrightScript built-in function is called with the wrong number of arguments (e.g. `LCase("x", "y")` passes 2 args to a 1-arg function). |

Arity is derived from the parameter list in `packages/brightscript-parser/src/catalog/builtins.ts`. Parameters declared with a default value (e.g. `base = 10 as Integer`) count as optional; parameters without a default are required. Both the minimum and maximum are checked.

This diagnostic is only emitted for built-ins listed in the catalog. User-defined functions and Kopytko module exports are not checked for arity (their signatures are not tracked with sufficient precision).

#### Undefined variable diagnostic

| Code | Severity | Description |
|---|---|---|
| `identifier/undefined-variable` | Error | An identifier is used in expression position but is never defined in the enclosing function scope. |

**Per-function scope isolation:** each `function`/`sub` (named or anonymous) has its own isolated scope. Outer variables are **not** visible inside inner anonymous functions — BrightScript has no closures. This means a variable defined in `outer()` will be flagged as undefined if referenced inside a nested `function()` expression. The check correctly handles 3+ levels of nesting.

**What counts as defined:** function parameters (named and anonymous functions), local variable assignments (`x = …`, `x += …`), for-loop iteration variables (`for each item in …`, `for i = …`), dim-array names (`dim arr(10)`), and `catch` variables (`catch e`, `catch (e)`). Variables with BrightScript type-declaration suffixes (`&`, `%`, `!`, `#`, `$`) are recognised.

**What is NOT flagged:**
- `m` — the BrightScript component self-reference, always valid.
- BrightScript keywords and type names (`true`, `false`, `invalid`, `Integer`, `String`, …).
- BrightScript built-in function names.
- Function names defined in the file, any reachable `@import`, or inherited from the SceneGraph `extends` chain (those are covered by the undefined-function check).
- Identifiers immediately followed by `(` — those are function calls handled by `identifier/undefined-function`.
- Identifiers immediately followed by `:` — associative array literal keys (`{ key: value }`) or labels.
- Identifiers immediately followed by `.` — used as an object prefix (`obj.method`); skipped to avoid false positives from platform globals.
- Assignment targets (lvalues) — `x = …` defines a variable, it does not require `x` to pre-exist.
- Code at file level (outside any function/sub) — not checked.
- Anything inside a string literal or comment.
- Numeric literal components — hex digit sequences in `&HFF`-style literals, type-suffix characters (`!`, `#`, `%`, `&`), and exponent markers (`E`, `D`) are stripped before scanning to prevent false positives.
- Conditional compilation directives (`#if`, `#const`, `#else`, `#end if`) — variables used there are `bs_const` values defined in the manifest, not BrightScript scope.

#### Unused parameter diagnostic

| Code | Severity | Description |
|---|---|---|
| `identifier/unused-parameter` | Hint | A function/sub parameter is never referenced in the function body. |

Parameters prefixed with `_` (e.g. `_unused`) are considered intentionally unused and are not flagged. A quick-fix code action is offered to prefix the parameter name with `_`.

String literals and comments are excluded from the usage scan. Nested function bodies are scoped correctly — a parameter of an outer function is not considered "used" by an inner anonymous function's body.

#### Unused variable diagnostic

| Code | Severity | Description |
|---|---|---|
| `identifier/unused-variable` | Warning | A local variable is defined but never read in the enclosing function scope. |

**What counts as a definition:** local variable assignments (`x = …`), for-loop iteration variables (`for i = …`, `for each item in …`), dim-array names (`dim arr(10)`), and `catch` variables (`catch e`). Member assignments (`m.field = …`) are not tracked as local variables.

**What counts as a use:** any non-definition reference — `if` conditions, `return` statements, `print` calls, passing the variable as an argument in a function call (`someFunc(x)`), right-hand side of another assignment, compound assignments (`x += …`), array-indexed access (`arr[i] = …`), dot-access (`obj.method()`).

Note: in BrightScript, `=` serves as both assignment and comparison. The checker only treats `varName = expr` at the beginning of a statement as an assignment; the same syntax inside `if`, `while`, or other expressions is correctly recognised as comparison (a read).

**Statement separators:** the `:` character is handled as a statement separator. Multi-statement lines like `x = 1 : print x` are analysed per-statement, so the assignment and usage are correctly detected. Colons inside AA literals (`{ key: value }`) are not treated as separators.

**What is NOT flagged:**
- Variables prefixed with `_` (e.g. `_unused`) — considered intentionally unused.
- `m` — the BrightScript component self-reference.
- Function parameters — handled separately by `identifier/unused-parameter`.
- BrightScript keywords.
- Variables inside nested anonymous functions — BrightScript has no closures, so inner-scope references are isolated.

No quick-fix is offered — the user decides whether to remove the variable, prefix it with `_`, or restructure the code.

#### Unused function diagnostic

| Code | Severity | Description |
|---|---|---|
| `identifier/unused-function` | **Off by default** | A top-level named function is defined but never called anywhere in the workspace. |

**Off by default** — enable by setting the severity in `kopytko-linter.json` or `.vscode/settings.json`:
```json
{ "rules": { "identifier/unused-function": "hint" } }
```

**How it works:** `WorkspaceCallIndex` is built at startup and updated incrementally on file saves. It collects all function names that appear as call targets (direct calls, `observeField`/`observeFieldScoped` string callbacks, `callFunc` string arguments, Kopytko `events: { prop: "fn" }` AA patterns, and `<interface><function>` XML declarations). The diagnostic rule checks each top-level `FunctionDeclaration` against this workspace-wide set.

**Not flagged:**
- Functions in `source/` directories (globally accessible at Roku runtime, may be called from XML)
- Test files
- `init` and `onKeyEvent` (Roku lifecycle entry points)
- Functions starting with `_` (private convention; often assigned to AA fields as method references)
- Anonymous inline `function() … end function` expressions (not named top-level declarations)

**Known limitation:** functions referenced by name but not called (e.g. `callback = myFn`) are not detected. The `hint` severity is intentional — suppress individual cases with `' kopytko-disable-next-line identifier/unused-function`.

#### Loop variable leak diagnostic

| Code | Severity | Description |
|---|---|---|
| `identifier/loop-variable-leak` | Warning | A variable whose first assignment is inside a loop body is read after the loop ends. |

BrightScript is function-scoped, not block-scoped. A variable first assigned inside a `for`, `for each`, or `while` body is technically accessible after the loop ends, but relying on this is fragile — if the loop never executes, the variable is `invalid` at the post-loop read site.

**Flagged:** any read or write of a variable after the loop that contains the variable's first assignment.

**Not flagged:** if the variable has any assignment at a line _before_ the loop starts, it was intentionally pre-defined and is safe to use after the loop.

**Scope boundary:** only checks the direct `FunctionDeclaration` scope. `FunctionExpression` (anonymous function) child scopes are skipped — they cannot capture outer-function variables due to BrightScript's no-closures semantics.

#### Duplicate function name diagnostic

| Code | Severity | Description |
|---|---|---|
| `identifier/duplicate-function` | Error | A function declaration uses the same name as a function already visible in scope. |

Declaring a function with a name that collides with an `@import`-ed function, a sibling `.brs` function, or a `/source/` function causes a silent name collision at Roku runtime (the later definition wins). Two functions with the same name in the same file are also flagged.

**Exception:** functions from the component `extends` chain may be intentionally re-implemented (overriding the parent). These are identified via `ancestorFuncNames` (populated by the extension from `collectFunctionsFromExtends`) and are not flagged.

**Skipped:** files inside the `/source/` directory participate in global flat scope and may intentionally replace SDK-level functions.

#### m.top undefined field diagnostic

| Code | Severity | Description |
|---|---|---|
| `mtop/undefined-field` | Warning | `m.top.<fieldName>` accesses a field not declared in the component's XML `<interface>` or any ancestor component / SG node. |

This rule is **extension-mode only** — it requires companion XML files to be present and is not available in the standalone CLI linter. The extension resolves valid field names by:
1. Parsing the component's own XML `<interface>` fields and `<function>` declarations.
2. Recursively walking the `extends` hierarchy through user-defined parent components.
3. When the hierarchy reaches a Roku built-in SG node (e.g. `Group`, `Label`, `Video`), including all fields and methods from the SG node catalog.

Read accesses (`return m.top.field`) and write accesses (`m.top.field = value`) are both checked.

#### Unreachable code diagnostic

| Code | Severity | Description |
|---|---|---|
| `syntax/unreachable-code` | Warning | A statement follows a `return`, `throw`, `stop`, `end`, `exit for`, `exit while`, `continue for`, or `continue while` in the same block. |

Only the **first** unreachable statement in each block is flagged to avoid noise. The rule checks every statement list in the AST: function bodies, `if`/`else if`/`else` branches, `for`, `for each`, and `while` bodies, and `try`/`catch` bodies.

**Limitation:** no full control-flow analysis. Patterns like "all branches return" are not detected across `if/else` chains — the rule only flags linear dead code within a single statement sequence.

#### CreateObject argument validation

| Code | Severity | Description |
|---|---|---|
| `createobject/unknown-component` | Warning | The first string argument of `CreateObject(...)` is not a known Roku BrightScript component. |

The diagnostic checks the first string literal argument of every `CreateObject("...")` call against the built-in component catalog (`components.ts`). The lookup is case-insensitive to match Roku's runtime behaviour.

**Excluded:** `CreateObject("roSGNode", ...)` — the second argument is a user-defined SceneGraph component name that cannot be statically validated.

#### Loop flow control validation

| Code | Severity | Description |
|---|---|---|
| `syntax/flow-outside-loop` | Error | `continue while` / `exit while` used outside a `while` loop body, or `continue for` / `exit for` used outside a `for` loop body. |

The checker tracks nesting of `for`, `while`, and other block structures. A flow control statement is only valid when a matching loop type exists in the current nesting stack. Mismatched types (e.g. `exit for` inside a `while` but not inside any `for`) are also flagged.

#### Throw statement validation

| Code | Severity | Description |
|---|---|---|
| `throw/invalid-value` | Warning | `throw` is used with a value that is not valid in BrightScript — numeric literals, array literals, or `invalid`. |
| `throw/missing-message` | Warning | A thrown associative array literal does not contain a `message` field. |

BrightScript allows throwing only strings or associative arrays. When an AA is thrown it should have a `message` field. `throw (expr)` with outer parentheses is valid — they are treated as visual grouping only and are unwrapped before analysis.

**What IS flagged:**
- Numeric literals (integer, negative, floating-point, hex, type-suffixed): `throw 42`, `throw -1`, `throw 3.14`, `throw &HFF`, `throw 42&`
- Array literals: `throw [1, 2]`
- The `invalid` keyword: `throw invalid`
- AA literals missing a `message` field: `throw { number: -1 }`

**What is NOT flagged:**
- String literals: `throw "error"` — always valid
- Variable/expression references: `throw myError` — cannot be statically validated
- AA literals with a `message` field: `throw { message: "oops", number: -1 }` — valid

#### Observer callback validation

| Code | Severity | Description |
|---|---|---|
| `callback/undefined-observer-callback` | Error | The second argument of `observeField()` or `observeFieldScoped()` is a string that does not match any function defined in this file or any reachable `@import`. |

BrightScript's `observeField(fieldName, callbackName)` and `observeFieldScoped(fieldName, callbackName)` register a callback by **string name**. If the named function does not exist in scope, the observer fires at runtime but the callback silently fails. This diagnostic catches such mismatches at edit time.

The check applies to any node variable (not just `m.top`), including `unobserveField` and `unobserveFieldScoped` which are excluded (they only remove observers, not register them).

#### Kopytko events callback validation

| Code | Severity | Description |
|---|---|---|
| `callback/undefined-event-callback` | Error | A string value inside an `events: { ... }` block in a Kopytko template render object does not match any function defined in this file or any reachable `@import`. |

Kopytko framework components use `render()` methods that return element descriptors with an `events` field. Each key is a field name on the child node, and each value is a **string naming a callback function**. The framework's `KopytkoDOM` wires these up via `element.observeFieldScoped(eventKey, events[eventKey])` at runtime. This diagnostic ensures the named callback functions actually exist in scope.

### Code Actions (`textDocument/codeAction`)

Quick-fix light-bulb actions are offered on `@import` diagnostic lines. The server registers `codeActionProvider` with kind `QuickFix` only.

| Diagnostic code | Actions offered |
|---|---|
| `import/unresolved` | **Remove @import line** |
| `import/missing-path` | **Remove @import line** |
| `import/path-not-absolute` | **Fix: add leading / to import path** *(preferred)*, **Remove @import line** |
| `import/wrong-comment-style` | **Fix: use apostrophe comment style (' @import)** *(preferred)*, **Remove @import line** |
| `import/duplicate` | — (no action) |
| `import/unused` | **Remove unused @import line** |
| `import/build-generated` | — (informational only, no action) |
| `identifier/undefined-function` | — (no action) |
| `identifier/undefined-variable` | — (no action) |
| `identifier/unused-parameter` | **Fix: prefix with _ to mark as unused** *(preferred)* |
| `identifier/unused-variable` | — (no action) |
| `syntax/flow-outside-loop` | — (no action) |
| `syntax/trailing-comma` | — (no action) |
| `throw/invalid-value` | — (no action) |
| `throw/missing-message` | — (no action) |

**Remove @import line** deletes the entire line (including its trailing newline). When the import is on the last line of the file (no trailing newline), only the line content is deleted.

**Fix: add leading /** inserts `/` at the start of the import path token in the annotation, turning e.g. `' @import components/Foo.brs` into `' @import /components/Foo.brs`.

**Fix: use apostrophe comment style** replaces the double-quote before `@import` with `' ` (apostrophe + space), turning `"@import /path.brs` into `' @import /path.brs`.

Each action carries the originating diagnostic in its `diagnostics` array so VS Code highlights the matching squiggle when the action is hovered in the light-bulb menu.

## Identifier Casing

The extension can reformat identifier names when a completion is inserted. Three independent settings control this:

| Setting | Applies to | Default |
|---|---|---|
| `kopytko.casing.builtin` | BrightScript built-in functions | `preserve` |
| `kopytko.casing.keyword` | BrightScript keywords (fallback for categories below) | `preserve` |
| `kopytko.casing.type` | Type names in `as <type>` annotations (including `Function` when used as a type) | Falls back to `keyword` |
| `kopytko.casing.literal` | `true`, `false`, `invalid` | Falls back to `keyword` |
| `kopytko.casing.logicOperator` | `and`, `or`, `not` | Falls back to `keyword` |
| `kopytko.casing.mathOperator` | `mod` | Falls back to `keyword` |
| `kopytko.casing.method` | Component method names | `preserve` |
| `kopytko.casing.userFunction` | User-defined function/sub names | `preserve` |
| `kopytko.casing.userMethod` | User-defined AA method names | `preserve` |
| `kopytko.casing.exact` | Per-identifier overrides (see below) | `{}` |

**Note on `function` keyword:** `function` is dual-purpose — it is a keyword in declarations (`function myFunc()`, `end function`) and a type in annotations (`param as Function`). When `type` casing is set, `function` after `as` uses type casing; elsewhere it uses keyword casing. For example, with `kopytko.casing.type: "capitalize"` and `kopytko.casing.keyword: "lower-case"`:

```brightscript
function myFunc(callback as Function) as Function
end function
```

The `exact` setting is a JSON object mapping lowercase identifier names to the exact output string. It is applied **after** all other casing rules, allowing one-off overrides for identifiers that don't fit the general pattern:

```json
{
  "kopytko.casing.exact": {
    "invalid": "Invalid",
    "getglobalaa": "GetGlobalAA"
  }
}
```

Available options for each setting:

| Option | Example (input `CreateObject`) | Example (input `setUrl`) |
|---|---|---|
| `preserve` | `CreateObject` | `setUrl` |
| `upper-case` | `CREATEOBJECT` | `SETURL` |
| `lower-case` | `createobject` | `seturl` |
| `capitalize` | `Createobject` | `Seturl` |
| `pascal-case` | `CreateObject` | `SetUrl` |
| `camel-case` | `createObject` | `setUrl` |

`pascal-case` and `camel-case` split identifiers on uppercase letter boundaries so that `CreateObject` → `["Create", "Object"]` and `GetToString` → `["Get", "To", "String"]`. This preserves existing word boundaries in catalog-cased names.

Component names passed to `CreateObject()` (e.g. `"roArray"`) are **never** re-cased — the Roku runtime is case-sensitive for string literals and re-casing them would break the code.

Configuration changes take effect immediately without restarting the language server.

### Casing Scope

The casing engine only transforms **standalone identifiers** — direct function calls and variable references. Two categories are intentionally excluded to avoid corrupting data structures:

- **Associative array keys** — identifiers followed by `:` (e.g. `{ arrayUtils: value }`) are never re-cased, because the key name is a data label, not a function reference.
- **Property accesses** — identifiers preceded by `.` (e.g. `context.arrayUtils`) are never re-cased, because the property name belongs to the object's namespace, not the global scope.

## Global function scope (`source/` directory convention)

Roku's BrightScript runtime compiles all `.brs` files placed in a directory named **`source/`** within the app directory into the application's global scope. Any function defined there is callable from every component file without requiring an explicit `@import`.

The extension and linter both honour this convention:

- **Linter CLI** (`lintProject` / `lintProjectAsync`) — after building per-file known function names, `buildKnownFunctions` makes a single pass over the `fileFunctions` map and merges every function from any file whose path contains `/source/` as a path segment into every other file's `knownFuncNames`. No config is needed; it is auto-detected by directory name.

- **Extension (LSP)** — `WorkspaceFunctionIndex` exposes three cached methods: `getSourceDirNames()`, `getSourceDirFunctions()`, and `findSourceDirFunction(nameLower)`. The caches are built lazily on first access and invalidated only when a file under a `source/` path actually changes, keeping O(1) per-keystroke cost.

- **Kopytko modules** — `KopytkoModuleCatalog.getSourceDirNamesLower()` returns the subset of catalog entries whose `importPath` starts with `/source/`, also lazily cached and invalidated on `scan()`.

**Scope of the rule:** a `.brs` file is considered globally accessible if and only if its **normalized path contains `/source/` as a path segment**. Files at the project root or in `components/` or any other directory are not affected.

```
app/
  source/
    Helpers.brs       ← globally accessible (contains /source/)
  components/
    Button.brs        ← NOT globally accessible
  Root.brs            ← NOT globally accessible
```

## Dynamic Kopytko Module Catalog

The `KopytkoModuleCatalog` (`src/server/kopytko/moduleCatalog.ts`) replaces the old static `KOPYTKO_MODULES` list. Instead of a hand-maintained catalog, the server scans installed Kopytko NPM packages at runtime and builds an in-memory index of every exported function and sub.

### How it works

1. At server startup (`onInitialized`), `catalog.scan(rootPath, importResolver)` is called. Later package changes (`package.json`/`node_modules`) invalidate the package cache and rescan the catalog; ordinary settings changes do not re-walk packages.
2. The scan calls `getInstalledKopytkoPackages` to find all packages with a `kopytkoModuleDir` field in their `package.json`.
3. For each package, `resolvePackageBaseDir` locates the source root. Every `.brs` file under that root is parsed with `parseFunctionDefs` to extract function and sub declarations.
4. Each declaration is stored as a `KopytkoExportEntry` with `name`, `signature`, `importPath` (path relative to the package source root), and `npmPackage`.

### Consumers

| Consumer | How it uses the catalog |
|---|---|
| `BrightScriptHoverProvider` | Uses `SymbolResolver` (backed by `catalog.findExport`) to show hover documentation when the cursor is on a Kopytko function name. |
| `BrightScriptSignatureHelpProvider` | Uses `SymbolResolver` (backed by `catalog.findExport`) to provide parameter hints for Kopytko functions. |
| `BrightScriptCompletionProvider` | Uses `catalog.getEntries()` to provide Kopytko export completions without re-scanning packages. |

### Hover card format

When a Kopytko export is found, hover shows:

```
**funcName** *(ModuleName — `@package/name`)*

```brightscript
sub funcName(params…) as ReturnType
```
```

`ModuleName` is derived from the source file name: `/Renderer.brs` → `Renderer`. No hand-written description is shown — the signature from the live source file is used instead.

## Configuration Passed to the Server

The client passes the following `initializationOptions` to the server on startup:

| Option | Source |
|---|---|
| `workspaceFolders` | All open workspace folders |
| `sourceDir` | `kopytko.imports.sourceDir` setting |
| `resolveModules` | `kopytko.imports.resolveModules` setting |
| `trace` | `kopytko.languageServer.trace` setting |

After startup the server watches the `kopytko` configuration section for changes and re-fetches casing options and generated-path patterns live.

### Read-only paths

The extension supports three levels of read-only path configuration:

| Setting | Applies to |
|---|---|
| `kopytko.readOnlyPaths` | Shared fallback — applies to both formatting and linting when tool-specific settings are not set |
| `kopytko.format.readOnlyPaths` | Formatter-specific — files excluded from document formatting |
| `kopytko.lint.readOnlyPaths` | Linter-specific — files excluded from diagnostics |

Each setting accepts an array of glob patterns. When a tool-specific setting is configured, it takes precedence over the shared `kopytko.readOnlyPaths` for that tool.

```jsonc
// .vscode/settings.json
{
  // Shared fallback — applies to both formatter and linter
  "kopytko.readOnlyPaths": [
    "**/node_modules/**",
    "**/generated/**"
  ],

  // Formatter-specific override
  "kopytko.format.readOnlyPaths": [
    "**/node_modules/**",
    "**/generated/**",
    "**/vendor/*.brs"
  ],

  // Linter-specific override
  "kopytko.lint.readOnlyPaths": [
    "**/node_modules/**",
    "**/generated/**",
    "**/legacy/**"
  ]
}
```

Supported wildcards: `*` matches any characters except `/`; `**` matches any characters including `/`.

## Debugging the Language Server

Set `kopytko.languageServer.trace` to `"verbose"` in settings to log all LSP messages to the **Kopytko BrightScript (Trace)** output channel.

For Node.js debugging, the server is launched with `--inspect=6009` in debug mode. Attach VS Code's debugger to port 6009 using:

```json
// .vscode/launch.json addition
{
  "type": "node",
  "request": "attach",
  "name": "Attach to Language Server",
  "port": 6009,
  "restart": true,
  "outFiles": ["${workspaceFolder}/out/server/**/*.js"]
}
```

### Document Symbols / Outline view (`textDocument/documentSymbol`)

All `function` and `sub` definitions in the current file are surfaced as symbols. They appear in:

- **Outline panel** — the `OUTLINE` tab in the Explorer sidebar lists every function and sub with its name and parameter/return-type detail.
- **Breadcrumb** — the breadcrumb bar at the top of the editor shows the current function as the cursor moves through the file.

**Symbol shape:**

| Field | Value |
|---|---|
| `name` | The function or sub name as written (original casing) |
| `kind` | `SymbolKind.Function` for both `function` and `sub` |
| `detail` | Parameter list and return type extracted from the declaration, e.g. `(x as Integer) as Boolean` |
| `selectionRange` | The name token only — clicking the symbol in the Outline panel navigates to and selects the name |
| `range` | From the start of the declaration line to the end of the line before the next symbol starts (or end of file). VS Code uses this to track which symbol is active as the cursor moves |

**Nested AA methods** — when a top-level function body assigns anonymous functions to associative-array properties (the standard BrightScript "class" pattern), those assignments are nested as `SymbolKind.Method` children. Two syntaxes are recognised:
- `prototype.method = function|sub (...)` — field assignment on an existing AA
- `method: function|sub (...)`            — inline key in an AA literal (`return { method: function() … }`)

Children use the same `range`/`selectionRange`/`detail` fields, with `range.end` pointing to the matching `end function`/`end sub` line.

**Implementation:** `BrightScriptDocumentSymbolProvider` in `src/server/providers/documentSymbolProvider.ts` delegates to `parseFunctionDefs` from `src/server/brightscript/functionIndex.ts`. No import resolution or filesystem access is required — symbols are derived purely from the open document text.

### Workspace Symbol Search (`workspace/symbol`)

Invoked by `Ctrl+T` (Go to Symbol in Workspace). Returns all `function`/`sub` definitions and associative-array method assignments across every `.brs` file in the workspace.

**How it works:**

1. The provider receives the user's query string (may be empty).
2. It recursively walks every workspace folder, visiting all `.brs` files. `node_modules` and hidden directories (names starting with `.`) are skipped.
3. For each file, `parseFunctionDefs` extracts top-level functions and `parseInnerMethodDefs` extracts AA method assignments (both `prototype.method = function` and inline `{ method: function }` patterns).
4. Symbols whose name contains the query (case-insensitive substring match) are included. An empty query returns all symbols — VS Code applies additional fuzzy filtering on top.
5. All matching `SymbolInformation` objects are returned.

**Symbol shape:**

| Field | Value |
|---|---|
| `name` | The function or method name as written (original casing) |
| `kind` | `SymbolKind.Function` for top-level functions; `SymbolKind.Method` for AA method assignments |
| `containerName` | For AA methods: the name of the enclosing top-level function (the "class"); absent for top-level functions |
| `location` | Points to the name token — the function/method name, not the `function` keyword |

**Implementation:** `BrightScriptWorkspaceSymbolProvider` in `src/server/providers/workspaceSymbolProvider.ts`.

### References (`textDocument/references`)

Use VS Code's built-in **Find All References** (`Shift+F12`) or **Peek References** (`Alt+Shift+F12`) on any identifier.

**How it works:**

1. VS Code sends `textDocument/references` to the language server.
2. The server (`BrightScriptReferencesProvider`) asks `WorkspaceFunctionIndex.getFiles()` for the already-indexed workspace file list instead of walking the filesystem in the provider.
3. For each file, the server uses the AST (cached parse result from `fileParseCache`, parsing cached text only as a fallback) and walks `IdentifierExpression` nodes. Only standalone identifier references are returned — the following are **excluded** by the AST structure and are not false positives:
   - **Dot-member access** (`obj.funcName`) — the member name is a bare `Token` in the `DotExpression` node, not an `IdentifierExpression`.
   - **Associative-array keys** (`{ funcName: value }`) — the key is a bare `Token` in the `AAField` node, not an `IdentifierExpression`.
   - **Function/sub declaration sites** (`function funcName(…)`) — the name is `FunctionDeclaration.nameToken`, not an `IdentifierExpression`.
4. All matching `Location` objects are returned to VS Code, which displays them in the References panel.

### Rename Symbol (`textDocument/rename`)

Invoked by pressing **F2** (or right-click → **Rename Symbol**) on any user-defined identifier in a `.brs` file.

**How it works:**

1. VS Code first calls `textDocument/prepareRename`. The server (`BrightScriptRenameProvider`) extracts the word under the cursor and returns its range and current text as the pre-filled input placeholder. If the cursor is on a BrightScript built-in function, a language keyword, or whitespace, `prepareRename` returns `null` — VS Code then shows **"The element can't be renamed."**

2. The user types the new name and confirms. VS Code sends `textDocument/rename` with the new name.

3. The server validates the new name is a legal BrightScript identifier (`[a-zA-Z_]\w*`). If not, it returns `null`.

4. For workspace-wide function/sub renames, it uses `WorkspaceFunctionIndex.getFiles()` and cached on-disk file text (`readCachedFileText`) instead of walking the filesystem in the provider. Local variable/parameter renames operate only on the live document's enclosing function body.

5. The target lines are scanned with a word-boundary regex (`\bOldName\b`, case-insensitive). **Every match in scope is replaced** — including the definition line.

6. A `WorkspaceEdit` with `changes` grouped by file URI is returned. VS Code applies all edits atomically.

**Scope rules:**

| Symbol type | Rename scope |
|---|---|
| Top-level function or sub name | Workspace-wide — all `.brs` files in every workspace folder. BrightScript top-level functions are effectively global identifiers, so renames must propagate across all callers. |
| Local variable or parameter | Innermost enclosing function body in the current file only. Variables are function-scoped in BrightScript; a `count` in `funcA` is entirely unrelated to a `count` in `funcB`. |

The provider determines which case applies with the shared `SymbolResolver`, using the current file/import scope to check whether the identifier under the cursor is a visible top-level function definition. If it is not, the enclosing function body is found by scanning backwards for the nearest unclosed `function`/`sub` keyword and forwards for the matching `end function`/`end sub`.

**What is NOT renamed:**
- BrightScript built-in functions (`Abs`, `CreateObject`, …) — `prepareRename` rejects these.
- Language keywords (`for`, `if`, `function`, …) — `prepareRename` rejects these.
- Occurrences inside string literals or comments are renamed (the regex does not distinguish — avoid renaming short identifiers that appear as words in comments).

**Implementation:** `BrightScriptRenameProvider` in `src/server/providers/renameProvider.ts`.

### Document Formatting (`textDocument/formatting`)

Formats the entire `.brs` file using the standalone `kopytko-formatter` package in `packages/formatter/`. The formatter is a hybrid multi-pass engine: structure-aware CST passes handle token/node-sensitive edits, while text/regex passes remain inline in `formatter.ts` for rules that are simpler line transformations. Consecutive CST style passes are batched through `runCstPasses`, and per-format parse caching avoids reparsing for every enabled rule.

String literal contents and trailing comments (`'…`) are preserved by structure-aware passes and by text passes that operate only on the code portion of each line.

**Usage:** Run via the VS Code command *Format Document* (`Shift+Alt+F`), or enable `"editor.formatOnSave": true` in your settings.

**Implementation:** `BrightScriptFormattingProvider` in `src/server/providers/formattingProvider.ts` is a thin LSP adapter around `formatText()`.

See [formatting.md](./formatting.md) for the complete formatting rule reference.

### Semantic Tokens (`textDocument/semanticTokens/full`)

Parser-driven syntax highlighting that classifies each identifier from the scope tree, layered **on top of** the TextMate grammar. Where TextMate can only guess from neighbouring characters, this provider knows — from `buildScopes` — whether an identifier is a parameter, a local, a user-function call, or an `m`-field, and colours it accordingly. Anything not emitted here keeps its TextMate colour.

**Legend.** Four token types — `function`, `parameter`, `variable`, `property` — and one modifier, `declaration`.

| Source construct | Token type | Modifier |
|---|---|---|
| User function/sub name at its declaration | `function` | `declaration` |
| Call to a function — `foo(...)` (callee identifier, including builtins/globals) | `function` | — |
| Parameter — at declaration and every use | `parameter` | `declaration` at the declaration |
| Local — `=` assignment, `for` / `for each`, `catch`, `dim` — at declaration and every use | `variable` | `declaration` at the declaration |
| `m.field` member name | `property` | — |

**How it works.** A single AST `walk` over the cached CST, in pre-order so that call/dot handlers "claim" a token position before the generic identifier handler runs (a callee like `foo` in `foo(x)` is therefore emitted once, never as both a function and a variable). Identifiers that are neither a call callee nor an `m`-member are resolved with `findScopeAtLine` + `resolve` against the cached scope tree; the matching `Declaration.kind` selects the token type, and a position match against the declaration adds the `declaration` modifier. Unresolved names (and the implicit `m`) are skipped so the TextMate grammar continues to colour builtins, keywords, and non-`m` member access. Tokens are sorted into document order and delta-encoded via `SemanticTokensBuilder`.

**Left to TextMate (by design):** builtins/keywords, the `m` identifier itself, `obj.method()` and non-`m` member access, and `#if`/`#const` manifest constants. Only the full-document request is implemented (no delta/range). Highlighting never throws — on an unexpected error the request returns whatever tokens were collected.

**Client:** none required. The stock `LanguageClient` auto-registers the feature from the server's advertised capability, and the four legend types are standard and themed by default (`editor.semanticHighlighting.enabled` is on by default).

**Implementation:** `BrightScriptSemanticTokensProvider` in `src/server/providers/semanticTokensProvider.ts`; scope tree cached via `getCachedScopeTree` in `src/server/utils/documentCache.ts`.

### Folding Ranges (`textDocument/foldingRange`)

CST-driven folding that replaces VS Code's indentation heuristic for BrightScript files.

**What folds:**

| Construct | Folds from … to … |
|---|---|
| `function` / `sub` declaration | `function`/`sub` keyword line → `end function`/`end sub` line |
| Anonymous `function` / `sub` expression | same |
| `if` statement | `if` line → `end if` line |
| `else if` clause | `else if` line → end of its body |
| `else` clause | `else` line → end of its body |
| `for` loop | `for` line → `end for`/`next` line |
| `for each` loop | `for each` line → `end for`/`next` line |
| `while` loop | `while` line → `end while` line |
| `try` statement | `try` line → `end try` line |
| `catch` clause | `catch` line → end of its body |
| Contiguous `@import` / `@mock` block | first annotation line → last annotation line (kind: `imports`) |

Single-line constructs (where start and end are on the same line) are never emitted. Nested blocks each get their own fold point independently.

**How it works.** `BrightScriptFoldingRangeProvider` performs a single AST `walk` over the cached CST, collecting one `FoldingRange` per block node by reading the `line` property on the first and last tokens of each node. `@import`/`@mock` blocks are detected by a separate linear scan of the document lines (they are comment lines, not grammar nodes). The provider never throws — parse errors return whatever ranges were collected before the failure.

**Implementation:** `BrightScriptFoldingRangeProvider` in `src/server/providers/foldingRangeProvider.ts`.

### Selection Range (`textDocument/selectionRange`)

Smart expand/shrink selection walking AST ancestor boundaries, exposed by VS Code as **Expand Selection** (`Shift+Alt+→`) and **Shrink Selection** (`Shift+Alt+←`).

**How it works.** For each cursor position, `BrightScriptSelectionRangeProvider` calls `findNodeAtPosition` (from the parser package) to locate the deepest CST node at that position along with the full ancestor chain from root to deepest node. Each ancestor is converted to a `Range` using its first and last token positions. If the cursor falls on a specific token, that token's range is appended as the innermost entry. Consecutive duplicate ranges are removed. The resulting range list (outermost to innermost) is chained into a `SelectionRange` tree where each node's `parent` points to the next-larger enclosing range, matching the LSP contract (`parent.range` always contains `this.range`). The innermost range is returned to the client as the starting selection.

Repeated `Shift+Alt+→` presses walk the `parent` chain outward — from token → expression → statement → block → function → file.

**Implementation:** `BrightScriptSelectionRangeProvider` in `src/server/providers/selectionRangeProvider.ts`.

## Adding New Providers

1. Create the provider class in `src/server/providers/`.
2. Wire it up in `src/server/server.ts` (instantiate the provider and declare the capability in `onInitialize`).
3. Register the appropriate `connection.on*` handler in `src/server/registerHandlers.ts`.
4. Add unit tests in `test/providers/`.
5. Document the new capability in this file and update `docs/features.md`.

## Kopytko Unit Testing Framework Support

The extension provides intelligent support for writing tests with `@dazn/kopytko-unit-testing-framework`. Features activate automatically in test files (matching `_tests/**/*.test.brs` or `*.test.brs`).

### Test File Detection

A file is considered a test file if its path matches:
- `*/_tests/**/*.test.brs` (standard convention)
- `*.test.brs` (any file with `.test.brs` suffix)

### Test File Scope Resolution

Test files inherit scope from the files they test. The extension resolves which source files a test is testing by looking in the directory above the nearest `_tests/` directory:

- `_tests/Foo.test.brs` → looks for `../Foo.brs`, `../Foo.component.brs`, `../Foo.view.brs`, etc.
- `_tests/RailsService/RailsService_fetch.test.brs` → looks above `_tests/` for `RailsService.brs`, `RailsService.component.brs`, etc.

Test files can be nested in subdirectories of `_tests/` — the resolution always finds the source directory above `_tests/`.

The full scope visible from a test file includes:
1. **Own imports** — functions from `@import` and `@mock` chains
2. **Tested file scope** — all functions from the tested source file, its `@import` chain, its XML sibling scripts, and its pattern-based siblings
3. **Extends chain** — functions inherited from parent components (via `extends` in XML)
4. **Sibling test files** — split suites share scope (see below)

### Split Test Suites

Tests can be split into multiple files sharing the same base name:
- `Foo.test.brs` (base suite)
- `Foo_Bar.test.brs` (sub-suite)
- `Foo_Baz.test.brs` (sub-suite)

All files with the same base name (part before first `_`) share scope:
- Functions and imports from one file are visible in all sibling test files
- `import/unused` checks consider all sibling test files before flagging
- All siblings resolve to the same tested source file

### `@mock` Annotations

`@mock` annotations follow the same syntax and resolution as `@import` but are used to declare mocked dependencies:

```brightscript
' @mock /path/to/dependency.brs
' @mock /path/to/module.brs from @dazn/kopytko-utils
```

- Rendered as clickable document links (same as `@import`)
- Highlighted with a distinct colour (`keyword.control.mock.brightscript`)
- Exempt from `import/unused` checks (mocks are consumed via `mockFunction()`)
- The formatter sorts `@mock` annotations after `@import` annotations, with the same alphabetical sorting rules within each group

### Completions

Test-specific completions are provided in these contexts:

| Context | Completions |
|---|---|
| `expect(value).` | All matchers: `toBe`, `toEqual`, `toBeTrue`, `toBeFalse`, `toBeValid`, `toBeInvalid`, `toContain`, `toHaveKey`, `toHaveKeys`, `toHaveLength`, `toThrow`, `toHaveBeenCalled`, `toHaveBeenCalledTimes`, `toHaveBeenCalledWith`, `toHaveBeenLastCalledWith`, `toHaveBeenNthCalledWith`, `not` |
| `expect(value).not.` | All matchers (negated) |
| `mockFunction("name").` | `returnValue`, `resolvedValue`, `rejectedValue`, `implementation`, `throw`, `clear`, `getCalls`, `getConstructorCalls`, `setProperty`, `setProperties` |
| `getTestSuite().` | Test suite methods: `addTest`, `setBeforeEach`, `assertMethodWasCalled`, etc. |
| `fakeClock(m).` | `tick` |
| Default (test file) | Global test functions: `it`, `test`, `itEach`, `testEach`, `beforeAll`, `beforeEach`, `afterEach`, `afterAll`, `expect`, `mockFunction`, `getTestSuite`, `fakeClock`, `initKopytko`, `forceUpdate` |
| `' @` (annotation context) | `@mock` completion alongside `@import` |

### Hover Documentation

Hovering over test framework identifiers shows signature and description:
- Global functions: `it`, `test`, `expect`, `mockFunction`, `beforeEach`, etc.
- Matcher methods: `toBe`, `toEqual`, `toHaveBeenCalledWith`, etc.
- Mock methods: `returnValue`, `implementation`, `getCalls`, etc.

### Document Symbols

Test case names appear in the Outline panel as children of their enclosing `TestSuite__` function:
- `it("should render correctly", ...)` → symbol named "should render correctly"
- `test("returns valid data", ...)` → symbol named "returns valid data"
- `itEach([...], "works with ${x}", ...)` → symbol named "works with ${x}"

### Diagnostics

| Code | Severity | Message |
|---|---|---|
| `test/missing-return-ts` | Warning | Test suite function should end with `return ts` |
| `test/missing-mock-annotation` | Warning | `mockFunction("X")` references a function not defined in any `@mock`'ed file |

### API Catalog

The full test API catalog lives in `src/server/kopytko/testFramework.ts` with typed entries for all matchers, mock methods, suite methods, and global helpers. Each entry includes `name`, `signature`, `returnType`, and `description`.
