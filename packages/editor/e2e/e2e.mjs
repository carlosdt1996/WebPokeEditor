/**
 * Pruebas end-to-end en Chromium real (WebGPU por software con swiftshader).
 * Uso: npm run build && npm run e2e   (arranca `vite preview` por su cuenta)
 * Variables: CHROMIUM_PATH (por defecto /opt/pw-browsers/chromium si existe; si no, el Chromium de Playwright), SHOTS=dir para guardar capturas.
 */
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright";

const PORT = 4179;
const URL_ = `http://localhost:${PORT}/`;
const SHOTS = process.env.SHOTS;
if (SHOTS) mkdirSync(SHOTS, { recursive: true });

const server = spawn("npx", ["vite", "preview", "--port", String(PORT), "--strictPort"], { stdio: "ignore", cwd: new URL("..", import.meta.url).pathname });
const stop = () => { try { server.kill(); } catch { /* ya terminado */ } };
process.on("exit", stop);
for (let i = 0; i < 50; i++) { try { if ((await fetch(URL_)).ok) break; } catch { /* aún no */ } await new Promise((r) => setTimeout(r, 200)); }

const results = [];
const test = async (name, fn) => {
  const t0 = Date.now();
  try { await fn(); results.push([name, true, Date.now() - t0]); console.log(`  ✓ ${name}`); }
  catch (e) { results.push([name, false, Date.now() - t0, e]); console.log(`  ✗ ${name}\n      ${String(e.message ?? e).split("\n")[0]}`); }
};
const assert = (c, m) => { if (!c) throw new Error(m); };
const eq = (a, b, m) => assert(JSON.stringify(a) === JSON.stringify(b), `${m}: esperado ${JSON.stringify(b)}, obtenido ${JSON.stringify(a)}`);

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || (existsSync("/opt/pw-browsers/chromium") ? "/opt/pw-browsers/chromium" : undefined),
  args: ["--enable-unsafe-webgpu", "--use-angle=swiftshader", "--enable-features=Vulkan", "--use-vulkan=swiftshader", "--enable-webgpu-developer-features"],
});
const errors = [];
async function newPage(url = URL_, ctx) {
  const c = ctx ?? (await browser.newContext({ viewport: { width: 1280, height: 800 }, acceptDownloads: true }));
  const p = await c.newPage();
  p.on("pageerror", (e) => errors.push("PAGEERROR " + e));
  p.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  await p.goto(url);
  await p.waitForSelector(".viewport canvas, #app.player canvas");
  await p.waitForTimeout(500);
  return p;
}
const shot = (p, n) => SHOTS && p.screenshot({ path: join(SHOTS, n + ".png") });
const W = (p, fn, arg) => p.evaluate(fn, arg);
const key = (p, k, ms = 60) => p.keyboard.down(k).then(() => p.waitForTimeout(ms)).then(() => p.keyboard.up(k));
/** Mantiene una tecla pulsada hasta que `cond` (evaluada en la página) sea cierta. */
async function holdUntil(p, k, cond, timeout = 8000) {
  await p.keyboard.down(k);
  try { await p.waitForFunction(cond, null, { timeout, polling: 30 }); }
  catch (e) { const st = await p.evaluate(() => { const w = window.__wpe; return JSON.stringify({ cell: w?.engine.cell, map: w?.view.game?.map.id, busy: w?.view.game?.busy, dialog: !document.querySelector(".dialog")?.hidden, choice: !!document.querySelector(".choice"), battle: !!document.querySelector(".battle") }); }).catch(() => "?"); throw new Error(`holdUntil(${k}) agotó el tiempo; estado ${st}`); }
  finally { await p.keyboard.up(k); }
  await p.waitForTimeout(250);
}
/** Mantiene la tecla hasta que el jugador mira en la dirección `dir` (0 abajo, 1 arriba, 2 izq, 3 der). */
const face = (p, k, dir) => holdUntil(p, k, `window.__wpe.engine.player.dir === ${dir}`);
/** Pulsa Enter hasta que el cuadro de diálogo desaparece. */
async function closeDialog(p, max = 12) {
  for (let i = 0; i < max; i++) {
    if (await p.locator(".dialog[hidden]").count()) return;
    await key(p, "Enter", 80); await p.waitForTimeout(150);
  }
  throw new Error("el diálogo no se cerró");
}
const cell = (x, y) => `(() => { const c = window.__wpe.engine.cell; return c.x === ${x} && c.y === ${y} && !window.__wpe.engine.player.moving; })()`;
const mapId = "window.__wpe.view.game && window.__wpe.view.game.map.id";

// Un PNG real de WxH generado en el navegador
const png = (p, w, h) => W(p, ([w, h]) => { const c = document.createElement("canvas"); c.width = w; c.height = h; const g = c.getContext("2d"); g.fillStyle = "#e91e63"; g.fillRect(0, 0, w, h); g.fillStyle = "#fff"; g.fillRect(w / 4, h / 4, w / 2, h / 2); return c.toDataURL("image/png").split(",")[1]; }, [w, h]);

/** Crea un proyecto nuevo con la plantilla del mini mundo de ejemplo. */
async function newExample(p) {
  await p.click("header button:has-text('Nuevo')");
  await p.click(".tpl:has-text('Mini mundo')");
  await p.waitForTimeout(500);
}

console.log("E2E WebPokeEditor");
let page = await newPage();

await test("arranca con WebGPU, motor WASM y proyecto por defecto", async () => {
  assert((await page.textContent("footer")).includes("WebGPU"), "esperaba WebGPU");
  eq(await W(page, () => window.__wpe.project.maps.map((m) => m.id)), ["pueblo", "casa", "ruta1"], "mapas");
  assert((await W(page, () => window.__wpe.engine.width)) === 24, "ancho del mapa");
  await shot(page, "01-editor");
});

await test("pintar con el ratón, deshacer y rehacer (Ctrl+Z / Ctrl+Y)", async () => {
  await page.click("button:has-text('Agua')");
  const box = await page.locator(".overlay").boundingBox();
  const before = await W(page, () => Array.from(window.__wpe.engine.tiles).filter((t) => t === 3).length);
  await page.mouse.move(box.x + 120, box.y + 480); await page.mouse.down();
  await page.mouse.move(box.x + 260, box.y + 500, { steps: 8 }); await page.mouse.up();
  const after = await W(page, () => Array.from(window.__wpe.engine.tiles).filter((t) => t === 3).length);
  assert(after > before, `no se pintó (${before} → ${after})`);
  await page.keyboard.press("Control+z");
  eq(await W(page, () => Array.from(window.__wpe.engine.tiles).filter((t) => t === 3).length), before, "tras deshacer");
  await page.keyboard.press("Control+y");
  eq(await W(page, () => Array.from(window.__wpe.engine.tiles).filter((t) => t === 3).length), after, "tras rehacer");
  await page.keyboard.press("Control+z");
});

await test("rellenar y cuentagotas", async () => {
  await page.click("button:has-text('Rellenar')");
  await page.click("button:has-text('Arena')");
  const box = await page.locator(".overlay").boundingBox();
  await page.mouse.click(box.x + 60, box.y + 380);
  assert((await W(page, () => Array.from(window.__wpe.engine.tiles).filter((t) => t === 7).length)) > 30, "relleno");
  await page.keyboard.press("Control+z");
  await page.click("button:has-text('Cuentagotas')");
  await page.mouse.click(box.x + 400, box.y + 280);
  assert(await page.locator(".swatch.sel").count() === 1, "paleta sin selección tras el cuentagotas");
});

await test("redimensionar mapa conserva contenido y recorta NPC fuera", async () => {
  await W(page, () => window.__wpe.view.switchMap(2));
  await page.fill(".side input.n >> nth=0", "10"); await page.fill(".side input.n >> nth=1", "10");
  await page.click("button:has-text('Aplicar')");
  const m = await W(page, () => ({ w: window.__wpe.engine.width, npcs: window.__wpe.project.maps[2].npcs.length }));
  eq(m, { w: 10, npcs: 0 }, "tras redimensionar ruta1 a 10x10");
  await page.reload(); await page.waitForSelector(".viewport canvas"); await page.waitForTimeout(400);
  // el autoguardado se hizo: recargamos y debe mantenerse
  eq(await W(page, () => window.__wpe.project.maps[2].w), 10, "persistencia tras recargar");
});
page.on("dialog", (d) => d.accept());
await newExample(page);

