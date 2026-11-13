"""Erstaufbau fuer einen neuen Ort: holt alle Rohdaten und baut die Seite.

Aufruf: python scripts/erstaufbau.py            (alles, dauert je nach Ortsgroesse 30 bis 90 Minuten)
        python scripts/erstaufbau.py --ab 3     (ab Schritt 3 weitermachen, z. B. nach einem Abbruch)

Voraussetzung: ort.json ist angepasst und `python scripts/ort_pruefen.py` meldet keinen Fehler.
Alle Schritte sind wiederaufnahmefaehig, vorhandene Rohdaten werden uebersprungen.
Danach reicht fuer die laufende Pflege `python scripts/update_weekly.py` (siehe docs/VEROEFFENTLICHEN.md).
"""
import os
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from geo import LAND, ORT  # noqa: E402

sys.stdout.reconfigure(encoding="utf-8")

SCHRITTE = [
    ("Gemeindegrenze, Kacheln, Adressen, OSM, 3D-Gebaeude, Luftbild", ["fetch.py", "boundary", "cells", "addr", "osm", "lod2", "dop"]),
    ("Gelaende (DGM) holen, nur Brandenburg: ort.json bausteine.gelaende", ["fetch_dgm.py"]),
    ("Gebaeudeumrisse aus OpenStreetMap holen (fuellen Luecken der Gebaeudedaten)", ["fetch_osm_gebaeude.py"]),
    ("Bodenrichtwerte holen (BORIS)", ["fetch_boris.py"]),
    ("Wochenlauf: Orte, Fahrplan, Seitendaten, Seiten bauen", ["update_weekly.py", "--no-state"]),
    ("Bodenrichtwerte aufbereiten", ["prepare_brw.py"]),
    ("Aktualisierungsstand neu schreiben (jetzt mit Bodenrichtwerten)", ["schreibe_stand.py"]),
    ("Versionskennungen", ["versionieren.py"]),
    ("Pruefung", ["pruefe_veroeffentlichung.py"]),
]
if not LAND.get("brw"):  # z. B. Bayern: keine freien Bodenrichtwerte (docs/BAYERN.md)
    SCHRITTE = [s for s in SCHRITTE if s[1][0] not in ("fetch_boris.py", "prepare_brw.py")]


def main():
    if not (ORT.get("bausteine") or {}).get("gelaende"):
        SCHRITTE[:] = [x for x in SCHRITTE if x[1][0] != "fetch_dgm.py"]
    ab = 1
    if "--ab" in sys.argv:
        ab = int(sys.argv[sys.argv.index("--ab") + 1])
    for n, (titel, cmd) in enumerate(SCHRITTE, 1):
        if n < ab:
            continue
        print("\n=== Schritt %d von %d: %s ===" % (n, len(SCHRITTE), titel), flush=True)
        r = subprocess.run([sys.executable, os.path.join(HERE, cmd[0])] + cmd[1:])
        if r.returncode != 0:
            sys.exit("Schritt %d fehlgeschlagen. Nach der Korrektur: python scripts/erstaufbau.py --ab %d" % (n, n))
    print("\nFertig. Lokal ansehen: starte-seite.bat. Veroeffentlichen: siehe docs/VEROEFFENTLICHEN.md")


if __name__ == "__main__":
    main()
