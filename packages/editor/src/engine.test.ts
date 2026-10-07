import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { Engine, Ev, Input } from "./engine";
import { Battle, makeMon } from "./battle";
import { parseScript, runScript } from "./script";
import { decodeTiles, defaultProject, effectiveness, encodeTiles, migrate, parseProject, validate } from "./project";

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
    expect(p.schemaVersion).toBe(2);
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
    const b = new Battle(p, e, [makeMon(p, "flamito", 5)], [makeMon(p, "pelusin", 5)], { trainer: "Rival", inv: { ball: 5, potion: 0 } });
    b.turn({ kind: "run" });
    expect(b.result).toBeNull();
    b.turn({ kind: "ball" });
    expect(b.result).toBeNull();
  });
  it("capturar añade al equipo (con probabilidad alta si está debilitado)", async () => {
    const e = await Engine.load(wasm());
    e.reset(8, 8, 3);
    const p = defaultProject();
    const foe = makeMon(p, "pelusin", 3);
    foe.hp = 1;
    const b = new Battle(p, e, [makeMon(p, "flamito", 50)], [foe], { inv: { ball: 50, potion: 0 } });
    for (let i = 0; i < 40 && !b.result; i++) b.turn({ kind: "ball" });
    expect(b.result).toBe("caught");
    expect(b.party).toHaveLength(2);
  });
});

describe("scripts", () => {
  const mkCtx = (flags = new Set<string>()) => {
    const log: string[] = [];
    return {
      log, flags,
      ctx: {
        say: async (l: string[]) => { log.push("say:" + l.join("|")); },
        give: (i: string, n: number) => { log.push(`give:${i}:${n}`); },
        heal: () => { log.push("heal"); },
        has: (f: string) => flags.has(f),
        set: (f: string, on: boolean) => { on ? flags.add(f) : flags.delete(f); },
        battle: async (s: string, l: number) => { log.push(`battle:${s}:${l}`); },
        givemon: (s: string, l: number) => { log.push(`givemon:${s}:${l}`); },
        warp: async (m: string, x: number, y: number) => { log.push(`warp:${m}:${x}:${y}`); },
      },
    };
  };
  const src = "if hecho\nsay ya\nelse\nsay hola\nsay otra\ngive potion 2\nflag hecho\nend\nheal";

  it("ramas if/else y marcas: se ejecuta una sola vez", async () => {
    const r = parseScript(src);
    if (!r.ok) throw new Error(r.errors.join());
    const a = mkCtx();
    await runScript(r.code, a.ctx);
    expect(a.log).toEqual(["say:hola|otra", "give:potion:2", "heal"]);
    await runScript(r.code, { ...a.ctx, has: a.ctx.has });
    expect(a.log.slice(3)).toEqual(["say:ya", "heal"]);
  });
  it("ifnot, battle, givemon y warp (warp termina el script)", async () => {
    const r = parseScript("ifnot x\nbattle pelusin 3\ngivemon aquin 5\nend\nwarp casa 5 6\nsay nunca");
    if (!r.ok) throw new Error(r.errors.join());
    const a = mkCtx();
    await runScript(r.code, a.ctx);
    expect(a.log).toEqual(["battle:pelusin:3", "givemon:aquin:5", "warp:casa:5:6"]);
  });
  it("reporta errores de sintaxis con número de línea", () => {
    const r = parseScript("say ok\nvolar 3\nif a\nsay x\ngive oro 2\nend\nend");
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors.some((e) => e.startsWith("línea 2"))).toBe(true);
      expect(r.errors.some((e) => e.startsWith("línea 5"))).toBe(true);
      expect(r.errors.some((e) => e.includes("end sin if"))).toBe(true);
    }
    const open = parseScript("if a\nsay x");
    expect(open.ok).toBe(false);
  });
  it("el proyecto valida referencias dentro de los scripts", () => {
    const p = defaultProject();
    expect(validate(p)).toEqual([]);
    const n = p.maps[0].npcs.find((k) => k.kind === "script")!;
    n.script = "battle fantasma 5\nwarp nada 1 1";
    const errs = validate(p);
    expect(errs.some((e) => e.includes("fantasma"))).toBe(true);
    expect(errs.some((e) => e.includes("nada"))).toBe(true);
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
    const b = new Battle(p, e, [mon], [foe], { inv: { ball: 0, potion: 0 } });
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
    const b2 = new Battle(p, e, [m2], [f2], { inv: { ball: 0, potion: 0 } });
    const t2: string[] = [];
    for (let i = 0; i < 20 && !b2.result; i++) t2.push(...b2.turn({ kind: "move", index: 1 }).map((x) => x.text));
    expect(m2.species).toBe("flamaron");
    expect(t2.some((t) => t.includes("evoluciona en Flamarón"))).toBe(true);
  });
});
