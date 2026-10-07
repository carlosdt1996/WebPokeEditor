# Aplicación de escritorio (opcional)

El juego exportado es un único `.html`, así que puede empaquetarse como aplicación de escritorio con cualquier contenedor web. Dos caminos habituales (no están verificados dentro de este repositorio):

## Tauri (ligero)
1. Instala Rust y la CLI: `cargo install tauri-cli`.
2. `cargo tauri init` y apunta `frontendDist` a la carpeta donde dejes el `.html` exportado (renómbralo `index.html`).
3. `cargo tauri build` genera instaladores para tu sistema.

## Electron
1. `npm init -y && npm i electron --save-dev`.
2. Un `main.js` mínimo que cree una `BrowserWindow` y haga `loadFile("index.html")`.
3. Empaqueta con `electron-builder` o `electron-packager`.

Notas:
- WebGPU depende del navegador embebido: Tauri usa el de la plataforma (WebView2/WebKit) y Electron incluye Chromium. Si no está disponible, el juego usa el render 2D con Canvas.
- La **PWA** (instalable desde el navegador) es la alternativa sin herramientas extra.
- Este repositorio no incluye todavía un empaquetado de escritorio propio, porque no puede verificarse en el entorno de integración continua.
