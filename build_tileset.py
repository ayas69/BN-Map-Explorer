"""Extrae del tileset del juego los sprites que usa el overmap.

Uso:
    python build_tileset.py "C:/ruta/juego/gfx/MSX++UnDeadPeopleEdition" [--name udp]

Genera tilesets/<name>.png (atlas) y tilesets/<name>.js con:
  sprites: [[x, y, w, h, offx, offy], ...]  posiciones en el atlas
  tiles:   {tile_id: {fg, bg, rot, tr, sub:{center:{...}, ...}}}
  omap:    {terreno_base: tile_id}  (ya resuelto con looks_like, como el juego)
  avg:     {tile_id: [r, g, b]}     color medio para el zoom lejano
Necesita terrain_db.js (build_terrain.py) para saber qué terrenos existen.
"""
import argparse
import json
import os
import sys

from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
SEASONS = ["spring", "summer", "autumn", "winter"]
MULTI_KEYS = ["center", "corner", "edge", "t_connection", "end_piece", "unconnected", "open", "broken"]


def load_terrain_db():
    with open(os.path.join(HERE, "terrain_db.js"), encoding="utf-8") as fh:
        txt = fh.read()
    return json.loads(txt.split("=", 1)[1].strip().rstrip(";"))


def norm_sprites(v):
    """fg/bg -> lista de variantes [[peso, [sprite, ...]], ...]."""
    if v is None or v == []:
        return []
    if isinstance(v, int):
        return [[1, [v]]]
    if isinstance(v, list):
        if all(isinstance(x, int) for x in v):
            return [[1, v]]
        out = []
        for x in v:
            if isinstance(x, dict):
                s = x.get("sprite")
                out.append([x.get("weight", 1), s if isinstance(s, list) else [s]])
            elif isinstance(x, int):
                out.append([1, [x]])
        return out
    return []


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("tileset", help="carpeta del tileset (con tile_config.json)")
    ap.add_argument("--name", default="udp")
    a = ap.parse_args()

    cfg = json.load(open(os.path.join(a.tileset, "tile_config.json"), encoding="utf-8"))
    info = cfg.get("tile_info", [{}])[0]
    TW, TH = info.get("width", 32), info.get("height", 32)

    # Índice global de sprites -> (imagen, rect, offset)
    sheets, start = [], 0
    tiles = {}
    for f in cfg["tiles-new"]:
        path = os.path.join(a.tileset, f["file"])
        sw, sh = f.get("sprite_width", TW), f.get("sprite_height", TH)
        ox, oy = f.get("sprite_offset_x", 0), f.get("sprite_offset_y", 0)
        img = Image.open(path).convert("RGBA") if os.path.exists(path) else None
        cols = img.width // sw if img else 0
        count = cols * (img.height // sh) if img else 0
        sheets.append((start, count, img, sw, sh, ox, oy, cols))
        for e in f.get("tiles", []):
            ids = e["id"] if isinstance(e["id"], list) else [e["id"]]
            multi = e.get("multitile", False)
            t = {
                "fg": norm_sprites(e.get("fg")), "bg": norm_sprites(e.get("bg")),
                "rot": bool(e.get("rotates", multi)), "tr": bool(e.get("has_om_transparency", False)),
            }
            if multi:
                t["sub"] = {s["id"]: {"fg": norm_sprites(s.get("fg")), "bg": norm_sprites(s.get("bg")), "rot": True,
                                      "ms": s["id"] in MULTI_KEYS}
                            for s in e.get("additional_tiles", [])}
            for i in ids:
                tiles[i] = t
        start += count

    def sprite_src(idx):
        for st, cnt, img, sw, sh, ox, oy, cols in sheets:
            if st <= idx < st + cnt:
                k = idx - st
                return img, ((k % cols) * sw, (k // cols) * sh, sw, sh), ox, oy
        return None

    # Resolver terreno -> tile como cata_tiles::find_tile_looks_like
    db = load_terrain_db()
    terr = dict(db["base"])
    for m in db["mods"].values():
        for k, v in m.items():
            terr.setdefault(k, v)

    def find(i, jumps=10):
        if not i or jumps <= 0:
            return None
        if i in tiles or any(f"{i}_season_{s}" in tiles for s in SEASONS):
            return i
        for ll in (terr.get(i) or [None] * 6)[5] if i in terr else []:
            r = find(ll, jumps - 1)
            if r:
                return r
            jumps -= 1
        return None

    omap = {}
    for i in terr:
        r = find(i)
        if r:
            omap[i] = r
    # Relleno: terrenos sin sprite usan el tile más común entre los terrenos
    # con el mismo nombre ("house" de un bungalow -> sprite de house_01).
    by_name = {}
    for i, t in omap.items():
        by_name.setdefault(terr[i][0], {}).setdefault(t, 0)
        by_name[terr[i][0]][t] += 1
    guess = {}
    for i, e in terr.items():
        if i not in omap and e[0] in by_name:
            guess[i] = max(by_name[e[0]].items(), key=lambda kv: kv[1])[0]
    used = set(omap.values()) | set(guess.values())
    used |= {f"{u}_season_{s}" for u in used for s in SEASONS if f"{u}_season_{s}" in tiles}

    # Sprites necesarios
    need = []
    def collect(t):
        for k in ("fg", "bg"):
            for _, lst in t.get(k, []):
                need.extend(x for x in lst if isinstance(x, int))
        for st in t.get("sub", {}).values():
            collect(st)
    for u in used:
        collect(tiles[u])
    need = sorted(set(need))

    # Empaquetar en atlas por estantes
    rects = {}
    srcs = {i: sprite_src(i) for i in need}
    order = sorted((i for i in need if srcs[i]), key=lambda i: (-srcs[i][1][3], i))
    W, x, y, row_h = 2048, 0, 0, 0
    for i in order:
        _, (sx, sy, sw, sh), ox, oy = srcs[i]
        if x + sw > W:
            x, y, row_h = 0, y + row_h, 0
        rects[i] = (x, y, sw, sh, ox, oy)
        x += sw
        row_h = max(row_h, sh)
    H = y + row_h
    atlas = Image.new("RGBA", (W, max(H, 1)), (0, 0, 0, 0))
    for i, (x, y, sw, sh, ox, oy) in rects.items():
        img, (sx, sy, _, _), _, _ = srcs[i]
        atlas.paste(img.crop((sx, sy, sx + sw, sy + sh)), (x, y))

    # Renumerar sprites al índice del atlas
    remap = {old: n for n, old in enumerate(rects)}
    sprites = [list(rects[old]) for old in rects]

    def remap_t(t):
        out = {}
        for k in ("fg", "bg"):
            out[k] = [[w, [remap.get(s, -1) for s in lst if isinstance(s, int)]] for w, lst in t.get(k, [])]
        out["rot"] = t.get("rot", False)
        if t.get("tr"):
            out["tr"] = True
        if t.get("ms"):
            out["ms"] = True
        if "sub" in t:
            out["sub"] = {k: remap_t(v) for k, v in t["sub"].items()}
        return out
    out_tiles = {u: remap_t(tiles[u]) for u in sorted(used)}

    # Color medio (bg debajo de fg) del primer sprite de cada tile, recortado a la celda
    def avg_color(t):
        cell = Image.new("RGBA", (TW, TH), (0, 0, 0, 255))
        for k in ("bg", "fg"):
            if t.get(k) and t[k][0][1]:
                img, (sx, sy, sw, sh), ox, oy = srcs.get(t[k][0][1][0]) or (None, (0, 0, 0, 0), 0, 0)
                if img:
                    spr = img.crop((sx, sy, sx + sw, sy + sh))
                    cell.alpha_composite(spr, (max(0, ox), max(0, oy)), (max(0, -ox), max(0, -oy)))
        px = cell.convert("RGB").resize((1, 1), Image.BOX).getpixel((0, 0))
        return list(px)
    avg = {}
    for u in used:
        t = tiles[u]
        avg[u] = avg_color(t if (t.get("fg") or t.get("bg")) else (t.get("sub", {}).get("center") or t.get("sub", {}).get("edge") or t))

    os.makedirs(os.path.join(HERE, "tilesets"), exist_ok=True)
    png = os.path.join(HERE, "tilesets", a.name + ".png")
    atlas.save(png, optimize=True)
    name = next((l.split(":", 1)[1].strip() for l in open(os.path.join(a.tileset, "tileset.txt"), encoding="utf-8", errors="ignore")
                 if l.startswith("NAME:")), a.name) if os.path.exists(os.path.join(a.tileset, "tileset.txt")) else a.name
    data = {"name": name, "w": TW, "h": TH, "image": f"tilesets/{a.name}.png",
            "sprites": sprites, "tiles": out_tiles, "omap": omap, "guess": guess, "avg": avg}
    with open(os.path.join(HERE, "tilesets", a.name + ".js"), "w", encoding="utf-8") as fh:
        fh.write("// Generado por build_tileset.py\n")
        fh.write(f"(window.BN_TILESETS = window.BN_TILESETS || {{}})[{json.dumps(a.name)}] = ")
        json.dump(data, fh, separators=(",", ":"))
        fh.write(";\n")
    print(f"{name}: {len(omap)}/{len(terr)} terrenos con sprite (+{len(guess)} por nombre), {len(used)} tiles, {len(sprites)} sprites, atlas {W}x{H}")


if __name__ == "__main__":
    main()
