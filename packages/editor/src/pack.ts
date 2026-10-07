/**
 * Packs: paquetes de contenido compartibles (`.wpe-pack.json`) con especies, movimientos, objetos, habilidades y mapas.
 * Sirven para compartir plantillas, mods y tilesets entre proyectos. Los tipos viajan por nombre (no por índice) para que el pack
 * encaje en proyectos con otra tabla de tipos; los ids que chocan se renombran o se omiten según la política elegida.
 */
import { type AbilityDef, type GameMap, type ItemDef, type Move, type Project, type Species, uniqueId } from "./project";

export const PACK_FORMAT = "wpe-pack";
export interface Pack {
  format: typeof PACK_FORMAT;
  version: 1;
  name: string;
  author?: string;
  description?: string;
  /** Nombres de los tipos del proyecto de origen; los índices de species/moves/abilities/items del pack apuntan aquí. */
  types: string[];
  species: Species[];
  moves: Move[];
  items: ItemDef[];
  abilities: AbilityDef[];
  maps: GameMap[];
  /** Atlas (tileset) PNG como data URL, si se incluye. */
  atlas?: string;
}

export interface PackSelection {
  species?: string[]; moves?: string[]; items?: string[]; abilities?: string[]; maps?: string[]; atlas?: boolean;
}
export interface PackMeta { name: string; author?: string; description?: string }

const clone = <T>(v: T): T => structuredClone(v);

/** Crea un pack con lo seleccionado más sus dependencias (movimientos y habilidades de las especies, evoluciones, objetos de mapas…). */
export function makePack(p: Project, sel: PackSelection, meta: PackMeta): Pack {
  const species = new Set(sel.species ?? []), moves = new Set(sel.moves ?? []), items = new Set(sel.items ?? []), abilities = new Set(sel.abilities ?? []);
  const maps = new Set(sel.maps ?? []);
  // mapas → criaturas y objetos que usan
  for (const m of p.maps.filter((k) => maps.has(k.id))) {
    for (const e of m.encounters) species.add(e);
    for (const n of m.npcs) {
      for (const t of n.team ?? []) { species.add(t.species); if (t.held) items.add(t.held); }
      for (const s of n.stock ?? []) items.add(s);
    }
  }
  // cierre transitivo de dependencias de las especies
  const queue = [...species];
  while (queue.length) {
    const id = queue.pop();
    const s = p.species.find((x) => x.id === id);
    if (!s) continue;
    for (const mv of [...s.moves, ...(s.learnset ?? []).map((l) => l.move)]) moves.add(mv);
    if (s.ability) abilities.add(s.ability);
    if (s.evolve && !species.has(s.evolve.into)) { species.add(s.evolve.into); queue.push(s.evolve.into); }
  }
  return {
    format: PACK_FORMAT, version: 1, ...meta,
    types: [...p.types],
    species: clone(p.species.filter((s) => species.has(s.id))),
    moves: clone(p.moves.filter((m) => moves.has(m.id))),
    items: clone(p.items.filter((i) => items.has(i.id))),
    abilities: clone((p.abilities ?? []).filter((a) => abilities.has(a.id))),
    maps: clone(p.maps.filter((m) => maps.has(m.id))),
    ...(sel.atlas && p.atlas ? { atlas: p.atlas } : {}),
  };
}

/** Lee y valida un pack (lanza un error legible si no lo es). */
export function parsePack(json: string): Pack {
  let d: Partial<Pack>;
  try { d = JSON.parse(json); } catch { throw new Error("El archivo no es JSON válido."); }
  if (!d || d.format !== PACK_FORMAT || d.version !== 1) throw new Error("No es un pack de WebPokeEditor (formato o versión no reconocidos).");
  if (!Array.isArray(d.types)) throw new Error("Pack inválido: faltan los nombres de tipo.");
  for (const k of ["species", "moves", "items", "abilities", "maps"] as const) { if (!Array.isArray(d[k])) throw new Error(`Pack inválido: falta la lista "${k}".`); }
  if (typeof d.name !== "string" || !d.name) throw new Error("Pack inválido: falta el nombre.");
  return d as Pack;
}

export type Conflict = "rename" | "skip" | "replace";
export interface PackResult {
  project: Project;
  added: { species: number; moves: number; items: number; abilities: number; maps: number; types: number };
  renamed: Record<string, string>;
  skipped: string[];
  warnings: string[];
}

