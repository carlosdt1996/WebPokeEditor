# Estrategia de pruebas

| Nivel | Herramienta | Qué cubre |
|---|---|---|
| Unitarias Rust | `cargo test` | Motor, combate, VM, serialización |
| Propiedades | `proptest` | Invariantes (determinismo, round-trip de formatos) |
| Golden replays | Rust | Secuencia de inputs → hash de estado |
| Unitarias TS | Vitest | Lógica de UI, comandos undo/redo |
| Visuales | Playwright + capturas | Renderer y editor (tolerancia por píxel) |
| E2E | Playwright | Crear proyecto → editar → probar → exportar |
| Rendimiento | Benchmarks | Frame time, tamaño de mapa, tamaño de wasm |

CI: lint → tests Rust → build WASM → tests TS → E2E.

## Estado actual
- **Rust** (`cargo test`): movimiento, colisiones, bloqueadores, determinismo, fórmula de daño.
- **Vitest** (`packages/editor/src/engine.test.ts`): API WASM, migración de esquema, validación, combate (determinismo, captura, XP, aprendizaje y evolución), parser/ejecutor de scripts.
- **E2E** (`packages/editor/e2e/e2e.mjs`, 19 pruebas en Chromium real con WebGPU por software): edición (pintar, deshacer/rehacer, rellenar, cuentagotas, redimensionar, persistencia), inspector de NPC/saltos y scripts, gestión de mapas, recorrer puertas, NPC con script, curandero, entrenador con visión y combate completo (victoria, captura, derrota), modo 3D, importación de sprites/atlas (válidos e inválidos), exportar/importar proyecto (incluida migración v1 y JSON inválido) y exportar el juego a `.html` y jugarlo. `SHOTS=dir` guarda capturas.
- El job `e2e` de CI es informativo (`continue-on-error`).
