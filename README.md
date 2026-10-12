# BN Map Explorer

Overmap viewer for **Cataclysm: Bright Nights** save files, in the spirit of
bn.cddaexplorer.cc. It runs entirely in your browser — your save never leaves
your computer.

*[Versión en castellano más abajo.](#castellano)*

## Usage

1. Open `index.html` in Chrome/Edge (or run `abrir.bat`, which serves it at
   `http://127.0.0.1:8777`).
2. Click **Choose folder** and pick `save/<YourWorld>` (or the whole `save/`
   folder to choose between worlds). Drag and drop works too.

An internet connection is needed the first time to load `sql.js` (SQLite
reader) from cdnjs.

### Features

- Full overmap of every generated overmap, per Z level (-10…+10).
- Fog based on what your character has seen: dim unseen / seen only / everything.
- Character (@), NPCs (followers in green), mission targets (★), map notes,
  city names, radios and hordes.
- Tabs: Missions, Cities (by distance), Places (buildings and specials grouped,
  with a search that highlights matches on the map), NPCs and Notes.
- **UndeadPeople** graphics (BN's default tileset) or classic ASCII. Zoomed out
  you get a map in the tileset's colours; zoomed in, the sprites as the game draws
  them (variants, rotations, connected roads and seasonal sprites).
  - Deliberate differences from the game: terrains without their own sprite use
    the sprite of another terrain with the same name (e.g. bungalows use the house
    sprite), and the "open air" of upper floors is semi-transparent so you can see
    what is below.
- Interface in **English** or **Castellano** (terrain and mission names too).

Controls: wheel = zoom, drag = pan, PgUp/PgDn = Z level, C = center,
F = fit all, click = pin tile info.

## Terrain data (`terrain_db.js`)

Saves only store terrain ids (`house_01_north`…). Names, symbols and colours
come from the game's JSON. If you update the game or use new mods, regenerate it:

```
python build_terrain.py "C:/path/to/cbn-windows-tiles-x64-msvc-v0.13.0"
```

It includes `data/json`, `data/mods/*` and `mods/*`, plus the Spanish names from
`lang/mo/es_ES`. Terrains from mods that are not installed show as `?` with their id.

## Tileset (`tilesets/udp.js` + `tilesets/udp.png`)

Only the overmap sprites (~700) are extracted from the game's tileset. To
regenerate it, or add another tileset:

```
python build_tileset.py "C:/path/to/cbn-…/gfx/MSX++UnDeadPeopleEdition" --name udp
```

With a different `--name`, add its `<script src="tilesets/<name>.js">` to
`index.html` and it will show up in the Graphics selector. Requires Pillow
(`pip install pillow`) and `terrain_db.js` generated first.

## Save format (BN 0.13)

| File | Contents |
|---|---|
| `map.sqlite3` → `o.X.Y` | Overmap 180×180 OMT × 21 levels, RLE, zlib |
| `#<base64>.sav` | Character: `player.abs_pos` (tiles, /24 = OMT), missions |
| `#<base64>.sqlite3` → `.seen.X.Y` | Seen/explored, notes, extras |
| `master.gsav` | World missions (`target` in absolute OMT), factions |

Older saves store these same files loose in the folder; they are read too.

## Credits

- `terrain_db.js` is generated from the data of
  [Cataclysm: Bright Nights](https://github.com/cataclysmbnteam/Cataclysm-BN),
  licensed under [CC BY-SA 3.0](https://creativecommons.org/licenses/by-sa/3.0/).
- `tilesets/udp.png` contains sprites from the **UndeadPeople** tileset
  (MSX++ UnDeadPeople Edition) as shipped with Cataclysm: Bright Nights, by its
  authors and contributors, under the same CC BY-SA 3.0 terms. Only the overmap
  sprites were extracted and repacked.
- [sql.js](https://github.com/sql-js/sql.js) (MIT), loaded from cdnjs.

---

## Castellano

Visor del overmap de un mundo de **Cataclysm: Bright Nights**. Todo corre en el
navegador; el save no sale de tu equipo.

1. Abre `index.html` (o ejecuta `abrir.bat`).
2. Pulsa **Elegir carpeta** y selecciona `save/<TuMundo>` (o la carpeta `save/`).

El idioma se cambia con el selector de la esquina (inglés por defecto) y se
recuerda. Muestra el mapa por niveles Z con gráficos UndeadPeople o ASCII, la
niebla según lo que ha visto tu personaje, misiones, ciudades, lugares, NPCs y
notas. Para regenerar los datos tras actualizar el juego, usa los mismos
comandos `build_terrain.py` y `build_tileset.py` de arriba.
