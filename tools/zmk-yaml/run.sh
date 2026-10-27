#!/usr/bin/env bash
# YAML <-> ZMK keymap tooling for BOTH boards (eyelash_sofle, lily58).  Read-only on the repo.
#   1. parse origin/main config/<board>.keymap -> baseline/<board>.yaml -> regenerate -> must be BYTE-IDENTICAL
#   2. keymaps/<board>.yaml (+ keymaps/common.yaml) -> out/<board>.keymap, semantic diff vs origin/main
# usage: bash tools/zmk-yaml/run.sh   (from repo root or this dir)
# Optional: ZMK_REPO=/path/to/zmk-config  (defaults to repo root = ../.. from this script)
set -euo pipefail
cd "$(dirname "$0")"
TOOL_DIR="$(pwd)"
REPO="${ZMK_REPO:-$TOOL_DIR/../..}"
REPO="$(cd "$REPO" && pwd)"

# Prefer deno on PATH; fall back to ~/.deno/bin without hardcoding an absolute install root.
if ! command -v deno >/dev/null 2>&1; then
  export PATH="${HOME:+$HOME/.deno/bin:}${PATH:-}"
fi
if ! command -v deno >/dev/null 2>&1; then
  echo "deno not found on PATH (install: https://deno.land)" >&2
  exit 127
fi

git -C "$REPO" fetch -q
export ORIGIN_COMMIT
ORIGIN_COMMIT=$(git -C "$REPO" rev-parse --short origin/main)
echo "origin/main = $ORIGIN_COMMIT (repo=$REPO)"
mkdir -p orig baseline out
# EXPECT_<board>: optional "LAYER=n,..." of intentional binding-cell diffs vs origin/main.
# Empty = keymaps/ should match main.
# Empty = keymaps/ should match main (tooling branch default after sync).
declare -A EXPECT=( [eyelash_sofle]="" [lily58]="" )
rc=0
for b in eyelash_sofle lily58; do
  echo "=== $b ==="
  git -C "$REPO" show "origin/main:config/$b.keymap" > "orig/$b.keymap"
  deno run -A parse.ts "$b" "orig/$b.keymap" "baseline/$b.yaml"
  deno run -A gen.ts "baseline/$b.yaml" "out/$b.baseline.keymap"
  if cmp -s "orig/$b.keymap" "out/$b.baseline.keymap"; then echo "BYTE-IDENTICAL round trip: orig/$b.keymap == out/$b.baseline.keymap"
  else echo "round trip NOT byte-identical for $b"; diff "orig/$b.keymap" "out/$b.baseline.keymap" | head -20 || true; rc=1; fi
  deno run -A gen.ts "keymaps/$b.yaml" "out/$b.keymap"
  diff -u "orig/$b.keymap" "out/$b.keymap" > "out/$b.diff" || true
  echo "diff vs origin/main: $(grep -c '^+[^+]' "out/$b.diff" || true) added, $(grep -c '^-[^-]' "out/$b.diff" || true) removed"
  if [ -n "${EXPECT[$b]}" ]; then
    deno run -A verify.ts "orig/$b.keymap" "out/$b.keymap" "${EXPECT[$b]}" | tail -3 || rc=1
  else
    deno run -A verify.ts "orig/$b.keymap" "out/$b.keymap" | tail -3 || rc=1
  fi
  if [ -f "$REPO/config/$b.keymap" ] && cmp -s "out/$b.keymap" "$REPO/config/$b.keymap"; then echo "out/$b.keymap == working-tree config/$b.keymap"; else echo "out/$b.keymap differs from working-tree config/$b.keymap"; fi
done
exit $rc
