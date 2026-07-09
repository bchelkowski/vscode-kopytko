# Development Environment Notes

---

## Windows + WSL2 setup

Node.js / npm are **only available inside WSL2**, not on the Windows host. All npm commands must be run via WSL:

```bash
# Run tests
wsl.exe bash -lic "cd /mnt/c/Projects/bchelkowski/vscode-kopytko && npm test"

# Compile
wsl.exe bash -lic "cd /mnt/c/Projects/bchelkowski/vscode-kopytko && npm run compile"

# Bundle webview
wsl.exe bash -lic "cd /mnt/c/Projects/bchelkowski/vscode-kopytko && npm run bundle:webview"
```

The `-lic` flags load the user's shell profile (which sets up `nvm` and the correct Node.js version). Without them, `npm` / `node` are not found.

WSL path for this repo: `/mnt/c/Projects/bchelkowski/vscode-kopytko`

---

## Device connectivity

The dev Roku device (Ultra 4850X) is at **192.168.137.46** on a Windows hotspot. Password: `rokudev`.

**WSL2 cannot reach this device** — WSL2 uses a NAT network separate from the Windows hotspot. To probe the device from the terminal, use native Git Bash (Bash tool), not WSL:

```bash
# Works (native Git Bash):
curl -s "http://192.168.137.46:8060/query/device-info"

# Works (native Git Bash):
exec 3<>/dev/tcp/192.168.137.46/8080; printf 'chanperf\r\n' >&3; timeout 3 cat <&3; exec 3>&- 3<&-

# Does NOT work (WSL2 — NAT blocks hotspot):
wsl.exe bash -lic "curl http://192.168.137.46:8060/query/device-info"
```

The extension itself runs in the VS Code Extension Host on Windows and connects to the device fine.

---

## Extension debug mode (F5)

VS Code F5 launches the Extension Development Host. It loads from `out/` which is populated by `npm run compile`. The `compile` script runs:
1. `tsc -p tsconfig.json` — compiles `src/client/**` → `out/client/**`
2. `tsc -p tsconfig.server.json` — compiles `src/server/**` → `out/server/**`
3. `npm run bundle:webview` — esbuild bundles `src/client/diagnostics/webview/main.ts` → `out/diagnostics-webview/main.js` + `main.css`

**Step 3 is critical for the diagnostics panel.** Without it, `out/diagnostics-webview/main.js` doesn't exist and the panel is blank (empty webview, no error shown).

