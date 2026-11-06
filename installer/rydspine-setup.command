#!/bin/bash
# rydspine installer for macOS and Linux. Double-click it (macOS opens it in Terminal) or run it with bash.
# Downloads the code into ~/.rydspine/app, installs its packages, then runs the setup wizard (src/setup.ts).
# RYDSPINE_SOURCE=<local checkout> installs from a folder instead of GitHub; RYDSPINE_HOME moves ~/.rydspine.
set -e
REPO="${RYDSPINE_REPO:-ryderdinh/rydspine-mcp}"
REF="${RYDSPINE_REF:-main}"
BASE="${RYDSPINE_HOME:-$HOME/.rydspine}"
APP="$BASE/app"

finish() { echo; [ -t 0 ] && read -r -p "Press Enter to close this window. " _; true; }
trap finish EXIT
echo "rydspine — getting ready..."

# Finder starts Terminal with a bare PATH: pick up nvm, Homebrew and the official Node installer.
export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh" >/dev/null 2>&1
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
if ! command -v node >/dev/null 2>&1 || [ "$(node -p 'process.versions.node.split(".")[0]')" -lt 20 ]; then
	echo "Node.js 20 or later is needed. Install the LTS version from https://nodejs.org, then double-click this file again."
	(open https://nodejs.org/ || xdg-open https://nodejs.org/) >/dev/null 2>&1 || true
	exit 1
fi

mkdir -p "$BASE"
TMP="$(mktemp -d "$BASE/download.XXXXXX")"
if [ -n "$RYDSPINE_SOURCE" ]; then
	echo "Copying the source from $RYDSPINE_SOURCE"
	rsync -a --exclude node_modules --exclude .git --exclude workspaces --exclude acceptance/out "$RYDSPINE_SOURCE/" "$TMP/"
else
	echo "Downloading the source from github.com/$REPO ($REF)"
	curl -fsSL "https://codeload.github.com/$REPO/tar.gz/$REF" | tar -xz -C "$TMP" --strip-components=1
fi
rm -rf "$APP"
mv "$TMP" "$APP"
cd "$APP"
echo "Installing packages (about a minute the first time)..."
npm install --omit=dev --no-fund --no-audit --loglevel=error
node node_modules/tsx/dist/cli.mjs src/setup.ts "$@"
