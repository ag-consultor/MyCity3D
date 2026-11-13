"""Gebaeudeluecken der LGB-Daten (LoD2) mit Umrissen aus OpenStreetMap (ODbL) fuellen.

Hintergrund: Im LoD2/ALKIS-Bestand der Landesvermessung fehlen einzelne Gebaeude (Neubauten, nicht erfasste Bauten, mitunter Kirchen);
beide Dienste liefern sie nicht. OpenStreetMap kennt viele davon.
Regel: Ein OSM-Gebaeude wird nur uebernommen, wenn weniger als 30 % seiner Stuetzpunkte (Mitte und Eckpunkte nach innen gezogen) in einem LoD2-Dach liegen.
Das Ergebnis sind einfache Prismen mit flachem Dach, Hoehe aus OSM (height, building:levels) oder nach Gebaeudeart geschaetzt. Kennzeichen "osm": 1.
Eingabe : data/raw/gemeinde/osm_geb/c_<i>_<j>.json (scripts/fetch_osm_gebaeude.py). Aufruf aus prepare_gemeinde.py: luecken(buildings, ...)
"""
import glob, json, math, os, re, sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from geo import pip, xz  # noqa: E402
from geom3d import triangulate  # noqa: E402

ROOT = os.path.dirname(HERE)
DIR = os.path.join(ROOT, "data", "raw", "gemeinde", "osm_geb")

NUTZ = {}
for k in ("house", "residential", "detached", "semidetached_house", "terrace", "apartments", "bungalow", "dormitory", "farm", "semi"):
    NUTZ[k] = "wohnen"
for k in ("church", "chapel", "cathedral", "civic", "public", "school", "hospital", "government", "kindergarten", "fire_station", "college", "university", "town_hall", "museum", "monastery"):
    NUTZ[k] = "oeffentlich"
for k in ("garage", "garages", "carport", "parking"):
    NUTZ[k] = "verkehr"
for k in ("shed", "roof", "hut", "cabin", "greenhouse", "service", "outbuilding", "kiosk", "toilets", "container"):
    NUTZ[k] = "neben"
for k in ("industrial", "warehouse", "factory", "manufacture"):
    NUTZ[k] = "industrie"
for k in ("commercial", "retail", "supermarket", "office", "hotel", "shop", "kiosk"):
    NUTZ[k] = "gewerbe"
for k in ("barn", "farm_auxiliary", "stable", "cowshed", "silo", "agricultural", "sty", "livestock"):
    NUTZ[k] = "landwirtschaft"
HOEHE = {"church": 14.0, "cathedral": 25.0, "chapel": 7.0, "garage": 2.8, "garages": 2.8, "carport": 2.6, "shed": 2.6, "hut": 2.6, "cabin": 3.0, "barn": 6.5,
         "house": 7.0, "residential": 8.0, "detached": 7.0, "semidetached_house": 7.0, "terrace": 7.0, "apartments": 10.0, "industrial": 8.0, "warehouse": 7.0,
         "greenhouse": 3.0, "farm_auxiliary": 5.0, "school": 10.0, "kindergarten": 5.0, "civic": 10.0, "public": 9.0, "commercial": 8.0, "retail": 6.0, "roof": 3.0,
         "stable": 5.0, "cowshed": 5.0, "silo": 12.0, "service": 3.5, "yes": 6.0}


def zahl(v):
    try:
        return float(str(v).replace(",", ".").split()[0])
    except (TypeError, ValueError, IndexError):
        return None


def hoehe(t):
    h = zahl(t.get("height"))
    if h and 1.5 < h < 150:
        return h, False
    lv = zahl(t.get("building:levels"))
    if lv and 0 < lv < 40:
        return lv * 2.9 + 1.5, True
    return HOEHE.get(t.get("building"), 6.0), True


def flaeche(r):
    return abs(sum(r[i][0] * r[(i + 1) % len(r)][1] - r[(i + 1) % len(r)][0] * r[i][1] for i in range(len(r)))) / 2


