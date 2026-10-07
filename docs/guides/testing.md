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
- **Rust** (`cargo test`): movimiento, colisiones, bloqueadores, capa de objetos, determinismo, fórmula de daño, VM de scripts (marcas, variables, bucles) y simulación de combate (1v1, 2v2, XP, aprendizaje, evolución, objetos, huida, captura, estados, etapas, prioridad, drenaje, retroceso, curación, habilidades, multigolpe, carga/recarga, clima, terreno, precisión/evasión, críticos y objetos equipables). Los tests de Rust se ejecutan en un hilo (`.cargo/config.toml`) porque el estado del núcleo es global.
- **Vitest** (`packages/editor/src/engine.test.ts`): API WASM, migraciones v1→v5, validación, combate (1v1, 2v2, captura, objetos, XP, aprendizaje, evolución, estados, habilidades y efectos), scripts sobre la VM de Rust (variables, bucles, funciones, menús, listas, texto, `break`, interpolación, límites), capa de objetos y CSV.
- **E2E** (`packages/editor/e2e/e2e.mjs`, Chromium real con WebGPU por software): edición y capas (suelo, objetos, alturas), inspector de NPC/saltos/scripts, gestión de mapas, recorrer puertas, NPC con script, curandero, entrenadores (1v1 y 2v2) con combate completo, captura y derrota, modo 3D, importación de sprites/atlas, objetos, CSV, exportar/importar proyecto (incluida migración), guardado en OPFS, PWA sin conexión e instalabilidad (CDP), audio (notas programadas y contexto activo; no se puede juzgar el sonido), disparadores por casilla, listas/texto, script de salida, equipar objetos, clima de mapa y exportar el juego a `.html`. `SHOTS=dir` guarda capturas.
- El job `e2e` de CI es informativo (`continue-on-error`).
