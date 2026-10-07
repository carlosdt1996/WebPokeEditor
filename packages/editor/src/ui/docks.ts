/**
 * Paneles acoplables al estilo de Godot: «Escena» (árbol de nodos del mapa actual) y «Sistema de archivos» (recursos del proyecto),
 * además del menú desplegable de la barra superior. Todo es DOM sencillo; los iconos son emojis (no se usan iconos de terceros).
 */
import { h } from "../dom";
import { t as tr } from "../i18n";
import type { Project } from "../project";
import type { Selection } from "../mapView";

export interface SceneHooks {
  project(): Project;
  mapIndex(): number;
  selection(): Selection;
  select(s: Selection): void;
  switchMap(i: number): void;
  openData(section: string): void;
}

/** Cabecera de un dock con título y cuerpo desplazable. */
export const dock = (title: string, body: HTMLElement, cls = "") =>
  h("section", { class: `dock-panel ${cls}` }, h("div", { class: "dock-title" }, title), body);

/** Árbol de «Escena»: el mapa como nodo raíz y, debajo, saltos, disparadores y NPC. */
export function sceneTree(hooks: SceneHooks) {
  const el = h("div", { class: "tree", role: "tree" });
  const row = (depth: number, icon: string, label: string, opts: { sel?: boolean; onclick?: () => void; hint?: string } = {}) =>
    h("button", { class: `tree-row${opts.sel ? " sel" : ""}`, style: `padding-left:${6 + depth * 14}px`, role: "treeitem", onclick: opts.onclick ?? (() => {}), title: opts.hint ?? label },
      h("span", { class: "tree-ico" }, icon), h("span", { class: "tree-lbl" }, label));
  const render = () => {
    const p = hooks.project();
    const m = p.maps[hooks.mapIndex()];
    if (!m) { el.replaceChildren(); return; }
    const s = hooks.selection();
    const isSel = (kind: string, i: number) => !!s && s.kind === kind && s.index === i;
    const rows: HTMLElement[] = [row(0, "🗺️", m.name, { hint: `${m.w}×${m.h}`, onclick: () => hooks.select(null) })];
    const group = (icon: string, label: string, n: number) => rows.push(h("div", { class: "tree-group", style: "padding-left:20px" }, `${icon} ${label} (${n})`));
    group("🧑", tr("NPC"), m.npcs.length);
    m.npcs.forEach((n, i) => rows.push(row(2, n.kind === "trainer" ? "⚔️" : n.kind === "healer" ? "💊" : n.kind === "shop" ? "🛒" : n.kind === "script" ? "📜" : "💬", n.name || n.id, { sel: isSel("npc", i), onclick: () => hooks.select({ kind: "npc", index: i }), hint: `${n.kind} (${n.x},${n.y})` })));
    group("🚪", tr("Saltos"), m.warps.length);
    m.warps.forEach((w, i) => rows.push(row(2, "🚪", `→ ${p.maps.find((k) => k.id === w.toMap)?.name ?? w.toMap}`, { sel: isSel("warp", i), onclick: () => hooks.select({ kind: "warp", index: i }), hint: `(${w.x},${w.y})` })));
    const trg = m.triggers ?? [];
    group("⚡", tr("Disparadores"), trg.length);
    trg.forEach((t, i) => rows.push(row(2, "⚡", t.name || `(${t.x},${t.y})`, { sel: isSel("trigger", i), onclick: () => hooks.select({ kind: "trigger", index: i }), hint: `(${t.x},${t.y})` })));
    el.replaceChildren(...rows);
  };
  render();
  return { el, refresh: render };
}

/** «Sistema de archivos»: carpetas virtuales del proyecto (mapas, especies, movimientos, objetos…). */
export function fileSystem(hooks: SceneHooks) {
  const el = h("div", { class: "tree", role: "tree" });
  const open = new Set<string>(["maps"]);
  const render = () => {
    const p = hooks.project();
    const rows: HTMLElement[] = [];
    const folder = (key: string, icon: string, label: string, n: number, section: string | null) => {
      const isOpen = open.has(key);
      rows.push(h("button", { class: "tree-row folder", role: "treeitem", "aria-expanded": isOpen, onclick: () => { if (open.has(key)) open.delete(key); else open.add(key); if (section) hooks.openData(section); render(); } },
        h("span", { class: "tree-ico" }, isOpen ? "📂" : icon), h("span", { class: "tree-lbl" }, `${label} (${n})`)));
      return isOpen;
    };
    rows.push(h("div", { class: "tree-group", style: "padding-left:6px" }, "res://"));
    if (folder("maps", "📁", tr("Mapas"), p.maps.length, null)) p.maps.forEach((m, i) => rows.push(h("button", { class: `tree-row${i === hooks.mapIndex() ? " sel" : ""}`, style: "padding-left:34px", role: "treeitem", onclick: () => hooks.switchMap(i) }, h("span", { class: "tree-ico" }, "🗺️"), h("span", { class: "tree-lbl" }, m.name))));
    const leaf = (items: { id: string; name: string }[], icon: string, section: string) => items.slice(0, 60).forEach((x) => rows.push(h("button", { class: "tree-row", style: "padding-left:34px", role: "treeitem", title: x.id, onclick: () => hooks.openData(section) }, h("span", { class: "tree-ico" }, icon), h("span", { class: "tree-lbl" }, x.name))));
    if (folder("species", "📁", tr("Especies"), p.species.length, "Especies")) leaf(p.species, "🐾", "Especies");
    if (folder("moves", "📁", tr("Movimientos"), p.moves.length, "Movimientos")) leaf(p.moves, "💥", "Movimientos");
    if (folder("items", "📁", tr("Objetos"), p.items.length, "Objetos")) leaf(p.items, "🎒", "Objetos");
    if (folder("abilities", "📁", tr("Habilidades"), (p.abilities ?? []).length, "Habilidades")) leaf(p.abilities ?? [], "✨", "Habilidades");
    el.replaceChildren(...rows);
  };
  render();
  return { el, refresh: render };
}

/** Menú desplegable de la barra superior; se cierra al elegir, al pulsar fuera o con Escape. */
export function menu(label: string, items: { label: string; title?: string; run: () => void }[]) {
  const pop = h("div", { class: "menu-pop", role: "menu", hidden: true });
  const btn = h("button", { class: "menu-btn", "aria-haspopup": "menu", "aria-expanded": false }, label);
  const close = () => { pop.hidden = true; btn.setAttribute("aria-expanded", "false"); };
  for (const it of items) pop.append(h("button", { role: "menuitem", title: it.title ?? "", onclick: () => { close(); it.run(); } }, it.label));
  btn.addEventListener("click", (e) => { e.stopPropagation(); const willOpen = pop.hidden; document.dispatchEvent(new Event("wpe-close-menus")); pop.hidden = !willOpen; btn.setAttribute("aria-expanded", String(willOpen)); });
  document.addEventListener("click", close);
  document.addEventListener("wpe-close-menus", close);
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") close(); });
  return h("div", { class: "menu-root" }, btn, pop);
}
