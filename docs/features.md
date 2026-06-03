# vscode-kopytko — Feature Overview

This document is the canonical list of extension features. Each feature links to its dedicated documentation file. New features must be documented here before being considered complete.

## Language Support

| Feature | Status | Doc |
|---|---|---|
| BrightScript syntax highlighting | ✅ Implemented | [brightscript-support.md](./brightscript-support.md) |
| Language configuration (brackets, comments, word patterns) | ✅ Implemented | [brightscript-support.md](./brightscript-support.md) |
| BrightScript code snippets | ✅ Implemented | [brightscript-support.md](./brightscript-support.md) |

## BrightScript Component Intelligence

| Feature | Status | Doc |
|---|---|---|
| Component catalog (59 ro* objects, 59 interfaces, ~700 methods) | ✅ Implemented | [brightscript-components.md](./brightscript-components.md) |
| Member completion after `.` via `CreateObject` type inference | ✅ Implemented | [brightscript-components.md](./brightscript-components.md) |
| Member completion for typed function parameters (`param as roXxx`) | ✅ Implemented | [brightscript-components.md](./brightscript-components.md) |
| Hover docs for component names (`roArray`, `roSGNode`, …) | ✅ Implemented | [brightscript-components.md](./brightscript-components.md) |
| Hover docs for component methods with interface attribution | ✅ Implemented | [brightscript-components.md](./brightscript-components.md) |
| `CreateObject` argument completions (component name list) | ✅ Implemented | [brightscript-components.md](./brightscript-components.md) |
| Firmware `since` version displayed in hover / completion | ✅ Implemented | [brightscript-components.md](./brightscript-components.md) |
| Deprecation warnings in hover / completion | ✅ Implemented | [brightscript-components.md](./brightscript-components.md) |
| Catalog last-verified date surfaced in hover cards | ✅ Implemented | [brightscript-components.md](./brightscript-components.md) |

## Language Server (LSP)

| Feature | Status | Doc |
|---|---|---|
| Hover documentation for built-in functions | ✅ Implemented | [language-server.md](./language-server.md) |
| Hover documentation for Kopytko module exports | ✅ Implemented | [language-server.md](./language-server.md) |
| Completion for BrightScript built-ins | ✅ Implemented | [language-server.md](./language-server.md) |
| Completion for BrightScript keywords | ✅ Implemented | [language-server.md](./language-server.md) |
| Completion for `@import` annotations | ✅ Implemented | [language-server.md](./language-server.md) |
| Go-to-definition for `@import` paths | ✅ Implemented | [language-server.md](./language-server.md) |
| Diagnostics for unresolved `@import` paths | ✅ Implemented | [kopytko-imports.md](./kopytko-imports.md) |
| Diagnostics for malformed `@import` syntax | ✅ Implemented | [kopytko-imports.md](./kopytko-imports.md) |

## Kopytko Integration

| Feature | Status | Doc |
|---|---|---|
| Parse `@import` annotations | ✅ Implemented | [kopytko-imports.md](./kopytko-imports.md) |
| Resolve internal `@import` paths | ✅ Implemented | [kopytko-imports.md](./kopytko-imports.md) |
| Resolve external `@import` from NPM kopytko-module packages | ✅ Implemented | [kopytko-imports.md](./kopytko-imports.md) |
| Respect `sourceDir` from `.kopytkorc` | ✅ Implemented | [kopytko-imports.md](./kopytko-imports.md) |
| Respect `kopytkoModuleDir` from module `package.json` | ✅ Implemented | [kopytko-imports.md](./kopytko-imports.md) |
| Kopytko module API documentation on hover | ✅ Implemented | [language-server.md](./language-server.md) |

## Planned / Future

| Feature | Status |
|---|---|
| Function definition lookup across workspace files | 🔲 Planned |
| Symbol outline (document symbols provider) | 🔲 Planned |
| Workspace-wide symbol search | 🔲 Planned |
| BrightScript formatter integration | 🔲 Planned |
| `.kopytkorc` JSON schema validation | 🔲 Planned |
| SceneGraph XML component field completion | 🔲 Planned |
| Rename symbol refactoring | 🔲 Planned |
| Signature help for function calls | 🔲 Planned |
| Code actions (quick fixes for unresolved imports) | 🔲 Planned |
