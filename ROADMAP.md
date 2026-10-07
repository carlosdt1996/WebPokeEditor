# Roadmap

Leyenda: `[x]` hecho · `[~]` parcial (MVP) · `[ ]` pendiente

## Fase 0 — Fundamentos
- [x] Monorepo (Cargo workspace + npm workspaces)
- [x] CI: lint, tests, build WASM
- [x] Prototipo "hello triangle" WebGPU + módulo WASM
- [x] ADRs iniciales (lenguaje, render, formato, 3D, assets)

## Fase 1 — Render y mapas (MVP técnico)
- [x] Renderer WebGPU de tilemaps (2D + 3D). Pendiente: capas múltiples y tiles animados
- [x] Sprites y atlas de texturas
- [x] Editor de mapas: pintar, rellenar, colisiones, varios mapas, NPC y saltos. Pendiente: capas
- [~] Formato de proyecto versionado con migraciones; guardado en localStorage (pendiente OPFS)

## Fase 2 — Jugabilidad base
- [x] Movimiento del jugador en grid, colisiones, warps
- [x] Diálogos y menús de combate
- [~] Eventos por NPC/salto (pendiente: VM de scripts)
- [x] Modo "Probar" dentro del editor

## Fase 3 — Datos Pokémon
- [~] Editor de especies, stats, movimientos, equipo (pendiente: evoluciones, learnsets por nivel, objetos)
- [~] Editor de movimientos (pendiente: objetos genéricos)
- [x] Editor de trainers y encuentros salvajes
- [~] Importar/exportar proyecto en JSON (pendiente CSV)

## Fase 4 — Combate
- [~] Combate determinista 1v1 jugable (pendiente: dobles)
- [ ] Habilidades y efectos de movimientos mediante datos + scripts
- [~] UI de combate (animaciones básicas)

## Fase 5 — Exportación y comunidad
- [~] Export: JSON del proyecto; pendiente paquete jugable/PWA
- [ ] Export de escritorio (Tauri/Electron) opcional
- [ ] Sistema de plugins/mods
- [ ] Compartir proyectos, plantillas y tilesets

## Fase 6 — Pulido
- [x] Modo 3D estilo DS (vista)
- [x] Audio sintetizado (SFX + música)
- [ ] Rendimiento, accesibilidad, i18n
- [ ] Documentación de usuario y tutoriales
