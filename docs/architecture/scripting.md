# Scripting y eventos

## Objetivos
Que un creador sin programar pueda hacer cinemáticas, tiendas, puzles, misiones y gimnasios.

## Capas
1. **Comandos de evento** (como RPG Maker): mostrar texto, mover NPC, dar objeto, iniciar combate, warp, condicionales, bucles, flags/variables.
2. **Editor visual de nodos** que genera el mismo IR.
3. **Lenguaje de texto** (DSL pequeño) para usuarios avanzados.

## Ejecución
- IR → **bytecode** → **Script VM** (en Rust/WASM), cooperativa: cada script cede (`yield`) en esperas (diálogo, movimiento, frames).
- Determinista y serializable (se puede guardar a mitad de script).
- Sandbox: sin acceso a red/FS; solo la API del motor.

## Triggers
`OnInteract`, `OnStep`, `OnEnterMap`, `OnFlagChange`, `OnBattleEnd`, `OnTimer`.

## Extensión
Plugins en WASM (sandbox) o JS limitado para añadir comandos. Ver ADR-0005 (pendiente).

## Implementación actual
- **Parser/compilador** (`packages/editor/src/script.ts`, TypeScript): lenguaje de líneas con `say` (con `{variable}`), `give <objeto>`, `heal`, `flag/unflag`, `set/add` (variables enteras), `if/ifnot/else/end` por marca o comparación (`== != > < >= <=`), `while`, `repeat n`, `break`, `battle`, `givemon` y `warp`. Compila a bytecode de 4 palabras por instrucción + tabla de cadenas. Valida sintaxis y, desde `project.ts`, las referencias (especies, mapas, objetos).
- **VM** (`crates/engine-core`, Rust): ejecuta saltos y comparaciones y guarda **256 marcas y 256 variables** en memoria WASM; *cede* (yield) en cada operación con efecto y el host (`game.ts`) la resuelve de forma asíncrona antes de reanudarla. Un límite de pasos y otro de acciones protegen de bucles infinitos. Ver [ADR-0007](../adr/0007-script-vm-en-rust.md).
- **Disparadores por casilla** (`GameMap.triggers`): ejecutan un script al pisar la casilla (opcionalmente solo la primera vez). Variables predefinidas al empezar cada script: `steps`, `party`, `level`.
- Pendiente: strings/arrays, funciones y eventos por entrada de mapa.
