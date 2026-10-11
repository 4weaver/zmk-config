// parse.ts — .keymap (ZMK devicetree) -> keymap.yaml
import { parse as parseYaml } from "jsr:@std/yaml@1";
import {
  Ctx, emitYaml, fromNotation, newCtx, qk, qs, rawText, RawBinding, splitTop, tokenizeBindings, toNotation,
} from "./lib.ts";

// Repo root = parent of tools/zmk-yaml/ (this script's directory).
const TOOL_DIR = new URL(".", import.meta.url).pathname.replace(/\/$/, "");
const REPO = Deno.env.get("ZMK_REPO") ?? `${TOOL_DIR}/../..`;
async function git(...a: string[]) {
  const o = await new Deno.Command("git", { args: ["-C", REPO, ...a] }).output();
  if (!o.success) throw new Error(new TextDecoder().decode(o.stderr));
  return new TextDecoder().decode(o.stdout).trim();
}
// usage: deno run -A parse.ts <board> [in.keymap] [out.yaml]      board = eyelash_sofle | lily58
//   default input: `git show origin/main:config/<board>.keymap` (read-only on the repo)
const BOARD = Deno.args[0];
if (BOARD !== "eyelash_sofle" && BOARD !== "lily58") throw new Error("board must be eyelash_sofle or lily58");
const inFile = Deno.args[1];
const outFile = Deno.args[2] ?? `${TOOL_DIR}/baseline/${BOARD}.yaml`;
const src = inFile ? await Deno.readTextFile(inFile) : await git("show", `origin/main:config/${BOARD}.keymap`);
const commit = Deno.env.get("ORIGIN_COMMIT") ?? (inFile ? "file:" + inFile : await git("rev-parse", "--short", "origin/main"));

// ------------------------------------------------------------ lexer
type Tok = { t: string; v: string; s: number; e: number };
function lex(s: string): Tok[] {
  const toks: Tok[] = []; let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (/\s/.test(c)) { i++; continue; }
    if (s.startsWith("/*", i)) { const j = s.indexOf("*/", i + 2); toks.push({ t: "comment", v: s.slice(i + 2, j), s: i, e: j + 2 }); i = j + 2; continue; }
    if (s.startsWith("//", i)) { let j = s.indexOf("\n", i); if (j < 0) j = s.length; toks.push({ t: "comment", v: s.slice(i + 2, j), s: i, e: j }); i = j; continue; }
    if (c === "#" && /^#(define|include|if|ifdef|ifndef|endif|else|undef)\b/.test(s.slice(i, i + 9))) {
      let j = s.indexOf("\n", i); if (j < 0) j = s.length; toks.push({ t: "pp", v: s.slice(i, j).trim(), s: i, e: j }); i = j; continue;
    }
    if (c === '"') { const j = s.indexOf('"', i + 1); toks.push({ t: "str", v: s.slice(i + 1, j), s: i, e: j + 1 }); i = j + 1; continue; }
    if (c === "<") { const j = s.indexOf(">", i); toks.push({ t: "cells", v: s.slice(i + 1, j), s: i, e: j + 1 }); i = j + 1; continue; }
    if ("{};:=,".includes(c)) { toks.push({ t: "p", v: c, s: i, e: i + 1 }); i++; continue; }
    const m = /[^\s{};:=,<>"]+/y; m.lastIndex = i; const r = m.exec(s)!;
    toks.push({ t: "id", v: r[0], s: i, e: i + r[0].length }); i += r[0].length;
  }
  return toks;
}

// ------------------------------------------------------------ DT parser
interface Prop { kind: "prop"; name: string; vals: Tok[]; s: number; e: number }
interface Node { kind: "node"; label?: string; name: string; items: Item[]; s: number; s0: number; e: number; comments: string[]; blank: boolean }
interface Pp { kind: "pp"; v: string; s: number; e: number }
interface Banner { kind: "banner"; title: string }
type Item = Prop | Node | Pp | Banner;

