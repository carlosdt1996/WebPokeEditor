# Entorno de desarrollo

## Requisitos
- Rust estable + target `wasm32-unknown-unknown`
- `wasm-pack` o `wasm-bindgen-cli`
- Node.js LTS + pnpm
- Navegador con WebGPU (Chrome/Edge reciente)

## Primeros pasos (previsto)
```bash
rustup target add wasm32-unknown-unknown
pnpm install
pnpm dev          # servidor con COOP/COEP para SharedArrayBuffer
```

## Notas
- El servidor de desarrollo debe enviar `Cross-Origin-Opener-Policy: same-origin` y `Cross-Origin-Embedder-Policy: require-corp`.
- WebGPU requiere contexto seguro (`https` o `localhost`).
