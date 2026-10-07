# Guía para asistentes de IA

Proyecto: editor de fangames de Pokémon en el navegador (Rust→WASM + WebGPU + TypeScript).

## Antes de tocar código
- Lee `docs/architecture/overview.md` y el ADR relevante.
- El estado de juego debe ser **determinista** (misma semilla + inputs = mismo resultado); no uses aleatoriedad/tiempo del sistema dentro de `engine-core` ni `battle`.
- La frontera WASM↔JS es costosa: pasa datos en lotes (typed arrays), evita llamadas por-tile/por-sprite.

## Convenciones
- Rust en `crates/`, TypeScript en `packages/`.
- Los formatos de datos están versionados (`schemaVersion`); toda migración lleva test.
- No incluir assets protegidos por copyright.
- Documentación en español; identificadores de código en inglés.

## Comandos (ver `docs/guides/development-setup.md`)
- `cargo test --workspace`
- `npm run wasm` (compila el núcleo), `npm test`, `npm run build`
- `npm run e2e -w packages/editor` (tras `build`; Playwright + Chromium con WebGPU por software)

## No hacer
- No añadir dependencias sin justificarlas en el PR.
- No crear PRs sin que el usuario lo pida.
