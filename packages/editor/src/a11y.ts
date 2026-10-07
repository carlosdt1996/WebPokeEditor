/** Accesibilidad: movimiento reducido, nombres accesibles automáticos y roles ARIA para la interfaz construida por código. */

const mq = typeof matchMedia === "function" ? matchMedia("(prefers-reduced-motion: reduce)") : null;
let forced: boolean | null = null;
try { const v = localStorage.getItem("wpe.reducedMotion"); if (v !== null) forced = v === "1"; } catch { /* sin almacenamiento */ }

function applyMotion() {
  document.documentElement.classList.toggle("reduce-motion", reducedMotion());
  document.documentElement.classList.toggle("motion-ok", !reducedMotion()); // anula la regla de @media cuando el usuario fuerza el movimiento
}
/** ¿Hay que evitar animaciones (tiles animados, sacudidas)? Respeta la preferencia del sistema salvo que el usuario la fuerce. */
export const reducedMotion = (): boolean => forced ?? mq?.matches ?? false;
export function setReducedMotion(v: boolean | null) {
  forced = v;
  try { if (v === null) localStorage.removeItem("wpe.reducedMotion"); else localStorage.setItem("wpe.reducedMotion", v ? "1" : "0"); } catch { /* sin almacenamiento */ }
  applyMotion();
}

/** Nombre accesible aproximado de un elemento (como lo calcula el navegador, simplificado). */
export function accessibleName(el: Element): string {
  const aria = el.getAttribute("aria-label")?.trim();
  if (aria) return aria;
  const by = el.getAttribute("aria-labelledby");
  if (by) { const t = by.split(/\s+/).map((id) => document.getElementById(id)?.textContent ?? "").join(" ").trim(); if (t) return t; }
  if (el instanceof HTMLInputElement || el instanceof HTMLSelectElement || el instanceof HTMLTextAreaElement) {
    const lab = el.labels?.[0]?.textContent?.trim();
    if (lab) return lab;
    if (el instanceof HTMLInputElement && (el.type === "button" || el.type === "submit") && el.value) return el.value;
    if ((el as HTMLInputElement).placeholder) return (el as HTMLInputElement).placeholder;
  }
  const title = el.getAttribute("title")?.trim();
  if (title) return title;
  return (el.textContent ?? "").trim();
}

const NEEDS_NAME = "button, input:not([type=hidden]), select, textarea, a[href]";

/** Texto corto de una etiqueta sin copiar subárboles grandes: solo nodos de texto directos y hermanos inmediatos. */
function nearbyText(el: Element): string {
  const short = (t: string | null | undefined) => { const v = (t ?? "").replace(/\s+/g, " ").trim(); return v && v.length <= 60 ? v : ""; };
  const label = el.closest("label");
  if (label) {
    const own = [...label.childNodes].filter((n) => n.nodeType === Node.TEXT_NODE).map((n) => n.textContent).join(" ");
    const v = short(own) || short(label.textContent);
    if (v) return v;
  }
  const prev = el.previousSibling;
  const pv = short(prev?.nodeType === Node.TEXT_NODE ? prev.textContent : (prev as Element | null)?.textContent);
  if (pv) return pv;
  const parent = el.parentElement;
  if (parent && parent.children.length <= 6) {
    const own = short([...parent.childNodes].filter((n) => n.nodeType === Node.TEXT_NODE).map((n) => n.textContent).join(" "));
    if (own) return own;
  }
  const td = el.closest("td");
  const table = td?.closest("table");
  const head = td && table?.tHead?.rows[0]?.cells[(td as HTMLTableCellElement).cellIndex];
  const hv = short(head?.textContent);
  if (hv) return hv;
  const row = td?.parentElement?.querySelector("b, input[type=text]");
  return short((row as HTMLInputElement | null)?.value ?? row?.textContent);
}

/** Da nombre accesible a lo que no lo tiene (coste constante por control). */
function nameIt(el: Element) {
  if (accessibleName(el)) return;
  let t = nearbyText(el);
  if (!t && el instanceof HTMLInputElement) t = el.type === "number" ? "valor numérico" : el.type === "checkbox" ? "casilla" : el.type === "file" ? "archivo" : "campo de texto";
  if (!t && el instanceof HTMLSelectElement) t = "selección";
  if (!t && el instanceof HTMLButtonElement) t = "botón";
  el.setAttribute("aria-label", t || "control");
}

/** Aplica nombres y roles a un subárbol recién añadido (coste proporcional al subárbol, no a toda la interfaz). */
function enhanceNode(n: Element) {
  const each = (sel: string, f: (e: Element) => void) => { if (n.matches(sel)) f(n); n.querySelectorAll(sel).forEach(f); };
  each(NEEDS_NAME, nameIt);
  each("nav.tabs", (nav) => { nav.setAttribute("role", "tablist"); nav.querySelectorAll("button").forEach(syncTab); });
  each(".dialog, .msg", (d) => { if (!d.hasAttribute("aria-live")) d.setAttribute("aria-live", "polite"); });
  each(".dialog", (d) => { if (!d.hasAttribute("role")) d.setAttribute("role", "dialog"); });
  each("canvas", (c) => { if (!c.hasAttribute("role")) { c.setAttribute("role", "img"); c.setAttribute("aria-label", c.classList.contains("overlay") ? "Capa de edición del mapa" : "Mapa del juego"); } });
}
function syncTab(b: Element) { b.setAttribute("role", "tab"); b.setAttribute("aria-selected", String(b.classList.contains("sel"))); }

/** Observa la interfaz y mantiene nombres accesibles y roles al día; se llama una vez al arrancar. Solo procesa lo que cambia. */
export function enhanceA11y(root: HTMLElement) {
  applyMotion();
  enhanceNode(root);
  let pending: Element[] = [];
  let queued = false;
  new MutationObserver((records) => {
    for (const r of records) {
      if (r.type === "attributes") { if (r.target instanceof Element && r.target.parentElement?.matches("nav.tabs")) syncTab(r.target); continue; }
      r.addedNodes.forEach((n) => { if (n instanceof Element) pending.push(n); });
    }
    if (queued || !pending.length) return;
    queued = true;
    requestAnimationFrame(() => { queued = false; const list = pending; pending = []; for (const n of list) if (n.isConnected) enhanceNode(n); });
  }).observe(root, { subtree: true, childList: true, attributes: true, attributeFilter: ["class"] });
}
