# Formato de mapas y tilesets

## Mapa (`*.map.json`)
```json
{
  "id": "pueblo-inicial",
  "size": [32, 32],
  "tileset": "overworld-1",
  "layers": [
    { "name": "ground",  "data": "<RLE+base64 u16[]>" },
    { "name": "objects", "data": "..." },
    { "name": "above",   "data": "..." }
  ],
  "collision": "<u8[] RLE>",
  "events": [
    { "id": "npc-1", "pos": [5, 7], "sprite": "npc-vieja", "script": "pueblo/vieja" }
  ],
  "connections": [{ "dir": "north", "map": "ruta-1", "offset": 0 }],
  "music": "bgm-pueblo",
  "encounters": "ruta-1-hierba"
}
```

## Tileset
- PNG atlas con tiles de 16×16 (configurable).
- `*.tileset.json`: atributos por tile (colisión, hierba, agua, salto), animaciones (frames, duración), capa de render (debajo/encima del jugador).