const toks = lex(src);
let pos = 0;
const cleanComment = (v: string) => v.split("\n").map((l) => l.trim()).join("\n").trim();
function parseBody(start = 0): Item[] {
  const items: Item[] = []; let pend: { text: string; s: number }[] = [];
  let prevEnd = start; // end offset of the previous sibling item (or of the opening brace)
  while (pos < toks.length) {
    const t = toks[pos];
    if (t.t === "p" && t.v === "}") break;
    if (t.t === "comment") {
      pos++;
      const txt = cleanComment(t.v);
      const bm = txt.match(/^─+ (.+?) ─+$/);
      if (bm) { items.push({ kind: "banner", title: bm[1] }); prevEnd = t.e; } else pend.push({ text: txt, s: t.s });
      continue;
    }
    if (t.t === "pp") { items.push({ kind: "pp", v: t.v, s: t.s, e: t.e }); prevEnd = t.e; pos++; pend = []; continue; }
    // node or prop
    const s = t.s; let label: string | undefined; let name = t.v; pos++;
    if (toks[pos].v === ":" && toks[pos].t === "p") { label = name; name = toks[pos + 1].v; pos += 2; }
    if (toks[pos].t === "p" && toks[pos].v === "{") {
      const open = toks[pos]; pos++; const sub = parseBody(open.e); const close = toks[pos]; pos++; // }
      const semi = toks[pos]; pos++; // ;
      const s0 = pend.length ? pend[0].s : s;
      items.push({ kind: "node", label, name, items: sub, s, s0, e: semi.e, comments: pend.map((p) => p.text), blank: /\n[ \t]*\n/.test(src.slice(prevEnd, s0)) });
      prevEnd = semi.e;
    } else {
      const vals: Tok[] = [];
      if (toks[pos].v === "=" && toks[pos].t === "p") { pos++; while (!(toks[pos].t === "p" && toks[pos].v === ";")) vals.push(toks[pos++]); }
      const semi = toks[pos]; pos++;
      items.push({ kind: "prop", name, vals, s, e: semi.e }); prevEnd = semi.e;
    }
    pend = [];
  }
  return items;
}
const top = parseBody();

// ------------------------------------------------------------ helpers
const lineStart = (i: number) => src.lastIndexOf("\n", i - 1) + 1;
function rawSlice(from: number, to: number): string {
  const col = from - lineStart(from);
  const lines = src.slice(from, to).split("\n");
  return lines.map((l, i) => i === 0 ? l : l.replace(new RegExp(`^ {0,${col}}`), "")).join("\n").replace(/[ \t]+$/gm, "");
}
const asNode = (i: Item): Node => { if (i.kind !== "node") throw new Error("expected node: " + JSON.stringify(i).slice(0, 80)); return i; };
function props(n: Node): Map<string, Prop> {
  const m = new Map<string, Prop>();
  for (const i of n.items) if (i.kind === "prop") m.set(i.name, i);
  return m;
}
const valStr = (p?: Prop) => p ? p.vals.map((v) => v.t === "str" ? v.v : v.v).join("") : undefined;
const valInt = (p?: Prop) => p ? parseInt(p.vals[0].v.trim(), 10) : undefined;
const valRaw = (p: Prop) => src.slice(p.vals[0].s, p.vals[p.vals.length - 1].e);
const cellGroups = (p: Prop) => p.vals.filter((v) => v.t === "cells").map((v) => v.v);

// ------------------------------------------------------------ top-level classification
const raw = {
  header: "", defines: [] as string[], overrides: [] as string[],
  root_nodes: [] as string[], behavior_nodes: [] as string[], macro_nodes: [] as string[],
};
const lastInclude = top.filter((i) => i.kind === "pp" && i.v.startsWith("#include")).pop() as Pp;
raw.header = src.slice(0, lastInclude.e).replace(/[ \t]+$/gm, "").trim();

