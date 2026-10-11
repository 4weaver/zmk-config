// Shared helpers: binding notation <-> raw ZMK binding text, mini YAML emitter.
export const MODWRAP = new Set(["LS", "LC", "LA", "LG", "RS", "RC", "RA", "RG"]);
export const LAYER_BEH = new Set(["mo", "to", "tog", "sl"]);

export interface HoldTap { node: string; hold: string; tap: string }
export interface Ctx {
  layers: Set<string>;               // layer names (U_<name> is the define)
  holdtaps: Map<string, HoldTap>;    // alias (e.g. "mt") -> def
  macros: Set<string>;
  morphs: Set<string>;
  dances: Set<string>;
  aliases: Set<string>;              // #define U_xxx &... (verbatim name)
  zeroArg: Set<string>;              // plain zero-arg behaviors (&bootloader ...)
}
export function newCtx(): Ctx {
  return { layers: new Set(), holdtaps: new Map(), macros: new Set(), morphs: new Set(),
    dances: new Set(), aliases: new Set(), zeroArg: new Set() };
}

export function splitTop(s: string): string[] {
  const out: string[] = []; let d = 0, cur = "";
  for (const c of s) {
    if (c === "(") d++; if (c === ")") d--;
    if (c === "," && d === 0) { out.push(cur.trim()); cur = ""; } else cur += c;
  }
  if (cur.trim() !== "" || out.length) out.push(cur.trim());
  return out;
}

export interface RawBinding { amp: boolean; name: string; args: string[] }

/** split the inside of <...> into bindings. Tokens starting with & begin a binding;
 *  tokens that are a known alias are standalone bindings. */
export function tokenizeBindings(text: string, aliases: Set<string>): RawBinding[] {
  const out: RawBinding[] = [];
  for (const t of text.trim().split(/\s+/).filter(Boolean)) {
    if (t.startsWith("&")) out.push({ amp: true, name: t.slice(1), args: [] });
    else if (aliases.has(t)) out.push({ amp: false, name: t, args: [] });
    else {
      if (!out.length) throw new Error("dangling arg " + t);
      out[out.length - 1].args.push(t);
    }
  }
  return out;
}
export const rawText = (b: RawBinding) => b.amp ? ["&" + b.name, ...b.args].join(" ") : b.name;

function layerArgIdx(name: string, ctx: Ctx): number[] {
  if (LAYER_BEH.has(name)) return [0];
  for (const h of ctx.holdtaps.values()) if (h.node === name && LAYER_BEH.has(h.hold)) return [0];
  return [];
}
const stripU = (a: string, ctx: Ctx) => a.startsWith("U_") && ctx.layers.has(a.slice(2)) ? a.slice(2) : a;

export function toNotation(b: RawBinding, ctx: Ctx): string {
  if (!b.amp) return b.name; // alias, verbatim
  const { name, args } = b;
  if (name === "trans" || name === "none") { if (args.length) throw new Error("args on " + name); return name; }
  if (name === "kp" && args.length === 1) return args[0];
  if (ctx.macros.has(name) && !args.length) return "macro:" + name;
  if (ctx.morphs.has(name) && !args.length) return "morph:" + name;
  if (ctx.dances.has(name) && !args.length) return "dance:" + name;
  const ht = [...ctx.holdtaps.entries()].find(([, h]) => h.node === name);
  const fn = ht ? ht[0] : name;
  if (!args.length) { ctx.zeroArg.add(name); return name; }
  const li = layerArgIdx(name, ctx);
  const a = args.map((x, i) => li.includes(i) ? stripU(x, ctx) : x);
  return `${fn}(${a.join(",")})`;
}

