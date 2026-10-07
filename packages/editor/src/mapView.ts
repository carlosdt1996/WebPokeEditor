import { sfx, startMusic, stopMusic } from "./audio";
import type { Battle } from "./battle";
import { h } from "./dom";
import { Engine, Input } from "./engine";
import { Game, type Host } from "./game";
import { type GameMap, type Npc, type Project, decodeTiles, encodeTiles, uniqueId } from "./project";
import { createRenderer, type Renderer } from "./renderer";
import { MAX_INSTANCES } from "./renderer/types";
import { type Cam3D, type Entity3D, Renderer3D } from "./renderer3d";
import { ANIM_MS, ERASE_OBJECT, NPC_SPRITE, OBJECT_MIN, PLAYER_SPRITE, TILE, TILE_ANIM, TILE_DEFS, TILE_HEIGHT, atlasIndex } from "./tiles";
import { runBattleUi } from "./ui/battleUi";

export type Tool = "paint" | "fill" | "pick" | "spawn" | "npc" | "warp" | "trigger" | "raise" | "lower";
export type Selection = { kind: "npc" | "warp" | "trigger"; index: number } | null;

/** layer: 0 suelo, 1 objetos, 2 alturas */
interface Edit { layer: 0 | 1 | 2; idx: number; from: number; to: number }

export class MapView {
  readonly el = h("div", { class: "viewport" });
  tool: Tool = "paint";
  tile = 1;
  showSolid = false;
  showGrid = true;
  showHeights = false;
  playing = false;
  mode3d = false;
  selection: Selection = null;
  onEdit: () => void = () => {};
  onPick: (t: number) => void = () => {};
  onMessage: (m: string) => void = () => {};
  onSelect: (s: Selection) => void = () => {};
  rendererKind = "";
  game: Game | null = null;

  private renderer!: Renderer;
  private gl!: HTMLCanvasElement;
  private gl3d?: HTMLCanvasElement;
  private r3d?: Renderer3D;
  private atlas?: HTMLCanvasElement;
  private world3dDirty = true;
  private heights = new Int8Array(0);
  private cam3: Cam3D = { x: 0, z: 0, yaw: 0, pitch: 0.95, dist: 9 };
  private overlay = h("canvas", { class: "overlay" });
  private dialogEl = h("div", { class: "dialog", hidden: true });
  private og = this.overlay.getContext("2d")!;
  private cam = { x: 0, y: 0, zoom: 3 };
  private dpr = 1;
  private cssW = 1;
  private cssH = 1;
  private inst = new Float32Array(MAX_INSTANCES * 4);
  private hover: { x: number; y: number } | null = null;
  private undo: Edit[][] = [];
  private redo: Edit[][] = [];
  private stroke: Map<number, Edit> | null = null;
  private visited = new Set<number>();
  private pan: { x: number; y: number; cx: number; cy: number } | null = null;
  private orbit: { x: number; y: number; yaw: number; pitch: number } | null = null;
  private spaceDown = false;
  private keys = new Set<string>();
  private acc = 0;
  private last = 0;
  private advance: (() => void) | null = null;
  private project!: Project;
  private editIndex = 0;
  private curIndex = 0;
  private dt = 1 / 60;

  constructor(private engine: Engine) {}

  async init(project: Project, atlas: HTMLCanvasElement) {
    const { renderer, canvas } = await createRenderer(this.el);
    this.renderer = renderer;
    this.gl = canvas;
    this.rendererKind = renderer.kind;
    this.setAtlas(atlas);
    this.el.append(this.overlay, this.dialogEl);
    this.setProject(project);
    this.bind();
    new ResizeObserver(() => this.onResize()).observe(this.el);
    this.onResize();
    this.fit();
    requestAnimationFrame((t) => this.frame(t));
  }

  get map(): GameMap { return this.project.maps[this.curIndex]; }
  get mapIndex() { return this.curIndex; }

  setAtlas(atlas: HTMLCanvasElement) {
    this.atlas = atlas;
    this.renderer.setAtlas(atlas);
    this.r3d?.setAtlas(atlas);
  }

