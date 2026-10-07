# ADR-0008: Simulación de combate en Rust con eventos numéricos

- Estado: aceptado
- Fecha: 2026-10-07

## Contexto
El combate era TypeScript sobre `engine.rand`/`engine.damage`. El diseño del proyecto quiere un núcleo determinista único, reutilizable por cualquier host.

## Decisión
Port completo a Rust (`battle.rs`). La frontera WASM usa un búfer de `i32` para cargar datos y equipos y para devolver eventos con una instantánea de PS; el texto lo genera el host. El estado de las criaturas es de JS entre turnos (se vuelve a subir en cada llamada), de modo que el juego y las pruebas pueden modificarlo; Rust guarda solo las casillas activas y el resultado.

## Alternativas
Mantener TS (más simple, pero la lógica no sería portable); un crate/`.wasm` aparte (más fricción para compartir el RNG).

## Consecuencias
+ Mismo RNG y reglas en cualquier host; + 4 tests de Rust del combate además de los de TS que ya existían (pasaron sin cambios). − El `.wasm` crece (≈154 KB) por el uso de `Vec`; − límites fijos de tablas (16/256/128).
