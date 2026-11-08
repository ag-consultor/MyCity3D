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
        "CSP": csp(),
        "BETREIBER": fp["betreiber"],
        "BETREIBER_KURZ": fp.get("betreiber_kurz", fp["betreiber"]),
        "FAHRPLAN_LIZENZ": fp["lizenz"],
    }


def bausteine():
    """Optionale Bausteine aus ort.json (Abschnitt "bausteine"); fehlt der Abschnitt, sind alle aus."""
    b = ORT.get("bausteine") or {}
    m = b.get("muellabfuhr")
    return {"baustellen": bool(b.get("baustellen")), "gelaende": bool(b.get("gelaende")), "muell": m if (m and m.get("url")) else None}


def csp():
    """Inhaltsrichtlinie (Content-Security-Policy) als meta-Tag: nur eigene Dateien, Verbindungen nur zu den Diensten, die ort.json einschaltet."""
    fp = ORT["fahrplan"]
    b = bausteine()
    connect = ["'self'", "https://api.brightsky.dev", "https://air-quality-api.open-meteo.com"]
    if b["baustellen"]:
        connect.append("https://isk.geobasis-bb.de")
    if not fp.get("live_aus"):
        connect += fp.get("live_hosts", [])
    s = ("default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src "
         + " ".join(connect))
    if b["muell"]:
        m = re.match(r"(https?://[^/]+)", b["muell"]["url"])
        if m:
            s += "; frame-src " + m.group(1)
    return s + "; object-src 'none'; base-uri 'self'; form-action 'self'"


def ort_js():
    nb = ORT.get("nachbarort")
    fp = ORT["fahrplan"]
    v = ORT.get("veroeffentlichung", {})
    b = bausteine()
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
        "baustellen": b["baustellen"], "gelaende": b["gelaende"], "muell": b["muell"],
        "solarKwh": (ORT.get("bausteine") or {}).get("solar_kwh_je_kwp"), "betreiberKuerzel": fp.get("betreiber_kuerzel", {}),
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
