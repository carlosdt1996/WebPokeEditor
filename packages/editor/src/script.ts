import type { Engine } from "./engine";

/** Mini-lenguaje de eventos para NPCs: una orden por línea. Se compila a instrucciones y se ejecuta de forma asíncrona. */

export type Item = string;
export type Instr =
  | { op: "say"; text: string }
  | { op: "give"; item: Item; n: number }
  | { op: "heal" }
  | { op: "flag"; name: string }
  | { op: "unflag"; name: string }
  | { op: "jif"; flag: string; neg: boolean; to: number }
  | { op: "jmp"; to: number }
  | { op: "battle"; species: string; level: number }
  | { op: "givemon"; species: string; level: number }
  | { op: "warp"; map: string; x: number; y: number };

export const SCRIPT_HELP = `say <texto>            muestra un mensaje (varias líneas seguidas = un cuadro por línea)
give <objeto> <n>      da objetos (ids de la pestaña Datos: potion, ball...)
heal                   cura al equipo
flag <nombre>          activa una marca  ·  unflag <nombre> la quita
if <marca> / ifnot <marca> ... else ... end
battle <especie> <nivel>   combate contra una criatura
givemon <especie> <nivel>  añade una criatura al equipo
warp <mapa> <x> <y>        teletransporta al jugador`;

export type ParseResult = { ok: true; code: Instr[] } | { ok: false; errors: string[] };

export function parseScript(src: string): ParseResult {
  const code: Instr[] = [];
  const errors: string[] = [];
  const stack: { jif: number; jmp?: number }[] = [];
  const lines = src.split("\n");
  lines.forEach((raw, i) => {
    const line = raw.trim();
    if (!line || line.startsWith("#")) return;
    const [cmd, ...rest] = line.split(/\s+/);
    const arg = rest.join(" ");
    const err = (m: string) => errors.push(`línea ${i + 1}: ${m}`);
    const int = (s: string | undefined) => (s !== undefined && /^\d+$/.test(s) ? +s : NaN);
    switch (cmd.toLowerCase()) {
      case "say": if (!arg) err("say necesita un texto"); else code.push({ op: "say", text: arg }); break;
      case "give": {
        const n = int(rest[1]);
        if (!rest[0] || !(n >= 1)) err("uso: give <objeto> <n>");
        else code.push({ op: "give", item: rest[0], n });
        break;
      }
      case "heal": code.push({ op: "heal" }); break;
      case "flag": case "unflag":
        if (!rest[0]) err(`${cmd} necesita un nombre`); else code.push({ op: cmd.toLowerCase() as "flag" | "unflag", name: rest[0] });
        break;
      case "if": case "ifnot":
        if (!rest[0]) { err(`${cmd} necesita una marca`); break; }
        stack.push({ jif: code.length });
        code.push({ op: "jif", flag: rest[0], neg: cmd.toLowerCase() === "ifnot", to: -1 });
        break;
      case "else": {
        const top = stack[stack.length - 1];
        if (!top || top.jmp !== undefined) { err("else sin if"); break; }
        top.jmp = code.length;
        code.push({ op: "jmp", to: -1 });
        (code[top.jif] as Extract<Instr, { op: "jif" }>).to = code.length;
        break;
      }
      case "end": {
        const top = stack.pop();
        if (!top) { err("end sin if"); break; }
        if (top.jmp !== undefined) (code[top.jmp] as Extract<Instr, { op: "jmp" }>).to = code.length;
        else (code[top.jif] as Extract<Instr, { op: "jif" }>).to = code.length;
        break;
      }
      case "battle": case "givemon": {
        const lv = int(rest[1]);
        if (!rest[0] || !(lv >= 1 && lv <= 100)) err(`uso: ${cmd} <especie> <nivel 1-100>`);
        else code.push({ op: cmd.toLowerCase() as "battle" | "givemon", species: rest[0], level: lv });
        break;
      }
      case "warp": {
        const x = int(rest[1]), y = int(rest[2]);
        if (!rest[0] || isNaN(x) || isNaN(y)) err("uso: warp <mapa> <x> <y>"); else code.push({ op: "warp", map: rest[0], x, y });
        break;
      }
      default: err(`comando desconocido "${cmd}"`);
    }
  });
  if (stack.length) errors.push(`falta ${stack.length} "end"`);
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
const OP = { say: 1, give: 2, heal: 3, battle: 4, givemon: 5, warp: 6, flag: 10, unflag: 11, jif: 12, jmp: 13 } as const;

/** Compila las instrucciones a bytecode de 4 palabras + tablas de cadenas (la VM solo maneja números). */
export function compileScript(code: Instr[], engine: Pick<Engine, "flagId">): { words: Uint32Array; strings: string[] } {
  const strings: string[] = [];
  const sid = (t: string) => { let i = strings.indexOf(t); if (i < 0) i = strings.push(t) - 1; return i; };
  const words = new Uint32Array(code.length * 4);
  code.forEach((ins, i) => {
    let w: number[];
    switch (ins.op) {
      case "say": w = [OP.say, sid(ins.text), 0, 0]; break;
      case "give": w = [OP.give, sid(ins.item), ins.n, 0]; break;
      case "heal": w = [OP.heal, 0, 0, 0]; break;
      case "flag": w = [OP.flag, engine.flagId(ins.name), 0, 0]; break;
      case "unflag": w = [OP.unflag, engine.flagId(ins.name), 0, 0]; break;
      case "jif": w = [OP.jif, engine.flagId(ins.flag), ins.neg ? 1 : 0, ins.to]; break;
      case "jmp": w = [OP.jmp, ins.to, 0, 0]; break;
      case "battle": w = [OP.battle, sid(ins.species), ins.level, 0]; break;
      case "givemon": w = [OP.givemon, sid(ins.species), ins.level, 0]; break;
      case "warp": w = [OP.warp, sid(ins.map), ins.x, ins.y]; break;
    }
    words.set(w, i * 4);
  });
  return { words, strings };
}

/** Ejecuta un script en la VM de Rust; el host (ctx) resuelve los efectos y la VM decide el flujo. */
export async function runScript(code: Instr[], ctx: ScriptCtx, engine: Engine) {
  const { words, strings } = compileScript(code, engine);
  engine.vmLoad(words);
  let lines: string[] = [];
  const flush = async () => { if (lines.length) { const l = lines; lines = []; await ctx.say(l); } };
  for (;;) {
    const ev = engine.vmRun();
    if (ev === OP.say) { lines.push(strings[engine.vmArg(0)]); continue; }
    await flush();
    if (ev === 0) return;
    if (ev === 255) throw new Error("Error en la VM de scripts");
    const a = engine.vmArg(0), b = engine.vmArg(1), c = engine.vmArg(2);
    if (ev === OP.give) ctx.give(strings[a], b);
    else if (ev === OP.heal) ctx.heal();
    else if (ev === OP.battle) await ctx.battle(strings[a], b);
    else if (ev === OP.givemon) ctx.givemon(strings[a], b);
    else if (ev === OP.warp) { await ctx.warp(strings[a], b, c); return; } // el mapa cambia: termina el script
  }
}
