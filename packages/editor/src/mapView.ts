import { h } from "./dom";
import { Engine, Ev, Input } from "./engine";
import { type Project, decodeTiles } from "./project";
import { createRenderer, type Renderer } from "./renderer";
import { MAX_INSTANCES } from "./renderer/types";
import { PLAYER_SPRITE, TILE, TILE_DEFS, createAtlas } from "./tiles";

export type Tool = "paint" | "fill" | "pick" | "spawn";

interface Edit { idx: number; from: number; to: number }

export class MapView {
  readonly el = h("div", { class: "viewport" });
  tool: Tool = "paint";
  tile = 1;
  showSolid = false;
  showGrid = true;
  playing = false;
  onEdit: () => void = () => {};
  onPick: (t: number) => void = () => {};
  onMessage: (m: string) => void = () => {};
  onEncounter: (speciesId: string | null) => void = () => {};
  rendererKind = "";

  private renderer!: Renderer;
  private gl!: HTMLCanvasElement;
  private overlay = h("canvas", { class: "overlay" });
  private dialog = h("div", { class: "dialog", hidden: true });
  private og = this.overlay.getContext("2d")!;
  private cam = { x: 0, y: 0, zoom: 3 };
  private dpr = 1;
  private cssW = 1;
  private cssH = 1;
  private inst = new Float32Array(MAX_INSTANCES * 4);
  private hover: { x: number; y: number } | null = null;
  private spawn = { x: 0, y: 0 };
  private undo: Edit[][] = [];
  private redo: Edit[][] = [];
  private stroke: Map<number, Edit> | null = null;
  private pan: { x: number; y: number; cx: number; cy: number } | null = null;
  private spaceDown = false;
  private keys = new Set<string>();
  private acc = 0;
  private last = 0;
  private paused = false;
  private project!: Project;

  constructor(private engine: Engine) {}

  async init(project: Project) {
    const { renderer, canvas } = await createRenderer(this.el);
    this.renderer = renderer;
    this.gl = canvas;
    this.rendererKind = renderer.kind;
    renderer.setAtlas(createAtlas());
    this.el.append(this.overlay, this.dialog);
    this.setProject(project);
    this.bind();
    new ResizeObserver(() => this.onResize()).observe(this.el);
    this.onResize();
    this.fit();
    requestAnimationFrame((t) => this.frame(t));
  }

  /** Carga el mapa de un proyecto en el motor. */
  setProject(p: Project) {
    this.project = p;
    const { w, h: hh, tiles, spawn } = p.map;
    this.engine.loadMap(w, hh, decodeTiles(tiles, w * hh), p.seed);
    this.spawn = { ...spawn };
    this.engine.setSpawn(spawn.x, spawn.y);
    this.undo = []; this.redo = [];
    this.stopPlay();
  }

  /** Vuelca el mapa del motor al proyecto. */
  syncTo(p: Project) {
    p.map.w = this.engine.width;
    p.map.h = this.engine.height;
    p.map.spawn = { ...this.spawn };
  }

  resizeMap(w: number, hh: number) {
    const ow = this.engine.width, oh = this.engine.height;
    const old = this.engine.tiles.slice();
    const next = new Uint8Array(w * hh);
    for (let y = 0; y < Math.min(oh, hh); y++) for (let x = 0; x < Math.min(ow, w); x++) next[y * w + x] = old[y * ow + x];
    this.engine.loadMap(w, hh, next, this.project.seed);
    this.spawn = { x: Math.min(this.spawn.x, w - 1), y: Math.min(this.spawn.y, hh - 1) };
    this.engine.setSpawn(this.spawn.x, this.spawn.y);
    this.undo = []; this.redo = [];
    this.onEdit();
  }

  fit() {
    const mw = this.engine.width * TILE, mh = this.engine.height * TILE;
    this.cam.zoom = Math.max(1, Math.min(8, Math.floor(Math.min(this.cssW / mw, this.cssH / mh) * 4) / 4)) || 2;
    this.cam.x = mw / 2 - this.cssW / this.cam.zoom / 2;
    this.cam.y = mh / 2 - this.cssH / this.cam.zoom / 2;
  }

  // ----- Jugar -----
  startPlay() {
    this.engine.setSpawn(this.spawn.x, this.spawn.y);
    this.playing = true;
    this.paused = false;
    this.acc = 0;
    this.hideDialog();
    this.onMessage("Modo prueba: mueve con flechas / WASD. Hierba alta = encuentros.");
  }
  stopPlay() {
    this.playing = false;
    this.paused = false;
    this.hideDialog();
    this.engine.setSpawn(this.spawn.x, this.spawn.y);
  }