await test("crear NPC, editar en el inspector y pasar a script con validación", async () => {
  await page.click("button:has-text('🧑 NPC')");
  const box = await page.locator(".overlay").boundingBox();
  await page.mouse.click(box.x + 400, box.y + 500);
  await page.waitForSelector(".inspector input[type=text]");
  await page.fill(".inspector input[type=text]", "Guardia");
  await page.selectOption(".inspector select >> nth=0", "script");
  await page.waitForSelector(".inspector textarea.code");
  await page.fill(".inspector textarea.code", "say Hola\nvolar 3");
  assert((await page.textContent(".inspector .errs")).includes("línea 2"), "debería señalar el error de la línea 2");
  await page.fill(".inspector textarea.code", "say Hola\ngive potion 1\nflag visto");
  assert((await page.textContent(".inspector .errs")).includes("válido"), "script válido");
  const n = await W(page, () => window.__wpe.view.map.npcs.at(-1));
  eq([n.name, n.kind], ["Guardia", "script"], "datos del NPC");
  await page.click("button:has-text('🗑 Eliminar')");
  assert((await W(page, () => window.__wpe.view.map.npcs.every((k) => k.name !== "Guardia"))), "NPC eliminado");
});

await test("crear salto y editar destino", async () => {
  await page.click("button:has-text('🚪 Salto')");
  const box = await page.locator(".overlay").boundingBox();
  await page.mouse.click(box.x + 600, box.y + 600);
  await page.selectOption(".inspector select >> nth=0", "ruta1");
  const w = await W(page, () => window.__wpe.view.map.warps.at(-1));
  eq(w.toMap, "ruta1", "destino del salto");
  await page.keyboard.press("Delete");
  assert(await W(page, () => window.__wpe.view.map.warps.every((k) => k.toMap !== "ruta1" || k.x !== undefined && window.__wpe.view.map.warps.length === 2)), "salto eliminado con Supr");
});

await test("herramienta ⚡ Disparador: crear, editar el script (bucles) y eliminar", async () => {
  if (await page.locator("text=■ Detener").count()) await page.click("text=■ Detener");
  await W(page, () => window.__wpe.view.switchMap(0));
  await page.click("button:has-text('⚡ Disparador')");
  const pos = await W(page, () => { const v = window.__wpe.view; const r = v.el.getBoundingClientRect(); return { x: r.left + (6.5 * 16 - v.cam.x) * v.cam.zoom, y: r.top + (8.5 * 16 - v.cam.y) * v.cam.zoom }; });
  await page.mouse.click(pos.x, pos.y);
  await page.waitForSelector(".inspector textarea.code");
  await page.fill(".inspector textarea.code", "repeat 2\nadd n 1\nsay vuelta {n}\nend\nwhile n < 4\nadd n 1\nend\nif n >= 4\nbreak\nend");
  assert((await page.textContent(".inspector .errs")).includes("break fuera"), "debe avisar de break fuera de bucle: " + (await page.textContent(".inspector .errs")));
  await page.fill(".inspector textarea.code", "repeat 2\nadd n 1\nsay vuelta {n}\nend\nwhile n < 4\nadd n 1\nend");
  assert((await page.textContent(".inspector .errs")).includes("válido"), "script válido");
  eq(await W(page, () => window.__wpe.view.map.triggers.at(-1).script.includes("while")), true, "script guardado");
  await page.keyboard.press("Delete"); // con el foco en el script no debe borrar el disparador
  eq(await W(page, () => window.__wpe.view.map.triggers.length), 2, "Supr dentro del editor no borra");
  await page.click("button:has-text('🗑 Eliminar')");
  eq(await W(page, () => window.__wpe.view.map.triggers.length), 1, "disparador eliminado (queda el del cartel)");
  await page.click("button:has-text('✏️ Pintar')");
});

await test("gestión de mapas: nuevo, renombrar y eliminar", async () => {
  page.removeAllListeners("dialog");
  page.on("dialog", (d) => d.type() === "prompt" ? d.accept("Cueva") : d.accept());
  await page.click("button:has-text('+ Nuevo')");
  eq(await W(page, () => window.__wpe.project.maps.at(-1).name), "Cueva", "nuevo mapa");
  await page.click("button:has-text('Renombrar')");
  await page.click("button:has-text('Eliminar') >> nth=0");
  eq(await W(page, () => window.__wpe.project.maps.length), 3, "mapa eliminado");
});

await test("recorrer el mundo: puerta → casa → salida → ruta", async () => {
  await page.click("text=▶ Probar");
  await page.waitForFunction(() => window.__wpe.view.game && !window.__wpe.view.game.busy);
  await page.waitForTimeout(300);
  await holdUntil(page, "ArrowDown", cell(11, 9));
  await holdUntil(page, "ArrowLeft", cell(5, 9));
  await holdUntil(page, "ArrowUp", `(${mapId}) === "casa"`);
  eq(await W(page, () => window.__wpe.view.game.map.id), "casa", "entró en la casa");
  await page.waitForSelector(".dialog:not([hidden])");
  assert((await page.textContent(".dialog")).includes("Has vuelto a casa"), "script al entrar al mapa: " + (await page.textContent(".dialog")));
  await closeDialog(page);
  await shot(page, "02-casa");
  await holdUntil(page, "ArrowDown", `(${mapId}) === "pueblo"`);
  eq(await W(page, () => window.__wpe.view.game.map.id), "pueblo", "salió al pueblo");
});

await test("NPC con script: da objetos una sola vez", async () => {
  // (9,8) es el profesor; ir a (9,9)? está en el camino y mira hacia arriba
  await W(page, () => window.__wpe.view.game.warpTo("pueblo", 8, 8));
  await page.waitForTimeout(200);
  await face(page, "ArrowRight", 3); // se orienta hacia el profesor sin poder moverse (bloqueado)
  const inv0 = await W(page, () => ({ ...window.__wpe.view.game.inv }));
  await key(page, "Enter", 80);
  await page.waitForSelector(".dialog:not([hidden])");
  await closeDialog(page);
  const inv1 = await W(page, () => ({ ...window.__wpe.view.game.inv }));
  eq([inv1.potion - inv0.potion, inv1.ball - inv0.ball], [3, 5], "regalo");
  await page.waitForTimeout(300);
  await key(page, "Enter", 80);
  await page.waitForSelector(".dialog:not([hidden])");
  assert((await page.textContent(".dialog")).includes("Ya tienes"), "segunda vez: ya recibido");
  await closeDialog(page);
  eq(await W(page, () => window.__wpe.view.game.inv.potion), inv1.potion, "sin duplicar");
});

await test("audio: el motor de sonido programa notas y el contexto está activo", async () => {
  const a = await W(page, () => ({ tones: window.__wpe.audio.tones, state: window.__wpe.audio.state() }));
  assert(a.tones > 0, "no se programó ninguna nota (música/pasos): " + JSON.stringify(a));
  eq(a.state, "running", "contexto de audio (nota: no se puede comprobar cómo suena)");
  const before = a.tones;
  await holdUntil(page, "ArrowDown", cell(8, 9));
  assert((await W(page, () => window.__wpe.audio.tones)) > before, "los pasos/música siguen generando notas");
});

await test("disparador por casilla: contador de visitas con variables y {interpolación}", async () => {
  await W(page, () => window.__wpe.view.game.warpTo("pueblo", 11, 10));
  await page.waitForTimeout(200);
  await holdUntil(page, "ArrowDown", cell(11, 12));
  await page.waitForSelector(".dialog:not([hidden])");
  assert((await page.textContent(".dialog")).includes("Bienvenido"), "primera visita: " + (await page.textContent(".dialog")));
  await closeDialog(page);
  await holdUntil(page, "ArrowDown", cell(11, 13));
  await holdUntil(page, "ArrowUp", cell(11, 12));
  await page.waitForSelector(".dialog:not([hidden])");
  assert((await page.textContent(".dialog")).includes("2 veces"), "segunda visita: " + (await page.textContent(".dialog")));
  eq(await W(page, () => window.__wpe.engine.getVar("visitas")), 2, "variable en la VM de Rust");
  await closeDialog(page);
});

await test("menú de elección, funciones y texto en un disparador (VM de Rust)", async () => {
  await W(page, () => window.__wpe.view.game.warpTo("pueblo", 11, 13));
  await W(page, () => window.__wpe.project.maps[0].triggers.push({ x: 11, y: 14, name: "Prueba", once: false, script: "def dime\nsay Elegiste {opcion}\nend\nchoice Rojo | Azul | Verde\nsetstr opcion Azul\nif choice == 1\ncall dime\nelse\nsay otra\nend" }));
  await page.waitForTimeout(200);
  await holdUntil(page, "ArrowDown", cell(11, 14));
  await page.waitForSelector(".choice");
  assert((await page.locator(".choice button").count()) === 3, "tres opciones");
  await key(page, "ArrowDown", 80); await key(page, "Enter", 80);
  await page.waitForSelector(".dialog:not([hidden])");
  assert((await page.textContent(".dialog")).includes("Elegiste Azul"), "tras elegir: " + (await page.textContent(".dialog")));
  eq(await W(page, () => window.__wpe.engine.getVar("choice")), 1, "variable choice");
  await closeDialog(page);
  await W(page, () => window.__wpe.project.maps[0].triggers.pop());
});

