import "./style.css";
import { h } from "./dom";
import { Engine } from "./engine";
import { MapView, type Tool } from "./mapView";
import { type Project, defaultProject, encodeTiles, loadLocal, parseProject, saveLocal, validate } from "./project";
import { ATLAS_COLS, TILE, TILE_DEFS, createAtlas } from "./tiles";
import { battlePanel } from "./ui/battlePanel";
import { dataPanel } from "./ui/dataPanel";

async function main() {
  const app = document.getElementById("app")!;
  const engine = await Engine.load(`${import.meta.env.BASE_URL}engine_core.wasm`);
  let project: Project = loadLocal() ?? defaultProject();

  const view = new MapView(engine);
  const status = h("span", { class: "status" });
  const log = h("div", { class: "log" });
  const say = (m: string) => { log.prepend(h("div", {}, m)); while (log.childElementCount > 30) log.lastElementChild!.remove(); };
  view.onMessage = say;

  // Autoguardado
  let timer = 0;
  const persist = () => {
    clearTimeout(timer);
    status.textContent = "Guardando…";
    timer = window.setTimeout(() => {
      view.syncTo(project);
      project.map.tiles = encodeTiles(engine.tiles);
      saveLocal(project);
      status.textContent = "Guardado localmente ✓";
    }, 400);
  };
  view.onEdit = () => { persist(); sizeLabel(); };

  // Paleta
  const atlas = createAtlas();
  const palette = h("div", { class: "palette" });
  const swatches: HTMLElement[] = [];
  const selectTile = (t: number) => {
    view.tile = t;
    swatches.forEach((s, i) => s.classList.toggle("sel", i === t));
  };
  for (const d of TILE_DEFS) {
    const c = h("canvas", { width: TILE, height: TILE, title: d.name + (d.solid ? " (sólido)" : "") });
    c.getContext("2d")!.drawImage(atlas, (d.id % ATLAS_COLS) * TILE, 0, TILE, TILE, 0, 0, TILE, TILE);
    const b = h("button", { class: "swatch", onclick: () => { selectTile(d.id); if (view.tool === "pick" || view.tool === "spawn") setTool("paint"); } }, c, h("span", {}, d.name));
    swatches.push(b);
    palette.append(b);
  }
  view.onPick = (t) => { selectTile(t); setTool("paint"); };

  // Herramientas
  const toolBtns = new Map<Tool, HTMLElement>();
  const setTool = (t: Tool) => { view.tool = t; toolBtns.forEach((b, k) => b.classList.toggle("sel", k === t)); };
  const tools = h("div", { class: "tools" });
  for (const [t, label, key] of [["paint", "✏️ Pintar", "B"], ["fill", "🪣 Rellenar", "G"], ["pick", "💧 Cuentagotas", "I"], ["spawn", "📍 Inicio", "P"]] as [Tool, string, string][]) {
    const b = h("button", { title: `${label} (${key})`, onclick: () => setTool(t) }, label);
    toolBtns.set(t, b); tools.append(b);
  }
  window.addEventListener("keydown", (e) => {
    if (["INPUT", "SELECT", "TEXTAREA"].includes((e.target as HTMLElement).tagName) || e.ctrlKey || e.metaKey || view.playing) return;
    const m: Record<string, Tool> = { KeyB: "paint", KeyG: "fill", KeyI: "pick", KeyP: "spawn" };
    if (m[e.code]) setTool(m[e.code]);
  });

  const check = (label: string, init: boolean, on: (v: boolean) => void) =>
    h("label", { class: "check" }, h("input", { type: "checkbox", checked: init, onchange: (e: Event) => on((e.target as HTMLInputElement).checked) }), label);

  const sizeInfo = h("span", { class: "muted" });
  const sizeLabel = () => (sizeInfo.textContent = `${engine.width}×${engine.height} tiles`);
  const dimInput = (id: string) => h("input", { type: "number", min: 4, max: 128, class: "n", id });
  const wIn = dimInput("mw"), hIn = dimInput("mh");
  const sync = () => { (wIn as HTMLInputElement).value = String(engine.width); (hIn as HTMLInputElement).value = String(engine.height); sizeLabel(); };
  const sizeBox = h("div", { class: "row" }, "Tamaño", wIn, "×", hIn,
    h("button", { onclick: () => { const w = Math.min(128, Math.max(4, +(wIn as HTMLInputElement).value || 4)), hh = Math.min(128, Math.max(4, +(hIn as HTMLInputElement).value || 4)); view.resizeMap(w, hh); sync(); view.fit(); } }, "Aplicar"));

  const playBtn = h("button", { class: "primary" }, "▶ Probar");
  const togglePlay = () => {
    if (view.playing) { view.stopPlay(); playBtn.textContent = "▶ Probar"; side.classList.remove("disabled"); }
    else { view.startPlay(); playBtn.textContent = "■ Detener"; side.classList.add("disabled"); }
  };
  playBtn.onclick = togglePlay;

  const side = h("aside", { class: "side" },
    h("h3", {}, "Herramientas"), tools,
    h("h3", {}, "Tiles"), palette,
    h("h3", {}, "Vista"),
    check("Cuadrícula", true, (v) => (view.showGrid = v)),
    check("Mostrar colisiones", false, (v) => (view.showSolid = v)),
    h("button", { onclick: () => view.fit() }, "Centrar mapa"),
    h("h3", {}, "Mapa"), sizeBox, sizeInfo,
    h("p", { class: "hint" }, "Rueda: zoom · Clic derecho / Espacio+arrastrar: mover · Ctrl+Z / Ctrl+Y: deshacer/rehacer"),
  );

  const mapTab = h("div", { class: "maptab" }, side, h("div", { class: "stage" }, view.el), h("aside", { class: "log-panel" }, h("h3", {}, "Mensajes"), log));

  // Pestañas
  const data = dataPanel(() => project, () => { persist(); battle.refresh(); });
  const battle = battlePanel(() => project, engine);
  const tabs: [string, string, HTMLElement][] = [["map", "🗺️ Mapa", mapTab], ["data", "📋 Datos", data.el], ["battle", "⚔️ Combate", battle.el]];
  const body = h("main", {});
  const tabBar = h("nav", { class: "tabs" });
  const show = (id: string) => {
    for (const [k, , el] of tabs) el.hidden = k !== id;
    [...tabBar.children].forEach((b, i) => b.classList.toggle("sel", tabs[i][0] === id));
    if (id === "data") data.refresh();
    if (id === "battle") battle.refresh();
    if (id !== "map" && view.playing) togglePlay();
  };
  for (const [k, label, el] of tabs) { tabBar.append(h("button", { onclick: () => show(k) }, label)); body.append(el); }

  // Barra superior
  const nameIn = h("input", { type: "text", class: "title", value: project.name, oninput: (e: Event) => { project.name = (e.target as HTMLInputElement).value; persist(); } });
  const fileIn = h("input", { type: "file", accept: ".json,application/json", hidden: true, onchange: async (e: Event) => {
    const f = (e.target as HTMLInputElement).files?.[0];
    if (!f) return;
    try { loadProject(parseProject(await f.text())); say(`Proyecto "${project.name}" importado.`); }
    catch (err) { alert((err as Error).message); }
    (e.target as HTMLInputElement).value = "";
  } });
  const loadProject = (p: Project) => {
    project = p; nameIn.value = p.name; view.setProject(p); sync(); view.fit(); persist(); data.refresh(); battle.refresh();
  };
  const exportJson = () => {
    view.syncTo(project); project.map.tiles = encodeTiles(engine.tiles);
    const errs = validate(project);
    if (errs.length && !confirm("El proyecto tiene problemas:\n- " + errs.join("\n- ") + "\n\n¿Exportar igualmente?")) return;
    const a = h("a", { href: URL.createObjectURL(new Blob([JSON.stringify(project, null, 2)], { type: "application/json" })), download: `${project.name.replace(/\W+/g, "-") || "proyecto"}.wpe.json` });
    a.click(); URL.revokeObjectURL(a.href);
  };

  const top = h("header", { class: "top" },
    h("div", { class: "brand" }, "◓ WebPokeEditor"), nameIn,
    h("div", { class: "grow" }), status,
    h("button", { onclick: () => fileIn.click() }, "Importar"), h("button", { onclick: exportJson }, "Exportar"),
    h("button", { onclick: () => { if (confirm("¿Crear un proyecto nuevo? Se perderán los cambios no exportados.")) loadProject(defaultProject()); } }, "Nuevo"),
    playBtn, fileIn,
  );
  const footer = h("footer", {}, h("span", {}, "Motor: Rust → WASM · Render: "), h("b", {}, "…"), h("span", {}, " · Sin afiliación con Nintendo/Game Freak. Criaturas y arte originales."));

  app.append(top, tabBar, body, footer);
  await view.init(project);
  footer.querySelector("b")!.textContent = view.rendererKind === "webgpu" ? "WebGPU" : "Canvas 2D (sin WebGPU)";
  selectTile(1); setTool("paint"); show("map"); sync();
  status.textContent = "Listo";
  say("Bienvenido. Pinta el mapa y pulsa ▶ Probar para caminar por él.");
  void ((window as unknown as Record<string, unknown>).__wpe = { engine, view });
}

main().catch((e) => {
  console.error(e);
  document.getElementById("app")!.textContent = "Error al iniciar: " + (e as Error).message;
});
