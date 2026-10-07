# Packs: compartir y reutilizar contenido

Un **pack** (`.wpe-pack.json`) agrupa especies, movimientos, objetos, habilidades, mapas y, opcionalmente, el tileset de un proyecto. Sirve para compartir plantillas, repartir mods o reutilizar tu propio contenido entre proyectos.

## Exportar
En **📋 Datos → Packs** marca qué incluir (categorías y mapas concretos) y pulsa **Exportar pack**. Se arrastran las dependencias: los movimientos y habilidades de las especies elegidas, sus evoluciones y las criaturas y objetos que usan los mapas (equipos de entrenadores, encuentros, tiendas).

## Importar
**Importar pack** aplica el archivo al proyecto actual y muestra un resumen. Si algún id ya existe puedes **renombrar** (sufijo `-2`, con las referencias internas actualizadas), **omitir** o **reemplazar**.

- Los **tipos** viajan por nombre, no por número: se reasignan a los del proyecto destino y se crean los que falten (máximo 16).
- Los saltos de un mapa del pack hacia mapas que no vienen en él generan un aviso: edítalos después.
- El tileset del pack solo se aplica si el proyecto no tiene uno propio.

Formato: ver `packages/editor/src/pack.ts` (`Pack`, `makePack`, `applyPack`). Los packs no contienen código, solo datos.
