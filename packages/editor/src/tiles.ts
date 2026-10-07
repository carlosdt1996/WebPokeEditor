/** Definición de tiles y generación procedural del atlas (arte original, sin assets externos). */

export const TILE = 16;
export const ATLAS_COLS = 8;
export const ATLAS_ROWS = 5;

export const TILE_DEFS = [
  { id: 0, name: "Hierba", solid: false },
  { id: 1, name: "Hierba alta", solid: false },
  { id: 2, name: "Camino", solid: false },
  { id: 3, name: "Agua", solid: true },
  { id: 4, name: "Árbol", solid: true },
  { id: 5, name: "Muro", solid: true },
  { id: 6, name: "Flores", solid: false },
  { id: 7, name: "Arena", solid: false },
  { id: 8, name: "Puerta", solid: false },
  { id: 9, name: "Suelo", solid: false },
  { id: 10, name: "Alfombra", solid: false },
  { id: 11, name: "Mostrador", solid: true },
] as const;

/** Altura 3D (en tiles) de cada tipo de tile para el modo 3D. */
export const TILE_HEIGHT: Record<number, number> = { 3: -0.25, 5: 1.2, 11: 0.7 };

/** Índices en el atlas: jugador = PLAYER_SPRITE + dir; NPC = NPC_SPRITE + look*4 + dir. dir: 0 abajo, 1 arriba, 2 izq, 3 der. */
export const PLAYER_SPRITE = 12;
export const NPC_SPRITE = 16;
export const NPC_LOOKS = 4;
/** Sprites billboard para el modo 3D (fondo transparente). */
export const BB_TREE = 32;
export const BB_TUFT = 33;
export const BB_FLOWER = 34;

function rng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13; s >>>= 0;
    s ^= s >> 17;
    s ^= s << 5; s >>>= 0;
    return s / 4294967296;
  };
}

function drawPerson(px: (i: number, x: number, y: number, c: string, w?: number, h?: number) => void, i: number, d: number, hat: string, shirt: string, pants: string) {
  px(i, 5, 14, "rgba(0,0,0,0.25)", 6, 2);
  px(i, 5, 8, shirt, 6, 5);
  px(i, 5, 13, pants, 2, 2); px(i, 9, 13, pants, 2, 2);
  px(i, 5, 2, hat, 6, 3);
  px(i, 5, 5, "#f2c9a0", 6, 4);
  if (d === 0) { px(i, 6, 6, "#222", 1, 2); px(i, 9, 6, "#222", 1, 2); }
  if (d === 2) { px(i, 6, 6, "#222", 1, 2); px(i, 4, 2, hat, 2, 2); }
  if (d === 3) { px(i, 9, 6, "#222", 1, 2); px(i, 10, 2, hat, 2, 2); }
  if (d === 1) px(i, 5, 2, hat, 6, 5);
}

