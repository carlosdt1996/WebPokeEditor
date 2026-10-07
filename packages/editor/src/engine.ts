/** Envoltorio TS del núcleo Rust/WASM (ver crates/engine-core). */

export const Input = { Up: 1, Down: 2, Left: 4, Right: 8 } as const;
export const Ev = { Step: 1, Encounter: 2, Blocked: 4 } as const;
export const MAX_DIM = 128;

interface Exports {
  memory: WebAssembly.Memory;
  engine_reset(w: number, h: number, seed: number): void;
  engine_tiles_ptr(): number;
  engine_width(): number;
  engine_height(): number;
  engine_set_tile(x: number, y: number, t: number): void;
  engine_get_tile(x: number, y: number): number;
  engine_set_spawn(x: number, y: number): void;
  engine_tick(input: number): number;
  engine_player_x(): number;
  engine_player_y(): number;
  engine_player_dir(): number;
  engine_player_moving(): number;
  engine_steps(): number;
  engine_rand(max: number): number;
  engine_is_solid(t: number): number;
  engine_clear_blockers(): void;
  engine_set_blocker(x: number, y: number, v: number): void;
  engine_walkable(x: number, y: number): number;
  engine_cell_x(): number;
  engine_cell_y(): number;
  engine_damage(level: number, power: number, atk: number, def: number, mult: number, roll: number): number;
}

export class Engine {
  private constructor(private x: Exports) {}

  static async load(source: string | BufferSource): Promise<Engine> {
    let bytes: BufferSource;
    if (typeof source === "string") {
      const res = await fetch(source);
      if (!res.ok) throw new Error(`No se pudo cargar ${source}: ${res.status}`);
      bytes = await res.arrayBuffer();
    } else bytes = source;
    const { instance } = await WebAssembly.instantiate(bytes, {});
    return new Engine(instance.exports as unknown as Exports);
  }

  get width() { return this.x.engine_width(); }
  get height() { return this.x.engine_height(); }

  /** Vista directa sobre el mapa en memoria WASM (se recrea en cada acceso). */
  get tiles(): Uint8Array {
    return new Uint8Array(this.x.memory.buffer, this.x.engine_tiles_ptr(), this.width * this.height);
  }

  reset(w: number, h: number, seed = 1) { this.x.engine_reset(w, h, seed >>> 0); }
  loadMap(w: number, h: number, tiles: Uint8Array, seed = 1) {
    this.reset(w, h, seed);
    this.tiles.set(tiles.subarray(0, w * h));
  }
  setTile(x: number, y: number, t: number) { this.x.engine_set_tile(x, y, t); }
  getTile(x: number, y: number) { return this.x.engine_get_tile(x, y); }
  setSpawn(x: number, y: number) { this.x.engine_set_spawn(x, y); }
  tick(input: number) { return this.x.engine_tick(input); }
  get player() {
    return {
      x: this.x.engine_player_x(),
      y: this.x.engine_player_y(),
      dir: this.x.engine_player_dir(),
      moving: this.x.engine_player_moving() === 1,
    };
  }
  get steps() { return this.x.engine_steps(); }
  clearBlockers() { this.x.engine_clear_blockers(); }
  setBlocker(x: number, y: number, v = 1) { this.x.engine_set_blocker(x, y, v); }
  walkable(x: number, y: number) { return this.x.engine_walkable(x, y) === 1; }
  /** Celda lógica del jugador (destino si se está moviendo). */
  get cell() { return { x: this.x.engine_cell_x(), y: this.x.engine_cell_y() }; }
  rand(max: number) { return this.x.engine_rand(max); }
  isSolid(t: number) { return this.x.engine_is_solid(t) === 1; }
  damage(level: number, power: number, atk: number, def: number, multX100: number, roll: number) {
    return this.x.engine_damage(level, power, atk, def, multX100, roll);
  }
}
