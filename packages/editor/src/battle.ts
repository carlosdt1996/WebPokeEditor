/** Lógica de combate por turnos (1v1 o 2v2). Usa el RNG y la fórmula de daño del núcleo WASM, así que es reproducible por semilla. */
import type { Engine } from "./engine";
import { type Move, type Project, type Species, effectiveness, maxHp, statAt } from "./project";

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

const expFor = (level: number) => level * level * 2;

export function makeMon(p: Project, speciesId: string, level: number): Mon {
  const sp = p.species.find((s) => s.id === speciesId);
  if (!sp) throw new Error(`Especie inexistente: ${speciesId}`);
  const m: Mon = { species: speciesId, level, hp: 0, exp: expFor(level), moves: sp.moves.slice(0, 4) };
  if (!m.moves.length && p.moves[0]) m.moves = [p.moves[0].id];
  m.hp = monMaxHp(p, m);
  return m;
}
const spOf = (p: Project, m: Mon): Species => p.species.find((s) => s.id === m.species)!;
export const monMaxHp = (p: Project, m: Mon) => maxHp(spOf(p, m).stats.hp, m.level);
export const monName = (p: Project, m: Mon) => spOf(p, m).name;
export const healAll = (p: Project, party: Mon[]) => party.forEach((m) => (m.hp = monMaxHp(p, m)));

interface Unit { side: "p" | "f"; slot: number; action: Action; mon: Mon }

export class Battle {
  result: BattleResult | null = null;
  /** Índices (en party / foes) de las criaturas en combate; -1 = pendiente de reemplazo, -2 = vacía. */
  pa: number[] = [];
  fa: number[] = [];
  readonly size: 1 | 2;

  constructor(
    private p: Project,
    private e: Engine,
    readonly party: Mon[],
    readonly foes: Mon[],
    readonly opts: { trainer?: string; double?: boolean; inv: Record<string, number> },
  ) {
    const alive = (arr: Mon[]) => arr.map((m, i) => (m.hp > 0 ? i : -1)).filter((i) => i >= 0);
    this.size = opts.double && alive(party).length >= 2 && alive(foes).length >= 2 ? 2 : 1;
    this.pa = alive(party).slice(0, this.size);
    this.fa = alive(foes).slice(0, this.size);
  }

  get isTrainer() { return !!this.opts.trainer; }
  /** Primera criatura activa de cada lado (atajos para el caso 1v1). */
  get player() { return this.party[this.pa.find((i) => i >= 0) ?? 0]; }
  get foe() { return this.foes[this.fa.find((i) => i >= 0) ?? 0]; }
  get pi() { return this.pa.find((i) => i >= 0) ?? 0; }
  /** Casillas del jugador que necesitan un reemplazo (-1 con reservas disponibles). */
  get awaitingSwitch() { return this.pa.includes(-1); }
  moveOf(id: string): Move | undefined { return this.p.moves.find((m) => m.id === id); }
  itemOf(id: string) { return this.p.items.find((i) => i.id === id); }
  /** Casillas activas del jugador en pie. */
  get playerSlots() { return this.pa.map((i, s) => (i >= 0 ? s : -1)).filter((s) => s >= 0); }
  get foeSlots() { return this.fa.map((i, s) => (i >= 0 ? s : -1)).filter((s) => s >= 0); }
  /** Criaturas del equipo que pueden entrar (vivas y no activas). */
  get reserves() { return this.party.map((m, i) => (m.hp > 0 && !this.pa.includes(i) ? i : -1)).filter((i) => i >= 0); }

  snap(): Snapshot {
    const mk = (arr: number[], team: Mon[]) => arr.map((i) => (i >= 0 ? { i, hp: team[i].hp } : null));
    return { p: mk(this.pa, this.party), f: mk(this.fa, this.foes) };
  }
  private ev(out: BattleEvent[], text: string, sfx?: BattleEvent["sfx"], target?: BattleEvent["target"]) { out.push({ text, snap: this.snap(), sfx, target }); }
  private spd(m: Mon) { return statAt(spOf(this.p, m).stats.spe, m.level); }
  private foeName(m: Mon) { return monName(this.p, m) + (this.isTrainer ? " rival" : " salvaje"); }

