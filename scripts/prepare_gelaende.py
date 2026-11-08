"""Gelände (DGM, LGB) in die fertigen Seitendaten einarbeiten.

Eingabe : data/raw/dgm/dgm_10m.tif (scripts/fetch_dgm.py)
Ausgabe : "hn" (Höhe über NHN in m, eine Dezimale) je Gebäude in site/data/t_*.js sowie je Ort, Haltestelle und Ortsteil in site/data/meta.js
          site/img/relief.png   Schummerung (Geländerelief) als halbtransparentes Bild für die ganze Karte, 10 m je Bildpunkt
Aufruf  : python scripts/prepare_gelaende.py (idempotent). Wird am Ende von prepare_gemeinde.py mit aufgerufen, sofern das DGM geladen ist.
Quelle  : WCS BB DGM 1m, GeoBasis-DE/LGB, dl-de/by-2-0 (Daten geändert). Das Relief ist stark überhöht (Faktor 6), die Höhen sind auf 10 m gemittelt.
"""
import json, math, os, re, sys

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from geo import LAT0, LON0, M_LAT, M_LON  # noqa: E402

ROOT = os.path.dirname(HERE)
RAW = os.path.join(ROOT, "data", "raw", "dgm")
DATA = os.path.join(ROOT, "site", "data")
IMG = os.path.join(ROOT, "site", "img")
sys.stdout.reconfigure(encoding="utf-8")
NODATA = -9000.0
UEBERHOEHUNG = 6.0


def utm33(lat, lon):  # wie geo.latlon_to_utm33, für Felder (numpy)
    a, f, k0 = 6378137.0, 1 / 298.257222101, 0.9996
    n = f / (2 - f)
    A = a / (1 + n) * (1 + n ** 2 / 4 + n ** 4 / 64)
    al = [n / 2 - 2 * n ** 2 / 3 + 5 * n ** 3 / 16, 13 * n ** 2 / 48 - 3 * n ** 3 / 5, 61 * n ** 3 / 240]
    phi, dl = np.radians(lat), np.radians(lon - 15.0)
    q = 2 * math.sqrt(n) / (1 + n)
    t = np.sinh(np.arctanh(np.sin(phi)) - q * np.arctanh(q * np.sin(phi)))
    xi_p = np.arctan2(t, np.cos(dl))
    eta_p = np.arctanh(np.sin(dl) / np.sqrt(1 + t * t))
    xi = xi_p + sum(al[j] * np.sin(2 * (j + 1) * xi_p) * np.cosh(2 * (j + 1) * eta_p) for j in range(3))
    eta = eta_p + sum(al[j] * np.cos(2 * (j + 1) * xi_p) * np.sinh(2 * (j + 1) * eta_p) for j in range(3))
    return 500000.0 + k0 * A * eta, k0 * A * xi


class Dgm:
    def __init__(self):
        from PIL import Image
        self.meta = json.load(open(os.path.join(RAW, "dgm_10m.json"), encoding="utf-8"))
        self.a = np.array(Image.open(os.path.join(RAW, "dgm_10m.tif")), dtype=np.float64)
        self.a[self.a < NODATA] = np.nan

    def at(self, x, z):
        """Höhe über NHN an lokalen Koordinaten (Felder), bilinear; nan ohne Daten."""
        m = self.meta
        x, z = np.asarray(x, dtype=np.float64), np.asarray(z, dtype=np.float64)
        E, N = utm33(LAT0 - z / M_LAT, LON0 + x / M_LON)
        c, r = (E - m["e0"]) / m["step"] - 0.5, (m["n1"] - N) / m["step"] - 0.5
        c0, r0 = np.floor(c).astype(int), np.floor(r).astype(int)
        fc, fr = c - c0, r - r0
        h, w = self.a.shape
        ok = (c0 >= 0) & (c0 < w - 1) & (r0 >= 0) & (r0 < h - 1)
        c0, r0 = np.clip(c0, 0, w - 2), np.clip(r0, 0, h - 2)
        a = self.a
        v = (a[r0, c0] * (1 - fc) * (1 - fr) + a[r0, c0 + 1] * fc * (1 - fr) + a[r0 + 1, c0] * (1 - fc) * fr + a[r0 + 1, c0 + 1] * fc * fr)
        return np.where(ok, v, np.nan)


def hn(v):
    return None if v is None or not np.isfinite(v) else round(float(v), 1)


