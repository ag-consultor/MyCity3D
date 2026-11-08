"""Gemeinsame Geometrie-Helfer (nur Standardbibliothek).

Lokales Koordinatensystem: x = Ost [m], z = -Nord [m], Ursprung LAT0/LON0.
Die Abbildung ist linear in Grad. Ein Kachelrechteck in Metern entspricht deshalb genau
einem Breiten-/Laengen-Rechteck (wichtig fuer die Luftbild-Abrufe).
"""
import math

import json
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def lade_ort():
    """Liest ort.json aus dem Projektordner (einzige Stelle mit Ortsangaben)."""
    with open(os.path.join(ROOT, "ort.json"), encoding="utf-8") as f:
        return json.load(f)


ORT = lade_ort()
_G = ORT["geo"]
LAT0, LON0 = _G["lat0"], _G["lon0"]
M_LAT = 111132.0
M_LON = 111320.0 * math.cos(math.radians(LAT0))
CELL = float(_G["kachel_m"])  # Kantenlaenge einer Kachel in Metern
GEMEINDE_RELATION = int(_G["osm_relation"])  # OSM-Relation der Gemeindegrenze
GEMEINDE_SCHLUESSEL = str(_G["gemeindeschluessel"])  # amtlicher Gemeindeschluessel (ARS)
ORT_NAME = ORT["name"]
UMGRENZUNG = tuple(_G["umgrenzung_sued_west_nord_ost"])  # grobe Umgrenzung fuer Abfragen (Sued, West, Nord, Ost)

# Optionaler Nachbarort, schlank mit aufgenommen (Orte, Haltestellen, Gebaeude, Luftbild der Kachel).
# In ort.json "nachbarort": null -> kein Nachbarort; in_nb() liefert dann immer False.
_NB = ORT.get("nachbarort")
NB_NAME = _NB["name"] if _NB else None
NB_BBOX = tuple(_NB["bbox_sued_west_nord_ost"]) if _NB else (0.0, 0.0, 0.0, 0.0)
NB_CENTER = tuple(_NB["mitte_lat_lon"]) if _NB else None


def in_nb(x, z):
    """Liegt der Punkt (lokale Meter) im Rechteck des Nachbarorts?"""
    if not _NB:
        return False
    lat, lon = LAT0 - z / M_LAT, LON0 + x / M_LON
    return NB_BBOX[0] <= lat <= NB_BBOX[2] and NB_BBOX[1] <= lon <= NB_BBOX[3]


def xz(lat, lon):
    return ((lon - LON0) * M_LON, -(lat - LAT0) * M_LAT)


def latlon(x, z):
    return (LAT0 - z / M_LAT, LON0 + x / M_LON)


def utm33_to_latlon(E, N):
    """ETRS89 / UTM 33N (EPSG:25833) -> Breite/Laenge in Grad (Krueger-Reihe, Fehler im mm-Bereich)."""
    a, f, k0 = 6378137.0, 1 / 298.257222101, 0.9996
    n = f / (2 - f)
    A = a / (1 + n) * (1 + n ** 2 / 4 + n ** 4 / 64)
    beta = [n / 2 - 2 * n ** 2 / 3 + 37 * n ** 3 / 96, n ** 2 / 48 + n ** 3 / 15, 17 * n ** 3 / 480]
    delta = [2 * n - 2 * n ** 2 / 3 - 2 * n ** 3, 7 * n ** 2 / 3 - 8 * n ** 3 / 5, 56 * n ** 3 / 15]
    xi = N / (k0 * A)
    eta = (E - 500000.0) / (k0 * A)
    xi_p = xi - sum(beta[j] * math.sin(2 * (j + 1) * xi) * math.cosh(2 * (j + 1) * eta) for j in range(3))
    eta_p = eta - sum(beta[j] * math.cos(2 * (j + 1) * xi) * math.sinh(2 * (j + 1) * eta) for j in range(3))
    chi = math.asin(math.sin(xi_p) / math.cosh(eta_p))
    lat = chi + sum(delta[j] * math.sin(2 * (j + 1) * chi) for j in range(3))
    lon = math.radians(15.0) + math.atan2(math.sinh(eta_p), math.cos(xi_p))
    return math.degrees(lat), math.degrees(lon)


