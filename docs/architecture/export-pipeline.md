# Exportación

## Objetivos
Generar un juego jugable a partir del proyecto, sin servidor.

## Salidas
| Target | Contenido |
|---|---|
| **Web (estático)** | `index.html`, `player.js`, `engine.wasm`, `game.pack`, assets |
| **PWA** | Lo anterior + `manifest` y service worker (offline) |
| **Escritorio** (opcional) | Envoltorio Tauri/Electron |

## Pasos
1. Validar proyecto (referencias, scripts, assets faltantes).
2. Compilar scripts a bytecode.
3. Empaquetar datos y assets en `game.pack` (compresión, hashes, atlas optimizados).
4. Ensamblar player + wasm.
5. Descargar `.zip` (File System Access API / blob).

## Seguridad
El pack no ejecuta código arbitrario: solo datos + bytecode de la VM.
