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
