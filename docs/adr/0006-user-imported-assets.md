# ADR-0006: Gráficos oficiales solo por importación del usuario

- Estado: aceptado
- Fecha: 2026-10-07

## Contexto
Los creadores querrán sprites de Pokémon, pero son material con copyright y el proyecto es público.

## Decisión
El repo/web solo contienen arte original (procedural). Los sprites de especie y el atlas de tiles se **importan por el usuario**, se guardan como data URL en su proyecto y no se envían a ningún servidor.

## Consecuencias
+ Sin redistribución de material protegido; el usuario decide. − Hay que dimensionar localStorage (aviso si falla el guardado) y validar el tamaño del atlas.
