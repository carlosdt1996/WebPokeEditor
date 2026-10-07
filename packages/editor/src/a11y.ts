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

/** Da nombre accesible a lo que no lo tiene: usa el texto de la etiqueta o fila contigua, o el valor/placeholder. */
function nameIt(el: Element) {
  if (accessibleName(el)) return;
  const row = el.closest("label, .row, .field, td, th, p, div");
  let t = "";
  if (row) {
    const clone = row.cloneNode(true) as HTMLElement;
    clone.querySelectorAll("input, select, textarea, button").forEach((n) => n.remove());
    t = (clone.textContent ?? "").trim().slice(0, 60);
  }
  if (!t) { const prev = el.previousElementSibling?.textContent?.trim(); if (prev) t = prev.slice(0, 60); }
  if (!t && el instanceof HTMLInputElement) t = el.type === "number" ? "valor numérico" : el.type === "checkbox" ? "casilla" : el.type === "file" ? "archivo" : "campo de texto";
  if (!t && el instanceof HTMLSelectElement) t = "selección";
  if (!t && el instanceof HTMLButtonElement) t = "botón";
  el.setAttribute("aria-label", t || "control");
}

/** Observa la interfaz y mantiene nombres accesibles y roles al día; se llama una vez al arrancar. */
export function enhanceA11y(root: HTMLElement) {
  applyMotion();
  const pass = () => {
    root.querySelectorAll(NEEDS_NAME).forEach(nameIt);
    root.querySelectorAll("nav.tabs").forEach((nav) => {
      nav.setAttribute("role", "tablist");
      nav.querySelectorAll("button").forEach((b) => { b.setAttribute("role", "tab"); b.setAttribute("aria-selected", String(b.classList.contains("sel"))); });
    });
    root.querySelectorAll(".dialog, .msg").forEach((d) => { if (!d.hasAttribute("aria-live")) d.setAttribute("aria-live", "polite"); });
    root.querySelectorAll(".dialog").forEach((d) => { if (!d.hasAttribute("role")) d.setAttribute("role", "dialog"); });
    root.querySelectorAll("canvas").forEach((c) => { if (!c.hasAttribute("role")) { c.setAttribute("role", "img"); c.setAttribute("aria-label", c.classList.contains("overlay") ? "Capa de edición del mapa" : "Mapa del juego"); } });
  };
  let queued = false;
  new MutationObserver(() => { if (queued) return; queued = true; requestAnimationFrame(() => { queued = false; pass(); }); })
    .observe(root, { subtree: true, childList: true, attributes: true, attributeFilter: ["class", "hidden"] });
  pass();
}