export function fromNotation(n: string, ctx: Ctx): string {
  if (n === "trans" || n === "none") return "&" + n;
  for (const p of ["macro:", "morph:", "dance:"]) if (n.startsWith(p)) return "&" + n.slice(p.length);
  const m = n.match(/^([A-Za-z_]\w*)\((.*)\)$/s);
  if (m) {
    const [, fn, inner] = m;
    if (MODWRAP.has(fn)) return "&kp " + n;
    const ht = ctx.holdtaps.get(fn);
    const node = ht ? ht.node : fn;
    const li = layerArgIdx(node, ctx);
    const a = splitTop(inner).map((x, i) => li.includes(i) && ctx.layers.has(x) ? "U_" + x : x);
    return ["&" + node, ...a].join(" ");
  }
  if (ctx.zeroArg.has(n)) return "&" + n;
  if (ctx.aliases.has(n)) return n;
  return "&kp " + n;
}

// ---------------- mini YAML emitter ----------------
const RESERVED = /^(y|n|yes|no|on|off|true|false|null|~)$/i;
export function qs(s: string | number | boolean): string {
  if (typeof s !== "string") return String(s);
  if (/^[A-Za-z_][A-Za-z0-9_.\-]*(\([A-Za-z0-9_.\-(),]*\))?$/.test(s) && !RESERVED.test(s)) {
    if (s.includes(",")) return JSON.stringify(s);
    return s;
  }
  if (/^(macro|morph|dance):[A-Za-z0-9_]+$/.test(s)) return s;
  return JSON.stringify(s);
}
export function qk(k: string): string {
  return /^[A-Za-z_][A-Za-z0-9_\-]*$/.test(k) && !RESERVED.test(k) ? k : JSON.stringify(k);
}
export type Hook = (path: string[], v: unknown, indent: number) => string[] | undefined;

export function emitYaml(v: unknown, hook: Hook, indent = 0, path: string[] = []): string[] {
  const pad = " ".repeat(indent);
  const lines: string[] = [];
  const scalar = (x: unknown): string | undefined => {
    if (x === null || x === undefined) return "null";
    if (typeof x === "string") return x.includes("\n") ? undefined : qs(x);
    if (typeof x === "number" || typeof x === "boolean") return String(x);
    return undefined;
  };
  const block = (key: string, s: string, ind: number): string[] => {
    const p = " ".repeat(ind);
    return [`${p}${key}|-`, ...s.split("\n").map((l) => l === "" ? "" : p + "  " + l.replace(/\s+$/, ""))];
  };
  if (v && typeof v === "object" && !Array.isArray(v)) {
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      if (val === undefined) continue;
      const p2 = [...path, k];
      const h = hook(p2, val, indent);
      if (h) { lines.push(...h); continue; }
      const sc = scalar(val);
      if (sc !== undefined) { lines.push(`${pad}${qk(k)}: ${sc}`); continue; }
      if (typeof val === "string") { lines.push(...block(qk(k) + ": ", val, indent)); continue; }
      if (Array.isArray(val)) {
        if (val.length === 0) lines.push(`${pad}${qk(k)}: []`);
        else if (val.every((x) => scalar(x) !== undefined)) {
          const f = `[${val.map((x) => scalar(x)).join(", ")}]`;
          if (indent + k.length + f.length < 100) lines.push(`${pad}${qk(k)}: ${f}`);
          else { lines.push(`${pad}${qk(k)}:`); for (const x of val) lines.push(`${pad}  - ${scalar(x)}`); }
        } else {
          lines.push(`${pad}${qk(k)}:`);
          for (const x of val) {
            if (typeof x === "string") lines.push(...block("- ", x, indent + 2).map((l, i) => i === 0 ? l : l));
            else lines.push(`${pad}  - ` + JSON.stringify(x));
          }
        }
        continue;
      }
      if (val && typeof val === "object" && Object.keys(val).length === 0) { lines.push(`${pad}${qk(k)}: {}`); continue; }
      lines.push(`${pad}${qk(k)}:`);
      lines.push(...emitYaml(val, hook, indent + 2, p2));
    }
  }
  return lines;
}
