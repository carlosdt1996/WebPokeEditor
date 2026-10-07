# Roadmap

## Fase 0 — Fundamentos
- [ ] Monorepo (Cargo workspace + pnpm workspace)
- [ ] CI: lint, tests, build WASM
- [ ] Prototipo "hello triangle" WebGPU + módulo WASM
- [ ] ADRs iniciales (lenguaje, render, formato de proyecto)

## Fase 1 — Render y mapas (MVP técnico)
- [ ] Renderer WebGPU de tilemaps (capas, animación de tiles)
- [ ] Sprites y atlas de texturas
- [ ] Editor de mapas: pintar, rellenar, capas, colisiones
- [ ] Formato de proyecto v0 y guardado en OPFS

## Fase 2 — Jugabilidad base
- [ ] Movimiento del jugador en grid, colisiones, warps
- [ ] Diálogos y menús
- [ ] Máquina de eventos/scripts v0
- [ ] Modo "Probar" dentro del editor

## Fase 3 — Datos Pokémon
- [ ] Editor de especies, tipos, stats, evoluciones, learnsets
- [ ] Editor de movimientos y objetos
- [ ] Editor de trainers y encuentros salvajes
- [ ] Importar/exportar datos (JSON/CSV)

## Fase 4 — Combate
- [ ] Simulador determinista de combate (1v1, luego dobles)
- [ ] Habilidades y efectos de movimientos mediante datos + scripts
- [ ] UI y animaciones de combate

## Fase 5 — Exportación y comunidad
- [ ] Export web (paquete estático) y PWA
- [ ] Export de escritorio (Tauri/Electron) opcional
- [ ] Sistema de plugins/mods
- [ ] Compartir proyectos, plantillas y tilesets

## Fase 6 — Pulido
- [ ] Rendimiento, accesibilidad, i18n
- [ ] Documentación de usuario y tutoriales
