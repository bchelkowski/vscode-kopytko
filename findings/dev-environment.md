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
| `npm run build:roku-device` | Installs + builds `packages/roku-device` (also runs automatically via `postinstall`) |

### kopytko-roku-device build-order rule (added 2026-07-03)

The extension consumes `packages/roku-device` as a **`file:` dependency** — root compile/test/bundle
resolve it through `node_modules/kopytko-roku-device` → the package's **built `dist/`**, not its
TypeScript sources. Consequences:

- **After editing anything under `packages/roku-device/src/`, run `npm run build:roku-device`**
  (or `npm run build` inside the package) before root `npm run compile`, `npm test`, or F5 —
  otherwise the extension silently keeps using the stale previous build with no error.
- A fresh `npm install`/`npm ci` at the root triggers the `postinstall` hook which builds the
  package, so clean checkouts work without extra steps.
- The `postinstall` hook and the `file:` spec are removed at the package's first npm publish —
  the `release-roku-device.yml` workflow does both automatically when it bumps the root dependency.
- Package tests run independently: `cd packages/roku-device && npm test` (works via WSL like the root).

---

## tsconfig setup

There are **3 tsconfig files**:
- `tsconfig.json` — client/extension (includes `src/client/**`, `src/extension.ts`); **excludes** `src/client/diagnostics/webview/**` (browser globals break Node compilation)
- `tsconfig.server.json` — server only (`src/server/**`)
- `tsconfig.test.json` — used by Mocha/tsx for running tests (includes both src and test)

The webview directory is excluded from the main tsconfig because it imports browser globals (`window`, `document`, `ResizeObserver`, `requestAnimationFrame`) which don't exist in the Node.js type environment. esbuild compiles it without type-checking.

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

### TypeScript __importStar and testing
When testing modules that `import * as vscode from 'vscode'`, TypeScript compiles this to `const vscode = __importStar(require('vscode'))`. The `__importStar` wrapper creates a **new object** each time the module is loaded. This means mutating the mock object AFTER the module is first imported won't affect what the module's `vscode` reference sees (it holds a reference to the old wrapper).

Workaround: clear the module from `require.cache` and re-import it after setting up stubs. See `test/roku/util/resolveSourceFile.test.ts` for the pattern.
