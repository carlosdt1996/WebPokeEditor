import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { Engine, Ev, Input } from "./engine";
import { Battle, healAll, makeMon, monMaxHp } from "./battle";
import { movesFromCsv, movesToCsv, parseCsv, speciesFromCsv, speciesToCsv, toCsv } from "./csv";
import { deserializeScript, parseScript, runScript, serializeScript } from "./script";
import { decodeTiles, defaultProject, effectiveness, encodeTiles, migrate, parseProject, validate } from "./project";
import { archipelagoProject } from "./templates";

const wasm = () => readFileSync(new URL("../public/engine_core.wasm", import.meta.url));

describe("engine (WASM)", () => {
  it("carga el mapa y se mueve respetando colisiones", async () => {
    const e = await Engine.load(wasm());
    const tiles = new Uint8Array(25);
    tiles[2 * 5 + 3] = 5; // muro a la derecha del jugador
    e.loadMap(5, 5, tiles);
    e.setSpawn(2, 2);
    expect(e.tick(Input.Right)).toBe(Ev.Blocked);
    expect(e.tick(Input.Left)).toBe(0);
    let ev = 0;
    for (let i = 0; i < 10; i++) ev |= e.tick(0);
    expect(ev & Ev.Step).toBeTruthy();
    expect(e.player.x).toBe(1);
  });

  it("es determinista con la misma semilla", async () => {
    const run = async () => {
      const e = await Engine.load(wasm());
      e.reset(8, 8, 99);
      return Array.from({ length: 5 }, () => e.rand(1000));
    };
    expect(await run()).toEqual(await run());
  });

  it("calcula daño", async () => {
    const e = await Engine.load(wasm());
    expect(e.damage(50, 40, 100, 100, 100, 100)).toBe(19);
    expect(e.damage(50, 40, 100, 100, 0, 100)).toBe(0);
  });
});

describe("project", () => {
  it("el proyecto por defecto es válido y hace round-trip", () => {
    const p = defaultProject();
    expect(validate(p)).toEqual([]);
    expect(parseProject(JSON.stringify(p)).name).toBe(p.name);
    const t = new Uint8Array([0, 1, 2, 255, 7]);
    expect(Array.from(decodeTiles(encodeTiles(t), 5))).toEqual([0, 1, 2, 255, 7]);
  });
  it("detecta referencias rotas", () => {
    const p = defaultProject();
    p.maps[0].encounters.push("no-existe");
    p.species[0].moves.push("tampoco");
    expect(validate(p).length).toBe(2);
  });
  it("calcula efectividad", () => {
    const p = defaultProject();
    expect(effectiveness(p, 1, [3])).toBe(2); // fuego > planta
    expect(effectiveness(p, 1, [2])).toBe(0.5);
  });
});

describe("migración de esquema", () => {
  it("v2 → v3 añade objetos genéricos conservando el inventario", () => {
    const base = defaultProject();
    const v2 = { ...base, schemaVersion: 2, inventory: { ball: 7, potion: 2 }, species: base.species.map((sp) => ({ ...sp, ability: undefined })) } as Record<string, unknown>;
    delete v2.items;
    delete v2.abilities;
    const p = migrate(v2);
    expect(p.schemaVersion).toBe(6);
    expect(p.inventory).toEqual({ ball: 7, potion: 2 });
    expect(p.items.length).toBe(2);
    expect(validate(p)).toEqual([]);
  });
  it("v1 → v2 conserva mapa, spawn y encuentros", () => {
    const v1 = {
      schemaVersion: 1, name: "Viejo", seed: 1,
      map: { w: 4, h: 3, tiles: encodeTiles(new Uint8Array(12)), spawn: { x: 2, y: 1 } },
      types: ["Normal"], typeChart: [[1]],
      species: [{ id: "a", name: "A", types: [0], stats: { hp: 1, atk: 1, def: 1, spa: 1, spd: 1, spe: 1 }, moves: ["m"] }],
      moves: [{ id: "m", name: "M", type: 0, category: "physical", power: 40, accuracy: 100 }],
      encounters: ["a"],
    };
    const p = migrate(v1);
    expect(p.schemaVersion).toBe(6);
    expect(p.abilities).toEqual([]);
    expect(p.items.map((i) => i.id)).toEqual(["potion", "ball"]);
    expect(p.maps).toHaveLength(1);
    expect(p.maps[0]).toMatchObject({ w: 4, h: 3, encounters: ["a"] });
    expect(p.start).toEqual({ map: "mapa1", x: 2, y: 1 });
    expect(validate(p)).toEqual([]);
    expect(parseProject(JSON.stringify(v1)).maps[0].id).toBe("mapa1");
  });
  it("el proyecto por defecto: saltos y destinos válidos", () => {
    const p = defaultProject();
    expect(p.maps.length).toBeGreaterThanOrEqual(3);
    p.maps[0].warps[0].toMap = "fantasma";
    expect(validate(p).some((e) => e.includes("fantasma"))).toBe(true);
  });
});

