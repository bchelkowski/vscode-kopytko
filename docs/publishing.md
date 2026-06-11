# Publishing Guide

Step-by-step instructions for publishing `kopytko-formatter` to npm and the VS Code extension to the Marketplace.

---

## Automated releases (GitHub Actions)

Both projects have release workflows triggered manually from the **Actions** tab.

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
   - Bump `packages/kopytko-formatter/package.json` version
   - Generate and prepend a changelog entry (from `feat(kopytko-formatter):` / `fix(kopytko-formatter):` commits)
   - Commit, tag as `kopytko-formatter-v{version}`, push
   - Publish to npm
   - Create a GitHub Release
   - **Auto-bump** the root `package.json` dependency to the newly published version (waits for npm propagation, then commits and pushes)

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

### Publish `kopytko-formatter` to npm

#### Prerequisites

- An [npm account](https://www.npmjs.com/signup)
- Logged in via CLI: `npm login`
- Verify the package name `kopytko-formatter` is available: `npm view kopytko-formatter` (should return 404)

#### Steps

```bash
cd packages/kopytko-formatter

# 1. Verify everything passes
npm install
npm test
npm run build

# 2. Preview what will be published
npm pack --dry-run

# 3. Publish (first time)
npm publish --access public

# 4. Verify it's live
npm view kopytko-formatter
```

---

## 2. Publish the VS Code extension (manual)

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

1. **First**: publish `kopytko-formatter` to npm
2. **Then**: update root `package.json` to use versioned dep (`"kopytko-formatter": "^0.1.0"`)
3. **Then**: `npm install` + `npm test` to verify
4. **Finally**: publish the VS Code extension

This ensures the VSIX can install `kopytko-formatter` from npm rather than bundling a local copy.

---

## Version sync

Keep versions in sync between the two packages when the formatter changes:

| Change | kopytko-formatter | vscode-kopytko |
|---|---|---|
| Formatter-only fix | Bump formatter, publish to npm | Bump dep version, publish extension |
| Extension-only fix | No change | Bump extension, publish |
| Both change | Bump both, publish formatter first | Then publish extension |
