/** Modelo de datos del proyecto (ver docs/architecture/data-model.md). Todo es dato serializable. */
import { parseScript } from "./script";

export const SCHEMA_VERSION = 5;
/** Límites de las tablas del motor de combate (crates/engine-core/src/battle.rs). */
export const LIMITS = { types: 16, moves: 256, species: 128, learn: 8, abilities: 64, helds: 64 } as const;

export interface Stats { hp: number; atk: number; def: number; spa: number; spd: number; spe: number }
export const STAT_KEYS: (keyof Stats)[] = ["hp", "atk", "def", "spa", "spd", "spe"];

export type StatusKind = "burn" | "poison" | "paralysis" | "sleep" | "freeze";
/** El código numérico en el motor es el índice + 1 (0 = sin estado). */
export const STATUS_KINDS: StatusKind[] = ["burn", "poison", "paralysis", "sleep", "freeze"];
export const STATUS_NAMES: Record<StatusKind, string> = { burn: "Quemadura", poison: "Veneno", paralysis: "Parálisis", sleep: "Sueño", freeze: "Congelación" };
export type BattleStat = "atk" | "def" | "spa" | "spd" | "spe" | "acc" | "eva";
export const BATTLE_STATS: BattleStat[] = ["atk", "def", "spa", "spd", "spe", "acc", "eva"];
export const BATTLE_STAT_NAMES: Record<BattleStat, string> = { atk: "Ataque", def: "Defensa", spa: "Ataque Esp.", spd: "Defensa Esp.", spe: "Velocidad", acc: "Precisión", eva: "Evasión" };

export type WeatherKind = "sun" | "rain" | "sand" | "hail";
/** El código numérico en el motor es el índice + 1 (0 = sin clima). */
export const WEATHER_KINDS: WeatherKind[] = ["sun", "rain", "sand", "hail"];
export const WEATHER_NAMES: Record<WeatherKind, string> = { sun: "Sol", rain: "Lluvia", sand: "Tormenta de arena", hail: "Granizo" };
/** Efectos de un clima, por datos: tipo potenciado (+50 %), tipo debilitado (−50 %), daño residual (1/16) y tipos inmunes a él. */
export interface WeatherRule { boost?: number; weaken?: number; chip?: boolean; immune?: number[] }
export type WeatherRules = Record<WeatherKind, WeatherRule>;
/** Reglas por defecto según los nombres de tipo (Fuego/Agua…); si no existen, el clima no modifica ningún tipo. */
export function defaultWeatherRules(types: string[]): WeatherRules {
  const ix = (n: string) => { const i = types.findIndex((t) => t.toLowerCase() === n); return i >= 0 ? i : undefined; };
  const [fire, water, normal] = [ix("fuego"), ix("agua"), ix("normal")];
  return {
    sun: { boost: fire, weaken: water },
    rain: { boost: water, weaken: fire },
    sand: { chip: true, immune: normal !== undefined ? [normal] : [] },
    hail: { chip: true, immune: water !== undefined ? [water] : [] },
  };
}

/** Efectos de un movimiento, definidos por datos. Un movimiento con poder 0 solo aplica sus efectos. */
export interface MoveEffect {
  /** −3…+3: actúa antes (o después) que los demás sin importar la velocidad. */
  priority?: number;
  /** Estado alterado sobre el objetivo, con probabilidad (%). */
  status?: { kind: StatusKind; chance: number };
  /** Cambio de etapa de una estadística (−6…+6), sobre el usuario o el objetivo, con probabilidad (%). */
  stat?: { stat: BattleStat; stages: number; target: "self" | "foe"; chance: number };
  /** % del daño infligido que cura al usuario. */
  drain?: number;
  /** % del daño infligido que recibe el usuario. */
  recoil?: number;
  /** % de los PS máximos que cura el usuario. */
  heal?: number;
  /** Golpes por uso (p. ej. 2–5). */
  hits?: { min: number; max: number };
  /** Probabilidad de golpe crítico: 0 normal (1/16), 1 (1/8), 2 (1/4), 3 (1/2). */
  crit?: number;
  /** Tarda un turno en cargarse y golpea al siguiente. */
  charge?: boolean;
  /** Tras golpear, el usuario pierde el turno siguiente. */
  recharge?: boolean;
  /** Establece este clima durante 5 turnos. */
  weather?: WeatherKind;
  /** Crea un terreno de 5 turnos que potencia (+30 %) los movimientos del mismo tipo que este movimiento. */
  terrain?: boolean;
}

