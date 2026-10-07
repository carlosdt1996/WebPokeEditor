# ADR-0003: Worker de motor y SharedArrayBuffer

- Estado: propuesto
- Fecha: 2026-10-07

## Decisión
Motor en Web Worker; comunicación con render vía `SharedArrayBuffer` (requiere COOP/COEP). Alternativa degradada con `postMessage` y transferibles.

## Consecuencias
Hosting del export debe poder enviar cabeceras de aislamiento, o usar el modo degradado.
