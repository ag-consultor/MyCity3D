"""Wochenlauf: Daten aktualisieren und "Neues seit letzter Woche" bestimmen.

Aufruf:  python3 scripts/update_weekly.py [--skip-osm] [--skip-gtfs] [--no-state]
Schritte: 1. OSM live (Orte, Haltestellen)   fetch_live.py
          2. VBB-Fahrplan laden und filtern  prepare_fahrplan.py   (CC BY 4.0, ca. 65 MB)
          3. Seitendaten neu bauen           prepare_gemeinde.py
          4. Vergleich mit data/state/state.json -> site/data/news.js, Zustand fortschreiben
Veroeffentlichen ist ein eigener Schritt (docs/VEROEFFENTLICHEN.md).
Nicht woechentlich: Gebaeude und Adressen (LGB, vierteljaehrlich: fetch.py lod2 addr), Bodenrichtwerte (jaehrlich).
"""
import datetime as dt, json, os, re, subprocess, sys, urllib.request, zipfile

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, HERE)
sys.stdout.reconfigure(encoding="utf-8")

SITE = os.path.join(ROOT, "site")
STATE = os.path.join(ROOT, "data", "state", "state.json")
GTFS = os.path.join(ROOT, "data", "raw", "vbb", "gtfs.zip")
from geo import ORT  # noqa: E402
GTFS_URL = ORT["fahrplan"]["gtfs_url"]
KEEP_DAYS = 28
TYPE_DE = {"restaurant": "Restaurant", "cafe": "Café", "fast_food": "Imbiss", "fuel": "Tankstelle", "hairdresser": "Friseur",
           "convenience": "Lebensmittelladen", "farm": "Hofladen", "kindergarten": "Kindergarten", "school": "Schule", "pharmacy": "Apotheke",
           "doctors": "Arztpraxis", "arts_centre": "Kulturzentrum", "community_centre": "Gemeindezentrum", "driver_training": "Fahrtraining"}


def log(*a):
    print(dt.datetime.now().strftime("%H:%M:%S"), *a, flush=True)


def run(script, must=True):
    log("Schritt:", script)
    r = subprocess.run([sys.executable, os.path.join(HERE, script)], cwd=ROOT)
    if r.returncode:
        if must:
            sys.exit("Abbruch: %s endete mit Code %d" % (script, r.returncode))
        log("WARNUNG: %s endete mit Code %d, der bisherige Stand bleibt erhalten." % (script, r.returncode))


def load_js(path, var):
    s = open(path, encoding="utf-8").read()
    m = re.search(r"%s=(.*);\s*$" % re.escape(var), s, re.S)
    return json.loads(m.group(1))


def download_gtfs():
    log("VBB-Fahrplan laden:", GTFS_URL)
    os.makedirs(os.path.dirname(GTFS), exist_ok=True)
    tmp = GTFS + ".part"
    req = urllib.request.Request(GTFS_URL, headers={"User-Agent": "GemeindeKarte-Prototyp/0.4"})
    with urllib.request.urlopen(req, timeout=280) as r, open(tmp, "wb") as f:
        while True:
            b = r.read(1 << 20)
            if not b:
                break
            f.write(b)
    if os.path.getsize(tmp) < 10e6 or not zipfile.is_zipfile(tmp):
        os.remove(tmp)
        sys.exit("Fahrplan-Download unbrauchbar (zu klein oder kein ZIP), alter Stand bleibt erhalten.")
    os.replace(tmp, GTFS)
    log("Fahrplan: %.1f MB" % (os.path.getsize(GTFS) / 1e6))


def event_ids():
    """Echte (nicht Beispiel-) Veranstaltungen aus events.js: {id: titel}."""
    s = open(os.path.join(SITE, "events.js"), encoding="utf-8").read()
    out = {}
    for blk in re.findall(r"\{[^{}]*\}", s):
        i, t = re.search(r"id:\s*'([^']+)'", blk), re.search(r"title:\s*'([^']+)'", blk)
        if i and t and not re.search(r"dummy:\s*true", blk):
            out[i.group(1)] = t.group(1)
    auto = os.path.join(SITE, "data", "events_auto.js")  # automatisch gelesene Termine (fetch_events.py)
    if os.path.exists(auto):
        for e in load_js(auto, "window.AL_EVENTS_AUTO")["items"]:
            out[e["id"]] = e["title"]
    return out


def snapshot():
    meta = load_js(os.path.join(SITE, "data", "meta.js"), "window.AL_TILES={};window.AL_META")
    fp = load_js(os.path.join(SITE, "data", "fahrplan.js"), "window.AL_FAHRPLAN")
    ot = [o["n"] for o in meta["ortsteile"]]
    pois = {p["osm"]: {"n": p["n"], "t": p["t"], "oh": p.get("oh"), "web": p.get("web"), "x": p["x"], "z": p["z"],
                       "o": ot[p["o"]] if p.get("o", -1) >= 0 else ""} for p in meta["pois"] if not p.get("nb")}  # Nachbarort: keine Neuigkeiten
    stops = {"%s|%s" % (s["k"], s["n"]): {"x": s["x"], "z": s["z"]} for s in meta["stops"] if not s.get("nb")}
    return {"pois": pois, "stops": stops, "events": event_ids(), "nAddr": meta["nAddr"], "nBuildings": meta["nBuildings"],
            "feed": {"from": fp["feedFrom"], "to": fp["feedTo"], "stand": fp["stand"], "lines": sorted({r[0] for r in fp["routes"]})}}