export type AbilityKind = "immune" | "absorb" | "statusImmune" | "intimidate" | "pinch" | "speedBoost" | "weather";
/** Habilidad pasiva. immune/absorb/pinch usan `type`; absorb usa `amount` (% de PS máx. que cura); statusImmune usa `status`. */
export interface AbilityDef { id: string; name: string; kind: AbilityKind; type?: number; status?: StatusKind; weather?: WeatherKind; amount?: number; description?: string }

export interface Species {
  id: string; name: string; types: number[]; stats: Stats; moves: string[];
  /** Data URL PNG importado por el usuario (opcional). Nunca se incluye en el repo. */
  sprite?: string;
  /** Evoluciona al alcanzar `level`. */
  evolve?: { level: number; into: string };
  /** Id de habilidad (ver `Project.abilities`). */
  ability?: string;
  /** Movimientos que aprende al subir de nivel. */
  learnset?: { level: number; move: string }[];
}
export interface Move { id: string; name: string; type: number; category: "physical" | "special"; power: number; accuracy: number; effect?: MoveEffect }

export type NpcKind = "talk" | "trainer" | "healer" | "script";
export interface TeamMember { species: string; level: number; /** objeto equipado (id de un objeto de tipo "held") */ held?: string }
export interface Npc {
  id: string; x: number; y: number; look: number; dir: number; kind: NpcKind; name: string;
  lines: string[];
  /** Solo entrenadores. */
  team?: TeamMember[];
  defeatedLines?: string[];
  /** Solo entrenadores: combate 2 contra 2 (necesita 2+ criaturas en cada equipo). */
  double?: boolean;
  /** Solo kind "script": ver script.ts. */
  script?: string;
}
/** Efecto de un objeto equipable: refuerzo de tipo (+amount %), restos (1/16 por turno), baya de curación (amount % al bajar a la mitad), baya de estado y banda (sobrevive con 1 PS). */
export interface HoldEffect { kind: "boost" | "leftovers" | "berry" | "cureBerry" | "focus"; type?: number; amount?: number }
export interface ItemDef { id: string; name: string; kind: "heal" | "ball" | "cure" | "held"; hold?: HoldEffect; /** heal: PS que cura. ball: bonus (+%) a la probabilidad de captura. cure: quita el estado alterado. */ amount: number }
/** Disparador por casilla: ejecuta un script al pisarla. */
export interface Trigger { x: number; y: number; name: string; script: string; once: boolean }
export interface Warp { x: number; y: number; toMap: string; toX: number; toY: number }

export interface GameMap {
  id: string; name: string; w: number; h: number; tiles: string;
  npcs: Npc[]; warps: Warp[];
  triggers?: Trigger[];
  /** Script que se ejecuta al entrar en el mapa (por salto, al empezar o al volver tras perder). */
  onEnter?: string;
  /** Script que se ejecuta al salir del mapa por un salto. */
  onExit?: string;
  /** Clima permanente en los combates de este mapa. */
  weather?: WeatherKind;
  /** Capa de objetos (base64 u8, 0 = vacío): decoración sobre el suelo, con transparencia. */
  objects?: string;
  /** Altura por casilla para el modo 3D (base64 de Int8 + 128; unidades de 0,25 tiles). */
  heights?: string;
  /** Ids de especies que aparecen en hierba alta de este mapa. */
  encounters: string[];
  encounterLevel: [number, number];
}

export interface Project {
  schemaVersion: number;
  name: string;
  seed: number;
  maps: GameMap[];
  start: { map: string; x: number; y: number };
  party: TeamMember[];
  abilities: AbilityDef[];
  weatherRules: WeatherRules;
  items: ItemDef[];
  inventory: Record<string, number>;
  /** Nombres de tipo; el índice es el id de tipo. */
  types: string[];
  /** typeChart[atacante][defensor] = multiplicador (0, 0.5, 1, 2). */
  typeChart: number[][];
  species: Species[];
  moves: Move[];
  /** Atlas de gráficos propio (PNG 128×64 en data URL), opcional. */
  atlas?: string;
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

class Grid {
  t: Uint8Array;
  o: Uint8Array;
  hg: Int8Array;
  constructor(public w: number, public h: number, fillTile = 0) { this.t = new Uint8Array(w * h).fill(fillTile); this.o = new Uint8Array(w * h); this.hg = new Int8Array(w * h); }
  obj(x: number, y: number, v: number) { if (x >= 0 && y >= 0 && x < this.w && y < this.h) this.o[y * this.w + x] = v; }
  height(x0: number, y0: number, x1: number, y1: number, v: number) { for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) this.hg[y * this.w + x] = v; }
  set(x: number, y: number, v: number) { if (x >= 0 && y >= 0 && x < this.w && y < this.h) this.t[y * this.w + x] = v; }
  rect(x0: number, y0: number, x1: number, y1: number, v: number) { for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) this.set(x, y, v); }
  border(v: number) { this.rect(0, 0, this.w - 1, 0, v); this.rect(0, this.h - 1, this.w - 1, this.h - 1, v); this.rect(0, 0, 0, this.h - 1, v); this.rect(this.w - 1, 0, this.w - 1, this.h - 1, v); }
}

