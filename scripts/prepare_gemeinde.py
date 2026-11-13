"""Bereitet die Rohdaten der Gemeinde fuer die Seite auf (nur Standardbibliothek).

Eingabe : data/raw/gemeinde/{cells,boundary,ortsteile_geom,street_names}.json, lod2/, addr/, osm/
Ausgabe : site/data/meta.js   Grenze, Ortsteile, Orte, Haltestellen, Kachelliste
          site/data/addr.js   Adressindex fuer die Suche
          site/data/areas.js  Flaechen fuer die Kartenansicht ohne Luftbild
          site/data/t_<i>_<j>.js  je Kachel: Gebaeude (3D), Baeume, Strassen

Lokales Koordinatensystem siehe geo.py. Quellen und Lizenzen: README.md
"""
import json, math, os, random, re, sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from geo import CELL, GEMEINDE_SCHLUESSEL, LAND, LAT0, LON0, NB_BBOX, NB_CENTER, NB_NAME, ORT, in_nb, pip, simplify, stitch, utm33_to_latlon, utm_to_latlon, xz  # noqa: E402
from geom3d import triangulate  # noqa: E402  (Ear-Clipping fuer 3D-Polygone)

ROOT = os.path.dirname(HERE)
RAW = os.path.join(ROOT, "data", "raw", "gemeinde")
OUT = os.path.join(ROOT, "site", "data")
STAND = "2026-10-31"
sys.stdout.reconfigure(encoding="utf-8")
random.seed(20261031)


def jload(p):
    with open(p, encoding="utf-8") as f:
        return json.load(f)


def dump(obj):
    return json.dumps(obj, ensure_ascii=False, separators=(",", ":"))


def flat(pts, nd=1):
    out = []
    for x, z in pts:
        out += [round(x, nd), round(z, nd)]
    return out


def area_of(ring):
    return abs(sum(ring[i][0] * ring[(i + 1) % len(ring)][1] - ring[(i + 1) % len(ring)][0] * ring[i][1] for i in range(len(ring)))) / 2


def centroid(ring):
    a = cx = cz = 0.0
    for i in range(len(ring)):
        x0, z0 = ring[i]
        x1, z1 = ring[(i + 1) % len(ring)]
        f = x0 * z1 - x1 * z0
        a += f; cx += (x0 + x1) * f; cz += (z0 + z1) * f
    if abs(a) < 1e-6:
        return ring[0]
    return cx / (3 * a), cz / (3 * a)


def rings_of(rel, role):
    parts = [[(g["lat"], g["lon"]) for g in m["geometry"]] for m in rel.get("members", [])
             if m.get("type") == "way" and (m.get("role") or "outer") == role and m.get("geometry")]
    return [[xz(a, b) for a, b in r] for r in stitch(parts)]


# ------------------------------------------------------------------ Grenze, Ortsteile, Kacheln
CELLS = jload(os.path.join(RAW, "cells.json"))
X0, Z0, NX, NZ = CELLS["x0"], CELLS["z0"], CELLS["nx"], CELLS["nz"]
KEPT = {tuple(c) for c in CELLS["cells"]}
BOUND = rings_of(jload(os.path.join(RAW, "boundary.json"))["elements"][0], "outer")


def in_gemeinde(x, z):
    return any(pip(x, z, r) for r in BOUND)


OT = []
for rel in jload(os.path.join(RAW, "ortsteile_geom.json"))["elements"]:
    rs = sorted(rings_of(rel, "outer"), key=area_of, reverse=True)
    if not rs:
        continue
    cxz = centroid(rs[0])
    xs = [p[0] for p in rs[0]]; zs = [p[1] for p in rs[0]]
    OT.append({"n": rel["tags"]["name"], "rings": rs, "c": cxz, "bb": (min(xs), min(zs), max(xs), max(zs))})
OT.sort(key=lambda o: o["n"])

# Ohne Ortsteil-Grenzen in OSM (z. B. Cham): Gemeindeteile ueber die Ortsmarken (place=town/suburb/village/hamlet/isolated_dwelling).
# Jedes Gebaeude und jede Adresse gehoert zur naechsten Ortsmarke. Die Flaeche ist die Huelle der Gebaeude (hull_rings).
OT_PUNKTE = False
_orte_p = os.path.join(RAW, "ortsteile_orte.json")
if not OT and os.path.exists(_orte_p):
    for e in jload(_orte_p)["elements"]:
        x, z = xz(e["lat"], e["lon"])
        if any(pip(x, z, r) for r in BOUND):
            alt = next((o for o in OT if o["n"] == e["tags"]["name"]), None)
            if alt:  # gleicher Name an mehreren Stellen (z. B. zwei Marken "Hanzing"): ein Gemeindeteil mit mehreren Punkten
                alt["pts"].append((x, z))
                continue
            OT.append({"n": e["tags"]["name"], "rings": [], "c": (x, z), "pts": [(x, z)], "bb": (x, z, x, z), "dorf": e["tags"].get("place") in ("village", "hamlet", "isolated_dwelling")})
    OT.sort(key=lambda o: o["n"])
    OT_PUNKTE = bool(OT)


def ot_of(x, z):
    if OT_PUNKTE:
        return min(range(len(OT)), key=lambda i: min((px - x) ** 2 + (pz - z) ** 2 for px, pz in OT[i]["pts"]))
    for i, o in enumerate(OT):
        b = o["bb"]
        if b[0] <= x <= b[2] and b[1] <= z <= b[3] and any(pip(x, z, r) for r in o["rings"]):
            return i
    return -1


def cell_of(x, z):
    return int(math.floor((x - X0) / CELL)), int(math.floor((z - Z0) / CELL))


# ------------------------------------------------------------------ Gebaeude (LoD2)
USE_MAP = {"residential": "wohnen", "industrial": "industrie", "commerceAndServices": "gewerbe", "commerce": "gewerbe",
           "publicServices": "oeffentlich", "agriculture": "landwirtschaft", "ancillary": "neben", "office": "gewerbe",
           "trade": "gewerbe", "transport": "verkehr", "utilitiesAndEnergy": "versorgung"}