  /** Ejecuta un turno. `actions[k]` es la acción de la k-ésima casilla activa del jugador (una sola acción vale para 1v1). */
  turn(actions: Action | Action[]): BattleEvent[] {
    const out: BattleEvent[] = [];
    if (this.result || this.awaitingSwitch) return out;
    const acts = Array.isArray(actions) ? actions : [actions];
    const units: Unit[] = [];
    this.pa.forEach((pi, slot) => { if (pi >= 0 && acts[slot]) units.push({ side: "p", slot, action: acts[slot], mon: this.party[pi] }); });
    this.fa.forEach((fi, slot) => {
      if (fi < 0) return;
      const m = this.foes[fi];
      const mv = m.moves[this.e.rand(m.moves.length)];
      const alive = this.playerSlots;
      units.push({ side: "f", slot, action: { kind: "move", index: m.moves.indexOf(mv), target: alive[this.e.rand(alive.length)] }, mon: m });
    });
    const prio = (u: Unit) => (u.action.kind === "move" ? 0 : 1);
    // aleatorio de desempate fijado antes de ordenar (determinista)
    const tie = new Map(units.map((u) => [u, this.e.rand(1000)]));
    units.sort((a, b) => prio(b) - prio(a) || this.spd(b.mon) - this.spd(a.mon) || tie.get(a)! - tie.get(b)!);

    for (const u of units) {
      if (this.result) break;
      const active = u.side === "p" ? this.pa[u.slot] : this.fa[u.slot];
      const team = u.side === "p" ? this.party : this.foes;
      if (active < 0 || team[active] !== u.mon || u.mon.hp <= 0) continue; // ya no está en combate
      if (u.side === "p") this.playerAct(u, out); else this.foeAct(u, out);
    }
    return out;
  }

  /** Reemplazo obligatorio de una casilla (tras debilitarse). */
  forceSwitch(slot: number, to: number): BattleEvent[] {
    const out: BattleEvent[] = [];
    if (this.pa[slot] !== -1 || !this.party[to] || this.party[to].hp <= 0 || this.pa.includes(to)) return out;
    this.pa[slot] = to;
    this.ev(out, `¡Adelante, ${monName(this.p, this.party[to])}!`);
    return out;
  }

  // ----- acciones del jugador -----
  private playerAct(u: Unit, out: BattleEvent[]) {
    const a = u.action;
    const mon = u.mon;
    if (a.kind === "move") {
      const mv = this.moveOf(mon.moves[a.index]);
      if (mv) this.attack("p", u.slot, mv, a.target ?? 0, out);
    } else if (a.kind === "switch") {
      if (!this.party[a.to] || this.party[a.to].hp <= 0 || this.pa.includes(a.to)) return;
      this.ev(out, `¡Vuelve, ${monName(this.p, mon)}!`);
      this.pa[u.slot] = a.to;
      this.ev(out, `¡Adelante, ${monName(this.p, this.party[a.to])}!`);
    } else if (a.kind === "item") this.useItem(u, a.id, out);
    else if (a.kind === "run") {
      if (this.isTrainer) { this.ev(out, "¡No puedes huir de un combate de entrenador!"); return; }
      const chance = Math.max(25, Math.min(95, 50 + this.spd(mon) - this.spd(this.foe)));
      if (this.e.rand(100) < chance) { this.ev(out, "¡Escapaste sin problemas!"); this.result = "run"; }
      else this.ev(out, "¡No pudiste escapar!");
    }
  }

  private useItem(u: Unit, id: string, out: BattleEvent[]) {
    const inv = this.opts.inv, def = this.itemOf(id);
    if (!def || (inv[id] ?? 0) <= 0) { this.ev(out, "¡No te quedan!"); return; }
    if (def.kind === "heal") {
      inv[id]--;
      const max = monMaxHp(this.p, u.mon);
      const heal = Math.min(def.amount, max - u.mon.hp);
      u.mon.hp += heal;
      this.ev(out, `${monName(this.p, u.mon)} recupera ${heal} PS con ${def.name}.`, "heal");
    } else {
      if (this.isTrainer || this.size > 1) { this.ev(out, "¡No puedes capturar aquí!"); return; }
      inv[id]--;
      this.ev(out, `¡Lanzas una ${def.name.toLowerCase()}!`);
      const f = this.foe, max = monMaxHp(this.p, f);
      const chance = Math.min(95, 15 + 70 * (1 - f.hp / max) + def.amount);
      if (this.e.rand(100) < chance) {
        this.ev(out, `¡${monName(this.p, f)} fue capturado!`, "catch");
        if (this.party.length < 6) this.party.push(f); else this.ev(out, "Tu equipo está lleno: se envía a la caja.");
        this.result = "caught";
      } else this.ev(out, "¡Se escapó de la bola!");
    }
  }

  // ----- acciones del rival -----
  private foeAct(u: Unit, out: BattleEvent[]) {
    const a = u.action;
    if (a.kind !== "move") return;
    const mv = this.moveOf(u.mon.moves[a.index]);
    if (mv) this.attack("f", u.slot, mv, a.target ?? 0, out);
  }

