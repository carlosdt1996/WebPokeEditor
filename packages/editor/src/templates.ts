/**
 * Plantillas de proyecto. «Archipiélago de la Marea» es una región ORIGINAL (nombres, mapas, personajes y
 * criaturas propios) con la estructura clásica de un RPG de captura: pueblo inicial, rutas, ciudades con
 * gimnasio y medalla, centros de curación, tiendas, una cueva y una liga final.
 */
import { Grid, type GameMap, type Move, type Npc, type Project, SCHEMA_VERSION, type Species, type StatusKind, type TeamMember, type Trigger, type Warp, defaultProject, defaultWeatherRules, encodeTiles, st } from "./project";

// ---------- utilidades de construcción ----------
const rng = (seed: number) => { let s = seed >>> 0 || 1; return () => { s ^= s << 13; s >>>= 0; s ^= s >> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; }; };
const hline = (g: Grid, y: number, x0: number, x1: number, t = 2) => g.rect(Math.min(x0, x1), y, Math.max(x0, x1), y, t);
const vline = (g: Grid, x: number, y0: number, y1: number, t = 2) => g.rect(x, Math.min(y0, y1), x, Math.max(y0, y1), t);
/** Esparce objetos (capa superior) sobre hierba libre. */
function scatter(g: Grid, ids: number | number[], n: number, seed: number, keep: (x: number, y: number) => boolean = () => true) {
  const r = rng(seed), list = Array.isArray(ids) ? ids : [ids];
  for (let k = 0, placed = 0; placed < n && k < n * 40; k++) {
    const x = 1 + Math.floor(r() * (g.w - 2)), y = 1 + Math.floor(r() * (g.h - 2));
    if ((g.t[y * g.w + x] === 0 || g.t[y * g.w + x] === 1) && !g.o[y * g.w + x] && keep(x, y)) { g.obj(x, y, list[Math.floor(r() * list.length)]); placed++; }
  }
}
function house(g: Grid, x: number, y: number, w: number, h: number, doorX?: number) {
  g.rect(x, y, x + w - 1, y + h - 1, 5);
  if (doorX !== undefined) { g.set(doorX, y + h - 1, 8); g.set(doorX, y + h, 2); }
}
function lake(g: Grid, x0: number, y0: number, x1: number, y1: number) {
  g.rect(x0 - 1, y0 - 1, x1 + 1, y1 + 1, 7);
  g.rect(x0, y0, x1, y1, 3);
}
function hill(g: Grid, cx: number, cy: number, r: number, hmax: number) {
  for (let y = cy - r; y <= cy + r; y++) for (let x = cx - r; x <= cx + r; x++) {
    const d = Math.hypot(x - cx, y - cy);
    if (x >= 0 && y >= 0 && x < g.w && y < g.h && d <= r) g.hg[y * g.w + x] = Math.max(g.hg[y * g.w + x], Math.round(hmax * (1 - d / r)));
  }
}
const grass = (w: number, h: number) => new Grid(w, h, 0);
/** Bosque en el borde con huecos (los accesos) en `gaps`. */
function frame(g: Grid, gaps: [number, number][]) { g.border(4); for (const [x, y] of gaps) g.set(x, y, 2); }

function npc(id: string, x: number, y: number, look: number, dir: number, name: string, lines: string[], extra: Partial<Npc> = {}): Npc {
  return { id, x, y, look, dir, kind: "talk", name, lines, ...extra };
}
const money = (n: number) => `add money ${n}\nsay Ganas ${n} monedas por la victoria.`;
function trainer(id: string, x: number, y: number, look: number, dir: number, name: string, line: string, team: TeamMember[], extra: Partial<Npc> = {}): Npc {
  const prize = 60 * Math.max(...team.map((t) => t.level)) / 3 | 0;
  return { id, x, y, look, dir, kind: "trainer", name, lines: [line], team, defeatedLines: ["¡Me has ganado con todas las de la ley!"], winScript: money(prize), ...extra };
}
function warp(x: number, y: number, toMap: string, toX: number, toY: number): Warp { return { x, y, toMap, toX, toY }; }
function gate(x: number, y: number, flag: string, msg: string, backMap: string, bx: number, by: number): Trigger {
  return { x, y, name: "Control", once: false, script: `ifnot ${flag}\nsay (Guardia) ${msg}\nwarp ${backMap} ${bx} ${by}\nend` };
}
function build(id: string, name: string, g: Grid, extra: Partial<GameMap> = {}): GameMap {
  return {
    id, name, w: g.w, h: g.h, tiles: encodeTiles(g.t), npcs: [], warps: [], encounters: [], encounterLevel: [3, 6],
    objects: g.o.some((v) => v) ? encodeTiles(g.o) : undefined,
    heights: g.hg.some((v) => v) ? encodeTiles(Uint8Array.from(g.hg, (v) => v + 128)) : undefined,
    ...extra,
  };
}
/** Habitación interior con puerta abajo (el tile 8 y el salto de vuelta). */
function room(id: string, name: string, w: number, h: number, doorX: number, back: [string, number, number], extra: Partial<GameMap> = {}, decorate?: (g: Grid) => void): GameMap {
  const g = new Grid(w, h, 9);
  g.border(5);
  g.set(doorX, h - 1, 8);
  g.set(doorX, h - 2, 10);
  decorate?.(g);
  return build(id, name, g, { warps: [warp(doorX, h - 1, back[0], back[1], back[2])], ...extra });
}

