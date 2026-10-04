#!/usr/bin/env python3
"""gen_board_eyelash.py — emit layer-tutor board declaration from eyelash_sofle.keymap.

Tutor consumes the declaration only (BOARD_INPUT.md / boardFromDeclaration).
Legend slots: L0 = BASE tap, L1 = NAV (hold Space), L2 = SYM (hold Enter).
Does not invent bindings: legends come from parsed &kp / &u_mt / &u_lt only.
Hat keys (center column arrows on BASE) are omitted so NAV arrows stay unique.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys

KP_LEGEND = {}
KP_LEGEND.update((c, c) for c in "QWERTYUIOPASDFGHJKLZXCVBNM")
KP_LEGEND.update(
    N1="1", N2="2", N3="3", N4="4", N5="5",
    N6="6", N7="7", N8="8", N9="9", N0="0",
    MINUS="-", EQUAL="=", COMMA=",", DOT=".", SLASH="/", SEMI=";",
    SQT="'", QUOTE="'",
    LBRC="{", RBRC="}", LBKT="[", RBKT="]", BSLH="\\", GRAVE="`",
    AMPS="&", ASTRK="*", LPAR="(", RPAR=")", TILDE="~", EXCL="!", AT="@",
    HASH="#", PIPE="|", DLLR="$", PRCNT="%", CARET="^", PLUS="+",
    COLON=":", UNDER="_", DQT='"',
    LEFT="\u2190", DOWN="\u2193", UP="\u2191", RIGHT="\u2192",
    HOME="\u21e4", END="\u21e5", PG_UP="\u21d1", PG_DN="\u21d3",
)
KP_LEGEND.update(
    ESC="Esc", TAB="Tab", SPACE="Space", RET="Enter", BSPC="Bspc", DEL="Del",
    LSHFT="Shift", RSHFT="Shift", LCTRL="Ctrl", RCTRL="Ctrl",
    LALT="Alt", RALT="Alt", LGUI="Win", RGUI="Win", CAPS="Caps",
    C_MUTE="Mute",
)

# Rows 0–3: 6 left + hat + 6 right. Row 4: 12 thumb/encoder slots.
ALPHA_LEFT, ALPHA_HAT, ALPHA_RIGHT = 6, 1, 6
THUMB_COUNT = 12
EXPECT = 4 * (ALPHA_LEFT + ALPHA_HAT + ALPHA_RIGHT) + THUMB_COUNT  # 64

# Tutor layer slots ← ZMK hold layer macros on BASE thumbs
HOLD_TO_TUTOR_LAYER = {
    "U_NAV": 1,
    "U_SYM": 2,
}

AVOID = {"trans", "none", "bootloader", "studio_unlock", "sys_reset", "soft_off"}


def strip_comments(text: str) -> str:
    return re.sub(r"/\*.*?\*/", "", text, flags=re.S)


def layer_block(text: str, name: str) -> str:
    m = re.search(rf"(?m)^\s*{re.escape(name)}\s*\{{", text)
    if not m:
        sys.exit(f"missing layer {name}")
    i = m.end()
    depth = 1
    while depth and i < len(text):
        c = text[i]
        if c == "{":
            depth += 1
        elif c == "}":
            depth -= 1
        i += 1
    return text[m.start():i]


def units_in(block: str) -> list[list[str]]:
    m = re.search(r"bindings\s*=\s*<(.*?)>\s*;", block, re.S)
    if not m:
        sys.exit("no bindings block found")
    units: list[list[str]] = []
    cur = None
    for tok in m.group(1).split():
        if tok.startswith("&"):
            cur = [tok]
            units.append(cur)
        elif cur is not None:
            cur.append(tok)
        else:
            units.append([tok])
    return units


def legend_of(unit: list[str]):
    """Return (slot0 legend or None, hold-layer name or None)."""
    if not unit or not unit[0].startswith("&"):
        return None, None
    kind = unit[0][1:]
    if kind in AVOID or kind.startswith("to") or kind.startswith("mo"):
        return None, None
    # macros / mouse / bt etc. — leave unknown
    if kind in ("mkp", "mmv", "msc", "bt", "out", "rgb_ug", "caps_word") or kind.startswith("u_to") or kind.startswith("u_bt") or kind.startswith("u_out") or kind.startswith("u_caps") or kind.startswith("u_macro") or kind.startswith("zj_"):
        return None, None
    args = unit[1:]
    if kind == "kp":
        if not args:
            return None, None
        # LC(X) / LA(X) chords — not a single typeable legend
        if "(" in args[0]:
            return None, None
        return KP_LEGEND.get(args[0]), None
    if kind in ("u_lt", "lt"):
        if len(args) >= 2:
            hold = args[0] if args[0].startswith("U_") else None
            tap = KP_LEGEND.get(args[-1])
            return tap, hold
        return None, None
    if kind in ("u_mt", "mt"):
        return KP_LEGEND.get(args[-1]) if args else None, None
    # NAV mod-morphs: Up/Down, or PgUp/PgDn with Alt held. Show the plain arrow.
    if kind == "u_up_pg":
        return KP_LEGEND["UP"], None
    if kind == "u_down_pg":
        return KP_LEGEND["DOWN"], None
    return None, None


def layer_legend(unit: list[str]):
    """Legend for a held layer cell (NAV / SYM): only plain &kp single keys."""
    leg, _ = legend_of(unit)
    return leg


def main() -> None:
    ap = argparse.ArgumentParser()
    here = os.path.dirname(os.path.abspath(__file__))
    ap.add_argument(
        "keymap",
        nargs="?",
        default=os.path.join(here, "..", "..", "config", "eyelash_sofle.keymap"),
    )
    ap.add_argument(
        "-o",
        "--out",
        default=os.path.join(here, "..", "boards", "eyelash-sofle.js"),
    )
    ap.add_argument(
        "--json",
        dest="json_out",
        default=None,
        help="Also write raw declaration JSON to this path",
    )
    args = ap.parse_args()

    text = strip_comments(open(args.keymap, encoding="utf-8").read())
    base_u = units_in(layer_block(text, "BASE"))
    nav_u = units_in(layer_block(text, "NAV"))
    sym_u = units_in(layer_block(text, "SYM"))
    if not (len(base_u) == len(nav_u) == len(sym_u) == EXPECT):
        sys.exit(
            f"unit count mismatch: BASE={len(base_u)} NAV={len(nav_u)} "
            f"SYM={len(sym_u)} expected {EXPECT}"
        )

    left_rows: list[list] = []
    right_rows: list[list] = []
    layer_hold: dict[str, str] = {}
    shift_ids: list[str] = []
    space_id = None
    unknown_holds: list[str] = []

    def emit_key(half: str, row_list: list, gi: int):
        nonlocal space_id
        l0, hold = legend_of(base_u[gi])
        l1 = layer_legend(nav_u[gi])
        l2 = layer_legend(sym_u[gi])
        if l0 is None and l1 is None and l2 is None and hold is None:
            return None
        key_id = f"{half}{len(left_rows if half == 'L' else right_rows)}{len(row_list)}"
        # Fix: row index must be current row being built — caller passes row_list
        # which is the current row; len(left_rows) is the row index before append.
        return None  # placeholder — real emit below

    # Alpha rows
    idx = 0
    for _ in range(4):
        lrow, rrow = [], []
        # left 6
        for c in range(ALPHA_LEFT):
            gi = idx + c
            l0, hold = legend_of(base_u[gi])
            l1 = layer_legend(nav_u[gi])
            l2 = layer_legend(sym_u[gi])
            if l0 is None and l1 is None and l2 is None and hold is None:
                continue
            key_id = f"L{len(left_rows)}{len(lrow)}"
            if hold in HOLD_TO_TUTOR_LAYER:
                layer_hold[str(HOLD_TO_TUTOR_LAYER[hold])] = key_id
            elif hold and hold.startswith("U_"):
                unknown_holds.append(f"{key_id}:{hold}")
            if l0 == "Shift":
                shift_ids.append(key_id)
            if l0 == "Space":
                space_id = key_id
            lrow.append([key_id, l0, l1, l2])
        # skip hat
        # right 6 (after hat)
        for c in range(ALPHA_RIGHT):
            gi = idx + ALPHA_LEFT + ALPHA_HAT + c
            l0, hold = legend_of(base_u[gi])
            l1 = layer_legend(nav_u[gi])
            l2 = layer_legend(sym_u[gi])
            if l0 is None and l1 is None and l2 is None and hold is None:
                continue
            key_id = f"R{len(right_rows)}{len(rrow)}"
            if hold in HOLD_TO_TUTOR_LAYER:
                layer_hold[str(HOLD_TO_TUTOR_LAYER[hold])] = key_id
            elif hold and hold.startswith("U_"):
                unknown_holds.append(f"{key_id}:{hold}")
            if l0 == "Shift":
                shift_ids.append(key_id)
            if l0 == "Space":
                space_id = key_id
            rrow.append([key_id, l0, l1, l2])
        left_rows.append(lrow)
        right_rows.append(rrow)
        idx += ALPHA_LEFT + ALPHA_HAT + ALPHA_RIGHT

    # Thumb row: enc, none, none, Esc, Space/Nav, Tab/Tmux | hat, Enter/Sym, Bspc/Num, Del/Fun, Eye1, Eye2
    thumb_left_idx = [3, 4, 5]   # Esc, Space, Tab (skip enc + two none)
    thumb_right_idx = [7, 8, 9]  # Enter, Bspc, Del (skip hat none; skip Eye mo)
    lrow, rrow = [], []
    for off in thumb_left_idx:
        gi = idx + off
        l0, hold = legend_of(base_u[gi])
        l1 = layer_legend(nav_u[gi])
        l2 = layer_legend(sym_u[gi])
        if l0 is None and l1 is None and l2 is None and hold is None:
            continue
        key_id = f"L{len(left_rows)}{len(lrow)}"
        if hold in HOLD_TO_TUTOR_LAYER:
            layer_hold[str(HOLD_TO_TUTOR_LAYER[hold])] = key_id
        elif hold and hold.startswith("U_"):
            unknown_holds.append(f"{key_id}:{hold}")
        if l0 == "Space":
            space_id = key_id
        if l0 == "Shift":
            shift_ids.append(key_id)
        lrow.append([key_id, l0, l1, l2])
    for off in thumb_right_idx:
        gi = idx + off
        l0, hold = legend_of(base_u[gi])
        l1 = layer_legend(nav_u[gi])
        l2 = layer_legend(sym_u[gi])
        if l0 is None and l1 is None and l2 is None and hold is None:
            continue
        key_id = f"R{len(right_rows)}{len(rrow)}"
        if hold in HOLD_TO_TUTOR_LAYER:
            layer_hold[str(HOLD_TO_TUTOR_LAYER[hold])] = key_id
        elif hold and hold.startswith("U_"):
            unknown_holds.append(f"{key_id}:{hold}")
        if l0 == "Space":
            space_id = key_id
        if l0 == "Shift":
            shift_ids.append(key_id)
        rrow.append([key_id, l0, l1, l2])
    left_rows.append(lrow)
    right_rows.append(rrow)

    # Geometry (Sofle-ish stagger, units in key-pitch "u")
    CO_L = [0.05, 0.15, 0.25, 0.35, 0.35, 0.45]
    CO_R = list(reversed(CO_L))
    positions = {}
    for half, rows in (("L", left_rows), ("R", right_rows)):
        for row_idx in range(4):
            for key in rows[row_idx]:
                col = int(key[0][2:])
                co = CO_L[min(col, 5)] if half == "L" else CO_R[min(col, 5)]
                x = col if half == "L" else col
                positions[key[0]] = {"x": x, "y": row_idx + co}
    # thumbs: Esc, Space, Tab / Enter, Bspc, Del
    THUMBS = {
        "L40": {"x": 2.4, "y": 4.35},
        "L41": {"x": 3.55, "y": 4.15, "w": 1.25, "h": 1.25},  # Space / Nav
        "L42": {"x": 4.85, "y": 4.35},
        "R40": {"x": 2.85, "y": 4.15, "w": 1.25, "h": 1.25},  # Enter / Sym
        "R41": {"x": 1.55, "y": 4.35},
        "R42": {"x": 0.4, "y": 4.45},
    }
    for key in left_rows[4] + right_rows[4]:
        if key[0] in THUMBS:
            positions[key[0]] = THUMBS[key[0]]

    # Home row: A S D F / H J K L → after emit, find by L0
    home_ids = []
    for want in list("ASDF"):
        for key in left_rows[2]:
            if key[1] == want:
                home_ids.append(key[0])
                break
    for want in list("HJKL"):
        for key in right_rows[2]:
            if key[1] == want:
                home_ids.append(key[0])
                break

    layer_hold_int = {int(k): v for k, v in layer_hold.items()}

    decl = {
        "id": "eyelash-sofle",
        "name": "Eyelash Sofle",
        "productName": "Eyelash Sofle (ZMK, QWERTY GASC)",
        "formFactor": "5-row split · Sofle + hat/encoder",
        "description": (
            "Eyelash Sofle from inogai/zmk-config: Space-hold Nav, Enter-hold Sym, "
            "Backspace-hold Num, Tab-hold Tmux, Delete-hold Fun. Tutor L1=Nav L2=Sym."
        ),
        "geometry": "eyelash-sofle",
        "vilPath": None,
        "comingSoon": False,
        "homeIds": home_ids,
        "positions": positions,
        "left": left_rows,
        "right": right_rows,
        "layerHold": layer_hold_int,
        "shiftKeys": shift_ids,
        "spaceKeyId": space_id,
        # Only pairs not already provided as Sym/Nav legends (digit-shift
        # !@#$… would overwrite Enter-hold Sym mappings in buildCharMap).
        "shiftedL0": {
            ":": ";",
            "<": ",",
            ">": ".",
            "?": "/",
            "_": "-",
        },
    }

    def emit_rows(rows):
        lines = []
        for row in rows:
            block = ["  ["]
            for key in row:
                block.append("    " + json.dumps(key, ensure_ascii=False) + ",")
            block.append("  ],")
            lines.append("\n".join(block))
        return "\n".join(lines)

    # JS module for the tutor (checked-in consumer)
    js = (
        "// Generated by zmk-config/trainer/tools/gen_board_eyelash.py — DO NOT EDIT BY HAND.\n"
        "// Board: Eyelash Sofle · L0=BASE, L1=NAV (hold Space), L2=SYM (hold Enter).\n"
        "// Source: config/eyelash_sofle.keymap\n"
        "import { boardFromDeclaration } from './buildLayout.js';\n\n"
        "const XX = null;\n\n"
        f"const LEFT = [\n{emit_rows(left_rows)}\n];\n\n"
        f"const RIGHT = [\n{emit_rows(right_rows)}\n];\n\n"
        "/** @type {Parameters<typeof boardFromDeclaration>[0]} */\n"
        "const decl = {\n"
        "  id: 'eyelash-sofle',\n"
        "  name: 'Eyelash Sofle',\n"
        "  productName: 'Eyelash Sofle (ZMK, QWERTY GASC)',\n"
        "  formFactor: '5-row split · Sofle + hat/encoder',\n"
        "  description: 'Space-hold Nav, Enter-hold Sym; digits on base number row; GASC home-row mods.',\n"
        "  geometry: 'eyelash-sofle',\n"
        "  vilPath: null,\n"
        "  comingSoon: false,\n"
        f"  homeIds: {json.dumps(home_ids)},\n"
        f"  positions: {json.dumps(positions)},\n"
        "  left: LEFT,\n"
        "  right: RIGHT,\n"
        f"  layerHold: {json.dumps(layer_hold_int)},\n"
        f"  shiftKeys: {json.dumps(shift_ids)},\n"
        f"  spaceKeyId: {json.dumps(space_id)},\n"
        "  shiftedL0: {\n"
        "    ':': ';', '<': ',', '>': '.', '?': '/', '_': '-',\n"
        "  },\n"
        "};\n\n"
        "export const board = boardFromDeclaration(decl);\n"
        "export default board;\n"
    )

    os.makedirs(os.path.dirname(os.path.abspath(args.out)) or ".", exist_ok=True)
    with open(args.out, "w", encoding="utf-8") as f:
        f.write(js)

    if args.json_out:
        os.makedirs(os.path.dirname(os.path.abspath(args.json_out)) or ".", exist_ok=True)
        with open(args.json_out, "w", encoding="utf-8") as f:
            json.dump(decl, f, ensure_ascii=False, indent=2)
            f.write("\n")

    print(
        f"wrote {args.out}: hold={layer_hold_int} shift={shift_ids} "
        f"space={space_id} home={home_ids} unknown_holds={unknown_holds}"
    )
    # Sanity: Space→Nav and Enter→Sym must be present
    if layer_hold_int.get(1) is None:
        sys.exit("failed to find U_NAV hold (Space)")
    if layer_hold_int.get(2) is None:
        sys.exit("failed to find U_SYM hold (Enter)")


if __name__ == "__main__":
    main()
