# Kopytko Import Resolution

## Overview

The Kopytko Packager uses `@import` annotations inside BrightScript comment lines to declare dependencies between `.brs` files. The extension understands these annotations and provides:

1. **Syntax highlighting** — `@import` and `@mock` lines are coloured distinctly from regular comments (with different colours for each annotation type)
2. **Document links** — each `@import` and `@mock` path renders as a clickable link in the editor; Ctrl/Cmd+click anywhere on it navigates to the resolved file
3. **Diagnostics** — warnings when imports cannot be resolved; informational hints for intentionally build-generated files
4. **Go-to-definition** — Ctrl/Cmd+click on a function name navigates to its definition, even when defined in an imported file or a sibling file from the same XML component
5. **Completion** — suggestions for external Kopytko module package names

## Annotation Syntax

### Internal import

```brightscript
' @import /path/to/file.brs
```

Imports a `.brs` file relative to the project's source root (configured via `kopytko.imports.sourceDir`, default `app`).

### External import

```brightscript
' @import /path/to/file.brs from @package/name
```

Imports a `.brs` file from an NPM package with the `kopytko-module` keyword installed in `node_modules`.

### Mock annotation (test files)

```brightscript
' @mock /path/to/dependency.brs
' @mock /path/to/dependency.brs from @package/name
```

Used in test files (`*.test.brs`) to declare a mocked dependency. `@mock` follows the same resolution algorithm as `@import` and produces the same clickable document links, but serves a different purpose: it registers dependencies for use with `mockFunction()`. The extension validates that `mockFunction("X")` calls reference functions actually defined in `@mock`'ed files.

When a `@mock` annotation is used, the extension automatically looks for companion files next to the resolved path:

- **`_mocks/<Basename>.config.brs`** — mock configuration functions (e.g. setup helpers)
- **`_mocks/<Basename>.mock.brs`** — mock implementation files that may define new functions not present in the original (e.g. a `Foo()` factory)

Functions from both files are added to the known scope, so test files can call them without triggering `identifier/undefined-function`. This is important because the Kopytko packager replaces the original file with the mock implementation at build time, and mock files often define functions (such as constructor factories) that don't exist in the original source.

`@mock` annotations use a distinct colour (`keyword.control.mock.brightscript`) to visually distinguish them from `@import` annotations.

## Document Links

Every `@import` line that resolves to a real file is turned into a document link. The link covers only the import path token (e.g. `/components/Foo.brs`), not the full annotation line. Hovering while holding Ctrl/Cmd underlines the entire annotation as one URL. Clicking navigates to the file.

