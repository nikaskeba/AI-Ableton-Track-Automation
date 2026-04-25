#!/bin/zsh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

/usr/bin/osascript - "$SCRIPT_DIR" <<'APPLESCRIPT'
on run argv
  set projectDir to item 1 of argv

  tell application "Terminal"
    activate
    do script "cd " & quoted form of projectDir & " && npm run api:dev"
    delay 0.3
    do script "cd " & quoted form of projectDir & " && npm run web:dev"
  end tell
end run
APPLESCRIPT
