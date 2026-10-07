# Accesibilidad e idiomas

## Accesibilidad
- **Teclado**: todo el editor es operable con teclado (foco visible); el juego se maneja con flechas/WASD, Enter/Z y Q/E (cámara 3D).
- **Lectores de pantalla**: los controles reciben nombre accesible automáticamente (`a11y.ts`); la barra de pestañas usa roles `tablist`/`tab`; los cuadros de diálogo y de combate se anuncian como regiones `aria-live`.
- **Movimiento reducido**: se respeta `prefers-reduced-motion` y hay una casilla «Movimiento reducido» en el pie para forzarlo: desactiva las animaciones CSS, los tiles animados y las sacudidas.
- **Contraste**: el texto secundario usa un gris más claro sobre el fondo oscuro.
- Un test E2E comprueba que ningún control visible queda sin nombre accesible.

## Idiomas
La interfaz del editor, los menús del combate, los mensajes de combate y los textos del juego generados por el motor están disponibles en **español** (idioma de referencia) e **inglés**. Cambia el idioma con el selector de la barra superior (se recuerda en el navegador).

Los textos que escribe el autor (diálogos de NPC, nombres de criaturas, guiones) no se traducen: son contenido del proyecto. Para añadir un idioma: añade su diccionario en `src/i18n.en.ts` (la clave es el texto en español) y regístralo en `i18n.ts`; el test `i18n.test.ts` comprueba que todo texto marcado con `t()` tiene traducción con los mismos parámetros.
