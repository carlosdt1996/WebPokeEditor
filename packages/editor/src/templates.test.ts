import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { Engine } from "./engine";
import { type Project, decodeTiles, parseProject, validate } from "./project";
import { type Instr, parseScript, runScript } from "./script";
import { TEMPLATES, archipelagoProject } from "./templates";

const wasm = () => readFileSync(new URL("../public/engine_core.wasm", import.meta.url));
const SOLID_TILES = new Set([3, 4, 5, 11]);
const SOLID_OBJECTS = new Set([12, 15, 16, 17]);

/**
 * Casillas alcanzables en un mapa desde unos puntos de partida (4 direcciones; NPC y colisiones bloquean).
 * Los entrenadores se consideran derrotados en cuanto se puede llegar a su lado (así se modelan los pasillos de combate secuencial).
 */
function reachable(p: Project, mapId: string, from: [number, number][]) {
  const m = p.maps.find((k) => k.id === mapId)!;
  const tiles = decodeTiles(m.tiles, m.w * m.h), objs = m.objects ? decodeTiles(m.objects, m.w * m.h) : new Uint8Array(m.w * m.h);
  const blocked = new Set(m.npcs.map((n) => n.y * m.w + n.x));
  const free = (x: number, y: number) => x >= 0 && y >= 0 && x < m.w && y < m.h && !SOLID_TILES.has(tiles[y * m.w + x]) && !SOLID_OBJECTS.has(objs[y * m.w + x]) && !blocked.has(y * m.w + x);
  const seen = new Set<number>();
  for (;;) {
    seen.clear();
    const q: [number, number][] = [];
    for (const [x, y] of from) if (free(x, y) && !seen.has(y * m.w + x)) { seen.add(y * m.w + x); q.push([x, y]); }
    while (q.length) {
      const [x, y] = q.shift()!;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, ny = y + dy;
        if (free(nx, ny) && !seen.has(ny * m.w + nx)) { seen.add(ny * m.w + nx); q.push([nx, ny]); }
      }
    }
    const beaten = m.npcs.find((n) => n.kind === "trainer" && blocked.has(n.y * m.w + n.x) && [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => seen.has((n.y + dy) * m.w + n.x + dx)));
    if (!beaten) break;
    blocked.delete(beaten.y * m.w + beaten.x); // derrotado: ya no estorba
  }
  return { m, seen, free };
}

