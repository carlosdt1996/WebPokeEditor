#!/usr/bin/env bash
# Compila el núcleo Rust a WASM y lo copia al editor.
set -euo pipefail
cd "$(dirname "$0")/.."
rustup target add wasm32-unknown-unknown >/dev/null 2>&1 || true
cargo build -p engine-core --release --target wasm32-unknown-unknown
mkdir -p packages/editor/public
cp target/wasm32-unknown-unknown/release/engine_core.wasm packages/editor/public/engine_core.wasm
ls -l packages/editor/public/engine_core.wasm
