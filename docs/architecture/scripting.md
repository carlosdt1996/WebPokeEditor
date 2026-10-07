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