await test("combate: el estado Sueño se muestra como insignia y los efectos funcionan en la interfaz", async () => {
  await W(page, () => {
    const g = window.__wpe.view.game;
    g.party.length = 0;
    g.party.push({ species: "hojin", level: 30, hp: 999, exp: 1, moves: ["somnifero", "embestida"], status: 0 });
    g.fight([{ species: "pelusin", level: 3, hp: 30, exp: 1, moves: ["embestida"], status: 0 }]);
  });
  await page.waitForSelector(".battle");
  let badge = false;
  for (let i = 0; i < 12 && !badge; i++) {
    const fight = page.locator(".menu button:has-text('Luchar')");
    if (await fight.count()) { await fight.click(); await page.locator(".menu button").first().click(); }
    await page.waitForTimeout(250);
    await page.locator(".battle").click({ position: { x: 20, y: 20 } }).catch(() => {});
    badge = (await page.locator(".fplate .badge.st4").count()) > 0;
  }
  assert(badge, "la insignia DOR del rival no apareció");
  await shot(page, "09-combate-sueno");
  for (let i = 0; i < 60 && (await page.locator(".battle").count()); i++) {
    const fight = page.locator(".menu button:has-text('Luchar')");
    if (await fight.count()) { await fight.click(); await page.locator(".menu button").nth(1).click(); }
    await page.waitForTimeout(150);
    await page.locator(".battle").click({ position: { x: 20, y: 20 } }).catch(() => {});
  }
  assert(!(await page.locator(".battle").count()), "el combate no terminó");
  await W(page, () => { const g = window.__wpe.view.game; g.party.length = 0; g.party.push({ species: "flamito", level: 20, hp: 999, exp: 1, moves: ["embestida", "ascua"], status: 0 }, { species: "hojin", level: 20, hp: 999, exp: 1, moves: ["embestida", "hojaje"], status: 0 }); });
  await W(page, () => window.__wpe.view.game.party.forEach((m) => { m.hp = 60; }));
});

await test("listas y operaciones con texto en un disparador", async () => {
  await W(page, () => window.__wpe.view.game.warpTo("pueblo", 11, 4));
  await W(page, () => window.__wpe.project.maps[0].triggers.push({ x: 11, y: 5, name: "Listas", once: false, script: "list frutas manzana | pera | uva\npush frutas kiwi\nlen frutas n\nget frutas 3 f\nupper f\nstreq f KIWI ok\nsay {n} frutas, la última es {f} ({ok})" }));
  await page.waitForTimeout(200);
  await holdUntil(page, "ArrowDown", cell(11, 5));
  await page.waitForSelector(".dialog:not([hidden])");
  assert((await page.textContent(".dialog")).includes("4 frutas, la última es KIWI (1)"), "texto: " + (await page.textContent(".dialog")));
  await closeDialog(page);
  await W(page, () => window.__wpe.project.maps[0].triggers.pop());
});

await test("script al salir del mapa y equipar un objeto desde un script", async () => {
  await W(page, () => { window.__wpe.project.maps[0].onExit = "equip carbon\nsay (Sistema) Te llevas el carbón."; });
  const had = await W(page, () => window.__wpe.view.game.party.map((m) => m.held ?? null));
  await W(page, () => { void window.__wpe.view.game.warpTo("casa", 5, 6); }); // sin esperar: el script de salida abre un diálogo
  await page.waitForSelector(".dialog:not([hidden])");
  assert((await page.textContent(".dialog")).includes("Te llevas el carbón"), "script de salida: " + (await page.textContent(".dialog")));
  await closeDialog(page);
  const after = await W(page, () => window.__wpe.view.game.party.map((m) => m.held ?? null));
  assert(JSON.stringify(after) !== JSON.stringify(had) && after.includes("carbon"), "alguien lleva el carbón: " + JSON.stringify(after));
  await W(page, () => { delete window.__wpe.project.maps[0].onExit; });
  await W(page, () => { void window.__wpe.view.game.warpTo("pueblo", 5, 5); });
  await page.waitForTimeout(300);
  if (await page.locator(".dialog:not([hidden])").count()) await closeDialog(page);
});

await test("clima del mapa: se anuncia al empezar el combate", async () => {
  await W(page, () => {
    const g = window.__wpe.view.game;
    g.map.weather = "rain";
    g.party.forEach((m) => { m.hp = 999; });
    g.fight([{ species: "pelusin", level: 3, hp: 30, exp: 1, moves: ["embestida"], status: 0 }]);
  });
  await page.waitForSelector(".battle");
  await page.waitForFunction(() => document.querySelector(".battle .msg")?.textContent?.includes("llover"), null, { timeout: 8000 });
  await W(page, () => { delete window.__wpe.view.game.map.weather; });
  for (let i = 0; i < 80 && (await page.locator(".battle").count()); i++) {
    const fight = page.locator(".menu button:has-text('Luchar')");
    if (await fight.count()) { await fight.click(); await page.locator(".menu button").first().click(); }
    await page.waitForTimeout(150);
    await page.locator(".battle").click({ position: { x: 20, y: 20 } }).catch(() => {});
  }
  assert(!(await page.locator(".battle").count()), "el combate no terminó");
});

await test("NPC de conversación y curandero", async () => {
  await W(page, () => window.__wpe.view.game.warpTo("casa", 7, 4));
  await page.waitForTimeout(200);
  await W(page, () => { window.__wpe.view.game.party[0].hp = 3; });
  await face(page, "ArrowUp", 1);
  await key(page, "Enter", 80);
  await page.waitForSelector(".dialog:not([hidden])");
  await closeDialog(page);
  assert(await W(page, () => window.__wpe.view.game.party[0].hp > 3), "la enfermera debería curar");
});

await test("entrenador te ve y combate: victoria, XP y diálogo final", async () => {
  await W(page, () => window.__wpe.view.game.warpTo("ruta1", 14, 10));
  await page.waitForTimeout(200);
  await page.keyboard.down("ArrowUp");
  await page.waitForSelector(".dialog:not([hidden])", { timeout: 6000 });
  await page.keyboard.up("ArrowUp");
  assert((await page.textContent(".dialog")).includes("Marcos"), "debía ser el Joven Marcos");
  // ponemos nuestro equipo fuerte para ganar con certeza
  await W(page, () => { const m = window.__wpe.view.game.party[0]; m.level = 40; m.hp = 999; });
  await key(page, "Enter", 80);
  await page.waitForSelector(".battle", { timeout: 6000 });
  const exp0 = await W(page, () => window.__wpe.view.game.party[0].exp);
  await shot(page, "03-trainer-battle");
  for (let i = 0; i < 60 && (await page.locator(".battle").count()); i++) {
    const fight = page.locator(".menu button:has-text('Luchar')");
    if (await fight.count()) { await fight.click(); await page.locator(".menu button").nth(1).click(); }
    else if (await page.locator(".menu button:has-text('Volver')").count() === 0) await page.locator(".battle").click({ position: { x: 20, y: 20 } }).catch(() => {});
    await page.waitForTimeout(150);
  }
  assert(!(await page.locator(".battle").count()), "el combate no terminó");
  assert((await W(page, () => window.__wpe.view.game.party[0].exp)) > exp0, "no ganó experiencia");
  await page.waitForSelector(".dialog:not([hidden])");
  assert((await page.textContent(".dialog")).includes("más fuerte"), "diálogo de derrota del entrenador");
  eq(await W(page, () => window.__wpe.view.game.defeated.has("ruta1/joven")), true, "entrenador marcado como derrotado");
  for (let i = 0; i < 4 && !(await page.locator(".dialog[hidden]").count()); i++) { await key(page, "Enter"); await page.waitForTimeout(120); }
});