// ---------- datos de juego ----------
const TYPES = ["Normal", "Fuego", "Agua", "Planta", "Eléctrico", "Roca", "Volador", "Tierra"];
function chart(): number[][] {
  const c = TYPES.map(() => TYPES.map(() => 1));
  const set = (a: number, d: number[], v: number) => { for (const x of d) c[a][x] = v; };
  set(0, [5], 0.5);
  set(1, [3], 2); set(1, [1, 2, 5], 0.5);
  set(2, [1, 5, 7], 2); set(2, [2, 3], 0.5);
  set(3, [2, 5, 7], 2); set(3, [1, 3, 6], 0.5);
  set(4, [2, 6], 2); set(4, [3, 4], 0.5); set(4, [7], 0);
  set(5, [1, 6], 2); set(5, [7], 0.5);
  set(6, [3], 2); set(6, [4, 5], 0.5);
  set(7, [1, 4, 5], 2); set(7, [3], 0.5); set(7, [6], 0);
  return c;
}
const [NORMAL, FUEGO, AGUA, PLANTA, ELEC, ROCA, VOLADOR, TIERRA] = [0, 1, 2, 3, 4, 5, 6, 7];

function mv(id: string, name: string, type: number, category: Move["category"], power: number, accuracy: number, effect?: Move["effect"]): Move {
  return { id, name, type, category, power, accuracy, ...(effect ? { effect } : {}) };
}
const status = (kind: StatusKind, chance: number) => ({ status: { kind, chance } });
const MOVES: Move[] = [
  mv("embestida", "Embestida", NORMAL, "physical", 40, 100),
  mv("ataque-rapido", "Ataque Rápido", NORMAL, "physical", 40, 100, { priority: 1 }),
  mv("garra", "Garra", NORMAL, "physical", 70, 95),
  mv("cabezazo", "Cabezazo", NORMAL, "physical", 90, 90, { recoil: 25 }),
  mv("doble-golpe", "Doble Golpe", NORMAL, "physical", 25, 100, { hits: { min: 2, max: 5 } }),
  mv("corte", "Corte Cruzado", NORMAL, "physical", 70, 100, { crit: 3 }),
  mv("hiperrayo", "Hiperrayo", NORMAL, "special", 120, 90, { recharge: true }),
  mv("danza", "Danza Espada", NORMAL, "physical", 0, 100, { stat: { stat: "atk", stages: 2, target: "self", chance: 100 } }),
  mv("respiro", "Respiro", NORMAL, "special", 0, 100, { heal: 50 }),
  mv("ascua", "Ascua", FUEGO, "special", 40, 100, { ...status("burn", 10) }),
  mv("lanzallamas", "Lanzallamas", FUEGO, "special", 90, 100, { ...status("burn", 10) }),
  mv("dia-soleado", "Día Soleado", FUEGO, "special", 0, 100, { weather: "sun" }),
  mv("chorro", "Chorro", AGUA, "special", 40, 100),
  mv("cascada", "Cascada", AGUA, "physical", 80, 100),
  mv("danza-lluvia", "Danza Lluvia", AGUA, "special", 0, 100, { weather: "rain" }),
  mv("hojaje", "Hojaje", PLANTA, "physical", 55, 95),
  mv("hoja-afilada", "Hoja Afilada", PLANTA, "physical", 55, 95, { crit: 1 }),
  mv("absorbe", "Absorbe", PLANTA, "special", 40, 100, { drain: 50 }),
  mv("rayo-solar", "Rayo Solar", PLANTA, "special", 110, 100, { charge: true }),
  mv("somnifero", "Somnífero", PLANTA, "special", 0, 75, { ...status("sleep", 100) }),
  mv("polvo-venenoso", "Polvo Venenoso", PLANTA, "special", 0, 75, { ...status("poison", 100) }),
  mv("campo-hierba", "Campo de Hierba", PLANTA, "special", 0, 100, { terrain: true }),
  mv("impactrueno", "Impactrueno", ELEC, "special", 40, 100, { ...status("paralysis", 30) }),
  mv("rayo", "Rayo", ELEC, "special", 90, 100, { ...status("paralysis", 10) }),
  mv("onda-trueno", "Onda Trueno", ELEC, "special", 0, 90, { ...status("paralysis", 100) }),
  mv("lanzarrocas", "Lanzarrocas", ROCA, "physical", 50, 90),
  mv("avalancha", "Avalancha", ROCA, "physical", 75, 90),
  mv("tornado", "Tornado", VOLADOR, "special", 40, 100),
  mv("ataque-ala", "Ataque Ala", VOLADOR, "physical", 60, 100),
  mv("terremoto", "Terremoto", TIERRA, "physical", 100, 100),
  mv("ataque-arena", "Ataque Arena", TIERRA, "special", 0, 100, { stat: { stat: "acc", stages: -1, target: "foe", chance: 100 } }),
];

