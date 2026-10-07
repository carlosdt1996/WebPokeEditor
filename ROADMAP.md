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
- [x] Eventos por NPC con scripts, ejecutados en una VM en Rust (pendiente: triggers por casilla y variables numéricas)
- [x] Modo "Probar" dentro del editor

## Fase 3 — Datos Pokémon
- [~] Editor de especies, stats, movimientos, equipo (evoluciones y learnsets por nivel hechos)
- [x] Editor de movimientos y objetos genéricos (curación / captura)
- [x] Editor de trainers y encuentros salvajes
- [x] Importar/exportar proyecto en JSON y especies/movimientos en CSV

## Fase 4 — Combate
- [x] Combate determinista 1v1 y 2v2 jugable (la simulación sigue en TS; ver battle-system.md)
- [ ] Habilidades y efectos de movimientos mediante datos + scripts
- [~] UI de combate (animaciones básicas)

## Fase 5 — Exportación y comunidad
- [x] Export: proyecto JSON, juego autocontenido `.html` y la propia app como PWA
- [ ] Export de escritorio (Tauri/Electron) opcional
- [ ] Sistema de plugins/mods
- [ ] Compartir proyectos, plantillas y tilesets

## Fase 6 — Pulido
- [x] Modo 3D estilo DS (vista)
- [x] Pruebas E2E en navegador
- [x] Audio sintetizado (SFX + música)
- [ ] Rendimiento, accesibilidad, i18n
- [ ] Documentación de usuario y tutoriales
