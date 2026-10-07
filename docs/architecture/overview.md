# Arquitectura general

## Principios
1. **Determinismo**: simulación reproducible (replays, tests, netcode futuro).
2. **Datos primero**: todo el contenido (especies, movimientos, mapas, scripts) es dato serializable; el motor es genérico.
3. **Mismo runtime en editor y player**: "Probar" ejecuta exactamente el motor que se exporta.
4. **Frontera WASM estrecha**: API pequeña, datos en bloque.

## Capas

```
┌────────────────────────── Editor UI (TS) ──────────────────────────┐
│  Paneles · Mapa · Datos · Scripts · Assets · Probar                │
├──────────────┬───────────────────────────┬─────────────────────────┤
│  Renderer    │   Engine Core (WASM)      │   Persistencia          │
│  WebGPU/WGSL │   ECS · Mapas · Battle ·  │   OPFS / IndexedDB      │
│              │   Script VM · Project IO  │   Import/Export         │
└──────────────┴───────────────────────────┴─────────────────────────┘
```

## Hilos
- **Main**: UI y presentación (canvas WebGPU).
- **Worker de motor**: ejecuta WASM (simulación); envía *render commands* por `SharedArrayBuffer`.
- **Workers auxiliares**: importación de assets, empaquetado, validación.

> `SharedArrayBuffer` requiere cross-origin isolation (`COOP`/`COEP`). Ver ADR-0003.

## Flujo de un frame
1. Input → motor (WASM) con tick fijo (60 Hz).
2. Motor actualiza estado y escribe un *frame buffer* de instancias (tiles/sprites).
3. Renderer sube buffers a GPU y dibuja.

## Módulos y responsabilidades
Ver documentos específicos: [engine-core](engine-core.md), [rendering](rendering.md), [editor-ui](editor-ui.md), [data-model](data-model.md), [scripting](scripting.md), [battle-system](battle-system.md), [export-pipeline](export-pipeline.md).

## Compatibilidad
- Objetivo: navegadores con WebGPU (Chrome/Edge, Safari reciente, Firefox según estado).
- Fallback: WebGL2 para el *player*; el editor puede exigir WebGPU.
