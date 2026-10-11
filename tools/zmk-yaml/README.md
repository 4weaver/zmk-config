# zmk-yaml — YAML ↔ ZMK `.keymap` tooling

Deno scripts that parse `config/*.keymap` into editable YAML and regenerate
devicetree keymaps for **eyelash_sofle** and **lily58**. This directory is
tooling only: it does **not** change production `.keymap` files until you
explicitly copy regenerated output into `config/`.

## Layout

```
tools/zmk-yaml/
  parse.ts      # .keymap → YAML
  gen.ts        # YAML → .keymap
  lib.ts        # shared lexer/notation helpers
  verify.ts     # semantic layer-cell diff helper
  split.ts      # split monolithic YAML into common + board files
  run.sh        # round-trip check + generate from keymaps/
  keymaps/      # SOURCE YAML (edit these)
    common.yaml
    eyelash_sofle.yaml
    lily58.yaml
  orig/ baseline/ out/   # created by run.sh (gitignored locally; not committed)
```

## Requirements

- [Deno](https://deno.land) on `PATH` (scripts use `deno run -A …`)
- Git (to read `origin/main:config/<board>.keymap`)

Optional: `ZMK_REPO` pointing at the zmk-config repo root. Default is the
parent of `tools/` (i.e. this repo).

## Quick start

From the **repo root**:

```bash
bash tools/zmk-yaml/run.sh
```

Or from this directory:

```bash
bash run.sh
```

`run.sh` will:

1. Fetch `origin/main` and parse each board’s `config/<board>.keymap` → `baseline/`
2. Regenerate and assert a **byte-identical** round trip
3. Generate `out/<board>.keymap` from `keymaps/<board>.yaml` (+ `common.yaml`)
4. Diff / verify against `origin/main`

## Manual commands

```bash
cd tools/zmk-yaml

# Parse a keymap file to YAML
deno run -A parse.ts eyelash_sofle path/to/eyelash_sofle.keymap baseline/eyelash_sofle.yaml

# Generate .keymap from SOURCE YAML
deno run -A gen.ts keymaps/eyelash_sofle.yaml out/eyelash_sofle.keymap
deno run -A gen.ts keymaps/lily58.yaml out/lily58.keymap
```

## Regenerating production keymaps

This branch does **not** update `config/*.keymap`. When a keymap change is
ready:

1. Edit `keymaps/*.yaml` (and `common.yaml` for shared behaviors)
2. `bash tools/zmk-yaml/run.sh` (or `gen.ts` as above)
3. Review `out/<board>.diff` / `out/<board>.keymap`
4. Copy into place only when intentional:

   ```bash
   cp tools/zmk-yaml/out/eyelash_sofle.keymap config/eyelash_sofle.keymap
   cp tools/zmk-yaml/out/lily58.keymap config/lily58.keymap
   ```

Firmware CI (`.github/workflows/build.yml`) only builds `config/`; these Deno
scripts are not invoked by CI.

## Boards

| Board           | Matrix | SOURCE YAML                      |
|-----------------|--------|----------------------------------|
| eyelash_sofle   | 64     | `keymaps/eyelash_sofle.yaml`     |
| lily58          | 58     | `keymaps/lily58.yaml`            |

Shared macros, hold-taps, mod-morphs, aliases: `keymaps/common.yaml`
(`import: common.yaml` in each board file).
