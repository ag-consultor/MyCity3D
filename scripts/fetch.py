"""Laedt die Rohdaten fuer die Gemeinde aus ort.json (nur Standardbibliothek + Pillow).

Aufruf:  python3 scripts/fetch.py <phase> [<phase> ...]
Phasen:  boundary  Gemeindegrenze und Ortsteil-Grenzen (OSM)
         cells     2-km-Kacheln, die die Gemeinde beruehren
         addr      Adresspunkte je Kachel (amtlich, nur Laender mit Adress-WFS, sonst uebersprungen)
         osm       OSM-Auszug in 4-km-Bloecken
         lod2      3D-Gebaeude (Brandenburg: WFS je Kachel, Bayern: CityGML-Kacheln per Metalink)
         dop       Luftbild: Uebersicht, je Kachel 2 m/px, bebaute Kacheln 1 m/px
Die Dienste je Bundesland stehen in scripts/laender.py (Auswahl ueber ort.json -> land.kennung).

Wiederaufnahmefaehig: vorhandene Dateien werden uebersprungen. Quellen und Lizenzen: README.md
"""
import io, json, math, os, sys, time, urllib.parse, urllib.request, urllib.error
from concurrent.futures import ThreadPoolExecutor

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from geo import CELL, GEMEINDE_RELATION, GEMEINDE_SCHLUESSEL, LAND, LAT0, LON0, M_LAT, M_LON, NB_BBOX, NB_NAME, pip, stitch, xz  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RAW = os.path.join(ROOT, "data", "raw", "gemeinde")
IMG = os.path.join(ROOT, "site", "img")
from geo import ORT  # noqa: E402
UA = ORT.get("kontakt_ua") or "MyCity3D"
OVERPASS = "https://overpass-api.de/api/interpreter"
WFS = "https://inspire.brandenburg.de/services/"  # nur Brandenburg (LAND["lod2"] == "wfs_bb")
WMS = LAND["dop"]["url"]
sys.stdout.reconfigure(encoding="utf-8")


def log(*a):
    print(time.strftime("%H:%M:%S"), *a, flush=True)


def http(url, data=None, timeout=600, tries=5):
    last = None
    for t in range(tries):
        try:
            req = urllib.request.Request(url, data=data, headers={"User-Agent": UA})
            with urllib.request.urlopen(req, timeout=timeout) as r:
                return r.read()
        except urllib.error.HTTPError as e:
            last = e
            if e.code not in (429, 500, 502, 503, 504):
                raise
        except Exception as e:  # Timeout, Verbindungsabbruch
            last = e
        time.sleep(8 * (t + 1))
    raise RuntimeError("Abruf fehlgeschlagen: %s (%s)" % (url[:120], last))


def overpass(q):
    return http(OVERPASS, data=urllib.parse.urlencode({"data": q}).encode())


def save(path, blob):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = path + ".part"
    with open(tmp, "wb") as f:
        f.write(blob)
    os.replace(tmp, path)


def have(path):
    return os.path.exists(path) and os.path.getsize(path) > 0


# ------------------------------------------------------------------ Grenze und Kacheln
def boundary_rings():
    d = json.load(open(os.path.join(RAW, "boundary.json"), encoding="utf-8"))
    parts = []
    for m in d["elements"][0]["members"]:
        if m.get("type") == "way" and m.get("role") == "outer" and m.get("geometry"):
            parts.append([(g["lat"], g["lon"]) for g in m["geometry"]])
    return [[xz(a, b) for a, b in ring] for ring in stitch(parts)]


def phase_boundary():
    p = os.path.join(RAW, "boundary.json")
    if not have(p):
        log("Gemeindegrenze laden")
        save(p, overpass("[out:json][timeout:120];rel(%d);out geom;" % GEMEINDE_RELATION))
    p = os.path.join(RAW, "ortsteile_geom.json")
    if not have(p):
        log("Ortsteil-Grenzen laden")
        save(p, overpass('[out:json][timeout:120];area(%d)->.a;rel(area.a)["boundary"="administrative"]["admin_level"="9"];out geom;'
                         % (3600000000 + GEMEINDE_RELATION)))
    p = os.path.join(RAW, "ortsteile_orte.json")
    if not have(p):  # Ersatz, wo OSM keine Ortsteil-Grenzen kennt (z. B. Cham): Gemeindeteile ueber die Ortsmarken, auch Weiler und Einoeden
        log("Ortsmarken laden")
        save(p, overpass('[out:json][timeout:120];area(%d)->.a;node["place"~"^(town|city|suburb|quarter|village|hamlet|isolated_dwelling)$"]["name"](area.a);out;'
                         % (3600000000 + GEMEINDE_RELATION)))
    p = os.path.join(RAW, "gebaeudearten.json")
    if LAND["lod2"] == "citygml_by" and not have(p):  # Bayern: LoD2 kennt oft nur "Wirtschaft oder Gewerbe", OSM-Gebaeudeart hilft beim Einordnen
        log("Gebaeudearten aus OSM laden")
        save(p, overpass('[out:json][timeout:180];area(%d)->.a;way["building"]["building"!="yes"](area.a);out tags center;'
                         % (3600000000 + GEMEINDE_RELATION)))


