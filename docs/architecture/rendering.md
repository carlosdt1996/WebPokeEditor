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

## Modo 3D (`packages/editor/src/renderer3d.ts`)
Ver [ADR-0005](../adr/0005-3d-mode.md). Un único pipeline (posición, uv, sombreado por cara) con depth buffer `depth24plus`, alpha-test y niebla lineal. Malla estática del mapa + buffer dinámico para billboards de personajes. Cámara: perspectiva 40°, pitch ≈ 0.95 rad, distancia 13 en juego.

### Capas, animación y alturas
- **Objetos**: capa transparente sobre el suelo (ids ≥ 12 → celdas 32–37 del atlas); en 2D se ordenan por Y con los personajes; en 3D son quads cruzados. La colisión de los objetos vive en el núcleo (`objects` en `engine-core`).
- **Animación**: los tiles de suelo con alternativa (`TILE_ANIM`: agua y hierba alta) cambian de fotograma cada 450 ms. En 3D el vértice lleva un desplazamiento de UV (`duv`) y el shader lo multiplica por el fotograma (uniforme).
- **Alturas**: `heights` suma a la altura base del tile; la malla genera caras laterales en los desniveles y los personajes interpolan la altura del suelo al caminar.