  // ----- Proyecto y mapas -----
  setProject(p: Project) {
    this.stopPlay();
    this.project = p;
    const i = Math.max(0, p.maps.findIndex((m) => m.id === p.start.map));
    this.switchMap(i, false);
  }

  /** Carga el mapa `index` en el motor para edición. */
  switchMap(index: number, commit = true) {
    if (this.playing) return;
    if (commit) this.commit();
    this.curIndex = this.editIndex = index;
    this.loadIntoEngine(index, false);
    this.undo = []; this.redo = [];
    this.select(null);
    this.fit();
  }

  private loadIntoEngine(index: number, runtime: boolean, x?: number, y?: number) {
    const m = this.project.maps[index];
    this.curIndex = index;
    this.engine.loadMap(m.w, m.h, decodeTiles(m.tiles, m.w * m.h), this.project.seed, m.objects ? decodeTiles(m.objects, m.w * m.h) : undefined);
    this.heights = new Int8Array(m.w * m.h);
    if (m.heights) { const raw = decodeTiles(m.heights, m.w * m.h); for (let i = 0; i < raw.length; i++) this.heights[i] = raw[i] - 128; }
    this.engine.clearBlockers();
    if (runtime) for (const n of m.npcs) this.engine.setBlocker(n.x, n.y);
    const s = this.project.start;
    this.engine.setSpawn(x ?? (s.map === m.id ? s.x : 0), y ?? (s.map === m.id ? s.y : 0));
    this.world3dDirty = true;
  }

  /** Vuelca el mapa del motor al proyecto (solo en edición). */
  commit() {
    if (this.playing) return;
    const m = this.map;
    if (!m) return;
    m.w = this.engine.width; m.h = this.engine.height;
    m.tiles = encodeTiles(this.engine.tiles);
    const objs = this.engine.objects;
    m.objects = objs.some((v) => v) ? encodeTiles(objs) : undefined;
    m.heights = this.heights.some((v) => v) ? encodeTiles(Uint8Array.from(this.heights, (v) => v + 128)) : undefined;
  }

  resizeMap(w: number, hh: number) {
    this.commit();
    const m = this.map;
    const ow = m.w, oh = m.h;
    const resize = (b64: string | undefined, fillV: number) => {
      const old = b64 ? decodeTiles(b64, ow * oh) : new Uint8Array(ow * oh).fill(fillV);
      const next = new Uint8Array(w * hh).fill(fillV);
      for (let y = 0; y < Math.min(oh, hh); y++) for (let x = 0; x < Math.min(ow, w); x++) next[y * w + x] = old[y * ow + x];
      return next;
    };
    const objs = resize(m.objects, 0), hs = resize(m.heights, 128);
    m.w = w; m.h = hh; m.tiles = encodeTiles(resize(m.tiles, 0));
    m.objects = objs.some((v) => v) ? encodeTiles(objs) : undefined;
    m.heights = hs.some((v) => v !== 128) ? encodeTiles(hs) : undefined;
    m.npcs = m.npcs.filter((n) => n.x < w && n.y < hh);
    m.warps = m.warps.filter((k) => k.x < w && k.y < hh);
    if (m.triggers) m.triggers = m.triggers.filter((k) => k.x < w && k.y < hh);
    const s = this.project.start;
    if (s.map === m.id) this.project.start = { map: m.id, x: Math.min(s.x, w - 1), y: Math.min(s.y, hh - 1) };
    this.loadIntoEngine(this.curIndex, false);
    this.undo = []; this.redo = [];
    this.select(null);
    this.onEdit();
    this.fit();
  }

  fit() {
    const mw = this.engine.width * TILE, mh = this.engine.height * TILE;
    this.cam.zoom = Math.max(1, Math.min(8, Math.floor(Math.min(this.cssW / mw, this.cssH / mh) * 4) / 4)) || 2;
    this.cam.x = mw / 2 - this.cssW / this.cam.zoom / 2;
    this.cam.y = mh / 2 - this.cssH / this.cam.zoom / 2;
    this.cam3.dist = Math.min(60, Math.max(9, Math.max(this.engine.width, this.engine.height) * 0.95));
    this.cam3.yaw = 0;
  }

