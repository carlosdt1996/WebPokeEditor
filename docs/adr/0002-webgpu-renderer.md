# ADR-0002: Renderer WebGPU con fallback WebGL2

- Estado: propuesto
- Fecha: 2026-10-07

## Decisión
Renderer 2D instanciado en WebGPU (WGSL) tras una interfaz `Renderer`; fallback WebGL2 para el player.

## Consecuencias
+ Compute shaders futuros, menos overhead de draw calls. − Disponibilidad variable de WebGPU; doble mantenimiento.
