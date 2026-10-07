# Tutorial: datos y combate

## Especies
Cada especie tiene tipos (1 o 2), seis estadísticas base, movimientos iniciales, un *learnset* (nivel → movimiento), una evolución opcional (nivel + especie destino), una habilidad y, si quieres, un sprite propio importado. También puedes importar/exportar **CSV** para editarlas en una hoja de cálculo.

## Movimientos y efectos
Un movimiento tiene tipo, categoría (físico/especial), poder y precisión. Los **efectos** se definen por datos:
| Efecto | Qué hace |
|---|---|
| Prioridad (−3…+3) | Actúa antes/después sin importar la velocidad |
| Estado | Quema, veneno, parálisis, sueño o congelación con una probabilidad |
| Estadística | Sube/baja una estadística (también precisión/evasión) al usuario o al rival |
| Drenaje / Retroceso / Cura | % del daño que cura o hiere, o % de PS que cura |
| Golpes / Crítico | Multigolpe (1–5) y probabilidad de crítico |
| Carga / Recarga | Tarda un turno en cargarse / pierde el turno siguiente |
| Clima / Terreno | Establece un clima o un terreno de 5 turnos |
| Protege | Anula los ataques del turno (falla si se usó el turno anterior) |
| Amedrenta % | Probabilidad de que el rival pierda el turno |
| Atrapa | 4–5 turnos sin poder huir ni cambiar y con daño residual |
| Fuerza cambio | El rival salvaje huye; un entrenador saca a otra criatura |

## Objetos
Tipos: **curar PS**, **curar estado**, **captura** (bonus a la probabilidad), **equipable** y **objeto clave**. Los equipables son datos: refuerzo de tipo, restos, baya de curación, baya de estado, banda de aguante y **transformación** (una vez por combate, +% a las estadísticas y, opcionalmente, un tipo nuevo; el jugador la activa al elegir movimiento). Los objetos con **precio** se pueden vender en tiendas; los objetos clave no se venden ni se usan en combate.

## Habilidades y clima
Habilidades: potencia con pocos PS, absorbe un tipo, inmune a un tipo o estado, intimidar, velocidad creciente y clima al entrar. El clima potencia/debilita tipos y daña a quien no es inmune: todo se edita en *Reglas de clima*.

## Equilibrio
`npm test` incluye un test de equilibrio que simula combates automáticos de un equipo de referencia contra cada líder y comprueba que la dificultad media sube con el nivel. Si cambias los equipos de una plantilla, ejecútalo y mira la tabla de tasas de victoria que imprime.
