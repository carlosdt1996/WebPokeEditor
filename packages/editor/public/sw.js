/* Service worker: funciona sin conexión tras la primera visita. Estrategia: red primero para la página (para recibir actualizaciones), caché primero para el resto. */
const CACHE = "wpe-v1";
const CORE = ["./", "./index.html", "./engine_core.wasm", "./manifest.webmanifest", "./icon.svg", "./icon-192.png", "./icon-512.png"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(CORE)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET" || new URL(req.url).origin !== location.origin) return;
  const isPage = req.mode === "navigate";
  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    if (isPage) {
      try { const r = await fetch(req); cache.put("./index.html", r.clone()); return r; }
      catch { return (await cache.match("./index.html")) || (await cache.match("./")) || Response.error(); }
    }
    const hit = await cache.match(req);
    if (hit) return hit;
    try { const r = await fetch(req); if (r.ok) cache.put(req, r.clone()); return r; }
    catch { return Response.error(); }
  })());
});
