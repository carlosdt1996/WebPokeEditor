/** Reglas de juego en ejecución: NPCs, saltos entre mapas, entrenadores, encuentros y combates. */
import { sfx } from "./audio";
import { Battle, type Mon, healAll, makeMon } from "./battle";
import { type ScriptCtx, parseScript, runScript } from "./script";
import { type Engine, Ev } from "./engine";
import type { GameMap, Npc, Project, Trigger } from "./project";

export interface Host {
  /** Carga el mapa `index` en el motor (con bloqueadores de NPC) y coloca al jugador. */
  loadMap(index: number, x: number, y: number): void;
  dialog(speaker: string | null, lines: string[]): Promise<void>;
  battle(b: Battle): Promise<void>;
  say(msg: string): void;
  /** Menú de opciones; devuelve el índice elegido. */
  choose(options: string[]): Promise<number>;
}

const DIRS = [[0, 1], [0, -1], [-1, 0], [1, 0]]; // abajo, arriba, izq, der
const OPPOSITE = [1, 0, 3, 2];

export class Game {
  party: Mon[];
  inv: Record<string, number>;
  defeated = new Set<string>();
  mapIndex = 0;
  /** true mientras hay diálogo/combate/transición: el bucle no avanza la simulación. */
  busy = false;
  private npcDirs = new Map<string, number>();
  private fired = new Set<string>();

  constructor(private p: Project, private e: Engine, private host: Host) {
    this.party = p.party.map((t) => makeMon(p, t.species, t.level));
    this.inv = { ...p.inventory };
    e.flagsReset();
  }

  get map(): GameMap { return this.p.maps[this.mapIndex]; }
  start() {
    const i = Math.max(0, this.p.maps.findIndex((m) => m.id === this.p.start.map));
    this.mapIndex = i;
    this.host.loadMap(i, this.p.start.x, this.p.start.y);
    void this.run(() => this.runMapEnter());
  }

  private enterDepth = 0;
  /** Ejecuta el script "al entrar" del mapa actual (si lo tiene). Acotado para evitar warps encadenados infinitos. */
  private async runMapEnter() {
    const src = this.map.onEnter?.trim();
    if (!src || this.enterDepth >= 5) return;
    const r = parseScript(src);
    if (!r.ok) { this.host.say(`Script de entrada de ${this.map.name} con errores: ${r.errors[0]}`); return; }
    this.enterDepth++;
    try { this.refreshBuiltins(); await runScript(r.code, this.scriptCtx(null, null), this.e); }
    catch (err) { this.host.say((err as Error).message); }
    finally { this.enterDepth--; }
  }
  npcDir(n: Npc) { return this.npcDirs.get(this.map.id + "/" + n.id) ?? n.dir; }
  private key(n: Npc) { return this.map.id + "/" + n.id; }
  private npcAt(x: number, y: number) { return this.map.npcs.find((n) => n.x === x && n.y === y); }

  private async run<T>(f: () => Promise<T>): Promise<T> {
    this.busy = true;
    try { return await f(); } finally { this.busy = false; }
  }

  /** Llamar tras cada tick con los eventos devueltos por el núcleo. */
  onTick(ev: number) {
    if (this.busy) return;
    if (ev & Ev.Blocked) sfx("bump");
    if (!(ev & Ev.Step)) return;
    sfx("step");
    void this.run(async () => {
      const { x, y } = this.e.cell;
      const warp = this.map.warps.find((w) => w.x === x && w.y === y);
      if (warp) { await this.warpTo(warp.toMap, warp.toX, warp.toY); return; }
      const trig = (this.map.triggers ?? []).find((t) => t.x === x && t.y === y && !(t.once && this.fired.has(this.trigKey(t))));
      if (trig) { this.fired.add(this.trigKey(trig)); await this.runTrigger(trig); return; }
      const spotter = this.map.npcs.find((n) => n.kind === "trainer" && !this.defeated.has(this.key(n)) && this.sees(n, x, y));
      if (spotter) { await this.challenge(spotter); return; }
      if (ev & Ev.Encounter) await this.wildEncounter();
    });
  }

  private trigKey(t: Trigger) { return `${this.map.id}/${t.x},${t.y}`; }

  /** Variables que los scripts pueden leer: pasos dados, tamaño del equipo y nivel de la primera criatura. */
  private refreshBuiltins() {
    this.e.setVar("steps", this.e.steps);
    this.e.setVar("party", this.party.length);
    this.e.setVar("level", this.party[0]?.level ?? 0);
  }

  private async runTrigger(t: Trigger) {
    const r = parseScript(t.script);
    if (!r.ok) { this.host.say(`Disparador "${t.name}" con errores: ${r.errors[0]}`); return; }
    this.refreshBuiltins();
    try { await runScript(r.code, this.scriptCtx(null, t.name), this.e); }
    catch (err) { this.host.say((err as Error).message); }
  }