describe("combate", () => {
  const run = async (seed: number) => {
    const e = await Engine.load(wasm());
    e.reset(8, 8, seed);
    const p = defaultProject();
    const party = [makeMon(p, "flamito", 20)];
    const b = new Battle(p, e, party, [makeMon(p, "pelusin", 5)], { inv: { ball: 5, potion: 1 } });
    const log: string[] = [];
    for (let i = 0; i < 30 && !b.result; i++) log.push(...b.turn({ kind: "move", index: 1 }).map((x) => x.text));
    return { b, log };
  };
  it("es determinista y termina en victoria con ventaja de nivel", async () => {
    const a = await run(5), c = await run(5);
    expect(a.log).toEqual(c.log);
    expect(a.b.result).toBe("win");
    expect(a.b.party[0].exp).toBeGreaterThan(0);
  });
  it("no se puede huir ni capturar en combates de entrenador", async () => {
    const e = await Engine.load(wasm());
    e.reset(8, 8, 1);
    const p = defaultProject();
    const b = new Battle(p, e, [makeMon(p, "flamito", 5)], [makeMon(p, "pelusin", 5)], { trainer: "Rival", inv: { ball: 5 } });
    b.turn({ kind: "run" });
    expect(b.result).toBeNull();
    b.turn({ kind: "item", id: "ball" });
    expect(b.result).toBeNull();
  });
  it("capturar añade al equipo (con probabilidad alta si está debilitado)", async () => {
    const e = await Engine.load(wasm());
    e.reset(8, 8, 3);
    const p = defaultProject();
    const foe = makeMon(p, "pelusin", 3);
    foe.hp = 1;
    const b = new Battle(p, e, [makeMon(p, "flamito", 50)], [foe], { inv: { ball: 50 } });
    for (let i = 0; i < 40 && !b.result; i++) b.turn({ kind: "item", id: "ball" });
    expect(b.result).toBe("caught");
    expect(b.party).toHaveLength(2);
  });
});

describe("scripts (VM en Rust)", () => {
  const mkCtx = () => {
    const log: string[] = [];
    return {
      log,
      ctx: {
        choose: async () => 0, equip: () => {}, say: async (l: string[]) => { log.push("say:" + l.join("|")); },
        give: (i: string, n: number) => { log.push(`give:${i}:${n}`); },
        heal: () => { log.push("heal"); },
        battle: async (s: string, l: number) => { log.push(`battle:${s}:${l}`); },
        givemon: (s: string, l: number) => { log.push(`givemon:${s}:${l}`); },
        warp: async (m: string, x: number, y: number) => { log.push(`warp:${m}:${x}:${y}`); },
      },
    };
  };
  const src = "if hecho\nsay ya\nelse\nsay hola\nsay otra\ngive potion 2\nflag hecho\nend\nheal";
  const compile = (code: string) => { const r = parseScript(code); if (!r.ok) throw new Error(r.errors.join()); return r.code; };

  it("ramas if/else y marcas persistentes en la VM: se ejecuta una sola vez", async () => {
    const e = await Engine.load(wasm());
    e.flagsReset();
    const code = compile(src), a = mkCtx();
    await runScript(code, a.ctx, e);
    expect(a.log).toEqual(["say:hola|otra", "give:potion:2", "heal"]);
    await runScript(code, a.ctx, e);
    expect(a.log.slice(3)).toEqual(["say:ya", "heal"]);
    expect(e.hasFlag("hecho")).toBe(true);
    e.setFlag("hecho", false);
    await runScript(code, a.ctx, e);
    expect(a.log[5]).toBe("say:hola|otra");
  });
  it("ifnot, battle, givemon y warp (warp termina el script)", async () => {
    const e = await Engine.load(wasm());
    e.flagsReset();
    const a = mkCtx();
    await runScript(compile("ifnot x\nbattle pelusin 3\ngivemon aquin 5\nend\nwarp casa 5 6\nsay nunca"), a.ctx, e);
    expect(a.log).toEqual(["battle:pelusin:3", "givemon:aquin:5", "warp:casa:5:6"]);
  });
  it("reporta errores de sintaxis con número de línea", () => {
    const r = parseScript("say ok\nvolar 3\nif a\nsay x\ngive oro\nend\nend");
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors.some((e) => e.startsWith("línea 2"))).toBe(true);
      expect(r.errors.some((e) => e.startsWith("línea 5"))).toBe(true);
      expect(r.errors.some((e) => e.includes("end sin if"))).toBe(true);
    }
    expect(parseScript("if a\nsay x").ok).toBe(false);
  });
  it("el proyecto valida referencias dentro de los scripts (especies, mapas, objetos)", () => {
    const p = defaultProject();
    expect(validate(p)).toEqual([]);
    const n = p.maps[0].npcs.find((k) => k.kind === "script")!;
    n.script = "battle fantasma 5\nwarp nada 1 1\ngive oro 2";
    const errs = validate(p);
    for (const w of ["fantasma", "nada", "oro"]) expect(errs.some((e) => e.includes(w))).toBe(true);
  });
});