def phase_cells():
    rings = boundary_rings()
    allp = [p for r in rings for p in r]
    x0 = math.floor(min(p[0] for p in allp) / CELL) * CELL
    z0 = math.floor(min(p[1] for p in allp) / CELL) * CELL
    nx = math.ceil((max(p[0] for p in allp) - x0) / CELL)
    nz = math.ceil((max(p[1] for p in allp) - z0) / CELL)
    cells = []
    for i in range(nx):
        for j in range(nz):
            xa, za = x0 + i * CELL, z0 + j * CELL
            xb, zb = xa + CELL, za + CELL
            hit = any(xa <= p[0] < xb and za <= p[1] < zb for p in allp)
            if not hit:
                pts = [(xa, za), (xb, za), (xa, zb), (xb, zb), ((xa + xb) / 2, (za + zb) / 2)]
                hit = any(pip(px, pz, r) for px, pz in pts for r in rings)
            if not hit and NB_NAME:  # Kacheln, die das Rechteck des Nachbarorts berühren (geo.NB_BBOX, nur wenn in ort.json gesetzt)
                pts = [xz(NB_BBOX[0], NB_BBOX[1]), xz(NB_BBOX[2], NB_BBOX[3])]
                hit = pts[0][0] < xb and pts[1][0] >= xa and pts[1][1] < zb and pts[0][1] >= za
            if hit:
                cells.append([i, j])
    save(os.path.join(RAW, "cells.json"), json.dumps({"x0": x0, "z0": z0, "nx": nx, "nz": nz, "cell": CELL, "cells": cells}).encode())
    log("Kacheln: %d von %d x %d (Gemeinde %.1f x %.1f km)" % (len(cells), nx, nz, nx * CELL / 1000, nz * CELL / 1000))


def load_cells():
    return json.load(open(os.path.join(RAW, "cells.json"), encoding="utf-8"))


def cell_bbox(c, i, j):
    xa, za = c["x0"] + i * CELL, c["z0"] + j * CELL
    return (LAT0 - (za + CELL) / M_LAT, LON0 + xa / M_LON, LAT0 - za / M_LAT, LON0 + (xa + CELL) / M_LON)


# ------------------------------------------------------------------ WFS je Kachel
def wfs_cell(kind, svc, typename, c, i, j):
    path = os.path.join(RAW, kind, "c_%d_%d.gml" % (i, j))
    if have(path):
        return
    b = cell_bbox(c, i, j)
    url = (WFS + svc + "?SERVICE=WFS&VERSION=2.0.0&REQUEST=GetFeature&TYPENAMES=" + typename
           + "&COUNT=20000&BBOX=%.6f,%.6f,%.6f,%.6f,urn:ogc:def:crs:EPSG::4326" % b)
    blob = http(url)
    save(path, blob)
    log(kind, i, j, "%.1f MB" % (len(blob) / 1e6))


def run_pool(fn, jobs, workers):
    with ThreadPoolExecutor(workers) as ex:
        futs = [ex.submit(fn, *j) for j in jobs]
        fails = 0
        for f in futs:
            try:
                f.result()
            except Exception as e:  # einzelne Kachel darf nicht alles stoppen
                fails += 1
                log("FEHLER", e)
    log("fertig, Fehler:", fails)


def phase_addr():
    if LAND["addr"] != "alkis_wfs":
        log("Adressen: kein amtlicher Adress-WFS fuer %s, Adressen kommen aus LoD2 und OSM" % LAND["name"])
        return
    c = load_cells()
    run_pool(lambda i, j: wfs_cell("addr", "ad_alkis_wfs", "ad:Address", c, i, j), [(i, j) for i, j in c["cells"]], 4)


def phase_lod2():
    if LAND["lod2"] == "citygml_by":
        return lod2_bayern()
    c = load_cells()
    run_pool(lambda i, j: wfs_cell("lod2", "bu-core3d_lod2_wfs", "bu-core3d:Building", c, i, j), [(i, j) for i, j in c["cells"]], 4)


