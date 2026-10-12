"""Genera terrain_db.js a partir de los datos de Cataclysm: Bright Nights.

Uso:
    python build_terrain.py "C:/ruta/al/juego" [--lang es_ES]

Lee data/json (core), data/mods/* y mods/* (mods de terceros), resuelve
copy-from/abstract de cada overmap_terrain y guarda nombre, simbolo, color y
flags. Si existe lang/mo/<lang>/LC_MESSAGES/cataclysm-bn.mo, agrega el nombre
traducido.
"""
import argparse
import gettext
import glob
import json
import os
import sys

LINEAR = 1
NO_ROTATE = 2


def load_json_files(root, kind="overmap_terrain"):
    out = []
    for f in sorted(glob.glob(os.path.join(root, "**", "*.json"), recursive=True)):
        try:
            with open(f, encoding="utf-8") as fh:
                d = json.load(fh)
        except Exception:
            continue
        if isinstance(d, dict):
            d = [d]
        if not isinstance(d, list):
            continue
        out.extend(o for o in d if isinstance(o, dict) and o.get("type") == kind)
    return out


def name_of(v):
    if isinstance(v, dict):
        return v.get("str") or v.get("str_sp") or ""
    return v or ""


def flag_list(o):
    flags = set(o.get("flags", []))
    flags |= set(o.get("extend", {}).get("flags", []))
    flags -= set(o.get("delete", {}).get("flags", []))
    return flags


class Resolver:
    """Resuelve herencia copy-from. `defs` es la pila de definiciones por id
    (la ultima gana); copy-from a uno mismo usa la definicion anterior."""

    def __init__(self):
        self.defs = {}  # id -> [raw, raw, ...]

    def add(self, objs):
        for o in objs:
            ids = o.get("abstract") or o.get("id")
            if ids is None:
                continue
            for i in ids if isinstance(ids, list) else [ids]:
                self.defs.setdefault(i, []).append(o)

    def resolve(self, i, depth=None, guard=0):
        stack = self.defs.get(i)
        if not stack or guard > 40:
            return None
        if depth is None:
            depth = len(stack) - 1
        if depth < 0:
            return None
        o = stack[depth]
        parent = None
        cf = o.get("copy-from")
        if cf:
            parent = self.resolve(cf, depth - 1 if cf == i else None, guard + 1)
        r = dict(parent) if parent else {"name": "", "sym": None, "color": None, "flags": set(), "looks_like": []}
        r["flags"] = set(r["flags"])
        if "name" in o:
            r["name"] = name_of(o["name"])
        if "sym" in o:
            s = o["sym"]
            r["sym"] = chr(s) if isinstance(s, int) else s
        if "color" in o:
            r["color"] = o["color"]
        if "looks_like" in o:
            ll = o["looks_like"]
            r["looks_like"] = ll if isinstance(ll, list) else [ll]
        if "flags" in o:
            r["flags"] = set(o["flags"])
        r["flags"] |= set(o.get("extend", {}).get("flags", []))
        r["flags"] -= set(o.get("delete", {}).get("flags", []))
        r["abstract"] = "abstract" in o
        return r


def mod_dirs(game):
    found = {}
    for f in glob.glob(os.path.join(game, "data", "mods", "*", "modinfo.json")) + \
             glob.glob(os.path.join(game, "mods", "*", "modinfo.json")):
        try:
            d = json.load(open(f, encoding="utf-8"))
        except Exception:
            continue
        for o in d if isinstance(d, list) else [d]:
            if isinstance(o, dict) and o.get("type") == "MOD_INFO" and o.get("id"):
                base = os.path.dirname(f)
                found[o["id"]] = os.path.join(base, o.get("path", "")) if o.get("path") else base
    return found


def pack(r, tr):
    flags = 0
    if "LINEAR" in r["flags"]:
        flags |= LINEAR
    if "NO_ROTATE" in r["flags"]:
        flags |= NO_ROTATE
    sym = r["sym"]
    if sym is None and flags & LINEAR:
        sym = "\u2502"
    name = r["name"]
    es = tr(name) if (tr and name) else ""
    return [name, es if es != name else "", sym or "?", r["color"] or "light_gray", flags, r.get("looks_like") or []]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("game", help="carpeta del juego (la que contiene data/)")
    ap.add_argument("--lang", default="es_ES")
    ap.add_argument("--out", default=os.path.join(os.path.dirname(os.path.abspath(__file__)), "terrain_db.js"))
    a = ap.parse_args()

    core = os.path.join(a.game, "data", "json")
    if not os.path.isdir(core):
        sys.exit(f"No encuentro {core}")

    tr = None
    mo = os.path.join(a.game, "lang", "mo", a.lang, "LC_MESSAGES", "cataclysm-bn.mo")
    if os.path.exists(mo):
        with open(mo, "rb") as fh:
            tr = gettext.GNUTranslations(fh).gettext

    base = Resolver()
    base.add(load_json_files(core))
    db = {"base": {}, "mods": {}}
    for i in base.defs:
        r = base.resolve(i)
        if r and not r["abstract"]:
            db["base"][i] = pack(r, tr)

    for mid, path in sorted(mod_dirs(a.game).items()):
        if os.path.normcase(os.path.realpath(path)) == os.path.normcase(os.path.realpath(core)):
            continue  # el mod "bn" es el propio data/json
        objs = load_json_files(path)
        if not objs:
            continue
        res = Resolver()
        res.defs = {k: list(v) for k, v in base.defs.items()}
        res.add(objs)
        own = set()
        for o in objs:
            ids = o.get("id")
            if ids and "abstract" not in o:
                own.update(ids if isinstance(ids, list) else [ids])
        entries = {}
        for i in own:
            r = res.resolve(i)
            if r:
                entries[i] = pack(r, tr)
        db["mods"][mid] = entries

    db["missions"] = {}
    roots = [core] + [p for p in mod_dirs(a.game).values()
                      if os.path.normcase(os.path.realpath(p)) != os.path.normcase(os.path.realpath(core))]
    for root in roots:
        for o in load_json_files(root, "mission_definition"):
            n = name_of(o.get("name"))
            if o.get("id") and n:
                es = tr(n) if tr else ""
                db["missions"][o["id"]] = [n, es if es != n else ""]

    with open(a.out, "w", encoding="utf-8") as fh:
        fh.write("// Generado por build_terrain.py - no editar a mano\n")
        fh.write("window.BN_TERRAIN = ")
        json.dump(db, fh, ensure_ascii=False, separators=(",", ":"))
        fh.write(";\n")
    print(f"{len(db['base'])} terrenos base, {len(db['mods'])} mods, {len(db['missions'])} misiones -> {a.out}")


if __name__ == "__main__":
    main()