  select(s: Selection) { this.selection = s; this.onSelect(s); }
  deleteSelection() {
    const s = this.selection;
    if (!s) return;
    (s.kind === "npc" ? this.map.npcs : s.kind === "warp" ? this.map.warps : (this.map.triggers ??= [])).splice(s.index, 1);
    this.select(null);
    this.onEdit();
  }
  markDirty() { this.world3dDirty = true; }

  // ----- Modo 3D -----
  async set3D(on: boolean): Promise<boolean> {
    if (on && !this.r3d) {
      try {
        const c = h("canvas", { class: "gl3d" });
        this.el.prepend(c);
        this.r3d = await Renderer3D.create(c);
        this.gl3d = c;
        if (this.atlas) this.r3d.setAtlas(this.atlas);
        this.onResize();
      } catch (e) {
        this.gl3d?.remove();
        this.onMessage("El modo 3D necesita WebGPU, que no está disponible en este navegador.");
        console.warn(e);
        return false;
      }
    }
    this.mode3d = on;
    this.world3dDirty = true;
    this.gl.style.display = on ? "none" : "";
    if (this.gl3d) this.gl3d.style.display = on ? "" : "none";
    if (on) {
      this.cam3.yaw = 0;
      if (this.playing) { const pl = this.engine.player; this.cam3.dist = 13; this.cam3.x = pl.x + 0.5; this.cam3.z = pl.y + 0.5; }
    }
    return true;
  }

  // ----- Jugar -----
  startPlay() {
    this.commit();
    this.editIndex = this.curIndex;
    this.playing = true;
    this.acc = 0;
    const host: Host = {
      loadMap: (i, x, y) => { this.loadIntoEngine(i, true, x, y); this.select(null); },
      dialog: (who, lines) => this.dialog(who, lines),
      battle: async (b: Battle) => { await runBattleUi(this.el, this.project, b); },
      say: (m) => this.onMessage(m),
    };
    this.game = new Game(this.project, this.engine, host);
    this.game.start();
    if (this.mode3d) { this.cam3.dist = 13; }
    (document.activeElement as HTMLElement | null)?.blur();
    startMusic();
    this.onMessage("Modo prueba: flechas/WASD mover · Enter/Espacio/Z interactuar" + (this.mode3d ? " · Q/E girar cámara" : "") + ".");
  }

  stopPlay() {
    if (!this.playing) return;
    this.playing = false;
    this.game = null;
    this.advance = null;
    this.dialogEl.hidden = true;
    this.el.querySelector(".battle")?.remove();
    stopMusic();
    this.loadIntoEngine(this.editIndex, false);
    this.fit();
  }

  private dialog(speaker: string | null, lines: string[]): Promise<void> {
    return new Promise((res) => {
      let i = 0;
      const show = () => {
        this.dialogEl.replaceChildren(...(speaker ? [h("b", { class: "who" }, speaker)] : []), h("div", {}, lines[i] + "  ▼"));
        this.dialogEl.hidden = false;
      };
      this.advance = () => {
        sfx("talk");
        if (++i >= lines.length) { this.dialogEl.hidden = true; this.advance = null; res(); } else show();
      };
      show();
    });
  }

  // ----- Edición -----
  undoEdit() { this.applyHistory(this.undo, this.redo, "from"); }
  redoEdit() { this.applyHistory(this.redo, this.undo, "to"); }
  private layerArr(layer: 0 | 1 | 2): Uint8Array | Int8Array { return layer === 0 ? this.engine.tiles : layer === 1 ? this.engine.objects : this.heights; }
  private applyHistory(from: Edit[][], to: Edit[][], key: "from" | "to") {
    const s = from.pop();
    if (!s) return;
    for (const e of s) this.layerArr(e.layer)[e.idx] = e[key];
    to.push(s);
    this.world3dDirty = true;
    this.onEdit();
  }

  /** Escribe una celda de una capa registrándola en el trazo actual (para deshacer). */
  private setCell(layer: 0 | 1 | 2, x: number, y: number, v: number) {
    const w = this.engine.width;
    if (x < 0 || y < 0 || x >= w || y >= this.engine.height) return;
    const idx = y * w + x, arr = this.layerArr(layer);
    const cur = arr[idx];
    if (cur === v) return;
    const key = layer * 1e6 + idx;
    const prev = this.stroke!.get(key);
    this.stroke!.set(key, { layer, idx, from: prev ? prev.from : cur, to: v });
    arr[idx] = v;
    this.world3dDirty = true;
  }