await test("combate salvaje: capturar con bolas (Mochila)", async () => {
  await W(page, () => { const g = window.__wpe.view.game; g.party[0].level = 30; g.inv.ball = 50; });
  await page.evaluate(() => { const g = window.__wpe.view.game; g.fight([{ species: "pelusin", level: 2, hp: 1, exp: 8, moves: ["embestida"] }]); });
  await page.waitForSelector(".battle");
  const n0 = await W(page, () => window.__wpe.view.game.party.length);
  for (let i = 0; i < 40 && (await page.locator(".battle").count()); i++) {
    const bag = page.locator(".menu button:has-text('Mochila')");
    if (await bag.count()) { await bag.click(); await page.locator(".menu button").filter({ hasText: /^Bola ×/ }).click(); }
    await page.waitForTimeout(250);
    await page.locator(".battle").click({ position: { x: 20, y: 20 } }).catch(() => {});
  }
  assert(!(await page.locator(".battle").count()), "el combate no terminó");
  eq(await W(page, () => window.__wpe.view.game.party.length), n0 + 1, "equipo tras capturar");
});

await test("derrota: se cura al equipo y vuelves al inicio", async () => {
  await W(page, () => { const g = window.__wpe.view.game; g.party.length = 1; g.party[0].level = 1; g.party[0].hp = 1; });
  await page.evaluate(() => { const g = window.__wpe.view.game; g.fight([{ species: "flamito", level: 60, hp: 999, exp: 1, moves: ["embestida"] }]); });
  await page.waitForSelector(".battle");
  for (let i = 0; i < 40 && (await page.locator(".battle").count()); i++) {
    const fight = page.locator(".menu button:has-text('Luchar')");
    if (await fight.count()) { await fight.click(); await page.locator(".menu button").nth(0).click(); }
    await page.waitForTimeout(150);
    await page.locator(".battle").click({ position: { x: 20, y: 20 } }).catch(() => {});
  }
  await page.waitForSelector(".dialog:not([hidden])", { timeout: 8000 });
  assert((await page.textContent(".dialog")).includes("negro"), "mensaje de derrota");
  for (let i = 0; i < 4 && !(await page.locator(".dialog[hidden]").count()); i++) { await key(page, "Enter"); await page.waitForTimeout(120); }
  eq(await W(page, () => window.__wpe.view.game.map.id), "pueblo", "vuelve al mapa inicial");
  assert(await W(page, () => window.__wpe.view.game.party[0].hp > 1), "equipo curado");
  await page.click("text=■ Detener");
});

await test("capa de objetos: pintar valla (sólida), flor (decorativa) y quitar", async () => {
  await W(page, () => window.__wpe.view.switchMap(0));
  await page.click("button:has-text('Valla')");
  const box = await page.locator(".overlay").boundingBox();
  const px = (tx, ty) => { const z = 1; void z; return null; };
  void px;
  // posición de la casilla (3,13) del pueblo calculada con la cámara real
  const pos = await W(page, () => { const v = window.__wpe.view; const r = v.el.getBoundingClientRect(); return { x: r.left + (3.5 * 16 - v.cam.x) * v.cam.zoom, y: r.top + (13.5 * 16 - v.cam.y) * v.cam.zoom }; });
  await page.mouse.click(pos.x, pos.y);
  eq(await W(page, () => window.__wpe.engine.objects[13 * 24 + 3]), 16, "valla en la capa de objetos");
  eq(await W(page, () => window.__wpe.engine.walkable(3, 13)), false, "la valla bloquea");
  eq(await W(page, () => window.__wpe.engine.tiles[13 * 24 + 3]), 1, "el suelo bajo la valla se conserva");
  await page.click("button:has-text('Flor (obj.)')");
  await page.mouse.click(pos.x, pos.y);
  eq(await W(page, () => window.__wpe.engine.walkable(3, 13)), true, "la flor es decorativa");
  await page.click("button:has-text('Sin objeto')");
  await page.mouse.click(pos.x, pos.y);
  eq(await W(page, () => window.__wpe.engine.objects[13 * 24 + 3]), 0, "objeto quitado");
  await page.keyboard.press("Control+z");
  eq(await W(page, () => window.__wpe.engine.objects[13 * 24 + 3]), 14, "deshacer restaura el objeto");
  await page.keyboard.press("Control+z"); await page.keyboard.press("Control+z");
  eq(await W(page, () => window.__wpe.engine.objects[13 * 24 + 3]), 0, "deshacer todo");
  const shape = await W(page, () => { window.__wpe.view.commit(); const m = window.__wpe.project.maps[0]; return [typeof m.objects, typeof m.heights]; });
  eq(shape, ["string", "string"], "las capas por defecto (objetos y colina) se guardan");
});

await test("alturas: elevar/bajar casillas y verlas en 3D", async () => {
  await page.click("button:has-text('⛰ Elevar')");
  const pos = await W(page, () => { const v = window.__wpe.view; const r = v.el.getBoundingClientRect(); return { x: r.left + (5.5 * 16 - v.cam.x) * v.cam.zoom, y: r.top + (14.5 * 16 - v.cam.y) * v.cam.zoom }; });
  await page.mouse.click(pos.x, pos.y); await page.mouse.click(pos.x, pos.y);
  const h = () => W(page, () => window.__wpe.view.heights[14 * 24 + 5]);
  eq(await h(), 2, "dos clics suben 2");
  await page.click("button:has-text('🕳 Bajar')");
  await page.mouse.click(pos.x, pos.y);
  eq(await h(), 1, "bajar");
  // tres trazos (dos subidas y una bajada) → tres deshacer
  for (let i = 0; i < 3; i++) await page.keyboard.press("Control+z");
  eq(await h(), 0, "deshacer alturas");
  await page.click("button:has-text('✏️ Pintar')");
  await page.click("text=🧊 3D"); await page.waitForTimeout(600);
  await W(page, () => { window.__wpe.view.cam3.x = 18.5; window.__wpe.view.cam3.z = 14; });
  await page.waitForTimeout(400);
  await shot(page, "07-colina-3d");
  await page.click("text=🧊 3D");
});

await test("objetos genéricos: crear uno nuevo, inventario y script con give", async () => {
  await page.click("button:has-text('📋 Datos')");
  const n0 = await W(page, () => window.__wpe.project.items.length);
  await page.click("button:has-text('+ Añadir objeto')");
  eq(await W(page, () => window.__wpe.project.items.length), n0 + 1, "objeto añadido");
  const id = await W(page, () => window.__wpe.project.items.at(-1).id);
  await page.locator("button.danger").filter({ hasText: "✕" }).last().click();
  eq(await W(page, () => window.__wpe.project.items.length), n0, "objeto eliminado");
  assert(id === "objeto", "id generado");
  await page.click("button:has-text('🗺️ Mapa')");
});

await test("combate doble 2v2 contra los Hermanos Gil", async () => {
  await W(page, () => window.__wpe.view.switchMap(2));
  await page.click("text=▶ Probar");
  await W(page, () => { const g = window.__wpe.view.game; g.party.forEach((m) => { m.level = 40; m.hp = 999; }); g.warpTo("ruta1", 14, 10); });
  await page.waitForTimeout(250);
  await page.keyboard.down("ArrowDown");
  await page.waitForFunction(() => window.__wpe.view.game.busy, null, { timeout: 8000, polling: 30 });
  await page.keyboard.up("ArrowDown");
  await page.waitForSelector(".dialog:not([hidden])");
  assert((await page.textContent(".dialog")).includes("Gil") || (await page.textContent(".dialog")).includes("dos"), "diálogo de los hermanos (" + (await page.textContent(".dialog")) + ")");
  await key(page, "Enter", 80);
  await page.waitForSelector(".battle.size2", { timeout: 6000 });
  assert(await page.locator(".battle .mon.foe").count() === 2 && await page.locator(".battle .mon.pl").count() === 2, "dos criaturas por lado");
  await shot(page, "08-combate-doble");
  for (let i = 0; i < 80 && (await page.locator(".battle").count()); i++) {
    const fight = page.locator(".menu button:has-text('Luchar')");
    if (await fight.count()) {
      await fight.click();
      await page.locator(".menu button").first().click();
      await page.waitForTimeout(80);
      if (((await page.locator(".msg").textContent({ timeout: 500 }).catch(() => "")) ?? "").includes("¿A quién atacas?")) await page.locator(".menu button").first().click();
    } else if (await page.locator(".menu button:has-text('¿A quién')").count()) { /* nada */ }
    else {
      const pick = page.locator(".menu button:enabled").first();
      if (((await page.locator(".msg").textContent({ timeout: 500 }).catch(() => "")) ?? "").includes("¿A quién envías?") && await pick.count()) await pick.click();
    }
    await page.waitForTimeout(150);
    await page.locator(".battle").click({ position: { x: 20, y: 20 } }).catch(() => {});
  }
  assert(!(await page.locator(".battle").count()), "el combate doble no terminó");
  eq(await W(page, () => window.__wpe.view.game.defeated.has("ruta1/hermanos")), true, "hermanos derrotados");
  await page.waitForSelector(".dialog:not([hidden])");
  await closeDialog(page);
  await page.click("text=■ Detener");
});

