/** Modelo de datos del proyecto (ver docs/architecture/data-model.md). Todo es dato serializable. */

export const SCHEMA_VERSION = 1;

export interface Stats { hp: number; atk: number; def: number; spa: number; spd: number; spe: number }
export const STAT_KEYS: (keyof Stats)[] = ["hp", "atk", "def", "spa", "spd", "spe"];

export interface Species { id: string; name: string; types: number[]; stats: Stats; moves: string[] }
export interface Move { id: string; name: string; type: number; category: "physical" | "special"; power: number; accuracy: number }

export interface Project {
  schemaVersion: number;
  name: string;
  seed: number;
  map: { w: number; h: number; tiles: string; spawn: { x: number; y: number } };
  /** Nombres de tipo; el índice es el id de tipo. */
  types: string[];
  /** typeChart[atacante][defensor] = multiplicador (0, 0.5, 1, 2). */
  typeChart: number[][];
  species: Species[];
  moves: Move[];
  /** Ids de especies que aparecen en hierba alta. */
  encounters: string[];
}

export function encodeTiles(t: Uint8Array): string {
  let s = "";
  for (let i = 0; i < t.length; i += 0x8000) s += String.fromCharCode(...t.subarray(i, i + 0x8000));
  return btoa(s);
}
export function decodeTiles(b64: string, n: number): Uint8Array {
  const s = atob(b64);
  const out = new Uint8Array(n);
  for (let i = 0; i < Math.min(n, s.length); i++) out[i] = s.charCodeAt(i);
  return out;
}

const st = (hp: number, atk: number, def: number, spa: number, spd: number, spe: number): Stats => ({ hp, atk, def, spa, spd, spe });

/** Criaturas y movimientos originales de demostración. */
export function defaultProject(): Project {
  const w = 24, h = 18;
  const tiles = new Uint8Array(w * h); // hierba
  const set = (x: number, y: number, t: number) => { if (x >= 0 && y >= 0 && x < w && y < h) tiles[y * w + x] = t; };
  for (let x = 0; x < w; x++) { set(x, 0, 4); set(x, h - 1, 4); }
  for (let y = 0; y < h; y++) { set(0, y, 4); set(w - 1, y, 4); }
  for (let y = 1; y < h - 1; y++) set(11, y, 2); // camino vertical
  for (let x = 1; x < w - 1; x++) set(x, 9, 2); // camino horizontal
  for (let y = 11; y < 16; y++) for (let x = 2; x < 9; x++) set(x, y, 1); // hierba alta
  for (let y = 2; y < 6; y++) for (let x = 15; x < 21; x++) set(x, y, 3); // lago
  for (let x = 14; x < 22; x++) { set(x, 6, 7); }
  for (let y = 2; y < 5; y++) for (let x = 3; x < 8; x++) set(x, y, y === 2 ? 5 : 5); // casa
  set(5, 4, 2); set(5, 5, 2); set(5, 6, 2); set(5, 7, 2); set(5, 8, 2);
  for (const [x, y] of [[9, 3], [9, 6], [13, 12], [14, 14], [20, 14]]) set(x, y, 4);
  for (const [x, y] of [[13, 3], [18, 11], [19, 12], [16, 15], [3, 7], [7, 7]]) set(x, y, 6);

  return {
    schemaVersion: SCHEMA_VERSION,
    name: "Mi Fangame",
    seed: 12345,
    map: { w, h, tiles: encodeTiles(tiles), spawn: { x: 11, y: 8 } },
    types: ["Normal", "Fuego", "Agua", "Planta"],
    typeChart: [
      [1, 1, 1, 1],
      [1, 0.5, 0.5, 2],
      [1, 2, 0.5, 0.5],
      [1, 0.5, 2, 0.5],
    ],
    species: [
      { id: "flamito", name: "Flamito", types: [1], stats: st(44, 52, 43, 60, 50, 65), moves: ["embestida", "ascua"] },
      { id: "hojin", name: "Hojín", types: [3], stats: st(45, 49, 49, 65, 65, 45), moves: ["embestida", "hojaje"] },
      { id: "aquin", name: "Aquín", types: [2], stats: st(50, 48, 65, 50, 64, 43), moves: ["embestida", "chorro"] },
      { id: "pelusin", name: "Pelusín", types: [0], stats: st(40, 45, 35, 30, 35, 56), moves: ["embestida"] },
    ],
    moves: [
      { id: "embestida", name: "Embestida", type: 0, category: "physical", power: 40, accuracy: 100 },
      { id: "ascua", name: "Ascua", type: 1, category: "special", power: 40, accuracy: 100 },
      { id: "hojaje", name: "Hojaje", type: 3, category: "physical", power: 55, accuracy: 95 },
      { id: "chorro", name: "Chorro", type: 2, category: "special", power: 40, accuracy: 100 },
    ],
    encounters: ["pelusin", "pelusin", "hojin", "flamito", "aquin"],
  };
}

/** Valida y reporta problemas (referencias rotas, tamaños). Devuelve lista vacía si todo está bien. */
export function validate(p: Project): string[] {
  const errs: string[] = [];
  if (p.schemaVersion !== SCHEMA_VERSION) errs.push(`schemaVersion ${p.schemaVersion} no soportado`);
  const { w, h } = p.map;
  if (!(w >= 1 && w <= 128 && h >= 1 && h <= 128)) errs.push("Tamaño de mapa fuera de rango (1–128)");
  if (p.map.spawn.x >= w || p.map.spawn.y >= h) errs.push("El punto de inicio está fuera del mapa");
  const speciesIds = new Set(p.species.map((s) => s.id));
  const moveIds = new Set(p.moves.map((m) => m.id));
  if (speciesIds.size !== p.species.length) errs.push("Ids de especie duplicados");
  if (moveIds.size !== p.moves.length) errs.push("Ids de movimiento duplicados");
  for (const s of p.species) {
    for (const t of s.types) if (t < 0 || t >= p.types.length) errs.push(`${s.name}: tipo inválido`);
    for (const m of s.moves) if (!moveIds.has(m)) errs.push(`${s.name}: movimiento inexistente "${m}"`);
  }
  for (const m of p.moves) if (m.type < 0 || m.type >= p.types.length) errs.push(`${m.name}: tipo inválido`);
  for (const e of p.encounters) if (!speciesIds.has(e)) errs.push(`Encuentro con especie inexistente "${e}"`);
  if (p.typeChart.length !== p.types.length || p.typeChart.some((r) => r.length !== p.types.length)) errs.push("typeChart no coincide con los tipos");
  return errs;
}

export function parseProject(json: string): Project {
  const p = JSON.parse(json) as Project;
  const errs = validate(p);
  if (errs.length) throw new Error("Proyecto inválido:\n- " + errs.join("\n- "));
  return p;
}

/** Multiplicador ×100 de efectividad y STAB. */
export function effectiveness(p: Project, moveType: number, defTypes: number[]): number {
  return defTypes.reduce((a, t) => a * (p.typeChart[moveType]?.[t] ?? 1), 1);
}
export function maxHp(base: number, level: number) { return Math.floor((2 * base * level) / 100) + level + 10; }
export function statAt(base: number, level: number) { return Math.floor((2 * base * level) / 100) + 5; }

const KEY = "webpokeeditor.project.v1";
export function saveLocal(p: Project) { try { localStorage.setItem(KEY, JSON.stringify(p)); } catch { /* cuota/privado */ } }
export function loadLocal(): Project | null {
  try {
    const s = localStorage.getItem(KEY);
    return s ? parseProject(s) : null;
  } catch { return null; }
}