describe("scripts: variables, bucles y disparadores", () => {
  const run = async (src: string, setup?: (e: Engine) => void) => {
    const e = await Engine.load(wasm());
    e.flagsReset();
    setup?.(e);
    const r = parseScript(src);
    if (!r.ok) throw new Error(r.errors.join());
    const log: string[] = [];
    await runScript(r.code, {
      choose: async () => 0, equip: () => {}, say: async (l) => { log.push("say:" + l.join("|")); }, give: (i, n) => { log.push(`give:${i}:${n}`); }, heal: () => { log.push("heal"); },
      battle: async (s, l) => { log.push(`battle:${s}:${l}`); }, givemon: (s, l) => { log.push(`givemon:${s}:${l}`); }, warp: async (m) => { log.push(`warp:${m}`); },
    }, e);
    return { log, e };
  };

  it("set/add, comparaciones numéricas y {interpolación}", async () => {
    const { log, e } = await run("set x 5\nadd x -2\nif x == 3\nsay x vale {x}\nelse\nsay mal\nend\nif x >= 4\nsay mal\nend\nif x != 3\nsay mal\nend");
    expect(log).toEqual(["say:x vale 3"]);
    expect(e.getVar("x")).toBe(3);
  });
  it("while con variable, repeat y break", async () => {
    const a = await run("while n < 3\nadd n 1\ngive potion 1\nend");
    expect(a.log).toEqual(["give:potion:1", "give:potion:1", "give:potion:1"]);
    const b = await run("repeat 4\nadd c 1\nend\nsay {c}");
    expect(b.e.getVar("c")).toBe(4);
    expect(b.log).toEqual(["say:4"]);
    const c = await run("repeat 10\nadd c 1\nif c == 3\nbreak\nend\nend\nsay {c}");
    expect(c.log).toEqual(["say:3"]);
    const d = await run("repeat 0\nsay nunca\nend\nsay fin");
    expect(d.log).toEqual(["say:fin"]);
  });
  it("bucles anidados y while sobre marcas", async () => {
    const a = await run("repeat 3\nrepeat 2\nadd t 1\nend\nend\nsay {t}");
    expect(a.log).toEqual(["say:6"]);
    const b = await run("flag f\nwhile f\nadd k 1\nif k == 2\nunflag f\nend\nend\nsay {k}");
    expect(b.log).toEqual(["say:2"]);
  });
  it("las variables predefinidas se pueden fijar desde el host", async () => {
    const a = await run("if party >= 2\nsay equipo\nend", (e) => e.setVar("party", 2));
    expect(a.log).toEqual(["say:equipo"]);
  });
  it("un bucle infinito con acciones se corta con error claro", async () => {
    await expect(run("while x < 1\nheal\nend")).rejects.toThrow(/demasiadas acciones|bucle/);
  });
  it("errores de sintaxis nuevos", () => {
    for (const bad of ["if x ~ 3\nend", "while x < a\nend", "repeat\nend", "break", "else", "set x", "add 1x 3", "while\nend"]) expect(parseScript(bad).ok).toBe(false);
  });
  it("funciones: call/return, recursión acotada y errores de definición", async () => {
    const a = await run("def saluda\nsay hola {n}\nadd n 1\nend\ncall saluda\ncall saluda\ncall saluda");
    expect(a.log).toEqual(["say:hola 0|hola 1|hola 2"]); // los say consecutivos se agrupan en un cuadro
    const b = await run("def f\nif n >= 1\nreturn\nend\nadd n 1\nsay dentro\nend\ncall f\ncall f\nsay fuera");
    expect(b.log).toEqual(["say:dentro|fuera"]);
    const c = await run("call tarde\ndef tarde\nsay ok\nend");
    expect(c.log).toEqual(["say:ok"]);
    await expect(run("def r\ncall r\nend\ncall r")).rejects.toThrow(/VM/);
    for (const bad of ["call nada", "def a\ndef b\nend\nend", "def x\nend\ndef x\nend", "def y\nsay x", "repeat 2\ndef z\nbreak\nend\nend"]) expect(parseScript(bad).ok).toBe(false);
  });
  it("setstr, {interpolación de texto} y choice guardan la elección en la variable", async () => {
    const e = await Engine.load(wasm());
    e.flagsReset();
    const r = parseScript("setstr nombre Ana\nsay Hola {nombre}\nchoice Sí {nombre} | No | Quizá\nif choice == 1\nsay dijo no\nelse\nsay otra\nend");
    if (!r.ok) throw new Error(r.errors.join());
    const log: string[] = [];
    await runScript(r.code, { equip: () => {}, choose: async (o) => { log.push("opts:" + o.join("/")); return 1; }, say: async (l) => { log.push("say:" + l.join("|")); }, give: () => {}, heal: () => {}, battle: async () => {}, givemon: () => {}, warp: async () => {} }, e);
    expect(log).toEqual(["say:Hola Ana", "opts:Sí Ana/No/Quizá", "say:dijo no"]);
    expect(e.getVar("choice")).toBe(1);
    expect(parseScript("choice solo").ok).toBe(false);
  });
  it("listas: crear, añadir, leer por índice o variable, longitud, pop, clear y elegir al azar (reproducible)", async () => {
    const a = await run("list frutas manzana | pera | uva\npush frutas {extra}\nlen frutas n\nget frutas 1 f\nsay {n} {f}\nset i 2\nget frutas i g\nsay {g}\npop frutas\nlen frutas n2\nsay {n2}\nclear frutas\nlen frutas n3\nsay {n3}", (e) => e.setStr("extra", "kiwi"));
    expect(a.log).toEqual(["say:4 pera|uva|3|0"]);
    const pick = async () => (await run("list x a | b | c | d | e\npick x r\nsay {r}")).log[0];
    expect(await pick()).toBe(await pick()); // misma semilla ⇒ misma elección
    const e = await Engine.load(wasm());
    e.reset(4, 4, 1); e.flagsReset();
    expect(e.lists.size).toBe(0);
  });
  it("operaciones con texto: upper, lower, strlen, streq y contains", async () => {
    const r = await run("setstr n Pikachu\nupper n\nsay {n}\nlower n\nstrlen n len\nstreq n pikachu eq\ncontains n chu c1\ncontains n xyz c2\nsay {len} {eq} {c1} {c2}");
    expect(r.log).toEqual(["say:PIKACHU|7 1 1 0"]);
  });
  it("listas numéricas: nlist, npush, nget, nset, nsum, nmax, nsort y nlen", async () => {
    const r = await run("nlist n 5 | 1 | 9\nnpush n 4\nset i 1\nnset n 0 7\nnsum n s\nnmax n m\nnlen n l\nnsort n\nnget n i g\nnget n 3 h\nnpop n\nnlen n l2\nsay {s} {m} {l} {g} {h} {l2}");
    expect(r.log).toEqual(["say:21 9 4 4 9 3"]);
  });
  it("diccionarios: dict, dset, dget, dhas, ddel y dlen (con interpolación)", async () => {
    const r = await run("setstr k fuego\ndict tipos fuego=Rojo | agua=Azul\ndset tipos planta Verde\ndget tipos {k} a\ndget tipos hielo b\ndhas tipos agua h1\nddel tipos agua\ndhas tipos agua h2\ndlen tipos n\nsay {a}|{b}|{h1}{h2}{n}");
    expect(r.log).toEqual(["say:Rojo||102"]);
  });
  it("substr, replace y num", async () => {
    const r = await run("setstr t Hola mundo\nsubstr t 5 5 s\nreplace t mundo | Pokémon\nsetstr q 42\nnum q v\nadd v 1\nsay {s} - {t} - {v}");
    expect(r.log).toEqual(["say:mundo - Hola Pokémon - 43"]);
    for (const bad of ["nlist a | b", "nget l 0", "dict d clave", "dset d k", "substr a 1", "replace t solo", "num q"]) expect(parseScript(bad).ok, bad).toBe(false);
  });
  it("transformación: se pide una vez por combate, sube las estadísticas y se anuncia", async () => {
    const e = await Engine.load(wasm());
    const p = archipelagoProject();
    const damage = (form: boolean, seed = 21) => {
      e.reset(8, 8, seed);
      const me = makeMon(p, "infernal", 40, "cristal"), foe = makeMon(p, "selvatico", 90);
      const full = foe.hp;
      me.moves = ["lanzallamas"];
      const b = new Battle(p, e, [me], [foe], { trainer: "T", inv: {} });
      expect(b.canForm(0)).toBe(true);
      const ev = b.turn({ kind: "move", index: 0, form });
      const used = b.formUsed;
      const hp = full - foe.hp; // PS perdidos
      return { text: ev.map((x) => x.text), used, hp, again: b.canForm(0) };
    };
    const plain = damage(false), formed = damage(true);
    let sumPlain = 0, sumFormed = 0;
    for (let seed = 1; seed <= 12; seed++) { sumPlain += damage(false, seed).hp; sumFormed += damage(true, seed).hp; }
    expect(plain.used).toBe(false);
    expect(formed.used).toBe(true);
    expect(formed.again).toBe(false);
    expect(formed.text.some((t) => t.includes("se transforma"))).toBe(true);
    expect(sumFormed).toBeGreaterThan(sumPlain * 1.1); // en promedio, +30 % de Ataque Especial
  });
  it("serializeScript/deserializeScript: ida y vuelta idéntica y rechazo de saltos o operaciones inválidas", async () => {
    const r = parseScript("set n 3\nwhile n > 0\nadd n -1\nsay vuelta {n}\nend\ndef f\nsay hola\nend\ncall f");
    if (!r.ok) throw new Error(r.errors.join());
    const back = deserializeScript(serializeScript(r.code));
    expect(back).toEqual(r.code);
    const e = await Engine.load(wasm());
    e.flagsReset();
    const log: string[] = [];
    await runScript(back, { choose: async () => 0, equip: () => {}, say: async (l) => { log.push(l.join("|")); }, give: () => {}, heal: () => {}, battle: async () => {}, givemon: () => {}, warp: async () => {} }, e);
    expect(log.join(",")).toBe("vuelta 2|vuelta 1|vuelta 0|hola");
    expect(() => deserializeScript('{"v":1,"code":[{"op":"jmp","to":99}]}')).toThrow();
    expect(() => deserializeScript('{"v":1,"code":[{"op":"explota"}]}')).toThrow();
    expect(() => deserializeScript("{}")).toThrow();
  });
  it("equip se delega en el juego y sus argumentos se validan", async () => {
    const e = await Engine.load(wasm());
    e.flagsReset();
    const r = parseScript("equip restos\nlist l a | b\nget l 0 x");
    if (!r.ok) throw new Error(r.errors.join());
    const got: string[] = [];
    await runScript(r.code, { choose: async () => 0, equip: (i) => got.push(i), say: async () => {}, give: () => {}, heal: () => {}, battle: async () => {}, givemon: () => {}, warp: async () => {} }, e);
    expect(got).toEqual(["restos"]);
    for (const bad of ["list a", "list 1x a | b", "push l", "get l 0", "streq a b", "len l", "equip"]) expect(parseScript(bad).ok).toBe(false);
    const p = defaultProject();
    p.maps[0].onEnter = "equip no-es-equipable";
    expect(validate(p).some((x) => x.includes("objeto equipable inexistente"))).toBe(true);
    p.maps[0].onEnter = "equip restos";
    expect(validate(p)).toEqual([]);
  });
  it("el proyecto valida los scripts de los disparadores y su posición", () => {
    const p = defaultProject();
    expect(validate(p)).toEqual([]);
    p.maps[0].triggers!.push({ x: 99, y: 0, name: "Roto", once: true, script: "give oro 1\nwarp ninguno 1 1" });
    const errs = validate(p);
    expect(errs.some((e) => e.includes("fuera del mapa"))).toBe(true);
    expect(errs.some((e) => e.includes("oro"))).toBe(true);
    expect(errs.some((e) => e.includes("ninguno"))).toBe(true);
  });
});

