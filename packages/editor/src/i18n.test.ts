import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import { EN } from "./i18n.en";
import { getLang, setLang, t } from "./i18n";
import { Engine } from "./engine";
import { Battle, makeMon } from "./battle";
import { defaultProject } from "./project";
import { STATUS_NAMES, BATTLE_STAT_NAMES } from "./project";

const SOURCES = ["battle.ts", "game.ts", "main.ts", "ui/battleUi.ts"];
const placeholders = (s: string) => [...new Set([...s.matchAll(/\{(\d+)\}/g)].map((m) => m[1]))].sort();

describe("i18n", () => {
  afterEach(() => setLang("es"));

  it("todo texto marcado con t()/tr() tiene traducción al inglés con los mismos parámetros", () => {
    const missing: string[] = [], mismatch: string[] = [];
    for (const f of SOURCES) {
      const src = readFileSync(new URL(`./${f}`, import.meta.url), "utf8");
      for (const m of src.matchAll(/\b(?:t|tr)\(("(?:[^"\\]|\\.)*")/g)) {
        const key = JSON.parse(m[1]) as string;
        if (!(key in EN)) missing.push(`${f}: ${key}`);
        else if (placeholders(key).join() !== placeholders(EN[key]).join()) mismatch.push(`${f}: ${key}`);
      }
    }
    expect(missing).toEqual([]);
    expect(mismatch).toEqual([]);
  });

  it("las estadísticas del combate se traducen y no hay claves sobrantes en el diccionario", () => {
    for (const n of Object.values(BATTLE_STAT_NAMES)) expect(EN[n], n).toBeTruthy();
    void STATUS_NAMES;
    const all = SOURCES.map((f) => readFileSync(new URL(`./${f}`, import.meta.url), "utf8")).join("\n");
    const unused = Object.keys(EN).filter((k) => !all.includes(JSON.stringify(k)) && !Object.values(BATTLE_STAT_NAMES).includes(k));
    expect(unused).toEqual([]);
  });

  it("t() sustituye parámetros y cambia de idioma", () => {
    expect(getLang()).toBe("es");
    expect(t("¡{0} se debilitó!", "Pelusín")).toBe("¡Pelusín se debilitó!");
    setLang("en");
    expect(t("¡{0} se debilitó!", "Pelusín")).toBe("Pelusín fainted!");
    expect(t("texto sin traducir {0}", 3)).toBe("texto sin traducir 3");
  });

  it("un combate completo sale en inglés al cambiar de idioma", async () => {
    const e = await Engine.load(readFileSync(new URL("../public/engine_core.wasm", import.meta.url)));
    e.reset(8, 8, 5);
    const p = defaultProject();
    const text = (lang: "es" | "en") => {
      setLang(lang);
      e.reset(8, 8, 5);
      const b = new Battle(p, e, [makeMon(p, "flamito", 20)], [makeMon(p, "pelusin", 5)], { inv: {} });
      return b.turn({ kind: "move", index: 0 }).map((x) => x.text).join(" | ");
    };
    const es = text("es"), en = text("en");
    expect(es).toContain("usa");
    expect(en).toContain("used");
    expect(en).toContain("Wild");
    expect(en).not.toContain("usa ");
  });
});
