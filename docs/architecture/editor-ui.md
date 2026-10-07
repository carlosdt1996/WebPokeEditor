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


## Disposición al estilo de Godot
La interfaz imita la organización del editor de Godot 4 (no sus iconos, logotipos ni recursos; los iconos son emojis):
- **Barra superior**: menú *Proyecto* (Nuevo, Importar, Exportar proyecto, Exportar juego), nombre del proyecto, espacios de trabajo (*Mapa*, *Datos*, *Calculadora*, *3D*) y, a la derecha, idioma, sonido y ▶ Probar / ■ Detener.
- **Izquierda**: dock **Escena** (árbol del mapa actual: NPC, saltos y disparadores; al hacer clic se selecciona el elemento) y dock **Sistema de archivos** (`res://`: mapas, especies, movimientos, objetos y habilidades; abre la pestaña Datos en la sección correspondiente).
- **Centro**: barra de herramientas (Mover, Pintar, Rellenar…), vista del mapa y **panel inferior** con pestañas *Tiles* (paleta) y *Mensajes*.
- **Derecha**: **Inspector** con secciones plegables (selección, mapa y clima, scripts al entrar/salir).
- **Barra de estado** inferior. Paleta de colores oscura azulada con acento azul.
- En pantallas estrechas los paneles se apilan (ver `docs/guides/movil.md`).

El código está en `ui/docks.ts` (árbol de escena, sistema de archivos y menú) y en el ensamblado de `main.ts`; los estilos, al final de `style.css`.
