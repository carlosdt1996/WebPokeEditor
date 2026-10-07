/** Mini-lenguaje de eventos: una orden por línea. Se compila a instrucciones, luego a bytecode, y lo ejecuta la VM de Rust. */
import type { Engine } from "./engine";

export type Item = string;
export type Cmp = "==" | "!=" | ">" | "<" | ">=" | "<=";
export const CMPS: Cmp[] = ["==", "!=", ">", "<", ">=", "<="];

export type Instr =
  | { op: "say"; text: string }
  | { op: "give"; item: Item; n: number }
  | { op: "heal" }
  | { op: "flag"; name: string }
  | { op: "unflag"; name: string }
  | { op: "set"; name: string; value: number }
  | { op: "add"; name: string; delta: number }
  | { op: "jif"; flag: string; neg: boolean; to: number }
  | { op: "jcmp"; name: string; cmp: Cmp; value: number; to: number }
  | { op: "jmp"; to: number }
  | { op: "battle"; species: string; level: number }
  | { op: "givemon"; species: string; level: number }
  | { op: "warp"; map: string; x: number; y: number };

export const SCRIPT_HELP = `say <texto>            muestra un mensaje; {var} se sustituye por el valor de la variable
give <objeto> <n>      da objetos (ids de la pestaña Datos: potion, ball...)
heal                   cura al equipo
flag <nombre>          activa una marca  ·  unflag <nombre> la quita
set <var> <n>          asigna un número  ·  add <var> <n> suma (n puede ser negativo)
if <marca> / ifnot <marca>     condición por marca
if <var> <op> <n>              condición numérica (== != > < >= <=)
else / end                     cierran las condiciones
while <condición> ... end      bucle (mismas condiciones; whilenot <marca>)
repeat <n> ... end             repite n veces
break                          sale del bucle más interno
battle <especie> <nivel>   combate contra una criatura
givemon <especie> <nivel>  añade una criatura al equipo
warp <mapa> <x> <y>        teletransporta al jugador
Variables predefinidas al empezar: steps (pasos), party (nº de criaturas), level (nivel de la primera).
# línea de comentario`;

export type ParseResult = { ok: true; code: Instr[] } | { ok: false; errors: string[] };

const IDENT = /^[A-Za-z_][\w-]*$/;
type Frame = { kind: "if" | "while" | "repeat"; cond: number; jmp?: number; start?: number; hv?: string; breaks: number[] };