def luecken(buildings, kept, cell_of, in_gemeinde, in_nb, ot_of, log=print):
    files = sorted(glob.glob(os.path.join(DIR, "c_*.json")))
    if not files:
        log("OSM-Gebaeude: keine Rohdaten (scripts/fetch_osm_gebaeude.py), keine Luecken gefuellt")
        return []
    # Raster (100 m) ueber die LoD2-Daecher
    G = {}
    for b in buildings:
        x0, z0, x1, z1 = b["_bb"]
        for gx in range(int(x0 // 100), int(x1 // 100) + 1):
            for gz in range(int(z0 // 100), int(z1 // 100) + 1):
                G.setdefault((gx, gz), []).append(b)

    def bedeckt(x, z):
        for b in G.get((int(x // 100), int(z // 100)), ()):
            bb = b["_bb"]
            if bb[0] - 1 <= x <= bb[2] + 1 and bb[1] - 1 <= z <= bb[3] + 1 and any(pip(x, z, r) for r in b["_roof"]):
                return True
        return False

    seen, neu, stat = set(), [], {"osm": 0, "bedeckt": 0, "klein": 0, "ausserhalb": 0}
    for f in files:
        try:
            d = json.load(open(f, encoding="utf-8"))
        except Exception:
            continue
        for e in d.get("elements", []):
            if e.get("type") != "way" or e["id"] in seen or not e.get("geometry"):
                continue
            seen.add(e["id"])
            stat["osm"] += 1
            t = e.get("tags") or {}
            ring = [xz(p["lat"], p["lon"]) for p in e["geometry"]]
            if len(ring) > 1 and ring[0] == ring[-1]:
                ring = ring[:-1]
            if len(ring) < 3:
                continue
            a = flaeche(ring)
            if a < 12 or a > 8000:
                stat["klein"] += 1
                continue
            cx = sum(p[0] for p in ring) / len(ring); cz = sum(p[1] for p in ring) / len(ring)
            nb = (not in_gemeinde(cx, cz)) and in_nb(cx, cz)
            if (not in_gemeinde(cx, cz) and not nb) or cell_of(cx, cz) not in kept:
                stat["ausserhalb"] += 1
                continue
            samples = [(cx, cz)] + [(cx + (p[0] - cx) * 0.7, cz + (p[1] - cz) * 0.7) for p in ring[:: max(1, len(ring) // 4)]][:4]
            if sum(1 for s in samples if bedeckt(*s)) / len(samples) >= 0.3:
                stat["bedeckt"] += 1
                continue
            h, geschaetzt = hoehe(t)
            # Waende (zwei Dreiecke je Kante) und flaches Dach, relativ zur Mitte
            rel = [(p[0] - cx, p[1] - cz) for p in ring]
            wv, wi = [], []
            for i in range(len(rel)):
                (x0, z0), (x1, z1) = rel[i], rel[(i + 1) % len(rel)]
                k = len(wv) // 3
                wv += [round(x0, 2), 0.0, round(z0, 2), round(x1, 2), 0.0, round(z1, 2), round(x1, 2), round(h, 2), round(z1, 2), round(x0, 2), round(h, 2), round(z0, 2)]
                wi += [k, k + 1, k + 2, k, k + 2, k + 3]
            top = [(x, h, z) for x, z in rel]
            tris, (nx, ny, nz) = triangulate(top)
            rv, ri = [], []
            for x, y, z in top:
                rv += [round(x, 2), round(y, 2), round(z, 2)]
            for t3 in tris:
                ri += list(t3)
            b = {"id": "osm-%d" % e["id"], "u": NUTZ.get(t.get("building"), "unbekannt"), "h": round(h, 3), "t": round(h, 2), "x": round(cx, 2), "z": round(cz, 2),
                 "wv": wv, "wi": wi, "rv": rv, "ri": ri, "o": ot_of(cx, cz), "osm": 1 if not geschaetzt else 2, "_bb": (min(p[0] for p in ring), min(p[1] for p in ring), max(p[0] for p in ring), max(p[1] for p in ring)),
                 "_roof": [ring], "a": []}
            if t.get("name"):
                b["nm"] = t["name"][:60]
            if nb:
                b["nb"] = 1
            neu.append(b)
    log("OSM-Gebaeude: %d gelesen, %d uebernommen (fehlen in LoD2), %d schon durch LoD2 bedeckt, %d zu klein/gross, %d ausserhalb" % (stat["osm"], len(neu), stat["bedeckt"], stat["klein"], stat["ausserhalb"]))
    return neu
