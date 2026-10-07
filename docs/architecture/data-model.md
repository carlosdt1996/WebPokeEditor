# Modelo de datos

Todas las entidades tienen `id` estable (string slug), `schemaVersion` global y se serializan a JSON (con opción binaria compacta para export).

## Entidades principales
- **Species**: id, nombre, tipos, stats base, habilidades, ratio de captura, evoluciones, learnset, sprites, cry.
- **Move**: id, tipo, categoría, poder, precisión, PP, prioridad, efecto (referencia a script/efecto de datos).
- **Ability / Item / Type** (con tabla de efectividad editable).
- **Trainer**: clase, equipo, IA, diálogo, recompensa.
- **Map**: tamaño, capas de tiles, colisiones, eventos, conexiones, música, encuentros.
- **Tileset**: atlas, tiles animados, atributos por tile (colisión, hierba, agua...).
- **Script**: grafo o código fuente compilado a bytecode.
- **GameConfig**: reglas, estado inicial, mapa de inicio.

## Referencias
Por `id`, nunca por índice, para permitir reordenar y mods. El *validator* en `project-io` detecta referencias rotas.

## Migraciones
Cada cambio de esquema incrementa `schemaVersion` e incluye migración + test.
