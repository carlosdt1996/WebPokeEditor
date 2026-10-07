/**
 * Combate por turnos (1v1 o 2v2). La simulación vive en Rust (`crates/engine-core/src/battle.rs`):
 * este módulo carga los datos del proyecto en la memoria WASM, envía las acciones, y traduce la lista de
 * eventos devuelta a texto en español. Es reproducible por semilla (usa el mismo RNG que el mundo).
 */
import type { Engine } from "./engine";
import { LIMITS, type Move, type Project, maxHp } from "./project";

export interface Mon { species: string; level: number; hp: number; exp: number; moves: string[] }

export type Action =
  | { kind: "move"; index: number; /** slot rival (0/1); por defecto el primero en pie */ target?: number }
  | { kind: "switch"; to: number }
  | { kind: "item"; id: string }
  | { kind: "run" };

export type BattleResult = "win" | "lose" | "run" | "caught";

export interface SlotSnap { i: number; hp: number }
/** Estado visible tras cada evento: criatura (índice en su equipo) y PS por casilla activa; null = casilla vacía. */
export interface Snapshot { p: (SlotSnap | null)[]; f: (SlotSnap | null)[] }
export interface BattleEvent {
  text: string; snap: Snapshot; target?: { side: "p" | "f"; slot: number };
  sfx?: "hit" | "super" | "weak" | "faint" | "levelup" | "catch" | "heal" | "miss";
}

export { LIMITS };

const expFor = (level: number) => level * level * 2;

export function makeMon(p: Project, speciesId: string, level: number): Mon {
  const sp = p.species.find((s) => s.id === speciesId);
  if (!sp) throw new Error(`Especie inexistente: ${speciesId}`);
  const m: Mon = { species: speciesId, level, hp: 0, exp: expFor(level), moves: sp.moves.slice(0, 4) };
  if (!m.moves.length && p.moves[0]) m.moves = [p.moves[0].id];
  m.hp = monMaxHp(p, m);
  return m;
}
const spOf = (p: Project, m: Mon) => p.species.find((s) => s.id === m.species)!;
export const monMaxHp = (p: Project, m: Mon) => maxHp(spOf(p, m).stats.hp, m.level);
export const monName = (p: Project, m: Mon) => spOf(p, m).name;
export const healAll = (p: Project, party: Mon[]) => party.forEach((m) => (m.hp = monMaxHp(p, m)));

// Códigos del protocolo con Rust (deben coincidir con battle.rs)
const A = { move: 1, switch: 2, heal: 3, ball: 4, run: 5, noitem: 6 };
const E = { use: 1, miss: 2, hit: 3, faint: 4, exp: 5, level: 6, learn: 7, evolve: 8, sendout: 9, out: 10, in: 11, heal: 12, noitem: 13, throw: 14, catch: 15, ballFail: 16, runOk: 17, runFail: 18, noRun: 19, noCatch: 20, forceIn: 21 };
const RESULTS: (BattleResult | null)[] = [null, "win", "lose", "run", "caught"];
const MON_STRIDE = 9;

export class Battle {
  result: BattleResult | null = null;
  /** Índices (en party / foes) de las criaturas en combate; -1 = pendiente de reemplazo, -2 = vacía. */
  pa: number[] = [];
  fa: number[] = [];
  readonly size: 1 | 2;
  private spIdx = new Map<string, number>();
  private mvIdx = new Map<string, number>();

  constructor(
    private p: Project,
    private e: Engine,
    readonly party: Mon[],
    readonly foes: Mon[],
    readonly opts: { trainer?: string; double?: boolean; inv: Record<string, number> },
  ) {
    p.species.forEach((s, i) => this.spIdx.set(s.id, i));
    p.moves.forEach((m, i) => this.mvIdx.set(m.id, i));
    this.uploadData();
    this.uploadTeams();
    this.size = this.e.btStart(!!opts.trainer, !!opts.double) === 2 ? 2 : 1;
    this.syncState();
  }

  get isTrainer() { return !!this.opts.trainer; }
  get player() { return this.party[this.pa.find((i) => i >= 0) ?? 0]; }
  get foe() { return this.foes[this.fa.find((i) => i >= 0) ?? 0]; }
  get pi() { return this.pa.find((i) => i >= 0) ?? 0; }
  get awaitingSwitch() { return this.pa.includes(-1); }
  get playerSlots() { return this.pa.map((i, s) => (i >= 0 ? s : -1)).filter((s) => s >= 0); }
  get foeSlots() { return this.fa.map((i, s) => (i >= 0 ? s : -1)).filter((s) => s >= 0); }
  get reserves() { return this.party.map((m, i) => (m.hp > 0 && !this.pa.includes(i) ? i : -1)).filter((i) => i >= 0); }
  moveOf(id: string): Move | undefined { return this.p.moves.find((m) => m.id === id); }
  itemOf(id: string) { return this.p.items.find((i) => i.id === id); }

