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
  engine_objects_ptr(): number;
  vm_code_ptr(): number;
  vm_load(n: number): void;
  vm_run(): number;
  vm_arg(i: number): number;
  vm_flag_get(id: number): number;
  vm_flag_set(id: number, on: number): void;
  vm_flags_reset(): void;
  vm_var_get(id: number): number;
  vm_var_set(id: number, v: number): void;
  bt_io_ptr(): number;
  bt_events_ptr(): number;
  bt_load_data(): void;
  bt_load_team(side: number, n: number): void;
  bt_read_team(side: number): void;
  bt_start(trainer: number, double: number): number;
  bt_state(): void;
  bt_set_action(slot: number, kind: number, a: number, b: number): void;
  bt_turn(): number;
  bt_force_switch(slot: number, to: number): number;
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

  /** Capa de objetos (0 = vacío), vista directa sobre la memoria WASM. */
  get objects(): Uint8Array {
    return new Uint8Array(this.x.memory.buffer, this.x.engine_objects_ptr(), this.width * this.height);
  }

  // ----- Combate (Rust): búfer de enteros compartido -----
  static readonly BT_IO = 8192;
  static readonly EV_STRIDE = 13;
  /** Búfer de entrada/salida del combate (vista directa; no la guardes entre llamadas). */
  get btIo(): Int32Array { return new Int32Array(this.x.memory.buffer, this.x.bt_io_ptr(), Engine.BT_IO); }
  btEvents(n: number): Int32Array { return new Int32Array(this.x.memory.buffer, this.x.bt_events_ptr(), n * Engine.EV_STRIDE); }
  btLoadData() { this.x.bt_load_data(); }
  btLoadTeam(side: number, n: number) { this.x.bt_load_team(side, n); }
  btReadTeam(side: number) { this.x.bt_read_team(side); }
  btStart(trainer: boolean, double: boolean) { return this.x.bt_start(trainer ? 1 : 0, double ? 1 : 0); }
  btState() { this.x.bt_state(); }
  btSetAction(slot: number, kind: number, a: number, b: number) { this.x.bt_set_action(slot, kind, a, b); }
  btTurn() { return this.x.bt_turn(); }
  btForceSwitch(slot: number, to: number) { return this.x.bt_force_switch(slot, to); }

  // ----- VM de scripts (Rust) -----
  private flagIds = new Map<string, number>();
  /** Id estable (0–255) de una marca por nombre. */
  flagId(name: string): number {
    let id = this.flagIds.get(name);
    if (id === undefined) { id = this.flagIds.size % 256; this.flagIds.set(name, id); }
    return id;
  }
  private varIds = new Map<string, number>();
  /** Id estable (0–255) de una variable numérica por nombre. */
  varId(name: string): number {
    let id = this.varIds.get(name);
    if (id === undefined) { id = this.varIds.size % 256; this.varIds.set(name, id); }
    return id;
  }
  getVar(name: string) { return this.x.vm_var_get(this.varId(name)); }
  setVar(name: string, v: number) { this.x.vm_var_set(this.varId(name), v | 0); }
  private strVars = new Map<string, string>();
  getStr(name: string) { return this.strVars.get(name); }
  setStr(name: string, text: string) { this.strVars.set(name, text); }
  flagsReset() { this.flagIds.clear(); this.varIds.clear(); this.strVars.clear(); this.x.vm_flags_reset(); }
  hasFlag(name: string) { return this.x.vm_flag_get(this.flagId(name)) === 1; }
  setFlag(name: string, on: boolean) { this.x.vm_flag_set(this.flagId(name), on ? 1 : 0); }
  vmLoad(words: Uint32Array) {
    new Uint32Array(this.x.memory.buffer, this.x.vm_code_ptr(), words.length).set(words);
    this.x.vm_load(words.length / 4);
  }
  vmRun() { return this.x.vm_run(); }
  vmArg(i: number) { return this.x.vm_arg(i); }

  reset(w: number, h: number, seed = 1) { this.x.engine_reset(w, h, seed >>> 0); }
  loadMap(w: number, h: number, tiles: Uint8Array, seed = 1, objects?: Uint8Array) {
    this.reset(w, h, seed);
    this.tiles.set(tiles.subarray(0, w * h));
    if (objects) this.objects.set(objects.subarray(0, w * h));
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