  /** Pinta con el tile elegido en su capa (≥12 → objetos; 255 → quitar objeto). */
  private paintCell(x: number, y: number, t: number) {
    if (t === ERASE_OBJECT) this.setCell(1, x, y, 0);
    else if (t >= OBJECT_MIN) this.setCell(1, x, y, t);
    else this.setCell(0, x, y, t);
  }

  private flood(sx: number, sy: number, t: number) {
    const w = this.engine.width, hh = this.engine.height;
    if (sx < 0 || sy < 0 || sx >= w || sy >= hh) return;
    const layer: 0 | 1 = t >= OBJECT_MIN ? 1 : 0;
    const arr = this.layerArr(layer);
    const target = arr[sy * w + sx], value = t === ERASE_OBJECT ? 0 : t;
    if (target === value) return;
    const stack = [[sx, sy]];
    while (stack.length) {
      const [x, y] = stack.pop()!;
      if (x < 0 || y < 0 || x >= w || y >= hh || arr[y * w + x] !== target) continue;
      this.setCell(layer, x, y, value);
      stack.push([x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]);
    }
  }

  private toTile(e: PointerEvent) {
    const r = this.el.getBoundingClientRect();
    const wx = this.cam.x + (e.clientX - r.left) / this.cam.zoom;
    const wy = this.cam.y + (e.clientY - r.top) / this.cam.zoom;
    return { x: Math.floor(wx / TILE), y: Math.floor(wy / TILE) };
  }

  private inMap(x: number, y: number) { return x >= 0 && y >= 0 && x < this.engine.width && y < this.engine.height; }

  private act(e: PointerEvent, first: boolean) {
    const { x, y } = this.toTile(e);
    const m = this.map;
    if ((this.tool === "raise" || this.tool === "lower")) { const k = y * 4096 + x; if (this.visited.has(k)) return; this.visited.add(k); }
    if (this.tool === "paint") this.paintCell(x, y, this.tile);
    else if (this.tool === "raise" || this.tool === "lower") {
      if (this.inMap(x, y)) { const i = y * this.engine.width + x; this.setCell(2, x, y, Math.max(-8, Math.min(12, this.heights[i] + (this.tool === "raise" ? 1 : -1)))); }
    }
    else if (first && this.tool === "fill") this.flood(x, y, this.tile);
    else if (first && this.tool === "pick") { if (this.inMap(x, y)) { const o = this.engine.objects[y * this.engine.width + x]; this.onPick(o || this.engine.getTile(x, y)); } }
    else if (first && this.tool === "spawn") {
      if (this.inMap(x, y)) { this.project.start = { map: m.id, x, y }; this.engine.setSpawn(x, y); this.onEdit(); }
    } else if (first && this.tool === "npc" && this.inMap(x, y)) {
      let i = m.npcs.findIndex((n) => n.x === x && n.y === y);
      if (i < 0) {
        const n: Npc = { id: uniqueId(m.npcs.map((k) => k.id), "npc"), x, y, look: m.npcs.length % 4, dir: 0, kind: "talk", name: "NPC", lines: ["¡Hola!"] };
        m.npcs.push(n); i = m.npcs.length - 1;
        this.onEdit();
      }
      this.select({ kind: "npc", index: i });
    } else if (first && this.tool === "trigger" && this.inMap(x, y)) {
      const list = (m.triggers ??= []);
      let i = list.findIndex((k) => k.x === x && k.y === y);
      if (i < 0) { list.push({ x, y, name: "Disparador", script: "say ¡Has pisado un disparador!", once: true }); i = list.length - 1; this.onEdit(); }
      this.select({ kind: "trigger", index: i });
    } else if (first && this.tool === "warp" && this.inMap(x, y)) {
      let i = m.warps.findIndex((k) => k.x === x && k.y === y);
      if (i < 0) {
        const other = this.project.maps.find((k) => k.id !== m.id) ?? m;
        m.warps.push({ x, y, toMap: other.id, toX: Math.min(1, other.w - 1), toY: Math.min(1, other.h - 1) });
        i = m.warps.length - 1;
        this.onEdit();
      }
      this.select({ kind: "warp", index: i });
    }
  }