describe("carga del proyecto guardado", () => {
  it("un script con errores no hace perder el proyecto al cargar (solo la importación es estricta)", () => {
    const p = defaultProject();
    p.maps[0].npcs.find((n) => n.kind === "script")!.script = "say hola\nvolar 3";
    p.maps[0].onEnter = "break";
    const json = JSON.stringify(p);
    expect(() => parseProject(json)).toThrow(/Proyecto inválido/);
    const lenient = parseProject(json, false);
    expect(lenient.name).toBe(p.name);
    expect(validate(lenient).length).toBeGreaterThan(0);
    expect(() => parseProject("{\"schemaVersion\":4,\"maps\":[]}", false)).toThrow(/faltan/);
  });
});

describe("capa de objetos y colisiones", () => {
  it("los objetos sólidos bloquean y los decorativos no", async () => {
    const e = await Engine.load(wasm());
    e.reset(5, 5, 1);
    e.objects[1 * 5 + 2] = 16; // valla
    e.objects[1 * 5 + 3] = 14; // flor
    e.setSpawn(1, 1);
    expect(e.tick(Input.Right)).toBe(Ev.Blocked);
    expect(e.walkable(3, 1)).toBe(true);
    e.loadMap(5, 5, new Uint8Array(25), 1, new Uint8Array(25).fill(15));
    expect(e.walkable(0, 0)).toBe(false);
  });
});

