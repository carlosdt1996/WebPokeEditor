import { h } from "../dom";
import { STAT_KEYS, type Move, type Project, type Species } from "../project";

export function dataPanel(getProject: () => Project, onChange: () => void): { el: HTMLElement; refresh(): void } {
  const el = h("div", { class: "panel" });

  const num = (v: number, on: (n: number) => void, min = 0, max = 999) =>
    h("input", { type: "number", min, max, value: v, class: "n", oninput: (e: Event) => { on(Math.min(max, Math.max(min, +(e.target as HTMLInputElement).value || 0))); onChange(); } });
  const txt = (v: string, on: (s: string) => void) =>
    h("input", { type: "text", value: v, oninput: (e: Event) => { on((e.target as HTMLInputElement).value); onChange(); } });
  const typeSel = (p: Project, v: number, on: (n: number) => void) =>
    h("select", { onchange: (e: Event) => { on(+(e.target as HTMLSelectElement).value); onChange(); } },
      ...p.types.map((t, i) => h("option", { value: i, selected: i === v }, t)));
  const slug = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "x";
  const uniqueId = (existing: string[], base: string) => { let id = slug(base), n = 2; while (existing.includes(id)) id = `${slug(base)}-${n++}`; return id; };

  const render = () => {
    const p = getProject();
    el.replaceChildren();

    // Especies
    const spRows = p.species.map((s: Species) =>
      h("tr", {},
        h("td", {}, txt(s.name, (v) => (s.name = v))),
        h("td", {}, typeSel(p, s.types[0] ?? 0, (n) => (s.types = [n, ...s.types.slice(1)]))),
        h("td", {}, h("select", { onchange: (e: Event) => { const v = (e.target as HTMLSelectElement).value; s.types = v === "" ? s.types.slice(0, 1) : [s.types[0] ?? 0, +v]; onChange(); } },
          h("option", { value: "", selected: s.types.length < 2 }, "—"), ...p.types.map((t, i) => h("option", { value: i, selected: s.types[1] === i }, t)))),
        ...STAT_KEYS.map((k) => h("td", {}, num(s.stats[k], (n) => (s.stats[k] = n), 1, 255))),
        h("td", {}, txt(s.moves.join(", "), (v) => (s.moves = v.split(",").map((x) => x.trim()).filter(Boolean)))),
        h("td", {}, h("button", { class: "danger", title: "Eliminar", onclick: () => { p.species = p.species.filter((x) => x !== s); p.encounters = p.encounters.filter((e) => e !== s.id); onChange(); render(); } }, "✕")),
      ));
    // Movimientos
    const mvRows = p.moves.map((m: Move) =>
      h("tr", {},
        h("td", {}, txt(m.name, (v) => (m.name = v))),
        h("td", {}, typeSel(p, m.type, (n) => (m.type = n))),
        h("td", {}, h("select", { onchange: (e: Event) => { m.category = (e.target as HTMLSelectElement).value as Move["category"]; onChange(); } },
          h("option", { value: "physical", selected: m.category === "physical" }, "Físico"),
          h("option", { value: "special", selected: m.category === "special" }, "Especial"))),
        h("td", {}, num(m.power, (n) => (m.power = n), 0, 250)),
        h("td", {}, num(m.accuracy, (n) => (m.accuracy = n), 1, 100)),
        h("td", {}, h("small", { class: "muted" }, m.id)),
        h("td", {}, h("button", { class: "danger", title: "Eliminar", onclick: () => { p.moves = p.moves.filter((x) => x !== m); for (const s of p.species) s.moves = s.moves.filter((i) => i !== m.id); onChange(); render(); } }, "✕")),
      ));

    el.append(
      h("h2", {}, "Especies"),
      h("p", { class: "muted" }, "Criaturas originales de ejemplo. Los movimientos se referencian por id (separados por comas)."),
      h("div", { class: "scroll" }, h("table", {},
        h("thead", {}, h("tr", {}, ...["Nombre", "Tipo 1", "Tipo 2", "PS", "Ata", "Def", "AtE", "DeE", "Vel", "Movimientos", ""].map((t) => h("th", {}, t)))),
        h("tbody", {}, ...spRows))),
      h("button", { onclick: () => { p.species.push({ id: uniqueId(p.species.map((s) => s.id), "nueva"), name: "Nueva", types: [0], stats: { hp: 50, atk: 50, def: 50, spa: 50, spd: 50, spe: 50 }, moves: p.moves[0] ? [p.moves[0].id] : [] }); onChange(); render(); } }, "+ Añadir especie"),
      h("h2", {}, "Movimientos"),
      h("div", { class: "scroll" }, h("table", {},
        h("thead", {}, h("tr", {}, ...["Nombre", "Tipo", "Categoría", "Poder", "Precisión", "Id", ""].map((t) => h("th", {}, t)))),
        h("tbody", {}, ...mvRows))),
      h("button", { onclick: () => { p.moves.push({ id: uniqueId(p.moves.map((m) => m.id), "nuevo"), name: "Nuevo", type: 0, category: "physical", power: 40, accuracy: 100 }); onChange(); render(); } }, "+ Añadir movimiento"),
      h("h2", {}, "Encuentros en hierba alta"),
      h("p", { class: "muted" }, "Cada entrada es una posibilidad; repite una especie para aumentar su probabilidad."),
      h("div", { class: "chips" }, ...p.encounters.map((id, i) => h("span", { class: "chip" }, p.species.find((s) => s.id === id)?.name ?? id,
        h("button", { onclick: () => { p.encounters.splice(i, 1); onChange(); render(); } }, "×")))),
      h("select", { onchange: (e: Event) => { const v = (e.target as HTMLSelectElement).value; if (v) { p.encounters.push(v); onChange(); render(); } } },
        h("option", { value: "" }, "+ Añadir especie al encuentro…"), ...p.species.map((s) => h("option", { value: s.id }, s.name))),
    );
  };
  render();
  return { el, refresh: render };
}