  private attack(side: "p" | "f", slot: number, mv: Move, targetSlot: number, out: BattleEvent[]) {
    const mine = side === "p" ? this.pa : this.fa, theirs = side === "p" ? this.fa : this.pa;
    const myTeam = side === "p" ? this.party : this.foes, theirTeam = side === "p" ? this.foes : this.party;
    const a = myTeam[mine[slot]];
    // objetivo: el elegido si sigue en pie; si no, el primero en pie
    let ts = theirs[targetSlot] >= 0 && theirTeam[theirs[targetSlot]]?.hp > 0 ? targetSlot : theirs.findIndex((i) => i >= 0 && theirTeam[i].hp > 0);
    if (ts < 0) return;
    const d = theirTeam[theirs[ts]];
    const aSp = spOf(this.p, a), dSp = spOf(this.p, d);
    const who = side === "p" ? monName(this.p, a) : this.foeName(a);
    this.ev(out, `${who.charAt(0).toUpperCase() + who.slice(1)} usa ${mv.name}.`);
    if (this.e.rand(100) >= mv.accuracy) { this.ev(out, "¡Pero falló!", "miss"); return; }
    const phys = mv.category === "physical";
    const atk = statAt(phys ? aSp.stats.atk : aSp.stats.spa, a.level);
    const def = statAt(phys ? dSp.stats.def : dSp.stats.spd, d.level);
    const eff = effectiveness(this.p, mv.type, dSp.types);
    const stab = aSp.types.includes(mv.type) ? 1.5 : 1;
    const crit = this.e.rand(16) === 0 ? 1.5 : 1;
    const dmg = this.e.damage(a.level, mv.power, atk, def, Math.round(eff * stab * crit * 100), 85 + this.e.rand(16));
    d.hp = Math.max(0, d.hp - dmg);
    const sfx = eff > 1 ? "super" : eff < 1 ? "weak" : "hit";
    this.ev(out, crit > 1 ? "¡Golpe crítico!" : eff === 0 ? "No afecta..." : eff > 1 ? "¡Es muy eficaz!" : eff < 1 ? "No es muy eficaz..." : `${dmg} de daño.`, eff === 0 ? undefined : sfx, { side: side === "p" ? "f" : "p", slot: ts });
    if (d.hp <= 0) this.faint(side === "p" ? "f" : "p", ts, out);
  }

  private faint(side: "p" | "f", slot: number, out: BattleEvent[]) {
    if (side === "f") {
      const f = this.foes[this.fa[slot]];
      this.ev(out, `¡${this.foeName(f).replace(/^./, (c) => c.toUpperCase())} se debilitó!`, "faint", { side: "f", slot });
      const gain = Math.floor(f.level * 6 * (this.isTrainer ? 1.5 : 1)) + 10;
      for (const pi of this.pa) if (pi >= 0 && this.party[pi].hp > 0) this.gainExp(this.party[pi], gain, out);
      const next = this.foes.findIndex((m, i) => m.hp > 0 && !this.fa.includes(i));
      if (this.isTrainer && next >= 0) {
        this.fa[slot] = next;
        this.ev(out, `${this.opts.trainer} envía a ${monName(this.p, this.foes[next])}.`);
      } else {
        this.fa[slot] = -1;
        if (!this.foes.some((m) => m.hp > 0)) this.result = "win";
      }
    } else {
      const m = this.party[this.pa[slot]];
      this.ev(out, `¡${monName(this.p, m)} se debilitó!`, "faint", { side: "p", slot });
      if (this.reserves.length) this.pa[slot] = -1;
      else {
        this.pa[slot] = -2; // sin reservas: la casilla queda vacía (no se reordenan las demás)
        if (!this.party.some((x) => x.hp > 0)) this.result = "lose";
      }
    }
  }

  private gainExp(pl: Mon, gain: number, out: BattleEvent[]) {
    pl.exp += gain;
    this.ev(out, `${monName(this.p, pl)} gana ${gain} puntos de experiencia.`);
    while (pl.exp >= expFor(pl.level + 1) && pl.level < 100) {
      const before = monMaxHp(this.p, pl);
      pl.level++;
      pl.hp += monMaxHp(this.p, pl) - before;
      this.ev(out, `¡${monName(this.p, pl)} sube al nivel ${pl.level}!`, "levelup");
      const sp = spOf(this.p, pl);
      for (const l of sp.learnset ?? []) {
        if (l.level !== pl.level || pl.moves.includes(l.move)) continue;
        if (pl.moves.length >= 4) pl.moves.shift();
        pl.moves.push(l.move);
        this.ev(out, `¡${monName(this.p, pl)} aprende ${this.moveOf(l.move)?.name ?? l.move}!`, "levelup");
      }
      if (sp.evolve && pl.level >= sp.evolve.level && this.p.species.some((x) => x.id === sp.evolve!.into)) {
        const old = monName(this.p, pl), before2 = monMaxHp(this.p, pl);
        pl.species = sp.evolve.into;
        pl.hp += monMaxHp(this.p, pl) - before2;
        this.ev(out, `¡${old} evoluciona en ${monName(this.p, pl)}!`, "levelup");
      }
    }
  }
}
