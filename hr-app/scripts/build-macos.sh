#!/usr/bin/env bash
# Build Hangup HR for macOS (DMG + ZIP). Must be run on a Mac.
set -euo pipefail
cd "$(dirname "$0")/.."

echo "==> npm install"
npm install

echo "==> Rebuild native modules (better-sqlite3)"
npm run rebuild:native

echo "==> Build macOS artifacts"
npm run dist:mac

echo "Done. Output in dist/:"
ls -la dist/Hangup-HR-* 2>/dev/null || ls -la dist/
