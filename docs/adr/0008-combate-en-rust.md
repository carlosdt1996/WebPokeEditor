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

## Actualización: efectos, estados y habilidades
El mismo protocolo se amplió con efectos de movimientos, estados alterados, etapas y habilidades definidos por datos (tablas de 14 enteros por movimiento y 3 por habilidad; la especie lleva su habilidad). Cada evento lleva ahora una instantánea de índice, PS y **estado** por casilla (17 enteros por evento). Los volátiles del combate (etapas y turnos de sueño) viven solo en Rust, por eso el host sube los equipos en cada turno sin tocarlos.

## Actualización: clima, terreno, objetos equipables y movimientos avanzados
El protocolo pasó a 5 cabeceras, una tabla de reglas de clima (4×8), movimientos de 25 enteros (incluye protección, amedrentar, atrapar y forzar cambio) y criaturas de 11 (con objeto equipado). Los volátiles nuevos (carga, recarga, clima y terreno) también viven solo en Rust. `bt_start` recibe el clima del mapa. Los objetos equipables de un solo uso se consumen en Rust y el host refleja el cambio en `Mon.held` al leer el equipo de vuelta.
