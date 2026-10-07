# ADR-0007: VM de scripts en Rust con efectos cedidos al host

- Estado: aceptado
- Fecha: 2026-10-07

## Contexto
Los scripts de eventos deben ser deterministas, serializables y no depender del navegador, pero necesitan efectos asíncronos (diálogos, combates, cambios de mapa).

## Decisión
Compilador en TS (necesita tablas de cadenas y los ids de marca) → bytecode numérico → VM en Rust que ejecuta el control de flujo y guarda las marcas; cada efecto se *cede* al host con `vm_run()` devolviendo un código y argumentos (`vm_arg`). El host resuelve la operación y reanuda.

## Alternativas
Intérprete TS con callbacks (la versión anterior); VM con async en el lado Rust (no encaja con wasm32 sin runtime).

## Consecuencias
+ Las marcas viven en el estado del motor y las reglas de ejecución son las mismas en cualquier host; + testeable en Rust y TS. − Límite de 1024 instrucciones y 256 marcas por ahora.
