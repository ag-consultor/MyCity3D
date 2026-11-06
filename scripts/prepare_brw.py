"""Bereitet die Bodenrichtwerte (BORIS Brandenburg) der Gemeinde fuer die Seite auf.

Eingabe : data/raw/boris/werte_<stichtag>.gml, zonen_<stichtag>.gml  (scripts/fetch_boris.py)
Ausgabe : site/data/brw.js  window.AL_BRW

Schluessel (Nutzung, Entwicklungszustand) stammen aus den Codelisten der AdV (registry.gdi-de.org),
am 01.11.2026 abgerufen. Werte sind Euro je Quadratmeter Grundstuecksflaeche.
Die Zonen "Acker", "Gruenland", "Forst" gelten gemeindeweit und sind keine Ortszonen.
"""
import json, math, os, re, sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from geo import pip, simplify, utm33_to_latlon, xz  # noqa: E402
from prepare_gemeinde import OT, ot_of  # noqa: E402  (laedt Grenze und Ortsteile)

ROOT = os.path.dirname(HERE)
STICHTAG = sys.argv[1] if len(sys.argv) > 1 else "2026-01-01"
RAW = os.path.join(ROOT, "data", "raw", "boris")
OUT = os.path.join(ROOT, "site", "data", "brw.js")
sys.stdout.reconfigure(encoding="utf-8")

ART = {"1100": "Wohnbaufläche (W)", "1200": "gemischte Baufläche (M)", "1300": "gewerbliche Baufläche (G)", "1400": "Sonderbaufläche (S)",
       "1500": "Baufläche für Gemeinbedarf (GB)", "2000": "landwirtschaftliche Fläche (L)", "2100": "Acker (A)", "2200": "Grünland (GR)",
       "2800": "forstwirtschaftliche Fläche (F)", "3090": "Flughafen, Flugplätze usw. (FP)"}
EZ = {"1000": "baureifes Land (B)", "2000": "Rohbauland (R)", "3000": "Bauerwartungsland (E)", "4000": "Fläche der Land- und Forstwirtschaft (LF)", "5000": "Sonstige Fläche (SF)"}


def tag(b, t):
    m = re.search(r"<br:%s>([^<]*)</br:%s>" % (t, t), b)
    return m.group(1) if m else None


def ring_xz(text):
    v = [float(t) for t in text.split()]
    out = []
    for e, n in zip(v[0::2], v[1::2]):
        lat, lon = utm33_to_latlon(e, n)
        out.append(xz(lat, lon))
    return out


def area(r):
    return abs(sum(r[i][0] * r[(i + 1) % len(r)][1] - r[(i + 1) % len(r)][0] * r[i][1] for i in range(len(r)))) / 2