  private showDialog(text: string) {
    this.dialog.textContent = text + "  ▼";
    this.dialog.hidden = false;
    this.paused = true;
  }
  private hideDialog() {
    this.dialog.hidden = true;
    this.paused = false;
  }

  // ----- Edición -----
  undoEdit() { this.applyHistory(this.undo, this.redo, "from"); }
  redoEdit() { this.applyHistory(this.redo, this.undo, "to"); }
  private applyHistory(from: Edit[][], to: Edit[][], key: "from" | "to") {
    const s = from.pop();
    if (!s) return;
    for (const e of s) this.engine.tiles[e.idx] = e[key];
    to.push(s);
    this.onEdit();
  }

  private setTileTracked(x: number, y: number, t: number) {
    const w = this.engine.width;
    if (x < 0 || y < 0 || x >= w || y >= this.engine.height) return;
    const idx = y * w + x;
    const cur = this.engine.tiles[idx];
    if (cur === t) return;
    const prev = this.stroke!.get(idx);
    this.stroke!.set(idx, { idx, from: prev ? prev.from : cur, to: t });
    this.engine.tiles[idx] = t;
  }

  private flood(sx: number, sy: number, t: number) {
    const w = this.engine.width, hh = this.engine.height;
    if (sx < 0 || sy < 0 || sx >= w || sy >= hh) return;
    const target = this.engine.tiles[sy * w + sx];
    if (target === t) return;
    const stack = [[sx, sy]];
    while (stack.length) {
      const [x, y] = stack.pop()!;
      if (x < 0 || y < 0 || x >= w || y >= hh || this.engine.tiles[y * w + x] !== target) continue;
      this.setTileTracked(x, y, t);
      stack.push([x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]);
    }
  }

  private toTile(e: PointerEvent) {
    const r = this.el.getBoundingClientRect();
    const wx = this.cam.x + (e.clientX - r.left) / this.cam.zoom;
    const wy = this.cam.y + (e.clientY - r.top) / this.cam.zoom;
    return { x: Math.floor(wx / TILE), y: Math.floor(wy / TILE) };
  }

  private act(e: PointerEvent, first: boolean) {
    const { x, y } = this.toTile(e);
    if (this.tool === "paint") this.setTileTracked(x, y, this.tile);
    else if (first && this.tool === "fill") this.flood(x, y, this.tile);
    else if (first && this.tool === "pick") {
      if (x >= 0 && y >= 0 && x < this.engine.width && y < this.engine.height) this.onPick(this.engine.getTile(x, y));
    } else if (first && this.tool === "spawn") {
      if (x >= 0 && y >= 0 && x < this.engine.width && y < this.engine.height) {
        this.spawn = { x, y };
        this.engine.setSpawn(x, y);
        this.onEdit();
      }
    }
  }