export function parseScript(src: string): ParseResult {
  const code: Instr[] = [];
  const errors: string[] = [];
  const stack: Frame[] = [];
  let hidden = 0;
  src.split("\n").forEach((raw, i) => {
    const line = raw.trim();
    if (!line || line.startsWith("#")) return;
    const [cmdRaw, ...rest] = line.split(/\s+/);
    const cmd = cmdRaw.toLowerCase();
    const arg = rest.join(" ");
    const err = (m: string) => errors.push(`línea ${i + 1}: ${m}`);
    const int = (s: string | undefined) => (s !== undefined && /^-?\d+$/.test(s) ? +s : NaN);
    const ident = (s: string | undefined) => (s && IDENT.test(s) ? s : (err(`nombre no válido "${s ?? ""}"`), null));
    /** Condición: "<marca>" o "<var> <op> <n>". Devuelve la instrucción de salto con destino pendiente. */
    const cond = (toks: string[], negFlag: boolean): Instr | null => {
      if (toks.length === 1) { const n = ident(toks[0]); return n ? { op: "jif", flag: n, neg: negFlag, to: -1 } : null; }
      if (toks.length === 3 && !negFlag) {
        const n = ident(toks[0]), v = int(toks[2]);
        if (!CMPS.includes(toks[1] as Cmp)) { err(`comparador desconocido "${toks[1]}" (usa == != > < >= <=)`); return null; }
        if (isNaN(v)) { err(`"${toks[2]}" no es un número`); return null; }
        return n ? { op: "jcmp", name: n, cmp: toks[1] as Cmp, value: v, to: -1 } : null;
      }
      err(`condición no válida: usa "<marca>" o "<var> <op> <n>"`);
      return null;
    };
    const patch = (idx: number, to: number) => { const ins = code[idx]; if (ins.op === "jif" || ins.op === "jcmp" || ins.op === "jmp") ins.to = to; };
    switch (cmd) {
      case "say": if (!arg) err("say necesita un texto"); else code.push({ op: "say", text: arg }); break;
      case "give": {
        const n = int(rest[1]);
        if (!rest[0] || !(n >= 1)) err("uso: give <objeto> <n>"); else code.push({ op: "give", item: rest[0], n });
        break;
      }
      case "heal": code.push({ op: "heal" }); break;
      case "flag": case "unflag": { const n = ident(rest[0]); if (n) code.push({ op: cmd, name: n }); break; }
      case "set": case "add": {
        const n = ident(rest[0]), v = int(rest[1]);
        if (isNaN(v)) { err(`uso: ${cmd} <var> <número>`); break; }
        if (n) code.push(cmd === "set" ? { op: "set", name: n, value: v } : { op: "add", name: n, delta: v });
        break;
      }
      case "if": case "ifnot": case "while": case "whilenot": {
        const c = cond(rest, cmd.endsWith("not"));
        const kind = cmd.startsWith("if") ? "if" : "while";
        if (!c) { stack.push({ kind, cond: -1, breaks: [] }); break; }
        const frame: Frame = { kind, cond: code.length, start: kind === "while" ? code.length : undefined, breaks: [] };
        code.push(c);
        stack.push(frame);
        break;
      }
      case "repeat": {
        const n = int(rest[0]);
        if (!(n >= 0)) { err("uso: repeat <n>"); stack.push({ kind: "repeat", cond: -1, breaks: [] }); break; }
        const hv = `__rep${hidden++}`;
        code.push({ op: "set", name: hv, value: n });
        const frame: Frame = { kind: "repeat", cond: code.length, start: code.length, hv, breaks: [] };
        code.push({ op: "jcmp", name: hv, cmp: ">", value: 0, to: -1 });
        stack.push(frame);
        break;
      }
      case "else": {
        const top = stack[stack.length - 1];
        if (!top || top.kind !== "if" || top.jmp !== undefined) { err("else sin if"); break; }
        top.jmp = code.length;
        code.push({ op: "jmp", to: -1 });
        if (top.cond >= 0) patch(top.cond, code.length);
        break;
      }
      case "break": {
        const loop = [...stack].reverse().find((f) => f.kind !== "if");
        if (!loop) { err("break fuera de un bucle"); break; }
        loop.breaks.push(code.length);
        code.push({ op: "jmp", to: -1 });
        break;
      }
      case "end": {
        const top = stack.pop();
        if (!top) { err("end sin if/while/repeat"); break; }
        if (top.kind === "if") {
          if (top.jmp !== undefined) patch(top.jmp, code.length); else if (top.cond >= 0) patch(top.cond, code.length);
        } else {
          if (top.kind === "repeat" && top.hv) code.push({ op: "add", name: top.hv, delta: -1 });
          if (top.start !== undefined) code.push({ op: "jmp", to: top.start });
          if (top.cond >= 0) patch(top.cond, code.length);
          for (const b of top.breaks) patch(b, code.length);
        }
        break;
      }
      case "battle": case "givemon": {
        const lv = int(rest[1]);
        if (!rest[0] || !(lv >= 1 && lv <= 100)) err(`uso: ${cmd} <especie> <nivel 1-100>`); else code.push({ op: cmd, species: rest[0], level: lv });
        break;
      }
      case "warp": {
        const x = int(rest[1]), y = int(rest[2]);
        if (!rest[0] || isNaN(x) || isNaN(y)) err("uso: warp <mapa> <x> <y>"); else code.push({ op: "warp", map: rest[0], x, y });
        break;
      }
      default: err(`comando desconocido "${cmdRaw}"`);
    }
  });
  if (stack.length) errors.push(`falta${stack.length > 1 ? "n" : ""} ${stack.length} "end"`);
  return errors.length ? { ok: false, errors } : { ok: true, code };
}

export interface ScriptCtx {
  say(lines: string[]): Promise<void>;
  give(item: Item, n: number): void;
  heal(): void;
  battle(species: string, level: number): Promise<void>;
  givemon(species: string, level: number): void;
  warp(map: string, x: number, y: number): Promise<void>;
}

