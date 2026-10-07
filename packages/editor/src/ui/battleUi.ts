import { type Action, type Battle, type BattleEvent, type Snapshot, monMaxHp, monName } from "../battle";
import { sfx } from "../audio";
import { h } from "../dom";
import type { Project } from "../project";
import { speciesImage } from "../sprites";

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Interfaz DOM del combate (1v1 o 2v2) sobre el viewport. Termina cuando acaba el combate. */
export async function runBattleUi(host: HTMLElement, p: Project, b: Battle): Promise<void> {
  const root = h("div", { class: `battle size${b.size}` });
  host.append(root);

  interface Side { img: HTMLImageElement; name: HTMLElement; lv: HTMLElement; fill: HTMLElement; num: HTMLElement; badge: HTMLElement; el: HTMLElement }
  const mkSide = (cls: string, plate: string, slot: number): Side => {
    const img = h("img", { class: `mon ${cls} s${slot}` });
    const name = h("b"), lv = h("span"), fill = h("div", { class: "hp" }), num = h("small"), badge = h("em", { class: "badge" });
    const el = h("div", { class: `plate ${plate} s${slot}` }, h("div", {}, name, lv, badge), h("div", { class: "hpbar" }, fill), num);
    root.append(img, el);
    return { img, name, lv, fill, num, badge, el };
  };
  const fs = Array.from({ length: b.size }, (_, i) => mkSide("foe", "fplate", i));
  const ps = Array.from({ length: b.size }, (_, i) => mkSide("pl", "pplate", i));
  const msg = h("div", { class: "msg" });
  const menu = h("div", { class: "menu" });
  root.append(msg, menu);

  const apply = (s: Snapshot) => {
    const upd = (sd: Side, e: { i: number; hp: number; st: number } | null, team: typeof b.party, self: boolean) => {
      sd.el.style.visibility = e ? "visible" : "hidden";
      if (!e) { sd.img.classList.add("fainted"); return; }
      const m = team[e.i], max = monMaxHp(p, m), pct = Math.max(0, (e.hp / max) * 100);
      sd.name.textContent = monName(p, m);
      sd.lv.textContent = ` Nv.${m.level}`;
      sd.fill.style.width = pct + "%";
      sd.fill.style.background = pct > 50 ? "#4caf50" : pct > 20 ? "#ffb300" : "#e53935";
      sd.num.textContent = self ? `${Math.ceil(e.hp)} / ${max}` : "";
      sd.badge.textContent = ["", "QUE", "VEN", "PAR", "DOR", "CON"][e.st] ?? "";
      sd.badge.className = `badge st${e.st}`;
      const k = m.species + (e.hp <= 0 ? "x" : "");
      if (sd.img.dataset.k !== k) { sd.img.src = speciesImage(p, m.species); sd.img.dataset.k = k; }
      sd.img.classList.toggle("fainted", e.hp <= 0);
    };
    fs.forEach((sd, i) => upd(sd, s.f[i] ?? null, b.foes, false));
    ps.forEach((sd, i) => upd(sd, s.p[i] ?? null, b.party, true));
  };

  let skip = false;
  root.addEventListener("click", () => (skip = true));
  const say = async (t: string, ms = 900) => {
    msg.textContent = t; skip = false;
    const end = performance.now() + ms;
    while (performance.now() < end && !skip) await sleep(30);
  };
  const play = async (evs: BattleEvent[]) => {
    for (const e of evs) {
      if (e.sfx) sfx(e.sfx);
      apply(e.snap);
      if (e.target) {
        const t = (e.target.side === "f" ? fs : ps)[e.target.slot]?.img;
        if (t) { t.classList.add("shake"); setTimeout(() => t.classList.remove("shake"), 300); }
      }
      await say(e.text);
    }
  };

  const choose = <T,>(title: string, options: { label: string; value: T; disabled?: boolean }[], back = false): Promise<T | null> =>
    new Promise((res) => {
      menu.replaceChildren();
      msg.textContent = title;
      for (const o of options) menu.append(h("button", { disabled: !!o.disabled, onclick: (e: Event) => { e.stopPropagation(); sfx("select"); res(o.value); } }, o.label));
      if (back) menu.append(h("button", { class: "back", onclick: (e: Event) => { e.stopPropagation(); res(null); } }, "← Volver"));
    });

  const pickReserve = (forced: boolean): Promise<number | null> => {
    const opts = b.party.map((m, i) => ({ label: `${monName(p, m)} Nv.${m.level} (${m.hp}/${monMaxHp(p, m)})`, value: i, disabled: !b.reserves.includes(i) }));
    return choose("¿A quién envías?", opts, !forced);
  };

  const askSlot = async (slot: number): Promise<Action> => {
    const mon = b.party[b.pa[slot]];
    for (;;) {
      const top = await choose<string>(`¿Qué hará ${monName(p, mon)}?`, [
        { label: "⚔️ Luchar", value: "fight" }, { label: "🎒 Mochila", value: "bag" },
        { label: "🔄 Equipo", value: "team" }, { label: "🏃 Huir", value: "run", disabled: b.isTrainer },
      ]);
      if (top === "fight") {
        const a = await choose<number>("Elige un movimiento", mon.moves.map((id, i) => {
          const mv = b.moveOf(id);
          return { label: mv ? `${mv.name} · ${p.types[mv.type]} · ${mv.power}` : id, value: i };
        }), true);
        if (a === null) continue;
        let target = b.foeSlots[0];
        if (b.foeSlots.length > 1) {
          const t = await choose<number>("¿A quién atacas?", b.foeSlots.map((s) => ({ label: monName(p, b.foes[b.fa[s]]), value: s })), true);
          if (t === null) continue;
          target = t;
        }
        return { kind: "move", index: a, target };
      } else if (top === "bag") {
        const a = await choose<string>("Mochila", p.items.map((it) => ({
          label: `${it.name} ×${b.opts.inv[it.id] ?? 0}`, value: it.id,
          disabled: (b.opts.inv[it.id] ?? 0) <= 0 || (it.kind === "ball" && (b.isTrainer || b.size > 1)),
        })), true);
        if (a) return { kind: "item", id: a };
      } else if (top === "team") {
        const a = await pickReserve(false);
        if (a !== null) return { kind: "switch", to: a };
      } else if (top === "run") return { kind: "run" };
    }
  };

  apply(b.snap());
  sfx("encounter");
  await say(b.isTrainer ? `¡${b.opts.trainer} quiere combatir!` : `¡Un ${monName(p, b.foe)} salvaje apareció!`, 1200);
  if (b.size > 1) await say("¡Es un combate doble!", 800);
  await say(`¡Adelante, ${b.pa.filter((i) => i >= 0).map((i) => monName(p, b.party[i])).join(" y ")}!`, 700);
  await play(b.startEvents);

  while (!b.result) {
    if (b.awaitingSwitch) {
      for (let s = 0; s < b.pa.length; s++) {
        if (b.pa[s] !== -1) continue;
        const to = (await pickReserve(true))!;
        menu.replaceChildren();
        await play(b.forceSwitch(s, to));
      }
      continue;
    }
    const actions: Action[] = [];
    for (let s = 0; s < b.pa.length; s++) {
      if (b.pa[s] < 0) { actions[s] = { kind: "switch", to: -1 }; continue; }
      actions[s] = await askSlot(s);
      if (actions[s].kind === "run") break;
    }
    menu.replaceChildren();
    await play(b.turn(actions));
  }
  menu.replaceChildren();
  const end = { win: "¡Has ganado el combate!", lose: "Te quedaste sin criaturas en condiciones...", run: "", caught: "" }[b.result];
  if (end) await say(end, 1300);
  root.remove();
}