  private bind() {
    const el = this.overlay;
    el.addEventListener("contextmenu", (e) => e.preventDefault());
    el.addEventListener("pointerdown", (e) => {
      if (this.playing) return;
      el.setPointerCapture(e.pointerId);
      if (e.button === 1 || e.button === 2 || this.spaceDown) {
        this.pan = { x: e.clientX, y: e.clientY, cx: this.cam.x, cy: this.cam.y };
        return;
      }
      if (e.button !== 0) return;
      this.stroke = new Map();
      this.act(e, true);
    });
    el.addEventListener("pointermove", (e) => {
      this.hover = this.toTile(e);
      if (this.pan) {
        this.cam.x = this.pan.cx - (e.clientX - this.pan.x) / this.cam.zoom;
        this.cam.y = this.pan.cy - (e.clientY - this.pan.y) / this.cam.zoom;
      } else if (this.stroke) this.act(e, false);
    });
    const end = () => {
      this.pan = null;
      if (this.stroke) {
        if (this.stroke.size) { this.undo.push([...this.stroke.values()]); this.redo = []; this.onEdit(); }
        this.stroke = null;
      }
    };
    el.addEventListener("pointerup", end);
    el.addEventListener("pointercancel", end);
    el.addEventListener("pointerleave", () => (this.hover = null));
    el.addEventListener("wheel", (e) => {
      if (this.playing) return;
      e.preventDefault();
      const r = this.el.getBoundingClientRect();
      const mx = e.clientX - r.left, my = e.clientY - r.top;
      const wx = this.cam.x + mx / this.cam.zoom, wy = this.cam.y + my / this.cam.zoom;
      this.cam.zoom = Math.min(10, Math.max(0.5, this.cam.zoom * (e.deltaY < 0 ? 1.15 : 1 / 1.15)));
      this.cam.x = wx - mx / this.cam.zoom;
      this.cam.y = wy - my / this.cam.zoom;
    }, { passive: false });
    el.addEventListener("click", () => { if (this.playing && this.paused) this.hideDialog(); });

    const typing = (e: KeyboardEvent) => ["INPUT", "SELECT", "TEXTAREA"].includes((e.target as HTMLElement).tagName);
    window.addEventListener("keydown", (e) => {
      if (typing(e)) return;
      if (e.code === "Space") this.spaceDown = true;
      if (this.playing) {
        if ((e.code === "Enter" || e.code === "Space" || e.code === "KeyZ") && this.paused) this.hideDialog();
        if (e.code.startsWith("Arrow") || e.code === "Space") e.preventDefault();
      } else if ((e.ctrlKey || e.metaKey) && e.code === "KeyZ") { e.preventDefault(); e.shiftKey ? this.redoEdit() : this.undoEdit(); }
      else if ((e.ctrlKey || e.metaKey) && e.code === "KeyY") { e.preventDefault(); this.redoEdit(); }
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
    if (this.playing && !this.paused) {
      this.acc += dt;
      while (this.acc >= 1 / 60) {
        this.acc -= 1 / 60;
        const ev = this.engine.tick(this.inputBits());
        if (ev & Ev.Encounter) {
          const enc = this.project.encounters;
          const id = enc.length ? enc[this.engine.rand(enc.length)] : null;
          const sp = this.project.species.find((s) => s.id === id);
          const lvl = 3 + this.engine.rand(5);
          this.showDialog(sp ? `¡Un ${sp.name} salvaje (Nv. ${lvl}) apareció!` : "¡Algo se movió en la hierba!");
          this.onEncounter(sp?.id ?? null);
          break;
        }
      }
    }
    this.render();
    requestAnimationFrame((tt) => this.frame(tt));
  }

  private render() {
    const e = this.engine, w = e.width, hh = e.height;
    const player = e.player;
    // Cámara
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
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const o = n++ * 4;
      this.inst[o] = x * TILE; this.inst[o + 1] = y * TILE; this.inst[o + 2] = tiles[y * w + x]; this.inst[o + 3] = 0;
    }
    const px = this.playing ? player.x : this.spawn.x, py = this.playing ? player.y : this.spawn.y;
    const o = n++ * 4;
    this.inst[o] = Math.round(px * TILE); this.inst[o + 1] = Math.round(py * TILE) - 2; this.inst[o + 2] = PLAYER_SPRITE + (this.playing ? player.dir : 0); this.inst[o + 3] = 0;
    this.renderer.draw({
      instances: this.inst, count: n,
      offsetX: this.cam.x, offsetY: this.cam.y, scale,
      clear: [0.07, 0.08, 0.11],
    });
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
    }
    if (this.showGrid && zoom >= 1.5) {
      g.strokeStyle = "rgba(255,255,255,0.18)";
      g.lineWidth = 1;
      g.beginPath();
      for (let x = x0; x <= x1 + 1; x++) { const X = Math.round(sx(x)) + 0.5; g.moveTo(X, sy(y0)); g.lineTo(X, sy(y1 + 1)); }
      for (let y = y0; y <= y1 + 1; y++) { const Y = Math.round(sy(y)) + 0.5; g.moveTo(sx(x0), Y); g.lineTo(sx(x1 + 1), Y); }
      g.stroke();
    }
    // Borde del mapa
    g.strokeStyle = "#ffd54f"; g.lineWidth = 2;
    g.strokeRect(sx(0), sy(0), this.engine.width * ts, this.engine.height * ts);
    // Marca de inicio
    g.strokeStyle = "#4fc3f7"; g.lineWidth = 2;
    g.strokeRect(sx(this.spawn.x) + 1, sy(this.spawn.y) + 1, ts - 2, ts - 2);
    // Hover
    if (this.hover && this.hover.x >= 0 && this.hover.y >= 0 && this.hover.x < this.engine.width && this.hover.y < this.engine.height) {
      g.fillStyle = "rgba(255,255,255,0.22)";
      g.fillRect(sx(this.hover.x), sy(this.hover.y), ts, ts);
      const def = TILE_DEFS[this.engine.getTile(this.hover.x, this.hover.y)];
      g.font = `${12 * this.dpr}px system-ui, sans-serif`;
      g.fillStyle = "#fff";
      g.fillText(`(${this.hover.x}, ${this.hover.y}) ${def?.name ?? ""}`, 10 * this.dpr, this.overlay.height - 10 * this.dpr);
    }
  }
}
