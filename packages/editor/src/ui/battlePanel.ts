import { h } from "../dom";
import type { Engine } from "../engine";
import { effectiveness, maxHp, statAt, type Project } from "../project";

/** Calculadora de daño: la fórmula corre en el núcleo WASM. */
export function battlePanel(getProject: () => Project, engine: Engine): { el: HTMLElement; refresh(): void } {
  const el = h("div", { class: "panel" });
  let atkId = "", defId = "", moveId = "", level = 50;

  const render = () => {
    const p = getProject();
    el.replaceChildren();
    if (!p.species.length || !p.moves.length) { el.append(h("p", {}, "Añade especies y movimientos en la pestaña Datos.")); return; }
    if (!p.species.some((s) => s.id === atkId)) atkId = p.species[0].id;
    if (!p.species.some((s) => s.id === defId)) defId = p.species[Math.min(1, p.species.length - 1)].id;
    const att = p.species.find((s) => s.id === atkId)!;
    const def = p.species.find((s) => s.id === defId)!;
    const known = att.moves.length ? att.moves : p.moves.map((m) => m.id);
    if (!known.includes(moveId)) moveId = known[0];
    const mv = p.moves.find((m) => m.id === moveId);

    const sel = (value: string, opts: [string, string][], on: (v: string) => void) =>
      h("select", { onchange: (e: Event) => { on((e.target as HTMLSelectElement).value); render(); } },
        ...opts.map(([v, l]) => h("option", { value: v, selected: v === value }, l)));
    const speciesOpts = p.species.map((s) => [s.id, s.name] as [string, string]);

    const out = h("div", { class: "result" });
    if (mv) {
      const physical = mv.category === "physical";
      const a = statAt(physical ? att.stats.atk : att.stats.spa, level);
      const d = statAt(physical ? def.stats.def : def.stats.spd, level);
      const eff = effectiveness(p, mv.type, def.types);
      const stab = att.types.includes(mv.type) ? 1.5 : 1;
      const mult = Math.round(eff * stab * 100);
      const lo = engine.damage(level, mv.power, a, d, mult, 85);
      const hi = engine.damage(level, mv.power, a, d, mult, 100);
      const hp = maxHp(def.stats.hp, level);
      out.append(
        h("p", {}, `${att.name} usa ${mv.name} (${p.types[mv.type]}, ${physical ? "físico" : "especial"}, poder ${mv.power}).`),
        h("p", {}, `Efectividad ×${eff}${stab > 1 ? " · STAB ×1.5" : ""} → ${eff === 0 ? "No afecta" : eff > 1 ? "¡Muy eficaz!" : eff < 1 ? "Poco eficaz" : "Normal"}`),
        h("p", { class: "big" }, `Daño: ${lo} – ${hi} PS`),
        h("p", {}, `${def.name} tiene ${hp} PS → ${((lo / hp) * 100).toFixed(1)}% – ${((hi / hp) * 100).toFixed(1)}%`),
        h("div", { class: "bar" }, h("div", { class: "fill", style: `width:${Math.max(0, 100 - (hi / hp) * 100)}%` }), h("div", { class: "fill2", style: `width:${Math.max(0, (hi - lo) / hp * 100)}%` })),
      );
    }
    el.append(
      h("h2", {}, "Calculadora de combate"),
      h("p", { class: "muted" }, "La fórmula de daño se ejecuta en el módulo Rust/WASM (engine-core)."),
      h("div", { class: "form" },
        h("label", {}, "Atacante", sel(atkId, speciesOpts, (v) => (atkId = v))),
        h("label", {}, "Movimiento", sel(moveId, known.map((id) => [id, p.moves.find((m) => m.id === id)?.name ?? id] as [string, string]), (v) => (moveId = v))),
        h("label", {}, "Defensor", sel(defId, speciesOpts, (v) => (defId = v))),
        h("label", {}, "Nivel", h("input", { type: "number", min: 1, max: 100, value: level, oninput: (e: Event) => { level = Math.min(100, Math.max(1, +(e.target as HTMLInputElement).value || 1)); render(); } })),
      ),
      out,
    );
  };
  render();
  return { el, refresh: render };
}