  snap(): Snapshot {
    const mk = (arr: number[], team: Mon[]) => arr.map((i) => (i >= 0 ? { i, hp: team[i].hp } : null));
    return { p: mk(this.pa, this.party), f: mk(this.fa, this.foes) };
  }

  // ----- marshaling hacia/desde Rust -----
  private uploadData() {
    const p = this.p, io = this.e.btIo;
    if (p.species.length > LIMITS.species || p.moves.length > LIMITS.moves || p.types.length > LIMITS.types) throw new Error("El proyecto supera los límites del motor de combate (128 especies, 256 movimientos, 16 tipos).");
    let o = 0;
    const put = (...v: number[]) => { for (const x of v) io[o++] = x; };
    put(p.types.length, p.moves.length, p.species.length);
    for (let a = 0; a < p.types.length; a++) for (let d = 0; d < p.types.length; d++) put(Math.round((p.typeChart[a]?.[d] ?? 1) * 100));
    for (const m of p.moves) put(m.type, m.category === "special" ? 1 : 0, m.power, m.accuracy);
    for (const s of p.species) {
      const st = s.stats;
      put(s.types[0] ?? 0, s.types[1] ?? -1, st.hp, st.atk, st.def, st.spa, st.spd, st.spe);
      put(s.evolve && this.spIdx.has(s.evolve.into) ? s.evolve.level : 0, s.evolve ? (this.spIdx.get(s.evolve.into) ?? -1) : -1);
      const learn = (s.learnset ?? []).filter((l) => this.mvIdx.has(l.move)).slice(0, LIMITS.learn);
      put(learn.length);
      for (let k = 0; k < LIMITS.learn; k++) put(learn[k]?.level ?? 0, learn[k] ? this.mvIdx.get(learn[k].move)! : 0);
    }
    this.e.btLoadData();
  }

  private uploadTeam(side: 0 | 1) {
    const team = side === 0 ? this.party : this.foes, io = this.e.btIo;
    team.slice(0, 6).forEach((m, i) => {
      const mv = m.moves.map((id) => this.mvIdx.get(id)).filter((x): x is number => x !== undefined).slice(0, 4);
      const o = i * MON_STRIDE;
      io.set([this.spIdx.get(m.species) ?? 0, m.level, m.hp, m.exp, mv.length, mv[0] ?? 0, mv[1] ?? 0, mv[2] ?? 0, mv[3] ?? 0], o);
    });
    this.e.btLoadTeam(side, Math.min(6, team.length));
  }
  private uploadTeams() { this.uploadTeam(0); this.uploadTeam(1); }

  private downloadTeam(side: 0 | 1) {
    const team = side === 0 ? this.party : this.foes;
    this.e.btReadTeam(side);
    const io = this.e.btIo;
    team.slice(0, 6).forEach((m, i) => {
      const o = i * MON_STRIDE;
      m.species = this.p.species[io[o]]?.id ?? m.species;
      m.level = io[o + 1]; m.hp = io[o + 2]; m.exp = io[o + 3];
      m.moves = Array.from({ length: io[o + 4] }, (_, k) => this.p.moves[io[o + 5 + k]]?.id).filter((x): x is string => !!x);
    });
  }

  private syncState() {
    this.e.btState();
    const io = this.e.btIo;
    this.result = RESULTS[io[1]] ?? null;
    this.pa = [io[2], io[3]].slice(0, this.size);
    this.fa = [io[4], io[5]].slice(0, this.size);
  }

  // ----- API -----
  /** Ejecuta un turno. `actions[k]` es la acción de la k-ésima casilla del jugador (una sola acción vale para 1v1). */
  turn(actions: Action | Action[]): BattleEvent[] {
    if (this.result || this.awaitingSwitch) return [];
    const acts = Array.isArray(actions) ? actions : [actions];
    this.uploadTeams(); // el estado de las criaturas es de JS (los tests y el juego pueden modificarlo entre turnos)
    this.pa.forEach((pi, slot) => {
      const a = acts[slot];
      if (pi < 0 || !a) return;
      if (a.kind === "move") this.e.btSetAction(slot, A.move, a.index, a.target ?? 0);
      else if (a.kind === "switch") this.e.btSetAction(slot, A.switch, a.to, 0);
      else if (a.kind === "run") this.e.btSetAction(slot, A.run, 0, 0);
      else {
        const def = this.itemOf(a.id);
        const idx = this.p.items.findIndex((i) => i.id === a.id);
        if (!def || (this.opts.inv[a.id] ?? 0) <= 0) this.e.btSetAction(slot, A.noitem, 0, 0);
        else this.e.btSetAction(slot, def.kind === "heal" ? A.heal : A.ball, def.amount, idx);
      }
    });
    return this.collect(this.e.btTurn());
  }

  /** Reemplazo obligatorio de una casilla (tras debilitarse). */
  forceSwitch(slot: number, to: number): BattleEvent[] {
    this.uploadTeams();
    return this.collect(this.e.btForceSwitch(slot, to));
  }