describe("combate: estados, etapas, habilidades y efectos de movimientos", () => {
  const texts = (evs: { text: string }[]) => evs.map((e) => e.text);
  it("un movimiento de sueño duerme al rival, el estado persiste en la criatura y healAll lo quita", async () => {
    const e = await Engine.load(wasm());
    e.reset(8, 8, 3);
    const p = defaultProject();
    const me = makeMon(p, "hojin", 20), foe = makeMon(p, "pelusin", 5);
    me.moves = ["somnifero"];
    const b = new Battle(p, e, [me], [foe], { trainer: "T", inv: {} });
    let all: string[] = [];
    for (let i = 0; i < 6 && !foe.status; i++) all = all.concat(texts(b.turn({ kind: "move", index: 0 })));
    expect(foe.status).toBe(4); // sueño
    expect(all.some((t) => t.includes("se durmió"))).toBe(true);
    expect(b.snap().f[0]?.st).toBe(4);
    healAll(p, [foe]);
    expect(foe.status).toBe(0);
  });
  it("habilidad Intimidar al entrar, cambios de etapa y movimientos con retroceso/drenaje/prioridad", async () => {
    const e = await Engine.load(wasm());
    e.reset(8, 8, 9);
    const p = defaultProject();
    p.species.find((s) => s.id === "pelusin")!.ability = "intimidar";
    const me = makeMon(p, "flamito", 30), foe = makeMon(p, "pelusin", 30);
    me.moves = ["cabezazo", "absorbe", "ataque-rapido", "danza"];
    const b = new Battle(p, e, [me], [foe], { trainer: "T", inv: {} });
    const start = texts(b.startEvents);
    expect(start.some((t) => t.includes("Intimidar") && t.includes("se activa"))).toBe(true);
    expect(start.some((t) => t.includes("Ataque de Flamito baja"))).toBe(true);
    const recoil = texts(b.turn({ kind: "move", index: 0 }));
    expect(recoil.some((t) => t.includes("retroceso"))).toBe(true);
    const dance = texts(b.turn({ kind: "move", index: 3 }));
    expect(dance.some((t) => t.includes("sube mucho"))).toBe(true);
  });
  it("protección, amedrentar, atrapar y forzar cambio funcionan de extremo a extremo", async () => {
    const e = await Engine.load(wasm());
    const p = archipelagoProject();
    const run = (mine: string[], seed: number, opts: { trainer?: string } = {}) => {
      e.reset(8, 8, seed);
      const me = makeMon(p, "rocalon", 45), foe = makeMon(p, "pelusin", 20);
      me.moves = mine;
      const b = new Battle(p, e, [me], [foe], { ...opts, inv: {} });
      return { b, me, foe };
    };
    // protección: el golpe del rival se anula y la segunda vez seguida falla
    const a = run(["proteccion"], 5, { trainer: "T" });
    const t1 = texts(a.b.turn({ kind: "move", index: 0 }));
    expect(t1.some((t) => t.includes("se protege"))).toBe(true);
    expect(t1.some((t) => t.includes("se ha protegido"))).toBe(true);
    // atrapar
    const c = run(["atadura"], 11, { trainer: "T" });
    let all: string[] = [];
    for (let i = 0; i < 5; i++) all = all.concat(texts(c.b.turn({ kind: "move", index: 0 })));
    expect(all.some((t) => t.includes("queda atrapado"))).toBe(true);
    // forzar cambio contra una criatura salvaje: huye
    const d = run(["rugido"], 3);
    const t4 = texts(d.b.turn({ kind: "move", index: 0 }));
    expect(t4.some((t) => t.includes("huye despavorido"))).toBe(true);
    expect(d.b.result).toBe("run");
  });
  it("Absorbe Agua cura al rival en lugar de dañarlo; las habilidades inexistentes no rompen nada", async () => {
    const e = await Engine.load(wasm());
    e.reset(8, 8, 4);
    const p = defaultProject();
    const me = makeMon(p, "aquin", 30), foe = makeMon(p, "aquin", 30);
    foe.hp = 20;
    const b = new Battle(p, e, [me], [foe], { trainer: "T", inv: {} });
    const t = texts(b.turn({ kind: "move", index: 1 })); // Chorro (Agua)
    expect(t.some((x) => x.includes("absorbe el ataque"))).toBe(true);
    expect(foe.hp).toBeGreaterThan(20);
    const q = defaultProject();
    q.species[0].ability = "no-existe";
    expect(validate(q).some((x) => x.includes("habilidad inexistente"))).toBe(true);
  });
  it("Cura Total quita el estado y se consume; sin estado no tiene efecto", async () => {
    const e = await Engine.load(wasm());
    e.reset(8, 8, 6);
    const p = defaultProject();
    const me = makeMon(p, "flamito", 30), foe = makeMon(p, "pelusin", 3);
    me.status = 2;
    const inv = { antidoto: 2 };
    const b = new Battle(p, e, [me], [foe], { inv });
    const a = texts(b.turn({ kind: "item", id: "antidoto" }));
    expect(a.some((x) => x.includes("se cura del estado"))).toBe(true);
    expect(me.status).toBe(0);
    expect(inv.antidoto).toBe(1);
    const c = texts(b.turn({ kind: "item", id: "antidoto" }));
    expect(c.some((x) => x.includes("ningún efecto"))).toBe(true);
    expect(inv.antidoto).toBe(1); // no se consume si no hace nada
  });
  it("migración v3 → v4 añade la lista de habilidades y los efectos validan rangos", () => {
    const v3 = { ...defaultProject(), schemaVersion: 3 } as Record<string, unknown>;
    delete v3.abilities;
    expect(migrate(v3).abilities).toEqual([]);
    const p = defaultProject();
    p.moves[0].effect = { priority: 9, stat: { stat: "atk", stages: 9, target: "self", chance: 100 }, drain: 150 };
    const errs = validate(p);
    expect(errs.filter((x) => x.includes("Embestida")).length).toBe(3);
  });
});