  private bind() {
    const el = this.overlay;
    el.addEventListener("contextmenu", (e) => e.preventDefault());
    el.addEventListener("pointerdown", (e) => {
      if (this.playing) return;
      el.setPointerCapture(e.pointerId);
      if (this.mode3d) { this.orbit = { x: e.clientX, y: e.clientY, yaw: this.cam3.yaw, pitch: this.cam3.pitch }; return; }
      if (e.button === 1 || e.button === 2 || this.spaceDown) {
        this.pan = { x: e.clientX, y: e.clientY, cx: this.cam.x, cy: this.cam.y };
        return;
      }
      if (e.button !== 0) return;
      this.stroke = new Map();
      this.visited.clear();
      this.act(e, true);
    });
    el.addEventListener("pointermove", (e) => {
      if (this.orbit) {
        this.cam3.yaw = this.orbit.yaw - (e.clientX - this.orbit.x) * 0.008;
        this.cam3.pitch = Math.min(1.45, Math.max(0.3, this.orbit.pitch + (e.clientY - this.orbit.y) * 0.006));
        return;
      }
      this.hover = this.toTile(e);
      if (this.pan) {
        this.cam.x = this.pan.cx - (e.clientX - this.pan.x) / this.cam.zoom;
        this.cam.y = this.pan.cy - (e.clientY - this.pan.y) / this.cam.zoom;
      } else if (this.stroke) this.act(e, false);
    });
    const end = () => {
      this.pan = null; this.orbit = null;
      if (this.stroke) {
        if (this.stroke.size) { this.undo.push([...this.stroke.values()]); this.redo = []; this.onEdit(); }
        this.stroke = null;
      }
    };
    el.addEventListener("pointerup", end);
    el.addEventListener("pointercancel", end);
    el.addEventListener("pointerleave", () => (this.hover = null));
    el.addEventListener("wheel", (e) => {
      e.preventDefault();
      if (this.mode3d) { this.cam3.dist = Math.min(60, Math.max(3, this.cam3.dist * (e.deltaY < 0 ? 0.9 : 1.1))); return; }
      if (this.playing) return;
      const r = this.el.getBoundingClientRect();
      const mx = e.clientX - r.left, my = e.clientY - r.top;
      const wx = this.cam.x + mx / this.cam.zoom, wy = this.cam.y + my / this.cam.zoom;
      this.cam.zoom = Math.min(10, Math.max(0.5, this.cam.zoom * (e.deltaY < 0 ? 1.15 : 1 / 1.15)));
      this.cam.x = wx - mx / this.cam.zoom;
      this.cam.y = wy - my / this.cam.zoom;
    }, { passive: false });
    el.addEventListener("click", () => { if (this.advance) this.advance(); });
    this.dialogEl.addEventListener("click", () => this.advance?.());

    const typing = (e: KeyboardEvent) => ["INPUT", "SELECT", "TEXTAREA"].includes((e.target as HTMLElement).tagName);
    window.addEventListener("keydown", (e) => {
      if (typing(e)) return;
      if (e.code === "Space") this.spaceDown = true;
      if (this.playing) {
        if (e.code.startsWith("Arrow") || e.code === "Space" || e.code === "Enter") e.preventDefault();
        if (!e.repeat && (e.code === "Enter" || e.code === "Space" || e.code === "KeyZ")) {
          if (this.advance) this.advance(); else this.game?.interact();
        }
      } else if ((e.ctrlKey || e.metaKey) && e.code === "KeyZ") { e.preventDefault(); e.shiftKey ? this.redoEdit() : this.undoEdit(); }
      else if ((e.ctrlKey || e.metaKey) && e.code === "KeyY") { e.preventDefault(); this.redoEdit(); }
      else if ((e.code === "Delete" || e.code === "Backspace") && this.selection) this.deleteSelection();
      this.keys.add(e.code);
    });
    window.addEventListener("keyup", (e) => { if (e.code === "Space") this.spaceDown = false; this.keys.delete(e.code); });
    window.addEventListener("blur", () => this.keys.clear());
  }

