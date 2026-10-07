/**
 * Combate por turnos (1v1 o 2v2). La simulación vive en Rust (`crates/engine-core/src/battle.rs`):
 * este módulo carga los datos del proyecto en la memoria WASM, envía las acciones, y traduce la lista de
 * eventos devuelta a texto en español. Es reproducible por semilla (usa el mismo RNG que el mundo).
 */
import type { Engine } from "./engine";
import { t } from "./i18n";
import { BATTLE_STATS, BATTLE_STAT_NAMES, LIMITS, type Move, type Project, STATUS_KINDS, WEATHER_KINDS, type WeatherKind, maxHp } from "./project";

export interface Mon { species: string; level: number; hp: number; exp: number; moves: string[]; /** objeto equipado (id); se consume si es de un solo uso */ held?: string; /** 0 = sano; 1…5 = índice+1 en STATUS_KINDS (persiste entre combates). */ status?: number }

export type Action =
  | { kind: "move"; index: number; /** slot rival (0/1); por defecto el primero en pie */ target?: number; /** transformarse antes de actuar (si lleva un objeto de transformación y no se ha usado) */ form?: boolean }
  | { kind: "switch"; to: number }
  | { kind: "item"; id: string }
  | { kind: "run" };

export type BattleResult = "win" | "lose" | "run" | "caught";

export interface SlotSnap { i: number; hp: number; /** estado alterado (0 = ninguno) */ st: number }
/** Estado visible tras cada evento: criatura (índice en su equipo) y PS por casilla activa; null = casilla vacía. */
export interface Snapshot { p: (SlotSnap | null)[]; f: (SlotSnap | null)[] }
export interface BattleEvent {
  text: string; snap: Snapshot; target?: { side: "p" | "f"; slot: number };
  sfx?: "hit" | "super" | "weak" | "faint" | "levelup" | "catch" | "heal" | "miss";
}

export { LIMITS };

const expFor = (level: number) => level * level * 2;

export function makeMon(p: Project, speciesId: string, level: number, held?: string): Mon {
  const sp = p.species.find((s) => s.id === speciesId);
  if (!sp) throw new Error(`Especie inexistente: ${speciesId}`);
  const m: Mon = { species: speciesId, level, hp: 0, exp: expFor(level), moves: sp.moves.slice(0, 4), status: 0, held };
  if (!m.moves.length && p.moves[0]) m.moves = [p.moves[0].id];
  m.hp = monMaxHp(p, m);
  return m;
}
const spOf = (p: Project, m: Mon) => p.species.find((s) => s.id === m.species)!;
export const monMaxHp = (p: Project, m: Mon) => maxHp(spOf(p, m).stats.hp, m.level);
export const monName = (p: Project, m: Mon) => spOf(p, m).name;
export const healAll = (p: Project, party: Mon[]) => party.forEach((m) => { m.hp = monMaxHp(p, m); m.status = 0; });

// Códigos del protocolo con Rust (deben coincidir con battle.rs)
const A = { move: 1, switch: 2, heal: 3, ball: 4, run: 5, noitem: 6, cure: 7 };
const E = { use: 1, miss: 2, hit: 3, faint: 4, exp: 5, level: 6, learn: 7, evolve: 8, sendout: 9, out: 10, in: 11, heal: 12, noitem: 13, throw: 14, catch: 15, ballFail: 16, runOk: 17, runFail: 18, noRun: 19, noCatch: 20, forceIn: 21, status: 22, stage: 23, cant: 24, wake: 25, thaw: 26, chip: 27, drain: 28, recoil: 29, selfHeal: 30, ability: 31, immune: 32, absorb: 33, cure: 34, noEffect: 35, charge: 36, recharge: 37, multi: 38, weather: 39, weatherEnd: 40, weatherChip: 41, terrain: 42, terrainEnd: 43, held: 44, protect: 45, protected: 46, flinch: 47, trap: 48, trapChip: 49, trapEnd: 50, trapped: 51, phaze: 52, form: 53 };
const EV_STRIDE = 17;
const RESULTS: (BattleResult | null)[] = [null, "win", "lose", "run", "caught"];
const MON_STRIDE = 11;

