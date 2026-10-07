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