/** Mundo de demostración con criaturas, movimientos y personajes originales. */
export function defaultProject(): Project {
  // --- Pueblo Inicial ---
  const town = new Grid(24, 18);
  town.border(4);
  town.rect(11, 1, 11, 16, 2); town.rect(1, 9, 22, 9, 2);
  town.rect(2, 11, 8, 15, 1);
  town.rect(15, 2, 20, 5, 3); town.rect(14, 6, 21, 6, 7);
  town.rect(3, 2, 7, 4, 5); town.set(5, 4, 8);
  town.rect(5, 5, 5, 8, 2);
  for (const [x, y] of [[9, 3], [9, 6], [13, 12], [14, 14], [20, 14]]) town.set(x, y, 4);
  for (const [x, y] of [[13, 3], [18, 11], [19, 12], [16, 15], [3, 7], [7, 7]]) town.set(x, y, 6);
  town.set(23, 9, 2);
  // objetos (capa superior) y una colina para el modo 3D
  town.obj(10, 8, 17); // cartel junto al cruce
  for (const [x, y] of [[20, 10], [21, 11], [3, 16]]) town.obj(x, y, 15);
  for (let x = 13; x <= 16; x++) town.obj(x, 12, 16);
  for (const [x, y] of [[2, 6], [8, 6], [1, 3]]) town.obj(x, y, 14);
  town.obj(9, 2, 12);
  town.height(16, 13, 20, 15, 2); town.height(17, 14, 19, 14, 3);

  // --- Casa (interior) ---
  const home = new Grid(10, 8, 9);
  home.border(5);
  home.rect(4, 5, 6, 6, 10);
  home.rect(6, 3, 6, 3, 11); home.rect(8, 3, 8, 3, 11);
  home.set(5, 7, 8);

  // --- Ruta 1 ---
  const route = new Grid(22, 16);
  route.border(4);
  route.rect(1, 8, 20, 8, 2);
  route.rect(3, 2, 8, 6, 1); route.rect(12, 10, 19, 14, 1); route.rect(13, 2, 17, 4, 1);
  route.rect(10, 11, 11, 13, 3);
  for (const [x, y] of [[2, 10], [4, 12], [9, 4], [10, 2], [11, 6]]) route.set(x, y, 4);
  for (const [x, y] of [[1, 6], [20, 6], [8, 10]]) route.set(x, y, 6);
  route.set(0, 8, 2);
  for (const [x, y] of [[5, 5], [16, 7], [2, 13]]) route.obj(x, y, 15);
  for (const [x, y] of [[7, 3], [9, 14], [18, 6]]) route.obj(x, y, 13);
  route.height(1, 1, 4, 3, 2); route.height(2, 2, 3, 2, 4);

  const mapOf = (id: string, name: string, g: Grid, extra: Partial<GameMap>): GameMap => ({
    id, name, w: g.w, h: g.h, tiles: encodeTiles(g.t), npcs: [], warps: [], encounters: [], encounterLevel: [3, 6],
    objects: g.o.some((v) => v) ? encodeTiles(g.o) : undefined,
    heights: g.hg.some((v) => v) ? encodeTiles(Uint8Array.from(g.hg, (v) => v + 128)) : undefined,
    ...extra,
  });

  return {
    schemaVersion: SCHEMA_VERSION,
    name: "Mi Fangame",
    seed: 12345,
    start: { map: "pueblo", x: 11, y: 8 },
    party: [{ species: "flamito", level: 5 }, { species: "hojin", level: 5 }],
    weatherRules: defaultWeatherRules(["Normal", "Fuego", "Agua", "Planta"]),
    abilities: [
      { id: "mar-llamas", name: "Mar de Llamas", kind: "pinch", type: 1, description: "Con pocos PS, sus ataques de Fuego son más potentes." },
      { id: "absorbe-agua", name: "Absorbe Agua", kind: "absorb", type: 2, amount: 25, description: "Los ataques de Agua lo curan en lugar de dañarlo." },
      { id: "intimidar", name: "Intimidar", kind: "intimidate", description: "Al entrar, baja el Ataque del rival." },
      { id: "velocista", name: "Velocista", kind: "speedBoost", description: "Su Velocidad sube cada turno." },
      { id: "cuerpo-sano", name: "Cuerpo Sano", kind: "statusImmune", status: "poison", description: "No se puede envenenar." },
      { id: "sequia", name: "Sequía", kind: "weather", weather: "sun", description: "Al entrar, el sol brilla durante 5 turnos." },
    ],
    items: [
      { id: "potion", name: "Poción", kind: "heal", amount: 20 },
      { id: "superpotion", name: "Superpoción", kind: "heal", amount: 60 },
      { id: "antidoto", name: "Cura Total", kind: "cure", amount: 0 },
      { id: "restos", name: "Restos", kind: "held", amount: 0, hold: { kind: "leftovers" } },
      { id: "baya-oran", name: "Baya Oran", kind: "held", amount: 0, hold: { kind: "berry", amount: 30 } },
      { id: "carbon", name: "Carbón", kind: "held", amount: 0, hold: { kind: "boost", type: 1, amount: 20 } },
      { id: "banda", name: "Banda Aguante", kind: "held", amount: 0, hold: { kind: "focus" } },
      { id: "ball", name: "Bola", kind: "ball", amount: 0 },
      { id: "superball", name: "Superbola", kind: "ball", amount: 20 },
    ],
    inventory: { ball: 8, potion: 4, superpotion: 1, antidoto: 2, restos: 1, carbon: 1 },
    maps: [
      mapOf("pueblo", "Pueblo Inicial", town, {
        warps: [
          { x: 5, y: 4, toMap: "casa", toX: 5, toY: 6 },
          { x: 23, y: 9, toMap: "ruta1", toX: 1, toY: 8 },
        ],
        npcs: [
          { id: "aldeano", x: 13, y: 9, look: 1, dir: 2, kind: "talk", name: "Aldeano", lines: ["¡Bienvenido a tu aventura!", "Al este está la Ruta 1. Cuidado con la hierba alta."] },
          { id: "pescador", x: 14, y: 7, look: 3, dir: 0, kind: "talk", name: "Pescador", lines: ["El lago está tranquilo hoy...", "A veces pican criaturas muy raras."] },
          { id: "profesor", x: 9, y: 8, look: 2, dir: 3, kind: "script", name: "Profesor", lines: [], script: "if regalo\nsay Ya tienes mi regalo. ¡Cuídalos bien!\nelse\nsay ¡Hola! Toma, te vendrá bien esto.\ngive potion 3\ngive ball 5\nflag regalo\nsay Y recuerda: si te debilitas, la enfermera te curará.\nend" },
        ],
        triggers: [{ x: 11, y: 12, name: "Cartel de bienvenida", once: false, script: "add visitas 1\nif visitas == 1\nsay (Un cartel) Bienvenido a Pueblo Inicial.\nelse\nsay (Un cartel) Has pasado por aquí {visitas} veces.\nend" }],
        encounters: ["pelusin"],
        encounterLevel: [2, 4],
      }),
      mapOf("casa", "Tu casa", home, {
        onEnter: "if mama_saluda\nreturn\nend\nflag mama_saluda\nsay (Mamá) ¡Has vuelto a casa!",
        warps: [{ x: 5, y: 7, toMap: "pueblo", toX: 5, toY: 5 }],
        npcs: [
          { id: "mama", x: 3, y: 3, look: 0, dir: 0, kind: "talk", name: "Mamá", lines: ["¡Buenos días, cariño!", "Tu equipo ya está listo. ¡Ten cuidado ahí fuera!"] },
          { id: "enfermera", x: 7, y: 3, look: 2, dir: 0, kind: "healer", name: "Enfermera", lines: ["Déjame cuidar de tus criaturas...", "¡Listo! Están como nuevas."] },
        ],
      }),
      mapOf("ruta1", "Ruta 1", route, {
        warps: [{ x: 0, y: 8, toMap: "pueblo", toX: 22, toY: 9 }],
        npcs: [
          { id: "joven", x: 14, y: 6, look: 1, dir: 0, kind: "trainer", name: "Joven Marcos", lines: ["¡Oye! ¡Nuestras miradas se cruzaron, a combatir!"], team: [{ species: "pelusin", level: 4 }, { species: "hojin", level: 5 }], defeatedLines: ["Vaya... eres más fuerte de lo que parece."] },
          { id: "hermanos", x: 17, y: 12, look: 0, dir: 2, kind: "trainer", name: "Hermanos Gil", double: true, lines: ["¡Somos dos, y combatimos juntos!"], team: [{ species: "pelusin", level: 5 }, { species: "aquin", level: 5 }], defeatedLines: ["¡Hermano, nos han ganado!"] },
          { id: "campista", x: 6, y: 10, look: 3, dir: 3, kind: "trainer", name: "Campista Ana", lines: ["¡En el campo se aprende rápido!"], team: [{ species: "aquin", level: 6 }], defeatedLines: ["¡Bien jugado!"] },
        ],
        encounters: ["pelusin", "pelusin", "hojin", "flamito", "aquin"],
        encounterLevel: [3, 6],
      }),
    ],
    types: ["Normal", "Fuego", "Agua", "Planta"],
    typeChart: [
      [1, 1, 1, 1],
      [1, 0.5, 0.5, 2],
      [1, 2, 0.5, 0.5],
      [1, 0.5, 2, 0.5],
    ],
    species: [
      { id: "flamito", name: "Flamito", types: [1], stats: st(44, 52, 43, 60, 50, 65), moves: ["embestida", "ascua"], ability: "mar-llamas", evolve: { level: 16, into: "flamaron" }, learnset: [{ level: 6, move: "dia-soleado" }, { level: 8, move: "garra" }, { level: 10, move: "corte" }, { level: 12, move: "danza" }] },
      { id: "flamaron", name: "Flamarón", types: [1], stats: st(64, 80, 63, 85, 70, 85), moves: ["embestida", "ascua"], ability: "mar-llamas", learnset: [{ level: 20, move: "garra" }, { level: 24, move: "cabezazo" }] },
      { id: "hojin", name: "Hojín", types: [3], stats: st(45, 49, 49, 65, 65, 45), moves: ["embestida", "hojaje"], ability: "cuerpo-sano", learnset: [{ level: 5, move: "somnifero" }, { level: 8, move: "polvo-venenoso" }, { level: 10, move: "absorbe" }, { level: 14, move: "rayo-solar" }, { level: 16, move: "campo-hierba" }] },
      { id: "aquin", name: "Aquín", types: [2], stats: st(50, 48, 65, 50, 64, 43), moves: ["embestida", "chorro"], ability: "absorbe-agua", learnset: [{ level: 6, move: "ataque-rapido" }, { level: 8, move: "danza-lluvia" }, { level: 12, move: "respiro" }] },
      { id: "pelusin", name: "Pelusín", types: [0], stats: st(40, 45, 35, 30, 35, 56), moves: ["embestida"], ability: "velocista", learnset: [{ level: 4, move: "ataque-rapido" }, { level: 6, move: "doble-golpe" }, { level: 7, move: "ataque-arena" }, { level: 9, move: "danza" }, { level: 18, move: "hiperrayo" }] },
    ],
    moves: [
      { id: "embestida", name: "Embestida", type: 0, category: "physical", power: 40, accuracy: 100 },
      { id: "ascua", name: "Ascua", type: 1, category: "special", power: 40, accuracy: 100, effect: { status: { kind: "burn", chance: 10 } } },
      { id: "hojaje", name: "Hojaje", type: 3, category: "physical", power: 55, accuracy: 95 },
      { id: "chorro", name: "Chorro", type: 2, category: "special", power: 40, accuracy: 100 },
      { id: "garra", name: "Garra", type: 0, category: "physical", power: 70, accuracy: 95 },
      { id: "somnifero", name: "Somnífero", type: 3, category: "special", power: 0, accuracy: 75, effect: { status: { kind: "sleep", chance: 100 } } },
      { id: "polvo-venenoso", name: "Polvo Venenoso", type: 3, category: "special", power: 0, accuracy: 75, effect: { status: { kind: "poison", chance: 100 } } },
      { id: "absorbe", name: "Absorbe", type: 3, category: "special", power: 40, accuracy: 100, effect: { drain: 50 } },
      { id: "ataque-rapido", name: "Ataque Rápido", type: 0, category: "physical", power: 40, accuracy: 100, effect: { priority: 1 } },
      { id: "danza", name: "Danza Espada", type: 0, category: "physical", power: 0, accuracy: 100, effect: { stat: { stat: "atk", stages: 2, target: "self", chance: 100 } } },
      { id: "cabezazo", name: "Cabezazo", type: 0, category: "physical", power: 90, accuracy: 90, effect: { recoil: 25 } },
      { id: "respiro", name: "Respiro", type: 0, category: "special", power: 0, accuracy: 100, effect: { heal: 50 } },
      { id: "rayo-solar", name: "Rayo Solar", type: 3, category: "special", power: 110, accuracy: 100, effect: { charge: true } },
      { id: "hiperrayo", name: "Hiperrayo", type: 0, category: "special", power: 120, accuracy: 90, effect: { recharge: true } },
      { id: "doble-golpe", name: "Doble Golpe", type: 0, category: "physical", power: 25, accuracy: 100, effect: { hits: { min: 2, max: 5 } } },
      { id: "corte", name: "Corte Cruzado", type: 0, category: "physical", power: 70, accuracy: 100, effect: { crit: 3 } },
      { id: "dia-soleado", name: "Día Soleado", type: 1, category: "special", power: 0, accuracy: 100, effect: { weather: "sun" } },
      { id: "danza-lluvia", name: "Danza Lluvia", type: 2, category: "special", power: 0, accuracy: 100, effect: { weather: "rain" } },
      { id: "campo-hierba", name: "Campo de Hierba", type: 3, category: "special", power: 0, accuracy: 100, effect: { terrain: true } },
      { id: "ataque-arena", name: "Ataque Arena", type: 0, category: "special", power: 0, accuracy: 100, effect: { stat: { stat: "acc", stages: -1, target: "foe", chance: 100 } } },
    ],
  };
}