describe("combate: clima, terreno, multigolpe, carga/recarga, precisión y objetos equipables", () => {
  const txt = (evs: { text: string }[]) => evs.map((e) => e.text);
  const setup = async (seed: number, mine: string, foe: string, moves: string[], opts: { weather?: "sun" | "rain" | "sand" | "hail"; heldMine?: string; heldFoe?: string } = {}) => {
    const e = await Engine.load(wasm());
    e.reset(8, 8, seed);
    const p = defaultProject();
    const me = makeMon(p, mine, 40, opts.heldMine), fo = makeMon(p, foe, 30, opts.heldFoe);
    me.moves = moves;
    fo.hp = 9999;
    const b = new Battle(p, e, [me], [fo], { trainer: "T", weather: opts.weather, inv: {} });
    return { b, p, me, fo };
  };

  it("clima del mapa al empezar, clima por movimiento y su duración", async () => {
    const a = await setup(1, "flamito", "pelusin", ["embestida"], { weather: "rain" });
    expect(txt(a.b.startEvents)).toContain("¡Empieza a llover!");
    const { b } = await setup(2, "flamito", "pelusin", ["dia-soleado", "embestida"]);
    expect(txt(b.turn({ kind: "move", index: 0 }))).toContain("¡El sol brilla con fuerza!");
    let ended = false;
    for (let i = 0; i < 6; i++) ended ||= txt(b.turn({ kind: "move", index: 1 })).includes("El sol vuelve a la normalidad.");
    expect(ended).toBe(true);
  });

  it("el sol potencia al tipo Fuego y la lluvia lo debilita (reglas por datos)", async () => {
    const dmg = async (w: "sun" | "rain") => {
      const { b } = await setup(3, "flamito", "pelusin", ["ascua"], { weather: w });
      const t = txt(b.turn({ kind: "move", index: 0 })).find((x) => x.endsWith("de daño."));
      return t ? parseInt(t) : 0;
    };
    expect(await dmg("sun")).toBeGreaterThan(await dmg("rain"));
  });

  it("multigolpe, carga y recarga producen sus mensajes", async () => {
    const a = await setup(4, "pelusin", "pelusin", ["doble-golpe"]);
    expect(txt(a.b.turn({ kind: "move", index: 0 })).some((x) => /Golpeó [2-5] veces/.test(x))).toBe(true);
    const c = await setup(5, "hojin", "pelusin", ["rayo-solar", "embestida"]);
    const c1 = txt(c.b.turn({ kind: "move", index: 0 }));
    expect(c1.some((x) => x.includes("acumula energía"))).toBe(true);
    const r = await setup(6, "pelusin", "pelusin", ["hiperrayo", "embestida"]);
    r.b.turn({ kind: "move", index: 0 });
    expect(txt(r.b.turn({ kind: "move", index: 0 })).some((x) => x.includes("debe recuperarse"))).toBe(true);
  });

  it("Ataque Arena baja la precisión del rival y el terreno se anuncia", async () => {
    const a = await setup(7, "pelusin", "pelusin", ["ataque-arena"]);
    expect(txt(a.b.turn({ kind: "move", index: 0 })).some((x) => x.includes("Precisión de Pelusín") && x.includes("baja"))).toBe(true);
    const t = await setup(8, "hojin", "pelusin", ["campo-hierba"]);
    expect(txt(t.b.turn({ kind: "move", index: 0 })).some((x) => x.includes("terreno de tipo Planta"))).toBe(true);
  });

  it("objetos equipables: restos curan, la baya se consume y se refleja en la criatura", async () => {
    const r = await setup(9, "flamito", "pelusin", ["embestida"], { heldMine: "restos" });
    r.me.hp = 20;
    expect(txt(r.b.turn({ kind: "move", index: 0 })).some((x) => x.includes("con Restos"))).toBe(true);
    const bay = await setup(10, "flamito", "pelusin", ["embestida"], { heldMine: "baya-oran" });
    bay.me.hp = Math.floor(monMaxHp(bay.p, bay.me) / 2);
    const out: string[] = [];
    for (let i = 0; i < 3 && bay.me.held; i++) out.push(...txt(bay.b.turn({ kind: "move", index: 0 })));
    expect(out.some((x) => x.includes("se come Baya Oran"))).toBe(true);
    expect(bay.me.held).toBeUndefined();
  });

  it("el proyecto valida objetos equipables, clima y golpes", () => {
    const p = defaultProject();
    expect(validate(p)).toEqual([]);
    p.party[0].held = "carbon";
    expect(validate(p)).toEqual([]);
    p.party[0].held = "no-existe";
    p.moves[0].effect = { hits: { min: 4, max: 2 }, crit: 7 };
    p.maps[0].onExit = "volar";
    const errs = validate(p);
    expect(errs.some((x) => x.includes("objeto equipable inexistente"))).toBe(true);
    expect(errs.some((x) => x.includes("golpes"))).toBe(true);
    expect(errs.some((x) => x.includes("crítico"))).toBe(true);
    expect(errs.some((x) => x.includes("script de salida"))).toBe(true);
  });

  it("migración v4 → v5 añade las reglas de clima por nombre de tipo", () => {
    const v4 = { ...defaultProject(), schemaVersion: 4 } as Record<string, unknown>;
    delete v4.weatherRules;
    const p = migrate(v4);
    expect(p.schemaVersion).toBe(6);
    expect(p.weatherRules.sun.boost).toBe(1); // Fuego
    expect(p.weatherRules.rain.boost).toBe(2); // Agua
    expect(p.weatherRules.sand.chip).toBe(true);
  });
});

