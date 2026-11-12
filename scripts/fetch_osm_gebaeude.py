"""Gebaeudeumrisse aus OpenStreetMap (ODbL), kachelweise, als Ergaenzung dort, wo die LGB-Gebaeudedaten (LoD2) Luecken haben.

Abruf  : Overpass, je Kachel (2 km) alle Wege mit building=* mit Geometrie. Rohdaten: data/raw/gemeinde/osm_geb/c_<i>_<j>.json (nicht im Repository)
Aufruf : python scripts/fetch_osm_gebaeude.py     (vorhandene Dateien werden uebersprungen; Overpass haengt oft, das Skript wiederholt)
"""
import json, os, sys, time, urllib.parse, urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from geo import CELL, LAT0, LON0, M_LAT, M_LON, ORT

ROOT = os.path.dirname(HERE)
RAW = os.path.join(ROOT, "data", "raw", "gemeinde")
OUT = os.path.join(RAW, "osm_geb")
HOSTS = ("https://overpass-api.de/api/interpreter", "https://overpass.kumi.systems/api/interpreter")
UA = ORT["kontakt_ua"]
sys.stdout.reconfigure(encoding="utf-8")


def overpass(q):
    for i in range(5):
        for h in HOSTS:
            try:
                req = urllib.request.Request(h, data=urllib.parse.urlencode({"data": q}).encode(), headers={"User-Agent": UA})
                return urllib.request.urlopen(req, timeout=240).read()
            except Exception as e:
                print("  Overpass", h.split("/")[2], e, flush=True)
                time.sleep(8 * (i + 1))
    raise RuntimeError("Overpass nicht erreichbar")


def main():
    c = json.load(open(os.path.join(RAW, "cells.json"), encoding="utf-8"))
    os.makedirs(OUT, exist_ok=True)
    for i, j in c["cells"]:
        p = os.path.join(OUT, "c_%d_%d.json" % (i, j))
        if os.path.exists(p) and os.path.getsize(p) > 20:
            continue
        xa, za = c["x0"] + i * CELL, c["z0"] + j * CELL
        bb = "%.6f,%.6f,%.6f,%.6f" % (LAT0 - (za + CELL) / M_LAT, LON0 + xa / M_LON, LAT0 - za / M_LAT, LON0 + (xa + CELL) / M_LON)
        blob = overpass('[out:json][timeout:200];way["building"](%s);out geom tags;' % bb)
        open(p, "wb").write(blob)
        print("Kachel", i, j, "%.1f MB" % (len(blob) / 1e6), flush=True)
        time.sleep(2)
    print("fertig", len(os.listdir(OUT)), "Dateien")


if __name__ == "__main__":
    main()
