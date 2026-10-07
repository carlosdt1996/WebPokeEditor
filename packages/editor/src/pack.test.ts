import { describe, expect, it } from "vitest";
import { applyPack, makePack, parsePack } from "./pack";
import { defaultProject, validate } from "./project";
import { archipelagoProject, valleProject } from "./templates";

describe("packs: compartir contenido entre proyectos", () => {
  it("un pack de un mapa arrastra sus criaturas, movimientos, habilidades y objetos y se aplica a otro proyecto sin romperlo", () => {
    const src = valleProject();
    const pack = makePack(src, { maps: ["roble", "gym-roble", "centro-roble"] }, { name: "Roble Viejo", author: "yo" });
    expect(pack.maps.map((m) => m.id).sort()).toEqual(["centro-roble", "gym-roble", "roble"]);
    expect(pack.species.some((s) => s.id === "hojito")).toBe(true);
    expect(pack.species.some((s) => s.id === "frondon")).toBe(true); // arrastrado por la evolución
    expect(pack.moves.length).toBeGreaterThan(3);
    expect(pack.items.some((i) => i.id === "potion")).toBe(true); // de la tienda del centro
    const dest = defaultProject();
    const r = applyPack(dest, parsePack(JSON.stringify(pack)), "rename");
    // los mapas llegan con sus saltos internos; los externos avisan
    expect(r.project.maps.some((m) => m.id === "gym-roble")).toBe(true);
    expect(r.warnings.some((w) => w.includes("no existe"))).toBe(true);
    expect(r.added.maps).toBe(3);
    // las referencias del proyecto siguen siendo válidas salvo los saltos avisados
    const errs = validate(r.project).filter((e) => !e.includes("salto"));
    expect(errs).toEqual([]);
  });

  it("los tipos viajan por nombre: se reasignan a los índices del destino y se crean los que faltan", () => {
    const src = archipelagoProject();
    const pack = makePack(src, { species: ["rocalon"] }, { name: "Rocas" });
    expect(pack.types).toEqual(src.types);
    const dest = defaultProject();
    const before = dest.types.length;
    const r = applyPack(dest, pack);
    const sp = r.project.species.find((s) => s.id === "rocalon")!;
    expect(sp.types.map((t) => r.project.types[t])).toEqual(["Roca", "Tierra"]);
    expect(r.project.types.length).toBeGreaterThanOrEqual(before);
    expect(r.project.typeChart.every((row) => row.length === r.project.types.length)).toBe(true);
    expect(validate(r.project)).toEqual([]);
  });

  it("conflictos de ids: renombrar actualiza las referencias, omitir no toca nada y reemplazar sustituye", () => {
    const dest = defaultProject();
    const a = dest.species[0].id;
    const src = defaultProject();
    src.species[0].stats.hp = 999;
    const pack = makePack(src, { species: [a] }, { name: "Copia" });
    const ren = applyPack(dest, pack, "rename");
    expect(ren.renamed[`species/${a}`]).toBe(`${a}-2`);
    expect(ren.project.species.find((s) => s.id === `${a}-2`)!.stats.hp).toBe(999);
    expect(dest.species.find((s) => s.id === a)!.stats.hp).not.toBe(999); // el original no se modifica
    const skip = applyPack(dest, pack, "skip");
    expect(skip.skipped).toContain(`species/${a}`);
    expect(skip.project.species.length).toBe(dest.species.length);
    const rep = applyPack(dest, pack, "replace");
    expect(rep.project.species.find((s) => s.id === a)!.stats.hp).toBe(999);
    expect(rep.project.species.length).toBe(dest.species.length);
  });

  it("rechaza archivos que no son packs", () => {
    expect(() => parsePack("no es json")).toThrow();
    expect(() => parsePack('{"format":"otro"}')).toThrow();
    expect(() => parsePack('{"format":"wpe-pack","version":1,"types":[],"name":"x"}')).toThrow();
  });
});
