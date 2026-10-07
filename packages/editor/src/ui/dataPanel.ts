import { h } from "../dom";
import { ATLAS_COLS, ATLAS_ROWS, TILE, createAtlas } from "../tiles";
import { STAT_KEYS, type Move, type Project, type Species, uniqueId } from "../project";
import { importImage, speciesImage } from "../sprites";
import { movesFromCsv, movesToCsv, speciesFromCsv, speciesToCsv } from "../csv";

const download = (name: string, text: string) => { const a = h("a", { href: URL.createObjectURL(new Blob([text], { type: "text/csv" })), download: name }); a.click(); URL.revokeObjectURL(a.href); };

export interface DataHooks { onChange(): void; onAtlas(url: string | null): void }

export function dataPanel(getProject: () => Project, hooks: DataHooks): { el: HTMLElement; refresh(): void } {
  const el = h("div", { class: "panel" });
  const onChange = hooks.onChange;
  let encMap = 0;

  const num = (v: number, on: (n: number) => void, min = 0, max = 999) =>
    h("input", { type: "number", min, max, value: v, class: "n", oninput: (e: Event) => { on(Math.min(max, Math.max(min, +(e.target as HTMLInputElement).value || 0))); onChange(); } });
  const txt = (v: string, on: (s: string) => void) =>
    h("input", { type: "text", value: v, oninput: (e: Event) => { on((e.target as HTMLInputElement).value); onChange(); } });
  const typeSel = (p: Project, v: number, on: (n: number) => void) =>
    h("select", { onchange: (e: Event) => { on(+(e.target as HTMLSelectElement).value); onChange(); } },
      ...p.types.map((t, i) => h("option", { value: i, selected: i === v }, t)));
  const speciesSel = (p: Project, v: string, on: (id: string) => void) =>
    h("select", { onchange: (e: Event) => { on((e.target as HTMLSelectElement).value); onChange(); } },
      ...p.species.map((s) => h("option", { value: s.id, selected: s.id === v }, s.name)));

  const spriteCell = (p: Project, s: Species) => {
    const file = h("input", { type: "file", accept: "image/png,image/gif,image/webp,image/jpeg", hidden: true, onchange: async (e: Event) => {
      const f = (e.target as HTMLInputElement).files?.[0];
      if (!f) return;
      try { s.sprite = await importImage(f, 128); onChange(); render(); } catch { alert("No se pudo leer la imagen."); }
    } });
    return h("td", { class: "spr" },
      h("img", { src: speciesImage(p, s.id), class: "thumb", title: s.sprite ? "Sprite importado" : "Sprite procedural (original)" }),
      h("button", { title: "Importar tu propio sprite (PNG/GIF/WebP). Se guarda solo en tu proyecto.", onclick: () => file.click() }, "⬆"),
      s.sprite ? h("button", { class: "danger", title: "Quitar sprite importado", onclick: () => { delete s.sprite; onChange(); render(); } }, "✕") : null,
      file);
  };

  const render = () => {
    const p = getProject();
    el.replaceChildren();

    const spRows = p.species.map((s: Species) =>
      h("tr", {},
        spriteCell(p, s),
        h("td", {}, txt(s.name, (v) => (s.name = v))),
        h("td", {}, typeSel(p, s.types[0] ?? 0, (n) => (s.types = [n, ...s.types.slice(1)]))),
        h("td", {}, h("select", { onchange: (e: Event) => { const v = (e.target as HTMLSelectElement).value; s.types = v === "" ? s.types.slice(0, 1) : [s.types[0] ?? 0, +v]; onChange(); } },
          h("option", { value: "", selected: s.types.length < 2 }, "—"), ...p.types.map((t, i) => h("option", { value: i, selected: s.types[1] === i }, t)))),
        ...STAT_KEYS.map((k) => h("td", {}, num(s.stats[k], (n) => (s.stats[k] = n), 1, 255))),
        h("td", {}, txt(s.moves.join(", "), (v) => (s.moves = v.split(",").map((x) => x.trim()).filter(Boolean)))),
        h("td", { class: "nw" }, "Nv.", num(s.evolve?.level ?? 0, (n) => { if (n > 0) s.evolve = { level: n, into: s.evolve?.into ?? p.species[0].id }; else delete s.evolve; }, 0, 100),
          h("select", { onchange: (e: Event) => { const v = (e.target as HTMLSelectElement).value; if (v) s.evolve = { level: s.evolve?.level || 16, into: v }; else delete s.evolve; onChange(); render(); } },
            h("option", { value: "" }, "no evoluciona"), ...p.species.filter((x) => x !== s).map((x) => h("option", { value: x.id, selected: s.evolve?.into === x.id }, x.name)))),
        h("td", {}, txt((s.learnset ?? []).map((l) => `${l.level}:${l.move}`).join(", "), (v) => {
          s.learnset = v.split(",").map((x) => x.trim().split(":")).filter((a) => a.length === 2 && +a[0] > 0 && a[1].trim()).map((a) => ({ level: +a[0], move: a[1].trim() }));
        })),
        h("td", {}, h("button", { class: "danger", title: "Eliminar", onclick: () => {
          p.species = p.species.filter((x) => x !== s);
          for (const m of p.maps) { m.encounters = m.encounters.filter((e) => e !== s.id); for (const n of m.npcs) n.team = n.team?.filter((t) => t.species !== s.id); }
          p.party = p.party.filter((t) => t.species !== s.id);
          for (const o of p.species) if (o.evolve?.into === s.id) delete o.evolve;
          onChange(); render();
        } }, "✕")),
      ));
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

    const csvImport = (label: string, kind: "species" | "moves") => {
      const f = h("input", { type: "file", accept: ".csv,text/csv", hidden: true, onchange: async (e: Event) => {
        const file = (e.target as HTMLInputElement).files?.[0];
        (e.target as HTMLInputElement).value = "";
        if (!file) return;
        const text = await file.text();
        const r = kind === "species" ? speciesFromCsv(p, text) : movesFromCsv(p, text);
        if (r.errors.length && !confirm(`El CSV tiene avisos:\n- ${r.errors.slice(0, 8).join("\n- ")}\n\n¿Importar igualmente (reemplaza toda la lista)?`)) return;
        if (!r.items.length) { alert("No hay filas que importar."); return; }
        if (kind === "species") p.species = r.items as typeof p.species; else p.moves = r.items as typeof p.moves;
        onChange(); render();
      } });
      return h("span", {}, h("button", { onclick: () => f.click() }, label), f);
    };

    // Objetos e inventario
    const itemRows = p.items.map((it) => h("tr", {},
      h("td", {}, txt(it.name, (v) => (it.name = v))),
      h("td", {}, h("small", { class: "muted" }, it.id)),
      h("td", {}, h("select", { onchange: (e: Event) => { it.kind = (e.target as HTMLSelectElement).value as typeof it.kind; onChange(); render(); } },
        h("option", { value: "heal", selected: it.kind === "heal" }, "Cura PS"), h("option", { value: "ball", selected: it.kind === "ball" }, "Captura"))),
      h("td", {}, num(it.amount, (n) => (it.amount = n), 0, 999), h("small", { class: "muted" }, it.kind === "heal" ? " PS" : " % extra")),
      h("td", {}, num(p.inventory[it.id] ?? 0, (n) => (p.inventory[it.id] = n), 0, 99)),
      h("td", {}, h("button", { class: "danger", onclick: () => { p.items = p.items.filter((x) => x !== it); delete p.inventory[it.id]; onChange(); render(); } }, "✕"))));

    // Equipo inicial
    const partyRows = p.party.map((t, i) => h("div", { class: "row" },
      speciesSel(p, t.species, (id) => (t.species = id)), "Nv.", num(t.level, (n) => (t.level = n), 1, 100),
      h("button", { class: "danger", onclick: () => { p.party.splice(i, 1); onChange(); render(); } }, "✕")));

    // Encuentros por mapa
    const mapSel = h("select", { onchange: (e: Event) => { encMap = +(e.target as HTMLSelectElement).value; render(); } }, ...p.maps.map((m, i) => h("option", { value: i, selected: i === encMap }, m.name)));
    const em = p.maps[Math.min(encMap, p.maps.length - 1)];

    // Gráficos propios
    const atlasFile = h("input", { type: "file", accept: "image/png", hidden: true, onchange: async (e: Event) => {
      const f = (e.target as HTMLInputElement).files?.[0];
      if (!f) return;
      const url = await new Promise<string>((res) => { const r = new FileReader(); r.onload = () => res(String(r.result)); r.readAsDataURL(f); });
      p.atlas = url; hooks.onAtlas(url); onChange(); render();
    } });

    el.append(
      h("h2", {}, "Especies"),
      h("p", { class: "muted" }, "Cada especie usa un sprite original generado por código. Con ⬆ puedes importar tu propia imagen (se guarda solo en tu proyecto, nunca se sube a ningún sitio). Los movimientos se referencian por id."),
      h("div", { class: "scroll" }, h("table", {},
        h("thead", {}, h("tr", {}, ...["Sprite", "Nombre", "Tipo 1", "Tipo 2", "PS", "Ata", "Def", "AtE", "DeE", "Vel", "Movimientos", "Evolución", "Aprende (nv:mov)", ""].map((t) => h("th", {}, t)))),
        h("tbody", {}, ...spRows))),
      h("div", { class: "row" },
        h("button", { onclick: () => download("especies.csv", speciesToCsv(p)) }, "⬇ Exportar CSV"), csvImport("⬆ Importar CSV", "species")),
      h("button", { onclick: () => { p.species.push({ id: uniqueId(p.species.map((s) => s.id), "nueva"), name: "Nueva", types: [0], stats: { hp: 50, atk: 50, def: 50, spa: 50, spd: 50, spe: 50 }, moves: p.moves[0] ? [p.moves[0].id] : [] }); onChange(); render(); } }, "+ Añadir especie"),
      h("h2", {}, "Movimientos"),
      h("div", { class: "scroll" }, h("table", {},
        h("thead", {}, h("tr", {}, ...["Nombre", "Tipo", "Categoría", "Poder", "Precisión", "Id", ""].map((t) => h("th", {}, t)))),
        h("tbody", {}, ...mvRows))),
      h("div", { class: "row" },
        h("button", { onclick: () => download("movimientos.csv", movesToCsv(p)) }, "⬇ Exportar CSV"), csvImport("⬆ Importar CSV", "moves")),
      h("button", { onclick: () => { p.moves.push({ id: uniqueId(p.moves.map((m) => m.id), "nuevo"), name: "Nuevo", type: 0, category: "physical", power: 40, accuracy: 100 }); onChange(); render(); } }, "+ Añadir movimiento"),
      h("h2", {}, "Equipo inicial e inventario"),
      ...partyRows,
      h("button", { disabled: p.party.length >= 6 || !p.species.length, onclick: () => { p.party.push({ species: p.species[0].id, level: 5 }); onChange(); render(); } }, "+ Añadir al equipo"),
      h("h2", {}, "Objetos e inventario inicial"),
      h("div", { class: "scroll" }, h("table", {},
        h("thead", {}, h("tr", {}, ...["Nombre", "Id", "Efecto", "Cantidad del efecto", "Inventario inicial", ""].map((t) => h("th", {}, t)))),
        h("tbody", {}, ...itemRows))),
      h("button", { onclick: () => { const id = uniqueId(p.items.map((i) => i.id), "objeto"); p.items.push({ id, name: "Objeto", kind: "heal", amount: 30 }); onChange(); render(); } }, "+ Añadir objeto"),
      h("h2", {}, "Encuentros en hierba alta"),
      h("div", { class: "row" }, "Mapa", mapSel),
      em ? h("div", { class: "row" }, "Nivel", num(em.encounterLevel[0], (n) => (em.encounterLevel[0] = n), 1, 100), "a", num(em.encounterLevel[1], (n) => (em.encounterLevel[1] = n), 1, 100)) : "",
      h("p", { class: "muted" }, "Cada entrada es una posibilidad; repite una especie para aumentar su probabilidad."),
      h("div", { class: "chips" }, ...(em?.encounters ?? []).map((id, i) => h("span", { class: "chip" }, p.species.find((s) => s.id === id)?.name ?? id,
        h("button", { onclick: () => { em.encounters.splice(i, 1); onChange(); render(); } }, "×")))),
      h("select", { onchange: (e: Event) => { const v = (e.target as HTMLSelectElement).value; if (v && em) { em.encounters.push(v); onChange(); render(); } } },
        h("option", { value: "" }, "+ Añadir especie al encuentro…"), ...p.species.map((s) => h("option", { value: s.id }, s.name))),
      h("h2", {}, "Gráficos propios (tileset y personajes)"),
      h("p", { class: "muted" }, `Puedes reemplazar los gráficos por los tuyos con una imagen PNG de ${ATLAS_COLS * TILE}×${ATLAS_ROWS * TILE} px (cuadrícula de ${ATLAS_COLS}×${ATLAS_ROWS} celdas de ${TILE}px, mismo orden que la plantilla). Descarga la plantilla para ver qué va en cada celda. La imagen se guarda solo en tu proyecto y no se publica.`),
      h("div", { class: "row" },
        h("button", { onclick: () => { const a = h("a", { href: createAtlas().toDataURL("image/png"), download: "atlas-plantilla.png" }); a.click(); } }, "Descargar plantilla"),
        h("button", { onclick: () => atlasFile.click() }, "Importar atlas PNG"),
        p.atlas ? h("button", { class: "danger", onclick: () => { delete p.atlas; hooks.onAtlas(null); onChange(); render(); } }, "Quitar y usar los de serie") : null,
        atlasFile),
    );
  };
  render();
  return { el, refresh: render };
}