def run():
    if not os.path.exists(os.path.join(RAW, "dgm_10m.tif")):
        print("Kein DGM geladen (scripts/fetch_dgm.py): keine Höhen")
        return 0
    D = Dgm()
    cells = json.load(open(os.path.join(ROOT, "data", "raw", "gemeinde", "cells.json"), encoding="utf-8"))
    n_b = 0
    for i, j in cells["cells"]:
        tp = os.path.join(DATA, "t_%d_%d.js" % (i, j))
        if not os.path.exists(tp):
            continue
        m = re.match(r'(AL_TILES\["[^"]+"\]=)(.*);\s*$', open(tp, encoding="utf-8").read(), re.S)
        if not m:
            continue
        tile = json.loads(m.group(2))
        if tile["b"]:
            hv = D.at([b["x"] for b in tile["b"]], [b["z"] for b in tile["b"]])
            for b, v in zip(tile["b"], hv):
                h = hn(v)
                if h is None:
                    b.pop("hn", None)
                else:
                    b["hn"] = h; n_b += 1
        with open(tp, "w", encoding="utf-8") as f:
            f.write(m.group(1) + json.dumps(tile, ensure_ascii=False, separators=(",", ":")) + ";\n")
    # Orte, Haltestellen, Ortsteile in meta.js
    mp = os.path.join(DATA, "meta.js")
    txt = open(mp, encoding="utf-8").read()
    pre = "window.AL_TILES={};window.AL_META="
    meta = json.loads(txt[len(pre):txt.rindex(";")])
    n_m = 0
    for key in ("pois", "stops", "ortsteile"):
        lst = meta.get(key) or []
        if not lst:
            continue
        hv = D.at([p["x"] for p in lst], [p["z"] for p in lst])
        for p, v in zip(lst, hv):
            h = hn(v)
            if h is None:
                p.pop("hn", None)
            else:
                p["hn"] = h; n_m += 1
    with open(mp, "w", encoding="utf-8") as f:
        f.write(pre + json.dumps(meta, ensure_ascii=False, separators=(",", ":")) + ";\n")
    # Relief (Schummerung): Raster in lokalen Metern, 10 m je Bildpunkt, Licht aus Nordwest
    from PIL import Image
    X0, Z0 = cells["x0"], cells["z0"]
    W, H = cells["nx"] * cells["cell"], cells["nz"] * cells["cell"]
    step = 10.0
    nx, nz = int(W / step), int(H / step)
    xs = X0 + (np.arange(nx) + 0.5) * step
    zs = Z0 + (np.arange(nz) + 0.5) * step
    gx, gz = np.meshgrid(xs, zs)
    g = D.at(gx, gz)
    nod = ~np.isfinite(g)
    fill = np.nanmean(g)
    g = np.where(nod, fill, g)
    dzdx = np.gradient(g, step, axis=1)
    dzdz = np.gradient(g, step, axis=0)  # z wächst nach Süden
    az, alt = math.radians(315.0), math.radians(40.0)  # Nordwest; Azimut im Uhrzeigersinn von Norden
    # Licht kommt aus Nordwesten: Richtung zur Lichtquelle in x (Ost) und z (Süd): x = -sin(45 Grad), z = -cos(45 Grad)
    lx, lz = math.sin(az), -math.cos(az)
    # Normale n = (-k*dzdx, 1, -k*dzdz) mit k = Überhöhung; Licht l = (cos(alt)*lx, sin(alt), cos(alt)*lz) (x Ost, y oben, z Süd)
    kx, kz = -UEBERHOEHUNG * dzdx, -UEBERHOEHUNG * dzdz
    nrm = np.sqrt(kx * kx + 1 + kz * kz)
    hill = (kx * math.cos(alt) * lx + math.sin(alt) + kz * math.cos(alt) * lz) / nrm
    base = math.sin(alt)  # ebene Fläche
    d = np.clip((hill - base) * 2.2, -1, 1)
    alpha = np.where(nod, 0, np.abs(d) * 150).astype(np.uint8)
    col = np.where(d >= 0, 255, 0).astype(np.uint8)
    rgba = np.dstack([col, col, col, alpha])
    Image.fromarray(rgba, "RGBA").save(os.path.join(IMG, "relief.png"), optimize=True)
    print("Gelaende: %d Gebaeude, %d Orte/Haltestellen/Ortsteile mit Hoehe, relief.png %d x %d, Hoehe %.0f bis %.0f m ueber NHN" % (n_b, n_m, nx, nz, float(np.nanmin(D.a)), float(np.nanmax(D.a))))
    return n_b


if __name__ == "__main__":
    run()
