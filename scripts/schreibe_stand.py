"""Schreibt site/data/stand.js: wann welche Daten zuletzt aktualisiert wurden (fuer Startseite und Fusszeile der Karte).

Aufruf: python3 scripts/schreibe_stand.py      (laeuft im Wochenlauf nach dem Neubau der Seitendaten und vor dem Veroeffentlichen)
Alle Angaben stammen aus den fertigen Datendateien in site/data, nichts davon wird geschaetzt.
Gebaeude und Adressen (LGB) werden nicht woechentlich geholt: als Stand gilt das Abrufdatum der Rohdateien in data/raw.
"""
import datetime as dt, glob, json, os, re, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SITE = os.path.join(ROOT, "site", "data")
sys.stdout.reconfigure(encoding="utf-8")


def js(path, var):
    s = open(path, encoding="utf-8").read()
    m = re.search(re.escape(var) + r"=(.*?);\s*$", s, re.S)
    return json.loads(m.group(1))


def lgb_abruf():
    dat = []
    for dp, _, fs in os.walk(os.path.join(ROOT, "data", "raw")):  # auch Unterordner (lod2/, addr/ bei neuem Abruf)
        for fn in fs:
            f = os.path.join(dp, fn)
            if re.search(r"lod2|alkis_buildings|addr", f.lower()) and not re.search(r"test|cap_", fn.lower()):
                dat.append(dt.date.fromtimestamp(os.path.getmtime(f)))
    return max(dat).isoformat() if dat else None


def main():
    meta = js(os.path.join(SITE, "meta.js"), "window.AL_TILES={};window.AL_META")
    news = js(os.path.join(SITE, "news.js"), "window.AL_NEWS")
    fp = js(os.path.join(SITE, "fahrplan.js"), "window.AL_FAHRPLAN")
    ev = js(os.path.join(SITE, "events_auto.js"), "window.AL_EVENTS_AUTO")
    brw = js(os.path.join(SITE, "brw.js"), "window.AL_BRW")
    iso = lambda s: "%s-%s-%s" % (s[:4], s[4:6], s[6:8])
    out = {
        "lauf": news["stand"],
        "osm": news["stand"],  # Orte und Haltestellen werden im Wochenlauf frisch aus OpenStreetMap gelesen
        "fahrplan": {"stand": fp["stand"], "von": iso(fp["feedFrom"]), "bis": iso(fp["feedTo"])},
        "termine": {"stand": ev.get("stand"), "anzahl": len(ev.get("items", [])), "quelle": ", ".join(ev.get("quellen") or [(ev.get("quelle") or {}).get("name") or ""])},
        "ortsteilInfo": (meta.get("ortsteilInfo") or {}).get("gelesen"),
        "brw": brw.get("stichtag"),
        "lgb": lgb_abruf(),
        "adressen": meta["nAddr"], "gebaeude": meta["nBuildings"], "orte": sum(1 for p in meta["pois"] if not p.get("nb")), "haltestellen": sum(1 for s in meta["stops"] if not s.get("nb")),
        "orteNb": sum(1 for p in meta["pois"] if p.get("nb")),
        "neu": len(news.get("items", [])),
    }
    with open(os.path.join(SITE, "stand.js"), "w", encoding="utf-8") as f:
        f.write("window.AL_STAND=" + json.dumps(out, ensure_ascii=False, separators=(",", ":")) + ";\n")
    print("stand.js:", json.dumps(out, ensure_ascii=False))


if __name__ == "__main__":
    main()