  private onResize() {
    this.dpr = window.devicePixelRatio || 1;
    this.cssW = Math.max(1, this.el.clientWidth);
    this.cssH = Math.max(1, this.el.clientHeight);
    const pw = Math.round(this.cssW * this.dpr), ph = Math.round(this.cssH * this.dpr);
    this.gl.width = pw; this.gl.height = ph;
    this.renderer.resize(pw, ph);
    if (this.gl3d) { this.gl3d.width = pw; this.gl3d.height = ph; this.r3d?.resize(pw, ph); }
    this.overlay.width = pw; this.overlay.height = ph;
  }

  private inputBits() {
    const k = this.keys;
    let b = 0;
    if (k.has("ArrowUp") || k.has("KeyW")) b |= Input.Up;
    else if (k.has("ArrowDown") || k.has("KeyS")) b |= Input.Down;
    else if (k.has("ArrowLeft") || k.has("KeyA")) b |= Input.Left;
    else if (k.has("ArrowRight") || k.has("KeyD")) b |= Input.Right;
    return b;
  }

  private frame(t: number) {
    const dt = Math.min(0.1, (t - this.last) / 1000 || 0);
    this.last = t;
    const g = this.game;
    if (this.playing && g && !g.busy) {
      this.acc += dt;
      while (this.acc >= 1 / 60 && !g.busy) {
        this.acc -= 1 / 60;
        g.onTick(this.engine.tick(this.inputBits()));
      }
    }
    if (this.mode3d) {
      this.dt = dt;
      if (this.keys.has("KeyQ")) this.cam3.yaw -= dt * 1.8;
      if (this.keys.has("KeyE")) this.cam3.yaw += dt * 1.8;
      this.render3d();
    } else this.render();
    requestAnimationFrame((tt) => this.frame(tt));
  }

  /** Altura del suelo en una posición (interpolada entre casillas, para que el personaje suba/baje suavemente). */
  private groundAt(x: number, y: number) {
    const w = this.engine.width, hh = this.engine.height, t = this.engine.tiles;
    const c = (cx: number, cy: number) => {
      cx = Math.max(0, Math.min(w - 1, cx)); cy = Math.max(0, Math.min(hh - 1, cy));
      const i = cy * w + cx;
      return (TILE_HEIGHT[t[i]] ?? 0) + this.heights[i] * 0.25;
    };
    const x0 = Math.floor(x), y0 = Math.floor(y), fx = x - x0, fy = y - y0;
    const top = c(x0, y0) * (1 - fx) + c(x0 + 1, y0) * fx, bot = c(x0, y0 + 1) * (1 - fx) + c(x0 + 1, y0 + 1) * fx;
    return Math.max(0, top * (1 - fy) + bot * fy);
  }

  private npcSprite(n: Npc) {
    const dir = this.playing && this.game ? this.game.npcDir(n) : n.dir;
    return NPC_SPRITE + (n.look % 4) * 4 + dir;
  }

  private render3d() {
    const r = this.r3d;
    if (!r) return;
    if (this.world3dDirty) { r.setWorld(this.engine.tiles, this.engine.objects, this.heights, this.engine.width, this.engine.height); this.world3dDirty = false; }
    const pl = this.engine.player;
    const ents: Entity3D[] = this.map.npcs.map((n) => ({ x: n.x, y: n.y, z: this.groundAt(n.x, n.y), sprite: NPC_SPRITE + (n.look % 4) * 4, dir: this.playing && this.game ? this.game.npcDir(n) : n.dir }));
    if (this.playing) {
      ents.push({ x: pl.x, y: pl.y, z: this.groundAt(pl.x, pl.y), sprite: PLAYER_SPRITE, dir: pl.dir });
      const k = 1 - Math.exp(-this.dt * 10);
      this.cam3.x += (pl.x + 0.5 - this.cam3.x) * k;
      this.cam3.z += (pl.y + 0.5 - this.cam3.z) * k;
    } else {
      const s = this.project.start;
      if (s.map === this.map.id) ents.push({ x: s.x, y: s.y, z: this.groundAt(s.x, s.y), sprite: PLAYER_SPRITE, dir: 0 });
      this.cam3.x = this.engine.width / 2; this.cam3.z = this.engine.height / 2;
    }
    r.draw(this.cam3, ents);
    this.og.clearRect(0, 0, this.overlay.width, this.overlay.height);
  }

