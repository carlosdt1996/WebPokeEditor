# UI del editor

## Módulos
- **Mapa**: pintar tiles, capas, colisiones, eventos, NPCs, conexiones entre mapas.
- **Tilesets / Sprites**: importación, recorte, paletas, animaciones.
- **Datos**: especies, movimientos, habilidades, objetos, tipos, trainers, encuentros.
- **Scripts**: editor visual de nodos + editor de texto con resaltado.
- **Música/SFX**: importar y asignar a mapas/eventos.
- **Probar**: lanzar el juego en un panel con recarga en caliente.
- **Ajustes de proyecto**: título, resolución, reglas (generación de mecánicas).

## Requisitos transversales
- Deshacer/rehacer global (patrón *command*, incluye operaciones de mapa).
- Autoguardado y recuperación tras cierre.
- Atajos de teclado configurables, accesibilidad (teclado completo, contraste).
- i18n (ES/EN como mínimo).

## Tecnología
Framework de UI a decidir en ADR (candidatos: SolidJS, React, Svelte). El canvas WebGPU se aísla del árbol de componentes.