def latlon_to_utm33(lat, lon):
    """Breite/Laenge in Grad -> ETRS89 / UTM 33N (EPSG:25833), Krueger-Reihe (Gegenstueck zu utm33_to_latlon)."""
    a, f, k0 = 6378137.0, 1 / 298.257222101, 0.9996
    n = f / (2 - f)
    A = a / (1 + n) * (1 + n ** 2 / 4 + n ** 4 / 64)
    alpha = [n / 2 - 2 * n ** 2 / 3 + 5 * n ** 3 / 16, 13 * n ** 2 / 48 - 3 * n ** 3 / 5, 61 * n ** 3 / 240]
    phi, dl = math.radians(lat), math.radians(lon - 15.0)
    q = 2 * math.sqrt(n) / (1 + n)
    t = math.sinh(math.atanh(math.sin(phi)) - q * math.atanh(q * math.sin(phi)))
    xi_p = math.atan2(t, math.cos(dl))
    eta_p = math.atanh(math.sin(dl) / math.sqrt(1 + t * t))
    xi = xi_p + sum(alpha[j] * math.sin(2 * (j + 1) * xi_p) * math.cosh(2 * (j + 1) * eta_p) for j in range(3))
    eta = eta_p + sum(alpha[j] * math.cos(2 * (j + 1) * xi_p) * math.sinh(2 * (j + 1) * eta_p) for j in range(3))
    return 500000.0 + k0 * A * eta, k0 * A * xi


def pip(x, z, ring):
    """Punkt-in-Polygon (Strahlverfahren); ring = [(x,z),...]."""
    c = False
    j = len(ring) - 1
    for i in range(len(ring)):
        xi, zi = ring[i]
        xj, zj = ring[j]
        if (zi > z) != (zj > z) and x < (xj - xi) * (z - zi) / (zj - zi) + xi:
            c = not c
        j = i
    return c


def stitch(parts):
    """Setzt Linienstuecke (Listen von (a,b)-Punkten) an gleichen Endpunkten zu Ringen zusammen."""
    parts = [list(p) for p in parts if len(p) >= 2]
    rings = []
    while parts:
        cur = parts.pop(0)
        grown = True
        while grown and cur[0] != cur[-1]:
            grown = False
            for k, p in enumerate(parts):
                if p[0] == cur[-1]:
                    cur += p[1:]
                elif p[-1] == cur[-1]:
                    cur += p[::-1][1:]
                elif p[-1] == cur[0]:
                    cur = p[:-1] + cur
                elif p[0] == cur[0]:
                    cur = p[::-1][:-1] + cur
                else:
                    continue
                parts.pop(k)
                grown = True
                break
        if len(cur) >= 4 and cur[0] == cur[-1]:
            rings.append(cur)
    return rings


def simplify(pts, tol):
    """Douglas-Peucker (iterativ) fuer Punktlisten [(x,z),...].

    Geschlossene Ringe (Anfang gleich Ende) werden am weitesten Punkt geteilt und je Haelfte
    vereinfacht. Sonst ist die Grundlinie Anfang-Ende ein Punkt, alle Abstaende werden 0 und
    vom ganzen Ring bleiben zwei Punkte uebrig."""
    if len(pts) < 3:
        return pts
    if pts[0] == pts[-1] and len(pts) > 3:
        k = max(range(1, len(pts) - 1), key=lambda i: (pts[i][0] - pts[0][0]) ** 2 + (pts[i][1] - pts[0][1]) ** 2)
        return simplify(pts[:k + 1], tol)[:-1] + simplify(pts[k:], tol)
    keep = [False] * len(pts)
    keep[0] = keep[-1] = True
    stack = [(0, len(pts) - 1)]
    while stack:
        s, e = stack.pop()
        (x1, z1), (x2, z2) = pts[s], pts[e]
        dx, dz = x2 - x1, z2 - z1
        dd = math.hypot(dx, dz) or 1e-9
        best, bi = 0.0, -1
        for i in range(s + 1, e):
            d = abs(dz * (pts[i][0] - x1) - dx * (pts[i][1] - z1)) / dd
            if d > best:
                best, bi = d, i
        if best > tol and bi > 0:
            keep[bi] = True
            stack += [(s, bi), (bi, e)]
    return [p for p, k in zip(pts, keep) if k]
