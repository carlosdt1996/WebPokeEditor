/** Reglas de juego en ejecución: NPCs, saltos entre mapas, entrenadores, encuentros y combates. */
import { sfx } from "./audio";
import { t as tr } from "./i18n";
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
  /** Dinero del jugador; los scripts lo ven como la variable `money`. */
  money: number;
  defeated = new Set<string>();
  mapIndex = 0;
  /** true mientras hay diálogo/combate/transición: el bucle no avanza la simulación. */
  busy = false;
  private npcDirs = new Map<string, number>();
  private fired = new Set<string>();

  constructor(private p: Project, private e: Engine, private host: Host) {
    this.party = p.party.map((t) => makeMon(p, t.species, t.level, t.held));
    this.inv = { ...p.inventory };
    this.money = p.money ?? 0;
    e.flagsReset();
  }

  get map(): GameMap { return this.p.maps[this.mapIndex]; }
  start() {
    const i = Math.max(0, this.p.maps.findIndex((m) => m.id === this.p.start.map));
    this.mapIndex = i;
    this.host.loadMap(i, this.p.start.x, this.p.start.y);
    void this.run(() => this.runMapEnter());
  }

  private async runMapExit() {
    const src = this.map.onExit?.trim();
    if (!src || this.enterDepth >= 5) return;
    const r = parseScript(src);
    if (!r.ok) { this.host.say(`Script de salida de ${this.map.name} con errores: ${r.errors[0]}`); return; }
    this.enterDepth++;
    try { await this.exec(r.code, this.scriptCtx(null, null)); }
    catch (err) { this.host.say((err as Error).message); }
    finally { this.enterDepth--; }
  }

  private enterDepth = 0;
  /** Ejecuta el script "al entrar" del mapa actual (si lo tiene). Acotado para evitar warps encadenados infinitos. */
  private async runMapEnter() {
    const src = this.map.onEnter?.trim();
    if (!src || this.enterDepth >= 5) return;
    const r = parseScript(src);
    if (!r.ok) { this.host.say(`Script de entrada de ${this.map.name} con errores: ${r.errors[0]}`); return; }
    this.enterDepth++;
    try { await this.exec(r.code, this.scriptCtx(null, null)); }
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
    this.e.setVar("money", this.money);
    for (const it of this.p.items) this.e.setVar("item_" + it.id, this.inv[it.id] ?? 0);
  }

  /** Ejecuta un guion con las variables predefinidas al día y vuelve a leer el dinero (los guiones lo modifican con `add money`). */
  private async exec(code: Parameters<typeof runScript>[0], ctx: ScriptCtx) {
    this.refreshBuiltins();
    try { await runScript(code, ctx, this.e); }
    finally { this.money = Math.max(0, this.e.getVar("money")); }
  }

  private async runTrigger(t: Trigger) {
    const r = parseScript(t.script);
    if (!r.ok) { this.host.say(`Disparador "${t.name}" con errores: ${r.errors[0]}`); return; }
    try { await this.exec(r.code, this.scriptCtx(null, null)); }
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
    await this.runMapExit();
    sfx("warp");
    this.mapIndex = i;
    this.host.loadMap(i, x, y);
    this.host.say(tr("Entras en {0}.", this.map.name));
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
        await this.host.dialog(npc.name, npc.lines.slice(1).length ? npc.lines.slice(1) : [tr("¡Listo!")]);
      } else if (npc.kind === "shop") {
        await this.shop(npc);
      } else if (npc.kind === "trainer") {
        if (this.defeated.has(this.key(npc))) await this.host.dialog(npc.name, npc.defeatedLines?.length ? npc.defeatedLines : ["..."]);
        else await this.challenge(npc);
      } else if (npc.kind === "script") {
        const r = parseScript(npc.script ?? "");
        if (r.ok) { try { await this.exec(r.code, this.scriptCtx(npc)); } catch (err) { this.host.say((err as Error).message); } }
        else this.host.say(`Script de ${npc.name} con errores: ${r.errors[0]}`);
      } else await this.host.dialog(npc.name, npc.lines.length ? npc.lines : ["..."]);
    });
  }

  private scriptCtx(npc: Npc | null, speaker = npc?.name ?? null): ScriptCtx {
    return {
      say: (lines) => this.host.dialog(speaker, lines),
      give: (item, n) => { this.inv[item] = (this.inv[item] ?? 0) + n; this.e.setVar("item_" + item, this.inv[item]); sfx("heal"); this.host.say(tr("Recibes {0} × {1}.", n, this.p.items.find((i) => i.id === item)?.name ?? item)); },
      heal: () => { healAll(this.p, this.party); sfx("heal"); },
      battle: async (sp, lv) => { await this.fight([makeMon(this.p, sp, lv)]); },
      givemon: (sp, lv) => { if (this.party.length < 6) { this.party.push(makeMon(this.p, sp, lv)); sfx("catch"); this.host.say(tr("¡Un nuevo compañero se une a tu equipo!")); } },
      warp: (m, x, y) => this.warpTo(m, x, y),
      choose: (o) => this.host.choose(o),
      equip: (item) => this.equip(item),
    };
  }

  /** Tienda: comprar (a precio de lista) y vender (a la mitad; los objetos clave no se venden). */
  async shop(npc: Npc) {
    const def = (id: string) => this.p.items.find((i) => i.id === id);
    const stock = (npc.stock ?? []).map(def).filter((i): i is NonNullable<typeof i> => !!i && (i.price ?? 0) > 0);
    await this.host.dialog(npc.name, [npc.lines[0] ?? tr("¡Bienvenido! ¿Qué te pongo?")]);
    for (;;) {
      const top = await this.host.choose([tr("Comprar"), tr("Vender"), tr("Salir  ({0} monedas)", this.money)]);
      if (top === 0) {
        const k = await this.host.choose([...stock.map((i) => `${i.name} (${i.price})`), tr("Volver")]);
        const it = stock[k];
        if (!it) continue;
        if (this.money < it.price!) { await this.host.dialog(npc.name, [tr("No tienes suficientes monedas.")]); continue; }
        this.money -= it.price!;
        this.inv[it.id] = (this.inv[it.id] ?? 0) + 1;
        sfx("heal");
        await this.host.dialog(npc.name, [tr("¡Gracias por tu compra de {0}!", it.name)]);
      } else if (top === 1) {
        const mine = this.p.items.filter((i) => i.kind !== "key" && (i.price ?? 0) > 0 && (this.inv[i.id] ?? 0) > 0);
        if (!mine.length) { await this.host.dialog(npc.name, [tr("No tienes nada que pueda comprarte.")]); continue; }
        const k = await this.host.choose([...mine.map((i) => `${i.name} ×${this.inv[i.id]} (${Math.floor(i.price! / 2)})`), tr("Volver")]);
        const it = mine[k];
        if (!it) continue;
        this.inv[it.id]--;
        this.money += Math.floor(it.price! / 2);
        sfx("heal");
        await this.host.dialog(npc.name, [tr("Te compro {0} por {1} monedas.", it.name, Math.floor(it.price! / 2))]);
      } else {
        await this.host.dialog(npc.name, [tr("¡Vuelve cuando quieras!")]);
        return;
      }
    }
  }

  /** Equipa un objeto del inventario a la primera criatura sin objeto (si todas llevan uno, cambia el de la primera). */
  private equip(itemId: string) {
    const def = this.p.items.find((i) => i.id === itemId);
    if (!def || def.kind !== "held") { this.host.say(tr("«{0}» no es un objeto equipable.", itemId)); return; }
    if ((this.inv[itemId] ?? 0) <= 0) { this.host.say(tr("No tienes {0}.", def.name)); return; }
    const target = this.party.find((m) => !m.held) ?? this.party[0];
    if (!target) return;
    if (target.held) this.inv[target.held] = (this.inv[target.held] ?? 0) + 1;
    this.inv[itemId]--;
    target.held = itemId;
    sfx("heal");
    this.host.say(tr("{0} lleva ahora {1}.", this.p.species.find((s) => s.id === target.species)?.name ?? tr("La criatura"), def.name));
  }

  private async challenge(n: Npc) {
    this.npcDirs.set(this.key(n), n.x === this.e.cell.x ? (this.e.cell.y > n.y ? 0 : 1) : (this.e.cell.x > n.x ? 3 : 2));
    await this.host.dialog(n.name, n.lines.length ? n.lines : [tr("¡Combatamos!")]);
    const foes = (n.team ?? []).map((t) => makeMon(this.p, t.species, t.level, t.held));
    if (!foes.length) return;
    const res = await this.fight(foes, n.name, n.double);
    if (res === "win") {
      this.defeated.add(this.key(n));
      await this.host.dialog(n.name, n.defeatedLines?.length ? n.defeatedLines : [tr("Me has vencido.")]);
      const r = n.winScript ? parseScript(n.winScript) : null;
      if (r?.ok) { try { await this.exec(r.code, this.scriptCtx(n)); } catch (err) { this.host.say((err as Error).message); } }
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
    if (!this.party.length) { await this.host.dialog(null, [tr("Todavía no tienes ninguna criatura que combata por ti.")]); return null; }
    if (!this.party.some((m) => m.hp > 0)) healAll(this.p, this.party);
    const b = new Battle(this.p, this.e, this.party, foes, { trainer, double, weather: this.map.weather, inv: this.inv });
    await this.host.battle(b);
    if (b.result === "lose") {
      healAll(this.p, this.party);
      await this.host.dialog(null, [tr("Todo se vuelve negro..."), tr("Te llevan de vuelta al inicio y curan a tu equipo.")]);
      this.mapIndex = Math.max(0, this.p.maps.findIndex((m) => m.id === this.p.start.map));
      this.host.loadMap(this.mapIndex, this.p.start.x, this.p.start.y);
      await this.runMapEnter();
    }
    return b.result;
  }
}
