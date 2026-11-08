"""Prueft ort.json auf fehlende oder unplausible Angaben (ohne Netzzugriff).

Aufruf: python scripts/ort_pruefen.py
"""
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from geo import ORT  # noqa: E402

sys.stdout.reconfigure(encoding="utf-8")
fehler, warn = [], []


def zahl_im_bereich(name, v, lo, hi):
    if not isinstance(v, (int, float)) or not lo <= v <= hi:
        fehler.append("%s = %r ist nicht plausibel (erwartet %s bis %s)" % (name, v, lo, hi))


def bbox(name, b):
    if not (isinstance(b, list) and len(b) == 4 and b[0] < b[2] and b[1] < b[3]):
        fehler.append("%s muss [Sued, West, Nord, Ost] sein, Sued < Nord und West < Ost" % name)


for k in ("name", "name_ascii", "art", "kontakt_ua"):
    if not str(ORT.get(k, "")).strip():
        fehler.append("%s fehlt" % k)
if "deine@mailadresse" in ORT.get("kontakt_ua", ""):
    warn.append("kontakt_ua: Beispieladresse ersetzen. Sie steht als Kennung in den Abrufen bei OpenStreetMap und den Webseiten der Orte.")
g = ORT["geo"]
zahl_im_bereich("geo.lat0", g["lat0"], 47.0, 55.5)
zahl_im_bereich("geo.lon0", g["lon0"], 5.5, 15.5)
zahl_im_bereich("geo.wetter_lat", g["wetter_lat"], 47.0, 55.5)
zahl_im_bereich("geo.wetter_lon", g["wetter_lon"], 5.5, 15.5)
bbox("geo.umgrenzung_sued_west_nord_ost", g["umgrenzung_sued_west_nord_ost"])
b = g["umgrenzung_sued_west_nord_ost"]
if not (b[0] <= g["lat0"] <= b[2] and b[1] <= g["lon0"] <= b[3]):
    fehler.append("lat0/lon0 liegt ausserhalb der Umgrenzung")
if not re.fullmatch(r"\d{8}", str(g["gemeindeschluessel"])):
    fehler.append("geo.gemeindeschluessel muss der 8-stellige amtliche Gemeindeschluessel (AGS) sein")
if not isinstance(g["osm_relation"], int) or g["osm_relation"] <= 0:
    fehler.append("geo.osm_relation muss die OSM-Relationsnummer der Gemeindegrenze sein")
if ORT["land"].get("kennung") != "BB" or not str(g["gemeindeschluessel"]).startswith("12"):
    warn.append("Luftbild, Gebaeude, Adressen und Bodenrichtwerte sind nur fuer Brandenburg (AGS beginnt mit 12) verdrahtet. Siehe docs/ANDERES-BUNDESLAND.md")
nb = ORT.get("nachbarort")
if nb:
    bbox("nachbarort.bbox_sued_west_nord_ost", nb["bbox_sued_west_nord_ost"])
bs = ORT.get("bausteine") or {}
if (bs.get("baustellen") or bs.get("gelaende")) and (ORT["land"].get("kennung") != "BB"):
    fehler.append("bausteine.baustellen und bausteine.gelaende nutzen Dienste des Landes Brandenburg: fuer andere Laender auf false setzen")
m = bs.get("muellabfuhr")
if m and not str(m.get("url", "")).startswith("https://"):
    fehler.append("bausteine.muellabfuhr.url muss eine https-Adresse sein (oder muellabfuhr auf null setzen)")
if m and not m.get("name"):
    warn.append("bausteine.muellabfuhr.name fehlt: der Entsorger wird in den Quellen und im Hinweisfenster genannt")
v = ORT.get("veroeffentlichung", {})
for k in ("impressum_url", "datenschutz_url"):
    if not v.get(k):
        warn.append("veroeffentlichung.%s ist leer. Vor dem Veroeffentlichen eintragen: Impressum und Datenschutzerklaerung muss der Betreiber selbst stellen." % k)

for w in warn:
    print("WARNUNG:", w)
for f in fehler:
    print("FEHLER:", f)
print("ort.json: %d Fehler, %d Warnungen" % (len(fehler), len(warn)))
sys.exit(1 if fehler else 0)