/** Códigos de operación del bytecode (deben coincidir con crates/engine-core). */
const OP = { say: 1, give: 2, heal: 3, battle: 4, givemon: 5, warp: 6, flag: 10, unflag: 11, jif: 12, jmp: 13, set: 20, add: 21, cmp: 22, jnc: 23 } as const;

/** Compila las instrucciones a bytecode de 4 palabras + tabla de cadenas (la VM solo maneja números). */
export function compileScript(code: Instr[], engine: Pick<Engine, "flagId" | "varId">): { words: Uint32Array; strings: string[] } {
  const strings: string[] = [];
  const sid = (t: string) => { let i = strings.indexOf(t); if (i < 0) i = strings.push(t) - 1; return i; };
  // `jcmp` ocupa dos instrucciones de bytecode (CMP + JNC): primero calculamos dónde empieza cada instrucción
  const at: number[] = [];
  let n = 0;
  for (const ins of code) { at.push(n); n += ins.op === "jcmp" ? 2 : 1; }
  at.push(n);
  const words = new Uint32Array(n * 4);
  const put = (k: number, w: number[]) => words.set(w.map((x) => x >>> 0), k * 4);
  code.forEach((ins, i) => {
    const k = at[i];
    switch (ins.op) {
      case "say": put(k, [OP.say, sid(ins.text), 0, 0]); break;
      case "give": put(k, [OP.give, sid(ins.item), ins.n, 0]); break;
      case "heal": put(k, [OP.heal, 0, 0, 0]); break;
      case "flag": put(k, [OP.flag, engine.flagId(ins.name), 0, 0]); break;
      case "unflag": put(k, [OP.unflag, engine.flagId(ins.name), 0, 0]); break;
      case "set": put(k, [OP.set, engine.varId(ins.name), ins.value, 0]); break;
      case "add": put(k, [OP.add, engine.varId(ins.name), ins.delta, 0]); break;
      case "jif": put(k, [OP.jif, engine.flagId(ins.flag), ins.neg ? 1 : 0, at[ins.to]]); break;
      case "jcmp": put(k, [OP.cmp, engine.varId(ins.name), CMPS.indexOf(ins.cmp), ins.value]); put(k + 1, [OP.jnc, at[ins.to], 0, 0]); break;
      case "jmp": put(k, [OP.jmp, at[ins.to], 0, 0]); break;
      case "battle": put(k, [OP.battle, sid(ins.species), ins.level, 0]); break;
      case "givemon": put(k, [OP.givemon, sid(ins.species), ins.level, 0]); break;
      case "warp": put(k, [OP.warp, sid(ins.map), ins.x, ins.y]); break;
    }
  });
  return { words, strings };
}

/** Ejecuta un script en la VM de Rust; el host (ctx) resuelve los efectos y la VM decide el flujo. */
export async function runScript(code: Instr[], ctx: ScriptCtx, engine: Engine, maxEvents = 2000) {
  const { words, strings } = compileScript(code, engine);
  engine.vmLoad(words);
  let lines: string[] = [];
  const flush = async () => { if (lines.length) { const l = lines; lines = []; await ctx.say(l); } };
  for (let events = 0; ; events++) {
    if (events > maxEvents) throw new Error("El script ejecuta demasiadas acciones (¿bucle infinito?)");
    const ev = engine.vmRun();
    if (ev === OP.say) { lines.push(strings[engine.vmArg(0)].replace(/\{([A-Za-z_][\w-]*)\}/g, (_, n: string) => String(engine.getVar(n)))); continue; }
    await flush();
    if (ev === 0) return;
    if (ev === 255) throw new Error("Error en la VM de scripts (¿bucle infinito sin acciones?)");
    const a = engine.vmArg(0), b = engine.vmArg(1), c = engine.vmArg(2);
    if (ev === OP.give) ctx.give(strings[a], b);
    else if (ev === OP.heal) ctx.heal();
    else if (ev === OP.battle) await ctx.battle(strings[a], b);
    else if (ev === OP.givemon) ctx.givemon(strings[a], b);
    else if (ev === OP.warp) { await ctx.warp(strings[a], b, c); return; } // el mapa cambia: termina el script
  }
}