/** Migra proyectos de versiones anteriores al esquema actual (puro; no muta la entrada). */
export function migrate(input: unknown): Project {
  const p = structuredClone(input) as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  if (p.schemaVersion === 1) {
    const m = p.map;
    p.maps = [{
      id: "mapa1", name: "Mapa 1", w: m.w, h: m.h, tiles: m.tiles, npcs: [], warps: [],
      encounters: p.encounters ?? [], encounterLevel: [3, 6],
    }];
    p.start = { map: "mapa1", x: m.spawn.x, y: m.spawn.y };
    p.party = p.species?.[0] ? [{ species: p.species[0].id, level: 5 }] : [];
    p.inventory = { ball: 5, potion: 3 };
    delete p.map; delete p.encounters;
    p.schemaVersion = 2;
  }
  if (p.schemaVersion === 2) {
    p.items = [
      { id: "potion", name: "Poción", kind: "heal", amount: 20 },
      { id: "ball", name: "Bola", kind: "ball", amount: 0 },
    ];
    p.inventory = { ball: p.inventory?.ball ?? 5, potion: p.inventory?.potion ?? 3 };
    p.schemaVersion = 3;
  }
  if (p.schemaVersion === 3) {
    p.abilities = [];
    p.schemaVersion = 4;
  }
  if (p.schemaVersion === 4) {
    p.weatherRules = defaultWeatherRules(p.types ?? []);
    p.schemaVersion = 5;
  }
  return p as Project;
}