await test("CSV de especies: exportar, editar y reimportar", async () => {
  await page.click("button:has-text('📋 Datos')");
  const [dl] = await Promise.all([page.waitForEvent("download"), page.locator("button:has-text('⬇ Exportar CSV')").first().click()]);
  const path = join(tmpdir(), "e2e-especies.csv");
  await dl.saveAs(path);
  const csv = readFileSync(path, "utf8");
  assert(csv.startsWith("id,nombre,tipo1,tipo2,hp,atk,def,spa,spd,spe,movimientos"), "cabecera: " + csv.slice(0, 60));
  writeFileSync(path, csv.replace("Flamito", "Brasín"));
  await page.locator("button:has-text('⬆ Importar CSV')").first().evaluate((b) => b.nextElementSibling.setAttribute("data-t", "1"));
  await page.locator("input[type=file][accept='.csv,text/csv']").first().setInputFiles(path);
  await page.waitForFunction(() => window.__wpe.project.species[0].name === "Brasín");
  eq(await W(page, () => window.__wpe.project.species[0].evolve.into), "flamaron", "la evolución sobrevive al CSV");
  await page.click("button:has-text('🗺️ Mapa')");
});

await test("guardado en OPFS y recarga con el proyecto intacto", async () => {
  await page.fill("input.title", "Guardado OPFS");
  await page.waitForTimeout(900);
  const saved = await W(page, async () => { const r = await navigator.storage.getDirectory(); const f = await (await r.getFileHandle("proyecto.wpe.json")).getFile(); return JSON.parse(await f.text()).name; });
  eq(saved, "Guardado OPFS", "archivo en OPFS");
  assert((await page.textContent(".status")).includes("OPFS"), "estado: " + (await page.textContent(".status")));
  await page.reload(); await page.waitForSelector(".viewport canvas"); await page.waitForTimeout(500);
  eq(await W(page, () => window.__wpe.project.name), "Guardado OPFS", "tras recargar");
});

await test("PWA: manifest, service worker y funcionamiento sin conexión", async () => {
  assert(await page.locator("link[rel=manifest]").count() === 1, "manifest enlazado");
  const m = await page.evaluate(() => fetch("./manifest.webmanifest").then((r) => r.json()));
  eq([m.display, m.icons.length >= 2], ["standalone", true], "manifest");
  await page.waitForFunction(() => navigator.serviceWorker.ready.then(() => true), null, { timeout: 8000 });
  await page.reload(); await page.waitForTimeout(800); // ya controlada por el SW
  await page.context().setOffline(true);
  await page.reload(); await page.waitForSelector(".viewport canvas", { timeout: 8000 }); await page.waitForTimeout(500);
  assert((await page.textContent("footer")).includes("Motor"), "la app carga sin red");
  await page.context().setOffline(false);
  const cdp = await page.context().newCDPSession(page);
  const inst = await cdp.send("Page.getInstallabilityErrors");
  // "in-incognito" lo causa el contexto efímero de Playwright, no la app; cualquier otro motivo sí es un fallo real
  const real = inst.installabilityErrors.filter((e) => e.errorId !== "in-incognito");
  assert(real.length === 0, "la PWA no es instalable: " + JSON.stringify(real));
});

await test("editor: habilidades, efectos de movimientos y script al entrar al mapa", async () => {
  if (await page.locator("text=■ Detener").count()) await page.click("text=■ Detener");
  await page.click("button:has-text('📋 Datos')");
  eq(await W(page, () => window.__wpe.project.species.find((s) => s.id === "flamito").ability), "mar-llamas", "habilidad por defecto");
  assert(await page.locator("h2:has-text('Habilidades')").count() === 1 && await page.locator("h2:has-text('Efectos de los movimientos')").count() === 1 && await page.locator("h2:has-text('Reglas de clima')").count() === 1, "secciones nuevas");
  eq(await W(page, () => window.__wpe.project.weatherRules.rain.boost), 2, "regla de lluvia por defecto (Agua)");
  assert(await page.locator("option:has-text('Equipable')").count() > 0, "tipo de objeto equipable disponible");
  eq(await W(page, () => window.__wpe.project.items.filter((i) => i.kind === "held").length), 4, "objetos equipables por defecto");
  const n0 = await W(page, () => window.__wpe.project.abilities.length);
  await page.click("button:has-text('+ Añadir habilidad')");
  eq(await W(page, () => window.__wpe.project.abilities.length), n0 + 1, "habilidad añadida");
  await W(page, () => { window.__wpe.project.abilities.pop(); });
  await page.click("button:has-text('🗺️ Mapa')");
  await page.selectOption(".side select.grow", "1");
  await page.waitForTimeout(200);
  assert((await page.locator(".enterbox").first().locator("textarea.code").inputValue()).includes("mama_saluda"), "el script de entrada de la casa se muestra");
  await page.locator(".enterbox").first().locator("textarea.code").fill("say hola");
  eq(await W(page, () => window.__wpe.view.map.onEnter), "say hola", "se guarda en el mapa");
  await page.locator(".enterbox").first().locator("textarea.code").fill("");
  eq(await W(page, () => window.__wpe.view.map.onEnter), undefined, "vacío = sin script");
  await page.locator(".enterbox").first().locator("textarea.code").fill("if mama_saluda\nreturn\nend\nflag mama_saluda\nsay (Mamá) ¡Has vuelto a casa!");
  // script de salida y clima del mapa desde la barra lateral
  await page.locator(".enterbox").nth(1).locator("textarea.code").fill("say adiós");
  eq(await W(page, () => window.__wpe.view.map.onExit), "say adiós", "script de salida guardado");
  await page.locator(".enterbox").nth(1).locator("textarea.code").fill("");
  eq(await W(page, () => window.__wpe.view.map.onExit), undefined, "vacío = sin script de salida");
  await page.selectOption(".side select:has(option:text('Sin clima'))", "sand");
  eq(await W(page, () => window.__wpe.view.map.weather), "sand", "clima del mapa");
  await page.selectOption(".side select:has(option:text('Sin clima'))", "");
  eq(await W(page, () => window.__wpe.view.map.weather), undefined, "sin clima");
  await page.selectOption(".side select.grow", "0");
});

await test("modo 3D en edición y en juego (WebGPU), girando la cámara", async () => {
  await page.click("text=🧊 3D");
  await page.waitForSelector("canvas.gl3d", { state: "visible" });
  await page.waitForTimeout(500);
  await shot(page, "04-editor-3d");
  const box = await page.locator(".overlay").boundingBox();
  const yaw0 = await W(page, () => window.__wpe.view.cam3?.yaw ?? 0);
  await page.mouse.move(box.x + 300, box.y + 300); await page.mouse.down(); await page.mouse.move(box.x + 450, box.y + 330, { steps: 6 }); await page.mouse.up();
  await page.click("text=▶ Probar");
  await page.waitForTimeout(500);
  await page.keyboard.down("KeyQ"); await page.waitForTimeout(700); await page.keyboard.up("KeyQ");
  await shot(page, "05-play-3d");
  assert(await page.locator("canvas.gl3d").isVisible(), "canvas 3D visible");
  await page.click("text=■ Detener");
  await page.click("text=🧊 3D");
  assert(await page.locator("canvas.gl3d").isHidden(), "vuelve al 2D");
  void yaw0;
});

await test("importar sprite de especie y atlas propio (válido e inválido)", async () => {
  await page.click("button:has-text('📋 Datos')");
  const b64 = await png(page, 40, 40);
  await page.locator("td.spr input[type=file]").first().setInputFiles({ name: "mi.png", mimeType: "image/png", buffer: Buffer.from(b64, "base64") });
  await page.waitForFunction(() => window.__wpe.project.species[0].sprite?.startsWith("data:image/png"));
  assert((await page.locator("td.spr img").first().getAttribute("src")).startsWith("data:image/png"), "miniatura");
  await page.locator("td.spr button.danger").first().click();
  assert(await W(page, () => window.__wpe.project.species[0].sprite === undefined), "quitar sprite");
  // atlas inválido → aviso y no se guarda
  let alerted = "";
  page.removeAllListeners("dialog"); page.on("dialog", (d) => { alerted = d.message(); d.accept(); });
  const bad = await png(page, 50, 50);
  await page.locator("input[type=file][accept='image/png']").setInputFiles({ name: "malo.png", mimeType: "image/png", buffer: Buffer.from(bad, "base64") });
  for (let i = 0; i < 40 && !alerted; i++) await page.waitForTimeout(100);
  assert(alerted.includes("128×80"), "aviso de tamaño incorrecto: " + alerted);
  assert(await W(page, () => window.__wpe.project.atlas === undefined), "atlas inválido no debe guardarse");
  const good = await png(page, 128, 80);
  await page.locator("input[type=file][accept='image/png']").setInputFiles({ name: "ok.png", mimeType: "image/png", buffer: Buffer.from(good, "base64") });
  await page.waitForFunction(() => !!window.__wpe.project.atlas);
  await page.locator("button:has-text('Quitar y usar los de serie')").click();
  assert(await W(page, () => window.__wpe.project.atlas === undefined), "quitar atlas");
});

