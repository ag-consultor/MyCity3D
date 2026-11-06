# Anderes Bundesland

Fertig verdrahtet sind die Geodienste von **Brandenburg**. Für ein anderes Land bleibt alles bis auf vier Bausteine gleich. Das ist Arbeit, aber kein Umbau der Seite.

| Baustein | Datei | Was zu tun ist |
|---|---|---|
| Luftbild (DOP) | `scripts/fetch.py`, Funktion `getmap` | WMS-Adresse und Ebene des Landes eintragen. `fix_nodata.py` entfernt Weißflächen außerhalb des Landes und braucht ggf. Anpassung |
| Gebäude (LoD2, 3D) | `scripts/fetch.py`, `wfs_cell("lod2", ...)` | WFS-Adresse und Objektart des Landes. Manche Länder liefern LoD2 nur als Download (CityGML-Kacheln) statt per WFS, dann ist ein Download-Schritt nötig |
| Adressen (ALKIS) | `scripts/fetch.py`, `wfs_cell("addr", ...)` | WFS des Landes. Die Auswertung in `prepare_gemeinde.py` erwartet das AdV-Schema (`ad:Address`) |
| Bodenrichtwerte | `scripts/fetch_boris.py`, `prepare_brw.py` | BORIS-WFS des Landes. Wer sie nicht braucht, lässt den Schritt weg und entfernt `fetch_boris.py` und `prepare_brw.py` aus `erstaufbau.py` |
| Baustellen | `site/lage.js` | Adresse der Baustellenabfrage ersetzen oder die Karte „Baustellen“ aus `vorlage/index.html` und `site/lage.js` streichen |

Dazu in `ort.json`: `land.name`, `land.kennung` und den Fahrplan-Feed (`fahrplan.*`) auf deine Region umstellen. Die Quellenangaben in `site/js/app.js` („Landesvermessung und Geobasisinformation Brandenburg“, „BORIS Brandenburg“) nennen das Land fest und müssen mit angepasst werden.

Länder, die Gebäude und Adressen als offene Daten bereitstellen, finden sich im GeoPortal des jeweiligen Landes. Die Lizenz (meist dl-de/by-2-0 oder CC BY 4.0) bestimmt den Quellenhinweis auf der Seite.

Beiträge für weitere Länder sind willkommen: bitte als eigene Pull Requests, ein Land je Request.
