import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { Engine, Ev, Input } from "./engine";
import { decodeTiles, defaultProject, effectiveness, encodeTiles, parseProject, validate } from "./project";

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
    p.encounters.push("no-existe");
    p.species[0].moves.push("tampoco");
    expect(validate(p).length).toBe(2);
  });
  it("calcula efectividad", () => {
    const p = defaultProject();
    expect(effectiveness(p, 1, [3])).toBe(2); // fuego > planta
    expect(effectiveness(p, 1, [2])).toBe(0.5);
  });
});
