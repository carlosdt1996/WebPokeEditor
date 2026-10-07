/** Modo "player": versión embebible del juego (sin editor). Se usa en el HTML exportado. */
import { isMuted, setMuted } from "./audio";
import { h } from "./dom";
import { Engine } from "./engine";
import { MapView } from "./mapView";
import { migrate, validate } from "./project";
import { atlasFromDataUrl, createAtlas } from "./tiles";

declare global {
  interface Window { __WPE_PLAYER__?: boolean; __WPE_PROJECT__?: string; __WPE_WASM__?: string }
}

export async function runPlayer() {
  const app = document.getElementById("app")!;
  app.className = "player";
  const project = migrate(JSON.parse(window.__WPE_PROJECT__!));
  const errs = validate(project);
  if (errs.length) console.warn("Proyecto con avisos:\n" + errs.join("\n"));
  const bytes = Uint8Array.from(atob(window.__WPE_WASM__!), (c) => c.charCodeAt(0));
  const engine = await Engine.load(bytes);
  const atlas = (project.atlas && (await atlasFromDataUrl(project.atlas))) || createAtlas();

  const view = new MapView(engine);
  const toast = h("div", { class: "toast" });
  let tt = 0;
  view.onMessage = (m) => { toast.textContent = m; toast.classList.add("show"); clearTimeout(tt); tt = window.setTimeout(() => toast.classList.remove("show"), 3500); };
  const btn3d = h("button", { onclick: async () => { const ok = await view.set3D(!view.mode3d); btn3d.classList.toggle("sel", view.mode3d && ok); } }, "🧊 3D");
  const mute = h("button", { onclick: () => { setMuted(!isMuted()); mute.textContent = isMuted() ? "🔇" : "🔊"; } }, "🔊");
  const full = h("button", { onclick: () => (document.fullscreenElement ? document.exitFullscreen() : app.requestFullscreen?.()) }, "⛶");
  document.title = project.name;
  app.append(
    h("header", { class: "top" }, h("div", { class: "brand" }, project.name), h("div", { class: "grow" }),
      h("span", { class: "muted" }, "Flechas/WASD mover · Enter/Z interactuar · Q/E cámara 3D"), mute, btn3d, full),
    h("div", { class: "stage" }, view.el, toast),
  );
  await view.init(project, atlas);
  view.startPlay();
  // el juego empaquetado no necesita el panel de mensajes: ya salen en el toast
}

/** Genera un único .html autocontenido con el juego (motor WASM + datos + player). Requiere la build de producción. */
export async function exportGameHtml(project: unknown): Promise<Blob> {
  if (import.meta.env.DEV) throw new Error("La exportación de juego necesita la versión compilada (npm run build / la web publicada).");
  const pageUrl = new URL("./index.html", document.baseURI);
  const doc = new DOMParser().parseFromString(await (await fetch(pageUrl)).text(), "text/html");
  const get = async (u: string) => { const r = await fetch(new URL(u, pageUrl)); if (!r.ok) throw new Error(`No se pudo leer ${u}`); return r; };
  for (const l of [...doc.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"]')]) {
    const st = doc.createElement("style");
    st.textContent = await (await get(l.getAttribute("href")!)).text();
    l.replaceWith(st);
  }
  const wasm = new Uint8Array(await (await get("engine_core.wasm")).arrayBuffer());
  let bin = "";
  for (let i = 0; i < wasm.length; i += 0x8000) bin += String.fromCharCode(...wasm.subarray(i, i + 0x8000));
  const data = doc.createElement("script");
  data.textContent = `window.__WPE_PLAYER__=true;window.__WPE_WASM__=${JSON.stringify(btoa(bin))};window.__WPE_PROJECT__=${JSON.stringify(JSON.stringify(project)).replace(/</g, "\\u003c")};`;
  const mod = doc.querySelector<HTMLScriptElement>('script[type="module"][src]')!;
  const code = await (await get(mod.getAttribute("src")!)).text();
  const inline = doc.createElement("script");
  inline.type = "module";
  inline.textContent = code.replace(/<\/script/gi, "<\\/script");
  mod.replaceWith(data, inline);
  doc.querySelectorAll('link[rel="modulepreload"], link[rel="manifest"]').forEach((n) => n.remove());
  return new Blob(["<!doctype html>\n" + doc.documentElement.outerHTML], { type: "text/html" });
}
