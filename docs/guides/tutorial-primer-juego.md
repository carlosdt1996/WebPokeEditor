# Tutorial: tu primer juego en 15 minutos

Este tutorial te lleva desde un proyecto vacío hasta un juego exportado y jugable. No necesitas instalar nada: abre el editor en el navegador.

## 1. Empieza desde una plantilla
**Nuevo → plantilla** ofrece tres puntos de partida:
- **Mini mundo de ejemplo**: un pueblo, una casa y una ruta. Ideal para aprender.
- **Valle del Alba**: región corta (aldea, 4 ciudades, campeona final).
- **Archipiélago de la Marea**: región completa (38 mapas, 8 gimnasios, Liga, rival, equipo villano…).

Todo el contenido es original: no hay criaturas, mapas ni personajes con copyright. Si quieres usar tus propios gráficos, ver [aspectos legales](legal-and-assets.md).

## 2. Pinta el mapa
En la pestaña **🗺️ Mapa** elige una herramienta (pintar, rellenar, cuentagotas, elevar/bajar) y un tile de la paleta. Hay tres capas: **suelo**, **objetos** (árboles, vallas…, con colisión propia) y **alturas** (solo afectan al modo 3D 🧊). Atajos: rueda = zoom, clic derecho o Espacio+arrastrar = mover, Ctrl+Z / Ctrl+Y = deshacer / rehacer.

## 3. Coloca personas y puertas
Con la herramienta de NPC haz clic en una casilla. En el **Inspector** eliges el tipo:
- **Conversación**: diálogo de varias líneas.
- **Entrenador**: tiene un equipo propio; te reta al verte. Puede ser un combate **doble** y tener un *script al ganar* (medallas, premios).
- **Curandero**: cura al equipo.
- **Tienda**: vende los objetos que marques (precios en la pestaña Datos) y compra los tuyos a la mitad.
- **Script**: ejecuta un guion (ver [tutorial de scripts](tutorial-scripts.md)).

Los **saltos** (puertas y rutas) llevan a otro mapa y casilla. Cada puerta debería tener su vuelta.

## 4. Prueba el juego
Pulsa **▶ Probar**: caminas con las flechas (o WASD), interactúas con Enter/Z, y la hierba alta lanza encuentros. En cualquier momento puedes pasar a **🧊 3D** (requiere WebGPU).

## 5. Ajusta los datos
En **📋 Datos** editas especies, movimientos (con efectos: estados, estadísticas, drenaje, protección, atrapar…), habilidades, clima, objetos, dinero inicial, equipo inicial y encuentros por mapa. Detalles en el [tutorial de datos y combate](tutorial-datos-y-combate.md).

## 6. Exporta
- **Exportar proyecto**: un `.wpe.json` para seguir editando (guarda tu trabajo; el editor también autoguarda en el navegador).
- **📦 Exportar juego**: un único `.html` autocontenido (motor WASM + datos) que funciona sin servidor: súbelo a cualquier alojamiento o ábrelo con doble clic.
- **Packs**: para compartir solo una parte (mapas, criaturas…), ver [packs](packs.md).
