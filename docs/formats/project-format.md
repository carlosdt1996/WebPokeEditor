# Formato de proyecto

Carpeta (o `.wpe` = zip) con estructura:

```
mi-juego/
├── project.json          # metadatos, schemaVersion, GameConfig
├── data/
│   ├── species/*.json
│   ├── moves/*.json
│   ├── abilities/*.json
│   ├── items/*.json
│   ├── trainers/*.json
│   └── types.json
├── maps/*.map.json       # ver map-format.md
├── tilesets/             # PNG + *.tileset.json
├── sprites/
├── audio/
└── scripts/*.wpscript
```

## `project.json` (ejemplo)
```json
{
  "schemaVersion": 2,
  "name": "Mi Fangame",
  "author": "",
  "startMap": "pueblo-inicial",
  "logicalResolution": [240, 160],
  "rules": { "generation": 3 }
}
```

## Almacenamiento
Editor: OPFS (carpeta virtual). Import/export como `.wpe`.

> **v2**: los mapas pasan a `maps[]` con NPCs y saltos (ver [data-model](../architecture/data-model.md)); `startMap` se sustituye por `start: { map, x, y }`.