export class Battle {
  result: BattleResult | null = null;
  /** El jugador ya se ha transformado en este combate. */
  formUsed = false;
  /** Índices (en party / foes) de las criaturas en combate; -1 = pendiente de reemplazo, -2 = vacía. */
  pa: number[] = [];
  fa: number[] = [];
  readonly size: 1 | 2;
  /** Eventos que ocurren al empezar (habilidades al entrar, p. ej. Intimidar). */
  startEvents: BattleEvent[] = [];
  private spIdx = new Map<string, number>();
  private mvIdx = new Map<string, number>();
  private heldList: { id: string; name: string; kind: string }[] = [];

  constructor(
    private p: Project,
    private e: Engine,
    readonly party: Mon[],
    readonly foes: Mon[],
    readonly opts: { trainer?: string; double?: boolean; weather?: WeatherKind; inv: Record<string, number> },
  ) {
    p.species.forEach((s, i) => this.spIdx.set(s.id, i));
    p.moves.forEach((m, i) => this.mvIdx.set(m.id, i));
    this.heldList = p.items.filter((i) => i.kind === "held").map((i) => ({ id: i.id, name: i.name, kind: i.hold?.kind ?? "" }));
    this.uploadData();
    this.uploadTeams();
    this.size = this.e.btStart(!!opts.trainer, !!opts.double, opts.weather ? WEATHER_KINDS.indexOf(opts.weather) + 1 : 0) === 2 ? 2 : 1;
    this.syncState();
    this.startEvents = this.collect(this.e.btEventCount());
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
    const mk = (arr: number[], team: Mon[]) => arr.map((i) => (i >= 0 ? { i, hp: team[i].hp, st: team[i].status ?? 0 } : null));
    return { p: mk(this.pa, this.party), f: mk(this.fa, this.foes) };
  }

