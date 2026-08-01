# Publishing Guide

Step-by-step instructions for publishing `kopytko-brightscript-parser`, `kopytko-formatter`, `kopytko-linter`, `kopytko-roku-device`, and the VS Code extension.

---

## Automated releases (GitHub Actions)

All five projects have release workflows triggered manually from the **Actions** tab.

### Setup (one-time)

Add these repository secrets in **Settings → Secrets and variables → Actions**:

| Secret | Purpose | Where to get it |
|---|---|---|
| `VSCE_PAT` | VS Code Marketplace publishing | [dev.azure.com](https://dev.azure.com/) → User Settings → Personal Access Tokens → Create with **Marketplace (Manage)** scope, Organization = **All accessible organizations** |

npm publishing uses **OIDC provenance** — no token needed. Just link your npm package to the GitHub repository:

1. Publish the first version manually (`npm publish --access public`)
2. On [npmjs.com](https://www.npmjs.com/), go to the package → Settings → Publishing access → enable **Require two-factor authentication or an automation token or OIDC**

### Releasing kopytko-formatter

1. Go to **Actions** → **Release kopytko-formatter**
2. Click **Run workflow**
3. Select bump type: `patch`, `minor`, or `major`
4. The workflow will:
   - Run tests and build
   - Bump `packages/formatter/package.json` version
   - Generate and prepend a changelog entry (from `feat(kopytko-formatter):` / `fix(kopytko-formatter):` commits)
   - Commit, tag as `kopytko-formatter-v{version}`, push
   - Publish to npm
   - Create a GitHub Release
   - **Auto-bump** the root `package.json` dependency to the newly published version (waits for npm propagation, then commits and pushes)

### Releasing kopytko-linter

1. Go to **Actions** → **Release kopytko-linter**
2. Click **Run workflow**
3. Select bump type: `patch`, `minor`, or `major`
4. The workflow will:
   - Run tests and build
   - Bump `packages/linter/package.json` version
   - Generate and prepend a changelog entry (from `feat(kopytko-linter):` / `fix(kopytko-linter):` commits)
   - Commit, tag as `kopytko-linter-v{version}`, push
   - Publish to npm
   - Create a GitHub Release
   - **Auto-bump** the root `package.json` dependency to the newly published version (waits for npm propagation, then commits and pushes)

### Releasing kopytko-brightscript-parser

1. Go to **Actions** → **Release kopytko-brightscript-parser**
2. Click **Run workflow**
3. Select bump type: `patch`, `minor`, or `major`
4. The workflow follows the same steps as the linter release (tests, version bump, changelog from `feat(brightscript-parser):` / `fix(brightscript-parser):` commits, tag `kopytko-brightscript-parser-v{version}`, npm publish, GitHub Release), then auto-bumps and separately commits the dependency in the root extension, `kopytko-formatter`, and `kopytko-linter` (each as its own scoped `chore(<scope>):` commit so it surfaces in that package's own next changelog).

### Releasing kopytko-roku-device

1. Go to **Actions** → **Release kopytko-roku-device**
2. Click **Run workflow**
3. Select bump type: `patch`, `minor`, or `major`
4. The workflow follows the same steps as the linter release (tests, version bump, changelog from `feat(roku-device):` / `fix(roku-device):` commits, tag `kopytko-roku-device-v{version}`, npm publish, GitHub Release, root dependency auto-bump).

### Releasing vscode-kopytko

1. Go to **Actions** → **Release vscode-kopytko**
2. Click **Run workflow**
3. Select bump type: `patch`, `minor`, or `major`
4. The workflow will:
   - Bundle with esbuild and run tests
   - Bump root `package.json` version
   - Generate and prepend a changelog entry (from `feat(vscode-kopytko):` / `fix(vscode-kopytko):` commits)
   - Commit, tag as `v{version}`, push
   - Package and publish to VS Code Marketplace
   - Create a GitHub Release with the `.vsix` attached

---

## Manual releases (CLI)

Prefer the GitHub Actions workflows above. Use this only as a fallback (e.g. Actions is unavailable). Steps are the same for all four packages — substitute the package directory and npm name:

| Package | Directory | npm name |
|---|---|---|
| Parser | `packages/brightscript-parser` | `kopytko-brightscript-parser` |
| Formatter | `packages/formatter` | `kopytko-formatter` |
| Linter | `packages/linter` | `kopytko-linter` |
| Roku device | `packages/roku-device` | `kopytko-roku-device` |

#### Prerequisites

- An [npm account](https://www.npmjs.com/signup)
- Logged in via CLI: `npm login`

#### Steps

```bash
cd packages/<directory>

# 1. Verify everything passes
npm install
npm test
npm run build

# 2. Preview what will be published
npm pack --dry-run

# 3. Bump the version, then publish
npm version patch   # or minor / major
npm publish --access public

# 4. Verify it's live
npm view <npm-name>
```

After a manual publish, update the root `package.json` dependency version and run `npm install` to refresh the lockfile before releasing the extension.

---

## Publish the VS Code extension (manual)

### Prerequisites

- A [Visual Studio Marketplace publisher](https://marketplace.visualstudio.com/manage) — create one at https://marketplace.visualstudio.com/manage/createpublisher
- Publisher ID must match `"publisher"` in `package.json` (currently `"bchelkowski"`)
- A Personal Access Token (PAT) from Azure DevOps:
  1. Go to https://dev.azure.com → User Settings → Personal Access Tokens
  2. Create a token with **Marketplace (Manage)** scope
  3. Set Organization to **All accessible organizations**

### Steps

```bash
# 1. Verify everything passes
npm install
npm test

# 2. Login to vsce (once — uses the PAT)
npx vsce login bchelkowski
# Paste your Personal Access Token when prompted

# 3. Package (creates .vsix — runs npm run bundle via vscode:prepublish automatically)
npx vsce package

# 4. Verify the VSIX locally (optional)
#    Install in VS Code: Extensions → ⋯ → Install from VSIX

# 5. Publish to Marketplace
npx vsce publish

# 6. Verify it's live
#    https://marketplace.visualstudio.com/items?itemName=bchelkowski.vscode-kopytko
```

### Subsequent releases (manual)

```bash
# Bump version + publish in one command
npx vsce publish patch   # 0.1.0 → 0.1.1
npx vsce publish minor   # 0.1.0 → 0.2.0
npx vsce publish major   # 0.1.0 → 1.0.0
```

### Pre-release versions (optional)

```bash
npx vsce publish --pre-release
```

---

## Publishing order

`kopytko-brightscript-parser` is a dependency of `kopytko-formatter` and `kopytko-linter`, so it publishes first when all three change together.

1. **First**: publish `kopytko-brightscript-parser` to npm (if changed)
2. **Second**: publish `kopytko-formatter` and/or `kopytko-linter` to npm (if changed) — bump their `kopytko-brightscript-parser` dependency first if the parser changed
3. **Third**: publish `kopytko-roku-device` to npm (if changed)
4. **Then**: update the root `package.json` to the newly published versions
5. **Then**: `npm install` + `npm test` to verify
6. **Finally**: publish the VS Code extension

The automated workflows handle steps 4–5 for you (each release workflow auto-bumps and commits the root dependency after publishing).

---

## Version sync

Only bump and publish the packages that actually changed; unaffected packages and the extension's dependency on them stay untouched. When a package used by the extension changes, bump the extension's dependency and release it afterward.
