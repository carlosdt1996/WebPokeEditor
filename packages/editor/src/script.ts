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
  | { op: "warp"; map: string; x: number; y: number }
  | { op: "call"; name: string; to: number }
  | { op: "ret" }
  | { op: "choice"; options: string[] }
  | { op: "setstr"; name: string; text: string }
  | { op: "host"; cmd: string; args: string[] };

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
def <nombre> ... end           define una función; call <nombre> la ejecuta; return sale de ella
choice <A> | <B> | <C>         menú de opciones; guarda el índice elegido (0, 1, 2…) en la variable choice
setstr <nombre> <texto>        variable de texto; se usa como {nombre} en say y choice
list <nombre> a | b | c        crea una lista de textos; push/pop/clear <lista> [valor]
len <lista> <var>              guarda el nº de elementos en una variable
get <lista> <índice|var> <txt> copia el elemento (0, 1, 2… o una variable) a una variable de texto
pick <lista> <txt>             elige un elemento al azar (reproducible)
upper <txt> · lower <txt>      cambia a mayúsculas/minúsculas · strlen <txt> <var> longitud
streq <txt> <texto> <var>      var = 1 si el texto es igual · contains <txt> <texto> <var> si lo contiene
nlist <nombre> 1 | 5 | 9       lista numérica · npush/npop/nclear <lista> [n|var]
nlen <lista> <var> · nget <lista> <índice|var> <var> · nset <lista> <índice|var> <n|var>
nsum <lista> <var> · nmax <lista> <var> · nsort <lista> (ascendente)
dict <nombre> clave=valor | k2=v2   diccionario de textos · dset <dic> <clave> <valor>
dget <dic> <clave> <txt> · dhas <dic> <clave> <var> · ddel <dic> <clave> · dlen <dic> <var>
substr <txt> <inicio> <largo> <txt-destino>   recorta · replace <txt> <buscar> | <poner> sustituye
num <txt> <var>                pasa un texto a número (0 si no lo es)
equip <objeto>                 equipa un objeto del inventario a la primera criatura libre
battle <especie> <nivel>   combate contra una criatura
givemon <especie> <nivel>  añade una criatura al equipo
warp <mapa> <x> <y>        teletransporta al jugador
Variables predefinidas: steps (pasos), party (nº de criaturas), level (nivel de la primera), money (monedas; «add money -50» cobra y «add money 50» paga) e item_<id> (cuántas unidades tienes de un objeto, p. ej. «if item_llave >= 1»).
# línea de comentario`;

export type ParseResult = { ok: true; code: Instr[] } | { ok: false; errors: string[] };

const IDENT = /^[A-Za-z_][\w-]*$/;
type Frame = { kind: "if" | "while" | "repeat" | "def"; cond: number; jmp?: number; start?: number; hv?: string; breaks: number[] };

