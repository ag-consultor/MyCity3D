"""Baut index.html, karte.html und data/ort.js aus vorlage/ und ort.json.

Aufruf: python scripts/baue_seiten.py
Die Seiten in site/ werden bei jedem Lauf neu erzeugt. Nicht von Hand in site/index.html oder
site/karte.html aendern, sondern in vorlage/ oder in ort.json.
"""
import html
import json
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from geo import LAT0, LON0, ORT, ROOT  # noqa: E402

sys.stdout.reconfigure(encoding="utf-8")


def grad(v, pos, neg):
    return ("%.2f" % abs(v)).replace(".", ",") + "° " + (pos if v >= 0 else neg)


def werte():
    nb = ORT.get("nachbarort")
    fp = ORT["fahrplan"]
    art = ORT.get("art", "Gemeinde")
    return {
        "NAME": ORT["name"],
        "ART": art,
        "UNTERTITEL": ORT.get("untertitel", "Karte der " + art),
        "BESCHREIBUNG": ORT.get("kurzbeschreibung", ""),
        "KOORD": grad(LAT0, "N", "S") + " · " + grad(LON0, "O", "W"),
        "NB_NAME": nb["name"] if nb else "Nachbarort",
        "BETREIBER": fp["betreiber"],
        "BETREIBER_KURZ": fp.get("betreiber_kurz", fp["betreiber"]),
        "FAHRPLAN_LIZENZ": fp["lizenz"],
    }


def ort_js():
    nb = ORT.get("nachbarort")
    fp = ORT["fahrplan"]
    v = ORT.get("veroeffentlichung", {})
    o = {
        "name": ORT["name"], "art": ORT.get("art", "Gemeinde"), "land": ORT["land"]["name"],
        "nb": nb["name"] if nb else None,
        "wetter": [ORT["geo"]["wetter_lat"], ORT["geo"]["wetter_lon"]],
        "umgrenzung": ORT["geo"]["umgrenzung_sued_west_nord_ost"],
        "ortsteileSeite": ORT.get("ortsteile_seite", ""),
        "betreiber": fp["betreiber"], "betreiberKurz": fp.get("betreiber_kurz", fp["betreiber"]),
        "lizenz": fp["lizenz"], "lizenzUrl": fp.get("lizenz_url", ""),
        "liveHosts": [] if fp.get("live_aus") else fp.get("live_hosts", []),
        "impressum": v.get("impressum_url", ""), "datenschutz": v.get("datenschutz_url", ""),
    }
    return "window.ORT = " + json.dumps(o, ensure_ascii=False) + ";\n"


def main():
    w = werte()
    vor = os.path.join(ROOT, "vorlage")
    site = os.path.join(ROOT, "site")
    for name in ("index.html", "karte.html"):
        s = open(os.path.join(vor, name), encoding="utf-8").read()
        s = re.sub(r"\{\{([A-Z_]+)\}\}", lambda m: html.escape(w[m.group(1)], quote=True), s)
        rest = re.findall(r"\{\{[A-Z_]+\}\}", s)
        if rest:
            sys.exit("Unersetzte Platzhalter in %s: %s" % (name, rest))
        open(os.path.join(site, name), "w", encoding="utf-8", newline="\n").write(s)
        print("geschrieben:", name)
    os.makedirs(os.path.join(site, "data"), exist_ok=True)
    open(os.path.join(site, "data", "ort.js"), "w", encoding="utf-8", newline="\n").write(ort_js())
    print("geschrieben: data/ort.js")
    ev = os.path.join(site, "data", "events_auto.js")  # Platzhalter, solange kein Termin-Abruf eingerichtet ist
    if not os.path.exists(ev):
        open(ev, "w", encoding="utf-8", newline="\n").write('window.AL_EVENTS_AUTO={"stand":null,"quellen":[],"items":[]};\n')
        print("geschrieben: data/events_auto.js (leer)")


if __name__ == "__main__":
    main()