def lod2_bayern():
    """Bayern: LoD2 als CityGML-Kacheln (2 x 2 km, UTM 32) zum Herunterladen. Welche Kacheln die Gemeinde
    beruehren, steht im Metalink der Gemeinde (geodaten.bayern.de, OpenData, CC BY 4.0). Mit Nachbarort
    werden zusaetzlich die Kacheln seines Gemeindeschluessels geladen (ort.json: nachbarort.gemeindeschluessel)."""
    import re
    ags = [GEMEINDE_SCHLUESSEL]
    nb = ORT.get("nachbarort") or {}
    if nb.get("gemeindeschluessel"):
        ags.append(str(nb["gemeindeschluessel"]))
    urls = {}
    for a in ags:
        meta = http(LAND["lod2_metalink"].format(ags=a)).decode("utf-8")
        for name, body in re.findall(r'<file name="([^"]+)">(.*?)</file>', meta, re.S):
            u = re.findall(r"<url[^>]*>([^<]+)</url>", body)
            if u:
                urls[name] = u
    log("LoD2 Bayern: %d Kacheln" % len(urls))

    def one(name, us):
        path = os.path.join(RAW, "lod2", "by_" + name)
        if have(path):
            return
        last = None
        for u in us:  # Spiegel nacheinander
            try:
                blob = http(u, tries=3)
                save(path, blob)
                log("lod2", name, "%.1f MB" % (len(blob) / 1e6))
                return
            except Exception as e:
                last = e
        raise RuntimeError("LoD2-Kachel %s: %s" % (name, last))
    run_pool(one, sorted(urls.items()), 3)


def phase_names():
    """Straßennamen: Adresspunkte verweisen nur auf ThoroughfareName-Kennungen (nur die der Gemeinde)."""
    import re
    if LAND["addr"] != "alkis_wfs":
        return
    ids = set()
    d = os.path.join(RAW, "addr")
    for fn in os.listdir(d):
        if fn.endswith(".gml"):
            txt = open(os.path.join(d, fn), encoding="utf-8", errors="ignore").read()
            ids |= set(re.findall(r'ThoroughfareName_(%s\w*)"' % GEMEINDE_SCHLUESSEL, txt))
    ids = sorted(ids)
    names = {}
    for k in range(0, len(ids), 60):
        batch = ids[k:k + 60]
        url = (WFS + "ad_alkis_wfs?SERVICE=WFS&VERSION=2.0.0&REQUEST=GetFeature&RESOURCEID="
               + ",".join("ThoroughfareName_" + x for x in batch))
        x = http(url).decode("utf-8")
        for m in re.finditer(r'<ThoroughfareName gml:id="ThoroughfareName_(\w+)".*?<gn:text>([^<]*)</gn:text>', x, re.S):
            names[m.group(1)] = m.group(2)
    save(os.path.join(RAW, "street_names.json"), json.dumps(names, ensure_ascii=False).encode("utf-8"))
    log("Straßennamen: %d von %d Kennungen" % (len(names), len(ids)))


# ------------------------------------------------------------------ OSM in Bloecken
OSM_Q = """[out:json][timeout:180];
(
 way["highway"]({b}); way["railway"]({b}); way["waterway"~"^(river|stream|canal|ditch)$"]({b});
 way["natural"~"^(water|wood|scrub|heath|wetland)$"]({b}); rel["natural"~"^(water|wood)$"]({b});
 way["landuse"]({b}); rel["landuse"~"^(forest|meadow|farmland|residential)$"]({b});
 way["leisure"]({b}); node["natural"="tree"]({b});
 nwr["amenity"]["name"]({b}); nwr["shop"]["name"]({b}); nwr["tourism"]["name"]({b});
 nwr["office"]["name"]({b}); nwr["healthcare"]["name"]({b});
 node["highway"="bus_stop"]({b}); node["railway"~"^(station|halt|stop)$"]({b});
 {addr}
);
out geom;"""
# Ohne amtliche Adressen (Bayern): Hausnummern aus OSM mitladen
OSM_ADDR = 'nwr["addr:housenumber"]({b});' if LAND["addr"] == "lod2_osm" else ""


def phase_osm():
    c = load_cells()
    kept = set(map(tuple, c["cells"]))
    for bi in range(0, c["nx"], 2):
        for bj in range(0, c["nz"], 2):
            if not any((bi + a, bj + b) in kept for a in (0, 1) for b in (0, 1)):
                continue
            path = os.path.join(RAW, "osm", "b_%d_%d.json" % (bi, bj))
            if have(path):
                continue
            xa, za = c["x0"] + bi * CELL, c["z0"] + bj * CELL
            bb = "%.6f,%.6f,%.6f,%.6f" % (LAT0 - (za + 2 * CELL) / M_LAT, LON0 + xa / M_LON, LAT0 - za / M_LAT, LON0 + (xa + 2 * CELL) / M_LON)
            blob = overpass(OSM_Q.replace("{addr}", OSM_ADDR).replace("{b}", bb))
            save(path, blob)
            log("osm", bi, bj, "%.1f MB" % (len(blob) / 1e6))
            time.sleep(2)