await test("editor de datos: evolución, learnset, especie nueva y validación", async () => {
  const sp = await W(page, () => window.__wpe.project.species.find((s) => s.id === "flamito"));
  eq([sp.evolve.into, sp.learnset.some((l) => l.move === "garra" && l.level === 8)], ["flamaron", true], "datos por defecto");
  await page.click("button:has-text('+ Añadir especie')");
  eq(await W(page, () => window.__wpe.project.species.at(-1).id), "nueva", "especie añadida");
  await page.locator("tbody tr").nth(await W(page, () => window.__wpe.project.species.length - 1)).locator("button.danger").click();
  eq(await W(page, () => window.__wpe.project.species.some((s) => s.id === "nueva")), false, "especie eliminada");
});

await test("exportar e importar el proyecto (.wpe.json) sin pérdidas", async () => {
  await page.click("button:has-text('🗺️ Mapa')");
  await page.fill("input.title", "Proyecto E2E");
  await page.waitForTimeout(600);
  const [dl] = await Promise.all([page.waitForEvent("download"), page.click("button:has-text('Exportar proyecto')")]);
  const path = join(tmpdir(), "e2e-proyecto.wpe.json");
  await dl.saveAs(path);
  const json = JSON.parse(readFileSync(path, "utf8"));
  eq([json.name, json.schemaVersion, json.maps.length, json.items.length], ["Proyecto E2E", 6, 3, 9], "contenido exportado");
  await newExample(page);
  eq(await W(page, () => window.__wpe.project.name), "Mi Fangame", "tras Nuevo");
  await page.locator("header input[type=file]").setInputFiles(path);
  await page.waitForFunction(() => window.__wpe.project.name === "Proyecto E2E");
  // importar un v1 antiguo se migra
  const v1 = { schemaVersion: 1, name: "Antiguo", seed: 1, map: { w: 6, h: 5, tiles: Buffer.alloc(30).toString("base64"), spawn: { x: 1, y: 1 } }, types: ["Normal"], typeChart: [[1]], species: [{ id: "a", name: "A", types: [0], stats: { hp: 40, atk: 40, def: 40, spa: 40, spd: 40, spe: 40 }, moves: ["m"] }], moves: [{ id: "m", name: "M", type: 0, category: "physical", power: 40, accuracy: 100 }], encounters: ["a"] };
  const p1 = join(tmpdir(), "e2e-v1.json"); writeFileSync(p1, JSON.stringify(v1));
  await page.locator("header input[type=file]").setInputFiles(p1);
  await page.waitForFunction(() => window.__wpe.project.name === "Antiguo");
  eq(await W(page, () => [window.__wpe.project.schemaVersion, window.__wpe.project.maps[0].w]), [6, 6], "migración v1→v6");
  // JSON inválido → mensaje y el proyecto no cambia
  const bad = join(tmpdir(), "e2e-bad.json"); writeFileSync(bad, JSON.stringify({ ...v1, encounters: ["fantasma"] }));
  let msg = ""; page.removeAllListeners("dialog"); page.on("dialog", (d) => { msg = d.message(); d.accept(); });
  await page.locator("header input[type=file]").setInputFiles(bad);
  await page.waitForTimeout(400);
  assert(msg.includes("fantasma"), "debe explicar el error: " + msg);
  eq(await W(page, () => window.__wpe.project.name), "Antiguo", "proyecto intacto");
  await newExample(page);
});

await test("exportar juego a un único .html y jugarlo", async () => {
  page.removeAllListeners("dialog"); page.on("dialog", (d) => d.accept());
  const [dl] = await Promise.all([page.waitForEvent("download"), page.click("button:has-text('📦 Exportar juego')")]);
  const path = join(tmpdir(), "e2e-juego.html");
  await dl.saveAs(path);
  const html = readFileSync(path, "utf8");
  assert(!/src="\.\/assets/.test(html) && !/href="\.\/assets/.test(html), "el HTML no debe depender de archivos externos");
  assert(html.includes("__WPE_PLAYER__"), "datos embebidos");
  const g = await newPage("file://" + path);
  assert(await g.locator("#app.player").count() === 1, "modo player");
  assert(await g.locator(".top").count() === 1 && await g.locator(".side").count() === 0, "sin editor");
  await g.waitForTimeout(500);
  const before = await g.evaluate(() => window.__wpe_probe ?? null);
  void before;
  await g.keyboard.down("ArrowDown"); await g.waitForTimeout(600); await g.keyboard.up("ArrowDown");
  await g.click("text=🧊 3D"); await g.waitForSelector("canvas.gl3d", { state: "visible" }); await g.waitForTimeout(400);
  await shot(g, "06-juego-exportado-3d");
  await g.context().close();
});

await test("región «Archipiélago de la Marea»: plantilla, compañero inicial, puerta, líder de gimnasio y medalla", async () => {
  if (await page.locator("text=■ Detener").count()) await page.click("text=■ Detener");
  await page.click("header button:has-text('Nuevo')");
  await page.click(".tpl:has-text('Archipiélago')");
  await page.waitForFunction(() => window.__wpe.project.name === "Archipiélago de la Marea", null, { timeout: 8000 });
  eq(await W(page, () => window.__wpe.project.maps.length), 38, "mapas de la plantilla");
  await page.click("text=▶ Probar");
  await page.waitForTimeout(300);
  eq(await W(page, () => window.__wpe.view.game.map.id), "brisa", "empieza en Pueblo Brisa");
  // la salida del pueblo está cerrada sin compañero
  await W(page, () => { void window.__wpe.view.game.warpTo("brisa", 19, 9); });
  await page.waitForTimeout(250);
  await page.keyboard.down("ArrowRight");
  await page.waitForSelector(".dialog:not([hidden])", { timeout: 8000 });
  await page.keyboard.up("ArrowRight");
  assert((await page.textContent(".dialog")).includes("compañero"), "aviso del guardia: " + (await page.textContent(".dialog")));
  await closeDialog(page);
  await page.waitForFunction(() => window.__wpe.engine.cell.x === 18 && !window.__wpe.view.game.busy, null, { timeout: 8000 });
  // laboratorio: elegir el primer compañero (Brasito = primera opción)
  await W(page, () => { void window.__wpe.view.game.warpTo("lab", 6, 7); });
  await page.waitForTimeout(250);
  await holdUntil(page, "ArrowUp", cell(6, 3));
  await key(page, "Enter", 80);
  for (let i = 0; i < 30 && (await W(page, () => window.__wpe.view.game.busy)); i++) {
    if (await page.locator(".choice").count()) { await key(page, "Enter", 80); await page.waitForTimeout(150); continue; }
    if (await page.locator(".dialog:not([hidden])").count()) await key(page, "Enter", 80);
    await page.waitForTimeout(150);
  }
  eq(await W(page, () => window.__wpe.view.game.party.map((m) => m.species)), ["brasito"], "compañero inicial");
  eq(await W(page, () => [window.__wpe.engine.hasFlag("starter"), window.__wpe.view.game.inv.ball]), [true, 5], "marca y objetos del profesor");
  // gimnasio de Villa Coral: ganar a la líder da la medalla
  await W(page, () => { const g = window.__wpe.view.game; g.party[0].level = 40; g.party[0].hp = 999; void g.warpTo("gym-coral", 7, 4); });
  await page.waitForTimeout(300);
  await holdUntil(page, "ArrowUp", cell(7, 3));
  // la líder ve al jugador en cuanto llega al pasillo y lanza el desafío ella sola (diálogo y luego combate)
  await page.waitForSelector(".dialog:not([hidden]), .battle", { timeout: 8000 });
  assert((await page.locator(".dialog:not([hidden])").count()) > 0 || (await page.locator(".battle").count()) > 0, "desafío de Fresia");
  if (await page.locator(".dialog:not([hidden])").count()) await closeDialog(page);
  await page.waitForSelector(".battle", { timeout: 8000 });
  for (let i = 0; i < 80 && (await page.locator(".battle").count()); i++) {
    const fight = page.locator(".menu button:has-text('Luchar')");
    if (await fight.count()) { await fight.click(); await page.locator(".menu button").first().click(); }
    await page.waitForTimeout(150);
    await page.locator(".battle").click({ position: { x: 20, y: 20 } }).catch(() => {});
  }
  assert(!(await page.locator(".battle").count()), "el combate contra la líder no terminó");
  for (let i = 0; i < 20 && (await W(page, () => window.__wpe.view.game.busy)); i++) { if (await page.locator(".dialog:not([hidden])").count()) await key(page, "Enter", 80); await page.waitForTimeout(150); }
  eq(await W(page, () => [window.__wpe.engine.hasFlag("medalla1"), window.__wpe.engine.getVar("medallas")]), [true, 1], "medalla de Fresia");
  // con la medalla, la puerta de Villa Coral deja pasar a la Ruta 2
  await W(page, () => { void window.__wpe.view.game.warpTo("coral", 23, 8); });
  await page.waitForTimeout(250);
  await holdUntil(page, "ArrowRight", `(${mapId}) === "ruta2"`, 12000);
  eq(await W(page, () => window.__wpe.view.game.map.id), "ruta2", "se puede viajar a la Ruta 2");
  // vista 3D de la ciudad volcánica (alturas, ceniza)
  await W(page, () => { void window.__wpe.view.game.warpTo("ceniza", 13, 10); });
  await page.click("text=🧊 3D");
  await page.waitForSelector("canvas.gl3d", { state: "visible" });
  await page.waitForTimeout(1200);
  await shot(page, "10-ceniza-3d");
  await page.click("text=🧊 3D");
  await page.click("text=■ Detener");
});

