# Engine Core (Rust → WASM)

## Responsabilidades
- Estado del mundo: mapas, entidades (jugador, NPCs, objetos), flags/variables.
- Movimiento en grid, colisiones, warps, triggers.
- Reloj de simulación con tick fijo.
- Guardado/carga de partida (serialización de estado).
- Host de la [Script VM](scripting.md) y del [simulador de combate](battle-system.md).

## Diseño
- ECS ligero (p. ej. `hecs` o propio) con componentes: `Position`, `GridMover`, `Sprite`, `Collider`, `Interactable`, `NpcAi`.
- RNG determinista (`PCG`/`xoshiro`) con semilla en el estado.
- Sin I/O dentro del core; el host inyecta input y datos.

## API WASM (borrador)
```
engine_new(project_bytes) -> Engine
engine_tick(input_bits, dt_ticks)
engine_render_buffer_ptr() -> *const f32   // instancias para el renderer
engine_event_pop() -> Event                // diálogos, sonidos, cambios de escena
engine_save() -> bytes / engine_load(bytes)
```

## Pruebas
- Tests unitarios Rust + *golden replays* (secuencia de inputs → hash del estado).