  private sees(n: Npc, px: number, py: number) {
    const [dx, dy] = DIRS[this.npcDir(n)] ?? [0, 1];
    for (let i = 1; i <= 4; i++) {
      const x = n.x + dx * i, y = n.y + dy * i;
      if (x === px && y === py) return true;
      if (!this.e.walkable(x, y)) return false;
    }
    return false;
  }

  async warpTo(mapId: string, x: number, y: number) {
    const i = this.p.maps.findIndex((m) => m.id === mapId);
    if (i < 0) return;
    sfx("warp");
    this.mapIndex = i;
    this.host.loadMap(i, x, y);
    this.host.say(`Entras en ${this.map.name}.`);
    await this.runMapEnter();
  }

  /** Interactuar con la celda que se tiene delante. */
  interact() {
    if (this.busy) return;
    const pl = this.e.player;
    if (pl.moving) return;
    const { x, y } = this.e.cell;
    const [dx, dy] = DIRS[pl.dir] ?? [0, 1];
    const npc = this.npcAt(x + dx, y + dy);
    if (!npc) return;
    void this.run(async () => {
      this.npcDirs.set(this.key(npc), OPPOSITE[pl.dir]);
      sfx("select");
      if (npc.kind === "healer") {
        await this.host.dialog(npc.name, npc.lines.slice(0, 1));
        healAll(this.p, this.party);
        sfx("heal");
        await this.host.dialog(npc.name, npc.lines.slice(1).length ? npc.lines.slice(1) : ["¡Listo!"]);
      } else if (npc.kind === "trainer") {
        if (this.defeated.has(this.key(npc))) await this.host.dialog(npc.name, npc.defeatedLines?.length ? npc.defeatedLines : ["..."]);
        else await this.challenge(npc);
      } else if (npc.kind === "script") {
        const r = parseScript(npc.script ?? "");
        if (r.ok) { this.refreshBuiltins(); try { await runScript(r.code, this.scriptCtx(npc), this.e); } catch (err) { this.host.say((err as Error).message); } }
        else this.host.say(`Script de ${npc.name} con errores: ${r.errors[0]}`);
      } else await this.host.dialog(npc.name, npc.lines.length ? npc.lines : ["..."]);
    });
  }

  private scriptCtx(npc: Npc | null, speaker = npc?.name ?? null): ScriptCtx {
    return {
      say: (lines) => this.host.dialog(speaker, lines),
      give: (item, n) => { this.inv[item] = (this.inv[item] ?? 0) + n; sfx("heal"); this.host.say(`Recibes ${n} × ${this.p.items.find((i) => i.id === item)?.name ?? item}.`); },
      heal: () => { healAll(this.p, this.party); sfx("heal"); },
      battle: async (sp, lv) => { await this.fight([makeMon(this.p, sp, lv)]); },
      givemon: (sp, lv) => { if (this.party.length < 6) { this.party.push(makeMon(this.p, sp, lv)); sfx("catch"); this.host.say("¡Un nuevo compañero se une a tu equipo!"); } },
      warp: (m, x, y) => this.warpTo(m, x, y),
      choose: (o) => this.host.choose(o),
    };
  }

  private async challenge(n: Npc) {
    this.npcDirs.set(this.key(n), n.x === this.e.cell.x ? (this.e.cell.y > n.y ? 0 : 1) : (this.e.cell.x > n.x ? 3 : 2));
    await this.host.dialog(n.name, n.lines.length ? n.lines : ["¡Combatamos!"]);
    const foes = (n.team ?? []).map((t) => makeMon(this.p, t.species, t.level));
    if (!foes.length) return;
    const res = await this.fight(foes, n.name, n.double);
    if (res === "win") {
      this.defeated.add(this.key(n));
      await this.host.dialog(n.name, n.defeatedLines?.length ? n.defeatedLines : ["Me has vencido."]);
    }
  }

  private async wildEncounter() {
    const enc = this.map.encounters;
    if (!enc.length) return;
    const id = enc[this.e.rand(enc.length)];
    const [lo, hi] = this.map.encounterLevel;
    const lvl = lo + this.e.rand(Math.max(1, hi - lo + 1));
    await this.fight([makeMon(this.p, id, lvl)]);
  }

  private async fight(foes: Mon[], trainer?: string, double?: boolean) {
    if (!this.party.some((m) => m.hp > 0)) healAll(this.p, this.party);
    const b = new Battle(this.p, this.e, this.party, foes, { trainer, double, inv: this.inv });
    await this.host.battle(b);
    if (b.result === "lose") {
      healAll(this.p, this.party);
      await this.host.dialog(null, ["Todo se vuelve negro...", "Te llevan de vuelta al inicio y curan a tu equipo."]);
      this.mapIndex = Math.max(0, this.p.maps.findIndex((m) => m.id === this.p.start.map));
      this.host.loadMap(this.mapIndex, this.p.start.x, this.p.start.y);
      await this.runMapEnter();
    }
    return b.result;
  }
}
