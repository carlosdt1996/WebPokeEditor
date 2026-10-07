import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { Engine } from "./engine";
import { Game, type Host } from "./game";
import { archipelagoProject } from "./templates";
import { defaultProject, migrate, parseProject, validate, type Npc } from "./project";
import { parseScript } from "./script";

const wasm = () => readFileSync(new URL("../public/engine_core.wasm", import.meta.url));

function setup(picks: number[]) {
  const said: string[] = [];
  const host: Host = {
    loadMap: () => {}, battle: async () => {}, say: (m) => said.push(m),
    dialog: async (_s, lines) => { said.push(...lines); },
    choose: async () => picks.shift() ?? 0,
  };
  return { host, said };
}

describe("dinero, tiendas y objetos clave", () => {
  it("migración v5 → v6 añade dinero y precios a los objetos de ejemplo", () => {
    const v5 = { ...defaultProject(), schemaVersion: 5 } as Record<string, unknown>;
    delete v5.money;
    for (const it of v5.items as { price?: number }[]) delete it.price;
    const p = migrate(v5);
    expect(p.schemaVersion).toBe(6);
    expect(p.money).toBe(0);
    expect(p.items.find((i) => i.id === "potion")?.price).toBe(100);
    expect(validate(p)).toEqual([]);
  });

  it("validación: una tienda necesita objetos existentes y con precio", () => {
    const p = archipelagoProject();
    const shop = p.maps.find((m) => m.id === "centro-coral")!.npcs.find((n) => n.kind === "shop")!;
    expect(validate(p)).toEqual([]);
    shop.stock = ["no-existe"];
    expect(validate(p).some((e) => e.includes("inexistente"))).toBe(true);
    shop.stock = ["medallero"];
    expect(validate(p).some((e) => e.includes("no tiene precio"))).toBe(true);
    shop.stock = [];
    expect(validate(p).some((e) => e.includes("no tiene objetos"))).toBe(true);
    expect(() => parseProject(JSON.stringify(p))).toThrow();
  });

  it("comprar y vender: se cobra, se entrega, se vende a la mitad y los objetos clave no se venden", async () => {
    const e = await Engine.load(wasm());
    const p = archipelagoProject();
    p.money = 250;
    p.inventory = { medallero: 1, ball: 2 };
    const shop = p.maps.find((m) => m.id === "centro-coral")!.npcs.find((n) => n.kind === "shop") as Npc;
    // Comprar→Poción (100) · Comprar→Superpoción (300: no alcanza) · Vender→Bola (75) · Salir
    const { host, said } = setup([0, 0, 0, 1, 1, 1, 2]);
    const g = new Game(p, e, host);
    await g.shop(shop);
    expect(g.inv.potion).toBe(1);
    expect(g.money).toBe(250 - 100 + 75);
    expect(g.inv.ball).toBe(1);
    expect(said.some((l) => l.includes("No tienes suficientes"))).toBe(true);
    expect(said.some((l) => l.includes("Gracias por tu compra de Poción"))).toBe(true);
  });

  it("los guiones cobran con `add money`, ven el dinero y las unidades de cada objeto", async () => {
    const e = await Engine.load(wasm());
    const p = archipelagoProject();
    p.money = 500;
    p.inventory = { medallero: 1 };
    const { host, said } = setup([]);
    const g = new Game(p, e, host);
    const r = parseScript("if item_medallero >= 1\nadd money -200\nsay Tienes {money}.\nend\nif item_ball >= 1\nsay no debería verse\nend");
    if (!r.ok) throw new Error(r.errors.join());
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (g as any).exec(r.code, { say: async (l: string[]) => { said.push(...l); }, give: () => {}, heal: () => {}, battle: async () => {}, givemon: () => {}, warp: async () => {}, choose: async () => 0, equip: () => {} });
    expect(g.money).toBe(300);
    expect(said).toContain("Tienes 300.");
    expect(said.some((l) => l.includes("no debería"))).toBe(false);
  });
});