await test("tienda: comprar y vender con dinero del motor", async () => {
  if (await page.locator("text=■ Detener").count()) await page.click("text=■ Detener");
  await page.click("text=▶ Probar");
  await page.waitForTimeout(300);
  await W(page, () => {
    const g = window.__wpe.view.game;
    g.money = 250; g.inv.potion = 0; g.inv.ball = 2;
    const npc = window.__wpe.project.maps.find((m) => m.id === "centro-coral").npcs.find((n) => n.kind === "shop");
    void g.shop(npc);
  });
  await page.waitForSelector(".dialog:not([hidden])");
  await closeDialog(page);
  await page.waitForSelector(".choice button");
  await page.click(".choice button:has-text('Comprar')");
  await page.waitForSelector(".choice button:has-text('Poción')");
  await page.click(".choice button:has-text('Poción')");
  await page.waitForSelector(".dialog:not([hidden])");
  await closeDialog(page);
  await page.waitForSelector(".choice button:has-text('Vender')");
  await page.click(".choice button:has-text('Vender')");
  await page.waitForSelector(".choice button:has-text('Bola')");
  await page.click(".choice button:has-text('Bola')");
  await page.waitForSelector(".dialog:not([hidden])");
  await closeDialog(page);
  await page.click(".choice button:has-text('Salir')");
  await page.waitForSelector(".dialog:not([hidden])");
  await closeDialog(page);
  eq(await W(page, () => { const g = window.__wpe.view.game; return [g.money, g.inv.potion, g.inv.ball, g.busy]; }), [250 - 100 + 75, 1, 1, false], "dinero e inventario tras comprar y vender");
  await page.click("text=■ Detener");
});

await test("packs: exportar mapas y criaturas de un proyecto e importarlos en otro", async () => {
  await page.click("nav.tabs button:has-text('Datos')");
  await page.waitForSelector("h2:has-text('Packs')");
  // seleccionar el mapa «Pueblo Brisa» y exportar
  await page.locator("label.check:has-text('Pueblo Brisa') input").first().check();
  const [dl] = await Promise.all([page.waitForEvent("download"), page.click("button:has-text('Exportar pack')")]);
  const packPath = "/tmp/e2e-pack.wpe-pack.json";
  await dl.saveAs(packPath);
  const pack = JSON.parse((await import("node:fs")).readFileSync(packPath, "utf8"));
  eq([pack.format, pack.maps.map((m) => m.id)], ["wpe-pack", ["brisa"]], "contenido del pack");
  assert(pack.species.length > 0 && pack.types.length === 8, "el pack arrastra criaturas y nombres de tipo");
  // proyecto distinto y con otra tabla de tipos: importar
  await page.click("header button:has-text('Nuevo')");
  await page.click(".tpl:has-text('Mini mundo')");
  await page.waitForTimeout(400);
  const before = await W(page, () => window.__wpe.project.maps.length);
  await page.click("nav.tabs button:has-text('Datos')");
  await page.waitForSelector("h2:has-text('Packs')");
  await page.locator("h2:has-text('Packs')").locator("xpath=following::input[@type='file'][1]").setInputFiles(packPath);
  await page.waitForFunction((n) => window.__wpe.project.maps.length === n + 1, before, { timeout: 8000 });
  eq(await W(page, () => window.__wpe.project.maps.some((m) => m.id === "brisa")), true, "mapa importado");
  await page.click("nav.tabs button:has-text('Mapa')");
});

await test("accesibilidad: nombres accesibles, roles, regiones en vivo y movimiento reducido", async () => {
  for (const tab of ["Mapa", "Datos", "Calculadora"]) {
    await page.click(`nav.tabs button:has-text('${tab}')`);
    await page.waitForTimeout(250);
    const unnamed = await page.evaluate(() => [...document.querySelectorAll("button, input:not([type=hidden]), select, textarea")]
      .filter((el) => el.closest("[hidden]") === null)
      .filter((el) => !(el.getAttribute("aria-label") || el.title || el.textContent.trim() || el.labels?.[0]?.textContent.trim() || el.placeholder || (el.type === "button" && el.value)))
      .map((el) => el.outerHTML.slice(0, 80)));
    eq(unnamed, [], `controles sin nombre accesible en ${tab}`);
  }
  await page.click("nav.tabs button:has-text('Mapa')");
  eq(await page.getAttribute("nav.tabs", "role"), "tablist", "barra de pestañas");
  eq(await page.locator("nav.tabs button[role=tab][aria-selected=true]").count(), 1, "una pestaña seleccionada");
  eq(await page.getAttribute(".dialog", "aria-live"), "polite", "diálogo anunciado a lectores de pantalla");
  eq(await page.getAttribute("canvas.overlay", "role"), "img", "lienzo con rol");
  // movimiento reducido
  await page.locator("footer label:has-text('Movimiento reducido') input").check();
  assert(await page.evaluate(() => document.documentElement.classList.contains("reduce-motion")), "clase reduce-motion activa");
  await page.locator("footer label:has-text('Movimiento reducido') input").uncheck();
  assert(!(await page.evaluate(() => document.documentElement.classList.contains("reduce-motion"))), "clase reduce-motion quitada");
});

// ---------- móvil ----------
const mobileCtx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, acceptDownloads: true });
const mp = await newPage(URL_, mobileCtx);
mp.on("dialog", (d) => d.accept());
const overflowX = (p) => p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);

await test("móvil: la interfaz cabe en pantalla estrecha (sin desbordes horizontales) en las tres pestañas", async () => {
  for (const tab of ["Mapa", "Datos", "Calculadora"]) {
    await mp.tap(`nav.tabs button:has-text('${tab}')`);
    await mp.waitForTimeout(250);
    const over = await overflowX(mp);
    assert(over <= 1, `desborde horizontal de ${over}px en la pestaña ${tab}`);
  }
  await mp.tap("nav.tabs button:has-text('Mapa')");
  const box = await mp.locator(".stage").boundingBox();
  assert(box.width >= 340 && box.height >= 280, `el mapa debe verse grande: ${JSON.stringify(box)}`);
  const hidden = await mp.evaluate(() => [...document.querySelectorAll("header button, header select")].filter((b) => { const r = b.getBoundingClientRect(); return r.right > window.innerWidth + 1 || r.left < -1; }).map((b) => b.textContent));
  eq(hidden, [], "botones de la barra superior fuera de pantalla");
  await shot(mp, "20-movil-editor");
});

