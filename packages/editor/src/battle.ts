/** Lógica de combate por turnos. Usa el RNG y la fórmula de daño del núcleo WASM, así que es reproducible por semilla. */
import type { Engine } from "./engine";
import { type Move, type Project, type Species, effectiveness, maxHp, statAt } from "./project";

export interface Mon { species: string; level: number; hp: number; exp: number; moves: string[] }

export type Action =
  | { kind: "move"; index: number }
  | { kind: "switch"; to: number }
  | { kind: "ball" }
  | { kind: "potion" }
  | { kind: "run" };

export type BattleResult = "win" | "lose" | "run" | "caught";

export interface Snapshot { pi: number; ph: number; fi: number; fh: number }
export interface BattleEvent { text: string; snap: Snapshot; target?: "p" | "f"; sfx?: "hit" | "super" | "weak" | "faint" | "levelup" | "catch" | "heal" | "miss" }

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

export class Battle {
  result: BattleResult | null = null;
  awaitingSwitch = false;
  pi: number;
  fi = 0;

  constructor(
    private p: Project,
    private e: Engine,
    readonly party: Mon[],
    readonly foes: Mon[],
    readonly opts: { trainer?: string; inv: { ball: number; potion: number } },
  ) {
    this.pi = Math.max(0, party.findIndex((m) => m.hp > 0));
  }

  get player() { return this.party[this.pi]; }
  get foe() { return this.foes[this.fi]; }
  get isTrainer() { return !!this.opts.trainer; }
  snap(): Snapshot { return { pi: this.pi, ph: this.player.hp, fi: this.fi, fh: this.foe.hp }; }
  moveOf(id: string): Move | undefined { return this.p.moves.find((m) => m.id === id); }

  private ev(out: BattleEvent[], text: string, sfx?: BattleEvent["sfx"], target?: "p" | "f") { out.push({ text, snap: this.snap(), sfx, target }); }
  private nm(side: "p" | "f") { const m = side === "p" ? this.player : this.foe; return side === "p" ? monName(this.p, m) : (this.isTrainer ? "" : "el ") + monName(this.p, m) + (this.isTrainer ? " rival" : " salvaje"); }
  private spd(m: Mon) { return statAt(spOf(this.p, m).stats.spe, m.level); }

  /** Ejecuta un turno completo. Devuelve los eventos a reproducir en la UI. */
  turn(action: Action): BattleEvent[] {
    const out: BattleEvent[] = [];
    if (this.result || this.awaitingSwitch) return out;
    const foeMove = this.pickFoeMove();

    if (action.kind !== "move") {
      this.doPlayerNonMove(action, out);
      if (!this.result && !this.awaitingSwitch) this.foeAttack(foeMove, out);
      return out;
    }
    const pm = this.moveOf(this.player.moves[action.index]);
    const playerFirst = this.spd(this.player) > this.spd(this.foe) || (this.spd(this.player) === this.spd(this.foe) && this.e.rand(2) === 0);
    const actP = () => { if (pm) this.attack("p", pm, out); };
    const actF = () => { if (foeMove) this.attack("f", foeMove, out); };
    const [first, second] = playerFirst ? [actP, actF] : [actF, actP];
    first();
    // el segundo solo actúa si ambos siguen en pie
    if (!this.result && !this.awaitingSwitch && this.player.hp > 0 && this.foe.hp > 0) second();
    return out;
  }

  /** Cambio obligatorio tras debilitarse el activo. */
  forceSwitch(to: number): BattleEvent[] {
    const out: BattleEvent[] = [];
    if (!this.awaitingSwitch || !this.party[to] || this.party[to].hp <= 0) return out;
    this.pi = to;
    this.awaitingSwitch = false;
    this.ev(out, `¡Adelante, ${monName(this.p, this.player)}!`);
    return out;
  }

