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
              ├── BrightScriptDocumentLinkProvider
              ├── BrightScriptDocumentSymbolProvider
              ├── BrightScriptWorkspaceSymbolProvider
              ├── BrightScriptSignatureHelpProvider
              ├── BrightScriptReferencesProvider
              ├── BrightScriptRenameProvider
              ├── BrightScriptCodeActionProvider
              ├── BrightScriptFormattingProvider
              ├── KopytkoImportResolver
              ├── KopytkoModuleCatalog
              ├── WorkspaceFunctionIndex
              └── (brightscript/builtins, brightscript/components,
                   brightscript/functionIndex, brightscript/xmlScriptParser,
                   brightscript/globMatcher, brightscript/casingUtils,
                   brightscript/typeInference, brightscript/numericLiterals,
                   brightscript/patternSiblings,
                   brightscript/sgNodes, brightscript/mtopResolver,
                   utils/documentCache, utils/textUtils)
```

## Capabilities

### Hover (`textDocument/hover`)

Returns Markdown documentation when the cursor is over:

- **BrightScript built-in functions** — signature, category badge, description sourced from `src/server/brightscript/builtins.ts`
- **BrightScript component names** — description, interface list, Roku docs link, catalog last-verified date
- **BrightScript component methods** — signature, return type, interface attribution, Roku docs link
- **BrightScript numeric literals** — type identification for all literal formats: hex integers (`&HFF` → Integer), floats (`2.01`, `1.23E+30`, `2!` → Float), doubles (`1.23D-12`, `2.3#` → Double), long integers (`42&`, `&hABCDEF&` → LongInteger)
- **Variables with inferred primitive types** — when a variable is assigned from a numeric literal (e.g. `flags = &HFF`), hovering the variable shows its inferred type (Integer)
- **Kopytko module exports** — function name, module name (derived from the source file name), NPM package, and signature; sourced from the dynamic `KopytkoModuleCatalog` (see below)
- **User-defined functions** — function name, source file path, and full declaration signature with parameter names and types; resolved from the current file, `@import` chain, XML sibling scripts, and pattern-based sibling files

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
9. **Default context** — offers BrightScript built-in functions, language keywords, Kopytko module exports, **user-defined functions** from the current file's scope (own definitions, `@import` chain, XML siblings, pattern siblings, extends chain), and **local variables** (function parameters, local assignments, and for-loop iteration variables). Results are deduplicated by name (case-insensitive) — builtins and keywords take priority over user-defined names.

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

   Lookup is case-insensitive (BrightScript is case-insensitive).

### Signature Help (`textDocument/signatureHelp`)

Triggered by `(` and `,`. Shows a parameter hint popup while the cursor is inside a function call.

**Covered sources (evaluated in priority order):**

1. **Component methods** — type-inferred from `CreateObject` or typed parameter annotations; same inference as completion and hover.
2. **BrightScript built-in functions** — signatures from `src/server/brightscript/builtins.ts`.
3. **Kopytko module exports** — signatures from the dynamic `KopytkoModuleCatalog` (see below).
4. **User-defined functions** — walks the same scope as go-to-definition: the current file, files transitively reachable via `@import`, and XML sibling scripts.

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

Arity is derived from the parameter list in `src/server/brightscript/builtins.ts`. Parameters declared with a default value (e.g. `base = 10 as Integer`) count as optional; parameters without a default are required. Both the minimum and maximum are checked.

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

## Dynamic Kopytko Module Catalog

The `KopytkoModuleCatalog` (`src/server/kopytko/moduleCatalog.ts`) replaces the old static `KOPYTKO_MODULES` list. Instead of a hand-maintained catalog, the server scans installed Kopytko NPM packages at runtime and builds an in-memory index of every exported function and sub.

### How it works

1. At server startup (`onInitialized`) and again on every `onDidChangeConfiguration` event, `catalog.scan(rootPath, importResolver)` is called.
2. The scan calls `getInstalledKopytkoPackages` to find all packages with a `kopytkoModuleDir` field in their `package.json`.
3. For each package, `resolvePackageBaseDir` locates the source root. Every `.brs` file under that root is parsed with `parseFunctionDefs` to extract function and sub declarations.
4. Each declaration is stored as a `KopytkoExportEntry` with `name`, `signature`, `importPath` (path relative to the package source root), and `npmPackage`.

### Consumers

