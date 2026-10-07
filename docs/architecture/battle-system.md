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
