"""Bodenrichtwerte (BORIS Brandenburg, WFS des LGB, dl-de/by-2.0) fuer die Gemeinde aus ort.json.

Aufruf: python3 scripts/fetch_boris.py [stichtag]      (Standard: 2026-01-01)
Ablauf: 1. Werte (BR_Bodenrichtwert) fuer Stichtag + Gemeindeschluessel (Kreis 72, Gemeinde 297)
        2. Zonen (BR_BodenrichtwertFlaeche) genau zu den gehoertZu-Kennungen dieser Werte
Die Werttabelle hat keine Geometrie; die Zone wird ueber `gehoertZu` zugeordnet.
Ausgabe: data/raw/boris/werte_<stichtag>.gml und zonen_<stichtag>.gml
"""
import os, re, sys, urllib.parse, urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "data", "raw", "boris")
WFS = "https://isk.geobasis-bb.de/ows/boris_wfs"
NS = 'xmlns:fes="http://www.opengis.net/fes/2.0" xmlns:br="http://www.adv-online.de/namespaces/adv/br/3.0" xmlns:adv="http://www.adv-online.de/namespaces/adv/gid/7.1"'
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from geo import GEMEINDE_SCHLUESSEL  # noqa: E402
KREIS, GEMEINDE = GEMEINDE_SCHLUESSEL[2:5].lstrip("0"), GEMEINDE_SCHLUESSEL[5:8]  # z. B. 12072297 = Land 12, Kreis 072, Gemeinde 297
sys.stdout.reconfigure(encoding="utf-8")


def get(params):
    req = urllib.request.Request(WFS + "?" + urllib.parse.urlencode(params), headers={"User-Agent": "GemeindeKarte-Prototyp/0.3"})
    with urllib.request.urlopen(req, timeout=300) as r:
        return r.read()


def eq(path, val):
    return "<fes:PropertyIsEqualTo><fes:ValueReference>%s</fes:ValueReference><fes:Literal>%s</fes:Literal></fes:PropertyIsEqualTo>" % (path, val)


def main(stichtag):
    os.makedirs(OUT, exist_ok=True)
    g = "br:gemeinde/adv:AX_Gemeindekennzeichen/adv:"
    flt = "<fes:Filter %s><fes:And>%s%s%s</fes:And></fes:Filter>" % (NS, eq("br:stichtag", stichtag), eq(g + "kreis", KREIS), eq(g + "gemeinde", GEMEINDE))
    base = {"SERVICE": "WFS", "VERSION": "2.0.0", "REQUEST": "GetFeature"}
    werte = get(dict(base, TYPENAMES="br:BR_Bodenrichtwert", FILTER=flt, COUNT="5000"))
    p = os.path.join(OUT, "werte_%s.gml" % stichtag)
    open(p, "wb").write(werte)
    txt = werte.decode("utf-8", "ignore")
    if "ExceptionReport" in txt[:600]:
        sys.exit("Fehler vom Dienst: " + re.sub(r"\s+", " ", txt)[:500])
    ids = sorted(set(re.findall(r'<br:gehoertZu xlink:href="urn:adv:oid:(\w+)"', txt)))
    n = len(re.findall(r"<br:BR_Bodenrichtwert gml:id", txt))
    print("Werte:", n, "Zonen-Kennungen:", len(ids), "->", p)
    parts = []
    for k in range(0, len(ids), 40):
        blob = get(dict(base, TYPENAMES="br:BR_BodenrichtwertFlaeche", RESOURCEID=",".join(ids[k:k + 40]))).decode("utf-8", "ignore")
        if "ExceptionReport" in blob[:600]:
            sys.exit("Fehler bei Zonen: " + re.sub(r"\s+", " ", blob)[:400])
        parts.append(blob)
    open(os.path.join(OUT, "zonen_%s.gml" % stichtag), "w", encoding="utf-8").write("\n".join(parts))
    print("Zonen geladen:", sum(len(re.findall(r"<br:BR_BodenrichtwertFlaeche gml:id", b)) for b in parts))


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "2026-01-01")
