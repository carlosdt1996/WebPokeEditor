# WebPokeEditor

Creador de **fangames de Pokémon** que corre íntegramente en el navegador, usando **WebAssembly** (núcleo del motor y herramientas) y **WebGPU** (renderizado del mapa, sprites y vista previa del juego).

> **Demo en vivo:** https://carlosdt1996.github.io/WebPokeEditor/
>
> Estado: MVP funcional. Ver [`ROADMAP.md`](ROADMAP.md).

## Qué hay ya
- **Editor de mapas** con varios mapas por proyecto y **tres capas** (suelo, objetos con transparencia y colisión propia, y alturas para el 3D): pintar, rellenar, cuentagotas, elevar/bajar, deshacer/rehacer, zoom/pan, redimensionar. **Tiles animados** (agua, hierba alta).
- **NPCs** (conversación, entrenadores con equipo propio, curanderos y **scripts de eventos** ejecutados por una **VM en Rust/WASM** (mensajes con `{variables}`, objetos, marcas y variables numéricas persistentes, condicionales, bucles, combates, warps) **funciones**, **menús de elección**, textos, **script al entrar al mapa** y **disparadores por casilla**) y **saltos entre mapas** (puertas, rutas) con inspector.
- **Modo Probar**: caminas por el mundo, hablas con NPCs, te ven los entrenadores, hay encuentros en hierba alta y combates por turnos jugables, **1v1 y 2v2** (movimientos, tipos, STAB, críticos, **estados alterados, cambios de estadística y habilidades definidos por datos**, objetos configurables, cambio, huida, captura, experiencia, subida de nivel, movimientos por nivel y evoluciones).
- **Modo 3D** (🧊, estilo DS "Diamante/Perla"): terreno con alturas editables, edificios, objetos, agua animada, árboles y personajes como billboards, cámara inclinada que sigue al jugador y se puede girar (Q/E) y orbitar con el ratón. Requiere WebGPU.
- **Render WebGPU** (2D instanciado + 3D con depth buffer) con **fallback Canvas 2D** para el modo 2D.
- **Núcleo Rust → WASM** determinista: movimiento en grid, colisiones, capas, encuentros, RNG, **simulación de combate 1v1/2v2** y **VM de scripts**.
- **Editor de datos**: especies, movimientos, **objetos e inventario**, equipo inicial, encuentros por mapa; **importar/exportar CSV** de especies y movimientos.
- **Gráficos**: criaturas y arte originales generados por código. Puedes **importar tus propios sprites y tileset** (se quedan en tu navegador/proyecto; ver [aspectos legales](docs/guides/legal-and-assets.md)).
- **Exportar juego**: un único `.html` autocontenido (motor WASM + datos + player) que se juega sin servidor.
- **PWA**: instalable y funciona sin conexión tras la primera visita.
- Audio sintetizado (SFX y música) con WebAudio.
- Guardado automático en **OPFS** (con respaldo en localStorage) + **importar/exportar** proyecto (`.wpe.json`, esquema versionado con migraciones).

## Empezar
```bash
npm install
npm run dev      # compila el WASM y levanta Vite
npm test         # cargo test + vitest
npm run build && npm run e2e -w packages/editor   # pruebas de navegador (Playwright)
```
Requiere Rust (`rustup target add wasm32-unknown-unknown`) y Node 20+.

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
├── crates/
│   └── engine-core/     # Rust → WASM: mapa, movimiento, encuentros, daño   (hecho)
│       (previstos: battle, script-vm, project-io)
├── packages/
│   └── editor/          # Editor web (TS + Vite + WebGPU)                    (hecho)
│       (previstos: player, shared)
├── scripts/build-wasm.sh
├── .github/workflows/pages.yml   # CI + despliegue a GitHub Pages
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