type Sp = [id: string, name: string, types: number[], stats: [number, number, number, number, number, number], moves: string[], learn: [number, string][], evo?: [number, string], ability?: string];
const SPECIES: Sp[] = [
  ["brasito", "Brasito", [FUEGO], [45, 55, 40, 60, 45, 60], ["garra", "ascua"], [[8, "ataque-rapido"], [12, "dia-soleado"]], [16, "brasaron"], "mar-llamas"],
  ["brasaron", "Brasarón", [FUEGO], [65, 80, 60, 85, 65, 80], ["garra", "ascua"], [[20, "lanzallamas"], [24, "corte"]], [36, "infernal"], "mar-llamas"],
  ["infernal", "Infernal", [FUEGO, VOLADOR], [90, 100, 80, 115, 85, 100], ["lanzallamas", "ataque-ala"], [[40, "cabezazo"], [44, "hiperrayo"]], undefined, "sequia"],
  ["hojito", "Hojito", [PLANTA], [45, 50, 50, 60, 60, 45], ["embestida", "hojaje"], [[6, "somnifero"], [10, "absorbe"]], [16, "frondon"], "cuerpo-sano"],
  ["frondon", "Frondón", [PLANTA], [65, 70, 70, 85, 80, 60], ["hojaje", "absorbe"], [[18, "hoja-afilada"], [22, "polvo-venenoso"], [28, "campo-hierba"]], [36, "selvatico"], "cuerpo-sano"],
  ["selvatico", "Selvático", [PLANTA, TIERRA], [90, 95, 95, 110, 100, 70], ["hoja-afilada", "rayo-solar"], [[40, "terremoto"]], undefined, "cuerpo-sano"],
  ["gotin", "Gotín", [AGUA], [50, 48, 55, 55, 55, 43], ["embestida", "chorro"], [[8, "danza-lluvia"], [12, "ataque-rapido"]], [16, "marejon"], "absorbe-agua"],
  ["marejon", "Marejón", [AGUA], [70, 70, 75, 75, 75, 60], ["chorro", "garra"], [[20, "cascada"], [26, "respiro"]], [36, "tsunamo"], "absorbe-agua"],
  ["tsunamo", "Tsunamo", [AGUA, TIERRA], [95, 95, 100, 110, 100, 70], ["cascada", "terremoto"], [[40, "hiperrayo"]], undefined, "llovizna"],
  ["pelusin", "Pelusín", [NORMAL], [40, 45, 35, 30, 35, 56], ["embestida"], [[4, "ataque-rapido"], [6, "doble-golpe"], [9, "danza"]], undefined, "velocista"],
  ["alete", "Alete", [VOLADOR], [40, 45, 35, 35, 35, 56], ["embestida", "tornado"], [[7, "ataque-rapido"], [12, "ataque-ala"]], [18, "gaviotin"], "velocista"],
  ["gaviotin", "Gaviotín", [VOLADOR], [60, 70, 55, 60, 55, 85], ["ataque-ala", "tornado"], [[24, "corte"], [30, "danza"]], undefined, "velocista"],
  ["chispin", "Chispín", [ELEC], [40, 40, 35, 60, 40, 70], ["embestida", "impactrueno"], [[9, "onda-trueno"], [14, "ataque-rapido"]], [22, "voltaico"], "pararrayos"],
  ["voltaico", "Voltaico", [ELEC], [65, 65, 55, 100, 70, 95], ["impactrueno", "rayo"], [[26, "onda-trueno"], [32, "hiperrayo"]], undefined, "pararrayos"],
  ["piedrin", "Piedrín", [ROCA], [45, 60, 80, 30, 40, 25], ["embestida", "lanzarrocas"], [[10, "ataque-arena"]], [24, "rocalon"], "intimidar"],
  ["rocalon", "Rocalón", [ROCA, TIERRA], [75, 95, 110, 45, 60, 35], ["lanzarrocas", "avalancha"], [[28, "terremoto"], [34, "cabezazo"]], undefined, "intimidar"],
  ["terron", "Terrón", [TIERRA], [50, 60, 55, 35, 45, 40], ["embestida", "ataque-arena"], [[12, "lanzarrocas"]], [26, "dunon"], "levitar"],
  ["dunon", "Dunón", [TIERRA], [80, 100, 85, 55, 65, 65], ["terremoto", "garra"], [[30, "avalancha"]], undefined, "levitar"],
  ["caracolin", "Caracolín", [AGUA, ROCA], [55, 55, 85, 50, 60, 30], ["chorro", "lanzarrocas"], [[14, "respiro"], [22, "cascada"]], undefined, "absorbe-agua"],
  ["murcio", "Murcio", [VOLADOR, TIERRA], [60, 70, 50, 50, 50, 75], ["ataque-ala", "ataque-arena"], [[16, "corte"]], undefined, "levitar"],
];
const species = (): Species[] => SPECIES.map(([id, name, types, s, moves, learn, evo, ability]) => ({
  id, name, types, stats: st(...s), moves, learnset: learn.map(([level, move]) => ({ level, move })), ...(evo ? { evolve: { level: evo[0], into: evo[1] } } : {}), ...(ability ? { ability } : {}),
}));
const mon = (species: string, level: number, held?: string): TeamMember => ({ species, level, ...(held ? { held } : {}) });

// ---------- objetos, habilidades y guiones comunes ----------
const abilities = (): Project["abilities"] => [
  { id: "mar-llamas", name: "Mar de Llamas", kind: "pinch", type: FUEGO, description: "Con pocos PS, sus ataques de Fuego son más potentes." },
  { id: "absorbe-agua", name: "Absorbe Agua", kind: "absorb", type: AGUA, amount: 25, description: "Los ataques de Agua lo curan." },
  { id: "pararrayos", name: "Pararrayos", kind: "absorb", type: ELEC, amount: 25, description: "Los ataques Eléctricos lo curan." },
  { id: "levitar", name: "Levitar", kind: "immune", type: TIERRA, description: "Inmune a los ataques de Tierra." },
  { id: "intimidar", name: "Intimidar", kind: "intimidate", description: "Al entrar, baja el Ataque del rival." },
  { id: "velocista", name: "Velocista", kind: "speedBoost", description: "Su Velocidad sube cada turno." },
  { id: "cuerpo-sano", name: "Cuerpo Sano", kind: "statusImmune", status: "poison", description: "No se puede envenenar." },
  { id: "sequia", name: "Sequía", kind: "weather", weather: "sun", description: "Al entrar, el sol brilla 5 turnos." },
  { id: "llovizna", name: "Llovizna", kind: "weather", weather: "rain", description: "Al entrar, llueve 5 turnos." },
];