The `preLaunchTask: "compile"` was **removed** from `launch.json` because the `tasks.json` task uses `source ~/.nvm/nvm.sh && npm run compile` which fails on Windows (it's a Bash/WSL command). Instead, run `npm run compile` manually (or via WSL terminal) before pressing F5.

For iterating on webview UI without restarting the whole extension:
```bash
# Run once to set up TypeScript watch for extension code:
wsl.exe bash -lic "cd /mnt/c/... && npm run watch"

# Run in parallel to watch webview changes:
wsl.exe bash -lic "cd /mnt/c/... && npm run watch:webview"
```

Then reload the Extension Development Host window (`Ctrl+R` in the EH window) to pick up changes.

---

## Build scripts

| Script | What it does |
|---|---|
| `npm run compile` | tsc (client + server) + esbuild (webview) — use for F5 dev |
| `npm run bundle` | esbuild (extension + server + webview) — production build, used by `vsce package` |
| `npm run bundle:webview` | esbuild webview only — fast, when only webview changed |
| `npm run watch` | tsc watch for client/extension |
| `npm run watch:server` | tsc watch for server |
| `npm run watch:webview` | esbuild watch for webview (live rebuild on save) |
| `npm test` | Mocha + tsx — all tests, no compile needed |
| `npm run lint` | ESLint for src/ + test/ |
| `npm run build:roku-device` | Installs + builds `packages/roku-device` — only needed when working inside that package itself |

### kopytko-roku-device is a published npm dependency (updated 2026-07-03)

`kopytko-roku-device` is published to npm and the root `package.json` depends on it by version
(`^0.1.0`), same as `kopytko-formatter`/`kopytko-linter`/`kopytko-brightscript-parser`. There is
no more `file:` link and no `postinstall` build step — `npm install` at the root pulls the built
package straight from the registry.

Consequence: editing `packages/roku-device/src/` does **not** affect the root extension build.
`node_modules/kopytko-roku-device` is the published tarball, not a symlink to `packages/roku-device`.
To try out an in-progress `roku-device` change against the extension before publishing, build
the package then copy its output into `node_modules/kopytko-roku-device` (see the gotcha below
for why a symlink doesn't work here) — don't just edit sources and expect `npm run compile` to
pick it up.

Package tests still run independently: `cd packages/roku-device && npm test` (via WSL like the root).

**Gotcha: `npm install ./packages/roku-device --no-save` (or `npm link`) creates a symlink that
the F5 Extension Host cannot resolve (2026-07-04).** Both commands normally symlink a local-path
dependency into `node_modules` instead of copying it — fine on a single-OS setup, but in this
WSL2 + Windows-host setup the symlink is created *by WSL* on the `/mnt/c` DrvFs mount. `tsc`/
`esbuild` (also run via WSL) resolve it fine at compile time, so `npm run compile` succeeds and
gives no signal anything is wrong. But the Extension Development Host launched by F5 is a
**native Windows** Node process, and it fails to resolve that WSL-created symlink at
`require()` time — the observed symptom is `Activating extension ... failed: Cannot find module
'kopytko-roku-device'` even though `ls node_modules/kopytko-roku-device` succeeds from WSL and
the compiled `out/*.js` files are correct. **Fix: skip the symlink entirely — build the package,
then plain-copy its output into place:**
```bash
wsl.exe bash -lic "cd /mnt/c/Projects/bchelkowski/vscode-kopytko/packages/roku-device && npm run build"
wsl.exe bash -lic "cd /mnt/c/Projects/bchelkowski/vscode-kopytko && \
  rm -rf node_modules/kopytko-roku-device && mkdir -p node_modules/kopytko-roku-device && \
  cp -r packages/roku-device/dist packages/roku-device/package.json node_modules/kopytko-roku-device/"
```
Verify it's a real directory, not a link, before trusting an F5 run: `file node_modules/kopytko-roku-device`
should say `directory`, not `symbolic link`. Re-copy after every package edit — there's no watch
mode for this path. Revert to the registry version with a plain `npm install` before publishing
(never commit a locally-copied `node_modules/kopytko-roku-device`).

---

## tsconfig setup

There are **3 tsconfig files**:
- `tsconfig.json` — client/extension (includes `src/client/**`, `src/extension.ts`); **excludes** `src/client/diagnostics/webview/**` (browser globals break Node compilation)
- `tsconfig.server.json` — server only (`src/server/**`)
- `tsconfig.test.json` — used by Mocha/tsx for running tests (includes both src and test)

The webview directory is excluded from the main tsconfig because it imports browser globals (`window`, `document`, `ResizeObserver`, `requestAnimationFrame`) which don't exist in the Node.js type environment. esbuild compiles it without type-checking.

**Every new webview needs its own `exclude` entry in `tsconfig.json`** (all of them are listed there: diagnostics, perfetto, nodes, nav, deepLinking, deviceManager webview + editorWebview, and `src/client/rokuPay/webview/main.ts`). Forgetting it fails `npm run compile` with dozens of `Cannot find name 'HTMLInputElement'` errors. Excluding only `main.ts` (rokuPay style) is enough when the folder's `protocol.ts` is import-free — excluded files that host code imports still get compiled as part of the program, so either granularity works.

### TypeScript 6 broke `{ ...T, ...Partial<T> }` with index signatures (2026-07-10)

With TS 6.0 installed (dev dependency range picked it up), spreading a `Partial<T>` into a
target typed `T` no longer type-checks when `T` has a string index signature — `Partial`
re-adds `| undefined` to the index-signature value type and the spread result keeps it.
This broke `src/server/providers/diagnosticsProvider.ts`'s
`rules: { ...DEFAULT_LINTER_CONFIG.rules, ...lintRuleOverrides }` (where `lintRuleOverrides:
Partial<RuleConfig>`), failing `npm run compile` on an untouched file. Fix: copy the defaults
and assign only the entries whose value `!== undefined` (which is also the correct runtime
semantics — an explicit `undefined` override would have clobbered a default).

---

## Git conventions

- **No co-author lines** in commits
- Conventional commits: `feat(vscode-kopytko):`, `fix(vscode-kopytko):`, `refactor(vscode-kopytko):`, etc.
- Each phase of a multi-phase feature gets its own commit

User identity: Błażej Chełkowski `<bchelkow@gmail.com>`

---

## Webview development notes

### CSP (Content Security Policy)
The webview HTML uses:
```
default-src 'none'; style-src ${csp} 'unsafe-inline'; script-src ${csp}; img-src ${csp} data:;
```
`${csp}` = `webview.cspSource` = the VS Code resource scheme (`vscode-resource:` or similar). The `'unsafe-inline'` for styles is needed for `<style>` blocks in the HTML. Scripts must be loaded via `webview.asWebviewUri()` from `localResourceRoots`.

### retainContextWhenHidden
The diagnostics panel uses `retainContextWhenHidden: true`. This keeps the webview's JS execution context alive when the panel is hidden (user switches to another bottom tab). Without it, every time the panel is shown it would reload and re-request all data. The tradeoff is higher memory usage.

### Cloud HTTPS from a tool: use host-side global fetch, not roku-device's httpClient (2026-07-10)

The Roku Pay tool (`src/client/rokuPay/`) calls `https://apipub.roku.com`. Two dead ends to avoid:
- `kopytko-roku-device`'s `httpClient` is **plain-HTTP only** (Node `http` module, built for LAN
  device traffic) — it will not do TLS.
- The webview cannot fetch either: the strict CSP has no `connect-src`, and adding one would leak
  requests through the webview origin.

So the request runs on the **extension host** with Node's global `fetch` (Node >= 24 per
`engines`), injected as `fetchFn: typeof fetch = fetch` for sinon-stubbed tests
(`src/client/rokuPay/rokuPayClient.ts`). Known limitation: undici's fetch ignores VS Code's
`http.proxy` settings — documented in `docs/roku-pay.md`.

### TypeScript __importStar and testing
When testing modules that `import * as vscode from 'vscode'`, TypeScript compiles this to `const vscode = __importStar(require('vscode'))`. The `__importStar` wrapper creates a **new object** each time the module is loaded. This means mutating the mock object AFTER the module is first imported won't affect what the module's `vscode` reference sees (it holds a reference to the old wrapper).

Workaround: clear the module from `require.cache` and re-import it after setting up stubs. See `test/roku/util/resolveSourceFile.test.ts` for the pattern.