  /** Lee los eventos de Rust, actualiza el estado de JS y los convierte a texto. */
  private collect(n: number): BattleEvent[] {
    const raw = Array.from(this.e.btEvents(n));
    // especies al empezar la secuencia: los nombres de los textos cambian solo cuando ocurre la evolución
    const speciesNow = new Map<string, string>();
    this.party.forEach((m, i) => speciesNow.set(`0${i}`, m.species));
    this.foes.forEach((m, i) => speciesNow.set(`1${i}`, m.species));
    this.syncState();
    this.downloadTeam(0);
    this.downloadTeam(1);
    // las criaturas ya están en su estado final; para los textos usamos nombres según el momento del evento
    const out: BattleEvent[] = [];
    const name = (side: 0 | 1, i: number) => {
      const m = (side === 0 ? this.party : this.foes)[i];
      const sp = speciesNow.get(`${side}${i}`) ?? m.species;
      return this.p.species.find((s) => s.id === sp)?.name ?? sp;
    };
    const foeName = (i: number) => name(1, i) + (this.isTrainer ? " rival" : " salvaje");
    const cap = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);
    const mvName = (id: number) => this.p.moves[id]?.name ?? "?";
    const itemName = (i: number) => this.p.items[i]?.name ?? "objeto";
    for (let k = 0; k < n; k++) {
      const [kind, a, b, c, d] = raw.slice(k * 13, k * 13 + 5);
      const s = raw.slice(k * 13 + 5, k * 13 + 13);
      const mk = (hp: number[], team: Mon[]) => [0, 2].slice(0, this.size).map((o) => (hp[o] >= 0 ? { i: hp[o], hp: hp[o + 1] } : null)).map((x) => (x && team[x.i] ? x : null));
      const snap: Snapshot = { p: mk(s.slice(0, 4), this.party), f: mk(s.slice(4, 8), this.foes) };
      const push = (text: string, sfx?: BattleEvent["sfx"], target?: BattleEvent["target"]) => out.push({ text, snap, sfx, target });
      switch (kind) {
        case E.use: { const who = a === 0 ? name(0, b) : foeName(b); push(`${cap(who)} usa ${mvName(c)}.`); break; }
        case E.miss: push("¡Pero falló!", "miss"); break;
        case E.hit: {
          const eff = d & 0xffff, crit = (d >> 16) > 0;
          push(crit ? "¡Golpe crítico!" : eff === 0 ? "No afecta..." : eff > 100 ? "¡Es muy eficaz!" : eff < 100 ? "No es muy eficaz..." : `${c} de daño.`,
            eff === 0 ? undefined : eff > 100 ? "super" : eff < 100 ? "weak" : "hit", { side: a === 0 ? "p" : "f", slot: b });
          break;
        }
        case E.faint: push(a === 1 ? `¡${cap(foeName(c))} se debilitó!` : `¡${name(0, c)} se debilitó!`, "faint", { side: a === 0 ? "p" : "f", slot: b }); break;
        case E.exp: push(`${name(0, a)} gana ${b} puntos de experiencia.`); break;
        case E.level: push(`¡${name(0, a)} sube al nivel ${b}!`, "levelup"); break;
        case E.learn: push(`¡${name(0, a)} aprende ${mvName(b)}!`, "levelup"); break;
        case E.evolve: {
          const old = this.p.species[b]?.name ?? "?";
          speciesNow.set(`0${a}`, this.p.species[c]?.id ?? "");
          push(`¡${old} evoluciona en ${this.p.species[c]?.name ?? "?"}!`, "levelup");
          break;
        }
        case E.sendout: push(`${this.opts.trainer} envía a ${name(1, a)}.`); break;
        case E.out: push(`¡Vuelve, ${name(0, a)}!`); break;
        case E.in: case E.forceIn: push(`¡Adelante, ${name(0, a)}!`); break;
        case E.heal: {
          const id = this.p.items[c]?.id;
          if (id) this.opts.inv[id] = (this.opts.inv[id] ?? 1) - 1;
          push(`${name(0, a)} recupera ${b} PS con ${itemName(c)}.`, "heal");
          break;
        }
        case E.noitem: push("¡No te quedan!"); break;
        case E.throw: { const id = this.p.items[c]?.id; if (id) this.opts.inv[id] = (this.opts.inv[id] ?? 1) - 1; push(`¡Lanzas una ${itemName(c).toLowerCase()}!`); break; }
        case E.catch: {
          push(`¡${name(1, a)} fue capturado!`, "catch");
          if (this.party.length < 6) this.party.push(this.foes[a]); else push("Tu equipo está lleno: se envía a la caja.");
          break;
        }
        case E.ballFail: push("¡Se escapó de la bola!"); break;
        case E.runOk: push("¡Escapaste sin problemas!"); break;
        case E.runFail: push("¡No pudiste escapar!"); break;
        case E.noRun: push("¡No puedes huir de un combate de entrenador!"); break;
        case E.noCatch: push("¡No puedes capturar aquí!"); break;
      }
    }
    return out;
  }
}
