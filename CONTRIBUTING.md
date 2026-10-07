# Contribuir

## Flujo
1. Abre un issue describiendo el cambio (o comenta uno existente).
2. Crea una rama `feat/...`, `fix/...` o `docs/...`.
3. Commits en formato [Conventional Commits](https://www.conventionalcommits.org/).
4. Abre un PR; debe pasar CI (lint + tests + build).

## Estilo
- Rust: `cargo fmt`, `cargo clippy -D warnings`.
- TypeScript: ESLint + Prettier, `strict: true`.
- WGSL: shaders pequeños, comentados, en `packages/renderer/shaders/`.

## Decisiones de arquitectura
Cambios significativos requieren un ADR en `docs/adr/` (plantilla en `docs/adr/0000-template.md`).

## Assets
No subas assets con copyright de Nintendo/Game Freak. Ver [`docs/guides/legal-and-assets.md`](docs/guides/legal-and-assets.md).

## Código de conducta
Sé respetuoso. Críticas al código, no a las personas.