const PRICES: [string, string, number][] = [["potion", "Poción", 100], ["superpotion", "Superpoción", 300], ["ball", "Bola", 150], ["superball", "Superbola", 400], ["antidoto", "Cura Total", 80]];
/** Tienda por guion: elige un objeto, comprueba el dinero (variable `money`) y lo entrega. */
function shopScript(): string {
  const head = `say ¡Bienvenido! Llevas {money} monedas.\nchoice ${PRICES.map(([, n, c]) => `${n} (${c})`).join(" | ")} | Salir\n`;
  const body = PRICES.map(([id, n, cost], i) => `if choice == ${i}\nif money >= ${cost}\nadd money -${cost}\ngive ${id} 1\nsay ¡Gracias por tu compra de ${n}!\nelse\nsay No tienes suficientes monedas.\nend\nend`).join("\n");
  return head + body;
}
const centro = (id: string, name: string, back: [string, number, number]): GameMap =>
  room(id, `Centro de ${name}`, 12, 9, 6, back, {
    npcs: [
      npc("enfermera", 6, 3, 2, 0, "Enfermera", ["¡Bienvenido al Centro de Criaturas! Déjame cuidar de tu equipo...", "¡Listo! Tu equipo está como nuevo. ¡Vuelve cuando quieras!"], { kind: "healer" }),
      npc("tendero", 10, 5, 3, 2, "Tendero", [], { kind: "script", script: shopScript() }),
      npc("viajero", 2, 5, 1, 3, "Viajero", ["Dicen que más allá del último gimnasio hay una Liga con cuatro maestros...", "Guarda tus mejores objetos para allí."]),
    ],
  }, (g) => { for (const x of [4, 5, 7, 8]) g.set(x, 3, 11); });

const gymTable = (g: Grid) => { g.rect(6, 2, 7, 10, 10); for (const [x, y] of [[2, 2], [11, 2], [2, 9], [11, 9]]) g.set(x, y, 11); };
function gym(id: string, name: string, back: [string, number, number], leader: Npc, aides: Npc[]): GameMap {
  return room(id, name, 14, 12, 7, back, { npcs: [leader, ...aides] }, gymTable);
}
function leader(id: string, name: string, look: number, team: TeamMember[], medal: number, medalName: string, quote: string, win: string): Npc {
  return {
    id, x: 7, y: 2, look, dir: 0, kind: "trainer", name, lines: [quote], team, defeatedLines: [win],
    winScript: `flag medalla${medal}\nadd medallas 1\nadd money ${300 * medal + 500}\ngive superpotion 2\nsay Toma la ${medalName}. Con ella, tus criaturas te respetarán más.\nsay Llevas {medallas} medalla(s).`,
  };
}

// ---------- mapas ----------
function brisa(): GameMap {
  const g = grass(22, 16);
  frame(g, [[21, 9]]);
  hline(g, 9, 1, 21);
  house(g, 3, 3, 5, 4, 5); vline(g, 5, 7, 9);
  house(g, 13, 3, 6, 4, 15); vline(g, 15, 7, 9);
  lake(g, 3, 12, 6, 13);
  hill(g, 17, 12, 3, 3);
  for (const [x, y] of [[9, 11], [10, 12], [11, 11], [12, 12], [10, 6]]) g.set(x, y, 6);
  scatter(g, 12, 8, 11, (_, y) => y !== 9);
  scatter(g, 13, 8, 12);
  scatter(g, 14, 8, 13);
  return build("brisa", "Pueblo Brisa", g, {
    warps: [warp(5, 6, "casa", 5, 6), warp(15, 6, "lab", 6, 7), warp(21, 9, "ruta1", 1, 7)],
    triggers: [gate(20, 9, "starter", "Aún no tienes compañero. Pasa por el laboratorio del profesor.", "brisa", 18, 9)],
    npcs: [
      npc("vecina", 9, 10, 0, 3, "Vecina", ["¡Qué buen día para viajar!", "El profesor Cedro te espera en el laboratorio."]),
      npc("pescador", 8, 13, 3, 2, "Pescador", ["Por el este se llega a Villa Coral. Allí hay un gimnasio.", "Con una buena caña y paciencia se pica de todo."]),
    ],
    onEnter: "ifnot init\nset money 3000\nflag init\nend",
  });
}
const casa = (): GameMap => room("casa", "Tu casa", 10, 8, 5, ["brisa", 5, 7], {
  npcs: [npc("mama", 3, 3, 0, 0, "Mamá", ["¡Hola, cariño! Hoy es tu gran día.", "Pasa por el laboratorio: el profesor tiene un regalo para ti.", "Y recuerda: si te hieres, descansa en un Centro de Criaturas."])],
}, (g) => { for (const x of [6, 7]) g.set(x, 2, 11); });
const lab = (): GameMap => room("lab", "Laboratorio del Prof. Cedro", 12, 9, 6, ["brisa", 15, 7], {
  npcs: [
    npc("cedro", 6, 2, 2, 0, "Prof. Cedro", [], {
      kind: "script",
      script: [
        "if starter", "say ¡Cuida de tu compañero! Los gimnasios del archipiélago te esperan al este.", "return", "end",
        "say ¡Bienvenido al archipiélago de la Marea! Antes de salir, elige a tu primer compañero.",
        "choice Brasito (Fuego) | Hojito (Planta) | Gotín (Agua)",
        "if choice == 0", "givemon brasito 5", "end", "if choice == 1", "givemon hojito 5", "end", "if choice == 2", "givemon gotin 5", "end",
        "give ball 5", "give potion 3", "flag starter",
        "say ¡Gran elección! Toma también unas bolas y pociones.", "say Consigue las cuatro medallas y desafía la Liga. ¡Buen viaje!",
      ].join("\n"),
    }),
    npc("ayudante", 2, 5, 1, 3, "Ayudante", ["Las criaturas evolucionan al subir de nivel.", "Y los objetos equipables dan ventajas en combate: ¡pruébalos!"]),
  ],
}, (g) => { for (const x of [3, 4, 8, 9]) g.set(x, 2, 11); });