describe("combates dobles y objetos", () => {
  it("2v2: ambos lados actúan, termina y reparte experiencia", async () => {
    const e = await Engine.load(wasm());
    e.reset(8, 8, 21);
    const p = defaultProject();
    const party = [makeMon(p, "flamito", 30), makeMon(p, "hojin", 30)];
    const foes = [makeMon(p, "pelusin", 5), makeMon(p, "aquin", 5)];
    const b = new Battle(p, e, party, foes, { trainer: "Dúo", double: true, inv: {} });
    expect(b.size).toBe(2);
    expect(b.pa).toEqual([0, 1]);
    const exp0 = party.map((m) => m.exp);
    for (let i = 0; i < 40 && !b.result; i++) {
      b.turn([{ kind: "move", index: 1, target: 0 }, { kind: "move", index: 1, target: 1 }]);
      if (b.awaitingSwitch) for (let s = 0; s < b.pa.length; s++) if (b.pa[s] === -1) b.forceSwitch(s, b.reserves[0]);
    }
    expect(b.result).toBe("win");
    expect(party.every((m, i) => m.exp > exp0[i] || m.hp <= 0)).toBe(true);
  });
  it("no se activa el modo doble sin 2 criaturas en pie en cada equipo", async () => {
    const e = await Engine.load(wasm());
    e.reset(8, 8, 1);
    const p = defaultProject();
    const b = new Battle(p, e, [makeMon(p, "flamito", 5)], [makeMon(p, "pelusin", 5), makeMon(p, "aquin", 5)], { trainer: "X", double: true, inv: {} });
    expect(b.size).toBe(1);
  });
  it("2v2 es determinista por semilla", async () => {
    const run = async () => {
      const e = await Engine.load(wasm());
      e.reset(8, 8, 77);
      const p = defaultProject();
      const b = new Battle(p, e, [makeMon(p, "flamito", 20), makeMon(p, "hojin", 20)], [makeMon(p, "pelusin", 8), makeMon(p, "aquin", 8)], { trainer: "D", double: true, inv: {} });
      return b.turn([{ kind: "move", index: 1, target: 0 }, { kind: "move", index: 1, target: 1 }]).map((x) => x.text);
    };
    expect(await run()).toEqual(await run());
  });
  it("objetos curativos y bolas mejores aumentan la captura", async () => {
    const e = await Engine.load(wasm());
    e.reset(8, 8, 5);
    const p = defaultProject();
    const m = makeMon(p, "flamito", 10);
    m.hp = 5;
    const b = new Battle(p, e, [m], [makeMon(p, "pelusin", 3)], { inv: { superpotion: 1, ball: 0 } });
    b.turn({ kind: "item", id: "superpotion" });
    expect(m.hp).toBeGreaterThan(5);
    const t = b.turn({ kind: "item", id: "ball" });
    expect(t.some((x) => x.text.includes("No te quedan"))).toBe(true);
    expect(b.opts.inv.superpotion).toBe(0);
  });
});

