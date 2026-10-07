# Entorno de desarrollo

## Requisitos
- Rust estable + target `wasm32-unknown-unknown`
- Sin `wasm-bindgen`: el núcleo exporta una API C mínima (`crates/engine-core/src/lib.rs`)
- Node.js 20+ (npm workspaces)
- Navegador con WebGPU (Chrome/Edge reciente)

## Primeros pasos
```bash
rustup target add wasm32-unknown-unknown
npm install
npm run dev       # compila WASM (scripts/build-wasm.sh) y arranca Vite
npm test          # cargo test + vitest
npm run build     # genera packages/editor/dist
```

## Notas
- El servidor de desarrollo debe enviar `Cross-Origin-Opener-Policy: same-origin` y `Cross-Origin-Embedder-Policy: require-corp`.
- WebGPU requiere contexto seguro (`https` o `localhost`).

## Despliegue
`.github/workflows/pages.yml` compila, prueba y publica `packages/editor/dist` en GitHub Pages en cada push a `main`. Si el workflow no puede activar Pages solo: *Settings → Pages → Source: GitHub Actions*.