function ruta1(): GameMap {
  const g = grass(26, 14);
  frame(g, [[0, 7], [25, 7]]);
  hline(g, 7, 1, 24);
  g.rect(4, 2, 9, 5, 1); g.rect(14, 9, 21, 11, 1); g.rect(15, 2, 19, 4, 1);
  lake(g, 3, 10, 6, 11);
  scatter(g, 12, 10, 21, (_, y) => y !== 7);
  scatter(g, 13, 8, 22); scatter(g, 14, 8, 23);
  return build("ruta1", "Ruta 1", g, {
    warps: [warp(0, 7, "brisa", 20, 9), warp(25, 7, "coral", 1, 8)],
    encounters: ["pelusin", "pelusin", "alete", "hojito", "gotin"], encounterLevel: [3, 5],
    npcs: [
      trainer("tomas", 11, 5, 1, 0, "Niño Tomás", "¡Mi equipo es pequeño pero valiente!", [mon("pelusin", 4), mon("alete", 4)]),
      trainer("nuria", 19, 8, 2, 1, "Campista Nuria", "¡Acampar da mucha energía!", [mon("hojito", 5)]),
    ],
  });
}

function townBase(w: number, h: number, mainY: number, gaps: [number, number][]): Grid {
  const g = grass(w, h);
  frame(g, gaps);
  hline(g, mainY, 1, w - 2);
  return g;
}
/** Costa al sur de las ciudades marineras. */
function sea(g: Grid, fromY: number) { g.rect(1, fromY, g.w - 2, fromY, 7); g.rect(1, fromY + 1, g.w - 2, g.h - 2, 3); }

function coral(): GameMap {
  const g = townBase(26, 18, 8, [[0, 8], [25, 8]]);
  sea(g, 14);
  house(g, 4, 3, 6, 4, 6); vline(g, 6, 7, 8);
  house(g, 14, 2, 8, 5, 18); vline(g, 18, 7, 8);
  house(g, 4, 10, 5, 4); house(g, 18, 10, 5, 3);
  hill(g, 12, 11, 3, 3);
  for (const [x, y] of [[10, 5], [11, 5], [12, 5], [23, 9], [24, 10]]) g.set(x, y, 6);
  scatter(g, 12, 6, 31, (x, y) => y > 8 || x > 11); scatter(g, 14, 8, 32); scatter(g, 13, 5, 33);
  return build("coral", "Villa Coral", g, {
    warps: [warp(0, 8, "ruta1", 24, 7), warp(25, 8, "ruta2", 1, 8), warp(6, 6, "centro-coral", 6, 7), warp(18, 6, "gym-coral", 7, 10)],
    triggers: [gate(24, 8, "medalla1", "El camino al este es peligroso. Vuelve cuando tengas la Medalla Hoja.", "coral", 22, 8)],
    npcs: [
      npc("guia", 9, 9, 1, 0, "Guía", ["¡Bienvenido a Villa Coral! El gimnasio está al norte, la líder Fresia domina el tipo Planta.", "Cuidado con el Fuego y el Volador: les ganan."]),
      npc("marinera", 14, 12, 3, 0, "Marinera", ["El mar de por aquí es calmo, pero más al este llueve casi todo el año."]),
    ],
  });
}
const gymCoral = () => gym("gym-coral", "Gimnasio de Villa Coral", ["coral", 18, 7],
  leader("fresia", "Fresia", 1, [mon("hojito", 12), mon("frondon", 15, "restos")], 1, "Medalla Hoja", "¡Soy Fresia! Mi jardín es mi fortaleza.", "Vaya... has regado mi jardín con maestría."),
  [trainer("lia", 4, 6, 3, 3, "Aprendiz Lía", "¡Primero tendrás que pasar por mí!", [mon("hojito", 10)]),
   trainer("kai", 9, 4, 2, 2, "Aprendiz Kai", "¡No pasarás de aquí!", [mon("pelusin", 9), mon("alete", 10)])]);