# Bayern: Gebaeudefunktion nach ALKIS-Schluessel (bldg:function, z. B. 31001_1000) auf die Nutzungsklassen der Karte
def use_by(code):
    if not code:
        return "unbekannt"
    art, _, f = code.partition("_")
    if art != "31001":
        return "neben"  # Bauwerke: Ueberdachungen, Bruecken
    f = int(f) if f.isdigit() else 9998
    if f == 9998:
        return "unbekannt"
    if f < 2000:
        return "wohnen"
    if 2460 <= f <= 2465 or 2721 <= f <= 2729:
        return "neben"  # Garagen, Schuppen
    if 2100 <= f < 2200:
        return "industrie"
    if 2400 <= f < 2500:
        return "verkehr"
    if 2500 <= f < 2700:
        return "versorgung"
    if 2700 <= f < 2800:
        return "landwirtschaft"
    if f < 3000:
        return "gewerbe"
    if f < 4000:
        return "oeffentlich"
    return "gewerbe"


def split_addr(s):
    """'Am Regen 12a' -> ('Am Regen', '12a'); ohne Hausnummer -> (s, '')."""
    m = re.match(r"^(.*\S)\s+(\d+\s*[a-zA-Z]?(?:\s*[-/]\s*\d+\s*[a-zA-Z]?)?)$", s.strip())
    return (m.group(1), m.group(2).replace(" ", "")) if m else (s.strip(), "")


def split_addrs(s):
    """LoD2-Feld mit mehreren Adressen: 'Hedwigweg 3,5' oder 'Altenmarkt 66;Hedwigweg 7' -> Liste (Strasse, Nummer)."""
    out = []
    for part in s.split(";"):
        st, nums = split_addr(part.split(",")[0])
        out.append((st, nums))
        for extra in part.split(",")[1:]:
            extra = extra.strip().replace(" ", "")
            if st and extra[:1].isdigit():
                out.append((st, extra))
    return [(st, n) for st, n in out if st]


def parse_buildings_by():
    """Bayern: CityGML-Kacheln (UTM 32). Zur Gemeinde gehoert, was das Attribut Gemeindeschluessel traegt."""
    seen, out = set(), []
    d = os.path.join(RAW, "lod2")
    for fn in sorted(os.listdir(d)):
        if not (fn.startswith("by_") and fn.endswith(".gml")):
            continue
        txt = open(os.path.join(d, fn), encoding="utf-8").read()
        for blk in re.split(r"(?=<bldg:Building )", txt)[1:]:
            bid = re.search(r'gml:id="([^"]+)"', blk).group(1)
            if bid in seen:
                continue
            seen.add(bid)
            ags = re.search(r'name="Gemeindeschluessel">\s*<gen:value>(\d+)<', blk)
            polys = []
            for pm in re.finditer(r"<gml:Polygon[ >].*?</gml:Polygon>", blk, re.S):
                pl = re.search(r"<gml:posList[^>]*>([^<]+)</gml:posList>", pm.group(0))
                if not pl:
                    continue
                v = [float(t) for t in pl.group(1).split()]
                pts = [(v[k], v[k + 1], v[k + 2]) for k in range(0, len(v) - 2, 3)]
                if len(pts) > 1 and pts[0] == pts[-1]:
                    pts = pts[:-1]
                if len(pts) >= 3:
                    lp = []
                    for e_, n_, h in pts:
                        x, z = xz(*utm_to_latlon(e_, n_, 32))
                        lp.append((x, h, z))
                    polys.append(lp)
            if not polys:
                continue
            allp = [q for lp in polys for q in lp]
            cx = sum(q[0] for q in allp) / len(allp)
            cz = sum(q[2] for q in allp) / len(allp)
            own = ags.group(1) == GEMEINDE_SCHLUESSEL if ags else in_gemeinde(cx, cz)
            nb = not own and in_nb(cx, cz)
            if cell_of(cx, cz) not in KEPT or not (nb or own):
                continue
            zmin = min(q[1] for q in allp)
            zmax = max(q[1] for q in allp)
            hm = re.search(r"<bldg:measuredHeight[^>]*>([\d.]+)<", blk)
            um = re.search(r"<bldg:function>([^<]+)<", blk)
            wv, wi, rv, ri, roof2d = [], [], [], [], []
            for lp in polys:
                tris, (nx, ny, nz) = triangulate(lp)
                if ny < -0.9:
                    continue
                roof = ny > 0.25
                tv, ti = (rv, ri) if roof else (wv, wi)
                base = len(tv) // 3
                for x, y, z in lp:
                    tv += [round(x - cx, 2), round(y - zmin, 2), round(z - cz, 2)]
                for a, b, c in tris:
                    ti += [base + a, base + b, base + c]
                if roof:
                    roof2d.append([(q[0], q[2]) for q in lp])
            xs = [q[0] for q in allp]; zs = [q[2] for q in allp]
            out.append({"id": bid.replace("DEBY_LOD2_", ""), "u": use_by(um.group(1) if um else None), "_f": um.group(1) if um else None,
                        "h": float(hm.group(1)) if hm else None, "t": round(zmax - zmin, 2), "x": round(cx, 2), "z": round(cz, 2),
                        "wv": wv, "wi": wi, "rv": rv, "ri": ri, "o": ot_of(cx, cz),
                        "_bb": (min(xs), min(zs), max(xs), max(zs)), "_roof": roof2d, "a": [],
                        "_addr": [] if nb else [sa for t in re.findall(r"<xAL:ThoroughfareName>([^<]+)<", blk) for sa in split_addrs(t)]})
            if nb:
                out[-1]["nb"] = 1
    out.sort(key=lambda b: b["id"])
    print("Gebaeude:", len(out))
    return out


# Bayern: Der Sammelschluessel 31001_2000 "Gebaeude fuer Wirtschaft oder Gewerbe" steht auch an Scheunen, Schuppen
# und Hallen. refine_use_by() ordnet diese Gebaeude feiner ein, in dieser Reihenfolge:
#   1. Gebaeudeart aus OpenStreetMap (building=barn, garage, house ...), wenn ihr Mittelpunkt im Dach liegt
#   2. klein (unter 40 m2 Grundflaeche oder niedriger als 3,5 m) und ohne Adresse: Nebengebaeude
#   3. OSM-Flaeche, in der das Gebaeude steht: Hof (farmyard) Landwirtschaft, Industrie- und Gewerbeflaeche
#   4. ohne Adresse: in der freien Flur (keine bebaute Flaeche) Landwirtschaft, im Dorf ab 100 m2 Landwirtschaft
#      (Scheunen, Stallungen), sonst Nebengebaeude
# Was mit Adresse uebrig bleibt, bleibt Handel und Gewerbe.
OSM_ART = {}
for _u, _arten in {
    "wohnen": "house detached residential apartments semidetached_house terrace bungalow farm dormitory",
    "neben": "garage garages carport shed hut roof cabin boathouse",
    "landwirtschaft": "barn farm_auxiliary stable cowshed sty greenhouse silo glasshouse agricultural",
    "industrie": "industrial warehouse manufacture factory",
    "gewerbe": "commercial retail office supermarket hotel kiosk",
    "versorgung": "transformer_tower service substation water_tower",
    "oeffentlich": "school kindergarten church chapel public hospital fire_station parish_hall civic government university college",
}.items():
    for _a in _arten.split():
        OSM_ART[_a] = _u
