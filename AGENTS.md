# AGENTS.md

## Overview

ZMK configuration for an **Eyelash Sofle** (nice!nano v2, Nice!View on both halves, one encoder on the left, a 5-way hat on the right). The keymap is QWERTY. GASC home-row mods are on Base. Colemak-DH is not in this keymap.

The shield and ZMK source come from the vendor tree, not stock ZMK. `config/west.yml` pins Cormoran's `v0.3-branch+dya` plus that tree's modules, and pulls the shield from [a741725193/zmk-sofle](https://github.com/a741725193/zmk-sofle). Do not copy the shield into this repo.

`config/lily58.keymap` is the Silakka54 (54 keys, built as the upstream `lily58` shield). It is still in use and is built alongside the Sofle. It follows the Sofle's layers 0–11 at the same indices (including TMUX_S; no Eye1/Eye2); the header comment lists what did not fit.

## Repository Structure

```
.
├── config/
│   ├── west.yml                  # Cormoran ZMK fork + vendor shield module
│   ├── eyelash_sofle.keymap      # Keymap (devicetree)
│   ├── eyelash_sofle.conf        # Hardware Kconfig (sleep, encoder, RGB, pointing)
│   ├── lily58.keymap             # Silakka54 keymap (lily58 shield), built
│   └── lily58.conf               # Silakka54 Kconfig (pointing)
├── build.yaml                    # sofle left/right, lily58 left/right, settings_reset
├── Justfile
├── fetch-firmware.sh
└── .github/workflows/build.yml   # zmkfirmware build-user-config @v0.3.0
```

## Keymap

64 positions. Rows 0–3 are 6 + hat + 6. The bottom row is encoder click, five left thumbs, hat click, five right thumbs.

GASC, pinky to index on the left and mirrored on the right. Left mods on the left hand, right mods on the right. `u_mt` is tap-preferred, 250 ms, 120 ms prior-idle. G and H are plain. The outer Shift and Ctrl keys stay. The outer right column, top to bottom, is `-` `=` `'` `\` on Base and Tap (`=` on the r1 key, `'` and `\` on the two keys that used to be bare). Both boards.

| Finger | Left | Right | Mod |
|---|---|---|---|
| Pinky | A | ; | GUI |
| Ring | S | L | Alt |
| Middle | D | K | Shift |
| Index | F | J | Ctrl |

Thumbs, left outer to inner, then right inner to outer:

| Left | Right |
|---|---|
| spare (`&none`) | Enter, hold Symbols |
| spare (`&none`) | Backspace, hold Numbers |
| Esc | Delete, hold Fun |
| Space, hold Nav | Eyelash layer 1 |
| Tab, hold Tmux | Eyelash layer 2 |

### Layers

| Index | Name | Purpose |
|---|---|---|
| 0 | Base | QWERTY, GASC, thumb holds above |
| 1 | Tap | Same letters, no hold-taps. Double-tap Esc returns to Base |
| 2 | Button | Clipboard and mouse buttons |
| 3 | Nav | Arrows (HJKL), home/end (B/.), `{ }` on U/I and `[ ]` on N/M; Alt+Down/Up pages. Hold Space |
| 4 | Mouse | Mouse movement and scroll. Encoder scrolls here |
| 5 | Media | Media keys, Bluetooth profiles, output, bootloader |
| 6 | Num | Number pad. Hold Backspace |
| 7 | Sym | Symbols. Hold Enter |
| 8 | Fun | F-keys. Hold Delete. This is the old function layer, not the Eyelash one |
| 9 | WM | AeroSpace shortcuts. Nothing opens this layer |
| 10 | Tmux | tmux-style pane/tab actions (Ctrl-b prefix). Hold Tab |
| 11 | TmuxS | Shift-held TMUX actions (split down / close pane). Hold physical Shift on TMUX |
| 12 | Eye1 | Vendor lower layer: F-keys, mouse buttons, RGB. Outer right thumb |
| 13 | Eye2 | Vendor adjust layer: Bluetooth, USB/BLE, reset, bootloader. Outermost right thumb |

The hat sends arrows on Base and Tap, and mouse movement on Mouse, Eye1, and Eye2. Encoder click is mute. Encoder rotation is volume except on Mouse, where it scrolls.

Clipboard macros send Ctrl. TMUX macros send the Ctrl-b prefix as its own tap, then the action key, so they follow tmux defaults. Right hand: H/J/K/L move pane focus left/down/up/right (`C-b h/j/k/l`); Y splits right (`C-b %`); I opens a new tab (`C-b c`); B zooms the pane (`C-b z`); N/M go to the next/previous tab (`C-b n`/`C-b p`). While TMUX is held, the physical Shift key momentarily activates TMUX_S (and does not emit Shift): on TMUX_S, Y splits down (`C-b "`) and I closes the pane (`C-b x`). It works with tmux, herdr, zellij (with tmux bindings), and tern. herdr leaves the two split actions unset, so its `[keys]` config needs `split_vertical = "prefix+%"` and `split_horizontal = "prefix+\""` (see 4weaver/nixdots PR #2); the other keys match its defaults.

On the Nav layer, the Down and Up keys (home row J/K positions) send PgDn and PgUp while Alt is held (the `u_down_pg`/`u_up_pg` mod-morphs; Alt itself is not sent). Without Alt they are plain Down and Up.

## Build

GitHub Actions builds five UF2s: `eyelash_sofle_left`, `eyelash_sofle_right`, `lily58_left`, `lily58_right` (Silakka54), and `settings_reset`. Studio is on the left half only on both boards; locking is off on the Sofle and on (default) on the Silakka54, unlocked from its Media layer.

```
just fetch
just flash-left     # Mac path: /Volumes/NICENANO
just flash-right
```

On Linux the bootloader drive is `/run/media/$USER/NICENANO`, not `/Volumes/NICENANO`. Flash `settings_reset` on the right half, then the right firmware, then the same pair on the left. The `NICENANO` drive is write-only. Keep a copy of the vendor Actions artifact if you want their stock firmware back.

`just parse` and `just draw` read `config/eyelash_sofle.keymap` with `keymap-config.yaml`. The trainer (`just trainer-gen`, `trainer/tools/gen_board_eyelash.py`) also reads `config/eyelash_sofle.keymap` and writes `trainer/boards/eyelash-sofle.json`.