function ruta2(): GameMap {
  const g = grass(30, 16);
  frame(g, [[0, 8], [29, 8]]);
  hline(g, 8, 1, 28);
  house(g, 13, 2, 5, 3, 15); vline(g, 15, 5, 7);
  g.rect(3, 10, 9, 13, 1); g.rect(20, 10, 27, 13, 1); g.rect(4, 2, 9, 5, 1);
  hill(g, 24, 4, 3, 3);
  scatter(g, 15, 9, 41, (_, y) => y !== 8); scatter(g, 12, 9, 42, (_, y) => y !== 8); scatter(g, 13, 6, 43);
  return build("ruta2", "Ruta 2", g, {
    warps: [warp(0, 8, "coral", 24, 8), warp(29, 8, "faro", 1, 9), warp(15, 4, "cueva", 8, 12)],
    encounters: ["piedrin", "terron", "chispin", "alete", "pelusin"], encounterLevel: [8, 12],
    npcs: [
      trainer("gael", 8, 6, 2, 0, "Excursionista Gael", "¡Este camino es duro, como mis criaturas!", [mon("piedrin", 9), mon("terron", 9)]),
      trainer("iris", 22, 6, 1, 0, "Pescadora Iris", "¡Aquí también se pesca, pero hoy toca combatir!", [mon("gotin", 10), mon("caracolin", 10)]),
      trainer("bruno", 12, 10, 0, 1, "Montañero Bruno", "¡Las montañas me han hecho fuerte!", [mon("piedrin", 11), mon("murcio", 10)]),
    ],
  });
}
function cueva(): GameMap {
  const g = new Grid(16, 14, 7);
  g.border(5);
  g.rect(8, 2, 8, 12, 2);
  g.set(8, 13, 8);
  for (const [x, y] of [[3, 3], [4, 3], [5, 8], [11, 4], [12, 4], [11, 9], [3, 10], [13, 11], [2, 6], [13, 7]]) g.obj(x, y, 15);
  return build("cueva", "Cueva del Eco", g, {
    warps: [warp(8, 13, "ruta2", 15, 5)],
    encounters: ["piedrin", "terron", "murcio", "caracolin"], encounterLevel: [9, 13],
    npcs: [
      npc("cofre", 8, 2, 0, 0, "Cofre", [], { kind: "script", script: "if cofre\nsay Está vacío.\nreturn\nend\nflag cofre\ngive superpotion 2\ngive antidoto 2\nsay ¡Encuentras 2 Superpociones y 2 Cura Total!" }),
      trainer("elias", 6, 6, 2, 3, "Científico Elías", "¡Estudio los ecos de esta cueva!", [mon("piedrin", 12), mon("murcio", 12)]),
      npc("elias2", 10, 6, 2, 2, "Ayudante de Elías", [], { kind: "script", script: "if carbon_ok\nsay ¡Que te sea útil ese carbón!\nreturn\nend\nflag carbon_ok\ngive carbon 1\nsay Encontré este Carbón; potencia los ataques de Fuego.\nsay Equípalo con una criatura del equipo con el comando del juego o desde un guion." }),
    ],
  });
}

function faro(): GameMap {
  const g = townBase(28, 18, 9, [[0, 9], [27, 9]]);
  g.rect(1, 13, 26, 13, 7); g.rect(1, 14, 26, 16, 3);
  vline(g, 14, 10, 13, 2);
  house(g, 4, 3, 6, 4, 6); vline(g, 6, 7, 9);
  house(g, 16, 2, 8, 5, 20); vline(g, 20, 7, 9);
  house(g, 22, 10, 3, 3);
  for (const [x, y] of [[13, 11], [15, 11], [13, 12], [15, 12]]) g.obj(x, y, 16);
  scatter(g, 14, 8, 51); scatter(g, 13, 6, 52); scatter(g, 12, 4, 53, (_, y) => y < 9);
  return build("faro", "Puerto Faro", g, {
    warps: [warp(0, 9, "ruta2", 28, 8), warp(27, 9, "ruta3", 1, 8), warp(6, 6, "centro-faro", 6, 7), warp(20, 6, "gym-faro", 7, 10)],
    triggers: [gate(26, 9, "medalla2", "La ruta al este es solo para entrenadores con la Medalla Rayo.", "faro", 24, 9)],
    npcs: [
      npc("marinero", 10, 11, 3, 3, "Marinero", ["El faro lleva siglos guiando a los barcos de la Marea."]),
      npc("nina", 21, 12, 0, 2, "Niña", ["Voltio, el líder del gimnasio, dice que la electricidad le gana al agua y al aire."]),
    ],
  });
}
const gymFaro = () => gym("gym-faro", "Gimnasio de Puerto Faro", ["faro", 20, 7],
  leader("voltio", "Voltio", 3, [mon("chispin", 18), mon("voltaico", 22, "carbon")], 2, "Medalla Rayo", "¡Soy Voltio! ¿Preparado para una descarga?", "¡Zas! Me has dejado sin batería."),
  [trainer("ada", 4, 6, 2, 3, "Técnica Ada", "¡Mis circuitos están a tope!", [mon("chispin", 16)]),
   trainer("noa", 9, 4, 3, 2, "Técnico Noa", "¡Cuidado con los cables!", [mon("pelusin", 15), mon("chispin", 16)])]);

