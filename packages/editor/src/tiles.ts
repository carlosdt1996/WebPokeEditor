/** Definición de tiles y generación procedural del atlas (arte original, sin assets externos). */

export const TILE = 16;
export const ATLAS_COLS = 8;
export const ATLAS_ROWS = 2;

export const TILE_DEFS = [
  { id: 0, name: "Hierba", solid: false },
  { id: 1, name: "Hierba alta", solid: false },
  { id: 2, name: "Camino", solid: false },
  { id: 3, name: "Agua", solid: true },
  { id: 4, name: "Árbol", solid: true },
  { id: 5, name: "Muro", solid: true },
  { id: 6, name: "Flores", solid: false },
  { id: 7, name: "Arena", solid: false },
] as const;

/** Índices de sprites del jugador en el atlas: 8 + dir (0 abajo, 1 arriba, 2 izq, 3 der). */
export const PLAYER_SPRITE = 8;

function rng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13; s >>>= 0;
    s ^= s >> 17;
    s ^= s << 5; s >>>= 0;
    return s / 4294967296;
  };
}

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

  // 0 hierba
  fill(0, "#5fb94d"); noise(0, 11, ["#54a845", "#6ac85a"], 28);
  // 1 hierba alta
  fill(1, "#4a9e3f"); noise(1, 22, ["#3a8a33"], 20);
  for (let k = 0; k < 4; k++) for (let j = 0; j < 4; j++) {
    const x = k * 4 + 1, y = j * 4 + 1;
    px(1, x, y + 2, "#2f7a2b"); px(1, x + 1, y + 1, "#2f7a2b"); px(1, x + 2, y, "#8ee07a"); px(1, x + 1, y, "#2f7a2b", 1, 3);
  }
  // 2 camino
  fill(2, "#d6b779"); noise(2, 33, ["#c8a867", "#e2c88f", "#b99a5c"], 30);
  // 3 agua
  fill(3, "#3d7be0"); noise(3, 44, ["#4a8ae8", "#3569c6"], 24);
  for (let k = 0; k < 3; k++) px(3, 2 + k * 5, 4 + k * 4, "#a8ccff", 4, 1);
  // 4 árbol
  fill(4, "#5fb94d"); noise(4, 11, ["#54a845"], 14);
  px(4, 6, 10, "#7a4a22", 4, 6);
  g.fillStyle = "#2a7a2e"; g.beginPath(); g.arc(4 * 0 + (4 % ATLAS_COLS) * TILE + 8, 7, 7, 0, Math.PI * 2); g.fill();
  g.fillStyle = "#38983c"; g.beginPath(); g.arc((4 % ATLAS_COLS) * TILE + 6, 5, 3.5, 0, Math.PI * 2); g.fill();
  // 5 muro / casa
  fill(5, "#c0504a");
  for (let y = 0; y < TILE; y += 4) {
    px(5, 0, y, "#8f3a35", TILE, 1);
    for (let x = (y / 4) % 2 ? 0 : 4; x < TILE; x += 8) px(5, x, y, "#8f3a35", 1, 4);
  }
  // 6 flores
  fill(6, "#5fb94d"); noise(6, 11, ["#54a845", "#6ac85a"], 20);
  for (const [x, y, col] of [[3, 3, "#ff6b9d"], [10, 5, "#ffe066"], [6, 11, "#ffffff"], [12, 12, "#ff6b9d"]] as const) {
    px(6, x, y, col, 2, 2); px(6, x + 0, y + 2, "#2f7a2b");
  }
  // 7 arena
  fill(7, "#ecd9a0"); noise(7, 77, ["#e0c88a", "#f5e6b8"], 26);

  // Jugador: 8 abajo, 9 arriba, 10 izquierda, 11 derecha (cabeza + gorra + cuerpo)
  for (let d = 0; d < 4; d++) {
    const i = PLAYER_SPRITE + d;
    px(i, 5, 14, "rgba(0,0,0,0.25)", 6, 2);
    px(i, 5, 8, "#2a5bd7", 6, 5);              // torso
    px(i, 5, 13, "#2b2b45", 2, 2); px(i, 9, 13, "#2b2b45", 2, 2); // piernas
    px(i, 5, 2, "#e53935", 6, 3);               // gorra
    px(i, 5, 5, "#f2c9a0", 6, 4);               // cara
    if (d === 0) { px(i, 6, 6, "#222", 1, 2); px(i, 9, 6, "#222", 1, 2); }
    if (d === 2) { px(i, 6, 6, "#222", 1, 2); px(i, 4, 2, "#e53935", 2, 2); }
    if (d === 3) { px(i, 9, 6, "#222", 1, 2); px(i, 10, 2, "#e53935", 2, 2); }
    if (d === 1) px(i, 5, 2, "#c62828", 6, 5);
  }
  return c;
}
