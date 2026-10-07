/** Mini-lenguaje de eventos para NPCs: una orden por línea. Se compila a instrucciones y se ejecuta de forma asíncrona. */

export type Item = "ball" | "potion";
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
give ball|potion <n>   da objetos
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
        if ((rest[0] !== "ball" && rest[0] !== "potion") || !(n >= 1)) err("uso: give ball|potion <n>");
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
  has(flag: string): boolean;
  set(flag: string, on: boolean): void;
  battle(species: string, level: number): Promise<void>;
  givemon(species: string, level: number): void;
  warp(map: string, x: number, y: number): Promise<void>;
}

export async function runScript(code: Instr[], ctx: ScriptCtx, maxSteps = 5000) {
  let pc = 0, steps = 0;
  while (pc < code.length && steps++ < maxSteps) {
    const ins = code[pc];
    switch (ins.op) {
      case "say": {
        const lines: string[] = [];
        while (pc < code.length && code[pc].op === "say") lines.push((code[pc++] as Extract<Instr, { op: "say" }>).text);
        await ctx.say(lines);
        continue;
      }
      case "give": ctx.give(ins.item, ins.n); break;
      case "heal": ctx.heal(); break;
      case "flag": ctx.set(ins.name, true); break;
      case "unflag": ctx.set(ins.name, false); break;
      case "jif": if (ctx.has(ins.flag) === ins.neg) { pc = ins.to; continue; } break;
      case "jmp": pc = ins.to; continue;
      case "battle": await ctx.battle(ins.species, ins.level); break;
      case "givemon": ctx.givemon(ins.species, ins.level); break;
      case "warp": await ctx.warp(ins.map, ins.x, ins.y); return; // el mapa cambia: termina el script
    }
    pc++;
  }
}
