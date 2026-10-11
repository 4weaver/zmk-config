// verify.ts — round-trip check: original keymap vs generated keymap
// usage: deno run -A verify.ts orig.keymap generated.keymap
import { newCtx, tokenizeBindings, rawText } from "./lib.ts";
const [a, b, expectArg] = Deno.args;   // optional 3rd arg: expected differing cells per layer, e.g. NAV=2,TMUX=11
const A = await Deno.readTextFile(a), B = await Deno.readTextFile(b);
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/.*$/gm, " ");
const norm = (s: string) => strip(s).replace(/\s+/g, " ").replace(/ ?([<>;{}=,()|]) ?/g, "$1").trim();
const na = norm(A), nb = norm(B);
console.log(`normalized (comments+whitespace stripped) equal: ${na === nb}  [${na.length} vs ${nb.length} chars]`);
if (na !== nb) {
  let i = 0; while (i < na.length && na[i] === nb[i]) i++;
  console.log("first diff @", i, "\n  orig:", na.slice(Math.max(0, i - 60), i + 80), "\n  gen: ", nb.slice(Math.max(0, i - 60), i + 80));
}
// per-layer binding lists (independent extraction)
const layerBindings = (s: string) => {
  const m = [...strip(s).matchAll(/(\w+)\s*\{\s*display-name\s*=\s*"([^"]*)";\s*bindings\s*=\s*<([^>]*)>/g)];
  const aliases = new Set([...strip(s).matchAll(/#define\s+(U_\w+)\s+&/g)].map((x) => x[1]));
  return m.map((x) => ({ name: x[1], bind: tokenizeBindings(x[3], aliases).map(rawText) }));
};
const la = layerBindings(A), lb = layerBindings(B);
let diffs = 0;
const perLayer: Record<string, number> = {};
if (la.length !== lb.length) { console.log("layer count differs", la.length, lb.length); diffs++; }
la.forEach((l, i) => {
  const o = lb[i];
  if (!o || o.name !== l.name) { console.log("layer name/order differs at", i); diffs++; return; }
  if (l.bind.length !== o.bind.length) { console.log(l.name, "length", l.bind.length, o.bind.length); diffs++; return; }
  l.bind.forEach((x, k) => { if (x !== o.bind[k]) { perLayer[l.name] = (perLayer[l.name] ?? 0) + 1; console.log(`DIFF ${l.name}[${k}]: ${x} vs ${o.bind[k]}`); diffs++; } });
});
console.log(`per-layer bindings: ${la.length} layers x ${la[0]?.bind.length} bindings compared, ${diffs} differences`);
if (expectArg) {
  const exp = Object.fromEntries(expectArg.split(",").map((x) => x.split("=")).map(([k, v]) => [k, +v]));
  const ok = JSON.stringify(Object.entries(exp).sort()) === JSON.stringify(Object.entries(perLayer).sort());
  console.log(`expected differing cells ${expectArg}: ${ok ? "MATCH" : "MISMATCH, got " + JSON.stringify(perLayer)}`);
  Deno.exit(ok ? 0 : 1);
}
Deno.exit(na === nb && diffs === 0 ? 0 : 1);