def diff(old, new, today):
    items = []

    def add(kind, key, title, sub="", x=None, z=None, ref=None):
        it = {"id": kind + ":" + key, "date": today, "kind": kind, "title": title, "sub": sub}
        if x is not None:
            it["x"], it["z"] = x, z
        if ref:
            it["ref"] = ref
        items.append(it)

    for k, p in new["pois"].items():
        o = old["pois"].get(k)
        sub = ", ".join(filter(None, [TYPE_DE.get(p["t"], p["t"].replace("_", " ")), p["o"]]))
        if not o:
            add("poi_new", k, "Neuer Ort: " + p["n"], sub, p["x"], p["z"], {"poi": k})
            continue
        if o["oh"] != p["oh"]:
            add("poi_oh", k + "|" + str(p["oh"]), "Öffnungszeiten geändert: " + p["n"], "vorher: %s, jetzt: %s" % (o["oh"] or "keine Angabe", p["oh"] or "keine Angabe"), p["x"], p["z"], {"poi": k})
        if o["web"] != p["web"]:
            add("poi_web", k + "|" + str(p["web"]), "Webseite geändert: " + p["n"], p["web"] or "entfernt", p["x"], p["z"], {"poi": k})
    for k, o in old["pois"].items():
        if k not in new["pois"]:
            add("poi_gone", k, "Nicht mehr in OpenStreetMap: " + o["n"], ", ".join(filter(None, [TYPE_DE.get(o["t"], o["t"]), o["o"]])), o["x"], o["z"])
    for k, s in new["stops"].items():
        if k not in old["stops"]:
            add("stop_new", k, "Neue Haltestelle: " + k.split("|", 1)[1], "Bus" if k.startswith("bus") else "Bahn", s["x"], s["z"])
    for k, s in old["stops"].items():
        if k not in new["stops"]:
            add("stop_gone", k, "Haltestelle nicht mehr in OpenStreetMap: " + k.split("|", 1)[1], "", s["x"], s["z"])
    fo, fn = old["feed"], new["feed"]
    if (fo["from"], fo["to"]) != (fn["from"], fn["to"]):
        d = lambda s: s[6:8] + "." + s[4:6] + "." + s[:4]
        add("feed", fn["from"] + "-" + fn["to"], "Neuer VBB-Fahrplan", "gültig %s bis %s" % (d(fn["from"]), d(fn["to"])))
    for ln in sorted(set(fn["lines"]) - set(fo["lines"])):
        add("line_new", ln, "Neue Linie im Fahrplan: " + ln)
    for ln in sorted(set(fo["lines"]) - set(fn["lines"])):
        add("line_gone", ln, "Linie nicht mehr im Fahrplan: " + ln)
    for k, t in new["events"].items():
        if k not in old["events"]:
            add("event_new", k, "Neue Veranstaltung: " + t, "", None, None, {"event": k})
    if new["nAddr"] != old["nAddr"]:
        add("addr", str(new["nAddr"]), "Adressen: %d (vorher %d)" % (new["nAddr"], old["nAddr"]))
    if new["nBuildings"] != old["nBuildings"]:
        add("bld", str(new["nBuildings"]), "Gebäude im 3D-Modell: %d (vorher %d)" % (new["nBuildings"], old["nBuildings"]))
    return items


def main():
    a = set(sys.argv[1:])
    today = dt.date.today().isoformat()
    if "--skip-osm" not in a:
        run("fetch_live.py")
    if "--skip-gtfs" not in a:
        download_gtfs()
        run("prepare_fahrplan.py")
    run("prepare_gemeinde.py")

    new = snapshot()
    old = json.load(open(STATE, encoding="utf-8")) if os.path.exists(STATE) and "--no-state" not in a else None
    history = (old or {}).get("news", [])
    cutoff = (dt.date.today() - dt.timedelta(days=KEEP_DAYS)).isoformat()
    history = [h for h in history if h["date"] >= cutoff]
    have = {h["id"] for h in history}
    fresh = [i for i in (diff(old, new, today) if old else []) if i["id"] not in have]
    news = fresh + history
    news.sort(key=lambda h: h["date"], reverse=True)
    out = {"stand": today, "since": (old or {}).get("updated"), "first": old is None, "keepDays": KEEP_DAYS, "items": news}
    with open(os.path.join(SITE, "data", "news.js"), "w", encoding="utf-8") as f:
        f.write("window.AL_NEWS=" + json.dumps(out, ensure_ascii=False, separators=(",", ":")) + ";\n")
    run("baue_seiten.py")  # index.html, karte.html und data/ort.js aus vorlage/ und ort.json
    run("schreibe_stand.py")  # Aktualisierungsstand fuer Startseite und Karte (data/stand.js)
    run("versionieren.py")  # Zwischenspeicher: Adressen aller Skripte/Stilblaetter bekommen eine Kennung aus dem Dateiinhalt
    new["updated"], new["news"] = today, news
    os.makedirs(os.path.dirname(STATE), exist_ok=True)
    with open(STATE, "w", encoding="utf-8") as f:
        json.dump(new, f, ensure_ascii=False, indent=1)
    log("Neuigkeiten: %d neu, %d aus den letzten %d Tagen%s" % (len(fresh), len(history), KEEP_DAYS, " (erster Lauf, nur Ausgangsstand gespeichert)" if old is None else ""))
    for i in fresh:
        print("   +", i["title"], "|", i["sub"])


if __name__ == "__main__":
    main()
