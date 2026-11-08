"""Digitales Geländemodell (DGM, LGB Brandenburg) für das Kartengebiet laden.

Dienst : WCS BB DGM 1m  https://isk.geobasis-bb.de/ows/dgm_wcs   (CoverageId bb_dgm, Höhen in m über NHN, Float32, GeoTIFF)
Lizenz : Datenlizenz Deutschland Namensnennung 2.0, "GeoBasis-DE/LGB, dl-de/by-2-0 (Daten geändert)"
Ausgabe: data/raw/dgm/dgm_10m.tif (EPSG:25833, 10 m je Bildpunkt, Rohdaten, nicht im Repository)
Das DGM wird landesweit etwa alle drei Jahre erneuert, ein Abruf genügt bis dahin. Aufruf: python scripts/fetch_dgm.py
"""
import json, math, os, sys, urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from geo import LAT0, LON0, M_LAT, M_LON, latlon_to_utm33  # noqa: E402

ROOT = os.path.dirname(HERE)
OUT = os.path.join(ROOT, "data", "raw", "dgm")
STEP = 10  # Meter je Bildpunkt
sys.stdout.reconfigure(encoding="utf-8")


def bbox_utm():
    c = json.load(open(os.path.join(ROOT, "data", "raw", "gemeinde", "cells.json"), encoding="utf-8"))
    x0, z0, W, H = c["x0"], c["z0"], c["nx"] * c["cell"], c["nz"] * c["cell"]
    pts = []
    for fx in (0, .25, .5, .75, 1):
        for fz in (0, .25, .5, .75, 1):
            pts.append(latlon_to_utm33(LAT0 - (z0 + fz * H) / M_LAT, LON0 + (x0 + fx * W) / M_LON))
    es, ns = [p[0] for p in pts], [p[1] for p in pts]
    m = 200
    return math.floor(min(es) - m), math.floor(min(ns) - m), math.ceil(max(es) + m), math.ceil(max(ns) + m)


def main():
    os.makedirs(OUT, exist_ok=True)
    e0, n0, e1, n1 = bbox_utm()
    w, h = (e1 - e0) // STEP, (n1 - n0) // STEP
    e1, n1 = e0 + w * STEP, n0 + h * STEP
    url = ("https://isk.geobasis-bb.de/ows/dgm_wcs?SERVICE=WCS&VERSION=2.0.1&REQUEST=GetCoverage&COVERAGEID=bb_dgm&FORMAT=image/tiff"
           "&SUBSET=x(%d,%d)&SUBSET=y(%d,%d)&SCALESIZE=x(%d),y(%d)" % (e0, e1, n0, n1, w, h))
    print("Abruf %d x %d Bildpunkte, E %d-%d, N %d-%d" % (w, h, e0, e1, n0, n1))
    with urllib.request.urlopen(url, timeout=600) as r:
        blob = r.read()
    p = os.path.join(OUT, "dgm_10m.tif")
    with open(p, "wb") as f:
        f.write(blob)
    with open(os.path.join(OUT, "dgm_10m.json"), "w", encoding="utf-8") as f:
        json.dump({"e0": e0, "n0": n0, "e1": e1, "n1": n1, "w": w, "h": h, "step": STEP, "gelesen": __import__("datetime").date.today().isoformat(),
                   "quelle": "WCS BB DGM 1m, GeoBasis-DE/LGB, dl-de/by-2-0"}, f)
    print("gespeichert:", p, "%.1f MB" % (len(blob) / 1e6))


if __name__ == "__main__":
    main()
