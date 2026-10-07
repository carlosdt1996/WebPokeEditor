# Tutorial: scripts de eventos

Un script es una lista de órdenes, una por línea, que se ejecuta en una máquina virtual escrita en Rust. Puedes usarlos en NPC de tipo *Script*, en *scripts al ganar* de los entrenadores, en **disparadores por casilla** y en **al entrar / al salir del mapa**. La referencia completa está en [scripting.md](../architecture/scripting.md) y en el botón de ayuda del editor.

## Lo básico
```
say ¡Hola! Tienes {money} monedas.
give potion 2
heal
flag visitado
```
- `say` muestra texto; `{nombre}` se sustituye por el valor de una variable.
- `flag` / `unflag` activan o quitan marcas (se consultan con `if marca` / `ifnot marca`).
- `set` y `add` trabajan con variables numéricas (`add money -50` cobra).

## Condiciones y bucles
```
if visitado
  say Ya habías estado aquí.
else
  say ¡Primera vez!
  flag visitado
end
repeat 3
  say ¡Hurra!
end
```
Comparaciones: `if level >= 10`. Bucles: `while`, `repeat`, `break`. Funciones: `def saludo ... end` y `call saludo`.

## Menús y textos
```
say ¿Qué quieres?
choice Pescar | Descansar | Salir
if choice == 0
  say ¡A pescar!
end
```
`list`, `pick` (azar reproducible), `nlist` (números), `dict` (diccionarios), `substr`, `replace`, `upper`, `lower`… permiten montar minijuegos: la pesca de Puerto Faro en el Archipiélago es un buen ejemplo.

## Dinero, objetos y objetos clave
Las variables `money` y `item_<id>` están siempre al día: `if item_llave-forja < 1` impide el paso a quien no tiene la llave. `give llave-forja 1` entrega un objeto clave.

## Combates y mapas
`battle <especie> <nivel>` combate contra una criatura salvaje; `givemon <especie> <nivel>` añade una criatura al equipo; `warp <mapa> <x> <y>` teletransporta al jugador (el script termina).

## Depuración
Si un script tiene errores, el editor los lista bajo la caja de texto con el número de línea; en el modo Probar el aviso aparece en los mensajes. Las plantillas están cubiertas por tests que ejecutan sus scripts clave en la VM real.
