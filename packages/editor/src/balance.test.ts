import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { Engine } from "./engine";
import { Battle, type Mon, makeMon } from "./battle";
import { archipelagoProject } from "./templates";
import type { Project } from "./project";

const wasm = () => readFileSync(new URL("../public/engine_core.wasm", import.meta.url));

/** Jugador automático: usa el movimiento de más poder esperado contra el rival en pie. */
function autoPlay(p: Project, e: Engine, party: Mon[], foes: Mon[], seed: number): boolean {
  e.reset(8, 8, seed);
  const b = new Battle(p, e, party, foes, { trainer: "T", inv: {} });
  for (let t = 0; t < 120 && !b.result; t++) {
    if (b.awaitingSwitch) { const r = b.reserves[0]; if (r === undefined) break; b.forceSwitch(b.pa.indexOf(-1) < 0 ? 0 : b.pa.indexOf(-1), r); continue; }
    const me = b.party[b.pa[0]], foe = b.foes[b.fa[0]];
    let best = 0, bestScore = -1;
    me.moves.forEach((id, i) => {
      const m = p.moves.find((x) => x.id === id)!;
      const sp = p.species.find((s) => s.id === foe.species)!;
      let eff = 1;
      for (const ty of sp.types) eff *= p.typeChart[m.type]?.[ty] ?? 1;
      const score = m.power * eff * (m.accuracy / 100);
      if (score > bestScore) { bestScore = score; best = i; }
    });
    b.turn({ kind: "move", index: best });
  }
  return b.result === "win";
}

/** Equipos de referencia del jugador: cobertura de tipos razonable con tres líneas evolutivas y un volador/eléctrico. */
const LINES = ["hojito", "gotin", "brasito", "chispin", "piedrin", "alete"];
/** Equipo de referencia a un nivel: cada línea evolutiva en la forma que le toca por nivel (como lo tendría un jugador real). */
function partyAt(p: Project, level: number, n: number): Mon[] {
  return LINES.slice(0, n).map((base) => {
    let id = base;
    for (;;) { const ev = p.species.find((s) => s.id === id)?.evolve; if (ev && level >= ev.level) id = ev.into; else break; }
    return makeMon(p, id, level);
  });
}
const BOSSES = ["fresia", "voltio", "brasa", "marino", "chispa", "cima", "duna", "selvia", "ola", "cumbre", "llama", "aldo"];

describe("equilibrio: tasa de victoria de un equipo de referencia contra cada líder", () => {
  it("el jugador gana con regularidad con algo de ventaja y pierde con desventaja grande", async () => {
    const e = await Engine.load(wasm());
    const p = archipelagoProject();
    const npcs = p.maps.flatMap((m) => m.npcs);
    const rate = (id: string, offset: number) => {
      const foes = npcs.find((n) => n.id === id)!.team!;
      const peak = Math.max(...foes.map((f) => f.level));
      let wins = 0;
      const N = 16;
      for (let seed = 1; seed <= N; seed++) {
        const party = partyAt(p, Math.max(5, peak + offset), Math.min(6, Math.max(3, foes.length)));
        const foeMons = foes.map((f) => makeMon(p, f.species, f.level, f.held));
        if (autoPlay(p, e, party, foeMons, seed)) wins++;
      }
      return wins / N;
    };
    const OFFS = [-8, -4, -2, +2];
    const table: Record<string, string> = {};
    const mean = OFFS.map(() => 0);
    for (const id of BOSSES) {
      const r = OFFS.map((o) => rate(id, o));
      table[id] = r.map((x) => x.toFixed(2)).join(" ");
      r.forEach((x, k) => (mean[k] += x / BOSSES.length));
      // más nivel nunca debe empeorar de forma apreciable
      for (let k = 1; k < r.length; k++) expect(r[k], `${id}: con más nivel no se debe ganar menos`).toBeGreaterThanOrEqual(r[k - 1] - 0.15);
      expect(r[r.length - 1], `${id} debe poder ganarse con ventaja`).toBeGreaterThan(0.5);
    }
    console.log("tasas de victoria (nivel -8, -4, -2, +2)", table, "media", mean.map((x) => x.toFixed(2)).join(" "));
    // la dificultad media sube con el nivel del jugador: con 8 niveles menos casi nunca, con ventaja casi siempre
    expect(mean[0]).toBeLessThan(0.6);
    expect(mean[3]).toBeGreaterThan(0.8);
  });
});
