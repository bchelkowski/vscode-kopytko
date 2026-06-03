# Kopytko Import Resolution

## Overview

The Kopytko Packager uses `@import` annotations inside BrightScript comment lines to declare dependencies between `.brs` files. The extension understands these annotations and provides:

1. **Syntax highlighting** – `@import` lines are coloured distinctly from regular comments
2. **Diagnostics** – warnings when imports cannot be resolved
3. **Go-to-definition** – Ctrl/Cmd+click on an `@import` path to open the target file
4. **Completion** – suggestions for external Kopytko module package names

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

## Resolution Algorithm

### Internal imports

The resolver tries the following paths in order, stopping at the first hit:

1. `<workspaceFolder>/<sourceDir><importPath>` — e.g. `/project/app/components/utils.brs`
2. `<workspaceFolder><importPath>` — e.g. `/project/components/utils.brs`
3. `<documentDir><importPath>` — relative to the document being edited

### External imports

1. Walk up the directory tree from the document to find `node_modules/<packageName>`.
2. Read `kopytkoModuleDir` from the package's `package.json` (if present) to determine the module's root directory.
3. Resolve `<modulePath>/<kopytkoModuleDir><importPath>`.
4. Fall back to `<modulePath><importPath>` if the above does not exist.

## Diagnostic Codes

| Code | Severity | Description |
|---|---|---|
| `import/missing-path` | Error | `@import` annotation has no path |
| `import/path-not-absolute` | Warning | Import path does not start with `/` |
| `import/unresolved` | Warning | File could not be found at any candidate location |
| `import/wrong-comment-style` | Error | `@import` written with `"` instead of `'` |

## Configuration

| Setting | Default | Description |
|---|---|---|
| `kopytko.imports.resolveModules` | `true` | Resolve imports from `node_modules` kopytko-module packages |
| `kopytko.imports.sourceDir` | `"app"` | Source root for internal import resolution (matches `.kopytkorc` `sourceDir`) |

## `.kopytkorc` Integration

The extension reads `kopytko.imports.sourceDir` from VS Code settings. For it to match your project, set it to the same value as `sourceDir` in your `.kopytkorc` file.

```json
// .kopytkorc
{
  "sourceDir": "/app"
}
```

```json
// .vscode/settings.json
{
  "kopytko.imports.sourceDir": "app"
}
```

## Kopytko Ecosystem Packages

| Package | Description |
|---|---|
| `@dazn/kopytko-framework` | Core framework: Renderer, Router, EventBus, Store, HTTP, Cache, Modal, Registry, Theme |
| `@dazn/kopytko-utils` | Utility functions for BrightScript applications |
| `@dazn/kopytko-unit-testing-framework` | Unit testing with mocking support |
| `@dazn/kopytko-packager` | Build and deploy toolchain |
