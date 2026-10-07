# Roadmap

Leyenda: `[x]` hecho · `[~]` parcial (MVP) · `[ ]` pendiente

## Fase 0 — Fundamentos
- [x] Monorepo (Cargo workspace + npm workspaces)
- [x] CI: lint, tests, build WASM
- [x] Prototipo "hello triangle" WebGPU + módulo WASM
- [x] ADRs iniciales (lenguaje, render, formato, 3D, assets)

## Fase 1 — Render y mapas (MVP técnico)
- [x] Renderer WebGPU de tilemaps (2D + 3D) con capas y tiles animados
- [x] Sprites y atlas de texturas
- [x] Editor de mapas: pintar, rellenar, colisiones, varios mapas, NPC, saltos, capas de objetos y alturas
- [x] Formato de proyecto versionado con migraciones (v1→v3); guardado en OPFS con respaldo localStorage

## Fase 2 — Jugabilidad base
- [x] Movimiento del jugador en grid, colisiones, warps
- [x] Diálogos y menús de combate
- [x] Eventos por NPC, por casilla y al entrar al mapa con scripts (variables, bucles, funciones, menús) en una VM en Rust
- [x] Modo "Probar" dentro del editor

## Fase 3 — Datos Pokémon
- [~] Editor de especies, stats, movimientos, equipo (evoluciones y learnsets por nivel hechos)
- [x] Editor de movimientos y objetos genéricos (curación / captura)
- [x] Editor de trainers y encuentros salvajes
- [x] Importar/exportar proyecto en JSON y especies/movimientos en CSV

## Fase 4 — Combate
- [x] Combate determinista 1v1 y 2v2 jugable, simulado en Rust (ver battle-system.md)
- [x] Habilidades, estados alterados, clima, terreno, objetos equipables y efectos de movimientos mediante datos
- [~] UI de combate (animaciones básicas)

## Fase 5 — Exportación y comunidad
- [x] Export: proyecto JSON, juego autocontenido `.html` y la propia app como PWA
- [~] Export de escritorio (Tauri/Electron) opcional: guía en docs/guides/exportar-escritorio.md; sin empaquetado propio
- [x] Mods mediante packs de datos (sin código ejecutable por seguridad)
- [x] Compartir plantillas, contenido y tilesets mediante packs `.wpe-pack.json`

## Fase 6 — Pulido
- [x] Modo 3D estilo DS (vista)
- [x] Pruebas E2E en navegador
- [x] Audio sintetizado (SFX + música)
- [x] Accesibilidad (ARIA, teclado, movimiento reducido) e i18n español/inglés
- [x] Pruebas de rendimiento del núcleo (presupuestos en perf.test.ts)
- [x] Documentación de usuario y tutoriales (docs/guides)

## Contenido
- [x] Plantilla «Archipiélago de la Marea»: 38 mapas, 8 gimnasios, Liga, rival, equipo villano y progresión por medallas
- [x] Plantilla «Valle del Alba»: región corta con 4 ciudades y campeona
- [x] Segunda región original y mecánicas de combate adicionales (protección, atrapar, amedrentar, forzar cambio, transformación)
- [x] Dinero propio del juego, tiendas y objetos clave (esquema v6)