export function parseScript(src: string): ParseResult {
  const code: Instr[] = [];
  const errors: string[] = [];
  const stack: Frame[] = [];
  const funcs = new Map<string, number>();
  const calls: { idx: number; name: string; line: number }[] = [];
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
      case "def": {
        const n = ident(rest[0]);
        if (stack.some((f) => f.kind === "def")) { err("no se puede definir una función dentro de otra"); stack.push({ kind: "def", cond: -1, breaks: [] }); break; }
        if (n && funcs.has(n)) err(`la función "${n}" ya está definida`);
        stack.push({ kind: "def", cond: -1, jmp: code.length, breaks: [] });
        code.push({ op: "jmp", to: -1 }); // salta por encima del cuerpo
        if (n) funcs.set(n, code.length);
        break;
      }
      case "call": {
        const n = ident(rest[0]);
        if (n) { calls.push({ idx: code.length, name: n, line: i + 1 }); code.push({ op: "call", name: n, to: -1 }); }
        break;
      }
      case "return": code.push({ op: "ret" }); break;
      case "setstr": {
        const n = ident(rest[0]);
        if (!rest[1]) { err("uso: setstr <nombre> <texto>"); break; }
        if (n) code.push({ op: "setstr", name: n, text: rest.slice(1).join(" ") });
        break;
      }
      case "choice": {
        const opts = arg.split("|").map((x) => x.trim()).filter(Boolean);
        if (opts.length < 2 || opts.length > 6) err("choice necesita entre 2 y 6 opciones separadas por |"); else code.push({ op: "choice", options: opts });
        break;
      }
      case "list": {
        const n = ident(rest[0]);
        const vals = rest.slice(1).join(" ").split("|").map((x) => x.trim()).filter(Boolean);
        if (!vals.length) { err("uso: list <nombre> a | b | c"); break; }
        if (n) code.push({ op: "host", cmd: "list", args: [n, ...vals] });
        break;
      }
      case "push": { const n = ident(rest[0]); if (!rest[1]) { err("uso: push <lista> <valor>"); break; } if (n) code.push({ op: "host", cmd: "push", args: [n, rest.slice(1).join(" ")] }); break; }
      case "pop": case "clear": { const n = ident(rest[0]); if (n) code.push({ op: "host", cmd: cmd, args: [n] }); break; }
      case "len": case "strlen": case "pick": case "upper": case "lower": {
        const want = cmd === "upper" || cmd === "lower" ? 1 : 2;
        const n = ident(rest[0]), v = want === 2 ? ident(rest[1]) : "";
        if (rest.length < want) { err(`uso: ${cmd} ${want === 2 ? "<nombre> <variable>" : "<texto>"}`); break; }
        if (n && v !== null) code.push({ op: "host", cmd, args: want === 2 ? [n, v] : [n] });
        break;
      }
      case "get": { const l = ident(rest[0]), t = ident(rest[2]); if (!rest[1]) { err("uso: get <lista> <índice|var> <texto>"); break; } if (l && t) code.push({ op: "host", cmd: "get", args: [l, rest[1], t] }); break; }
      case "streq": case "contains": {
        const n = ident(rest[0]), v = ident(rest[rest.length - 1]);
        if (rest.length < 3) { err(`uso: ${cmd} <txt> <texto> <variable>`); break; }
        if (n && v) code.push({ op: "host", cmd, args: [n, rest.slice(1, -1).join(" "), v] });
        break;
      }
      case "nlist": {
        const n = ident(rest[0]);
        const vals = rest.slice(1).join(" ").split("|").map((x) => x.trim()).filter(Boolean);
        if (!vals.length || vals.some((v) => isNaN(int(v)))) { err("uso: nlist <nombre> 1 | 5 | 9 (solo enteros)"); break; }
        if (n) code.push({ op: "host", cmd: "nlist", args: [n, ...vals] });
        break;
      }
      case "npush": case "nclear": case "npop": {
        const n = ident(rest[0]);
        if (cmd === "npush" && rest.length < 2) { err("uso: npush <lista> <n|var>"); break; }
        if (n) code.push({ op: "host", cmd, args: cmd === "npush" ? [n, rest[1]] : [n] });
        break;
      }
      case "nlen": case "nsum": case "nmax": { const n = ident(rest[0]), v = ident(rest[1]); if (rest.length < 2) { err(`uso: ${cmd} <lista> <variable>`); break; } if (n && v) code.push({ op: "host", cmd, args: [n, v] }); break; }
      case "nsort": { const n = ident(rest[0]); if (n) code.push({ op: "host", cmd, args: [n] }); break; }
      case "nget": { const l = ident(rest[0]), v = ident(rest[2]); if (rest.length < 3) { err("uso: nget <lista> <índice|var> <variable>"); break; } if (l && v) code.push({ op: "host", cmd, args: [l, rest[1], v] }); break; }
      case "nset": { const l = ident(rest[0]); if (rest.length < 3) { err("uso: nset <lista> <índice|var> <n|var>"); break; } if (l) code.push({ op: "host", cmd, args: [l, rest[1], rest[2]] }); break; }
      case "dict": {
        const n = ident(rest[0]);
        const pairs = rest.slice(1).join(" ").split("|").map((x) => x.trim()).filter(Boolean);
        if (!pairs.length || pairs.some((p) => !p.includes("="))) { err("uso: dict <nombre> clave=valor | clave=valor"); break; }
        if (n) code.push({ op: "host", cmd: "dict", args: [n, ...pairs] });
        break;
      }
      case "dset": { const d = ident(rest[0]); if (rest.length < 3) { err("uso: dset <dic> <clave> <valor>"); break; } if (d) code.push({ op: "host", cmd, args: [d, rest[1], rest.slice(2).join(" ")] }); break; }
      case "dget": case "dhas": { const d = ident(rest[0]), v = ident(rest[2]); if (rest.length < 3) { err(`uso: ${cmd} <dic> <clave> <variable>`); break; } if (d && v) code.push({ op: "host", cmd, args: [d, rest[1], v] }); break; }
      case "ddel": { const d = ident(rest[0]); if (rest.length < 2) { err("uso: ddel <dic> <clave>"); break; } if (d) code.push({ op: "host", cmd, args: [d, rest[1]] }); break; }
      case "dlen": { const d = ident(rest[0]), v = ident(rest[1]); if (rest.length < 2) { err("uso: dlen <dic> <variable>"); break; } if (d && v) code.push({ op: "host", cmd, args: [d, v] }); break; }
      case "substr": {
        const t = ident(rest[0]), o = ident(rest[3]);
        if (rest.length < 4 || isNaN(int(rest[1])) || isNaN(int(rest[2]))) { err("uso: substr <txt> <inicio> <largo> <destino>"); break; }
        if (t && o) code.push({ op: "host", cmd, args: [t, rest[1], rest[2], o] });
        break;
      }
      case "replace": {
        const t = ident(rest[0]);
        const [from, to] = rest.slice(1).join(" ").split("|").map((x) => x.trim());
        if (!from || to === undefined) { err("uso: replace <txt> <buscar> | <poner>"); break; }
        if (t) code.push({ op: "host", cmd, args: [t, from, to] });
        break;
      }
      case "num": { const t = ident(rest[0]), v = ident(rest[1]); if (rest.length < 2) { err("uso: num <txt> <variable>"); break; } if (t && v) code.push({ op: "host", cmd, args: [t, v] }); break; }
      case "equip": { const n = ident(rest[0]); if (n) code.push({ op: "host", cmd: "equip", args: [n] }); break; }
      case "break": {
        let loop: Frame | undefined;
        for (let k = stack.length - 1; k >= 0 && stack[k].kind !== "def"; k--) if (stack[k].kind !== "if") { loop = stack[k]; break; }
        if (!loop) { err("break fuera de un bucle"); break; }
        loop.breaks.push(code.length);
        code.push({ op: "jmp", to: -1 });
        break;
      }
      case "end": {
        const top = stack.pop();
        if (!top) { err("end sin if/while/repeat"); break; }
        if (top.kind === "def") {
          code.push({ op: "ret" });
          if (top.jmp !== undefined) patch(top.jmp, code.length);
        } else if (top.kind === "if") {
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
  for (const c of calls) {
    const to = funcs.get(c.name);
    if (to === undefined) errors.push(`línea ${c.line}: la función "${c.name}" no está definida`);
    else { const ins = code[c.idx]; if (ins.op === "call") ins.to = to; }
  }
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
  /** Muestra un menú y devuelve el índice elegido. */
  choose(options: string[]): Promise<number>;
  /** Equipa un objeto a una criatura del equipo. */
  equip(item: string): void;
}

/** Códigos de operación del bytecode (deben coincidir con crates/engine-core). */
const OP = { say: 1, give: 2, heal: 3, battle: 4, givemon: 5, warp: 6, choice: 7, setstr: 8, host: 9, flag: 10, unflag: 11, jif: 12, jmp: 13, set: 20, add: 21, cmp: 22, jnc: 23, call: 30, ret: 31 } as const;

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
      case "call": put(k, [OP.call, at[ins.to], 0, 0]); break;
      case "ret": put(k, [OP.ret, 0, 0, 0]); break;
      case "choice": put(k, [OP.choice, sid(ins.options.join("|")), 0, 0]); break;
      case "setstr": put(k, [OP.setstr, sid(ins.name), sid(ins.text), 0]); break;
      case "host": put(k, [OP.host, sid([ins.cmd, ...ins.args].join("\u0001")), 0, 0]); break;
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
    const interp = (t: string) => t.replace(/\{([A-Za-z_][\w-]*)\}/g, (_, n: string) => engine.getStr(n) ?? String(engine.getVar(n)));
    if (ev === OP.say) { lines.push(interp(strings[engine.vmArg(0)])); continue; }
    // las operaciones puras (texto, listas) no interrumpen el cuadro de diálogo: los `say` contiguos siguen agrupados
    if (ev !== OP.setstr && ev !== OP.host) await flush();
    if (ev === 0) return;
    if (ev === 255) throw new Error("Error en la VM de scripts (¿bucle infinito sin acciones?)");
    const a = engine.vmArg(0), b = engine.vmArg(1), c = engine.vmArg(2);
    if (ev === OP.give) ctx.give(strings[a], b);
    else if (ev === OP.heal) ctx.heal();
    else if (ev === OP.battle) await ctx.battle(strings[a], b);
    else if (ev === OP.givemon) ctx.givemon(strings[a], b);
    else if (ev === OP.setstr) engine.setStr(strings[a], interp(strings[b]));
    else if (ev === OP.host) hostOp(strings[a].split("\u0001"), engine, interp, ctx);
    else if (ev === OP.choice) engine.setVar("choice", await ctx.choose(strings[a].split("|").map(interp)));
    else if (ev === OP.warp) { await ctx.warp(strings[a], b, c); return; } // el mapa cambia: termina el script
  }
}

