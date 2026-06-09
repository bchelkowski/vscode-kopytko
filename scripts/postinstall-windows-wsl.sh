#!/bin/bash
# Fix kopytko-formatter link for Windows + WSL development.
#
# npm install creates a Unix symlink for file: dependencies,
# but Windows native Node.js (used by VS Code) cannot follow it.
# This script removes whatever npm created and makes a Windows junction.
#
# Run this after every `npm install` if you develop on WSL with Windows VS Code.

set -e

ROOT_WIN="$(wslpath -w .)"
LINK_WIN="$ROOT_WIN\\node_modules\\kopytko-formatter"
TARGET_WIN="$ROOT_WIN\\packages\\kopytko-formatter"

# Remove any existing link/junction via Windows (handles both types)
cmd.exe /c "if exist $LINK_WIN rmdir $LINK_WIN" > /dev/null 2>&1 || true
# Also remove from WSL side in case it's a Unix symlink Windows can't see
rm -f node_modules/kopytko-formatter 2>/dev/null || true

# Create Windows junction
cmd.exe /c "mklink /J $LINK_WIN $TARGET_WIN" > /dev/null 2>&1
echo "✓ Created Windows junction: node_modules/kopytko-formatter -> packages/kopytko-formatter"
