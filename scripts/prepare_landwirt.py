"""Landwirtschafts-Daten aufbereiten: Bodenfeuchte, Bodentemperatur, Frost und Verdunstung der naechsten DWD-Station.

Quelle : DWD Climate Data Center, derived_germany/soil/daily/recent (agrarmeteorologische Modelle AMBAV und AMBETI, taeglich aktualisiert),
         naechste Station mit aktuellen Daten (aus den drei naechsten, nach Entfernung zu geo.lat0/lon0). Berechnete Werte, keine Messung.
ort.json: bausteine.landwirtschaft muss true sein (gilt fuer ganz Deutschland).
Lizenz : laut DWD-Beschreibung CC BY 4.0, Quellenvermerk "Deutscher Wetterdienst" (Rechtliche Hinweise des DWD).
Ausgabe: site/data/landwirt.js   window.AL_LANDW  (letzte 120 Tage, Tageswerte)
Aufruf : python scripts/prepare_landwirt.py   (laeuft im Wochenlauf, update_weekly.py). Faellt der Abruf aus, bleibt die alte Datei stehen.
"""
import datetime as dt, gzip, json, math, os, sys, urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from geo import LAT0, LON0, ORT  # noqa: E402

ROOT = os.path.dirname(HERE)
OUT = os.path.join(ROOT, "site", "data", "landwirt.js")
RAW = os.path.join(ROOT, "data", "raw", "bodenfeuchte")
BASE = "https://opendata.dwd.de/climate_environment/CDC/derived_germany/soil/daily/recent/"
TAGE = 120
# Spalte -> Name im Ergebnis. nFK = nutzbare Feldkapazitaet in Prozent
SPALTEN = {"BFGS_AG": "bfgs", "BFGL_AG": "bfgl", "BFWS_AG": "bfws", "BFWL_AG": "bfwl", "BFMS_AG": "bfms", "BFML_AG": "bfml",
           "TS05": "ts05", "TS20": "ts20", "TS50": "ts50", "ZFUMI": "frost", "VRGS_AG": "etgs", "VPGFAO": "etp"}
sys.stdout.reconfigure(encoding="utf-8")


def get(url, timeout=120):
    req = urllib.request.Request(url, headers={"User-Agent": ORT["kontakt_ua"]})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read()


def stationen():
    txt = get(BASE + "derived_germany_soil_daily_recent_stations_list.txt").decode("latin-1")
    rows = []
    for l in txt.splitlines():
        p = [x.strip() for x in l.split(";")]
        if len(p) < 6 or not p[0].isdigit():
            continue
        try:
            la, lo = float(p[2]), float(p[3])
        except ValueError:
            continue
        km = math.hypot((la - LAT0) * 111.13, (lo - LON0) * 111.32 * math.cos(math.radians(LAT0)))
        rows.append((km, p[0], p[4], p[5], la, lo))
    return sorted(rows)


def lies(sid):
    txt = gzip.decompress(get(BASE + "derived_germany_soil_daily_recent_v2_%s.txt.gz" % sid)).decode("latin-1")
    ls = [l for l in txt.splitlines() if l.strip()]
    kopf = [c.strip() for c in ls[0].split(";")]
    rows = []
    for l in ls[1:]:
        p = [c.strip() for c in l.split(";")]
        if len(p) < len(kopf) - 1 or not p[1].isdigit():
            continue
        rows.append(dict(zip(kopf, p)))
    return rows


def zahl(v):
    try:
        x = float(v)
    except (TypeError, ValueError):
        return None
    return None if x <= -900 else x


def main():
    if not (ORT.get("bausteine") or {}).get("landwirtschaft"):
        print("Landwirtschaft: ort.json bausteine.landwirtschaft ist aus, uebersprungen")
        return 0
    os.makedirs(RAW, exist_ok=True)
    heute = dt.date.today()
    for km, sid, name, land, la, lo in stationen()[:3]:
        rows = lies(sid)
        if not rows:
            continue
        stand = rows[-1]["Datum"]
        alt = (heute - dt.date(int(stand[:4]), int(stand[4:6]), int(stand[6:]))).days
        if alt > 5:
            print("Station %s (%s): Stand %s zu alt, naechste" % (sid, name, stand))
            continue
        rows = rows[-TAGE:]
        ser = {}
        for sp, nm in SPALTEN.items():
            ser[nm] = [zahl(r.get(sp)) for r in rows]
        out = {"station": {"id": sid, "name": name, "land": land, "km": round(km, 1), "lat": la, "lon": lo},
               "stand": "%s-%s-%s" % (stand[:4], stand[4:6], stand[6:]), "gelesen": heute.isoformat(),
               "tage": [r["Datum"] for r in rows], "serien": ser,
               "quelle": "Deutscher Wetterdienst (DWD), agrarmeteorologische Berechnungen AMBAV/AMBETI, Climate Data Center",
               "lizenz": "CC BY 4.0"}
        with open(OUT, "w", encoding="utf-8") as f:
            f.write("window.AL_LANDW=" + json.dumps(out, ensure_ascii=False, separators=(",", ":")) + ";\n")
        last = {k: v[-1] for k, v in ser.items()}
        print("Landwirtschaft: Station %s %s (%.1f km), %d Tage bis %s, zuletzt %s" % (sid, name, km, len(rows), out["stand"], last))
        return 1
    print("Landwirtschaft: keine Station mit aktuellen Daten, alte Datei bleibt")
    return 0


if __name__ == "__main__":
    try:
        main()
    except Exception as e:  # Netz weg o. ae.: alter Stand bleibt
        print("Landwirtschaft: Abruf fehlgeschlagen (%s), alte Datei bleibt" % e)
