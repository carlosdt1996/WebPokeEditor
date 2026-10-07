# WebPokeEditor

Creador de **fangames de Pokémon** que corre íntegramente en el navegador, usando **WebAssembly** (núcleo del motor y herramientas) y **WebGPU** (renderizado del mapa, sprites y vista previa del juego).

> Estado: fase de diseño. Ver [`ROADMAP.md`](ROADMAP.md).

## Visión

Una herramienta tipo "RPG Maker para Pokémon" sin instalación: editas mapas, Pokémon, movimientos, objetos, scripts y trainers desde el navegador, pruebas el juego al instante y exportas un paquete jugable (web o ROM/instalable).

## Documentación

| Documento | Contenido |
|---|---|
| [`ROADMAP.md`](ROADMAP.md) | Fases e hitos |
| [`CONTRIBUTING.md`](CONTRIBUTING.md) | Cómo contribuir, estilo y flujo de trabajo |
| [`CLAUDE.md`](CLAUDE.md) | Guía para asistentes de IA que trabajen en el repo |
| [`docs/architecture/overview.md`](docs/architecture/overview.md) | Arquitectura general |
| [`docs/architecture/engine-core.md`](docs/architecture/engine-core.md) | Núcleo del motor (WASM) |
| [`docs/architecture/rendering.md`](docs/architecture/rendering.md) | Render WebGPU |
| [`docs/architecture/editor-ui.md`](docs/architecture/editor-ui.md) | UI del editor |
| [`docs/architecture/data-model.md`](docs/architecture/data-model.md) | Modelo de datos del proyecto |
| [`docs/architecture/scripting.md`](docs/architecture/scripting.md) | Sistema de scripts/eventos |
| [`docs/architecture/battle-system.md`](docs/architecture/battle-system.md) | Sistema de combate |
| [`docs/architecture/export-pipeline.md`](docs/architecture/export-pipeline.md) | Exportación y empaquetado |
| [`docs/formats/project-format.md`](docs/formats/project-format.md) | Formato de proyecto en disco |
| [`docs/formats/map-format.md`](docs/formats/map-format.md) | Formato de mapas y tilesets |
| [`docs/guides/development-setup.md`](docs/guides/development-setup.md) | Entorno de desarrollo |
| [`docs/guides/testing.md`](docs/guides/testing.md) | Estrategia de pruebas |
| [`docs/guides/legal-and-assets.md`](docs/guides/legal-and-assets.md) | Aspectos legales y assets |
| [`docs/adr/`](docs/adr/) | Decisiones de arquitectura (ADR) |

## Estructura prevista del repositorio

```
WebPokeEditor/
├── crates/              # Rust → WASM
│   ├── engine-core/     # ECS, mapas, colisiones, estado de juego
│   ├── battle/          # Simulación de combate (determinista)
│   ├── script-vm/       # Máquina virtual de scripts
│   └── project-io/      # (De)serialización y validación de proyectos
├── packages/            # TypeScript
│   ├── renderer/        # WebGPU (WGSL)
│   ├── editor/          # UI del editor
│   ├── player/          # Runtime jugable embebible
│   └── shared/          # Tipos y utilidades comunes
├── assets/              # Assets propios/libres de ejemplo
├── docs/
└── tests/
```

## Stack propuesto

- **Rust → WASM** (`wasm-bindgen`) para lógica del motor, combate y VM de scripts.
- **WebGPU + WGSL** para render 2D (tilemaps instanciados, sprites, efectos); fallback a WebGL2/Canvas2D.
- **TypeScript** para la UI del editor y la capa de integración.
- **Web Workers + SharedArrayBuffer** para tareas pesadas.
- **OPFS / IndexedDB** para persistencia local de proyectos.

Detalle y justificación en [`docs/adr/`](docs/adr/).

## Licencia

Por definir. Ver [`docs/guides/legal-and-assets.md`](docs/guides/legal-and-assets.md) (Pokémon es marca de Nintendo/Game Freak/Creatures; este proyecto no está afiliado).
