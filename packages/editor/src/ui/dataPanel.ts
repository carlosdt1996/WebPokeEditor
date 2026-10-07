import { h } from "../dom";
import { ATLAS_COLS, ATLAS_ROWS, TILE, createAtlas } from "../tiles";
import { BATTLE_STATS, BATTLE_STAT_NAMES, STATUS_KINDS, STATUS_NAMES, STAT_KEYS, WEATHER_KINDS, WEATHER_NAMES, defaultWeatherRules, type AbilityDef, type BattleStat, type HoldEffect, type Move, type Project, type Species, type StatusKind, type WeatherKind, uniqueId } from "../project";
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

  const HOLD_NAMES: Record<HoldEffect["kind"], string> = { boost: "Refuerza un tipo", leftovers: "Cura 1/16 por turno", berry: "Baya de curación", cureBerry: "Baya de estado", focus: "Aguante (1 PS)" };
  /** Editor del efecto de un objeto equipable. */
  const holdCell = (p: Project, it: { hold?: HoldEffect }) => {
    const hd = (it.hold ??= { kind: "leftovers" });
    return h("span", {}, h("select", { onchange: (e: Event) => { hd.kind = (e.target as HTMLSelectElement).value as HoldEffect["kind"]; if (hd.kind === "boost" && hd.type === undefined) hd.type = 0; onChange(); render(); } },
      ...(Object.keys(HOLD_NAMES) as HoldEffect["kind"][]).map((k) => h("option", { value: k, selected: hd.kind === k }, HOLD_NAMES[k]))),
      hd.kind === "boost" ? typeSel(p, hd.type ?? 0, (n) => (hd.type = n)) : "",
      hd.kind === "boost" || hd.kind === "berry" ? num(hd.amount ?? 20, (n) => (hd.amount = n), 0, 100) : "", hd.kind === "boost" ? "%" : hd.kind === "berry" ? "% PS" : "");
  };

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
        h("td", {}, h("select", { onchange: (e: Event) => { const v = (e.target as HTMLSelectElement).value; if (v) s.ability = v; else delete s.ability; onChange(); } },
          h("option", { value: "" }, "—"), ...(p.abilities ?? []).map((a) => h("option", { value: a.id, selected: s.ability === a.id }, a.name)))),
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

    // Efectos de movimientos (por datos)
    const eff = (m: Move) => (m.effect ??= {});
    const clean = (m: Move) => { const e = m.effect; if (e && !e.priority && !e.status && !e.stat && !e.drain && !e.recoil && !e.heal && !e.hits && !e.crit && !e.charge && !e.recharge && !e.weather && !e.terrain) delete m.effect; };
    const fxRows = p.moves.map((m) => h("tr", {},
      h("td", {}, h("b", {}, m.name)),
      h("td", {}, num(m.effect?.priority ?? 0, (n) => { eff(m).priority = n || undefined; clean(m); }, -3, 3)),
      h("td", { class: "nw" }, h("select", { onchange: (e: Event) => { const v = (e.target as HTMLSelectElement).value; if (v) eff(m).status = { kind: v as StatusKind, chance: m.effect?.status?.chance ?? 100 }; else delete eff(m).status; clean(m); onChange(); render(); } },
        h("option", { value: "" }, "—"), ...STATUS_KINDS.map((k) => h("option", { value: k, selected: m.effect?.status?.kind === k }, STATUS_NAMES[k]))),
        m.effect?.status ? num(m.effect.status.chance, (n) => (m.effect!.status!.chance = n), 0, 100) : "", m.effect?.status ? "%" : ""),
      h("td", { class: "nw" }, h("select", { onchange: (e: Event) => { const v = (e.target as HTMLSelectElement).value; if (v) eff(m).stat = { stat: v as BattleStat, stages: m.effect?.stat?.stages ?? 1, target: m.effect?.stat?.target ?? "self", chance: m.effect?.stat?.chance ?? 100 }; else delete eff(m).stat; clean(m); onChange(); render(); } },
        h("option", { value: "" }, "—"), ...BATTLE_STATS.map((k) => h("option", { value: k, selected: m.effect?.stat?.stat === k }, BATTLE_STAT_NAMES[k]))),
        ...(m.effect?.stat ? [num(m.effect.stat.stages, (n) => (m.effect!.stat!.stages = n), -6, 6),
          h("select", { onchange: (e: Event) => { m.effect!.stat!.target = (e.target as HTMLSelectElement).value as "self" | "foe"; onChange(); } }, h("option", { value: "self", selected: m.effect.stat.target === "self" }, "usuario"), h("option", { value: "foe", selected: m.effect.stat.target === "foe" }, "rival")),
          num(m.effect.stat.chance, (n) => (m.effect!.stat!.chance = n), 0, 100), "%"] : [])),
      h("td", {}, num(m.effect?.drain ?? 0, (n) => { eff(m).drain = n || undefined; clean(m); }, 0, 100)),
      h("td", {}, num(m.effect?.recoil ?? 0, (n) => { eff(m).recoil = n || undefined; clean(m); }, 0, 100)),
      h("td", {}, num(m.effect?.heal ?? 0, (n) => { eff(m).heal = n || undefined; clean(m); }, 0, 100)),
      h("td", { class: "nw" }, num(m.effect?.hits?.min ?? 0, (n) => { const e = eff(m); if (!n && !(e.hits?.max)) delete e.hits; else e.hits = { min: n || 1, max: Math.max(n || 1, e.hits?.max ?? n) }; clean(m); }, 0, 5), "–",
        num(m.effect?.hits?.max ?? 0, (n) => { const e = eff(m); if (n <= 1) delete e.hits; else e.hits = { min: Math.min(e.hits?.min || 2, n), max: n }; clean(m); }, 0, 5)),
      h("td", {}, num(m.effect?.crit ?? 0, (n) => { eff(m).crit = n || undefined; clean(m); }, 0, 3)),
      h("td", {}, h("input", { type: "checkbox", checked: !!m.effect?.charge, onchange: (e: Event) => { eff(m).charge = (e.target as HTMLInputElement).checked || undefined; clean(m); onChange(); } })),
      h("td", {}, h("input", { type: "checkbox", checked: !!m.effect?.recharge, onchange: (e: Event) => { eff(m).recharge = (e.target as HTMLInputElement).checked || undefined; clean(m); onChange(); } })),
      h("td", {}, h("select", { onchange: (e: Event) => { const v = (e.target as HTMLSelectElement).value; if (v) eff(m).weather = v as WeatherKind; else delete eff(m).weather; clean(m); onChange(); } },
        h("option", { value: "" }, "—"), ...WEATHER_KINDS.map((k) => h("option", { value: k, selected: m.effect?.weather === k }, WEATHER_NAMES[k])))),
      h("td", {}, h("input", { type: "checkbox", checked: !!m.effect?.terrain, title: "Crea un terreno que potencia el tipo de este movimiento", onchange: (e: Event) => { eff(m).terrain = (e.target as HTMLInputElement).checked || undefined; clean(m); onChange(); } })),
    ));

    // Habilidades
    const abKinds: [AbilityDef["kind"], string][] = [["pinch", "Potencia con pocos PS (tipo)"], ["absorb", "Absorbe un tipo y se cura"], ["immune", "Inmune a un tipo"], ["statusImmune", "Inmune a un estado"], ["intimidate", "Intimidar (baja el Ataque rival)"], ["speedBoost", "Sube la Velocidad cada turno"], ["weather", "Establece un clima al entrar"]];
    const abRows = (p.abilities ?? []).map((a) => h("tr", {},
      h("td", {}, txt(a.name, (v) => (a.name = v))),
      h("td", {}, h("select", { onchange: (e: Event) => { a.kind = (e.target as HTMLSelectElement).value as AbilityDef["kind"]; if (["immune", "absorb", "pinch"].includes(a.kind) && a.type === undefined) a.type = 0; if (a.kind === "statusImmune" && !a.status) a.status = "poison"; if (a.kind === "weather" && !a.weather) a.weather = "sun"; onChange(); render(); } }, ...abKinds.map(([k, l]) => h("option", { value: k, selected: a.kind === k }, l)))),
      h("td", {}, ["immune", "absorb", "pinch"].includes(a.kind) ? typeSel(p, a.type ?? 0, (n) => (a.type = n)) : a.kind === "statusImmune"
        ? h("select", { onchange: (e: Event) => { a.status = (e.target as HTMLSelectElement).value as StatusKind; onChange(); } }, ...STATUS_KINDS.map((k) => h("option", { value: k, selected: a.status === k }, STATUS_NAMES[k])))
        : a.kind === "weather" ? h("select", { onchange: (e: Event) => { a.weather = (e.target as HTMLSelectElement).value as WeatherKind; onChange(); } }, ...WEATHER_KINDS.map((k) => h("option", { value: k, selected: a.weather === k }, WEATHER_NAMES[k]))) : h("small", { class: "muted" }, "—")),
      h("td", {}, a.kind === "absorb" ? num(a.amount ?? 25, (n) => (a.amount = n), 0, 100) : h("small", { class: "muted" }, "—")),
      h("td", {}, txt(a.description ?? "", (v) => (a.description = v))),
      h("td", {}, h("small", { class: "muted" }, a.id)),
      h("td", {}, h("button", { class: "danger", onclick: () => { p.abilities = p.abilities.filter((x) => x !== a); for (const sp of p.species) if (sp.ability === a.id) delete sp.ability; onChange(); render(); } }, "✕"))));

    // Reglas de clima (por datos)
    const rules = (p.weatherRules ??= defaultWeatherRules(p.types));
    const optType = (v: number | undefined, on: (n: number | undefined) => void) => h("select", { onchange: (e: Event) => { const x = (e.target as HTMLSelectElement).value; on(x === "" ? undefined : +x); onChange(); } },
      h("option", { value: "" }, "—"), ...p.types.map((t, i) => h("option", { value: i, selected: v === i }, t)));
    const wRows = WEATHER_KINDS.map((k) => {
      const r = (rules[k] ??= {});
      return h("tr", {}, h("td", {}, h("b", {}, WEATHER_NAMES[k])),
        h("td", {}, optType(r.boost, (n) => (r.boost = n))), h("td", {}, optType(r.weaken, (n) => (r.weaken = n))),
        h("td", {}, h("input", { type: "checkbox", checked: !!r.chip, onchange: (e: Event) => { r.chip = (e.target as HTMLInputElement).checked; onChange(); } })),
        h("td", { class: "nw" }, ...p.types.map((t, i) => h("label", { class: "check inline" }, h("input", { type: "checkbox", checked: (r.immune ?? []).includes(i), onchange: (e: Event) => { const on = (e.target as HTMLInputElement).checked; const set = new Set(r.immune ?? []); if (on) set.add(i); else set.delete(i); r.immune = [...set].slice(0, 4); onChange(); } }), t))));
    });

    // Objetos e inventario
    const itemRows = p.items.map((it) => h("tr", {},
      h("td", {}, txt(it.name, (v) => (it.name = v))),
      h("td", {}, h("small", { class: "muted" }, it.id)),
      h("td", {}, h("select", { onchange: (e: Event) => { it.kind = (e.target as HTMLSelectElement).value as typeof it.kind; if (it.kind === "held" && !it.hold) it.hold = { kind: "leftovers" }; onChange(); render(); } },
        h("option", { value: "heal", selected: it.kind === "heal" }, "Cura PS"), h("option", { value: "cure", selected: it.kind === "cure" }, "Cura estado"), h("option", { value: "held", selected: it.kind === "held" }, "Equipable"), h("option", { value: "ball", selected: it.kind === "ball" }, "Captura"))),
      h("td", { class: "nw" }, it.kind === "held" ? holdCell(p, it) : it.kind === "cure" ? h("small", { class: "muted" }, "—") : num(it.amount, (n) => (it.amount = n), 0, 999), h("small", { class: "muted" }, it.kind === "heal" ? " PS" : it.kind === "ball" ? " % extra" : "")),
      h("td", {}, num(p.inventory[it.id] ?? 0, (n) => (p.inventory[it.id] = n), 0, 99)),
      h("td", {}, h("button", { class: "danger", onclick: () => { p.items = p.items.filter((x) => x !== it); delete p.inventory[it.id]; onChange(); render(); } }, "✕"))));

    // Equipo inicial
    const partyRows = p.party.map((t, i) => h("div", { class: "row" },
      speciesSel(p, t.species, (id) => (t.species = id)), "Nv.", num(t.level, (n) => (t.level = n), 1, 100),
      h("select", { title: "Objeto equipado", onchange: (e: Event) => { const v = (e.target as HTMLSelectElement).value; if (v) t.held = v; else delete t.held; onChange(); } },
        h("option", { value: "" }, "sin objeto"), ...p.items.filter((x) => x.kind === "held").map((x) => h("option", { value: x.id, selected: t.held === x.id }, x.name))),
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
        h("thead", {}, h("tr", {}, ...["Sprite", "Nombre", "Tipo 1", "Tipo 2", "PS", "Ata", "Def", "AtE", "DeE", "Vel", "Movimientos", "Habilidad", "Evolución", "Aprende (nv:mov)", ""].map((t) => h("th", {}, t)))),
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
      h("h2", {}, "Efectos de los movimientos"),
      h("p", { class: "muted" }, "Un movimiento con poder 0 solo aplica sus efectos. Prioridad −3…+3 · estado y cambio de estadística (incluye Precisión y Evasión) con probabilidad · drenaje/retroceso = % del daño · cura = % de los PS máximos · golpes 2–5 · crítico 0–3 (1/16, 1/8, 1/4, 1/2) · carga = tarda un turno · recarga = pierde el turno siguiente · clima/terreno duran 5 turnos."),
      h("div", { class: "scroll" }, h("table", {},
        h("thead", {}, h("tr", {}, ...["Movimiento", "Prioridad", "Estado al rival", "Cambio de estadística (etapas)", "Drenaje %", "Retroceso %", "Cura %", "Golpes", "Crítico 0–3", "Carga", "Recarga", "Clima", "Terreno"].map((t) => h("th", {}, t)))),
        h("tbody", {}, ...fxRows))),
      h("h2", {}, "Reglas de clima"),
      h("p", { class: "muted" }, "Qué tipo potencia (+50 %) y debilita (−50 %) cada clima, si hace daño residual (1/16 de los PS) y qué tipos son inmunes (máx. 4). Cada mapa puede tener un clima permanente en sus combates."),
      h("div", { class: "scroll" }, h("table", {}, h("thead", {}, h("tr", {}, ...["Clima", "Potencia", "Debilita", "Daña", "Tipos inmunes"].map((t) => h("th", {}, t)))), h("tbody", {}, ...wRows))),
      h("h2", {}, "Habilidades"),
      h("p", { class: "muted" }, "Se asignan a las especies en la tabla de especies. Son datos: no hay código nuevo por habilidad."),
      h("div", { class: "scroll" }, h("table", {},
        h("thead", {}, h("tr", {}, ...["Nombre", "Efecto", "Tipo / estado", "% cura", "Descripción", "Id", ""].map((t) => h("th", {}, t)))),
        h("tbody", {}, ...abRows))),
      h("button", { onclick: () => { p.abilities ??= []; p.abilities.push({ id: uniqueId(p.abilities.map((a) => a.id), "habilidad"), name: "Habilidad", kind: "intimidate" }); onChange(); render(); } }, "+ Añadir habilidad"),
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
