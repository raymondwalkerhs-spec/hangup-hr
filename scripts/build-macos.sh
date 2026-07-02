#!/usr/bin/env bash
# Build Hangup HR for macOS (dmg + zip + .app bundles for in-app updates).
# Run on a Mac: ./scripts/build-macos.sh
set -euo pipefail
cd "$(dirname "$0")/.."

if [[ "$(uname)" != "Darwin" ]]; then
  echo "ERROR: macOS builds must run on Darwin (use GitHub Actions macos-latest otherwise)."
  exit 1
fi

if [[ ! -f credentials/service-account.json ]]; then
  if [[ "${SKIP_CREDENTIALS_CHECK:-}" == "1" || "${CI:-}" == "true" ]]; then
    mkdir -p credentials
    echo '{}' > credentials/service-account.json
    echo "WARNING: Using stub service-account.json (CI mode)."
  else
    echo "ERROR: credentials/service-account.json is missing."
    exit 1
  fi
fi

if [[ ! -f .env ]]; then
  if [[ -f .env.example ]]; then
    cp .env.example .env
    echo "WARNING: .env missing — copied from .env.example"
  else
    echo "ERROR: .env is missing."
    exit 1
  fi
fi

OUTPUT_DIR="${HR_BUILD_OUTPUT:-dist}"
export HR_BUILD_OUTPUT="$OUTPUT_DIR"

echo "Installing dependencies..."
npm install

echo "Rebuilding native modules for Electron..."
npm run rebuild:native

echo "Building macOS dmg + zip..."
npx electron-builder --mac dmg zip --config.directories.output="$OUTPUT_DIR"

echo ""
echo "Build complete. Output in ${OUTPUT_DIR}/"
ls -la "$OUTPUT_DIR"/*.dmg "$OUTPUT_DIR"/*.zip 2>/dev/null || true
find "$OUTPUT_DIR" -maxdepth 2 -name "*.app" -type d 2>/dev/null || true

echo ""
echo "Package update zips: npm run package:github -- --full"