function ruta3(): GameMap {
  const g = grass(30, 16);
  frame(g, [[0, 8], [29, 8]]);
  hline(g, 8, 1, 28);
  g.rect(3, 2, 10, 5, 1); g.rect(18, 10, 27, 13, 1); g.rect(5, 10, 9, 13, 1);
  lake(g, 20, 3, 25, 5);
  hill(g, 14, 12, 3, 2);
  scatter(g, 12, 10, 61, (_, y) => y !== 8); scatter(g, 14, 8, 62); scatter(g, 15, 5, 63, (_, y) => y !== 8);
  return build("ruta3", "Ruta 3", g, {
    weather: "sun",
    warps: [warp(0, 8, "faro", 26, 9), warp(29, 8, "ceniza", 1, 10)],
    encounters: ["terron", "caracolin", "gaviotin", "alete", "murcio"], encounterLevel: [16, 20],
    npcs: [
      trainer("ruben", 10, 6, 2, 0, "Soldado Rubén", "¡Con este sol, nadie me detiene!", [mon("terron", 17), mon("gaviotin", 18)]),
      trainer("sara", 23, 7, 1, 0, "Playera Sara", "¡Un chapuzón antes del combate!", [mon("marejon", 19), mon("caracolin", 18)]),
      trainer("leo", 15, 9, 0, 1, "Piloto Leo", "¡Desde el aire lo veo todo!", [mon("gaviotin", 20), mon("alete", 18)]),
    ],
  });
}

function ceniza(): GameMap {
  const g = townBase(28, 20, 10, [[0, 10], [27, 10]]);
  house(g, 4, 4, 6, 4, 6); vline(g, 6, 8, 10);
  house(g, 16, 3, 8, 5, 20); vline(g, 20, 8, 10);
  hill(g, 21, 16, 5, 7);
  g.rect(8, 15, 12, 17, 7);
  scatter(g, 15, 14, 71, (x, y) => y !== 10 && !(x > 15 && y > 11)); scatter(g, 17, 3, 72, (_, y) => y < 10); scatter(g, 12, 5, 73);
  return build("ceniza", "Ciudad Ceniza", g, {
    weather: "sand",
    warps: [warp(0, 10, "ruta3", 28, 8), warp(27, 10, "ruta4", 1, 8), warp(6, 7, "centro-ceniza", 6, 7), warp(20, 7, "gym-ceniza", 7, 10)],
    triggers: [gate(26, 10, "medalla3", "El paso a la costa está cerrado hasta que tengas la Medalla Brasa.", "ceniza", 24, 10)],
    npcs: [
      npc("minero", 12, 12, 3, 3, "Minero", ["El volcán lleva dormido cien años... pero la ceniza no deja de caer."]),
      npc("herrera", 14, 11, 1, 2, "Herrera", ["Los objetos equipables se forjan aquí. El Carbón potencia los ataques de Fuego."]),
    ],
  });
}
const gymCeniza = () => gym("gym-ceniza", "Gimnasio de Ciudad Ceniza", ["ceniza", 20, 8],
  leader("brasa", "Brasa", 0, [mon("brasaron", 28, "carbon"), mon("rocalon", 27), mon("brasaron", 30)], 3, "Medalla Brasa", "¡Soy Brasa! ¡Mi fuego no se apaga!", "Cenizas... eso es lo que queda de mi equipo."),
  [trainer("tiz", 4, 6, 0, 3, "Fogonero Tiz", "¡Ven a calentarte!", [mon("brasito", 24), mon("piedrin", 24)]),
   trainer("ceni", 9, 4, 2, 2, "Herrero Ceni", "¡Mis martillos hablan por mí!", [mon("rocalon", 26)])]);

function ruta4(): GameMap {
  const g = grass(32, 16);
  frame(g, [[0, 8], [31, 8]]);
  hline(g, 8, 1, 30);
  g.rect(3, 2, 11, 5, 1); g.rect(20, 10, 29, 13, 1); g.rect(4, 10, 8, 13, 1);
  lake(g, 16, 2, 22, 4);
  scatter(g, 12, 10, 81, (_, y) => y !== 8); scatter(g, 13, 8, 82); scatter(g, 14, 6, 83);
  return build("ruta4", "Ruta 4", g, {
    weather: "rain",
    warps: [warp(0, 8, "ceniza", 26, 10), warp(31, 8, "marea", 1, 9)],
    encounters: ["gotin", "marejon", "caracolin", "gaviotin", "chispin"], encounterLevel: [26, 31],
    npcs: [
      trainer("mar1", 12, 6, 2, 0, "Hermanos Mar", "¡Somos dos y combatimos juntos!", [mon("marejon", 27), mon("gaviotin", 27)], { double: true }),
      trainer("pesc", 24, 6, 1, 0, "Pescador Moro", "¡Hoy pican las grandes!", [mon("caracolin", 29), mon("marejon", 29)]),
      trainer("buzo", 17, 10, 0, 1, "Buceadora Lila", "¡Vengo de las profundidades!", [mon("tsunamo", 31)]),
    ],
  });
}