LANDUSE_USE = {"farmyard": "landwirtschaft", "industrial": "industrie", "commercial": "gewerbe", "retail": "gewerbe"}
BEBAUT = {"residential", "farmyard", "industrial", "commercial", "retail", "construction", "military", "railway"}


def landuse_polys():
    """Flaechennutzung aus den OSM-Bloecken: Liste (landuse, Ring, Bounding Box)."""
    out, seen = [], set()
    d = os.path.join(RAW, "osm")
    for fn in sorted(os.listdir(d)):
        for e in jload(os.path.join(d, fn))["elements"]:
            lu = e.get("tags", {}).get("landuse")
            if lu not in BEBAUT or (e["type"], e["id"]) in seen:
                continue
            seen.add((e["type"], e["id"]))
            if e["type"] == "way" and e.get("geometry") and len(e["geometry"]) > 3:
                rings = [[xz(g["lat"], g["lon"]) for g in e["geometry"]]]
            elif e["type"] == "relation":
                rings = rings_of(e, "outer")
            else:
                continue
            for r in rings:
                xs = [p[0] for p in r]; zs = [p[1] for p in r]
                out.append((lu, r, (min(xs), min(zs), max(xs), max(zs))))
    out.sort(key=lambda t: area_of(t[1]))  # kleinste Flaeche zuerst (Hof im Dorfgebiet vor Wohngebiet)
    return out