/** Orden de host: listas, operaciones con texto y equipar objetos. Las listas y los textos viven en el motor (JS); las variables numéricas, en la VM. */
function hostOp(parts: string[], engine: Engine, interp: (t: string) => string, ctx: ScriptCtx) {
  const [cmd, ...a] = parts;
  const list = (n: string) => engine.lists.get(n) ?? engine.lists.set(n, []).get(n)!;
  const str = (n: string) => engine.getStr(n) ?? "";
  const idxOf = (v: string) => (/^-?\d+$/.test(v) ? +v : engine.getVar(v));
  const numOf = idxOf;
  const nlist = (n: string) => engine.nlists.get(n) ?? engine.nlists.set(n, []).get(n)!;
  const dict = (n: string) => engine.dicts.get(n) ?? engine.dicts.set(n, new Map()).get(n)!;
  switch (cmd) {
    case "list": engine.lists.set(a[0], a.slice(1).map(interp)); break;
    case "push": list(a[0]).push(interp(a[1])); break;
    case "pop": list(a[0]).pop(); break;
    case "clear": engine.lists.set(a[0], []); break;
    case "len": engine.setVar(a[1], list(a[0]).length); break;
    case "get": { const l = list(a[0]), i = idxOf(a[1]); engine.setStr(a[2], l[i] ?? ""); break; }
    case "pick": { const l = list(a[0]); engine.setStr(a[1], l.length ? l[engine.rand(l.length)] : ""); break; }
    case "upper": engine.setStr(a[0], str(a[0]).toUpperCase()); break;
    case "lower": engine.setStr(a[0], str(a[0]).toLowerCase()); break;
    case "strlen": engine.setVar(a[1], str(a[0]).length); break;
    case "streq": engine.setVar(a[2], str(a[0]) === interp(a[1]) ? 1 : 0); break;
    case "contains": engine.setVar(a[2], str(a[0]).includes(interp(a[1])) ? 1 : 0); break;
    case "nlist": engine.nlists.set(a[0], a.slice(1).map(Number)); break;
    case "npush": nlist(a[0]).push(numOf(a[1])); break;
    case "npop": nlist(a[0]).pop(); break;
    case "nclear": engine.nlists.set(a[0], []); break;
    case "nlen": engine.setVar(a[1], nlist(a[0]).length); break;
    case "nget": engine.setVar(a[2], nlist(a[0])[numOf(a[1])] ?? 0); break;
    case "nset": { const l = nlist(a[0]), i = numOf(a[1]); if (i >= 0 && i < l.length) l[i] = numOf(a[2]); break; }
    case "nsum": engine.setVar(a[1], nlist(a[0]).reduce((x, y) => x + y, 0)); break;
    case "nmax": { const l = nlist(a[0]); engine.setVar(a[1], l.length ? Math.max(...l) : 0); break; }
    case "nsort": nlist(a[0]).sort((x, y) => x - y); break;
    case "dict": engine.dicts.set(a[0], new Map(a.slice(1).map((p) => { const k = p.indexOf("="); return [interp(p.slice(0, k).trim()), interp(p.slice(k + 1).trim())] as [string, string]; }))); break;
    case "dset": dict(a[0]).set(interp(a[1]), interp(a[2])); break;
    case "dget": engine.setStr(a[2], dict(a[0]).get(interp(a[1])) ?? ""); break;
    case "dhas": engine.setVar(a[2], dict(a[0]).has(interp(a[1])) ? 1 : 0); break;
    case "ddel": dict(a[0]).delete(interp(a[1])); break;
    case "dlen": engine.setVar(a[1], dict(a[0]).size); break;
    case "substr": engine.setStr(a[3], str(a[0]).substr(numOf(a[1]), numOf(a[2]))); break;
    case "replace": engine.setStr(a[0], str(a[0]).split(interp(a[1])).join(interp(a[2]))); break;
    case "num": { const n = parseInt(str(a[0]), 10); engine.setVar(a[1], Number.isFinite(n) ? n : 0); break; }
    case "equip": ctx.equip(a[0]); break;
  }
}

