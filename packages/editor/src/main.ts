import "./style.css";
import { isMuted, setMuted } from "./audio";
import { h } from "./dom";
import { Engine } from "./engine";
import { MapView, type Selection, type Tool } from "./mapView";
import { SCRIPT_HELP, parseScript } from "./script";
import { type Npc, type Project, type Warp, defaultProject, parseProject, saveLocal, uniqueId, validate } from "./project";
import { loadProject as loadStored, saveProject } from "./storage";
import { ATLAS_COLS, ATLAS_ROWS, ERASE_OBJECT, TILE, TILE_DEFS, atlasFromDataUrl, atlasIndex, createAtlas } from "./tiles";
import { exportGameHtml, runPlayer } from "./player";
import { battlePanel } from "./ui/battlePanel";
import { dataPanel } from "./ui/dataPanel";

async function main() {
  if (window.__WPE_PLAYER__) { await runPlayer(); return; }
  const app = document.getElementById("app")!;
  const engine = await Engine.load(`${import.meta.env.BASE_URL}engine_core.wasm`);
  let project: Project = (await loadStored()) ?? defaultProject();

  const view = new MapView(engine);
  const status = h("span", { class: "status" });
  const log = h("div", { class: "log" });
  const say = (m: string) => { log.prepend(h("div", {}, m)); while (log.childElementCount > 40) log.lastElementChild!.remove(); };
  view.onMessage = say;

  // ---------- Autoguardado ----------
  let timer = 0;
  let pending = false;
  const saveNow = () => {
    clearTimeout(timer);
    pending = false;
    view.commit();
    void saveProject(project).then((where) => {
      status.textContent = where === "opfs" ? "Guardado (OPFS) ✓" : where === "local" ? "Guardado localmente ✓" : "⚠ No se pudo guardar. Exporta el proyecto.";
    });
  };
  const persist = () => {
    clearTimeout(timer);
    pending = true;
    status.textContent = "Guardando…";
    timer = window.setTimeout(saveNow, 400);
  };
  // no perder la última edición al recargar o cerrar la pestaña
  const flush = () => { if (pending && !view.playing) { saveNow(); saveLocal(project); } };
  window.addEventListener("pagehide", flush);
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") flush(); });
  view.onEdit = () => { persist(); sizeLabel(); };

  // ---------- Atlas y paleta ----------
  let atlas = (project.atlas && (await atlasFromDataUrl(project.atlas))) || createAtlas();
  const palette = h("div", { class: "palette" });
  const swatches: HTMLElement[] = [];
  const selectTile = (t: number) => { view.tile = t; swatches.forEach((s) => s.classList.toggle("sel", s.dataset.id === String(t))); };
  const buildPalette = () => {
    palette.replaceChildren(); swatches.length = 0;
    const entries = [...TILE_DEFS.map((d) => ({ id: d.id as number, name: d.name as string, solid: d.solid as boolean })), { id: ERASE_OBJECT, name: "Sin objeto", solid: false }];
    for (const d of entries) {
      const c = h("canvas", { width: TILE, height: TILE, title: d.name + (d.solid ? " (sólido)" : "") });
      if (d.id !== ERASE_OBJECT) {
        const g = c.getContext("2d")!;
        if (d.id >= 12) { g.fillStyle = "#5fb94d"; g.fillRect(0, 0, TILE, TILE); }
        const i = atlasIndex(d.id);
        g.drawImage(atlas, (i % ATLAS_COLS) * TILE, Math.floor(i / ATLAS_COLS) * TILE, TILE, TILE, 0, 0, TILE, TILE);
      } else { const g = c.getContext("2d")!; g.strokeStyle = "#e53935"; g.lineWidth = 2; g.beginPath(); g.moveTo(2, 2); g.lineTo(14, 14); g.moveTo(14, 2); g.lineTo(2, 14); g.stroke(); }
      const b = h("button", { class: "swatch", onclick: () => { selectTile(d.id); if (["pick", "spawn", "npc", "warp", "trigger", "raise", "lower"].includes(view.tool)) setTool("paint"); } }, c, h("span", {}, d.name));
      b.dataset.id = String(d.id);
      swatches.push(b); palette.append(b);
    }
    selectTile(view.tile);
  };
  view.onPick = (t) => { selectTile(t); setTool("paint"); };
  const applyAtlas = async (url: string | null) => {
    const custom = url ? await atlasFromDataUrl(url) : null;
    if (url && !custom) { delete project.atlas; alert(`El atlas debe ser un PNG de ${ATLAS_COLS * TILE}×${ATLAS_ROWS * TILE} px. Descarga la plantilla en Datos → Gráficos propios.`); }
    atlas = custom ?? createAtlas();
    view.setAtlas(atlas); buildPalette();
  };

  // ---------- Herramientas ----------
  const toolBtns = new Map<Tool, HTMLElement>();
  const setTool = (t: Tool) => { view.tool = t; toolBtns.forEach((b, k) => b.classList.toggle("sel", k === t)); };
  const tools = h("div", { class: "tools" });
  for (const [t, label, key] of [["paint", "✏️ Pintar", "B"], ["fill", "🪣 Rellenar", "G"], ["pick", "💧 Cuentagotas", "I"], ["spawn", "📍 Inicio", "P"], ["npc", "🧑 NPC", "N"], ["warp", "🚪 Salto", "J"], ["trigger", "⚡ Disparador", "T"], ["raise", "⛰ Elevar", "U"], ["lower", "🕳 Bajar", "H"]] as [Tool, string, string][]) {
    const b = h("button", { title: `${label} (${key})`, onclick: () => setTool(t) }, label);
    toolBtns.set(t, b); tools.append(b);
  }
  window.addEventListener("keydown", (e) => {
    if (["INPUT", "SELECT", "TEXTAREA"].includes((e.target as HTMLElement).tagName) || e.ctrlKey || e.metaKey || view.playing) return;
    const m: Record<string, Tool> = { KeyB: "paint", KeyG: "fill", KeyI: "pick", KeyP: "spawn", KeyN: "npc", KeyJ: "warp", KeyT: "trigger", KeyU: "raise", KeyH: "lower" };
    if (m[e.code]) setTool(m[e.code]);
  });

  const check = (label: string, init: boolean, on: (v: boolean) => void) =>
    h("label", { class: "check" }, h("input", { type: "checkbox", checked: init, onchange: (e: Event) => on((e.target as HTMLInputElement).checked) }), label);

  // ---------- Mapas ----------
  const mapSelect = h("select", { class: "grow", onchange: (e: Event) => { view.switchMap(+(e.target as HTMLSelectElement).value); sync(); } });
  const refreshMaps = () => {
    mapSelect.replaceChildren(...project.maps.map((m, i) => h("option", { value: i, selected: i === view.mapIndex }, m.name)));
  };
  const newMap = () => {
    const name = prompt("Nombre del nuevo mapa:", `Mapa ${project.maps.length + 1}`);
    if (!name) return;
    const w = 20, hh = 15, t = new Uint8Array(w * hh);
    for (let i = 0; i < w; i++) { t[i] = 4; t[(hh - 1) * w + i] = 4; }
    for (let j = 0; j < hh; j++) { t[j * w] = 4; t[j * w + w - 1] = 4; }
    let bin = ""; t.forEach((v) => (bin += String.fromCharCode(v)));
    project.maps.push({ id: uniqueId(project.maps.map((m) => m.id), name), name, w, h: hh, tiles: btoa(bin), npcs: [], warps: [], encounters: [], encounterLevel: [3, 6] });
    view.switchMap(project.maps.length - 1); sync(); persist();
  };
  const renameMap = () => {
    const name = prompt("Nuevo nombre:", view.map.name);
    if (name) { view.map.name = name; refreshMaps(); persist(); }
  };
  const deleteMap = () => {
    if (project.maps.length <= 1) { alert("El proyecto necesita al menos un mapa."); return; }
    const m = view.map;
    if (!confirm(`¿Eliminar "${m.name}"? También se quitarán los saltos que llevan a él.`)) return;
    const i = view.mapIndex;
    view.switchMap(i === 0 ? 1 : 0);
    project.maps.splice(project.maps.findIndex((k) => k.id === m.id), 1);
    for (const k of project.maps) k.warps = k.warps.filter((w) => w.toMap !== m.id);
    if (project.start.map === m.id) project.start = { map: project.maps[0].id, x: 1, y: 1 };
    view.setProject(project); sync(); persist();
  };

  const sizeInfo = h("span", { class: "muted" });
  const sizeLabel = () => (sizeInfo.textContent = `${engine.width}×${engine.height} tiles · ${view.map?.npcs.length ?? 0} NPC · ${view.map?.warps.length ?? 0} saltos · ${view.map?.triggers?.length ?? 0} disparadores`);
  const wIn = h("input", { type: "number", min: 4, max: 128, class: "n" }), hIn = h("input", { type: "number", min: 4, max: 128, class: "n" });
  const sync = () => { wIn.value = String(engine.width); hIn.value = String(engine.height); refreshMaps(); sizeLabel(); };
  const sizeBox = h("div", { class: "row" }, "Tamaño", wIn, "×", hIn,
    h("button", { onclick: () => { view.resizeMap(Math.min(128, Math.max(4, +wIn.value || 4)), Math.min(128, Math.max(4, +hIn.value || 4))); sync(); } }, "Aplicar"));

  // ---------- Inspector (NPC / salto) ----------
  const inspector = h("div", { class: "inspector" });
  const field = (label: string, ...ctl: (Node | string)[]) => h("label", { class: "field" }, h("span", {}, label), ...ctl);
  const numIn = (v: number, on: (n: number) => void, min = 0, max = 127) =>
    h("input", { type: "number", class: "n", min, max, value: v, oninput: (e: Event) => { on(+(e.target as HTMLInputElement).value || 0); persist(); } });
  const sel = <T extends string | number>(v: T, opts: [T, string][], on: (v: string) => void) =>
    h("select", { onchange: (e: Event) => { on((e.target as HTMLSelectElement).value); persist(); renderInspector(view.selection); } }, ...opts.map(([k, l]) => h("option", { value: k, selected: k === v }, l)));
  const lines = (arr: string[] | undefined, on: (a: string[]) => void) =>
    h("textarea", { rows: 3, value: (arr ?? []).join("\n"), oninput: (e: Event) => { on((e.target as HTMLTextAreaElement).value.split("\n").filter((l) => l.trim())); persist(); } });

  const scriptEditor = (get: () => string, set: (v: string) => void) => {
    const errBox = h("div", { class: "errs" });
    const check2 = () => { const r = parseScript(get()); errBox.textContent = r.ok ? "✓ Script válido" : r.errors.join("\n"); errBox.classList.toggle("bad", !r.ok); };
    const ta = h("textarea", { rows: 9, class: "code", spellcheck: false, value: get(), oninput: (e: Event) => { set((e.target as HTMLTextAreaElement).value); check2(); persist(); } });
    check2();
    return [field("Script (una orden por línea)", ta), errBox, h("details", {}, h("summary", {}, "Ayuda de órdenes"), h("pre", { class: "help" }, SCRIPT_HELP))];
  };

  const renderInspector = (s: Selection) => {
    inspector.replaceChildren();
    if (!s) { inspector.append(h("p", { class: "hint" }, "Usa las herramientas 🧑 NPC, 🚪 Salto o ⚡ Disparador y haz clic en el mapa para crear o seleccionar elementos.")); return; }
    if (s.kind === "npc") {
      const n: Npc | undefined = view.map.npcs[s.index];
      if (!n) return;
      inspector.append(
        h("h3", {}, "NPC"),
        field("Nombre", h("input", { type: "text", value: n.name, oninput: (e: Event) => { n.name = (e.target as HTMLInputElement).value; persist(); } })),
        field("Tipo", sel(n.kind, [["talk", "Conversación"], ["trainer", "Entrenador"], ["healer", "Curandero"], ["script", "Script"]], (v) => { n.kind = v as Npc["kind"]; if (n.kind === "trainer" && !n.team?.length) n.team = [{ species: project.species[0]?.id ?? "", level: 5 }]; })),
        ...(n.kind === "trainer" ? [h("label", { class: "check" }, h("input", { type: "checkbox", checked: !!n.double, onchange: (e: Event) => { n.double = (e.target as HTMLInputElement).checked; persist(); } }), "Combate doble (2 contra 2)")] : []),
        field("Aspecto", sel(n.look, [[0, "Morado"], [1, "Verde"], [2, "Gris"], [3, "Naranja"]], (v) => (n.look = +v))),
        field("Mira hacia", sel(n.dir, [[0, "Abajo"], [1, "Arriba"], [2, "Izquierda"], [3, "Derecha"]], (v) => (n.dir = +v))),
        field("Posición", numIn(n.x, (v) => (n.x = v), 0, engine.width - 1), numIn(n.y, (v) => (n.y = v), 0, engine.height - 1)),
        ...(n.kind === "script" ? [] : [field("Diálogo (una línea por mensaje)", lines(n.lines, (a) => (n.lines = a)))]),
      );
      if (n.kind === "script") inspector.append(...scriptEditor(() => n.script ?? "", (v) => (n.script = v)));
      if (n.kind === "trainer") {
        const team = n.team ?? (n.team = []);
        inspector.append(h("h3", {}, "Equipo del entrenador"),
          ...team.map((t, i) => h("div", { class: "row" },
            h("select", { onchange: (e: Event) => { t.species = (e.target as HTMLSelectElement).value; persist(); } }, ...project.species.map((sp) => h("option", { value: sp.id, selected: sp.id === t.species }, sp.name))),
            "Nv.", numIn(t.level, (v) => (t.level = Math.max(1, v)), 1, 100),
            h("button", { class: "danger", onclick: () => { team.splice(i, 1); persist(); renderInspector(s); } }, "✕"))),
          h("button", { disabled: team.length >= 6, onclick: () => { team.push({ species: project.species[0]?.id ?? "", level: 5 }); persist(); renderInspector(s); } }, "+ Criatura"),
          field("Tras perder", lines(n.defeatedLines, (a) => (n.defeatedLines = a))));
      }
    } else if (s.kind === "trigger") {
      const t = view.map.triggers?.[s.index];
      if (!t) return;
      inspector.append(
        h("h3", {}, "Disparador"),
        field("Nombre", h("input", { type: "text", value: t.name, oninput: (e: Event) => { t.name = (e.target as HTMLInputElement).value; persist(); } })),
        field("Posición", numIn(t.x, (v) => (t.x = v), 0, engine.width - 1), numIn(t.y, (v) => (t.y = v), 0, engine.height - 1)),
        h("label", { class: "check" }, h("input", { type: "checkbox", checked: t.once, onchange: (e: Event) => { t.once = (e.target as HTMLInputElement).checked; persist(); } }), "Solo la primera vez"),
        ...scriptEditor(() => t.script, (v) => (t.script = v)),
      );
    } else {
      const w: Warp | undefined = view.map.warps[s.index];
      if (!w) return;
      const dest = project.maps.find((m) => m.id === w.toMap) ?? project.maps[0];
      inspector.append(
        h("h3", {}, "Salto"),
        field("Posición", numIn(w.x, (v) => (w.x = v), 0, engine.width - 1), numIn(w.y, (v) => (w.y = v), 0, engine.height - 1)),
        field("Destino", sel(w.toMap, project.maps.map((m) => [m.id, m.name] as [string, string]), (v) => (w.toMap = v))),
        field("Coordenadas", numIn(w.toX, (v) => (w.toX = v), 0, dest.w - 1), numIn(w.toY, (v) => (w.toY = v), 0, dest.h - 1)),
        h("p", { class: "hint" }, "Se activa al pisar la casilla. Pon el destino una casilla delante de la puerta de vuelta para no rebotar."),
      );
    }
    inspector.append(h("button", { class: "danger", onclick: () => view.deleteSelection() }, "🗑 Eliminar"));
  };
  view.onSelect = renderInspector;
  renderInspector(null);

  // ---------- Barra superior y modos ----------
  const playBtn = h("button", { class: "primary" }, "▶ Probar");
  const btn3d = h("button", { title: "Vista 3D estilo DS (requiere WebGPU). Q/E giran la cámara; arrastra para orbitar." }, "🧊 3D");
  const side = h("aside", { class: "side" },
    h("h3", {}, "Herramientas"), tools,
    h("h3", {}, "Tiles"), palette,
    h("h3", {}, "Vista"),
    check("Cuadrícula", true, (v) => (view.showGrid = v)),
    check("Mostrar colisiones", false, (v) => (view.showSolid = v)),
    check("Mostrar alturas (3D)", false, (v) => (view.showHeights = v)),
    h("button", { onclick: () => view.fit() }, "Centrar mapa"),
    h("h3", {}, "Mapas"),
    h("div", { class: "row" }, mapSelect),
    h("div", { class: "row" }, h("button", { onclick: newMap }, "+ Nuevo"), h("button", { onclick: renameMap }, "Renombrar"), h("button", { class: "danger", onclick: deleteMap }, "Eliminar")),
    sizeBox, sizeInfo,
    h("h3", {}, "Inspector"), inspector,
    h("p", { class: "hint" }, "Rueda: zoom · Clic derecho / Espacio+arrastrar: mover · Ctrl+Z / Ctrl+Y: deshacer/rehacer · Supr: borrar selección"),
  );
  const togglePlay = () => {
    if (view.playing) { view.stopPlay(); playBtn.textContent = "▶ Probar"; side.classList.remove("disabled"); sync(); }
    else { view.startPlay(); playBtn.textContent = "■ Detener"; side.classList.add("disabled"); }
  };
  playBtn.onclick = togglePlay;
  btn3d.onclick = async () => {
    const ok = await view.set3D(!view.mode3d);
    btn3d.classList.toggle("sel", view.mode3d && ok);
  };
  const muteBtn = h("button", { title: "Silenciar / activar sonido", onclick: () => { setMuted(!isMuted()); muteBtn.textContent = isMuted() ? "🔇" : "🔊"; } }, "🔊");

  const mapTab = h("div", { class: "maptab" }, side, h("div", { class: "stage" }, view.el), h("aside", { class: "log-panel" }, h("h3", {}, "Mensajes"), log));

  // ---------- Pestañas ----------
  const data = dataPanel(() => project, { onChange: () => { persist(); battle.refresh(); }, onAtlas: (u) => void applyAtlas(u) });
  const battle = battlePanel(() => project, engine);
  const tabs: [string, string, HTMLElement][] = [["map", "🗺️ Mapa", mapTab], ["data", "📋 Datos", data.el], ["battle", "⚔️ Calculadora", battle.el]];
  const body = h("main", {});
  const tabBar = h("nav", { class: "tabs" });
  const show = (id: string) => {
    for (const [k, , el] of tabs) el.hidden = k !== id;
    [...tabBar.children].forEach((b, i) => b.classList.toggle("sel", tabs[i][0] === id));
    if (id === "data") data.refresh();
    if (id === "battle") battle.refresh();
    if (id !== "map" && view.playing) togglePlay();
  };
  for (const [k, label, el] of tabs) { tabBar.append(h("button", { onclick: () => show(k) }, label)); body.append(el); void k; }

  // ---------- Archivo ----------
  const nameIn = h("input", { type: "text", class: "title", value: project.name, oninput: () => { project.name = nameIn.value; persist(); } });
  const loadProject = async (p: Project) => {
    if (view.playing) togglePlay();
    project = p; nameIn.value = p.name; view.setProject(p);
    await applyAtlas(p.atlas ?? null);
    sync(); persist(); data.refresh(); battle.refresh();
  };
  const fileIn = h("input", { type: "file", accept: ".json,application/json", hidden: true, onchange: async (e: Event) => {
    const f = (e.target as HTMLInputElement).files?.[0];
    if (!f) return;
    try { await loadProject(parseProject(await f.text())); say(`Proyecto "${project.name}" importado.`); }
    catch (err) { alert((err as Error).message); }
    (e.target as HTMLInputElement).value = "";
  } });
  const exportJson = () => {
    view.commit();
    const errs = validate(project);
    if (errs.length && !confirm("El proyecto tiene problemas:\n- " + errs.join("\n- ") + "\n\n¿Exportar igualmente?")) return;
    const a = h("a", { href: URL.createObjectURL(new Blob([JSON.stringify(project, null, 2)], { type: "application/json" })), download: `${project.name.replace(/\W+/g, "-") || "proyecto"}.wpe.json` });
    a.click(); URL.revokeObjectURL(a.href);
  };

  const exportGame = async () => {
    view.commit();
    const errs = validate(project);
    if (errs.length && !confirm("El proyecto tiene problemas:\n- " + errs.join("\n- ") + "\n\n¿Exportar igualmente?")) return;
    try {
      const blob = await exportGameHtml(project);
      const a = h("a", { href: URL.createObjectURL(blob), download: `${project.name.replace(/\W+/g, "-") || "juego"}.html` });
      a.click(); URL.revokeObjectURL(a.href);
      say(`Juego exportado (${(blob.size / 1024).toFixed(0)} KB): un único .html que funciona sin servidor.`);
    } catch (e) { alert((e as Error).message); }
  };

  const top = h("header", { class: "top" },
    h("div", { class: "brand" }, "◓ WebPokeEditor"), nameIn,
    h("div", { class: "grow" }), status,
    h("button", { onclick: () => fileIn.click() }, "Importar"), h("button", { onclick: exportJson, title: "Guarda el proyecto (.wpe.json) para seguir editándolo" }, "Exportar proyecto"),
    h("button", { onclick: exportGame, title: "Genera un único .html jugable con tu juego" }, "📦 Exportar juego"),
    h("button", { onclick: async () => { if (confirm("¿Crear un proyecto nuevo? Se perderán los cambios no exportados.")) await loadProject(defaultProject()); } }, "Nuevo"),
    muteBtn, btn3d, playBtn, fileIn,
  );
  const footer = h("footer", {}, h("span", {}, "Motor: Rust → WASM · Render: "), h("b", {}, "…"), h("span", {}, " · Sin afiliación con Nintendo/Game Freak/The Pokémon Company. Criaturas y arte originales; importa tus propios gráficos en Datos."));

  app.append(top, tabBar, body, footer);
  await view.init(project, atlas);
  footer.querySelector("b")!.textContent = view.rendererKind === "webgpu" ? "WebGPU (+3D)" : "Canvas 2D (sin WebGPU, sin modo 3D)";
  buildPalette(); selectTile(1); setTool("paint"); show("map"); sync();
  status.textContent = "Listo";
  if (import.meta.env.PROD && "serviceWorker" in navigator) navigator.serviceWorker.register("./sw.js").catch(() => {});
  say("Bienvenido. Pinta el mapa, coloca NPC y saltos, y pulsa ▶ Probar. Prueba también 🧊 3D.");
  void ((window as unknown as Record<string, unknown>).__wpe = { engine, view, get project() { return project; } });
}

main().catch((e) => {
  console.error(e);
  document.getElementById("app")!.textContent = "Error al iniciar: " + (e as Error).message;
});
