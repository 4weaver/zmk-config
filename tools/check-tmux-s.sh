#!/usr/bin/env bash
# Static structure check for ZMK-12 TMUX_S (observable without HID).
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
sofle="$root/config/eyelash_sofle.keymap"
lily="$root/config/lily58.keymap"
fail=0

check() {
  local file="$1" pat="$2" label="$3"
  if ! grep -qE -- "$pat" "$file"; then
    echo "FAIL: $label — missing /$pat/ in $(basename "$file")"
    fail=1
  fi
}

absent() {
  local file="$1" pat="$2" label="$3"
  if grep -qE -- "$pat" "$file"; then
    echo "FAIL: $label — found /$pat/ in $(basename "$file")"
    fail=1
  fi
}

for f in "$sofle" "$lily"; do
  check "$f" '#define U_TMUX_S 11' "U_TMUX_S 11"
  check "$f" '#define U_TMUX[[:space:]]+10' "U_TMUX 10 stays"
  check "$f" '&mo U_TMUX_S' "TMUX binds mo U_TMUX_S"
  check "$f" '&tm_split_right' "TMUX Y = tm_split_right"
  check "$f" '&tm_new_tab' "TMUX I = tm_new_tab"
  check "$f" '&tm_split_down' "TMUX_S Y = tm_split_down"
  check "$f" '&tm_close_pane' "TMUX_S I = tm_close_pane"
  absent "$f" 'tm_split:' "no tm_split morph node"
  absent "$f" 'tm_new_close:' "no tm_new_close morph node"
  absent "$f" '&tm_split([^_a-z]|$)' "no &tm_split binding"
  absent "$f" '&tm_new_close' "no &tm_new_close binding"
done

check "$sofle" '#define U_EYE1[[:space:]]+12' "Sofle U_EYE1 12"
check "$sofle" '#define U_EYE2[[:space:]]+13' "Sofle U_EYE2 13"

if [[ "$fail" -ne 0 ]]; then
  echo "check-tmux-s: FAILED"
  exit 1
fi
echo "check-tmux-s: OK"
