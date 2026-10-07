import { type Action, type Battle, type BattleEvent, monMaxHp, monName } from "../battle";
import { sfx } from "../audio";
import { h } from "../dom";
import type { Project } from "../project";
import { speciesImage } from "../sprites";

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Interfaz DOM del combate (pantalla completa sobre el viewport). Devuelve cuando termina el combate. */
export async function runBattleUi(host: HTMLElement, p: Project, b: Battle): Promise<void> {
  const root = h("div", { class: "battle" });
  host.append(root);

  const foeImg = h("img", { class: "mon foe" }), plImg = h("img", { class: "mon pl" });
  const box = (cls: string) => {
    const name = h("b"), lv = h("span"), fill = h("div", { class: "hp" }), num = h("small");
    return { el: h("div", { class: `plate ${cls}` }, h("div", {}, name, lv), h("div", { class: "hpbar" }, fill), num), name, lv, fill, num };
  };
  const fp = box("fplate"), pp = box("pplate");
  const msg = h("div", { class: "msg" });
  const menu = h("div", { class: "menu" });
  root.append(fp.el, foeImg, plImg, pp.el, msg, menu);

  const apply = (s: BattleEvent["snap"]) => {
    const f = b.foes[s.fi], pl = b.party[s.pi];
    const upd = (bx: ReturnType<typeof box>, m: typeof f, hp: number, img: HTMLImageElement, self: boolean) => {
      const max = monMaxHp(p, m), pct = Math.max(0, (hp / max) * 100);
      bx.name.textContent = monName(p, m);
      bx.lv.textContent = ` Nv.${m.level}`;
      bx.fill.style.width = pct + "%";
      bx.fill.style.background = pct > 50 ? "#4caf50" : pct > 20 ? "#ffb300" : "#e53935";
      bx.num.textContent = self ? `${Math.ceil(hp)} / ${max}` : "";
      const src = speciesImage(p, m.species);
      if (img.dataset.k !== m.species + (hp <= 0 ? "x" : "")) { img.src = src; img.dataset.k = m.species + (hp <= 0 ? "x" : ""); }
      img.classList.toggle("fainted", hp <= 0);
    };
    upd(fp, f, s.fh, foeImg, false);
    upd(pp, pl, s.ph, plImg, true);
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
        const t = e.target === "f" ? foeImg : plImg;
        t.classList.add("shake"); setTimeout(() => t.classList.remove("shake"), 300);
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

  const pickSwitch = async (forced: boolean): Promise<number | null> => {
    const opts = b.party.map((m, i) => ({ label: `${monName(p, m)} Nv.${m.level} (${m.hp}/${monMaxHp(p, m)})`, value: i, disabled: m.hp <= 0 || (i === b.pi && !forced) }));
    return choose("¿A quién envías?", opts, !forced);
  };

  const askAction = async (): Promise<Action> => {
    for (;;) {
      const top = await choose<string>(`¿Qué hará ${monName(p, b.player)}?`, [
        { label: "⚔️ Luchar", value: "fight" }, { label: "🎒 Mochila", value: "bag" },
        { label: "🔄 Equipo", value: "team" }, { label: "🏃 Huir", value: "run" },
      ]);
      if (top === "fight") {
        const a = await choose<number>("Elige un movimiento", b.player.moves.map((id, i) => {
          const mv = b.moveOf(id);
          return { label: mv ? `${mv.name} · ${p.types[mv.type]} · ${mv.power}` : id, value: i };
        }), true);
        if (a !== null) return { kind: "move", index: a };
      } else if (top === "bag") {
        const a = await choose<string>("Mochila", [
          { label: `Poción ×${b.opts.inv.potion}`, value: "potion", disabled: b.opts.inv.potion <= 0 },
          { label: `Bola ×${b.opts.inv.ball}`, value: "ball", disabled: b.opts.inv.ball <= 0 || b.isTrainer },
        ], true);
        if (a === "potion") return { kind: "potion" };
        if (a === "ball") return { kind: "ball" };
      } else if (top === "team") {
        const a = await pickSwitch(false);
        if (a !== null) return { kind: "switch", to: a };
      } else return { kind: "run" };
    }
  };

  apply(b.snap());
  sfx("encounter");
  await say(b.isTrainer ? `¡${b.opts.trainer} quiere combatir!` : `¡Un ${monName(p, b.foe)} salvaje apareció!`, 1200);
  if (b.isTrainer) await say(`${b.opts.trainer} envía a ${monName(p, b.foe)}.`, 800);
  await say(`¡Adelante, ${monName(p, b.player)}!`, 700);

  while (!b.result) {
    if (b.awaitingSwitch) {
      const to = (await pickSwitch(true))!;
      menu.replaceChildren();
      await play(b.forceSwitch(to));
      continue;
    }
    const action = await askAction();
    menu.replaceChildren();
    await play(b.turn(action));
  }
  menu.replaceChildren();
  const end = { win: "¡Has ganado el combate!", lose: "Te quedaste sin criaturas en condiciones...", run: "", caught: "" }[b.result];
  if (end) await say(end, 1300);
  root.remove();
}