/** Valida y reporta problemas (referencias rotas, tamaños). Devuelve lista vacía si todo está bien. */
export function validate(p: Project): string[] {
  const errs: string[] = [];
  if (p.schemaVersion !== SCHEMA_VERSION) errs.push(`schemaVersion ${p.schemaVersion} no soportado`);
  const speciesIds = new Set(p.species.map((s) => s.id));
  const moveIds = new Set(p.moves.map((m) => m.id));
  const mapIds = new Set(p.maps.map((m) => m.id));
  const itemIds = new Set(p.items.map((i) => i.id));
  if (itemIds.size !== p.items.length) errs.push("Ids de objeto duplicados");
  for (const k of Object.keys(p.inventory)) if (!itemIds.has(k)) errs.push(`Inventario: objeto inexistente "${k}"`);
  if (!p.maps.length) errs.push("El proyecto no tiene mapas");
  if (p.species.length > LIMITS.species) errs.push(`Demasiadas especies (máximo ${LIMITS.species})`);
  if (p.moves.length > LIMITS.moves) errs.push(`Demasiados movimientos (máximo ${LIMITS.moves})`);
  if (p.items.filter((i) => i.kind === "held").length > LIMITS.helds) errs.push(`Demasiados objetos equipables (máximo ${LIMITS.helds})`);
  if ((p.abilities?.length ?? 0) > LIMITS.abilities) errs.push(`Demasiadas habilidades (máximo ${LIMITS.abilities})`);
  if (p.types.length > LIMITS.types) errs.push(`Demasiados tipos (máximo ${LIMITS.types})`);
  for (const sp of p.species) if ((sp.learnset?.length ?? 0) > LIMITS.learn) errs.push(`${sp.name}: máximo ${LIMITS.learn} movimientos por nivel`);
  if (mapIds.size !== p.maps.length) errs.push("Ids de mapa duplicados");
  if (speciesIds.size !== p.species.length) errs.push("Ids de especie duplicados");
  if (moveIds.size !== p.moves.length) errs.push("Ids de movimiento duplicados");
  const heldIds = new Set(p.items.filter((i) => i.kind === "held").map((i) => i.id));
  const checkScript = (src: string, where: string) => {
    const r = parseScript(src);
    if (!r.ok) { errs.push(...r.errors.map((e) => `${where}: ${e}`)); return; }
    for (const i of r.code) {
      if (i.op === "give" && !itemIds.has(i.item)) errs.push(`${where}: objeto inexistente "${i.item}"`);
      if (i.op === "host" && i.cmd === "equip" && !heldIds.has(i.args[0])) errs.push(`${where}: objeto equipable inexistente "${i.args[0]}"`);
      if ((i.op === "battle" || i.op === "givemon") && !speciesIds.has(i.species)) errs.push(`${where}: especie inexistente "${i.species}"`);
      if (i.op === "warp") {
        const d = p.maps.find((k) => k.id === i.map);
        if (!d) errs.push(`${where}: mapa inexistente "${i.map}"`);
        else if (i.x >= d.w || i.y >= d.h) errs.push(`${where}: warp fuera del mapa`);
      }
    }
  };
  const start = p.maps.find((m) => m.id === p.start.map);
  if (!start) errs.push(`El mapa inicial "${p.start.map}" no existe`);
  else if (p.start.x >= start.w || p.start.y >= start.h) errs.push("El punto de inicio está fuera del mapa");
  const checkHeld = (where: string, held?: string) => { if (held && !heldIds.has(held)) errs.push(`${where}: objeto equipable inexistente "${held}"`); };
  for (const t of p.party) { if (!speciesIds.has(t.species)) errs.push(`Equipo inicial: especie inexistente "${t.species}"`); checkHeld("Equipo inicial", t.held); }
  for (const it of p.items) if (it.kind === "held" && !it.hold) errs.push(`Objeto ${it.name}: falta el efecto de equipado`);
  for (const [k, r] of Object.entries(p.weatherRules ?? {})) for (const t of [r.boost, r.weaken, ...(r.immune ?? [])]) if (t !== undefined && (t < 0 || t >= p.types.length)) errs.push(`Reglas de clima (${k}): tipo inválido`);
  for (const m of p.maps) {
    if (m.objects && atob(m.objects).length !== m.w * m.h) errs.push(`${m.name}: la capa de objetos no coincide con el tamaño`);
    if (m.heights && atob(m.heights).length !== m.w * m.h) errs.push(`${m.name}: la capa de alturas no coincide con el tamaño`);
    if (!(m.w >= 1 && m.w <= 128 && m.h >= 1 && m.h <= 128)) errs.push(`${m.name}: tamaño fuera de rango (1–128)`);
    for (const e of m.encounters) if (!speciesIds.has(e)) errs.push(`${m.name}: encuentro con especie inexistente "${e}"`);
    for (const n of m.npcs) {
      if (n.x >= m.w || n.y >= m.h) errs.push(`${m.name}: NPC "${n.name}" fuera del mapa`);
      for (const t of n.team ?? []) { if (!speciesIds.has(t.species)) errs.push(`${m.name}: "${n.name}" usa especie inexistente "${t.species}"`); checkHeld(`${m.name}: "${n.name}"`, t.held); }
      if (n.kind === "script") checkScript(n.script ?? "", `${m.name}: script de "${n.name}"`);
      if (n.kind === "trainer" && !(n.team?.length)) errs.push(`${m.name}: el entrenador "${n.name}" no tiene equipo`);
      if (n.kind === "trainer" && n.double && (n.team?.length ?? 0) < 2) errs.push(`${m.name}: el entrenador "${n.name}" necesita 2+ criaturas para un combate doble`);
    }
    if (m.onEnter) checkScript(m.onEnter, `${m.name}: script de entrada`);
    if (m.onExit) checkScript(m.onExit, `${m.name}: script de salida`);
    for (const t of m.triggers ?? []) {
      if (t.x >= m.w || t.y >= m.h) errs.push(`${m.name}: disparador "${t.name}" fuera del mapa`);
      checkScript(t.script, `${m.name}: disparador "${t.name}"`);
    }
    for (const w of m.warps) {
      const dest = p.maps.find((d) => d.id === w.toMap);
      if (!dest) errs.push(`${m.name}: salto a mapa inexistente "${w.toMap}"`);
      else if (w.toX >= dest.w || w.toY >= dest.h) errs.push(`${m.name}: salto fuera del mapa destino "${dest.name}"`);
    }
  }
  const abilityIds = new Set((p.abilities ?? []).map((a) => a.id));
  if (abilityIds.size !== (p.abilities ?? []).length) errs.push("Ids de habilidad duplicados");
  for (const a of p.abilities ?? []) {
    if ((a.kind === "immune" || a.kind === "absorb" || a.kind === "pinch") && !(a.type !== undefined && a.type >= 0 && a.type < p.types.length)) errs.push(`Habilidad ${a.name}: tipo inválido`);
    if (a.kind === "statusImmune" && !a.status) errs.push(`Habilidad ${a.name}: falta el estado`);
    if (a.kind === "weather" && !a.weather) errs.push(`Habilidad ${a.name}: falta el clima`);
  }
  for (const s of p.species) {
    if (s.ability && !abilityIds.has(s.ability)) errs.push(`${s.name}: habilidad inexistente "${s.ability}"`);
    for (const t of s.types) if (t < 0 || t >= p.types.length) errs.push(`${s.name}: tipo inválido`);
    for (const m of s.moves) if (!moveIds.has(m)) errs.push(`${s.name}: movimiento inexistente "${m}"`);
    for (const l of s.learnset ?? []) if (!moveIds.has(l.move)) errs.push(`${s.name}: aprende un movimiento inexistente "${l.move}"`);
    if (s.evolve && !speciesIds.has(s.evolve.into)) errs.push(`${s.name}: evoluciona a una especie inexistente "${s.evolve.into}"`);
  }
  for (const m of p.moves) {
    if (m.type < 0 || m.type >= p.types.length) errs.push(`${m.name}: tipo inválido`);
    const e = m.effect;
    if (e) {
      if (e.priority !== undefined && (e.priority < -3 || e.priority > 3)) errs.push(`${m.name}: la prioridad va de −3 a +3`);
      if (e.stat && (e.stat.stages < -6 || e.stat.stages > 6)) errs.push(`${m.name}: el cambio de estadística va de −6 a +6`);
      if (e.hits && !(e.hits.min >= 1 && e.hits.max >= e.hits.min && e.hits.max <= 5)) errs.push(`${m.name}: los golpes van de 1 a 5 (mín ≤ máx)`);
      if (e.crit !== undefined && (e.crit < 0 || e.crit > 3)) errs.push(`${m.name}: el crítico va de 0 a 3`);
      for (const [k, v] of [["drenaje", e.drain], ["retroceso", e.recoil], ["curación", e.heal], ["prob. de estado", e.status?.chance], ["prob. de estadística", e.stat?.chance]] as const) if (v !== undefined && (v < 0 || v > 100)) errs.push(`${m.name}: ${k} fuera de 0–100`);
    }
  }
  if (p.typeChart.length !== p.types.length || p.typeChart.some((r) => r.length !== p.types.length)) errs.push("typeChart no coincide con los tipos");
  return errs;
}

