# vscode-kopytko — CLAUDE.md

## Project overview

A Visual Studio Code extension that provides first-class language support for **BrightScript** (Roku's scripting language) and the **Kopytko Framework** ecosystem. It includes a Language Server Protocol (LSP) implementation with diagnostics, hover documentation, completion, and go-to-definition.

Key repositories for context:
- **This repo**: https://github.com/bchelkowski/vscode-kopytko
- **Reference extension**: https://github.com/rokucommunity/vscode-brightscript-language
- **Kopytko Framework**: https://github.com/getndazn/kopytko-framework
- **Kopytko Packager**: https://github.com/getndazn/kopytko-packager
- **BrightScript reference**: https://developer.roku.com/docs/references/brightscript/language/brightscript-language-reference.md

---

## Repository structure

```
vscode-kopytko/
├── src/
│   ├── extension.ts               Extension entry point (activate/deactivate)
│   ├── client/
│   │   └── languageClient.ts      LSP client wrapper
│   └── server/
│       ├── server.ts              Language server entry point
│       ├── brightscript/
│       │   ├── builtins.ts        BrightScript built-in functions catalog
│       │   ├── components.ts      ro* component + interface catalog (methods, deprecations, since versions)
│       │   └── typeInference.ts   CreateObject / typed-param variable→type resolver
│       ├── kopytko/
│       │   ├── importResolver.ts  @import annotation parser and resolver
│       │   └── modules.ts         Known Kopytko module API catalog
│       └── providers/
│           ├── completionProvider.ts
│           ├── diagnosticsProvider.ts
│           ├── definitionProvider.ts
│           └── hoverProvider.ts
├── test/
│   ├── brightscript/              Unit tests for BrightScript support
│   ├── kopytko/                   Unit tests for Kopytko import resolution
│   └── providers/                 Unit tests for LSP providers
├── docs/
│   ├── features.md                Master feature list (update when adding features)
│   ├── brightscript-support.md    BrightScript syntax & snippets docs
│   ├── brightscript-components.md ro* component reference + catalog maintenance guide
│   ├── kopytko-imports.md         @import annotation documentation
│   └── language-server.md         LSP architecture and provider docs
├── syntaxes/
│   └── brightscript.tmLanguage.json   TextMate grammar
├── snippets/
│   └── brightscript.json          VS Code snippets
├── language-configuration.json    Bracket/comment/indent rules
└── package.json                   Extension manifest
```

---

## Development

### Prerequisites

- Node.js 18+
- npm 9+

### Install

```bash
npm install
```

### Build

```bash
npm run compile          # compiles both extension and server
```

### Watch

```bash
npm run watch            # watches extension (client side)
npm run watch:server     # watches server
```

### Lint

```bash
npm run lint
```

### Test

```bash
npm test                 # runs all tests via Mocha
npm run test:coverage    # with nyc coverage
```

---

## Testing requirements

Every new feature or bug fix **must** be accompanied by tests in the `test/` directory. Tests use **Mocha** + **Chai** + **Sinon**. Filesystem calls (`fs.existsSync`, `fs.readFileSync`) are stubbed with Sinon in all tests that involve file resolution — tests must not touch the real filesystem.

Test file naming convention: mirror the source path under `test/`. For example:
- `src/server/kopytko/importResolver.ts` → `test/kopytko/importResolver.test.ts`

Run tests before every commit.

---

## Documentation requirements

`docs/features.md` is the master feature list. **Update it whenever a feature is added, changed, or removed.** Each feature must also have a dedicated section in the relevant `docs/*.md` file.

---

## Commit conventions

**All commits must be authored solely under the developer's own name and email. Do not add any co-author lines (`Co-authored-by:`) to commit messages, regardless of tooling suggestions.** This applies to every commit, including automated or AI-assisted work.

Good commit message style:
```
feat: add hover documentation for BrightScript built-ins

- Implemented BrightScriptHoverProvider
- Added findBuiltin() lookup in builtins.ts
- Tests in test/providers/hoverProvider.test.ts
```

Use the conventional commits prefix where sensible: `feat:`, `fix:`, `docs:`, `test:`, `refactor:`, `chore:`.

---

## Adding a new LSP feature

1. Create the provider in `src/server/providers/<name>Provider.ts`.
2. Wire it up in `src/server/server.ts`.
3. Add unit tests in `test/providers/<name>Provider.test.ts`.
4. Update `docs/features.md` (mark as ✅ Implemented).
5. Add a section to `docs/language-server.md`.

## Expanding BrightScript built-ins

Edit `src/server/brightscript/builtins.ts`. Each entry requires `name`, `signature`, `returnType`, `description`, and `category`. Add corresponding test assertions in `test/brightscript/builtins.test.ts`.

## Maintaining the BrightScript component catalog

The component catalog lives in `src/server/brightscript/components.ts`.

**When to update:** When Roku releases a new firmware or publishes documentation changes at
https://developer.roku.com/dev/docs/brightscript.

**How to update:**
1. Add new interface methods to the appropriate `BRIGHTSCRIPT_INTERFACES` entry.
   - Set `since` to the minimum firmware version string (e.g. `"12.5"`).
   - Set `deprecated: true` and `deprecationNote` for removed/superseded methods.
2. Add entirely new interfaces as new entries in `BRIGHTSCRIPT_INTERFACES`.
3. Add new components (or update existing `interfaces` arrays) in `BRIGHTSCRIPT_COMPONENTS`.
4. **Update `CATALOG_LAST_VERIFIED`** to today's date in `YYYY-MM-DD` format — this date
   appears in hover cards so developers know how fresh the data is.
5. Update the change-log table in `docs/brightscript-components.md`.
6. Add test assertions in `test/brightscript/components.test.ts`.

**Do not** change `CATALOG_LAST_VERIFIED` without actually checking the live Roku docs —
it is the project's honesty signal to developers about data freshness.

## Expanding Kopytko module catalog

Edit `src/server/kopytko/modules.ts`. Each module entry includes `name`, `npmPackage`, `description`, and `exports[]`. Add assertions in `test/kopytko/modules.test.ts`.
