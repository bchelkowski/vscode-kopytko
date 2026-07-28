#!/usr/bin/env bash
# Regenerates MAP.md, docs/reference/commands-and-settings.md, and the README
# settings block when anything under src/ or packages/ has changed.
#
# Invoked from the Stop hook in .claude/settings.json — once per turn, not per
# file write. Always exits 0: a stale map is not worth blocking a turn over,
# and `npm run lint` / CI still run `--check` as the enforcing gate.
set -u

cd "$(dirname "$0")/.." || exit 0

# Nothing structural touched — don't pay for a node startup.
# Known gap: deleting a directory that was never committed leaves git status
# empty, so the map keeps the stale row until the next real change. That is
# what `npm run map -- --check` in lint/CI is for.
git status --porcelain -- src packages 2>/dev/null | grep -q . || exit 0

if command -v node >/dev/null 2>&1; then
  node scripts/generate-map.mjs >/dev/null 2>&1
elif command -v wsl.exe >/dev/null 2>&1; then
  # Node is installed only inside WSL on this machine. Feed wslpath a real
  # Windows path — Git Bash's $PWD is already POSIX-ish (/c/...) and wslpath
  # would turn that into /mnt/c/c/... silently.
  win_pwd="$(pwd -W 2>/dev/null || pwd)"
  wsl.exe bash -lic "cd \"\$(wslpath -a '$win_pwd')\" && node scripts/generate-map.mjs" >/dev/null 2>&1
fi

exit 0