  private doPlayerNonMove(a: Exclude<Action, { kind: "move" }>, out: BattleEvent[]) {
    const inv = this.opts.inv;
    if (a.kind === "switch") {
      if (!this.party[a.to] || this.party[a.to].hp <= 0 || a.to === this.pi) return;
      this.ev(out, `¡Vuelve, ${monName(this.p, this.player)}!`);
      this.pi = a.to;
      this.ev(out, `¡Adelante, ${monName(this.p, this.player)}!`);
    } else if (a.kind === "potion") {
      if (inv.potion <= 0) { this.ev(out, "¡No te quedan pociones!"); return; }
      inv.potion--;
      const max = monMaxHp(this.p, this.player);
      const heal = Math.min(20, max - this.player.hp);
      this.player.hp += heal;
      this.ev(out, `${monName(this.p, this.player)} recupera ${heal} PS.`, "heal");
    } else if (a.kind === "ball") {
      if (this.isTrainer) { this.ev(out, "¡No puedes capturar a la criatura de otro entrenador!"); return; }
      if (inv.ball <= 0) { this.ev(out, "¡No te quedan bolas!"); return; }
      inv.ball--;
      this.ev(out, "¡Lanzas una bola!");
      const f = this.foe, max = monMaxHp(this.p, f);
      const chance = Math.min(95, 15 + 70 * (1 - f.hp / max));
      if (this.e.rand(100) < chance) {
        this.ev(out, `¡${monName(this.p, f)} fue capturado!`, "catch");
        if (this.party.length < 6) this.party.push(f); else this.ev(out, "Tu equipo está lleno: se envía a la caja.");
        this.result = "caught";
      } else this.ev(out, "¡Se escapó de la bola!");
    } else if (a.kind === "run") {
      if (this.isTrainer) { this.ev(out, "¡No puedes huir de un combate de entrenador!"); return; }
      const chance = Math.max(25, Math.min(95, 50 + this.spd(this.player) - this.spd(this.foe)));
      if (this.e.rand(100) < chance) { this.ev(out, "¡Escapaste sin problemas!"); this.result = "run"; }
      else this.ev(out, "¡No pudiste escapar!");
    }
  }

  private pickFoeMove(): Move | undefined {
    const f = this.foe;
    return this.moveOf(f.moves[this.e.rand(f.moves.length)]);
  }
  private foeAttack(m: Move | undefined, out: BattleEvent[]) { if (m && this.foe.hp > 0 && this.player.hp > 0) this.attack("f", m, out); }

  private attack(side: "p" | "f", mv: Move, out: BattleEvent[]) {
    const a = side === "p" ? this.player : this.foe;
    const d = side === "p" ? this.foe : this.player;
    const aSp = spOf(this.p, a), dSp = spOf(this.p, d);
    const who = side === "p" ? monName(this.p, a) : this.nm("f");
    const cap = who.charAt(0).toUpperCase() + who.slice(1);
    this.ev(out, `${cap} usa ${mv.name}.`);
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
    this.ev(out, crit > 1 ? "¡Golpe crítico!" : eff === 0 ? "No afecta..." : eff > 1 ? "¡Es muy eficaz!" : eff < 1 ? "No es muy eficaz..." : `${dmg} de daño.`, eff === 0 ? undefined : sfx, side === "p" ? "f" : "p");
    if (d.hp <= 0) this.faint(side === "p" ? "f" : "p", out);
  }

  private faint(side: "p" | "f", out: BattleEvent[]) {
    if (side === "f") {
      const f = this.foe;
      this.ev(out, `¡${this.nm("f").replace(/^el /, "El ")} se debilitó!`, "faint");
      const gain = Math.floor(f.level * 6 * (this.isTrainer ? 1.5 : 1)) + 10;
      const pl = this.player;
      if (pl.hp > 0) {
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
      const next = this.foes.findIndex((m, i) => i > this.fi && m.hp > 0);
      if (this.isTrainer && next >= 0) {
        this.fi = next;
        this.ev(out, `${this.opts.trainer} envía a ${monName(this.p, this.foe)}.`);
      } else this.result = "win";
    } else {
      this.ev(out, `¡${monName(this.p, this.player)} se debilitó!`, "faint");
      if (this.party.some((m) => m.hp > 0)) this.awaitingSwitch = true;
      else this.result = "lose";
    }
  }
}
