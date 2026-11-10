"""Prueft site/ vor dem Veroeffentlichen. Bricht (Exit 1) bei Fehlern ab, Warnungen blockieren nicht.

Aufruf: python3 scripts/pruefe_veroeffentlichung.py
Fehler:   fehlende Pflichtdateien, ungueltige Impressum-/Datenschutz-Adresse,
          Fahrplan bereits abgelaufen, uebrig gebliebene .part-Dateien
Warnung:  Impressum/Datenschutz nicht eingetragen, Daten aelter als 10 Tage, Fahrplan endet in weniger als 7 Tagen
"""
import datetime as dt, json, os, re, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SITE = os.path.join(ROOT, "site")
sys.stdout.reconfigure(encoding="utf-8")
fehler, warn = [], []


def js_var(path, name):
    s = open(path, encoding="utf-8").read()
    m = re.search(re.escape(name) + r"=(.*?);\s*$", s, re.S)
    return json.loads(m.group(1)) if m else None


# 1. Pflichtdateien
for f in ("index.html", "karte.html", "wetter.js", "wetter.css", "wetter-karte.js", "start_wetter.js", "lage.js", "lage.css", "live-alle.js", "start_lage.js",
          "start.css", "start.js", "fonts.css", "data/stand.js", "data/ort.js", "data/tv.js", "fonts/sora-400.woff2", "style.css", "events.js", "rechtliches.js", "js/app.js", "js/util.js", "js/three.min.js",
          "data/meta.js", "data/addr.js", "data/fahrplan.js", "data/fahrten.js", "data/gleise.js", "data/brw.js", "data/news.js", "data/areas.js", "data/events_auto.js",
          "img/overview.jpg"):
    if not os.path.exists(os.path.join(SITE, f)):
        fehler.append("fehlt: site/" + f)
# Dateien der Bausteine, die ort.json einschaltet (bausteine.*)
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from baue_seiten import optionale_dateien  # noqa: E402
for f in optionale_dateien():
    if not os.path.exists(os.path.join(SITE, f)):
        fehler.append("fehlt (Baustein aus ort.json): site/" + f)
meta = os.path.join(SITE, "data", "meta.js")
if os.path.exists(meta):
    s = open(meta, encoding="utf-8").read()
    cells = json.loads(re.search(r'"cells":(\[\[.*?\]\]),"boundary"', s, re.S).group(1))
    miss = [c for c in cells if not os.path.exists(os.path.join(SITE, "data", "t_%d_%d.js" % (c[0], c[1])))
            or not os.path.exists(os.path.join(SITE, "img", "p_%d_%d.jpg" % (c[0], c[1])))]
    if miss:
        fehler.append("Kacheldaten oder Luftbilder fehlen fuer %d Kacheln, z. B. %s" % (len(miss), miss[:3]))
for dp, _, fs in os.walk(SITE):
    for f in fs:
        if f.endswith(".part"):
            fehler.append("uebrig gebliebene Teildatei: " + os.path.join(dp, f))

# 2. Impressum und Datenschutz: kommen aus ort.json und liegen in der Verantwortung des Betreibers (Warnung, kein Abbruch)
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from geo import ORT  # noqa: E402
vo = ORT.get("veroeffentlichung", {})
for key, fn in (("impressum_url", "Impressum"), ("datenschutz_url", "Datenschutzerklaerung")):
    v = (vo.get(key) or "").strip()
    if not v:
        warn.append("%s nicht eingetragen (ort.json, veroeffentlichung.%s). Wer die Seite betreibt, braucht in Deutschland Impressum und Datenschutzerklaerung." % (fn, key))
    elif not re.match(r"https?://", v):
        fehler.append("ort.json: %s ist keine gueltige https-Adresse: %s" % (key, v))
bau = os.path.join(SITE, "data", "baustellen.json")
if os.path.exists(bau) and json.load(open(bau, encoding="utf-8")).get("test"):
    fehler.append("site/data/baustellen.json enthaelt Testdaten. Loeschen oder mit echtem Zugang neu abrufen (scripts/fetch_baustellen_by.py).")
if not os.path.exists(os.path.join(SITE, "img", "vorschau.jpg")):
    warn.append("site/img/vorschau.jpg fehlt (Bildschirmfoto der Karte fuer die Startseite)")

# 3. Aktualitaet
today = dt.date.today()
news = os.path.join(SITE, "data", "news.js")
if os.path.exists(news):
    st = js_var(news, "window.AL_NEWS")["stand"]
    age = (today - dt.date.fromisoformat(st)).days
    if age > 10:
        warn.append("Daten sind %d Tage alt (Stand %s), Wochenlauf ausfuehren" % (age, st))
fp = os.path.join(SITE, "data", "fahrplan.js")
if os.path.exists(fp):
    to = js_var(fp, "window.AL_FAHRPLAN")["feedTo"]
    d = dt.date(int(to[:4]), int(to[4:6]), int(to[6:]))
    if d < today:
        fehler.append("Fahrplan ist abgelaufen (Ende %s), Wochenlauf ausfuehren" % d.isoformat())
    elif (d - today).days < 7:
        warn.append("Fahrplan endet in %d Tagen (%s)" % ((d - today).days, d.isoformat()))

size = sum(os.path.getsize(os.path.join(dp, f)) for dp, _, fs in os.walk(SITE) for f in fs)
print("site/: %.1f MB" % (size / 1e6))
for w in warn:
    print("WARNUNG:", w)
for f in fehler:
    print("FEHLER:", f)
if fehler:
    print("Pruefung NICHT bestanden (%d Fehler)." % len(fehler))
    sys.exit(1)
print("Pruefung bestanden.")