def landuse_at(polys, grid, x, z):
    for k in grid.get((int(x // 200), int(z // 200)), []):
        lu, r, bb = polys[k]
        if bb[0] <= x <= bb[2] and bb[1] <= z <= bb[3] and pip(x, z, r):
            return lu
    return None


def refine_use_by(buildings):
    if LAND["lod2"] != "citygml_by":
        return
    from collections import Counter
    vorher = Counter(b["u"] for b in buildings)
    arten = {}
    p = os.path.join(RAW, "gebaeudearten.json")
    if os.path.exists(p):
        grid = building_grid(buildings)
        for e in jload(p)["elements"]:
            art = OSM_ART.get(e.get("tags", {}).get("building"))
            if not art or "center" not in e:
                continue
            x, z = xz(e["center"]["lat"], e["center"]["lon"])
            for k in grid.get((int(x // 40), int(z // 40)), []):
                bb = buildings[k]["_bb"]
                if bb[0] <= x <= bb[2] and bb[1] <= z <= bb[3] and any(pip(x, z, r) for r in buildings[k]["_roof"]):
                    arten[k] = art
                    break
    polys = landuse_polys()
    lgrid = {}
    for k, (_, _, bb) in enumerate(polys):
        for gx in range(int(bb[0] // 200), int(bb[2] // 200) + 1):
            for gz in range(int(bb[1] // 200), int(bb[3] // 200) + 1):
                lgrid.setdefault((gx, gz), []).append(k)
    regel = Counter()
    for k, b in enumerate(buildings):
        if b.get("_f") != "31001_2000" or b.get("nb"):
            continue
        if k in arten:
            b["u"] = arten[k]; regel["OSM-Gebaeudeart"] += 1
            continue
        flaeche = sum(area_of(r) for r in b["_roof"])
        hoehe = b["h"] if b["h"] is not None else b["t"]
        adresse = bool(b["a"])
        if not adresse and (flaeche < 40 or hoehe < 3.5):
            b["u"] = "neben"; regel["klein, ohne Adresse"] += 1
            continue
        lu = landuse_at(polys, lgrid, b["x"], b["z"])
        if lu in LANDUSE_USE:
            b["u"] = LANDUSE_USE[lu]; regel["Flaeche " + lu] += 1
        elif adresse:
            regel["mit Adresse, bleibt Gewerbe"] += 1
        elif lu in BEBAUT and flaeche >= 100 and b["o"] >= 0 and OT[b["o"]].get("dorf"):
            b["u"] = "landwirtschaft"; regel["ohne Adresse, gross, im Dorf"] += 1
        elif lu in BEBAUT:
            b["u"] = "neben"; regel["ohne Adresse im Wohngebiet"] += 1
        else:
            b["u"] = "landwirtschaft"; regel["ohne Adresse in der Flur"] += 1
    nachher = Counter(b["u"] for b in buildings)
    print("Gebaeudenutzung verfeinert (Schluessel 2000):", dict(regel))
    print("  vorher:", dict(vorher.most_common()))
    print("  nachher:", dict(nachher.most_common()))


def parse_buildings():
    if LAND["lod2"] == "citygml_by":
        return parse_buildings_by()
    seen, out = set(), []
    for i, j in sorted(KEPT):
        p = os.path.join(RAW, "lod2", "c_%d_%d.gml" % (i, j))
        if not os.path.exists(p):
            continue
        txt = open(p, encoding="utf-8").read()
        for blk in re.split(r"(?=<bu-core3d:Building )", txt)[1:]:
            bid = re.search(r'gml:id="([^"]+)"', blk).group(1)
            if bid in seen:
                continue
            seen.add(bid)
            polys = []
            for pm in re.finditer(r"<gml:Polygon .*?</gml:Polygon>", blk, re.S):
                pl = re.search(r"<gml:posList[^>]*>([^<]+)</gml:posList>", pm.group(0))
                if not pl:
                    continue
                v = [float(t) for t in pl.group(1).split()]
                pts = [(v[k], v[k + 1], v[k + 2]) for k in range(0, len(v) - 2, 3)]
                if len(pts) > 1 and pts[0] == pts[-1]:
                    pts = pts[:-1]
                if len(pts) >= 3:
                    polys.append([(xz(a, b)[0], h, xz(a, b)[1]) for a, b, h in pts])
            if not polys:
                continue
            allp = [q for lp in polys for q in lp]
            cx = sum(q[0] for q in allp) / len(allp)
            cz = sum(q[2] for q in allp) / len(allp)
            nb = not in_gemeinde(cx, cz) and in_nb(cx, cz)  # Nachbarort (ort.json): nur Gebäude, keine Adressen
            if cell_of(cx, cz) not in KEPT or not (nb or in_gemeinde(cx, cz)):
                continue
            zmin = min(q[1] for q in allp)
            zmax = max(q[1] for q in allp)
            hm = re.search(r"<bu-base:HeightAboveGround>.*?<bu-base:value uom=\"m\">([\d.]+)</bu-base:value>", blk, re.S)
            um = re.search(r"CurrentUseValue/(\w+)", blk)
            wv, wi, rv, ri, roof2d = [], [], [], [], []
            for lp in polys:
                tris, (nx, ny, nz) = triangulate(lp)
                if ny < -0.9:
                    continue
                roof = ny > 0.25
                tv, ti = (rv, ri) if roof else (wv, wi)
                base = len(tv) // 3
                for x, y, z in lp:
                    tv += [round(x - cx, 2), round(y - zmin, 2), round(z - cz, 2)]
                for a, b, c in tris:
                    ti += [base + a, base + b, base + c]
                if roof:
                    roof2d.append([(q[0], q[2]) for q in lp])
            xs = [q[0] for q in allp]; zs = [q[2] for q in allp]
            out.append({"id": bid.replace("Building_", ""), "u": USE_MAP.get(um.group(1), um.group(1)) if um else "unbekannt",
                        "h": float(hm.group(1)) if hm else None, "t": round(zmax - zmin, 2), "x": round(cx, 2), "z": round(cz, 2),
                        "wv": wv, "wi": wi, "rv": rv, "ri": ri, "o": ot_of(cx, cz),
                        "_bb": (min(xs), min(zs), max(xs), max(zs)), "_roof": roof2d, "a": []})
            if nb:
                out[-1]["nb"] = 1
    out.sort(key=lambda b: b["id"])
    print("Gebaeude:", len(out))
    return out


# ------------------------------------------------------------------ Adressen
def natkey(s):
    return [int(t) if t.isdigit() else t.lower() for t in re.split(r"(\d+)", s)]


def building_grid(buildings):
    grid = {}
    for k, b in enumerate(buildings):
        x0, z0, x1, z1 = b["_bb"]
        for gx in range(int(x0 // 40), int(x1 // 40) + 1):
            for gz in range(int(z0 // 40), int(z1 // 40) + 1):
                grid.setdefault((gx, gz), []).append(k)
    return grid


def match_building(buildings, grid, x, z):
    """Gebaeude, in dessen Dach der Punkt liegt, sonst das naechste bis 14 m; -1 = keines."""
    for k in grid.get((int(x // 40), int(z // 40)), []):
        b = buildings[k]; bb = b["_bb"]
        if bb[0] - 0.5 <= x <= bb[2] + 0.5 and bb[1] - 0.5 <= z <= bb[3] + 0.5 and any(pip(x, z, r) for r in b["_roof"]):
            return k
    best, hit = 14.0, -1
    for gx in (int(x // 40) - 1, int(x // 40), int(x // 40) + 1):
        for gz in (int(z // 40) - 1, int(z // 40), int(z // 40) + 1):
            for k in grid.get((gx, gz), []):
                bb = buildings[k]["_bb"]
                dist = math.hypot(max(bb[0] - x, 0, x - bb[2]), max(bb[1] - z, 0, z - bb[3]))
                if dist < best:
                    best, hit = dist, k
    return hit


def finish_addresses(buildings, rows, nomatch):
    streets = sorted({r["s"] for r in rows}, key=natkey)
    sidx = {s: i for i, s in enumerate(streets)}
    rows.sort(key=lambda r: (natkey(r["s"]), natkey(r["n"]), r["o"]))
    for r in rows:
        if r["k"] >= 0:
            buildings[r["k"]]["a"].append([sidx[r["s"]], r["n"]])
    print("Adressen: %d, davon ohne Gebaeude: %d, Strassennamen: %d" % (len(rows), nomatch, len(streets)))
    return streets, sidx, rows


def parse_addresses_by(buildings):
    """Bayern: Adressen aus den LoD2-Gebaeuden, ergaenzt um Hausnummern aus OpenStreetMap (addr:street + addr:housenumber).
    Gleiche Strasse und Nummer zaehlen einmal, LoD2 hat Vorrang."""
    rows, seen = [], set()
    for k, b in enumerate(buildings):
        for st, num in b.pop("_addr", []):
            key = (st.lower(), num.lower())
            if not num or key in seen:
                continue
            seen.add(key)
            rows.append({"s": st, "n": num, "x": b["x"], "z": b["z"], "k": k, "o": b["o"]})
    n_lod2 = len(rows)
    grid = building_grid(buildings)
    nomatch = 0
    d = os.path.join(RAW, "osm")
    done = set()
    for fn in sorted(os.listdir(d)):
        for e in jload(os.path.join(d, fn))["elements"]:
            t = e.get("tags", {})
            st, num = t.get("addr:street") or t.get("addr:place"), t.get("addr:housenumber")
            if not st or not num or ";" in st or (e["type"], e["id"]) in done:
                continue
            done.add((e["type"], e["id"]))
            if e["type"] == "node":
                lat, lon = e["lat"], e["lon"]
            elif e.get("bounds"):
                bb = e["bounds"]; lat, lon = (bb["minlat"] + bb["maxlat"]) / 2, (bb["minlon"] + bb["maxlon"]) / 2
            else:
                continue
            x, z = xz(lat, lon)
            if not in_gemeinde(x, z):
                continue
            for n1 in re.split(r"\s*[;,]\s*", num):  # "3;5" = zwei Nummern
                n1 = n1.replace(" ", "")
                key = (st.lower(), n1.lower())
                if not n1 or key in seen:
                    continue
                seen.add(key)
                hit = match_building(buildings, grid, x, z)
                if hit < 0:
                    nomatch += 1
                rows.append({"s": st, "n": n1, "x": x, "z": z, "k": hit, "o": ot_of(x, z)})
    print("Adressen aus LoD2: %d, ergaenzt aus OSM: %d" % (n_lod2, len(rows) - n_lod2))
    return finish_addresses(buildings, rows, nomatch)


def convex_hull(pts):
    pts = sorted(set(pts))
    if len(pts) < 3:
        return pts

    def cross(o, a, b):
        return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])
    lo, hi = [], []
    for p in pts:
        while len(lo) >= 2 and cross(lo[-2], lo[-1], p) <= 0:
            lo.pop()
        lo.append(p)
    for p in reversed(pts):
        while len(hi) >= 2 and cross(hi[-2], hi[-1], p) <= 0:
            hi.pop()
        hi.append(p)
    return lo[:-1] + hi[:-1]


def hull_rings(buildings):
    """Ortsteile ohne Grenze: Flaeche = konvexe Huelle der Gebaeude des Ortsteils (ohne Ausreisser ueber 1,5 km)."""
    for i, o in enumerate(OT):
        pts = [(round(b["x"], 1), round(b["z"], 1)) for b in buildings if b["o"] == i and not b.get("nb")
               and math.hypot(b["x"] - o["c"][0], b["z"] - o["c"][1]) < 1500]
        h = convex_hull(pts)
        if len(h) >= 3:
            o["rings"] = [h + [h[0]]]
            xs = [p[0] for p in h]; zs = [p[1] for p in h]
            o["bb"] = (min(xs), min(zs), max(xs), max(zs))


def parse_addresses(buildings):
    if LAND["addr"] == "lod2_osm":
        return parse_addresses_by(buildings)
    names = jload(os.path.join(RAW, "street_names.json"))
    grid = {}
    for k, b in enumerate(buildings):
        x0, z0, x1, z1 = b["_bb"]
        for gx in range(int(x0 // 40), int(x1 // 40) + 1):
            for gz in range(int(z0 // 40), int(z1 // 40) + 1):
                grid.setdefault((gx, gz), []).append(k)
    rows, seen, nomatch = [], set(), 0
    d = os.path.join(RAW, "addr")
    for fn in sorted(os.listdir(d)):
        if not fn.endswith(".gml"):
            continue
        txt = open(os.path.join(d, fn), encoding="utf-8").read()
        for blk in re.findall(r"<Address .*?</Address>", txt, re.S):
            if 'AdminUnitName_%s"' % GEMEINDE_SCHLUESSEL not in blk:
                continue
            aid = re.search(r'gml:id="([^"]+)"', blk).group(1)
            if aid in seen:
                continue
            seen.add(aid)
            pos = re.search(r"<gml:pos>([\d.]+) ([\d.]+)</gml:pos>", blk)
            tn = re.search(r'ThoroughfareName_(\w+)"', blk)
            if not pos or not tn or tn.group(1) not in names:
                continue
            des = dict((ty, v) for v, ty in re.findall(r'<designator>([^<]+)</designator>\s*<type[^>]*LocatorDesignatorTypeValue/(\w+)"', blk))
            num = des.get("addressNumber", "")
            if not num:
                continue
            num += des.get("addressNumberExtension", "")
            lat, lon = utm33_to_latlon(float(pos.group(1)), float(pos.group(2)))
            x, z = xz(lat, lon)
            if not in_gemeinde(x, z):
                continue
            hit = -1
            for k in grid.get((int(x // 40), int(z // 40)), []):
                b = buildings[k]; bb = b["_bb"]
                if bb[0] - 0.5 <= x <= bb[2] + 0.5 and bb[1] - 0.5 <= z <= bb[3] + 0.5 and any(pip(x, z, r) for r in b["_roof"]):
                    hit = k
                    break
            if hit < 0:  # nächstes Gebäude bis 14 m
                best = 14.0
                for gx in (int(x // 40) - 1, int(x // 40), int(x // 40) + 1):
                    for gz in (int(z // 40) - 1, int(z // 40), int(z // 40) + 1):
                        for k in grid.get((gx, gz), []):
                            b = buildings[k]; bb = b["_bb"]
                            dx = max(bb[0] - x, 0, x - bb[2]); dz = max(bb[1] - z, 0, z - bb[3])
                            dist = math.hypot(dx, dz)
                            if dist < best:
                                best, hit = dist, k
            if hit < 0:
                nomatch += 1
            rows.append({"s": names[tn.group(1)], "n": num, "x": x, "z": z, "k": hit, "o": ot_of(x, z)})
    streets = sorted({r["s"] for r in rows}, key=natkey)
    sidx = {s: i for i, s in enumerate(streets)}
    rows.sort(key=lambda r: (natkey(r["s"]), natkey(r["n"]), r["o"]))
    for r in rows:
        if r["k"] >= 0:
            buildings[r["k"]]["a"].append([sidx[r["s"]], r["n"]])
    print("Adressen: %d, davon ohne Gebaeude: %d, Strassennamen: %d" % (len(rows), nomatch, len(streets)))
    return streets, sidx, rows


# ------------------------------------------------------------------ OSM
def area_kind(t):
    lu, na, le = t.get("landuse"), t.get("natural"), t.get("leisure")
    if na == "water" or t.get("waterway") == "riverbank":
        return "water"
    if na == "wood" or lu == "forest":
        return "wood"
    if na in ("scrub", "heath"):
        return "scrub"
    if na == "wetland":
        return "wet"
    if lu in ("meadow", "grass", "village_green", "recreation_ground", "orchard"):
        return "grass"
    if lu == "farmland":
        return "farm"
    if lu == "residential":
        return "res"
    if lu in ("industrial", "commercial", "retail", "railway", "military"):
        return "ind"
    if le in ("pitch", "park", "garden", "playground", "sports_centre", "golf_course"):
        return "leisure"
    return None


LIVE = os.path.join(RAW, "live", "osm_live.json")  # woechentlich neu (scripts/fetch_live.py): Orte und Haltestellen


def poi_stop(e, R):
    """Orte mit Namen und Haltestellen aus einem OSM-Element in R eintragen."""
    t, typ, geom = e.get("tags", {}), e["type"], e.get("geometry")
    if typ == "node":
        x, z = xz(e["lat"], e["lon"])
        if t.get("highway") == "bus_stop" and t.get("name"):
            R["stops"].append({"n": t["name"], "k": "bus", "x": x, "z": z})
        if t.get("railway") in ("station", "halt", "stop") and t.get("name"):
            R["stops"].append({"n": t["name"], "k": "rail", "x": x, "z": z})
    cat = next(((c, t[c]) for c in ("amenity", "shop", "tourism", "office", "healthcare") if c in t), None)
    if cat and t.get("name") and cat[1] not in ("bench", "waste_basket", "bicycle_parking", "parking", "parking_space",
                                               "shelter", "bus_station", "vending_machine"):
        if typ == "node":
            px, pz = xz(e["lat"], e["lon"])
        elif e.get("bounds"):
            b = e["bounds"]; px, pz = xz((b["minlat"] + b["maxlat"]) / 2, (b["minlon"] + b["maxlon"]) / 2)
        elif geom:
            px, pz = xz(sum(g["lat"] for g in geom) / len(geom), sum(g["lon"] for g in geom) / len(geom))
        else:
            return
        nb = not in_gemeinde(px, pz) and in_nb(px, pz)
        if nb or in_gemeinde(px, pz):
            a = " ".join(filter(None, [t.get("addr:street"), t.get("addr:housenumber")]))
            p = {"n": t["name"], "k": cat[0], "t": cat[1], "x": round(px, 1), "z": round(pz, 1),
                 "oh": t.get("opening_hours"), "ad": a or None,
                 "web": t.get("website") or t.get("contact:website"), "osm": "%s/%d" % (typ, e["id"]),
                 "o": -1 if nb else ot_of(px, pz)}
            if t.get("phone") or t.get("contact:phone"):
                p["tel"] = t.get("phone") or t.get("contact:phone")
            if t.get("healthcare:speciality"):
                p["fa"] = t["healthcare:speciality"]
            if nb:
                p["nb"] = 1
            R["pois"].append(p)


def _bahnhof_nah(s, alle, radius=400.0):
    """Bushaltestelle im Nachbarort: nur wenn ein Bahnhof (Schiene) im Nachbarort höchstens `radius` Meter entfernt liegt."""
    return any(o["k"] == "rail" and in_nb(o["x"], o["z"]) and math.hypot(o["x"] - s["x"], o["z"] - s["z"]) <= radius for o in alle)


def parse_osm():
    d = os.path.join(RAW, "osm")
    seen = set()
    use_live = os.path.exists(LIVE)
    R = {"roads": [], "rails": [], "gleise": [], "waters": [], "areas": [], "pois": [], "stops": [], "trees": []}
    for fn in sorted(os.listdir(d)):
        for e in jload(os.path.join(d, fn))["elements"]:
            key = (e["type"], e["id"])
            if key in seen:
                continue
            seen.add(key)
            t, typ, geom = e.get("tags", {}), e["type"], e.get("geometry")
            if not use_live:
                poi_stop(e, R)
            if typ == "node":
                x, z = xz(e["lat"], e["lon"])
                if t.get("natural") == "tree":
                    R["trees"].append((x, z))
            elif typ == "way" and geom:
                pts = [xz(g["lat"], g["lon"]) for g in geom]
                if "highway" in t and t["highway"] not in ("proposed", "construction", "platform"):
                    R["roads"].append((t["highway"], pts))
                elif t.get("railway") in ("rail", "light_rail", "narrow_gauge", "tram"):
                    R["rails"].append(pts)
                    if t.get("service") not in ("yard", "siding", "spur"):
                        R["gleise"].append(pts)  # Streckengleise fuer die fahrenden Zuege (ohne Abstell- und Nebengleise)
                elif t.get("waterway") in ("river", "stream", "canal", "ditch"):
                    R["waters"].append((t["waterway"], pts))
                elif len(pts) > 3 and geom[0] == geom[-1]:
                    k = area_kind(t)
                    if k:
                        R["areas"].append((k, [pts], []))
            elif typ == "relation" and t.get("type") == "multipolygon":
                k = area_kind(t)
                if k:
                    outer, inner = rings_of(e, "outer"), rings_of(e, "inner")
                    for o in outer:
                        hs = [h for h in inner if h and pip(h[0][0], h[0][1], o)]
                        R["areas"].append((k, [o], hs))
    if use_live:  # Orte und Haltestellen aus dem woechentlichen Abruf (gleiche Logik wie oben)
        seen_live = set()
        for e in jload(LIVE)["elements"]:
            if (e["type"], e["id"]) not in seen_live:
                seen_live.add((e["type"], e["id"]))
                poi_stop(e, R)
    # Haltestellen: Bahn je Name zu einem Punkt zusammenfassen, Bus-Haltepunkte einzeln behalten
    stops, rail = [], {}
    for s in R["stops"]:
        nb = not in_gemeinde(s["x"], s["z"]) and in_nb(s["x"], s["z"])
        if not (nb or in_gemeinde(s["x"], s["z"])):
            continue
        if nb:  # Nachbarort: nur Bahnhof und Bushaltestellen in der Nähe des Bahnhofs (schlank)
            s["nb"] = 1
        if s["k"] == "rail":
            r = rail.setdefault(s["n"], [])
            r.append(s)
        elif not nb or s["n"].lower().replace(NB_NAME.lower() + ", ", "") in ("bahnhof", "busbahnhof"):
            d = {"n": s["n"], "k": "bus", "x": round(s["x"], 1), "z": round(s["z"], 1), "o": ot_of(s["x"], s["z"])}
            if nb:
                d["nb"] = 1
            stops.append(d)
    for n, lst in rail.items():
        x = sum(s["x"] for s in lst) / len(lst); z = sum(s["z"] for s in lst) / len(lst)
        d = {"n": n, "k": "rail", "x": round(x, 1), "z": round(z, 1), "o": ot_of(x, z)}
        if all(s.get("nb") for s in lst):
            d["nb"] = 1
        stops.append(d)
    R["stops"] = stops
    print("OSM: %d Strassen, %d Gleise, %d Gewaesser, %d Flaechen, %d Orte, %d Haltestellen, %d Baeume" % (
        len(R["roads"]), len(R["rails"]), len(R["waters"]), len(R["areas"]), len(R["pois"]), len(stops), len(R["trees"])))
    return R


# ------------------------------------------------------------------ Baeume (symbolisch, aus Waldflaechen)
RES = 10.0
MW, MH = int(NX * CELL / RES), int(NZ * CELL / RES)


def fill_mask(mask, rings):
    rows = {}
    for r in rings:
        n = len(r)
        for k in range(n):
            (xa, za), (xb, zb) = r[k], r[(k + 1) % n]
            if za == zb:
                continue
            if za > zb:
                xa, za, xb, zb = xb, zb, xa, za
            ya, yb = (za - Z0) / RES, (zb - Z0) / RES
            y0, y1 = max(0, math.ceil(ya - 0.5)), min(MH, math.ceil(yb - 0.5))
            for y in range(y0, y1):
                xc = xa + ((y + 0.5) - ya) * (xb - xa) / (yb - ya)
                rows.setdefault(y, []).append((xc - X0) / RES)
    for y, xs in rows.items():
        xs.sort()
        for k in range(0, len(xs) - 1, 2):
            c0, c1 = max(0, math.ceil(xs[k] - 0.5)), min(MW, math.ceil(xs[k + 1] - 0.5))
            if c1 > c0:
                mask[y * MW + c0:y * MW + c1] = b"\x01" * (c1 - c0)


def sample_trees(areas, osm_trees, buildings):
    mask = bytearray(MW * MH)
    for k, outer, holes in areas:
        if k == "wood":
            fill_mask(mask, outer + holes)  # gerade-ungerade Regel: Loecher werden herausgerechnet
    bgrid = set()
    for b in buildings:
        x0, z0, x1, z1 = b["_bb"]
        for gx in range(int((x0 - 3) // 10), int((x1 + 3) // 10) + 1):
            for gz in range(int((z0 - 3) // 10), int((z1 + 3) // 10) + 1):
                bgrid.add((gx, gz))
    per = {}
    STEP = 30.0
    gx = X0
    while gx < X0 + NX * CELL:
        gz = Z0
        while gz < Z0 + NZ * CELL:
            px, pz = gx + random.random() * STEP, gz + random.random() * STEP
            mx, mz = int((px - X0) / RES), int((pz - Z0) / RES)
            if 0 <= mx < MW and 0 <= mz < MH and mask[mz * MW + mx] and (int(px // 10), int(pz // 10)) not in bgrid:
                c = cell_of(px, pz)
                if c in KEPT:
                    per.setdefault(c, []).append((px, pz))
            gz += STEP
        gx += STEP
    for x, z in osm_trees:
        c = cell_of(x, z)
        if c in KEPT and (int(x // 10), int(z // 10)) not in bgrid:
            per.setdefault(c, []).append((x, z))
    CAP = 3500
    for c, lst in per.items():
        if len(lst) > CAP:
            per[c] = random.sample(lst, CAP)
    print("Baeume: %d in %d Kacheln" % (sum(len(v) for v in per.values()), len(per)))
    return per


# ------------------------------------------------------------------ Ausgabe
def split_lines(lines):
    """Linienzuege je Kachel aufteilen (Segment gehoert zur Kachel seines Mittelpunkts)."""
    per = {}
    for kind, pts in lines:
        cur, ccell = [], None
        for a, b in zip(pts, pts[1:]):
            c = cell_of((a[0] + b[0]) / 2, (a[1] + b[1]) / 2)
            if c != ccell:
                if len(cur) >= 2 and ccell in KEPT:
                    per.setdefault(ccell, []).append([kind, flat(cur)])
                cur, ccell = [a], c
            cur.append(b)
        if len(cur) >= 2 and ccell in KEPT:
            per.setdefault(ccell, []).append([kind, flat(cur)])
    return per


def main():
    os.makedirs(OUT, exist_ok=True)
    buildings = parse_buildings()
    import osm_luecken  # Luecken der LGB-Daten mit OSM-Umrissen fuellen (scripts/fetch_osm_gebaeude.py)
    buildings += osm_luecken.luecken(buildings, KEPT, cell_of, in_gemeinde, in_nb, ot_of)
    streets, sidx, rows = parse_addresses(buildings)
    refine_use_by(buildings)  # braucht die Adressen je Gebaeude
    if OT_PUNKTE:
        hull_rings(buildings)
    # Beschriftungspunkt je Ortsteil: Mitte der Adresspunkte (der Polygonschwerpunkt liegt oft im Wald)
    byot = {}
    for r in rows:
        if r["o"] >= 0:
            byot.setdefault(r["o"], []).append((r["x"], r["z"]))
    for i, o in enumerate(OT):
        pts = byot.get(i)
        if pts:
            xs, zs = sorted(p[0] for p in pts), sorted(p[1] for p in pts)
            o["c"] = (xs[len(xs) // 2], zs[len(zs) // 2])
    R = parse_osm()
    trees = sample_trees(R["areas"], R["trees"], buildings)
    lines = [(k, p) for k, p in R["roads"]] + [("rail", p) for p in R["rails"]] + [("w:" + k, p) for k, p in R["waters"]]
    lines_by_cell = split_lines(lines)

    bycell = {}
    for k, b in enumerate(buildings):
        b["_k"] = k
        bycell.setdefault(cell_of(b["x"], b["z"]), []).append(b)
    local = {}
    for c, lst in bycell.items():
        for n, b in enumerate(lst):
            local[b["_k"]] = (c, n)

    tot = 0
    for (i, j) in sorted(KEPT):
        lst = bycell.get((i, j), [])
        tile = {"b": [{k: v for k, v in b.items() if not k.startswith("_")} for b in lst],
                "tr": flat(trees.get((i, j), []), 1), "rd": lines_by_cell.get((i, j), [])}
        s = "AL_TILES[%s]=%s;\n" % (json.dumps("%d_%d" % (i, j)), dump(tile))
        with open(os.path.join(OUT, "t_%d_%d.js" % (i, j)), "w", encoding="utf-8") as f:
            f.write(s)
        tot += len(s)
    print("Kacheln geschrieben: %d, %.1f MB" % (len(KEPT), tot / 1e6))

    # Adressindex: [Strasse, Nummer, x, z, Ortsteil, Kachel i, Kachel j, Gebaeude-Nr oder -1]
    arows = []
    for r in rows:
        ti, tj, n = (0, 0, -1)
        if r["k"] >= 0:
            (ti, tj), n = local[r["k"]]
        arows.append([sidx[r["s"]], r["n"], round(r["x"], 1), round(r["z"], 1), r["o"], ti, tj, n])
    with open(os.path.join(OUT, "addr.js"), "w", encoding="utf-8") as f:
        f.write("window.AL_ADDR=%s;\n" % dump({"streets": streets, "rows": arows}))

    areas = []
    for k, outer, holes in R["areas"]:
        for o in outer:
            if k != "water" and area_of(o) < 300:
                continue
            areas.append([k, flat(simplify(o, 3.0)), [flat(simplify(h, 3.0)) for h in holes]])
    with open(os.path.join(OUT, "gleise.js"), "w", encoding="utf-8") as f:
        f.write("window.AL_GLEISE=%s;\n" % dump([flat(simplify(g, 1.0), 1) for g in R["gleise"] if len(g) >= 2]))
    with open(os.path.join(OUT, "areas.js"), "w", encoding="utf-8") as f:
        f.write("window.AL_AREAS=%s;\n" % dump(areas))

    # Kennzahlen je Ortsteil (aus den eigenen Daten) und belegte Angaben der Gemeinde-Website (fetch_ortsteil_info.py)
    info_path = os.path.join(ROOT, "data", "ergaenzung", "ortsteile_info.json")
    info = jload(info_path) if os.path.exists(info_path) else {"orte": {}}
    cnt_b, cnt_a = {}, {}
    for b in buildings:
        cnt_b[b["o"]] = cnt_b.get(b["o"], 0) + 1
    for r in rows:
        cnt_a[r["o"]] = cnt_a.get(r["o"], 0) + 1
    ortsteile = []
    for i, o in enumerate(OT):
        d = {"n": o["n"], "x": round(o["c"][0], 1), "z": round(o["c"][1], 1),
             "rings": [flat(simplify(r, 8.0)) for r in o["rings"]],
             "ha": round(sum(area_of(r) for r in o["rings"]) / 1e4, 1), "nB": cnt_b.get(i, 0), "nA": cnt_a.get(i, 0)}
        if info["orte"].get(o["n"]):
            d["info"] = info["orte"][o["n"]]
        ortsteile.append(d)

    # Reihenfolge: erst die Webseiten der Orte, dann die Korrekturen von Betreibern. Eine Korrektur gewinnt immer (sonst ueberschriebe der Webseiten-Abgleich sie wieder).
    # Angaben von den Webseiten der Orte (scripts/fetch_orte_web.py): nur Tatsachen, mit Quelle und Lesedatum. OSM-Zeiten haben Vorrang.
    ow_path = os.path.join(ROOT, "data", "ergaenzung", "orte_web.json")
    n_web = 0
    if os.path.exists(ow_path):
        ow = jload(ow_path)
        for p in R["pois"]:
            w = (ow.get("orte") or {}).get(p["osm"])
            if not w or w.get("status") not in ("ok", "keine_zeiten"):
                continue
            n_web += 1
            p["wq"], p["wg"] = w.get("quelle"), ow.get("gelesen")
            for src, dst in (("oeffnungszeiten_text", "wt"), ("telefon", "tel"), ("email", "mail")):
                if w.get(src):
                    p[dst] = w[src]
            if not p.get("oh") and w.get("oh_osm"):
                p["oh"], p["ohw"] = w["oh_osm"], 1
        print("Webseiten-Angaben der Orte uebernommen: %d" % n_web)

    # Korrekturen von Betreibern (data/ergaenzung/poi_korrekturen.json): Name, solange OpenStreetMap noch den alten Stand hat
    kp = os.path.join(ROOT, "data", "ergaenzung", "poi_korrekturen.json")
    n_korr = 0
    if os.path.exists(kp):
        for k in jload(kp).get("korrekturen", []):
            for p in R["pois"]:
                if p["osm"] == k["osm"]:
                    if k.get("name"):
                        p["n"] = k["name"]
                    if k.get("web"):
                        p["web"] = k["web"]
                    for src in ("tel", "mail", "wt", "wq", "wg"):  # Angaben von der eigenen Webseite des Betreibers
                        if k.get(src):
                            p[src] = k[src]
                    p["kq"] = k.get("quelle")
                    n_korr += 1
        print("Korrekturen von Betreibern angewendet: %d" % n_korr)

    meta = {
        "origin": {"lat": LAT0, "lon": LON0}, "cell": CELL, "x0": X0, "z0": Z0, "nx": NX, "nz": NZ,
        "cells": [[i, j, len(bycell.get((i, j), []))] for i, j in sorted(KEPT)],
        "boundary": [flat(simplify(r, 10.0)) for r in BOUND],
        "ortsteile": ortsteile, "ortsteilInfo": {"quelle": info.get("quelle"), "gelesen": info.get("gelesen")},
        "pois": sorted(R["pois"], key=lambda p: p["n"].lower()), "stops": R["stops"],
        "stand": STAND, "nBuildings": sum(1 for b in buildings if not b.get("nb")), "nAddr": len(rows),
        "nb": ({"n": NB_NAME, "bbox": list(NB_BBOX), "x": round(xz(*NB_CENTER)[0], 1), "z": round(xz(*NB_CENTER)[1], 1), "nBuildings": sum(1 for b in buildings if b.get("nb")), "nPois": sum(1 for p in R["pois"] if p.get("nb"))} if NB_NAME else None),
        "sources": [
            {"n": "Luftbild, Gebäude (LoD2), Adressen" + (" (ergänzt aus OpenStreetMap)" if LAND["addr"] == "lod2_osm" else ""), "by": LAND["quelle"]["text"], "url": LAND["quelle"]["url"]},
            {"n": "Straßen, Orte, Haltestellen, Flächen", "by": "© OpenStreetMap-Mitwirkende, ODbL", "url": "https://www.openstreetmap.org/copyright"},
        ],
    }
    with open(os.path.join(OUT, "meta.js"), "w", encoding="utf-8") as f:
        f.write("window.AL_TILES={};window.AL_META=%s;\n" % dump(meta))
    print("Ortsteile:", ", ".join(o["n"] for o in OT))
    for fn in ("meta.js", "addr.js", "areas.js", "gleise.js"):
        print(fn, round(os.path.getsize(os.path.join(OUT, fn)) / 1e6, 2), "MB")
    # Dachfarben aus dem Luftbild in die neu geschriebenen Kacheln eintragen (sonst gehen sie beim Neubau verloren)
    import prepare_dach
    prepare_dach.run(verbose=False)
    # Hoehen und Relief aus dem DGM (scripts/fetch_dgm.py), nur wenn ort.json bausteine.gelaende einschaltet und das DGM geladen ist
    if (ORT.get("bausteine") or {}).get("gelaende"):
        try:
            import prepare_gelaende
            prepare_gelaende.run()
        except ImportError as e:
            print("Gelaende uebersprungen (%s): pip install numpy pillow" % e)


if __name__ == "__main__":
    main()
