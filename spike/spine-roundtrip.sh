#!/usr/bin/env bash
# Phase 0 spike (macOS/Linux): skeleton JSON -> .spine project -> exported JSON -> runtime check.
# Usage: SPINE_VERSION=4.3.xx ./spike/spine-roundtrip.sh
# Uses the Spine Editor already installed and activated on this machine. No license key is read here.
set -euo pipefail

SPINE_EXE="${SPINE_EXE:-/Applications/Spine.app/Contents/MacOS/Spine}"
SPINE_VERSION="${SPINE_VERSION:?set SPINE_VERSION, e.g. 4.3.xx (Help > About in Spine)}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
FIXTURE="$ROOT/spike/fixtures/swing"
OUT="$ROOT/spike/out"

rm -rf "$OUT" && mkdir -p "$OUT/export"

echo "== 1. import JSON into a new .spine project"
"$SPINE_EXE" -u "$SPINE_VERSION" -i "$FIXTURE/skeleton.json" -o "$OUT/swing.spine" -r swing

echo "== 2. export the project back to JSON"
"$SPINE_EXE" -u "$SPINE_VERSION" -i "$OUT/swing.spine" -o "$OUT/export" -e json

echo "== 3. load the exported JSON with the 4.3 runtime"
cp "$FIXTURE/swing.atlas" "$FIXTURE/swing.png" "$OUT/export/"
cp -r "$FIXTURE/images" "$OUT/export/"
EXPORTED="$(find "$OUT/export" -name '*.json' | head -n 1)"
(cd "$ROOT" && npx tsx spike/runtime-check.ts "$EXPORTED")

echo "== done. Open $OUT/swing.spine in Spine to check it visually."