  private render() {
    const e = this.engine, w = e.width, hh = e.height;
    const player = e.player;
    let zoom = this.cam.zoom;
    if (this.playing) {
      zoom = Math.max(2, Math.floor(Math.min(this.cssW / (15 * TILE), this.cssH / (10 * TILE))));
      this.cam.x = (player.x + 0.5) * TILE - this.cssW / zoom / 2;
      this.cam.y = (player.y + 0.5) * TILE - this.cssH / zoom / 2;
    }
    const scale = zoom * this.dpr;
    const x0 = Math.max(0, Math.floor(this.cam.x / TILE)), y0 = Math.max(0, Math.floor(this.cam.y / TILE));
    const x1 = Math.min(w - 1, Math.ceil((this.cam.x + this.cssW / zoom) / TILE)), y1 = Math.min(hh - 1, Math.ceil((this.cam.y + this.cssH / zoom) / TILE));
    const tiles = e.tiles;
    let n = 0;
    const put = (x: number, y: number, idx: number) => { const o = n++ * 4; this.inst[o] = x; this.inst[o + 1] = y; this.inst[o + 2] = idx; this.inst[o + 3] = 0; };
    const frame = Math.floor(performance.now() / ANIM_MS) % 2;
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const g = tiles[y * w + x];
      put(x * TILE, y * TILE, frame && TILE_ANIM[g] !== undefined ? TILE_ANIM[g] : atlasIndex(g));
    }
    const objs = e.objects;
    // entidades ordenadas por Y para el solape correcto
    const ents: { y: number; px: number; py: number; idx: number }[] = [];
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) { const o = objs[y * w + x]; if (o) ents.push({ y, px: x * TILE, py: y * TILE, idx: atlasIndex(o) }); }
    ents.push(...this.map.npcs.map((k) => ({ y: k.y, px: k.x * TILE, py: k.y * TILE - 2, idx: this.npcSprite(k) })));
    if (this.playing) ents.push({ y: player.y, px: Math.round(player.x * TILE), py: Math.round(player.y * TILE) - 2, idx: PLAYER_SPRITE + player.dir });
    else if (this.project.start.map === this.map.id) ents.push({ y: this.project.start.y, px: this.project.start.x * TILE, py: this.project.start.y * TILE - 2, idx: PLAYER_SPRITE });
    ents.sort((a, b) => a.y - b.y);
    for (const k of ents) if (n < MAX_INSTANCES) put(k.px, k.py, k.idx);
    this.renderer.draw({ instances: this.inst, count: n, offsetX: this.cam.x, offsetY: this.cam.y, scale, clear: [0.07, 0.08, 0.11] });
    this.drawOverlay(zoom, x0, y0, x1, y1);
  }

  private drawOverlay(zoom: number, x0: number, y0: number, x1: number, y1: number) {
    const g = this.og, s = zoom * this.dpr, ts = TILE * s;
    g.clearRect(0, 0, this.overlay.width, this.overlay.height);
    if (this.playing) return;
    const sx = (x: number) => (x * TILE - this.cam.x) * s, sy = (y: number) => (y * TILE - this.cam.y) * s;
    if (this.showSolid) {
      g.fillStyle = "rgba(255,40,40,0.35)";
      const t = this.engine.tiles, w = this.engine.width;
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if (this.engine.isSolid(t[y * w + x])) g.fillRect(sx(x), sy(y), ts, ts);
      for (const n of this.map.npcs) g.fillRect(sx(n.x), sy(n.y), ts, ts);
    }
    if (this.showHeights || this.tool === "raise" || this.tool === "lower") {
      g.font = `bold ${Math.max(9, 11 * this.dpr * Math.min(zoom, 3) / 2)}px system-ui, sans-serif`;
      const w = this.engine.width;
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
        const hv = this.heights[y * w + x];
        if (!hv) continue;
        g.fillStyle = hv > 0 ? `rgba(255,193,7,${Math.min(0.55, 0.15 + hv * 0.05)})` : `rgba(33,150,243,${Math.min(0.55, 0.15 - hv * 0.05)})`;
        g.fillRect(sx(x), sy(y), ts, ts);
        g.fillStyle = "#fff"; g.fillText(String(hv), sx(x) + ts * 0.3, sy(y) + ts * 0.65);
      }
    }
    if (this.showGrid && zoom >= 1.5) {
      g.strokeStyle = "rgba(255,255,255,0.18)";
      g.lineWidth = 1;
      g.beginPath();
      for (let x = x0; x <= x1 + 1; x++) { const X = Math.round(sx(x)) + 0.5; g.moveTo(X, sy(y0)); g.lineTo(X, sy(y1 + 1)); }
      for (let y = y0; y <= y1 + 1; y++) { const Y = Math.round(sy(y)) + 0.5; g.moveTo(sx(x0), Y); g.lineTo(sx(x1 + 1), Y); }
      g.stroke();
    }
    g.strokeStyle = "#ffd54f"; g.lineWidth = 2;
    g.strokeRect(sx(0), sy(0), this.engine.width * ts, this.engine.height * ts);
    const st = this.project.start;
    if (st.map === this.map.id) { g.strokeStyle = "#4fc3f7"; g.lineWidth = 2; g.strokeRect(sx(st.x) + 1, sy(st.y) + 1, ts - 2, ts - 2); }
    // saltos
    g.font = `bold ${Math.max(9, 10 * this.dpr * Math.min(zoom, 3) / 2)}px system-ui, sans-serif`;
    this.map.warps.forEach((wp, i) => {
      g.fillStyle = "rgba(171,71,188,0.45)"; g.fillRect(sx(wp.x), sy(wp.y), ts, ts);
      g.strokeStyle = this.selection?.kind === "warp" && this.selection.index === i ? "#fff" : "#ce93d8"; g.lineWidth = 2;
      g.strokeRect(sx(wp.x) + 1, sy(wp.y) + 1, ts - 2, ts - 2);
      g.fillStyle = "#fff"; g.fillText("↦", sx(wp.x) + ts * 0.3, sy(wp.y) + ts * 0.7);
    });
    (this.map.triggers ?? []).forEach((t, i) => {
      const sel = this.selection?.kind === "trigger" && this.selection.index === i;
      g.fillStyle = "rgba(255,193,7,0.28)"; g.fillRect(sx(t.x), sy(t.y), ts, ts);
      g.strokeStyle = sel ? "#fff" : "#ffca28"; g.lineWidth = sel ? 3 : 1.5; g.setLineDash([4, 3]);
      g.strokeRect(sx(t.x) + 1, sy(t.y) + 1, ts - 2, ts - 2); g.setLineDash([]);
      g.fillStyle = "#fff"; g.fillText("⚡", sx(t.x) + ts * 0.25, sy(t.y) + ts * 0.7);
    });
    this.map.npcs.forEach((n, i) => {
      const sel = this.selection?.kind === "npc" && this.selection.index === i;
      g.strokeStyle = sel ? "#fff" : n.kind === "trainer" ? "#ff8a65" : n.kind === "healer" ? "#81c784" : "#fff59d";
      g.lineWidth = sel ? 3 : 1.5;
      g.strokeRect(sx(n.x) + 1, sy(n.y) + 1, ts - 2, ts - 2);
    });
    if (this.hover && this.inMap(this.hover.x, this.hover.y)) {
      g.fillStyle = "rgba(255,255,255,0.22)";
      g.fillRect(sx(this.hover.x), sy(this.hover.y), ts, ts);
      const def = TILE_DEFS[this.engine.getTile(this.hover.x, this.hover.y)];
      g.font = `${12 * this.dpr}px system-ui, sans-serif`;
      g.fillStyle = "#fff";
      g.fillText(`(${this.hover.x}, ${this.hover.y}) ${def?.name ?? ""}`, 10 * this.dpr, this.overlay.height - 10 * this.dpr);
    }
  }
}
