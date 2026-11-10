"""Geodienste je Bundesland. Ausgewaehlt ueber ort.json -> land.kennung.

Ein Land beschreibt, woher Luftbild, 3D-Gebaeude und Adressen kommen, welche Zusatzbausteine es gibt
(Bodenrichtwerte, Baustellen) und welcher Quellenhinweis auf der Seite steht.

  dop        WMS fuer das Luftbild (GetMap in EPSG:4326, JPEG)
  lod2       "wfs_bb"      WFS je Kachel, INSPIRE-Schema bu-core3d, Koordinaten UTM 33 (Brandenburg)
             "citygml_by"  CityGML-Kacheln 2 x 2 km zum Herunterladen, Metalink je Gemeinde, UTM 32 (Bayern)
  addr       "alkis_wfs"   amtliche Adresspunkte per WFS (AdV-Schema ad:Address)
             "lod2_osm"    Adressen aus den LoD2-Gebaeuden, ergaenzt um Hausnummern aus OpenStreetMap
  brw        Bodenrichtwerte verfuegbar (fetch_boris.py, prepare_brw.py)
  brw_live   Bodenrichtwert nur auf Klick live vom Dienst abfragen (WMS GetFeatureInfo aus dem Browser, nach Zustimmung,
             nichts wird gespeichert). Fuer Laender, deren Werte nicht abgespeichert werden duerfen.
  baustellen Baustellenabfrage fuer site/lage.js, None = Karte "Baustellen" wird nicht gezeigt
  quelle     Quellenhinweis Geobasisdaten (Pflichtangabe der Lizenz)
"""

LAENDER = {
    "BB": {
        "name": "Brandenburg",
        "ags_praefix": "12",
        "dop": {"url": "https://isk.geobasis-bb.de/mapproxy/dop20c/service/wms", "layer": "bebb_dop20c"},
        "lod2": "wfs_bb",
        "addr": "alkis_wfs",
        "brw": True,
        "baustellen": "bb",
        "quelle": {
            "kurz": "LGB Brandenburg",
            "fuss": "© GeoBasis-DE/LGB, dl-de/by-2-0 (Daten geändert)",
            "text": "© GeoBasis-DE/LGB, dl-de/by-2-0 (Daten geändert). Landesvermessung und Geobasisinformation Brandenburg",
            "lizenz": "dl-de/by-2-0",
            "url": "https://www.govdata.de/dl-de/by-2-0",
        },
    },
    "BY": {
        "name": "Bayern",
        "ags_praefix": "09",
        "dop": {"url": "https://geoservices.bayern.de/od/wms/dop/v1/dop20", "layer": "by_dop20c"},
        "lod2": "citygml_by",
        "lod2_metalink": "https://geodaten.bayern.de/odd/a/lod2/citygml/meta/metalink/{ags}.meta4",
        "addr": "lod2_osm",
        "brw": False,       # Werte duerfen nicht abgespeichert werden (docs/BAYERN.md), daher nur live auf Klick
        "brw_live": {
            "url": "https://gdi.bayern.de/services/bodenrichtwerte/2026/vboris",
            "layer": "bodenrichtwerte_2026",
            "host": "gdi.bayern.de",
            "kurz": "Bodenrichtwerte Bayern (LDBV, Gutachterausschüsse)",
            "info": "https://www.boris-bayern.de/",
        },
        "baustellen": "mobilithek",  # Datei site/data/baustellen.json aus scripts/fetch_baustellen_by.py (Zugang noetig, docs/BAYERN.md)
        "quelle": {
            "kurz": "Bayerische Vermessungsverwaltung",
            "fuss": "© Bayerische Vermessungsverwaltung, CC BY 4.0 (Daten geändert)",
            "text": "Datenquelle: Bayerische Vermessungsverwaltung, www.geodaten.bayern.de, CC BY 4.0 (Daten geändert)",
            "lizenz": "CC BY 4.0",
            "url": "https://creativecommons.org/licenses/by/4.0/deed.de",
        },
    },
}


def land(kennung):
    if kennung not in LAENDER:
        raise SystemExit("land.kennung %r ist nicht verdrahtet. Vorhanden: %s (siehe docs/ANDERES-BUNDESLAND.md)"
                         % (kennung, ", ".join(sorted(LAENDER))))
    return LAENDER[kennung]