def label_point(r):
    xs, zs = [p[0] for p in r], [p[1] for p in r]
    best, bp = -1.0, (sum(xs) / len(xs), sum(zs) / len(zs))
    n = len(r)
    for i in range(14):
        for j in range(14):
            px = min(xs) + (max(xs) - min(xs)) * (i + 0.5) / 14
            pz = min(zs) + (max(zs) - min(zs)) * (j + 0.5) / 14
            if not pip(px, pz, r):
                continue
            d = min(abs((r[(k + 1) % n][1] - r[k][1]) * px - (r[(k + 1) % n][0] - r[k][0]) * pz + r[(k + 1) % n][0] * r[k][1] - r[(k + 1) % n][1] * r[k][0])
                    / (math.hypot(r[(k + 1) % n][0] - r[k][0], r[(k + 1) % n][1] - r[k][1]) or 1) for k in range(0, n, max(1, n // 120)))
            if d > best:
                best, bp = d, (px, pz)
    return bp


def flat(pts, nd=1):
    return [round(c, nd) for p in pts for c in p]


def main():
    w = open(os.path.join(RAW, "werte_%s.gml" % STICHTAG), encoding="utf-8").read()
    z = open(os.path.join(RAW, "zonen_%s.gml" % STICHTAG), encoding="utf-8").read()
    geo = {}
    for m in re.finditer(r'<br:BR_BodenrichtwertFlaeche gml:id="(\w+)".*?</br:BR_BodenrichtwertFlaeche>', z, re.S):
        polys = re.findall(r"<gml:Polygon .*?</gml:Polygon>", m.group(0), re.S)
        rings = []
        for p in polys:
            ext = re.search(r"<gml:exterior>.*?<gml:posList[^>]*>([^<]+)", p, re.S)
            holes = re.findall(r"<gml:interior>.*?<gml:posList[^>]*>([^<]+)", p, re.S)
            rings.append((ring_xz(ext.group(1)), [ring_xz(h) for h in holes]))
        geo[m.group(1)] = rings
    zones, land = [], {}
    for b in re.findall(r"<br:BR_Bodenrichtwert gml:id=.*?</br:BR_Bodenrichtwert>", w, re.S):
        ref = re.search(r'oid:(\w+)"', b).group(1)
        art = re.search(r"BR_Art_Nutzung/(\d+)", b).group(1)
        rec = {"n": tag(b, "bodenrichtwertzoneName"), "w": float(tag(b, "bodenrichtwert")), "art": art, "artDe": ART.get(art, "Schlüssel " + art),
               "ez": EZ.get(tag(b, "entwicklungszustand"), "Schlüssel " + str(tag(b, "entwicklungszustand"))), "nr": tag(b, "bodenrichtwertNummer"),
               "ot": tag(b, "ortsteilName"), "stichtag": tag(b, "stichtag")}
        for k, f in (("az", "ackerzahl"), ("gz", "gruenlandzahl"), ("vg", "vollgeschosszahl"), ("fl", "flaeche")):
            if tag(b, f):
                rec[k] = float(tag(b, f)) if "." in tag(b, f) else int(tag(b, f))
        rings = geo[ref]
        if art in ("2100", "2200", "2800"):  # gemeindeweite Zonen: nur Wert, keine Flaeche zeichnen
            land[{"2100": "acker", "2200": "gruen", "2800": "forst"}[art]] = rec
            continue
        outer = max((r for r, _ in rings), key=area)
        holes = [h for _, hs in rings for h in hs]
        rec["ha"] = round((area(outer) - sum(area(h) for h in holes)) / 1e4, 1)
        if holes:  # Aussenbereich-Zone: keine Polygone, gilt ausserhalb der Ortszonen
            rec["aussen"] = True
            zones.append(rec)
            continue
        outer = simplify(outer, 2.0)
        lp = label_point(outer)
        rec["ring"] = flat(outer)
        rec["c"] = [round(lp[0], 1), round(lp[1], 1)]
        rec["o"] = ot_of(lp[0], lp[1])
        zones.append(rec)
    zones.sort(key=lambda r: (r.get("aussen", False), r["ha"]))  # kleine Zonen zuerst, Aussenbereich zuletzt
    out = {"stichtag": STICHTAG, "zones": zones, "land": land,
           "quelle": {"n": "BORIS Brandenburg, WFS des LGB", "by": "© GeoBasis-DE/LGB, dl-de/by-2-0 (Daten geändert)", "url": "https://isk.geobasis-bb.de/ows/boris_wfs?REQUEST=GetCapabilities&SERVICE=WFS"}}
    with open(OUT, "w", encoding="utf-8") as f:
        f.write("window.AL_BRW=" + json.dumps(out, ensure_ascii=False, separators=(",", ":")) + ";\n")
    print("geschrieben:", OUT, round(os.path.getsize(OUT) / 1e3, 1), "KB")
    for r in zones:
        print("  %-34s %6.1f EUR/m²  %-26s %6.1f ha  %s" % (r["n"][:34], r["w"], r["artDe"], r["ha"], OT[r["o"]]["n"] if r.get("o", -1) >= 0 else ("Außenbereich" if r.get("aussen") else "?")))
    print("gemeindeweit:", {k: (v["w"], v.get("az") or v.get("gz")) for k, v in land.items()})


if __name__ == "__main__":
    main()
