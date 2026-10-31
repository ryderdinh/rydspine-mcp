#!/bin/bash
# rydspine installer for macOS and Linux. Double-click it (macOS opens it in Terminal) or run it with bash.
# Downloads the code into ~/.rydspine/app, installs its packages, then runs the setup wizard (src/setup.ts).
# RYDSPINE_SOURCE=<local checkout> installs from a folder instead of GitHub; RYDSPINE_HOME moves ~/.rydspine.
set -e
REPO="${RYDSPINE_REPO:-ryderdinh/rydspine-mcp}"
REF="${RYDSPINE_REF:-main}"
BASE="${RYDSPINE_HOME:-$HOME/.rydspine}"
APP="$BASE/app"

finish() { echo; [ -t 0 ] && read -r -p "Nhấn Enter để đóng cửa sổ này. " _; true; }
trap finish EXIT
echo "rydspine — đang chuẩn bị..."

# Finder starts Terminal with a bare PATH: pick up nvm, Homebrew and the official Node installer.
export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh" >/dev/null 2>&1
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
if ! command -v node >/dev/null 2>&1 || [ "$(node -p 'process.versions.node.split(".")[0]')" -lt 20 ]; then
	echo "Cần Node.js 20 trở lên. Cài bản LTS ở https://nodejs.org rồi bấm đúp lại file này."
	(open https://nodejs.org/ || xdg-open https://nodejs.org/) >/dev/null 2>&1 || true
	exit 1
fi

mkdir -p "$BASE"
TMP="$(mktemp -d "$BASE/download.XXXXXX")"
if [ -n "$RYDSPINE_SOURCE" ]; then
	echo "Chép mã nguồn từ $RYDSPINE_SOURCE"
	rsync -a --exclude node_modules --exclude .git --exclude workspaces --exclude acceptance/out "$RYDSPINE_SOURCE/" "$TMP/"
else
	echo "Tải mã nguồn từ github.com/$REPO ($REF)"
	curl -fsSL "https://codeload.github.com/$REPO/tar.gz/$REF" | tar -xz -C "$TMP" --strip-components=1
fi
rm -rf "$APP"
mv "$TMP" "$APP"
cd "$APP"
echo "Cài thư viện (lần đầu mất khoảng một phút)..."
npm install --omit=dev --no-fund --no-audit --loglevel=error
node node_modules/tsx/dist/cli.mjs src/setup.ts "$@"
