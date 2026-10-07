# Sistema de combate

## Principios
- Simulación **pura y determinista**: `(estado, acciones, semilla) -> (nuevo estado, eventos)`.
- Separada de la presentación: la UI consume la lista de eventos (`Damage`, `Faint`, `StatChange`, ...).
- Efectos de movimientos/habilidades/objetos **dirigidos por datos** + *hooks* de script.

## Fases del turno
Selección de acciones → orden (prioridad, velocidad) → ejecución → efectos de fin de turno → comprobar derrotas/cambios.

## Alcance por etapas
1. 1v1, daño, tipos, estados básicos, captura.
2. Habilidades, objetos en combate, clima/terreno.
3. Dobles, entrada de peligro, mecánicas por generación (configurable).

## Configuración por generación
Fórmulas y reglas seleccionables (p. ej. Gen 3 vs. Gen 5+) mediante `GameConfig.rules`.

## IA de trainers
Niveles: aleatoria → heurística de daño → reglas por trainer (scripteable).

## Validación
Tests contra casos conocidos de cálculo de daño y *replays*.

## Implementación actual
La simulación está en **Rust** (`crates/engine-core/src/battle.rs`), con soporte 1v1 y 2v2:
- **Datos**: el host carga las tablas (tipos con su tabla de efectividad ×100, movimientos, especies con stats, evolución y learnset) y los equipos en un búfer de enteros compartido (`bt_io_ptr`), y llama a `bt_start`.
- **Turno**: el host fija una acción por casilla (`bt_set_action`: mover+objetivo, cambiar, curar, bola, huir) y llama a `bt_turn`. Rust ordena (cambios/objetos antes que ataques; luego velocidad; desempate con el RNG), ejecuta, reparte experiencia, sube de nivel, aprende movimientos y evoluciona.
- **Salida**: una lista de eventos numéricos (`E_USE`, `E_HIT`, `E_FAINT`, `E_EXP`…), cada uno con una instantánea de los PS en pantalla. `packages/editor/src/battle.ts` los traduce a texto en español y refleja el estado final en los objetos `Mon` de JS.
- Comparte el RNG determinista con el mundo: misma semilla + mismas acciones = mismo combate.
- Límites: 16 tipos, 256 movimientos, 128 especies, 8 movimientos por nivel por especie (el proyecto lo valida).
Un entrenador con `double: true` activa el modo doble si ambos lados tienen 2+ criaturas en pie. Pendiente: habilidades, estados alterados, efectos de movimientos por datos.