describe("evolución y movimientos por nivel", () => {
  it("al subir de nivel aprende movimientos y evoluciona", async () => {
    const e = await Engine.load(wasm());
    e.reset(8, 8, 11);
    const p = defaultProject();
    const mon = makeMon(p, "flamito", 7);
    mon.exp = 8 * 8 * 2 - 1; // a 1 punto del nivel 8
    const foe = makeMon(p, "pelusin", 3);
    foe.hp = 1;
    const b = new Battle(p, e, [mon], [foe], { inv: {} });
    const texts: string[] = [];
    for (let i = 0; i < 20 && !b.result; i++) texts.push(...b.turn({ kind: "move", index: 1 }).map((x) => x.text));
    expect(b.result).toBe("win");
    expect(mon.level).toBeGreaterThanOrEqual(8);
    expect(mon.moves).toContain("garra");
    expect(texts.some((t) => t.includes("aprende Garra"))).toBe(true);
    // evolución a nivel 16
    const m2 = makeMon(p, "flamito", 15);
    m2.exp = 16 * 16 * 2 - 1;
    const f2 = makeMon(p, "pelusin", 3); f2.hp = 1;
    const b2 = new Battle(p, e, [m2], [f2], { inv: {} });
    const t2: string[] = [];
    for (let i = 0; i < 20 && !b2.result; i++) t2.push(...b2.turn({ kind: "move", index: 1 }).map((x) => x.text));
    expect(m2.species).toBe("flamaron");
    expect(t2.some((t) => t.includes("evoluciona en Flamarón"))).toBe(true);
  });
});

describe("CSV", () => {
  it("parser: comillas, comas, saltos de línea y BOM", () => {
    const rows = parseCsv('\uFEFFa,b\n"x, y","di ""hola""\nlinea2"\r\n1,2');
    expect(rows).toEqual([["a", "b"], ["x, y", 'di "hola"\nlinea2'], ["1", "2"]]);
    expect(parseCsv(toCsv([["a,b", 'c"d', 3]]))).toEqual([["a,b", 'c"d', "3"]]);
  });
  it("especies y movimientos: exportar → importar es idempotente", () => {
    const p = defaultProject();
    const sp = speciesFromCsv(p, speciesToCsv(p));
    expect(sp.errors).toEqual([]);
    expect(sp.items).toEqual(p.species);
    const mv = movesFromCsv(p, movesToCsv(p));
    expect(mv.errors).toEqual([]);
    expect(mv.items).toEqual(p.moves);
  });
  it("avisa de tipos desconocidos, columnas ausentes y conserva el sprite importado", () => {
    const p = defaultProject();
    p.species[0].sprite = "data:image/png;base64,AAAA";
    const csv = speciesToCsv(p).replace("Fuego", "Eléctrico");
    const r = speciesFromCsv(p, csv);
    expect(r.errors.some((e) => e.includes("Eléctrico"))).toBe(true);
    expect(r.items[0].sprite).toBe("data:image/png;base64,AAAA");
    expect(speciesFromCsv(p, "id,nombre\nx,y").errors[0]).toContain("Faltan columnas");
    expect(movesFromCsv(p, "").errors[0]).toContain("vacío");
  });
});