function marea(): GameMap {
  const g = townBase(28, 18, 9, [[0, 9]]);
  sea(g, 14);
  house(g, 3, 3, 6, 4, 5); vline(g, 5, 7, 9);
  house(g, 11, 2, 7, 5, 14); vline(g, 14, 7, 9);
  house(g, 20, 2, 6, 5, 22); vline(g, 22, 7, 9);
  hill(g, 9, 12, 2, 2);
  scatter(g, 14, 8, 91); scatter(g, 13, 6, 92); scatter(g, 12, 4, 93, (_, y) => y < 9);
  return build("marea", "Isla Marea", g, {
    warps: [warp(0, 9, "ruta4", 30, 8), warp(5, 6, "centro-marea", 6, 7), warp(14, 6, "gym-marea", 7, 10), warp(22, 6, "liga", 7, 14)],
    triggers: [gate(22, 7, "medalla4", "Solo los entrenadores con las cuatro medallas pueden entrar en la Liga.", "marea", 20, 9)],
    npcs: [
      npc("anciano", 8, 11, 2, 0, "Anciano", ["Esta isla es el corazón del archipiélago. La Liga está a nuestras espaldas, en el edificio grande.", "Para entrar necesitas las cuatro medallas."]),
      npc("turista", 17, 11, 1, 2, "Turista", ["¡Qué lugar! Dicen que el Campeón nunca ha perdido..."]),
    ],
  });
}
const gymMarea = () => gym("gym-marea", "Gimnasio de Isla Marea", ["marea", 14, 7],
  leader("marino", "Marino", 2, [mon("marejon", 36, "baya-oran"), mon("caracolin", 35), mon("gaviotin", 36), mon("tsunamo", 38, "banda")], 4, "Medalla Marea", "¡Soy Marino! Mis olas arrastran a cualquiera.", "¡Una marea imparable! Eres digno de la Liga."),
  [trainer("nautica", 4, 6, 2, 3, "Navegante Alba", "¡Zarpamos!", [mon("marejon", 33), mon("caracolin", 32)]),
   trainer("pirata", 9, 4, 1, 2, "Pirata Rojo", "¡A abordar!", [mon("gaviotin", 34), mon("chispin", 33)], { double: false })]);

function liga(): GameMap {
  const g = new Grid(14, 16, 9);
  g.border(5);
  g.rect(7, 1, 7, 13, 10);
  for (let y = 1; y <= 12; y++) { g.set(6, y, 5); g.set(8, y, 5); }
  g.set(7, 15, 8);
  g.rect(7, 14, 7, 14, 10);
  const elite = (id: string, y: number, name: string, look: number, team: TeamMember[], quote: string, win: string): Npc =>
    ({ ...trainer(id, 7, y, look, 0, name, quote, team), defeatedLines: [win], winScript: `add money ${50 * team[0].level}\nsay Sigue adelante: el Campeón te espera.` });
  return build("liga", "Liga del Archipiélago", g, {
    warps: [warp(7, 15, "marea", 22, 7)],
    npcs: [
      elite("ola", 10, "Maestra Ola", 2, [mon("marejon", 42), mon("tsunamo", 43), mon("caracolin", 41)], "¡Soy Ola, del mar profundo!", "La marea me ha vencido..."),
      elite("cumbre", 7, "Maestro Cumbre", 3, [mon("rocalon", 42), mon("dunon", 42), mon("rocalon", 43)], "¡Soy Cumbre, firme como una montaña!", "Incluso la montaña cede..."),
      elite("llama", 4, "Maestra Llama", 0, [mon("infernal", 44), mon("gaviotin", 43), mon("brasaron", 42)], "¡Soy Llama! ¡Que arda todo!", "Mi llama se apaga..."),
      {
        ...trainer("aldo", 7, 1, 1, 0, "Campeón Aldo", "Has llegado muy lejos. Yo soy Aldo, el Campeón del Archipiélago. ¡Demuéstrame de qué estás hecho!",
          [mon("selvatico", 46), mon("voltaico", 45), mon("tsunamo", 46), mon("infernal", 47), mon("dunon", 45), mon("gaviotin", 45, "banda")]),
        defeatedLines: ["¡Increíble! Eres el nuevo Campeón."],
        winScript: "flag campeon\nsay ¡El archipiélago tiene un nuevo Campeón!\nsay ★ FIN DE LA AVENTURA ★\nsay Gracias por jugar. Puedes seguir explorando, capturar más criaturas o crear tu propio mundo en el editor.",
      },
    ],
  });
}

/** Plantilla de región completa: 21 mapas, 4 gimnasios, Liga, tiendas y centros de curación. */
export function archipelagoProject(): Project {
  const base = defaultProject();
  return {
    schemaVersion: SCHEMA_VERSION,
    name: "Archipiélago de la Marea",
    seed: 20241,
    start: { map: "brisa", x: 10, y: 10 },
    party: [],
    items: base.items,
    inventory: { potion: 0, ball: 0 },
    types: TYPES,
    typeChart: chart(),
    weatherRules: defaultWeatherRules(TYPES),
    abilities: abilities(),
    species: species(),
    moves: MOVES,
    maps: [
      brisa(), casa(), lab(), ruta1(), coral(), centro("centro-coral", "Villa Coral", ["coral", 6, 7]), gymCoral(),
      ruta2(), cueva(), faro(), centro("centro-faro", "Puerto Faro", ["faro", 6, 7]), gymFaro(),
      ruta3(), ceniza(), centro("centro-ceniza", "Ciudad Ceniza", ["ceniza", 6, 8]), gymCeniza(),
      ruta4(), marea(), centro("centro-marea", "Isla Marea", ["marea", 5, 7]), gymMarea(), liga(),
    ],
  };
}

export const TEMPLATES: { id: string; name: string; description: string; build: () => Project }[] = [
  { id: "ejemplo", name: "Mini mundo de ejemplo", description: "Pueblo, casa y ruta para probar el editor.", build: defaultProject },
  { id: "archipielago", name: "Archipiélago de la Marea (región completa)", description: "Región original: 21 mapas, 4 gimnasios, Liga, tiendas, medallas y progresión.", build: archipelagoProject },
];
