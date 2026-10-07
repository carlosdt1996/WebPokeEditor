# Renderizado WebGPU

## Objetivos
- Mapas grandes a 60 FPS con miles de tiles animados.
- Estilo pixel-art: muestreo `nearest`, escala entera, sin sangrado entre tiles.

## Pipelines
| Pipeline | Descripción |
|---|---|
| `tilemap` | Quad instanciado por tile; índices en storage buffer; atlas de tileset |
| `sprites` | Instancias con UV, tinte, z-order; batching por atlas |
| `ui` | Texto bitmap y cajas de diálogo |
| `post` | Transiciones (fundidos, batalla), paletas/tonos día-noche |
| `editor-overlay` | Rejilla, selección, colisiones, gizmos |

## Recursos
- **Atlas** de texturas (`texture_2d_array` para tilesets).
- **Storage buffers** para datos de tiles; **uniform buffer** para cámara.
- Paletas indexadas opcionales (look GBA/DS): textura de índices + LUT de paleta.

## Resolución
Render a resolución lógica (p. ej. 240×160) a textura offscreen y escalado entero al canvas.

## Fallback
Capa de abstracción `Renderer` con implementación WebGPU y WebGL2.

## Depuración
Capturas de frames de referencia para tests visuales (ver [testing](../guides/testing.md)).