# ------------------------------------------------------------------ Luftbild
def getmap(bbox, w, h):
    url = (WMS + "?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetMap&LAYERS=" + LAND["dop"]["layer"] + "&STYLES=&CRS=EPSG:4326"
           "&BBOX=%.7f,%.7f,%.7f,%.7f&WIDTH=%d&HEIGHT=%d&FORMAT=image/jpeg" % (bbox + (w, h)))
    return http(url, timeout=300)


def fill_nodata(im):
    """Ausserhalb des Landes liefert der Dienst reines Weiss. Zusammenhaengende Weissflaechen
    (mind. 5 Bildpunkte breit) werden durch die Umgebungsfarbe der Seite ersetzt. Gibt True zurueck, wenn etwas geaendert wurde."""
    from PIL import ImageChops, ImageFilter
    r, g, b = im.split()
    mn = ImageChops.darker(ImageChops.darker(r, g), b)
    mask = mn.point(lambda v: 255 if v >= 250 else 0).filter(ImageFilter.MinFilter(5)).filter(ImageFilter.MaxFilter(9))
    if mask.getbbox() is None:
        return False
    im.paste((10, 22, 38), mask=mask)  # Nachtflug-Blau statt Olivgruen
    return True


def recompress(blob, q):
    from PIL import Image
    im = Image.open(io.BytesIO(blob)).convert("RGB")
    if fill_nodata(im):
        q = max(q, 80)
    out = io.BytesIO()
    im.save(out, "JPEG", quality=q, optimize=True, progressive=True)
    return out.getvalue()


def dop_cell(c, i, j, detail):
    name = ("d_%d_%d.jpg" if detail else "p_%d_%d.jpg") % (i, j)
    path = os.path.join(IMG, name)
    if have(path):
        return
    px = 2048 if detail else 1024
    save(path, recompress(getmap(cell_bbox(c, i, j), px, px), 74 if detail else 70))
    log("dop", name)


def count_buildings(i, j):
    p = os.path.join(RAW, "lod2", "c_%d_%d.gml" % (i, j))
    if not have(p):
        return 0
    with open(p, encoding="utf-8", errors="ignore") as f:
        return f.read().count("<bu-core3d:Building ")


def buildings_per_cell_by():
    """Bayern: Gebaeude je Kachel aus den CityGML-Kacheln zaehlen (Mittelpunkt des ersten Polygons)."""
    import re
    from geo import utm_to_latlon, xz
    c = load_cells()
    cnt = {}
    d = os.path.join(RAW, "lod2")
    for fn in os.listdir(d) if os.path.isdir(d) else []:
        if not fn.startswith("by_"):
            continue
        txt = open(os.path.join(d, fn), encoding="utf-8", errors="ignore").read()
        for m in re.finditer(r"<bldg:Building .*?<gml:posList[^>]*>\s*([\d.]+) ([\d.]+)", txt, re.S):
            x, z = xz(*utm_to_latlon(float(m.group(1)), float(m.group(2)), 32))
            k = (int(math.floor((x - c["x0"]) / CELL)), int(math.floor((z - c["z0"]) / CELL)))
            cnt[k] = cnt.get(k, 0) + 1
    return cnt


def phase_dop():
    c = load_cells()
    p = os.path.join(IMG, "overview.jpg")
    if not have(p):
        b = (LAT0 - (c["z0"] + c["nz"] * CELL) / M_LAT, LON0 + c["x0"] / M_LON, LAT0 - c["z0"] / M_LAT, LON0 + (c["x0"] + c["nx"] * CELL) / M_LON)
        save(p, recompress(getmap(b, 2048, round(2048 * c["nz"] / c["nx"])), 70))
        log("overview.jpg")
    jobs = [(c, i, j, False) for i, j in c["cells"]]
    if LAND["lod2"] == "citygml_by":
        cnt = buildings_per_cell_by()
        jobs += [(c, i, j, True) for i, j in c["cells"] if cnt.get((i, j), 0) >= 10]
    else:
        jobs += [(c, i, j, True) for i, j in c["cells"] if count_buildings(i, j) >= 10]
    run_pool(dop_cell, jobs, 3)


if __name__ == "__main__":
    for ph in sys.argv[1:] or ["boundary", "cells"]:
        log("Phase", ph)
        globals()["phase_" + ph]()