/** Importación estricta: rechaza proyectos con referencias rotas. Con `strict = false` (carga del guardado local) solo exige la estructura básica, para no perder un proyecto por un aviso (p. ej. un script a medio escribir). */
export function parseProject(json: string, strict = true): Project {
  const p = migrate(JSON.parse(json));
  if (!Array.isArray(p.maps) || !p.maps.length || !Array.isArray(p.species) || !Array.isArray(p.moves)) throw new Error("Proyecto inválido: faltan mapas, especies o movimientos");
  p.items ??= []; p.abilities ??= []; p.inventory ??= {}; p.party ??= [];
  if (strict) {
    const errs = validate(p);
    if (errs.length) throw new Error("Proyecto inválido:\n- " + errs.join("\n- "));
  }
  return p;
}

export function effectiveness(p: Project, moveType: number, defTypes: number[]): number {
  return defTypes.reduce((a, t) => a * (p.typeChart[moveType]?.[t] ?? 1), 1);
}
export function maxHp(base: number, level: number) { return Math.floor((2 * base * level) / 100) + level + 10; }
export function statAt(base: number, level: number) { return Math.floor((2 * base * level) / 100) + 5; }

export function slug(s: string) {
  return s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "x";
}
export function uniqueId(existing: string[], base: string) {
  let id = slug(base), n = 2;
  while (existing.includes(id)) id = `${slug(base)}-${n++}`;
  return id;
}

const KEY = "webpokeeditor.project.v3";
export function saveLocal(p: Project): boolean {
  try { localStorage.setItem(KEY, JSON.stringify(p)); return true; } catch { return false; }
}
export function loadLocal(): Project | null {
  try {
    const s = localStorage.getItem(KEY) ?? localStorage.getItem("webpokeeditor.project.v2") ?? localStorage.getItem("webpokeeditor.project.v1");
    return s ? parseProject(s, false) : null;
  } catch { return null; }
}
