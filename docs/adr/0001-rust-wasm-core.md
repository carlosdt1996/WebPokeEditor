# ADR-0001: Núcleo del motor en Rust compilado a WASM

- Estado: propuesto
- Fecha: 2026-10-07

## Contexto
Se necesita rendimiento predecible, determinismo y código compartido entre editor y player.

## Decisión
Motor, combate y VM en Rust → `wasm32-unknown-unknown` con `wasm-bindgen`.

## Alternativas
C++/Emscripten; AssemblyScript; todo en TypeScript.

## Consecuencias
+ Seguridad de memoria, buen tooling, determinismo. − Curva de aprendizaje, tamaño del binario (mitigar con `wasm-opt`, `lto`).
