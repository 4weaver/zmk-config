// split.ts — one-time conversion helper: two full YAMLs (baseline/ or an edited copy) ->
//   keymaps/common.yaml + keymaps/<board>.yaml, where the board files say `<section>: common` for
//   every section that is textually identical in both boards.
// usage: deno run -A split.ts <eyelash_sofle.full.yaml> <lily58.full.yaml> <outdir>
// (kept for reference; day-to-day you edit keymaps/*.yaml directly)
const [fa, fb, outDir] = Deno.args;
const texts = [await Deno.readTextFile(fa), await Deno.readTextFile(fb)];
const SHARED_TOP = ["aliases", "macros", "hold_taps", "mod_morphs", "tap_dances"];
const SHARED_SUB: Record<string, string[]> = { raw: ["defines", "overrides"], fmt: ["banner_width"] };

/** split "key:..." chunks at the given indent; returns [preamble, ordered map key -> text (incl. key line)] */
function chunks(t: string, indent: number): [string, Map<string, string>] {
  const re = new RegExp(`^ {${indent}}([A-Za-z_][A-Za-z0-9_]*):`, "gm");
  const m = [...t.matchAll(re)];
  const pre = t.slice(0, m[0]?.index ?? t.length);
  const out = new Map<string, string>();
  m.forEach((x, i) => out.set(x[1], t.slice(x.index!, m[i + 1]?.index ?? t.length).replace(/\n+$/, "") + "\n"));
  return [pre, out];
}
const parsed = texts.map((t) => chunks(t, 0));
const subs = (i: number, k: string) => chunks(parsed[i][1].get(k)!.split("\n").slice(1).join("\n"), 2)[1];
const common: string[] = [];
const boards = parsed.map(([, m]) => new Map(m));
for (const k of SHARED_TOP) {
  const [a, b] = [parsed[0][1].get(k), parsed[1][1].get(k)];
  if (a !== b) throw new Error(`section '${k}' differs between boards`);
  common.push(a!); boards.forEach((m) => m.set(k, `${k}: common\n`));
}
for (const [top, ks] of Object.entries(SHARED_SUB)) {
  const sa = subs(0, top), sb = subs(1, top);
  const cm: string[] = [];
  for (const k of ks) {
    if (sa.get(k) !== sb.get(k)) throw new Error(`${top}.${k} differs`);
    cm.push(sa.get(k)!);
  }
  common.push(`${top}:\n` + cm.join(""));
  boards.forEach((m, i) => {
    const s = subs(i, top);
    for (const k of ks) s.set(k, `  ${k}: common\n`);
    m.set(top, `${top}:\n` + [...s.values()].join(""));
  });
}
const NOTE = `# Shared definitions for every board in keymaps/ (macros, hold-taps, mod-morphs, tap-dances,
# aliases, mouse defaults, banner width). A board file pulls them in with \`import: common.yaml\`
# and the value \`common\` (e.g. \`macros: common\`, or per entry \`tm_zoom: common\`).
# Edit a definition HERE and both keymaps change. Notation: see the header of a board file.
`;
await Deno.mkdir(outDir, { recursive: true });
await Deno.writeTextFile(`${outDir}/common.yaml`, NOTE + "\n" + common.join("\n"));
const names = ["eyelash_sofle", "lily58"];
for (let i = 0; i < 2; i++) {
  const pre = parsed[i][0];
  const order = ["meta", "layout", "positions", "layers", ...SHARED_TOP, "zero_arg_behaviors", "raw", "fmt"];
  const body = order.map((k) => boards[i].get(k)!).join("");
  const head = pre.replace(/^# .*\n/, `# ${names[i]}.yaml — SOURCE for config/${names[i]}.keymap (generate: deno run -A gen.ts keymaps/${names[i]}.yaml out/${names[i]}.keymap)\n`)
    .replace(/^# Source: .*\n/m, `# Shared macros/behaviors/aliases live in common.yaml (imported below).\n`);
  await Deno.writeTextFile(`${outDir}/${names[i]}.yaml`, head + `import: common.yaml\n\n` + body);
}
console.log("wrote", outDir);
