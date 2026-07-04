#!/usr/bin/env bash
# Hangup HR — small bootstrap installer for macOS (downloads latest DMG from GitHub Releases).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if [[ -f .env ]]; then
  set -a
  # shellcheck disable=SC1091
  source <(grep -v '^\s*#' .env | grep -v '^\s*$' | sed 's/^/export /')
  set +a
fi

REPO="${GITHUB_UPDATES_REPO:-raymondwalkerhs-spec/hangup-hr}"
TOKEN="${GITHUB_UPDATES_TOKEN:-${GITHUB_TOKEN:-}}"
VERSION="${1:-}"

auth_header=()
if [[ -n "$TOKEN" ]]; then
  auth_header=(-H "Authorization: Bearer $TOKEN")
fi

if [[ -n "$VERSION" ]]; then
  TAG="v${VERSION#v}"
  API="https://api.github.com/repos/${REPO}/releases/tags/${TAG}"
else
  API="https://api.github.com/repos/${REPO}/releases/latest"
fi

echo ""
echo "Hangup HR — download installer from GitHub"
echo "Repository: $REPO"
echo ""

JSON=$(curl -fsSL "${auth_header[@]}" \
  -H "Accept: application/vnd.github+json" \
  -H "User-Agent: Hangup-HR-Web-Installer" \
  "$API")

TAG_NAME=$(echo "$JSON" | python3 -c "import sys,json; print(json.load(sys.stdin).get('tag_name',''))")
VER="${TAG_NAME#v}"
echo "Release: $TAG_NAME ($VER)"

ASSET=$(echo "$JSON" | python3 -c "
import sys, json, re
r = json.load(sys.stdin)
ver = sys.argv[1]
assets = r.get('assets') or []
for a in assets:
    n = a.get('name','')
    if n.endswith('.dmg') and ver in n:
        print(a['id'], n, a.get('size',0))
        break
else:
    for a in assets:
        n = a.get('name','')
        if n.endswith('.dmg'):
            print(a['id'], n, a.get('size',0))
            break
" "$VER")

if [[ -z "$ASSET" ]]; then
  echo "ERROR: No DMG on release $TAG_NAME" >&2
  exit 1
fi

read -r ASSET_ID ASSET_NAME ASSET_SIZE <<< "$ASSET"
SIZE_MB=$(python3 -c "print(round($ASSET_SIZE/1048576, 1))")
echo "Download: $ASSET_NAME (${SIZE_MB} MB)"

DEST_DIR="${TMPDIR:-/tmp}/hangup-hr-install"
mkdir -p "$DEST_DIR"
DEST="$DEST_DIR/$ASSET_NAME"

curl -fsSL "${auth_header[@]}" \
  -H "Accept: application/octet-stream" \
  -H "User-Agent: Hangup-HR-Web-Installer" \
  -o "$DEST" \
  "https://api.github.com/repos/${REPO}/releases/assets/${ASSET_ID}"

echo "Download complete."
echo "Opening DMG — drag Hangup HR to Applications."
open "$DEST"
