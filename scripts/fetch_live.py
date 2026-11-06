"""Holt die woechentlich wechselnden OSM-Daten: Orte mit Namen und Haltestellen der Gemeinde.

Aufruf: python3 scripts/fetch_live.py
Ausgabe: data/raw/gemeinde/live/osm_live.json (wird von prepare_gemeinde.py bevorzugt gelesen)
Eine einzige kleine Abfrage statt der 24 Bloecke mit Strassen und Flaechen (die aendern sich selten).
"""
import os, sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from fetch import RAW, log, overpass, save  # noqa: E402
from geo import UMGRENZUNG  # noqa: E402

BBOX = ",".join(str(v) for v in UMGRENZUNG)  # Umgrenzung aus ort.json (Sued,West,Nord,Ost)
Q = """[out:json][timeout:180];
(
 nwr["amenity"]["name"]({b}); nwr["shop"]["name"]({b}); nwr["tourism"]["name"]({b});
 nwr["office"]["name"]({b}); nwr["healthcare"]["name"]({b});
 node["highway"="bus_stop"]({b}); node["railway"~"^(station|halt|stop)$"]({b});
);
out geom;"""


def main():
    blob = overpass(Q.replace("{b}", BBOX))
    if b'"elements"' not in blob[:2000]:
        sys.exit("Unerwartete Antwort von Overpass: " + blob[:200].decode("utf-8", "ignore"))
    save(os.path.join(RAW, "live", "osm_live.json"), blob)
    log("OSM live: %.2f MB" % (len(blob) / 1e6))


if __name__ == "__main__":
    main()
