// gen.ts — <board>.yaml -> .keymap
// usage: deno run -A gen.ts <in.yaml> <out.keymap>
//
// A board YAML may contain `import: common.yaml` (path relative to the YAML). Anywhere (outside
// layout/layers/positions) a value that is the plain string `common` is replaced by the value at the
// same path in the imported file, e.g.  `macros: common`  or  `macros: {tm_zoom: common, ...}`.
import { parse as parseYaml } from "jsr:@std/yaml@1";
import { dirname, resolve } from "jsr:@std/path@1";
import { Ctx, fromNotation, newCtx } from "./lib.ts";

const inFile = Deno.args[0];
const outFile = Deno.args[1];
if (!inFile || !outFile) throw new Error("usage: gen.ts <in.yaml> <out.keymap>");
// deno-lint-ignore no-explicit-any
const Y: any = parseYaml(await Deno.readTextFile(inFile));
if (Y.import) {
  // deno-lint-ignore no-explicit-any
  const C: any = parseYaml(await Deno.readTextFile(resolve(dirname(inFile), Y.import)));
  // deno-lint-ignore no-explicit-any
  const res = (v: any, c: any, path: string): any => {
    if (v === "common") { if (c === undefined) throw new Error(`'common' used at ${path} but not defined in ${Y.import}`); return c; }
    if (v && typeof v === "object" && !Array.isArray(v)) {
      return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, res(x, c?.[k], path + "/" + k)]));
    }
    return v;
  };
  for (const k of Object.keys(Y)) if (!["layout", "layers", "positions", "meta", "import", "fmt"].includes(k)) Y[k] = res(Y[k], C[k], k);
  if (Y.fmt) Y.fmt = res(Y.fmt, C.fmt, "fmt");
}

const ctx: Ctx = newCtx();
Object.keys(Y.layers).forEach((n) => ctx.layers.add(n));
Object.keys(Y.macros ?? {}).forEach((n) => ctx.macros.add(n));
Object.keys(Y.mod_morphs ?? {}).forEach((n) => ctx.morphs.add(n));
Object.keys(Y.tap_dances ?? {}).forEach((n) => ctx.dances.add(n));
for (const g of Y.aliases ?? []) Object.keys(g.defs).forEach((n) => ctx.aliases.add(n));
for (const [a, h] of Object.entries<any>(Y.hold_taps ?? {})) {
  if (!h.hold || !h.tap) throw new Error(`hold_taps.${a}: hold and tap behavior names are required`);
  ctx.holdtaps.set(a, { node: h.node, hold: h.hold, tap: h.tap });
  if ((h.binding_cells ?? 2) === 0) ctx.zeroArg.add(h.node);
}
(Y.zero_arg_behaviors ?? []).forEach((n: string) => ctx.zeroArg.add(n));
const F = (n: string) => fromNotation(n, ctx);
const FL = (a: string[]) => a.map(F).join(" ");

const out: string[] = [];
const ind = (s: string, n: number) => s.split("\n").map((l) => l ? " ".repeat(n) + l : l).join("\n");
const BW: number = Y.fmt?.banner_width ?? 70;
const banner = (t: string) => { const core = `── ${t} `; return `/* ${core}${"─".repeat(Math.max(3, BW - 6 - core.length))} */`; };
// blank line before a definition (kept from the original source layout)
const gap = (o: { blank_before?: boolean }) => o.blank_before ? [""] : [];
const comment = (cs: string[] | undefined, n: number) => (cs ?? []).map((c) => {
  const ls = c.split("\n");
  return " ".repeat(n) + "/* " + ls.join("\n" + " ".repeat(n + 3)) + " */";
});
const extra = (e: Record<string, string> | undefined, n: number) =>
  Object.entries(e ?? {}).map(([k, v]) => " ".repeat(n) + (v === "" ? `${k};` : `${k} = ${v};`));
const cellsOf = (x: string) => `<${x}>`;
const grp = (bs: string[], style: string | undefined, dflt: "joined" | "split") =>
  (style ?? dflt) === "split" ? bs.map((b) => cellsOf(F(b))).join(", ") : cellsOf(FL(bs));

out.push(Y.raw.header, "");

// layer indices
out.push(banner("Layer indices"));
const lnames = Object.keys(Y.layers);
const w = Math.max(...lnames.map((n) => n.length)) + 2;
for (const n of lnames) out.push(`#define ${("U_" + n).padEnd(w + 1)}${Y.layers[n].index}`);
out.push("");
// raw defines + aliases
if ((Y.raw.defines ?? []).length) { out.push(banner("Mouse defaults"), ...Y.raw.defines, ""); }
for (const g of Y.aliases ?? []) {
  out.push(banner(g.title));
  for (const [k, v] of Object.entries<string>(g.defs)) out.push(`#define ${k} ${F(v)}`);
  out.push("");
}
if ((Y.raw.overrides ?? []).length) { out.push(banner("Mouse movement tuning"), ...Y.raw.overrides, ""); }

// macros
out.push(banner("Macros"), "/ {");
for (const r of Y.raw.root_nodes ?? []) out.push(ind(r, 4), "");
out.push("    macros {");
const macroBlocks: string[] = [];
for (const [name, m] of Object.entries<any>(Y.macros ?? {})) {
  const l = [...gap(m), ...comment(m.comments, 8), `        ${name}: ${name} {`, `            compatible = "zmk,behavior-macro";`, `            #binding-cells = <0>;`];
  if (m.wait_ms !== undefined) l.push(`            wait-ms = <${m.wait_ms}>;`);
  if (m.tap_ms !== undefined) l.push(`            tap-ms = <${m.tap_ms}>;`);
  l.push(`            bindings = ${grp(m.bindings, m.cell_groups, "joined")};`, ...extra(m.extra, 12), `        };`);
  macroBlocks.push(l.join("\n"));
}
for (const r of Y.raw.macro_nodes ?? []) macroBlocks.push(ind(r, 8));
out.push(macroBlocks.join("\n"), "    };", "};", "");