/** Guion compilado en formato portable (JSON): sirve para precompilar al exportar y evitar volver a analizar el texto. */
export function serializeScript(code: Instr[]): string {
  return JSON.stringify({ v: 1, code });
}
const JUMPS = new Set(["jif", "jcmp", "jmp", "call"]);
const OPS = new Set(["say", "give", "heal", "flag", "unflag", "set", "add", "jif", "jcmp", "jmp", "battle", "givemon", "warp", "call", "ret", "choice", "setstr", "host"]);
/** Lee un guion serializado y lo valida (operaciones conocidas y saltos dentro del programa); lanza un error si no es válido. */
export function deserializeScript(json: string): Instr[] {
  const d = JSON.parse(json) as { v?: number; code?: unknown };
  if (d?.v !== 1 || !Array.isArray(d.code)) throw new Error("Guion serializado no válido");
  const code = d.code as Instr[];
  for (const [i, ins] of code.entries()) {
    if (!ins || typeof ins !== "object" || !OPS.has(ins.op)) throw new Error(`Instrucción ${i}: operación desconocida`);
    if (JUMPS.has(ins.op)) {
      const to = (ins as { to: number }).to;
      if (!Number.isInteger(to) || to < 0 || to > code.length) throw new Error(`Instrucción ${i}: salto fuera del programa`);
    }
  }
  return code;
}
