import type { Project, Species } from "./project";

/** Criaturas generadas proceduralmente (originales, deterministas por id). Se usan si el usuario no importa un sprite propio. */

const TYPE_COLORS = ["#b8b8c8", "#f08030", "#4a90e0", "#58b848", "#f8d030", "#98d8d8", "#c03028", "#a040a0"];

function hash(s: string) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

function shade(hex: string, f: number) {
  const n = parseInt(hex.slice(1), 16);
  const c = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => Math.max(0, Math.min(255, Math.round(v * f))));
  return `rgb(${c.join(",")})`;
}

const cache = new Map<string, string>();

export function proceduralSprite(sp: Pick<Species, "id" | "types">): string {
  const key = sp.id + ":" + sp.types.join(",");
  const hit = cache.get(key);
  if (hit) return hit;
  const N = 20, S = 5;
  const c = document.createElement("canvas");
  c.width = c.height = N * S;
  const g = c.getContext("2d")!;
  let seed = hash(sp.id) || 1;
  const r = () => { seed ^= seed << 13; seed >>>= 0; seed ^= seed >> 17; seed ^= seed << 5; seed >>>= 0; return seed / 4294967296; };
  const base = TYPE_COLORS[sp.types[0] % TYPE_COLORS.length] ?? "#aaaaaa";
  const accent = TYPE_COLORS[(sp.types[1] ?? sp.types[0] + 3) % TYPE_COLORS.length] ?? "#ffffff";
  // máscara simétrica (mitad izquierda) con cuerpo central garantizado
  const half = N / 2;
  const m: number[][] = Array.from({ length: N }, () => new Array(half).fill(0));
  for (let y = 5; y < 17; y++) for (let x = 0; x < half; x++) {
    const dx = half - x, dy = y - 11;
    const inside = (dx * dx) / (6 + r() * 3) ** 2 + (dy * dy) / (5.5 + r() * 1.5) ** 2 < 1;
    if (inside) m[y][x] = 1;
  }
  const ears = 1 + Math.floor(r() * 3);
  for (let k = 0; k < ears; k++) { const x = 3 + Math.floor(r() * 5); for (let y = 2 + k; y < 6; y++) m[y][x] = 1; }
  for (let y = 15; y < 19; y++) { m[y][3 + Math.floor(r() * 2)] = 1; m[y][6] = 1; }
  for (let k = 0; k < 6; k++) { const x = Math.floor(r() * half), y = 6 + Math.floor(r() * 10); if (m[y][x]) m[y][x] = 2; }
  const at = (x: number, y: number) => (x < half ? m[y]?.[x] : m[y]?.[N - 1 - x]) ?? 0;
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const v = at(x, y);
    if (!v) continue;
    const edge = !at(x - 1, y) || !at(x + 1, y) || !at(x, y - 1) || !at(x, y + 1);
    g.fillStyle = edge ? shade(base, 0.45) : v === 2 ? accent : y > 13 ? shade(base, 0.85) : base;
    g.fillRect(x * S, y * S, S, S);
  }
  // ojos y boca
  const ey = 8;
  for (const ex of [6, 12]) { g.fillStyle = "#fff"; g.fillRect(ex * S, ey * S, 2 * S, 2 * S); g.fillStyle = "#111"; g.fillRect((ex + 1) * S, (ey + 1) * S, S, S); }
  g.fillStyle = shade(base, 0.4); g.fillRect(9 * S, 12 * S, 2 * S, S);
  const url = c.toDataURL();
  cache.set(key, url);
  return url;
}

/** URL de la imagen a mostrar para una especie: sprite importado por el usuario o el procedural. */
export function speciesImage(p: Project, id: string): string {
  const sp = p.species.find((s) => s.id === id);
  if (!sp) return proceduralSprite({ id, types: [0] });
  return sp.sprite || proceduralSprite(sp);
}

/** Lee un archivo de imagen del usuario, lo reescala (máx. `max` px) y devuelve data URL PNG. Se guarda solo en el proyecto del usuario. */
export async function importImage(file: File, max = 128): Promise<string> {
  const bmp = await createImageBitmap(file);
  const k = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(bmp.width * k)); c.height = Math.max(1, Math.round(bmp.height * k));
  const g = c.getContext("2d")!;
  g.imageSmoothingEnabled = false;
  g.drawImage(bmp, 0, 0, c.width, c.height);
  return c.toDataURL("image/png");
}
