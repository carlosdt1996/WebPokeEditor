import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { Engine, Input } from "./engine";
import { Battle, makeMon } from "./battle";
import { archipelagoProject } from "./templates";
import { parseScript, runScript } from "./script";

const wasm = () => readFileSync(new URL("../public/engine_core.wasm", import.meta.url));
const time = async (f: () => void | Promise<void>) => { const t0 = performance.now(); await f(); return performance.now() - t0; };

/**
 * Presupuestos de rendimiento muy holgados (al menos 10× lo medido (ticks ≈20 ms, 200 combates ≈110 ms)): no buscan medir con precisión,
 * sino detectar regresiones graves (p. ej. una llamada WASM↔JS por casilla o un bucle cuadrático).
 */
describe("rendimiento del núcleo", () => {
  it("100 000 ticks de movimiento en un mapa grande", async () => {
    const e = await Engine.load(wasm());
    e.reset(64, 64, 1);
    const ms = await time(() => { for (let i = 0; i < 100_000; i++) e.tick([Input.Right, Input.Down, Input.Left, Input.Up][(i >> 6) & 3]); });
    console.log(`100 000 ticks: ${ms.toFixed(0)} ms`);
    expect(ms).toBeLessThan(1000);
  });

  it("200 combates completos 1v1 de la plantilla (1 sola subida de datos por combate)", async () => {
    const e = await Engine.load(wasm());
    const p = archipelagoProject();
    let turns = 0;
    const ms = await time(() => {
      for (let seed = 1; seed <= 200; seed++) {
        e.reset(8, 8, seed);
        const b = new Battle(p, e, [makeMon(p, "infernal", 50), makeMon(p, "tsunamo", 50)], [makeMon(p, "selvatico", 45), makeMon(p, "rocalon", 45)], { trainer: "T", inv: {} });
        for (let t = 0; t < 80 && !b.result; t++) {
          if (b.awaitingSwitch) { b.forceSwitch(b.pa.indexOf(-1), b.reserves[0]); continue; }
          b.turn({ kind: "move", index: 0 }); turns++;
        }
      }
    });
    console.log(`200 combates (${turns} turnos): ${ms.toFixed(0)} ms`);
    expect(ms).toBeLessThan(2000);
  });

  it("un guion con 5 000 iteraciones se ejecuta en la VM sin ahogar el host", async () => {
    const e = await Engine.load(wasm());
    e.flagsReset();
    const r = parseScript("set n 0\nwhile n < 5000\nadd n 1\nend\nsay listo {n}");
    if (!r.ok) throw new Error(r.errors.join());
    const out: string[] = [];
    const ms = await time(() => runScript(r.code, { choose: async () => 0, equip: () => {}, say: async (l) => { out.push(...l); }, give: () => {}, heal: () => {}, battle: async () => {}, givemon: () => {}, warp: async () => {} }, e));
    console.log(`guion de 5 000 iteraciones: ${ms.toFixed(0)} ms`);
    expect(out).toEqual(["listo 5000"]);
    expect(ms).toBeLessThan(500);
  });
});