| Consumer | How it uses the catalog |
|---|---|
| `BrightScriptHoverProvider` | Calls `catalog.findExport(word)` to show hover documentation when the cursor is on a Kopytko function name. |
| `BrightScriptSignatureHelpProvider` | Calls `catalog.findExport(funcName)` to provide parameter hints for Kopytko functions. |
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
2. The server (`BrightScriptReferencesProvider`) recursively walks every workspace folder, visiting all `.brs` / `.bs` files. `node_modules` and hidden directories (names starting with `.`) are skipped.
3. For each file, every line is scanned with a word-boundary regex (`\b{word}\b`, case-insensitive). Lines that match a `function`/`sub` definition signature for the searched symbol are excluded — only call sites are returned.
4. All matching `Location` objects are returned to VS Code, which displays them in the References panel.

### Rename Symbol (`textDocument/rename`)

Invoked by pressing **F2** (or right-click → **Rename Symbol**) on any user-defined identifier in a `.brs` file.

**How it works:**

1. VS Code first calls `textDocument/prepareRename`. The server (`BrightScriptRenameProvider`) extracts the word under the cursor and returns its range and current text as the pre-filled input placeholder. If the cursor is on a BrightScript built-in function, a language keyword, or whitespace, `prepareRename` returns `null` — VS Code then shows **"The element can't be renamed."**

2. The user types the new name and confirms. VS Code sends `textDocument/rename` with the new name.

3. The server validates the new name is a legal BrightScript identifier (`[a-zA-Z_]\w*`). If not, it returns `null`.

4. It recursively walks every workspace folder, visiting all `.brs` files. `node_modules` and hidden directories are skipped.

5. For each file, every line is scanned with a word-boundary regex (`\bOldName\b`, case-insensitive). **Every match is replaced** — including the definition line.

6. A `WorkspaceEdit` with `changes` grouped by file URI is returned. VS Code applies all edits atomically.

**Scope rules:**

| Symbol type | Rename scope |
|---|---|
| Top-level function or sub name | Workspace-wide — all `.brs` files in every workspace folder. BrightScript top-level functions are effectively global identifiers, so renames must propagate across all callers. |
| Local variable or parameter | Innermost enclosing function body in the current file only. Variables are function-scoped in BrightScript; a `count` in `funcA` is entirely unrelated to a `count` in `funcB`. |

The provider determines which case applies by calling `collectAllFunctions` to check whether the identifier under the cursor is a known top-level function definition. If it is not, the enclosing function body is found by scanning backwards for the nearest unclosed `function`/`sub` keyword and forwards for the matching `end function`/`end sub`.

**What is NOT renamed:**
- BrightScript built-in functions (`Abs`, `CreateObject`, …) — `prepareRename` rejects these.
- Language keywords (`for`, `if`, `function`, …) — `prepareRename` rejects these.
- Occurrences inside string literals or comments are renamed (the regex does not distinguish — avoid renaming short identifiers that appear as words in comments).

**Implementation:** `BrightScriptRenameProvider` in `src/server/providers/renameProvider.ts`.

### Document Formatting (`textDocument/formatting`)

Formats the entire `.brs` file. Two operations are applied:

1. **Indentation normalisation** — adjusts leading whitespace to the configured number of spaces per level (`kopytko.format.indentSize`, default `4`). Indent depth is tracked across `function`/`sub`, `if…then`, `for`, `while`, and `try…catch` blocks. `else`/`elseif`/`catch` deindent to the same level as their opening keyword. Single-line `if … then <statement>` does not increase indent.

2. **Casing normalisation** — applies the configured casing rules to:
   - **Keywords** (controlled by `kopytko.casing.keyword`): `function`, `sub`, `if`, `then`, `end`, `for`, `while`, `return`, etc.
   - **Built-in function names** (controlled by `kopytko.casing.builtin`): `CreateObject`, `Len`, `UCase`, etc. The canonical catalog name is used as the base for casing transforms.

String literal contents and trailing comments (`'…`) are preserved verbatim — casing rules are only applied to the code portion of each line.

**Usage:** Run via the VS Code command *Format Document* (`Shift+Alt+F`), or enable `"editor.formatOnSave": true` in your settings.

**Implementation:** `BrightScriptFormattingProvider` in `src/server/providers/formattingProvider.ts`.

See [formatting.md](./formatting.md) for the complete formatting rule reference.

## Adding New Providers

1. Create the provider class in `src/server/providers/`.
2. Wire it up in `src/server/server.ts` (instantiate, register the appropriate `connection.on*` handler, declare the capability in `onInitialize`).
3. Add unit tests in `test/providers/`.
4. Document the new capability in this file and update `docs/features.md`.

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
| `ts().` | Test suite methods: `addTest`, `setBeforeEach`, `assertMethodWasCalled`, etc. |
| `fakeClock(m).` | `tick` |
| Default (test file) | Global test functions: `it`, `test`, `itEach`, `testEach`, `beforeAll`, `beforeEach`, `afterEach`, `afterAll`, `expect`, `mockFunction`, `ts`, `fakeClock`, `initKopytko`, `forceUpdate` |
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