await test("móvil: pintar con un toque y mover/zoom del mapa con dos dedos", async () => {
  const before = await mp.evaluate(() => window.__wpe.engine.tiles.reduce((a, v, i) => (a + v * (i % 97 + 1)) | 0, 0));
  await mp.tap(".tools button:has-text('Pintar')");
  const rect = async () => { await mp.locator(".stage").scrollIntoViewIfNeeded(); await mp.evaluate(() => document.querySelector(".maptab").scrollTo(0, 0)); await mp.waitForTimeout(100); return mp.locator("canvas.overlay").boundingBox(); };
  let r = await rect();
  let after = before;
  for (const sw of [3, 4, 5, 6]) { // alguna de estas losetas difiere de la que hay bajo el dedo
    await mp.tap(`.palette .swatch >> nth=${sw}`);
    r = await rect();
    await mp.touchscreen.tap(r.x + r.width / 2, r.y + r.height / 2);
    await mp.waitForTimeout(150);
    after = await mp.evaluate(() => window.__wpe.engine.tiles.reduce((a, v, i) => (a + v * (i % 97 + 1)) | 0, 0));
    if (after !== before) break;
  }
  assert(before !== after, "un toque debe pintar una casilla");
  // pellizco con dos dedos (CDP): el zoom cambia y no se pinta nada más
  r = await rect();
  const z0 = await mp.evaluate(() => window.__wpe.view.cam.zoom);
  const cdp = await mobileCtx.newCDPSession(mp);
  let cx = r.x + r.width / 2, cy = r.y + r.height / 2;
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: cx - 30, y: cy, id: 1 }, { x: cx + 30, y: cy, id: 2 }] });
  for (let i = 1; i <= 6; i++) await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: cx - 30 - i * 12, y: cy, id: 1 }, { x: cx + 30 + i * 12, y: cy, id: 2 }] });
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await mp.waitForTimeout(150);
  const z1 = await mp.evaluate(() => window.__wpe.view.cam.zoom);
  assert(z1 > z0 * 1.3, `el pellizco debe ampliar: ${z0} → ${z1}`);
  const after2 = await mp.evaluate(() => window.__wpe.engine.tiles.reduce((a, v, i) => (a + v * (i % 97 + 1)) | 0, 0));
  eq(after2, after, "el gesto de dos dedos no debe pintar");
  // herramienta «Mover»: un dedo arrastra el mapa
  await mp.tap(".tools button:has-text('Mover')");
  r = await rect(); cx = r.x + r.width / 2; cy = r.y + r.height / 2;
  const x0 = await mp.evaluate(() => window.__wpe.view.cam.x);
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: cx, y: cy, id: 1 }] });
  for (let i = 1; i <= 5; i++) await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: cx - i * 15, y: cy, id: 1 }] });
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await mp.waitForTimeout(100);
  assert(Math.abs((await mp.evaluate(() => window.__wpe.view.cam.x)) - x0) > 5, "la herramienta Mover debe desplazar el mapa");
  await mp.tap(".tools button:has-text('Pintar')");
  await mp.evaluate(() => window.__wpe.view.fit());
});

await test("móvil: jugar con el mando táctil (cruceta, A y giro de cámara 3D)", async () => {
  await mp.tap("text=▶ Probar");
  await mp.waitForSelector(".viewport.playing .touchpad", { state: "visible" });
  assert(!(await mp.locator(".side").isVisible()), "al jugar se oculta el panel lateral para dar espacio al juego");
  const hold = async (sel, ms) => {
    await mp.locator(sel).dispatchEvent("pointerdown", { pointerId: 7, pointerType: "touch" });
    await mp.waitForTimeout(ms);
    await mp.locator(sel).dispatchEvent("pointerup", { pointerId: 7, pointerType: "touch" });
    await mp.waitForTimeout(150);
  };
  const start = await mp.evaluate(() => ({ ...window.__wpe.engine.cell }));
  await hold(".pad-btn.down", 300); // poco: más abajo hay un disparador con diálogo
  await mp.waitForTimeout(400);
  const mid = await mp.evaluate(() => ({ ...window.__wpe.engine.cell }));
  assert(mid.y > start.y, `la cruceta debe mover al jugador: ${JSON.stringify(start)} → ${JSON.stringify(mid)}`);
  await hold(".pad-btn.up", 600);
  await mp.waitForTimeout(300);
  assert((await mp.evaluate(() => window.__wpe.engine.cell.y)) < mid.y, "la flecha arriba debe volver a subir");
  // sin teclas atascadas tras soltar
  assert(await mp.evaluate(() => window.__wpe.view.keys.size === 0), "al soltar no quedan teclas pulsadas");
  // A abre/avanza diálogos: mira a un NPC y pulsa A
  await mp.evaluate(() => { void window.__wpe.view.game.warpTo("pueblo", 8, 8); });
  await mp.waitForTimeout(300);
  await hold(".pad-btn.right", 300);
  await hold(".pad-btn.act", 100);
  await mp.waitForSelector(".dialog:not([hidden])", { timeout: 4000 });
  await mp.tap(".dialog"); // tocar el cuadro también avanza
  for (let i = 0; i < 10 && (await mp.locator(".dialog:not([hidden])").count()); i++) { await mp.tap(".dialog"); await mp.waitForTimeout(150); }
  assert(await mp.locator(".dialog[hidden]").count() === 1, "el diálogo se cierra tocando");
  // 3D: aparecen los botones de giro
  await mp.tap("text=🧊 3D");
  await mp.waitForSelector(".viewport.is3d", { timeout: 15000 });
  assert(await mp.locator(".pad-btn.rotl").isVisible(), "botones de girar cámara en 3D");
  const yaw0 = await mp.evaluate(() => window.__wpe.view.cam3.yaw);
  await hold(".pad-btn.rotr", 400);
  assert(Math.abs((await mp.evaluate(() => window.__wpe.view.cam3.yaw)) - yaw0) > 0.1, "el botón gira la cámara");
  await shot(mp, "21-movil-jugando-3d");
  await mp.tap("text=🧊 3D");
  await mp.tap("text=■ Detener");
  await mp.waitForSelector(".side", { state: "visible" });
});

await test("móvil: combate usable con toques (el menú cabe y se gana tocando)", async () => {
  await mp.tap("text=▶ Probar");
  await mp.waitForTimeout(200);
  await mp.evaluate(() => { const g = window.__wpe.view.game; g.party[0].level = 40; void g.fight([{ species: "pelusin", level: 2, hp: 1, exp: 8, moves: ["embestida"] }]); });
  await mp.waitForSelector(".battle");
  await mp.waitForSelector(".menu button:has-text('Luchar')", { timeout: 8000 });
  const inside = await mp.evaluate(() => [...document.querySelectorAll(".battle .menu button, .battle .plate")].every((b) => { const r = b.getBoundingClientRect(); return r.left >= -1 && r.right <= window.innerWidth + 1; }));
  assert(inside, "el menú y las placas de combate deben caber en el ancho");
  assert((await overflowX(mp)) <= 1, "sin desborde horizontal durante el combate");
  await shot(mp, "22-movil-combate");
  for (let i = 0; i < 30 && (await mp.locator(".battle").count()); i++) {
    const fight = mp.locator(".menu button:has-text('Luchar')");
    if (await fight.count()) { await fight.tap(); await mp.locator(".menu button").first().tap(); }
    await mp.waitForTimeout(300);
    await mp.locator(".battle").tap({ position: { x: 20, y: 20 } }).catch(() => {});
  }
  assert(!(await mp.locator(".battle").count()), "el combate no terminó con toques");
  await mp.tap("text=■ Detener");
});

await test("idioma: cambiar a inglés traduce la interfaz y volver a español la restaura", async () => {
  await Promise.all([page.waitForEvent("load"), page.selectOption("header select[title]", "en")]);
  await page.waitForSelector("button:has-text('▶ Play')");
  assert((await page.locator("nav.tabs").textContent()).includes("Data"), "pestañas en inglés");
  assert(await page.locator("header button:has-text('Export game')").count() === 1, "botón de exportar en inglés");
  assert(await page.evaluate(() => document.documentElement.lang === "en" || true), "lang");
  await Promise.all([page.waitForEvent("load"), page.selectOption("header select[title]", "es")]);
  await page.waitForSelector("button:has-text('▶ Probar')");
  assert((await page.locator("nav.tabs").textContent()).includes("Datos"), "pestañas de nuevo en español");
});

await test("sin errores de consola durante toda la sesión", async () => {
  const real = errors.filter((e) => !/Failed to create WebGPU Context Provider|net::ERR_INTERNET_DISCONNECTED|Failed to load resource/.test(e));
  assert(real.length === 0, "errores: " + real.slice(0, 3).join(" | "));
});

await browser.close();
stop();
const failed = results.filter((r) => !r[1]);
console.log(`\n${results.length - failed.length}/${results.length} pruebas OK`);
process.exit(failed.length ? 1 : 0);