/** Atlas por defecto. Si el proyecto trae un atlas propio (importado por el usuario) se usa ese. */
export function createAtlas(): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = ATLAS_COLS * TILE;
  c.height = ATLAS_ROWS * TILE;
  const g = c.getContext("2d")!;
  const px = (i: number, x: number, y: number, col: string, w = 1, h = 1) => {
    g.fillStyle = col;
    g.fillRect((i % ATLAS_COLS) * TILE + x, Math.floor(i / ATLAS_COLS) * TILE + y, w, h);
  };
  const fill = (i: number, col: string) => px(i, 0, 0, col, TILE, TILE);
  const noise = (i: number, seed: number, cols: string[], n: number) => {
    const r = rng(seed);
    for (let k = 0; k < n; k++) px(i, Math.floor(r() * TILE), Math.floor(r() * TILE), cols[Math.floor(r() * cols.length)]);
  };

  fill(0, "#5fb94d"); noise(0, 11, ["#54a845", "#6ac85a"], 28);
  fill(1, "#4a9e3f"); noise(1, 22, ["#3a8a33"], 20);
  for (let k = 0; k < 4; k++) for (let j = 0; j < 4; j++) {
    const x = k * 4 + 1, y = j * 4 + 1;
    px(1, x, y + 2, "#2f7a2b"); px(1, x + 1, y + 1, "#2f7a2b"); px(1, x + 2, y, "#8ee07a"); px(1, x + 1, y, "#2f7a2b", 1, 3);
  }
  fill(2, "#d6b779"); noise(2, 33, ["#c8a867", "#e2c88f", "#b99a5c"], 30);
  fill(3, "#3d7be0"); noise(3, 44, ["#4a8ae8", "#3569c6"], 24);
  for (let k = 0; k < 3; k++) px(3, 2 + k * 5, 4 + k * 4, "#a8ccff", 4, 1);
  fill(4, "#5fb94d"); noise(4, 11, ["#54a845"], 14);
  px(4, 6, 10, "#7a4a22", 4, 6);
  g.fillStyle = "#2a7a2e"; g.beginPath(); g.arc((4 % ATLAS_COLS) * TILE + 8, 7, 7, 0, Math.PI * 2); g.fill();
  g.fillStyle = "#38983c"; g.beginPath(); g.arc((4 % ATLAS_COLS) * TILE + 6, 5, 3.5, 0, Math.PI * 2); g.fill();
  fill(5, "#c0504a");
  for (let y = 0; y < TILE; y += 4) {
    px(5, 0, y, "#8f3a35", TILE, 1);
    for (let x = (y / 4) % 2 ? 0 : 4; x < TILE; x += 8) px(5, x, y, "#8f3a35", 1, 4);
  }
  fill(6, "#5fb94d"); noise(6, 11, ["#54a845", "#6ac85a"], 20);
  for (const [x, y, col] of [[3, 3, "#ff6b9d"], [10, 5, "#ffe066"], [6, 11, "#ffffff"], [12, 12, "#ff6b9d"]] as const) {
    px(6, x, y, col, 2, 2); px(6, x, y + 2, "#2f7a2b");
  }
  fill(7, "#ecd9a0"); noise(7, 77, ["#e0c88a", "#f5e6b8"], 26);
  // 8 puerta (sobre muro)
  fill(8, "#c0504a"); px(8, 2, 0, "#6b3a1e", 12, 16); px(8, 3, 1, "#8a5326", 10, 15); px(8, 11, 9, "#ffd54f", 2, 2);
  // 9 suelo interior (madera)
  fill(9, "#c9955a");
  for (let y = 0; y < TILE; y += 4) px(9, 0, y, "#a9763e", TILE, 1);
  noise(9, 99, ["#b9854c", "#d6a46a"], 14);
  // 10 alfombra
  fill(10, "#b23a48"); px(10, 0, 0, "#e8c25a", TILE, 1); px(10, 0, 15, "#e8c25a", TILE, 1); px(10, 0, 0, "#e8c25a", 1, TILE); px(10, 15, 0, "#e8c25a", 1, TILE);
  noise(10, 5, ["#9c2f3c"], 12);
  // 11 mostrador
  fill(11, "#c9955a"); px(11, 0, 2, "#7a5230", TILE, 12); px(11, 0, 2, "#e8d8b8", TILE, 3); px(11, 0, 13, "#5a3a20", TILE, 3);

  for (let d = 0; d < 4; d++) drawPerson(px, PLAYER_SPRITE + d, d, "#e53935", "#2a5bd7", "#2b2b45");
  const looks: [string, string, string][] = [["#6a1b9a", "#9c27b0", "#37474f"], ["#2e7d32", "#f9a825", "#4e342e"], ["#455a64", "#e0e0e0", "#263238"], ["#ef6c00", "#ffffff", "#5d4037"]];
  looks.forEach(([hat, shirt, pants], l) => { for (let d = 0; d < 4; d++) drawPerson(px, NPC_SPRITE + l * 4 + d, d, hat, shirt, pants); });
  // Billboards 3D (transparentes)
  g.fillStyle = "#7a4a22"; g.fillRect((BB_TREE % ATLAS_COLS) * TILE + 6, Math.floor(BB_TREE / ATLAS_COLS) * TILE + 10, 4, 6);
  for (const [cx, cy, r, col] of [[8, 6, 6.5, "#2a7a2e"], [6, 4.5, 3.5, "#38983c"], [10.5, 8, 3, "#256d29"]] as const) {
    g.fillStyle = col; g.beginPath(); g.arc((BB_TREE % ATLAS_COLS) * TILE + cx, Math.floor(BB_TREE / ATLAS_COLS) * TILE + cy, r, 0, Math.PI * 2); g.fill();
  }
  for (const [x, y] of [[3, 12], [7, 9], [11, 12], [5, 5], [10, 6]]) {
    px(BB_TUFT, x, y + 2, "#2f7a2b", 1, 2); px(BB_TUFT, x + 1, y + 1, "#3f9a38", 1, 3); px(BB_TUFT, x + 2, y, "#8ee07a", 1, 4);
  }
  for (const [x, y, col] of [[4, 11, "#ff6b9d"], [9, 8, "#ffe066"], [11, 12, "#ffffff"]] as const) { px(BB_FLOWER, x, y, col, 2, 2); px(BB_FLOWER, x, y + 2, "#2f7a2b", 1, 2); }
  return c;
}

/** Carga un atlas propio (PNG 128×64) y lo devuelve como canvas; null si no es válido. */
export async function atlasFromDataUrl(url: string): Promise<HTMLCanvasElement | null> {
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    if (img.width !== ATLAS_COLS * TILE || img.height !== ATLAS_ROWS * TILE) return null;
    const c = document.createElement("canvas");
    c.width = img.width; c.height = img.height;
    c.getContext("2d")!.drawImage(img, 0, 0);
    return c;
  } catch { return null; }
}