describe("plantilla «Archipiélago de la Marea»", () => {
  const p = archipelagoProject();

  it("es válida, sobrevive a un viaje por JSON y está registrada como plantilla", () => {
    expect(validate(p)).toEqual([]);
    expect(parseProject(JSON.stringify(p)).maps).toHaveLength(p.maps.length);
    expect(TEMPLATES.map((t) => t.id)).toContain("archipielago");
    expect(p.maps.length).toBeGreaterThanOrEqual(20);
    expect(p.species.length).toBe(20);
    expect(p.maps.flatMap((m) => m.npcs).filter((n) => n.kind === "trainer").length).toBeGreaterThan(20);
  });

  it("todo es alcanzable: puertas, saltos, disparadores y NPC (con espacio para interactuar)", () => {
    const arrivals = new Map<string, [number, number][]>(p.maps.map((m) => [m.id, []]));
    arrivals.get(p.start.map)!.push([p.start.x, p.start.y]);
    for (const m of p.maps) for (const w of m.warps) arrivals.get(w.toMap)!.push([w.toX, w.toY]);
    const problems: string[] = [];
    for (const m of p.maps) {
      const { seen, free } = reachable(p, m.id, arrivals.get(m.id)!);
      for (const [x, y] of arrivals.get(m.id)!) if (!free(x, y)) problems.push(`${m.id}: llegada bloqueada en (${x},${y})`);
      for (const w of m.warps) if (!seen.has(w.y * m.w + w.x)) problems.push(`${m.id}: salto inalcanzable en (${w.x},${w.y})`);
      for (const t of m.triggers ?? []) if (!seen.has(t.y * m.w + t.x)) problems.push(`${m.id}: disparador inalcanzable en (${t.x},${t.y})`);
      for (const n of m.npcs) {
        const near = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => seen.has((n.y + dy) * m.w + n.x + dx));
        if (!near) problems.push(`${m.id}: NPC "${n.name}" sin casilla libre al lado`);
      }
    }
    expect(problems).toEqual([]);
  });

  it("los saltos de ida y vuelta son coherentes (cada puerta tiene su retorno al mismo sitio)", () => {
    const bad: string[] = [];
    for (const m of p.maps) for (const w of m.warps) {
      const dest = p.maps.find((k) => k.id === w.toMap)!;
      if (!dest.warps.some((b) => b.toMap === m.id)) bad.push(`${m.id} → ${w.toMap}: sin retorno`);
    }
    expect(bad).toEqual([]);
  });

  it("la progresión es consistente: las puertas usan marcas que algún guion activa, y hay 4 medallas", () => {
    const set = new Set<string>(), needed = new Set<string>();
    const scan = (code: Instr[]) => { for (const i of code) { if (i.op === "flag") set.add(i.name); if (i.op === "jif") needed.add(i.flag); } };
    for (const m of p.maps) {
      const scripts = [m.onEnter, m.onExit, ...(m.triggers ?? []).map((t) => t.script), ...m.npcs.flatMap((n) => [n.script, n.winScript])];
      for (const s of scripts) if (s) { const r = parseScript(s); if (r.ok) scan(r.code); }
    }
    for (const f of ["starter", "medalla1", "medalla2", "medalla3", "medalla4", "campeon"]) expect(set.has(f), `ningún guion activa "${f}"`).toBe(true);
    for (const f of needed) expect(set.has(f), `se consulta "${f}" pero nunca se activa`).toBe(true);
  });

  it("los guiones clave funcionan en la VM: elegir inicial, comprar y ganar la medalla", async () => {
    const e = await Engine.load(wasm());
    const log: string[] = [];
    const ctx = (choice: number) => ({
      choose: async () => choice, equip: () => {}, say: async (l: string[]) => { log.push("say:" + l.join("|")); },
      give: (i: string, n: number) => { log.push(`give:${i}:${n}`); }, heal: () => {},
      battle: async () => {}, givemon: (s: string, l: number) => { log.push(`givemon:${s}:${l}`); }, warp: async (m: string) => { log.push("warp:" + m); },
    });
    const run = async (src: string, choice = 0) => { const r = parseScript(src); if (!r.ok) throw new Error(r.errors.join()); await runScript(r.code, ctx(choice), e); };
    e.flagsReset();
    const cedro = p.maps.find((m) => m.id === "lab")!.npcs.find((n) => n.id === "cedro")!.script!;
    await run(cedro, 1);
    expect(log).toContain("givemon:hojito:5");
    expect(e.hasFlag("starter")).toBe(true);
    log.length = 0;
    await run(cedro, 0); // segunda vez: ya no vuelve a regalar nada
    expect(log.some((l) => l.startsWith("givemon"))).toBe(false);
    // tienda: con dinero compra; sin dinero, no
    const shop = p.maps.find((m) => m.id === "centro-coral")!.npcs.find((n) => n.id === "tendero")!.script!;
    e.setVar("money", 120);
    log.length = 0;
    await run(shop, 0); // Poción (100)
    expect(log).toContain("give:potion:1");
    expect(e.getVar("money")).toBe(20);
    log.length = 0;
    await run(shop, 1); // Superpoción (300): no alcanza
    expect(log.some((l) => l.startsWith("give"))).toBe(false);
    expect(log.some((l) => l.includes("No tienes suficientes monedas"))).toBe(true);
    // medalla
    const fresia = p.maps.find((m) => m.id === "gym-coral")!.npcs.find((n) => n.id === "fresia")!;
    await run(fresia.winScript!);
    expect(e.hasFlag("medalla1")).toBe(true);
    expect(e.getVar("medallas")).toBe(1);
    // la puerta deja pasar con la medalla y rechaza sin ella
    const gateTrig = p.maps.find((m) => m.id === "coral")!.triggers![0].script;
    log.length = 0;
    await run(gateTrig);
    expect(log).toEqual([]);
    e.flagsReset();
    await run(gateTrig);
    expect(log.some((l) => l.startsWith("warp:coral"))).toBe(true);
  });

  it("los equipos de los líderes crecen de nivel con la historia", () => {
    const peak = (id: string) => Math.max(...p.maps.flatMap((m) => m.npcs).find((n) => n.id === id)!.team!.map((t) => t.level));
    expect(peak("fresia")).toBeLessThan(peak("voltio"));
    expect(peak("voltio")).toBeLessThan(peak("brasa"));
    expect(peak("brasa")).toBeLessThan(peak("marino"));
    expect(peak("marino")).toBeLessThan(peak("aldo"));
  });
});