/** Aplica un pack a una copia del proyecto. Con `rename` los ids repetidos reciben un sufijo y se actualizan las referencias internas del pack. */
export function applyPack(src: Project, pack: Pack, conflict: Conflict = "rename"): PackResult {
  const p = clone(src);
  const res: PackResult = { project: p, added: { species: 0, moves: 0, items: 0, abilities: 0, maps: 0, types: 0 }, renamed: {}, skipped: [], warnings: [] };

  // tipos por nombre
  const typeMap = pack.types.map((name) => {
    let i = p.types.findIndex((t) => t.toLowerCase() === name.toLowerCase());
    if (i < 0) {
      if (p.types.length >= 16) { res.warnings.push(`El tipo «${name}» no cabe (máximo 16): se usa «${p.types[0]}».`); return 0; }
      p.types.push(name);
      for (const row of p.typeChart) row.push(1);
      p.typeChart.push(p.types.map(() => 1));
      i = p.types.length - 1; res.added.types++;
    }
    return i;
  });
  const T = (i: number) => typeMap[i] ?? 0;

  type Coll = "species" | "moves" | "items" | "abilities" | "maps";
  const idMaps: Record<Coll, Map<string, string>> = { species: new Map(), moves: new Map(), items: new Map(), abilities: new Map(), maps: new Map() };
  const existing = (c: Coll) => (c === "abilities" ? (p.abilities ??= []) : p[c]) as { id: string }[];
  // 1.ª pasada: decidir el id final de cada elemento
  const keep: Record<Coll, { id: string }[]> = { species: [], moves: [], items: [], abilities: [], maps: [] };
  for (const c of ["species", "moves", "items", "abilities", "maps"] as Coll[]) {
    const list = existing(c);
    for (const el of pack[c] as { id: string }[]) {
      const clash = list.some((x) => x.id === el.id) || keep[c].some((x) => x.id === el.id);
      if (!clash || conflict === "replace") idMaps[c].set(el.id, el.id);
      else if (conflict === "skip") { idMaps[c].set(el.id, el.id); res.skipped.push(`${c}/${el.id}`); continue; }
      else { const nid = uniqueId([...list.map((x) => x.id), ...keep[c].map((x) => x.id)], el.id); idMaps[c].set(el.id, nid); res.renamed[`${c}/${el.id}`] = nid; }
      keep[c].push(el);
    }
  }
  const M = (c: Coll, id: string) => idMaps[c].get(id) ?? id;
  const put = <E extends { id: string }>(c: Coll, el: E) => {
    const list = existing(c);
    const i = list.findIndex((x) => x.id === el.id);
    if (i >= 0) { list[i] = el; } else { list.push(el); res.added[c]++; }
  };

  for (const a of keep.abilities as AbilityDef[]) { const n = clone(a); n.id = M("abilities", a.id); if (n.type !== undefined) n.type = T(n.type); put("abilities", n); }
  for (const m of keep.moves as Move[]) { const n = clone(m); n.id = M("moves", m.id); n.type = T(m.type); put("moves", n); }
  for (const it of keep.items as ItemDef[]) { const n = clone(it); n.id = M("items", it.id); if (n.hold?.type !== undefined) n.hold.type = T(n.hold.type); put("items", n); }
  for (const s of keep.species as Species[]) {
    const n = clone(s);
    n.id = M("species", s.id);
    n.types = s.types.map(T);
    n.moves = s.moves.map((m) => M("moves", m));
    if (n.learnset) n.learnset = n.learnset.map((l) => ({ ...l, move: M("moves", l.move) }));
    if (n.ability) n.ability = M("abilities", n.ability);
    if (n.evolve) n.evolve = { ...n.evolve, into: M("species", n.evolve.into) };
    put("species", n);
  }
  for (const m of keep.maps as GameMap[]) {
    const n = clone(m);
    n.id = M("maps", m.id);
    n.encounters = n.encounters.map((e) => M("species", e));
    for (const w of n.warps) {
      if (idMaps.maps.has(w.toMap)) w.toMap = M("maps", w.toMap);
      else if (!p.maps.some((k) => k.id === w.toMap)) res.warnings.push(`${n.name}: el salto a «${w.toMap}» no existe en este proyecto.`);
    }
    for (const npc of n.npcs) {
      for (const t of npc.team ?? []) { t.species = M("species", t.species); if (t.held) t.held = M("items", t.held); }
      if (npc.stock) npc.stock = npc.stock.map((s) => M("items", s));
    }
    put("maps", n);
  }
  if (pack.atlas && !p.atlas) p.atlas = pack.atlas;
  else if (pack.atlas && p.atlas && p.atlas !== pack.atlas) res.warnings.push("El pack incluye un tileset propio, pero el proyecto ya tiene uno: se conserva el del proyecto.");
  return res;
}