Build-generated import paths (see [Build-generated paths](#build-generated-paths)) do not produce links since no file exists to open.

## Resolution Algorithm

### Internal imports

The resolver tries the following paths in order, stopping at the first hit:

1. `<workspaceFolder>/<sourceDir><importPath>` — e.g. `/project/app/components/utils.brs`
2. `<workspaceFolder><importPath>` — e.g. `/project/components/utils.brs`
3. If the document is inside a `node_modules` package: `<packageRoot>/<kopytkoModuleDir><importPath>` — this handles framework files that import sibling files without a `from` clause
4. `<documentDir><importPath>` — relative to the document being edited (last resort)

### External imports

1. Walk up the directory tree from the document to find `node_modules/<packageName>`.
2. Read `kopytkoModuleDir` from the package's `package.json` (if present) to determine the module's source root (e.g. `src/`).
3. Resolve `<packageRoot>/<kopytkoModuleDir><importPath>`.
4. Fall back to `<packageRoot><importPath>` if the above does not exist.

### Transitive imports

When the language server collects function definitions for go-to-definition, it follows `@import` chains recursively. A file inside `node_modules` that itself has `@import` statements is processed the same way — its imports are resolved relative to its own package root, so cross-package and within-package references both work.

## Function Definition Lookup

Pressing F12 (or Ctrl/Cmd+click) on a function name searches three scopes in order:

1. **Current file** — all `function` and `sub` definitions in the open `.brs` file
2. **`@import` chain** — all files transitively reachable via `@import` annotations, including files deep inside `node_modules` packages and their own internal imports
3. **XML component siblings** — the extension scans the directory for `.xml` files that list the current `.brs` file in a `<script type="text/brightscript" uri="..."/>` tag, then adds functions from every other `.brs` listed in those same XML files

Lookup is case-insensitive to match BrightScript's case-insensitive semantics.

## Diagnostic Codes

| Code | Severity | Description |
|---|---|---|
| `import/duplicate` | Warning | The same `@import` path (and `from` package, if present) appears more than once in the file |
| `import/missing-path` | Error | `@import` annotation has no path |
| `import/path-not-absolute` | Warning | Import path does not start with `/` |
| `import/wrong-comment-style` | Error | `@import` written with `"` instead of `'` |
| `import/build-generated` | Information | Path matches a configured generated-file pattern — file is expected to be created during the build |
| `import/unresolved` | Error | File could not be found at any candidate location |
| `import/unused` | Warning | Import resolves successfully, but none of the functions it exports are referenced anywhere in the current file |
| `import/missing-promise-deps` | Warning | In a test file, `.resolvedValue(...)` is used without an `@import` of `PromiseResolve.brs`, or `.rejectedValue(...)` is used without an `@import` of `PromiseReject.brs` (checked against the current file and its split-suite/sibling test files) |
| `test/missing-mock-annotation` | Warning | `mockFunction("X")` references a function not defined in any `@mock`'ed file |

`import/build-generated` is emitted only when the file does not exist **and** the path matches a `kopytko.imports.generatedPaths` pattern. If the file already exists (the build has run), no diagnostic is shown at all.

`import/duplicate` — the second and any further occurrence of the same `@import` line are flagged (default severity `warning`). The first occurrence is validated normally. Two imports with the same path but different `from` packages are distinct and are not considered duplicates.

`import/unused` is emitted when the imported file **resolves** but a scan of the current file finds no word-boundary match for any of the function or sub names defined in the imported file. References inside comment lines or string literals are excluded. If the imported file defines no functions at all (e.g. it only defines constants), the check is skipped.

The search scope can be expanded to sibling files via `kopytko.imports.siblingPatterns` — see [Sibling patterns (shared import scope)](#sibling-patterns-shared-import-scope) below. For test files, sibling test files (e.g. `Foo.test.brs` ↔ `Foo_Bar.test.brs`) are also scanned automatically — an import in the base suite is not flagged as unused if a split suite file references it.

`@mock` annotations are exempt from the `import/unused` check — mocks are consumed indirectly through `mockFunction()`, not direct calls.

**Implicit test-framework dependencies** are also exempt: `mockFunction().resolvedValue()` requires `PromiseResolve` and `mockFunction().rejectedValue()` requires `PromiseReject` at runtime, even though user code never calls these functions directly. In test files, imports of `PromiseResolve.brs` or `PromiseReject.brs` are not flagged as unused when the corresponding `.resolvedValue()` or `.rejectedValue()` call is present.

## Build-generated Paths

Some projects generate `.brs` files during the build process (e.g. via a Kopytko plugin or a code-generation step). These files do not exist in the source tree, so the extension would normally flag their imports as warnings.

### Silencing path warnings only (`generatedPaths`)

Configure `kopytko.imports.generatedPaths` with glob patterns to tell the extension which paths are intentionally absent. Unresolved imports matching a pattern are shown as an informational hint instead of a warning:

```json
// .vscode/settings.json
{
  "kopytko.imports.generatedPaths": [
    "/components/generated/**",
    "**/auto-generated/*.brs"
  ]
}
```

### Declaring functions in generated files (`generatedModules`)

When a generated file exports functions that are called from your source, use `kopytko.imports.generatedModules` to declare the function names. The extension will:

1. Treat the import as build-generated (informational hint, not a warning).
2. Add the declared functions to the known function scope of any file that imports the generated path — so calls to those functions are not flagged as `identifier/undefined-function`.

```json
// .vscode/settings.json
{
  "kopytko.imports.generatedModules": [
    {
      "path": "/components/generated/PluginApi.brs",
      "functions": ["PluginInit", "PluginGetData", "PluginDestroy"]
    },
    {
      "path": "**/auto/RouterConfig.brs",
      "functions": ["RouterConfig_GetRoutes"]
    }
  ]
}
```

Each entry has two required fields:

| Field | Type | Description |
|---|---|---|
| `path` | string | Glob pattern matching the `@import` path of the generated file |
| `functions` | string[] | Function and sub names exported by the generated file |

Function name matching is case-insensitive, consistent with BrightScript's case-insensitive semantics.

### Wildcard syntax

| Wildcard | Matches |
|---|---|
| `*` | Any characters except `/` (single path segment) |
| `**` | Any characters including `/` (multiple segments) |

### Examples

| Pattern | Matches |
|---|---|
| `/components/generated/**` | All files anywhere under `/components/generated/` |
| `**/auto/*.brs` | Any `.brs` file in a directory named `auto`, at any depth |
| `/build/gen-*.brs` | Files at the root `/build/` matching `gen-*.brs` |

## Configuration

| Setting | Default | Description |
|---|---|---|
| `kopytko.imports.resolveModules` | `true` | Resolve imports from `node_modules` kopytko-module packages |
| `kopytko.imports.sourceDir` | `"app"` | Source root for internal import resolution (matches `.kopytkorc` `sourceDir`) |
| `kopytko.imports.generatedPaths` | `[]` | Glob patterns for `@import` paths generated during the build; matched unresolved imports are shown as informational hints rather than warnings |
| `kopytko.imports.generatedModules` | `[]` | Declarations for generated `@import` paths including the function names they export; suppresses both the path warning and undefined-function errors for those functions |
| `kopytko.imports.siblingPatterns` | `[]` | Groups of filename patterns whose files share import scope for the `import/unused` check |

## Sibling patterns (shared import scope)

Kopytko components typically consist of two `.brs` files loaded together by the same XML component:

```
Foo.component.xml
  <script uri="Foo.component.brs"/>
  <script uri="Foo.template.brs"/>
```

Imports declared in `Foo.component.brs` are available in `Foo.template.brs` at runtime. If `helperFn` is imported in `component.brs` but only called in `template.brs`, the extension would incorrectly flag it as unused without any special configuration.

Configure `kopytko.imports.siblingPatterns` to tell the extension which files are always loaded as a group:

```json
// .vscode/settings.json
{
  "kopytko.imports.siblingPatterns": [
    ["*.component.brs", "*.template.brs"],
    ["*.view.brs", "*.template.brs"]
  ]
}
```

With this configuration, sibling scope is applied in two places:

1. **Unused import check** — when checking whether an import in `Foo.component.brs` is unused, the extension also scans `Foo.template.brs` (same directory, same base name `Foo`). The import is only flagged if the function is found in neither file.

2. **Undefined function check** — when checking `Foo.template.brs` for unknown function calls, functions defined in or transitively imported by `Foo.component.brs` are added to scope. Additionally, functions from XML sibling scripts (listed in the same `<component>` XML file) and the component's `extends` chain (including parent components) are included. This means a function that is imported in `component.brs`, defined in an XML sibling script, or inherited from a parent component will not be flagged as undefined in `template.brs`.

### Pattern syntax

Each pattern group is an array of filename patterns. A pattern may contain a single `*` wildcard that matches any string. Files with the same wildcard value in the same directory are considered siblings.

| Pattern | Matches | Wildcard value for `Foo.component.brs` |
|---|---|---|
| `*.component.brs` | `Foo.component.brs` | `Foo` |
| `*.template.brs` | `Foo.template.brs` | `Foo` |
| `Renderer*.brs` | `RendererBase.brs` | `Base` |

Files that do not match any pattern in any group are checked against the current file only (existing behaviour).

## `.kopytkorc` Integration

For internal import resolution to match your project, set `kopytko.imports.sourceDir` to the same value as `sourceDir` in your `.kopytkorc` file.

```json
// .kopytkorc
{
  "sourceDir": "app"
}
```

```json
// .vscode/settings.json
{
  "kopytko.imports.sourceDir": "app"
}
```

### JSON schema validation

The extension contributes a JSON schema for `.kopytkorc` (registered via `contributes.jsonValidation` in `package.json`). VS Code applies the schema automatically whenever a `.kopytkorc` file is open, giving you:

- **Inline validation** — red squiggles on unknown or incorrectly typed fields
- **Hover documentation** — field descriptions appear when hovering over a property key
- **Auto-complete** — VS Code suggests known property names

The schema is defined in `schemas/kopytkorc.schema.json`. It is intentionally open (`additionalProperties: true`) so that future Kopytko fields and project-specific extensions do not trigger false errors.

| Field | Type | Description |
|---|---|---|
| `baseManifest` | string | Path to the base manifest file (required to run the app) |
| `sourceDir` | string | Source root; should match `kopytko.imports.sourceDir` (default `"app"`) |
| `archivePath` | string | Path to the generated archive (supports `${manifest.field}` templates) |
| `generatedPackagePath` | string | Path to the generated package (supports `${manifest.field}` templates) |
| `signedPackagePath` | string | Path to a previously signed package for rekeying |
| `screenshotDir` | string | Directory for screenshots |
| `tempDir` | string | Absolute temp directory for the build process |
| `localManifestOverride` | string | Path to a local override file (typically git-ignored) |
| `pluginDefinitions` | object | Maps custom plugin names to their file paths |
| `plugins` | array | Global build plugins — string name, `[name, options]` array, or `{name, preEnvironmentPlugin, postGlobalPlugin}` object |
| `environments` | object | Environment-specific configs; each key is an env name with `manifest` (required) and optional `plugins` |

## Kopytko Ecosystem Packages

| Package | Description |
|---|---|
| `@dazn/kopytko-framework` | Core framework: Renderer, Router, EventBus, Store, HTTP, Cache, Modal, Registry, Theme |
| `@dazn/kopytko-utils` | Utility functions for BrightScript applications |
| `@dazn/kopytko-unit-testing-framework` | Unit testing with mocking support |
| `@dazn/kopytko-packager` | Build and deploy toolchain |