const layerDefs: { name: string; value: number }[] = [];
const aliasDefs: { group: string; name: string; text: string }[] = [];
const rootNodes: Node[] = [];
let section = "";
for (const it of top) {
  if (it.kind === "banner") { section = it.title; continue; }
  if (it.kind === "pp") {
    if (it.v.startsWith("#include")) continue;
    const m = it.v.match(/^#define\s+(\S+)\s+(.*)$/);
    if (!m) { raw.defines.push(it.v); continue; }
    const [, nm, val] = m;
    if (/^U_/.test(nm) && /^\d+$/.test(val.trim())) layerDefs.push({ name: nm.slice(2), value: +val });
    else if (nm.startsWith("U_") && val.trim().startsWith("&")) aliasDefs.push({ group: section, name: nm, text: val.trim() });
    else raw.defines.push(it.v);
    continue;
  }
  if (it.kind === "node") {
    if (it.name.startsWith("&")) { raw.overrides.push(rawSlice(it.s, it.e)); continue; }
    if (it.name === "/") { rootNodes.push(it); continue; }
  }
  throw new Error("unhandled top-level item " + JSON.stringify(it).slice(0, 100));
}

// ------------------------------------------------------------ root children
const macroNodes: Node[] = [], htNodes: Node[] = [], morphNodes: Node[] = [], danceNodes: Node[] = [];
let keymapNode: Node | undefined;
for (const r of rootNodes) for (const ch of r.items) {
  if (ch.kind === "prop") { if (ch.name !== "") throw new Error("root prop " + ch.name); continue; }
  const n = asNode(ch);
  if (n.name === "macros") {
    for (const m of n.items) { const mn = asNode(m);
      if (valStr(props(mn).get("compatible")) === "zmk,behavior-macro") macroNodes.push(mn);
      else raw.macro_nodes.push(rawSlice(mn.s0, mn.e)); }
  } else if (n.name === "behaviors") {
    for (const m of n.items) { const bn = asNode(m); const c = valStr(props(bn).get("compatible"));
      if (c === "zmk,behavior-hold-tap") htNodes.push(bn);
      else if (c === "zmk,behavior-mod-morph") morphNodes.push(bn);
      else if (c === "zmk,behavior-tap-dance") danceNodes.push(bn);
      else raw.behavior_nodes.push(rawSlice(bn.s0, bn.e)); }
  } else if (n.name === "keymap") keymapNode = n;
  else raw.root_nodes.push(rawSlice(n.s0, n.e)); // e.g. scroll_enc sensor-rotate, combos, ...
}
if (!keymapNode) throw new Error("no keymap node");
const layerNodes = keymapNode.items.filter((i) => i.kind === "node").map((i) => i as Node);
const BANNER_WIDTH = (src.match(/^\/\* ── .* ─+ \*\/$/m) ?? ["".padEnd(69)])[0].length;
const layerNames = layerNodes.map((n) => n.name);

// layer defines: must be the same order/index as the keymap nodes
layerNames.forEach((nm, i) => {
  const d = layerDefs.find((x) => x.name === nm);
  if (!d || d.value !== i) throw new Error(`layer define mismatch for ${nm}`);
});
for (const d of layerDefs) if (!layerNames.includes(d.name)) { raw.defines.push(`#define U_${d.name} ${d.value}`); }

// ------------------------------------------------------------ context
const ctx: Ctx = newCtx();
layerNames.forEach((n) => ctx.layers.add(n));
macroNodes.forEach((n) => ctx.macros.add(n.name));
morphNodes.forEach((n) => ctx.morphs.add(n.name));
danceNodes.forEach((n) => ctx.dances.add(n.name));
aliasDefs.forEach((a) => ctx.aliases.add(a.name));
const stripNodeU = (n: string) => n.replace(/^u_/, "");
function holdTapPair(n: Node) {
  const groups = cellGroups(props(n).get("bindings")!).map((g) => tokenizeBindings(g, ctx.aliases));
  // split: <&hold>, <&tap>  |  joined (required for #binding-cells = <0>): <&hold &tap>
  let holdB: RawBinding, tapB: RawBinding;
  if (groups.length === 2 && groups.every((g) => g.length === 1)) {
    holdB = groups[0][0]; tapB = groups[1][0];
  } else if (groups.length === 1 && groups[0].length === 2) {
    holdB = groups[0][0]; tapB = groups[0][1];
  } else {
    throw new Error("hold-tap bindings " + n.name);
  }
  return { holdB, tapB };
}
for (const n of htNodes) {
  const { holdB, tapB } = holdTapPair(n);
  const cells = valInt(props(n).get("#binding-cells"));
  // Param-bearing hold/tap bindings are only valid for #binding-cells = <0> (baked-in params).
  if (cells !== 0 && (holdB.args.length || tapB.args.length)) throw new Error("hold-tap bindings " + n.name);
  const alias = stripNodeU(n.name);
  if (ctx.holdtaps.has(alias)) throw new Error("duplicate hold-tap alias " + alias);
  ctx.holdtaps.set(alias, { node: n.name, hold: holdB.name, tap: tapB.name });
  if (cells === 0) ctx.zeroArg.add(n.name);
}

// strict round-trip guarded converter
function conv(text: string): string[] {
  return tokenizeBindings(text, ctx.aliases).map((b) => {
    const nt = toNotation(b, ctx);
    const back = fromNotation(nt, ctx);
    if (back !== rawText(b)) throw new Error(`notation not reversible: ${rawText(b)} -> ${nt} -> ${back}`);
    return nt;
  });
}
const lastOf = (a: Prop | undefined, text: string) => text;

// known-props helper: returns extra (unmodeled) props as raw strings
function extras(n: Node, known: string[], cells?: number): Record<string, string> | undefined {
  const ex: Record<string, string> = {};
  for (const [k, p] of props(n)) {
    if (known.includes(k)) continue;
    if (k === "#binding-cells") { if (valInt(p) !== cells) ex[k] = valRaw(p); continue; }
    ex[k] = p.vals.length ? valRaw(p) : "";
  }
  return Object.keys(ex).length ? ex : undefined;
}
// cell grouping style of the bindings property: macros default 'joined' (<&a &b>), others 'split' (<&a>, <&b>)
function groupStyle(n: Node, dflt: "joined" | "split"): string | undefined {
  const g = cellGroups(props(n).get("bindings")!).length;
  const style = g > 1 ? "split" : "joined";
  return style === dflt ? undefined : style;
}
const comments = (n: Node) => n.comments.length ? n.comments : undefined;
const blank = (n: Node) => n.blank ? true : undefined; // blank line before this node (incl. its comment block)
function ownLabel(n: Node) { if (n.label && n.label !== n.name) throw new Error("label != name on " + n.name); }

// ------------------------------------------------------------ definition tables
const macros: Record<string, unknown> = {};
for (const n of macroNodes) {
  ownLabel(n); const p = props(n);
  if (valStr(p.get("compatible")) !== "zmk,behavior-macro") throw 0;
  macros[n.name] = {
    blank_before: blank(n), comments: comments(n), wait_ms: valInt(p.get("wait-ms")), tap_ms: valInt(p.get("tap-ms")),
    bindings: conv(cellGroups(p.get("bindings")!).join(" ")), cell_groups: groupStyle(n, "joined"),
    extra: extras(n, ["compatible", "wait-ms", "tap-ms", "bindings"], 0),
  };
}
const hold_taps: Record<string, unknown> = {};
for (const n of htNodes) {
  ownLabel(n); const p = props(n); const alias = stripNodeU(n.name); const h = ctx.holdtaps.get(alias)!;
  const cells = valInt(p.get("#binding-cells"));
  const { holdB, tapB } = holdTapPair(n);
  const base: Record<string, unknown> = {
    node: n.name, blank_before: blank(n), comments: comments(n),
    tapping_term_ms: valInt(p.get("tapping-term-ms")), require_prior_idle_ms: valInt(p.get("require-prior-idle-ms")),
    flavor: valStr(p.get("flavor")), hold: h.hold, tap: h.tap,
  };
  if (cells === 0) {
    hold_taps[alias] = {
      ...base, binding_cells: 0,
      hold_binding: toNotation(holdB, ctx), tap_binding: toNotation(tapB, ctx),
      extra: extras(n, ["compatible", "tapping-term-ms", "require-prior-idle-ms", "flavor", "bindings"], 0),
    };
  } else {
    hold_taps[alias] = {
      ...base,
      extra: extras(n, ["compatible", "tapping-term-ms", "require-prior-idle-ms", "flavor", "bindings"], 2),
    };
  }
}
const mod_morphs: Record<string, unknown> = {};
for (const n of morphNodes) {
  ownLabel(n); const p = props(n);
  const b = conv(cellGroups(p.get("bindings")!).join(" ")); if (b.length !== 2) throw new Error("morph bindings");
  const mm = cellGroups(p.get("mods")!)[0].trim().match(/^\(?([A-Z_|\s]+?)\)?$/);
  let mods: string[] | undefined = mm ? mm[1].split("|").map((x) => x.trim()) : undefined;
  if (mods && !mods.every((x) => x.startsWith("MOD_"))) mods = undefined;
  const ex = extras(n, ["compatible", "bindings", ...(mods ? ["mods"] : [])], 0) ?? {};
  if (!mods) ex["mods"] = valRaw(p.get("mods")!);
  mod_morphs[n.name] = {
    blank_before: blank(n), comments: comments(n), normal: b[0], morphed: b[1], mods: mods?.map((x) => x.slice(4)), cell_groups: groupStyle(n, "split"),
    extra: Object.keys(ex).length ? ex : undefined,
  };
}
const tap_dances: Record<string, unknown> = {};
for (const n of danceNodes) {
  ownLabel(n); const p = props(n);
  tap_dances[n.name] = {
    blank_before: blank(n), comments: comments(n), tapping_term_ms: valInt(p.get("tapping-term-ms")),
    bindings: conv(cellGroups(p.get("bindings")!).join(" ")), cell_groups: groupStyle(n, "split"),
    extra: extras(n, ["compatible", "tapping-term-ms", "bindings"], 0),
  };
}
const aliasGroups: Record<string, Record<string, string>> = {};
for (const a of aliasDefs) {
  const g = a.group || "aliases";
  (aliasGroups[g] ??= {})[a.name] = conv(a.text)[0];
}
const aliases = Object.entries(aliasGroups).map(([title, defs]) => ({ title, defs }));

// ------------------------------------------------------------ layout / names
const ROWS = ["num", "upper", "home", "lower", "thumb"] as const;
// per board and row: [#left, #mid, #right] keys, in matrix order  L..., mid..., R...
//   mid = the centre column: 4-way hat on the Sofle; unfitted (always &none) slots on the lily58
const SHAPE: Record<string, number[][]> = {
  eyelash_sofle: [[6, 1, 6], [6, 1, 6], [6, 1, 6], [6, 1, 6], [6, 1, 5]],
  lily58: [[6, 0, 6], [6, 0, 6], [6, 0, 6], [6, 2, 6], [3, 2, 3]],
};
const shape = SHAPE[BOARD];
const ROW_LEN = shape.map(([l, m, r]) => l + m + r);
const NKEYS = ROW_LEN.reduce((x, y) => x + y, 0);
const HAT = ["hat-up", "hat-down", "hat-left", "hat-right", "hat-click"];
// left col index 0..5 (outer -> inner), right col 0..5 (inner -> outer)
const LCOL = [["far", "pinky"], [null, "pinky"], [null, "ring"], [null, "middle"], [null, "index"], ["inner", "index"]] as const;
const RCOL = [["inner", "index"], [null, "index"], [null, "middle"], [null, "ring"], [null, "pinky"], ["far", "pinky"]] as const;
const colName = (row: string, c: readonly [string | null, string]) =>
  c[0] === "far" ? `far-${row}-${c[1]}` : c[0] === "inner" ? `${row}-inner` : `${row}-${c[1]}`;

const KEYNAME: Record<string, string> = {
  GRAVE: "`", MINUS: "-", EQUAL: "=", SQT: "'", SEMI: ";", COMMA: ",", DOT: ".", SLASH: "/", BSLH: "\\",
  TAB: "tab", LSHFT: "lshift", LCTRL: "lctrl", ESC: "esc", SPACE: "space", RET: "ret", BSPC: "bspc", DEL: "del",
};
for (let i = 0; i <= 9; i++) KEYNAME["N" + i] = String(i);
function keyName(k: string): string { return KEYNAME[k] ?? (/^[A-Z]$/.test(k) ? k.toLowerCase() : k.toLowerCase()); }

const baseNode = layerNodes.find((n) => n.name === "BASE") ?? layerNodes[0];
const layerBindings = (n: Node) => {
  const p = props(n);
  const b = conv(cellGroups(p.get("bindings")!).join(" "));
  if (b.length !== NKEYS) throw new Error(`layer ${n.name}: ${b.length} bindings`);
  // sanity: per-source-line counts match the board's row lengths
  const txt = cellGroups(p.get("bindings")!)[0].split("\n").map((l) => l.trim()).filter(Boolean);
  const per = txt.map((l) => tokenizeBindings(l, ctx.aliases).length);
  if (per.join() !== ROW_LEN.join()) throw new Error(`layer ${n.name}: row lengths ${per}`);
  return b;
};
const baseB = layerBindings(baseNode);
// base-layer name of a notation string: tap key
function baseKey(nt: string): string {
  const m = nt.match(/^([A-Za-z_]\w*)\((.*)\)$/);
  if (m && ctx.holdtaps.has(m[1])) { const a = splitTop(m[2]); return a[a.length - 1]; }
  return nt;
}
// flat index -> {row, side, col}
interface Slot { row: number; side: "L" | "mid" | "R"; col: number; flat: number }
const slots: Slot[] = [];
{
  let f = 0;
  shape.forEach(([nl, nm, nr], r) => {
    for (let c = 0; c < nl; c++) slots.push({ row: r, side: "L", col: c, flat: f++ });
    for (let c = 0; c < nm; c++) slots.push({ row: r, side: "mid", col: c, flat: f++ });
    for (let c = 0; c < nr; c++) slots.push({ row: r, side: "R", col: c, flat: f++ });
  });
}
const names: string[] = [];
const positions: Record<string, unknown> = {};
slots.forEach((s) => {
  let nm: string, p: Record<string, unknown>;
  const rn = ROWS[s.row];
  const typing = (c: readonly [string | null, string]) => ({ pos: colName(rn, c), hand: s.side, finger: c[1] });
  if (s.row < 4 && s.side !== "mid") {
    nm = keyName(baseKey(baseB[s.flat])); p = typing((s.side === "L" ? LCOL : RCOL)[s.col]);
  } else if (BOARD === "eyelash_sofle") {
    if (s.row < 4) { nm = HAT[s.row]; p = { pos: nm, hand: "C", finger: "hat" }; }
    else if (s.side === "mid") { nm = HAT[4]; p = { pos: "hat-click", hand: "C", finger: "hat" }; }
    else if (s.side === "L" && s.col === 0) { nm = "enc"; p = { pos: "encoder-click", hand: "L", finger: "encoder" }; }
    else if (s.side === "L") { const k = 6 - s.col; nm = `th-l${k}`; p = { pos: `thumb-${k}`, hand: "L", finger: "thumb" }; }
    else { const k = s.col + 1; nm = `th-r${k}`; p = { pos: `thumb-${k}`, hand: "R", finger: "thumb" }; }
  } else { // lily58: 3 row-3 slots / thumbs are physically absent (Silakka54 has 54 of the 58 keys)
    const side = s.col === 0 ? "L" : "R";
    if (s.row < 4) { nm = `nofit-${rn}-${side.toLowerCase()}`; p = { pos: nm, hand: side, finger: "inner" }; }
    else if (s.side === "mid") { nm = `th-${side.toLowerCase()}1`; p = { pos: "thumb-1", hand: side, finger: "thumb" }; }
    else if (s.side === "L") { const k = 4 - s.col; nm = `th-l${k}`; p = { pos: `thumb-${k}`, hand: "L", finger: "thumb" }; }
    else { const k = s.col + 2; nm = `th-r${k}`; p = { pos: `thumb-${k}`, hand: "R", finger: "thumb" }; }
  }
  const unfitted = BOARD === "lily58" && s.side === "mid";
  if (positions[nm]) throw new Error("duplicate coordinate name " + nm);
  names.push(nm);
  const col = s.side === "R" ? "R" + (s.col + 1) : s.side === "L" ? "L" + (s.col + 1) : BOARD === "lily58" ? "M" + (s.col + 1) : "hat";
  positions[nm] = { ...p, row: rn, col, matrix: s.flat, ...(unfitted ? { unfitted: true } : {}) };
});

// grid <-> flat
type Row = { L: string[]; mid?: string[]; R: string[] };
function toRows(flat: string[]): Record<string, Row> {
  const out: Record<string, Row> = {};
  for (let r = 0; r < ROWS.length; r++) {
    const row: Row = { L: [], mid: [], R: [] };
    slots.filter((s) => s.row === r).forEach((s) => { const v = flat[s.flat]; (s.side === "L" ? row.L : s.side === "mid" ? row.mid! : row.R).push(v); });
    if (!row.mid!.length) delete row.mid;
    out[ROWS[r]] = row;
  }
  return out;
}

// ------------------------------------------------------------ layers
// formatting trivia: per layer, one pattern per source row where every binding is replaced by "_"
// (so the exact whitespace between bindings is kept, incl. the extra gap around the hat column).
const layer_rows: Record<string, string[]> = {};
const layers: Record<string, unknown> = {};
function rowPatterns(n: Node): string[] {
  const text = cellGroups(props(n).get("bindings")!)[0];
  return text.split("\n").filter((l) => l.trim() !== "").map((l) => {
    let out = "", first = true;
    for (const m of l.matchAll(/(\s*)(\S+)/g)) {
      const tok = m[2];
      if (tok.startsWith("&") || ctx.aliases.has(tok)) { out += m[1] + "_"; first = false; }
      else if (first) throw new Error("dangling arg " + tok);
      else out += ""; // argument: part of the previous binding
    }
    return out;
  });
}
layerNodes.forEach((n, i) => {
  ownLabel(n); const p = props(n);
  const cm = n.comments.map((c) => c.replace(/^\d+:\s*/, ""));
  const sens = p.get("sensor-bindings");
  const extra = extras(n, ["bindings", "display-name", "sensor-bindings"]);
  layer_rows[n.name] = rowPatterns(n);
  layers[n.name] = {
    index: i, display_name: valStr(p.get("display-name")), comments: cm.length ? cm : undefined,
    sensor: sens ? conv(cellGroups(sens).join(" ")) : undefined,
    extra,
    rows: toRows(layerBindings(n)),
  };
});

// ------------------------------------------------------------ assemble
const data = {
  meta: { board: BOARD, source: `config/${BOARD}.keymap`, origin_main: commit, matrix_positions: NKEYS, generated_by: "parse.ts" },
  layout: toRows(names),
  positions,
  layers,
  aliases,
  macros, hold_taps, mod_morphs, tap_dances,
  zero_arg_behaviors: [...ctx.zeroArg],
  raw,
  fmt: { banner_width: BANNER_WIDTH, layer_rows },
};
// strip undefined deep (for deepEqual with parsed YAML)
const clean = (v: unknown): unknown => JSON.parse(JSON.stringify(v));
const dataC = clean(data) as typeof data;

// ------------------------------------------------------------ YAML output
const GRID_DOC: Record<string, string> = {
  eyelash_sofle: `# PHYSICAL GRID (64 matrix positions, listed in matrix order)
#   rows : num / upper / home / lower (13 keys each) + thumb (12 keys)
#   each row = { L: [6 keys, outer -> inner], mid: [centre hat key], R: [6 keys, inner -> outer] }
#   thumb row: L = [enc, th-l5 .. th-l1]  (enc = encoder click, outermost left)
#              R = [th-r1 .. th-r5]       (only 5 keys, R6 slot does not exist)
#   mid = 4-way hat/joystick in the centre column: hat-up/down/left/right on the
#         num/upper/home/lower rows, hat-click on the thumb row.
#
# COORDINATE NAMES (primary key into 'positions'): the key the BASE layer has at that
#   spot (tap key of hold-taps), lowercased: letters q w e ..., digits 1..0, symbols
#   \`  -  =  ;  '  ,  .  /  \\  and tab / lshift / lctrl for the outer column.
#   Non-base-derived: hat-* (hat), enc (encoder click), th-l1..th-l5 / th-r1..th-r5 (thumbs,
#   numbered inner -> outer on BOTH hands: th-l1/th-r1 are nearest the centre).
#   NOTE: the base layer has ',' at the lower-middle (3rd) left spot and no ',' on the
#   right half, so the right lower row is  b n m . / \\  (comma is "lost" there).
#
# POSITION NAMES  <row>-<column>:  row = num|upper|home|lower|thumb
#   column = pinky|ring|middle|index|inner (inner = extra index-reach column, next to the hat)
#   outermost column on each half = far-<row>-pinky  (e.g. far-upper-pinky = Tab / '=')
#   The same position name exists on both hands; hand is L/R (C = centre hat).
#   thumb-1 = innermost thumb ... thumb-5 = outermost.  Unique key is the coordinate name.
#`,
  lily58: `# PHYSICAL GRID (58 matrix positions, listed in matrix order; the Silakka54 has 54 keys)
#   rows : num / upper / home (12 keys each) + lower (14) + thumb (8)
#   each row = { L: [6 keys, outer -> inner], mid: [...], R: [6 keys, inner -> outer] }
#   mid  = the matrix slots between the halves that are NOT fitted on the Silakka54 (always
#          &none on every layer): 2 on the lower row (nofit-lower-l/r) and the innermost thumb
#          on each side (th-l1 / th-r1). Rows num/upper/home have no mid.
#   thumb row: L = [th-l4, th-l3, th-l2] (Esc, Space/Nav, Tab/Tmux), mid = [th-l1, th-r1],
#              R = [th-r2, th-r3, th-r4]  (Enter/Sym, Backspace/Num, Del/Fun)
#   No hat, no encoder, no Eyelash layers on this board.
#
# COORDINATE NAMES (primary key into 'positions'): the key the BASE layer has at that
#   spot (tap key of hold-taps), lowercased - the SAME names as eyelash_sofle.yaml, so
#   h / j / k / l / y / i / b / n / m mean the same key on both boards:
#   letters q w e ..., digits 1..0, symbols \`  -  =  ;  '  ,  .  /  \\  and tab / lshift / lctrl
#   for the outer column.  Thumbs are th-l<k>/th-r<k> numbered inner -> outer (physical
#   position, so Tab/Tmux is th-l2 here but th-l1 on the Sofle, which has 5 thumbs).
#   NOTE: the base layer has ',' at the lower-middle (3rd) left spot and no ',' on the
#   right half, so the right lower row is  b n m . / \\  (comma is "lost" there).
#
# POSITION NAMES  <row>-<column>:  row = num|upper|home|lower|thumb
#   column = pinky|ring|middle|index|inner;  outermost column on each half = far-<row>-pinky
#   The same position name exists on both hands; hand is L/R.  Unique key is the coordinate name.
#   thumb-1 = innermost thumb ... thumb-4 = outermost.
#`,
};
const DOC = `# ${BOARD}.yaml (baseline) — structured form of config/${BOARD}.keymap
# Source: origin/main @ ${commit}.  Regenerate keymap: deno run -A gen.ts ; verify: bash run.sh
#
${GRID_DOC[BOARD]}
# BINDING NOTATION
#   A, N1.. , LS(A), LA(LBKT)   -> &kp ...             trans / none  -> &trans / &none
#   mo(NAV) to(BASE)            -> &mo U_NAV / &to U_BASE   (layer names, U_<NAME> in the .keymap)
#   mt(LGUI,A) lt(NAV,SPACE)    -> user hold-taps (hold_taps table; hold arg first, tap arg second)
#   macro:<name> morph:<name> dance:<name> -> &<name> (macros / mod_morphs / tap_dances tables)
#   U_UND ...                   -> #define alias (aliases table, verbatim name)
#   bootloader, studio_unlock.. -> zero-arg behaviors (zero_arg_behaviors list)
#   anything else name(a,b)     -> &name a b
#
# FORMATTING (so that gen.ts reproduces the original file byte-for-byte)
#   blank_before: true     on a macro / hold-tap / mod-morph / tap-dance = blank line before it
#   fmt.banner_width       total width of the "/* ── Title ──── */" banner lines
#   fmt.layer_rows.<LAYER> one pattern per bindings row; every "_" is one binding, the spaces
#                          between them are copied verbatim (column alignment, extra gap at the hat).
#                          Edit a cell in 'layers' and the row layout is kept; if a layer's cell
#                          count changes (or the layer has no pattern) gen.ts falls back to
#                          auto-aligned columns.
`;

function renderRows(rows: Record<string, Row>, indent: number): string[] {
  const cell = (s: string) => qs(s);
  const nMax = (k: "L" | "mid" | "R") => Math.max(...Object.values(rows).map((r) => (r[k] ?? []).length));
  const width = (k: "L" | "mid" | "R", c: number) => Math.max(0, ...Object.values(rows).map((r) => r[k]?.[c] !== undefined ? cell(r[k]![c]).length : 0));
  const W = { L: Array.from({ length: nMax("L") }, (_, c) => width("L", c)), mid: Array.from({ length: nMax("mid") }, (_, c) => width("mid", c)), R: Array.from({ length: nMax("R") }, (_, c) => width("R", c)) };
  const pad = " ".repeat(indent);
  const out: string[] = [];
  const nw = Math.max(...Object.keys(rows).map((k) => k.length));
  const lst = (xs: string[], w: number[], padLast = false) => xs.map((x, i) => i === xs.length - 1 ? (padLast ? cell(x).padEnd(w[i]) : cell(x)) : (cell(x) + ",").padEnd(w[i] + 1)).join(" ");
  for (const [rn, r] of Object.entries(rows)) {
    const mid = r.mid?.length ? `,  mid: [${lst(r.mid, W.mid, true)}]` : "";
    out.push(`${pad}${(rn + ":").padEnd(nw + 2)}{L: [${lst(r.L, W.L, true)}]${mid},  R: [${lst(r.R, W.R)}]}`);
  }
  return out;
}
const hook = (path: string[], v: unknown, indent: number): string[] | undefined => {
  if (path.length === 1 && path[0] === "layout") return [`layout:`, ...renderRows(v as Record<string, Row>, indent + 2)];
  if (path.length === 3 && path[0] === "layers" && path[2] === "rows") return [`${" ".repeat(indent)}rows:`, ...renderRows(v as Record<string, Row>, indent + 2)];
  if (path.length === 1 && path[0] === "positions") {
    const out = ["positions:"];
    for (const k of names) { const p = (v as Record<string, Record<string, unknown>>)[k];
      const f = (x: unknown, w: number) => String(x).padEnd(w);
      out.push(`  ${(qk(k) + ":").padEnd(12)} {pos: ${f(p.pos + ",", 17)} hand: ${p.hand}, finger: ${f(p.finger + ",", 9)} row: ${f(p.row + ",", 7)} col: ${f(p.col + ",", 5)} matrix: ${p.matrix}${p.unfitted ? ", unfitted: true" : ""}}`);
    }
    return out;
  }
  if (path.length === 1 && path[0] === "aliases") {
    const out = ["aliases:"];
    for (const g of v as { title: string; defs: Record<string, string> }[]) {
      out.push(`  - title: ${qs(g.title)}`, `    defs:`);
      for (const [k, val] of Object.entries(g.defs)) out.push(`      ${k}: ${qs(val)}`);
    }
    return out;
  }
  if (path.length === 1 && path[0] === "raw") return undefined;
  // compact one-line definitions (no comments/extra): flow mapping
  if (path.length === 2 && ["hold_taps", "mod_morphs", "tap_dances", "macros"].includes(path[0])) {
    const tbl = v as Record<string, Record<string, unknown>>;
    const out = [`${" ".repeat(indent)}${path[1]}:`];
    return undefined;
  }
  return undefined;
};
let ytxt = DOC + "\n" + emitYaml(dataC, hook).join("\n") + "\n";
await Deno.writeTextFile(outFile, ytxt);

// ------------------------------------------------------------ self-check: YAML parses back to the same data
const back = parseYaml(ytxt);
const a = JSON.stringify(dataC, (_, v) => v), b = JSON.stringify(back);
function deepEq(x: unknown, y: unknown, p = ""): string | null {
  if (JSON.stringify(x) === JSON.stringify(y)) return null;
  if (x && y && typeof x === "object" && typeof y === "object") {
    for (const k of new Set([...Object.keys(x as object), ...Object.keys(y as object)])) {
      const r = deepEq((x as any)[k], (y as any)[k], p + "/" + k); if (r) return r;
    }
  }
  return `${p}: ${JSON.stringify(x)} != ${JSON.stringify(y)}`;
}
const diff = deepEq(dataC, back);
if (diff) { console.error("YAML self-check FAILED at " + diff); Deno.exit(1); }
console.log(`wrote ${outFile} (${ytxt.split("\n").length} lines); YAML self-check OK; ${layerNames.length} layers, ${macroNodes.length} macros, ${htNodes.length} hold-taps, ${morphNodes.length} mod-morphs, ${danceNodes.length} tap-dances`);
