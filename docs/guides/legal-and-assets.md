# Aspectos legales y assets

> No es asesoría legal.

- *Pokémon* y sus nombres, personajes y arte son propiedad de Nintendo, Game Freak y Creatures Inc. Este proyecto **no está afiliado** a ellos.
- El repositorio **no incluye** sprites, música, ROMs ni datos extraídos de juegos oficiales.
- Se proveerán assets de ejemplo propios o con licencia libre (CC0/CC-BY) y **criaturas originales** de demostración.
- Los usuarios son responsables de los assets que importen en sus proyectos.
- Se evitará cualquier función que descargue o distribuya material con copyright.
- Documentar licencias de assets en `assets/LICENSES.md`.

## Sprites de Pokémon y otros assets oficiales

Este repositorio y su web **no incluyen ni distribuyen** sprites, modelos, música ni datos extraídos de los juegos oficiales: son obra protegida y publicarlos (repo público + GitHub Pages) sería redistribuirla.

Para que cada creador pueda usar los gráficos que tenga derecho a usar:
- **Sprites de criaturas**: en *Datos → Especies* el botón ⬆ importa una imagen propia. Se redimensiona y se guarda como data URL **solo en tu proyecto** (localStorage / archivo `.wpe.json` que tú exportas).
- **Tileset y personajes**: en *Datos → Gráficos propios* puedes importar un atlas PNG (128×80, celdas de 16×16) siguiendo la plantilla descargable.
- Si no importas nada, el editor usa arte **original** generado por código.
- Si compartes un `.wpe.json` con imágenes importadas, eres responsable de tener los derechos sobre ellas.

## Réplicas de regiones o juegos oficiales (p. ej. «clavado a Hoenn»)

El repositorio **no incluye ni reproduce** mapas, personajes, historia, equipos de líderes ni criaturas de juegos oficiales: copiarlos fielmente es una obra derivada de material protegido, igual que los sprites. Por eso la plantilla incluida, **«Archipiélago de la Marea»**, es una región **original** que solo comparte la *estructura genérica* de un RPG de captura (pueblo inicial → rutas → ciudades con gimnasio y medalla → Liga), con nombres, mapas, criaturas, movimientos y diálogos propios.

Si quieres recrear una región oficial para uso personal, el editor lo permite (mapas, NPC, scripts, importación de tus gráficos), pero ese contenido debe quedarse en tu proyecto y no en este repositorio.