// behaviors
out.push(banner("Behaviors"), "/ {", "    behaviors {");
const bb: string[] = [];
for (const [, h] of Object.entries<any>(Y.hold_taps ?? {})) {
  const cells = h.binding_cells ?? 2;
  const holdBind = h.hold_binding !== undefined ? F(h.hold_binding) : `&${h.hold}`;
  const tapBind = h.tap_binding !== undefined ? F(h.tap_binding) : `&${h.tap}`;
  // 0-cell hold-taps bake params into bindings and require a single phandle-array
  // (<&hold &tap>), not the split form used by 2-cell hold-taps (<&hold>, <&tap>).
  const bindProp = cells === 0
    ? `            bindings = <${holdBind} ${tapBind}>;`
    : `            bindings = <${holdBind}>, <${tapBind}>;`;
  bb.push([...gap(h), ...comment(h.comments, 8), `        ${h.node}: ${h.node} {`, `            compatible = "zmk,behavior-hold-tap";`, `            #binding-cells = <${cells}>;`,
    `            tapping-term-ms = <${h.tapping_term_ms}>;`,
    ...(h.require_prior_idle_ms !== undefined ? [`            require-prior-idle-ms = <${h.require_prior_idle_ms}>;`] : []),
    `            flavor = "${h.flavor}";`, bindProp, ...extra(h.extra, 12), `        };`].join("\n"));
}
for (const [name, m] of Object.entries<any>(Y.mod_morphs ?? {})) {
  bb.push([...gap(m), ...comment(m.comments, 8), `        ${name}: ${name} {`, `            compatible = "zmk,behavior-mod-morph";`, `            #binding-cells = <0>;`,
    `            bindings = ${grp([m.normal, m.morphed], m.cell_groups, "split")};`,
    ...(m.mods ? [`            mods = <(${m.mods.map((x: string) => "MOD_" + x).join("|")})>;`] : []), ...extra(m.extra, 12), `        };`].join("\n"));
}
for (const [name, d] of Object.entries<any>(Y.tap_dances ?? {})) {
  bb.push([...gap(d), ...comment(d.comments, 8), `        ${name}: ${name} {`, `            compatible = "zmk,behavior-tap-dance";`, `            #binding-cells = <0>;`,
    `            tapping-term-ms = <${d.tapping_term_ms}>;`, `            bindings = ${grp(d.bindings, d.cell_groups, "split")};`, ...extra(d.extra, 12), `        };`].join("\n"));
}
for (const r of Y.raw.behavior_nodes ?? []) bb.push(ind(r, 8));
out.push(bb.join("\n"), "    };", "};", "");

// keymap
// layout order: for every layer the same row/side order as `layout`
const rowNames = Object.keys(Y.layout);
out.push("/ {", "    keymap {", `        compatible = "zmk,keymap";`, "");
for (const [name, L] of Object.entries<any>(Y.layers)) {
  const cmts = (L.comments ?? []).map((c: string, i: number) => i === 0 ? `${L.index}: ${c}` : c);
  const rows: string[][] = []; // F()-converted cell lists per row; [L..., hat, R...]
  const hatAt: number[] = [];
  for (const rn of rowNames) {
    const r = L.rows[rn], lay = Y.layout[rn];
    const mid: string[] = r?.mid ?? [], lmid: string[] = lay.mid ?? [];
    if (!r || r.L.length !== lay.L.length || r.R.length !== lay.R.length || mid.length !== lmid.length) throw new Error(`layer ${name} row ${rn}: shape mismatch`);
    rows.push([...r.L.map(F), ...mid.map(F), ...r.R.map(F)]);
    hatAt.push(r.L.length);
  }
  const ncol = Math.max(...rows.map((r) => r.length));
  const wd = Array.from({ length: ncol }, (_, c) => Math.max(...rows.map((r) => (r[c] ?? "").length)));
  const pat: string[] | undefined = Y.fmt?.layer_rows?.[name];
  const usePat = pat && pat.length === rows.length && pat.every((s, ri) => s.split("_").length - 1 === rows[ri].length);
  const lines = usePat ? rows.map((r, ri) => { // verbatim row layout from fmt.layer_rows
    const parts = pat![ri].split("_");
    return parts.map((g, k) => g + (r[k] ?? "")).join("");
  }) : rows.map((r, ri) => r.map((x, c) => {
    const pad = c === r.length - 1 ? x : x.padEnd(wd[c]);
    const nm = (Y.layout[rowNames[ri]].mid ?? []).length;   // extra gap before the centre block and before the right half
    return c === hatAt[ri] || c === hatAt[ri] + nm ? ` ${pad}` : pad;
  }).join(" ").replace(/^\s+/, "")) ;
  if (Object.keys(L.rows).length !== rowNames.length) throw new Error("extra rows in layer " + name);
  out.push(...comment(cmts, 8),
    `        ${name} {`, `            display-name = "${L.display_name}";`, `            bindings = <`, ...lines, `            >;`,
    ...(L.sensor ? [`            sensor-bindings = <${FL(L.sensor)}>;`] : []), ...extra(L.extra, 12), `        };`, "");
}
out.pop();
out.push("    };", "};", "");
await Deno.writeTextFile(outFile, out.join("\n"));
console.log("wrote " + outFile);
