# Jugar y editar desde el móvil

La web (y el `.html` exportado) es **responsive**: se adapta a pantallas estrechas y táctiles.

## Jugar
- Al pulsar **▶ Probar** (o abrir un juego exportado) aparece un **mando táctil** sobre el juego: cruceta a la izquierda, botón **A** (interactuar / avanzar diálogo) a la derecha y, en modo 3D, botones ↺ ↻ para girar la cámara.
- También puedes **tocar el cuadro de diálogo** para avanzarlo, y los menús (elección, combate, mochila) son botones grandes.
- En móvil el panel del editor se oculta mientras juegas para dar todo el espacio al mapa. En horizontal el juego ocupa casi toda la pantalla.
- Añade la web a la pantalla de inicio (PWA) para jugar a pantalla completa y sin conexión.

## Editar
- El mapa se muestra arriba y las herramientas, la paleta y el inspector debajo (desliza hacia abajo).
- **Un dedo** pinta con la herramienta elegida; con la herramienta **✋ Mover** un dedo arrastra el mapa.
- **Dos dedos** siempre mueven y hacen zoom (pellizcar), sin pintar. En 3D, un dedo orbita y el pellizco acerca o aleja.
- Las tablas de Datos hacen scroll horizontal dentro de su panel; los controles tienen un tamaño mínimo de 40 px en pantallas táctiles.

## Detalles técnicos
- El mando usa eventos de puntero (`pointerdown/up`) y reutiliza el mismo manejador de teclas que el teclado, así que el comportamiento es idéntico.
- Reglas CSS: `@media (max-width: 900px)` para el diseño apilado, `(pointer: coarse)` para los tamaños táctiles y `(max-height: 520px)` para móvil apaisado. Respeta las áreas seguras (`env(safe-area-inset-*)`).
- Los E2E incluyen un contexto móvil (390×844, táctil): sin desbordes horizontales, pintar con un toque, pellizcar, mando táctil, 3D y combate.