  // ----- marshaling hacia/desde Rust -----
  private uploadData() {
    const p = this.p, io = this.e.btIo, abilities = p.abilities ?? [];
    if (p.species.length > LIMITS.species || p.moves.length > LIMITS.moves || p.types.length > LIMITS.types || abilities.length > LIMITS.abilities) throw new Error("El proyecto supera los límites del motor de combate (128 especies, 256 movimientos, 16 tipos, 64 habilidades).");
    let o = 0;
    const put = (...v: number[]) => { for (const x of v) io[o++] = x; };
    const helds = p.items.filter((i) => i.kind === "held");
    if (helds.length > LIMITS.helds) throw new Error("Demasiados objetos equipables (máximo 64).");
    put(p.types.length, p.moves.length, p.species.length, abilities.length, helds.length);
    for (let a = 0; a < p.types.length; a++) for (let d = 0; d < p.types.length; d++) put(Math.round((p.typeChart[a]?.[d] ?? 1) * 100));
    for (const w of WEATHER_KINDS) {
      const r = p.weatherRules?.[w] ?? {};
      const imm = (r.immune ?? []).slice(0, 4);
      put(r.boost ?? -1, r.weaken ?? -1, r.chip ? 1 : 0, imm.length, imm[0] ?? -1, imm[1] ?? -1, imm[2] ?? -1, imm[3] ?? -1);
    }
    for (const m of p.moves) {
      const e = m.effect ?? {};
      put(m.type, m.category === "special" ? 1 : 0, m.power, m.accuracy, e.priority ?? 0,
        e.status ? STATUS_KINDS.indexOf(e.status.kind) + 1 : 0, e.status?.chance ?? 0,
        e.stat ? BATTLE_STATS.indexOf(e.stat.stat) : -1, e.stat?.stages ?? 0, e.stat?.target === "foe" ? 1 : 0, e.stat?.chance ?? 100,
        e.drain ?? 0, e.recoil ?? 0, e.heal ?? 0,
        e.hits?.min ?? 1, e.hits?.max ?? 1, e.crit ?? 0, e.charge ? 1 : 0, e.recharge ? 1 : 0,
        e.weather ? WEATHER_KINDS.indexOf(e.weather) + 1 : 0, e.terrain ? m.type : -1,
        e.protect ? 1 : 0, e.flinch ?? 0, e.trap ? 1 : 0, e.phaze ? 1 : 0);
    }
    const KIND: Record<string, number> = { immune: 1, absorb: 2, statusImmune: 3, intimidate: 4, pinch: 5, speedBoost: 6, weather: 7 };
    for (const a of abilities) put(KIND[a.kind] ?? 0, a.kind === "statusImmune" ? STATUS_KINDS.indexOf(a.status ?? "burn") + 1 : a.kind === "weather" ? WEATHER_KINDS.indexOf(a.weather ?? "sun") + 1 : (a.type ?? 0), a.amount ?? 0);
    const HELD: Record<string, number> = { boost: 1, leftovers: 2, berry: 3, cureBerry: 4, focus: 5, form: 6 };
    for (const it of helds) put(HELD[it.hold?.kind ?? ""] ?? 0, it.hold?.kind === "form" ? (it.hold.type ?? -1) : (it.hold?.type ?? 0), it.hold?.amount ?? 0);
    for (const s of p.species) {
      const st = s.stats;
      put(s.types[0] ?? 0, s.types[1] ?? -1, st.hp, st.atk, st.def, st.spa, st.spd, st.spe);
      put(s.evolve && this.spIdx.has(s.evolve.into) ? s.evolve.level : 0, s.evolve ? (this.spIdx.get(s.evolve.into) ?? -1) : -1);
      const learn = (s.learnset ?? []).filter((l) => this.mvIdx.has(l.move)).slice(0, LIMITS.learn);
      put(learn.length);
      for (let k = 0; k < LIMITS.learn; k++) put(learn[k]?.level ?? 0, learn[k] ? this.mvIdx.get(learn[k].move)! : 0);
      put(s.ability ? abilities.findIndex((x) => x.id === s.ability) : -1);
    }
    this.e.btLoadData();
  }

  private uploadTeam(side: 0 | 1) {
    const team = side === 0 ? this.party : this.foes, io = this.e.btIo;
    team.slice(0, 6).forEach((m, i) => {
      const mv = m.moves.map((id) => this.mvIdx.get(id)).filter((x): x is number => x !== undefined).slice(0, 4);
      const o = i * MON_STRIDE;
      io.set([this.spIdx.get(m.species) ?? 0, m.level, m.hp, m.exp, mv.length, mv[0] ?? 0, mv[1] ?? 0, mv[2] ?? 0, mv[3] ?? 0, m.status ?? 0, m.held ? this.heldList.findIndex((h) => h.id === m.held) : -1], o);
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
      m.level = io[o + 1]; m.hp = io[o + 2]; m.exp = io[o + 3]; m.status = io[o + 9]; m.held = this.heldList[io[o + 10]]?.id;
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
      if (a.kind === "move") this.e.btSetAction(slot, A.move | (a.form && this.canForm(slot) ? 0x100 : 0), a.index, a.target ?? 0);
      else if (a.kind === "switch") this.e.btSetAction(slot, A.switch, a.to, 0);
      else if (a.kind === "run") this.e.btSetAction(slot, A.run, 0, 0);
      else {
        const def = this.itemOf(a.id);
        const idx = this.p.items.findIndex((i) => i.id === a.id);
        if (!def || (this.opts.inv[a.id] ?? 0) <= 0) this.e.btSetAction(slot, A.noitem, 0, 0);
        else if (def.kind === "cure") this.e.btSetAction(slot, A.cure, idx, 0);
        else this.e.btSetAction(slot, def.kind === "heal" ? A.heal : A.ball, def.amount, idx);
      }
    });
    return this.collect(this.e.btTurn());
  }

  /** ¿Puede el jugador transformar a la criatura de esta casilla ahora mismo? */
  canForm(slot: number): boolean {
    const m = this.party[this.pa[slot]];
    return !this.formUsed && !!m && m.hp > 0 && this.heldList.find((h) => h.id === m.held)?.kind === "form";
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
    const foeName = (i: number) => (this.isTrainer ? t("{0} rival", name(1, i)) : t("{0} salvaje", name(1, i)));
    const cap = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);
    const mvName = (id: number) => this.p.moves[id]?.name ?? "?";
    const itemName = (i: number) => this.p.items[i]?.name ?? "objeto";
    for (let k = 0; k < n; k++) {
      const [kind, a, b, c, d] = raw.slice(k * EV_STRIDE, k * EV_STRIDE + 5);
      const s = raw.slice(k * EV_STRIDE + 5, k * EV_STRIDE + 17);
      const mk = (hp: number[], st: number[], team: Mon[]) => [0, 1].slice(0, this.size).map((k2) => (hp[k2 * 2] >= 0 ? { i: hp[k2 * 2], hp: hp[k2 * 2 + 1], st: st[k2] } : null)).map((x) => (x && team[x.i] ? x : null));
      const snap: Snapshot = { p: mk(s.slice(0, 4), s.slice(8, 10), this.party), f: mk(s.slice(4, 8), s.slice(10, 12), this.foes) };
      const abName = (i: number) => this.p.abilities?.[i]?.name ?? "Habilidad";
      /** Nombre de la criatura de una casilla según la instantánea del evento. */
      const slotName = (side: number, slot: number) => { const e = (side === 0 ? snap.p : snap.f)[slot]; return e ? (side === 0 ? name(0, e.i) : foeName(e.i)) : "?"; };
      const push = (text: string, sfx?: BattleEvent["sfx"], target?: BattleEvent["target"]) => out.push({ text, snap, sfx, target });
      switch (kind) {
        case E.use: { const who = a === 0 ? name(0, b) : foeName(b); push(t("{0} usa {1}.", cap(who), mvName(c))); break; }
        case E.miss: push(t("¡Pero falló!"), "miss"); break;
        case E.hit: {
          const eff = d & 0xffff, crit = (d >> 16) > 0;
          push(crit ? t("¡Golpe crítico!") : eff === 0 ? t("No afecta...") : eff > 100 ? t("¡Es muy eficaz!") : eff < 100 ? t("No es muy eficaz...") : t("{0} de daño.", c),
            eff === 0 ? undefined : eff > 100 ? "super" : eff < 100 ? "weak" : "hit", { side: a === 0 ? "p" : "f", slot: b });
          break;
        }
        case E.faint: push(a === 1 ? t("¡{0} se debilitó!", cap(foeName(c))) : t("¡{0} se debilitó!", name(0, c)), "faint", { side: a === 0 ? "p" : "f", slot: b }); break;
        case E.exp: push(t("{0} gana {1} puntos de experiencia.", name(0, a), b)); break;
        case E.level: push(t("¡{0} sube al nivel {1}!", name(0, a), b), "levelup"); break;
        case E.learn: push(t("¡{0} aprende {1}!", name(0, a), mvName(b)), "levelup"); break;
        case E.evolve: {
          const old = this.p.species[b]?.name ?? "?";
          speciesNow.set(`0${a}`, this.p.species[c]?.id ?? "");
          push(t("¡{0} evoluciona en {1}!", old, this.p.species[c]?.name ?? "?"), "levelup");
          break;
        }
        case E.sendout: push(t("{0} envía a {1}.", this.opts.trainer ?? "", name(1, a))); break;
        case E.out: push(t("¡Vuelve, {0}!", name(0, a))); break;
        case E.in: case E.forceIn: push(t("¡Adelante, {0}!", name(0, a))); break;
        case E.heal: {
          const id = this.p.items[c]?.id;
          if (id) this.opts.inv[id] = (this.opts.inv[id] ?? 1) - 1;
          push(t("{0} recupera {1} PS con {2}.", name(0, a), b, itemName(c)), "heal");
          break;
        }
        case E.noitem: push(t("¡No te quedan!")); break;
        case E.throw: { const id = this.p.items[c]?.id; if (id) this.opts.inv[id] = (this.opts.inv[id] ?? 1) - 1; push(t("¡Lanzas una {0}!", itemName(c).toLowerCase())); break; }
        case E.catch: {
          push(t("¡{0} fue capturado!", name(1, a)), "catch");
          if (this.party.length < 6) this.party.push(this.foes[a]); else push(t("Tu equipo está lleno: se envía a la caja."));
          break;
        }
        case E.ballFail: push(t("¡Se escapó de la bola!")); break;
        case E.runOk: push(t("¡Escapaste sin problemas!")); break;
        case E.runFail: push(t("¡No pudiste escapar!")); break;
        case E.noRun: push(t("¡No puedes huir de un combate de entrenador!")); break;
        case E.noCatch: push(t("¡No puedes capturar aquí!")); break;
        case E.status: {
          const kindName = STATUS_KINDS[c - 1];
          const who = cap(a === 0 ? name(0, d) : foeName(d));
          const msg = { burn: t("¡{0} se quemó!", who), poison: t("¡{0} fue envenenado!", who), paralysis: t("¡{0} quedó paralizado!", who), sleep: t("¡{0} se durmió!", who), freeze: t("¡{0} fue congelado!", who) }[kindName] ?? t("¡{0} sufre un estado!", who);
          push(msg, "weak", { side: a === 0 ? "p" : "f", slot: b });
          break;
        }
        case E.stage: {
          const st = t(BATTLE_STAT_NAMES[BATTLE_STATS[c]]);
          const who = slotName(a, b);
          push(d === 0 ? t("¡{0} de {1} no puede cambiar más!", st, who)
            : d > 0 ? (Math.abs(d) >= 2 ? t("¡{0} de {1} sube mucho!", st, who) : t("¡{0} de {1} sube!", st, who))
            : (Math.abs(d) >= 2 ? t("¡{0} de {1} baja mucho!", st, who) : t("¡{0} de {1} baja!", st, who)), d > 0 ? "levelup" : d < 0 ? "weak" : undefined);
          break;
        }
        case E.cant: push(c === 4 ? t("¡{0} está profundamente dormido!", cap(slotName(a, b))) : c === 5 ? t("¡{0} está congelado!", cap(slotName(a, b))) : t("¡{0} está paralizado: no puede moverse!", cap(slotName(a, b)))); break;
        case E.wake: push(t("¡{0} se despertó!", cap(slotName(a, b)))); break;
        case E.thaw: push(t("¡{0} se descongeló!", cap(slotName(a, b)))); break;
        case E.chip: push(d === 1 ? t("{0} sufre por la quemadura.", cap(slotName(a, b))) : t("{0} sufre por el veneno.", cap(slotName(a, b))), "hit", { side: a === 0 ? "p" : "f", slot: b }); break;
        case E.drain: push(t("{0} drena {1} PS.", cap(slotName(a, b)), c), "heal"); break;
        case E.recoil: push(t("{0} recibe daño de retroceso.", cap(slotName(a, b))), "hit", { side: a === 0 ? "p" : "f", slot: b }); break;
        case E.selfHeal: push(t("{0} recupera {1} PS.", cap(slotName(a, b)), c), "heal"); break;
        case E.ability: push(t("¡{0} de {1} se activa!", abName(c), slotName(a, b))); break;
        case E.immune: push(t("{0} es inmune gracias a {1}.", cap(slotName(a, b)), abName(c)), "weak"); break;
        case E.absorb: push(t("¡{0} de {1} absorbe el ataque y recupera {2} PS!", abName(d), slotName(a, b), c), "heal"); break;
        case E.cure: {
          const id = this.p.items[b]?.id;
          if (id) this.opts.inv[id] = (this.opts.inv[id] ?? 1) - 1;
          push(t("{0} se cura del estado alterado con {1}.", name(0, a), itemName(b)), "heal");
          break;
        }
        case E.noEffect: push(t("No tendría ningún efecto.")); break;
        case E.charge: push(t("¡{0} acumula energía!", cap(slotName(a, b)))); break;
        case E.recharge: push(t("¡{0} debe recuperarse!", cap(slotName(a, b)))); break;
        case E.form: {
          if (a === 0) this.formUsed = true;
          push(d >= 0 ? t("¡{0} se transforma y adquiere el tipo {1}!", cap(slotName(a, b)), this.p.types[d] ?? "?") : t("¡{0} se transforma!", cap(slotName(a, b))), "levelup");
          break;
        }
        case E.protect: push(t("¡{0} se protege!", cap(slotName(a, b)))); break;
        case E.protected: push(t("¡{0} se ha protegido del ataque!", cap(slotName(a, b))), "weak"); break;
        case E.flinch: push(t("¡{0} se amedrenta y no puede moverse!", cap(slotName(a, b)))); break;
        case E.trap: push(t("¡{0} queda atrapado!", cap(slotName(a, b)))); break;
        case E.trapChip: push(t("{0} sufre por estar atrapado.", cap(slotName(a, b))), "hit", { side: a === 0 ? "p" : "f", slot: b }); break;
        case E.trapEnd: push(t("{0} se libera.", cap(slotName(a, b)))); break;
        case E.trapped: push(t("¡{0} no puede escapar, está atrapado!", cap(slotName(a, b)))); break;
        case E.phaze: push(c < 0 ? t("¡{0} huye despavorido!", cap(slotName(a, b))) : t("¡{0} es obligado a retirarse!", cap(slotName(a, b)))); break;
        case E.multi: push(t("¡Golpeó {0} veces!", c)); break;
        case E.weather: push({ sun: t("¡El sol brilla con fuerza!"), rain: t("¡Empieza a llover!"), sand: t("¡Se levanta una tormenta de arena!"), hail: t("¡Empieza a granizar!") }[WEATHER_KINDS[c - 1]] ?? t("El clima cambia.")); break;
        case E.weatherEnd: push({ sun: t("El sol vuelve a la normalidad."), rain: t("La lluvia cesa."), sand: t("La tormenta de arena amaina."), hail: t("El granizo cesa.") }[WEATHER_KINDS[c - 1]] ?? t("El clima se calma.")); break;
        case E.weatherChip: push(d === 3 ? t("{0} sufre por la tormenta de arena.", cap(slotName(a, b))) : t("{0} sufre por el granizo.", cap(slotName(a, b))), "hit", { side: a === 0 ? "p" : "f", slot: b }); break;
        case E.terrain: push(t("Un terreno de tipo {0} cubre el campo.", this.p.types[c] ?? "?")); break;
        case E.terrainEnd: push(t("El terreno de tipo {0} desaparece.", this.p.types[c] ?? "?")); break;
        case E.held: {
          const h = this.heldList[c], amt = d & 0xffff, who = cap(slotName(a, b));
          const it = h?.name ?? t("su objeto");
          push(h?.kind === "leftovers" ? t("{0} recupera {1} PS con {2}.", who, amt, it) : h?.kind === "berry" ? t("¡{0} se come {1} y recupera {2} PS!", who, it, amt) : h?.kind === "cureBerry" ? t("¡{0} se come {1} y se cura!", who, it) : h?.kind === "focus" ? t("¡{0} aguanta el golpe gracias a {1}!", who, it) : t("{0} usa {1}.", who, it), h?.kind === "focus" ? "weak" : "heal");
          break;
        }
      }
    }
    return out;
  }
}
