# Anderes Bundesland

Fertig verdrahtet sind die Geodienste von **Brandenburg**. Für ein anderes Land bleibt alles bis auf wenige Bausteine gleich. Das ist Arbeit, aber kein Umbau der Seite.

| Baustein | Datei | Was zu tun ist |
|---|---|---|
| Luftbild (DOP) | `scripts/fetch.py`, Funktion `getmap` | WMS-Adresse und Ebene des Landes eintragen. `fix_nodata.py` entfernt Weißflächen außerhalb des Landes und braucht ggf. Anpassung |
| Gebäude (LoD2, 3D) | `scripts/fetch.py`, `wfs_cell("lod2", ...)` | WFS-Adresse und Objektart des Landes. Manche Länder liefern LoD2 nur als Download (CityGML-Kacheln) statt per WFS, dann ist ein Download-Schritt nötig |
| Adressen (ALKIS) | `scripts/fetch.py`, `wfs_cell("addr", ...)` | WFS des Landes. Die Auswertung in `prepare_gemeinde.py` erwartet das AdV-Schema (`ad:Address`) |
| Bodenrichtwerte | `scripts/fetch_boris.py`, `prepare_brw.py` | BORIS-WFS des Landes. Wer sie nicht braucht, lässt den Schritt weg und entfernt `fetch_boris.py` und `prepare_brw.py` aus `erstaufbau.py` |
| Gelände (DGM), Relief | `scripts/fetch_dgm.py`, `scripts/prepare_gelaende.py` | WCS-Adresse und Coverage des Landes eintragen. Die Koordinatenumrechnung (`latlon_to_utm33` in `geo.py`) gilt für UTM-Zone 33 (EPSG:25833, Brandenburg); andere Länder liegen oft in Zone 32 (EPSG:25832). Wer das Gelände nicht braucht, setzt `bausteine.gelaende` auf `false` |
| Baustellen | `site/lage.js` | Adresse der Baustellenabfrage ersetzen (und die Quellenangabe dort und in `app.js`) oder `bausteine.baustellen` auf `false` setzen, dann entfällt die Karte „Baustellen“ ganz |
| Waldbrandstufe | `scripts/fetch_waldbrand.py` | Liest die Seite des Landesministeriums Brandenburg. Für andere Länder `bausteine.waldbrand` auf `null` setzen oder das Skript auf die Seite des Landes umschreiben (Amtliche Seite, Aufbau prüfen; die Stufe darf nie älter als 36 Stunden angezeigt werden) |
| Meldeportal | `ort.json`, `bausteine.meldeportal` | Name und Adresse des Portals der Kommune oder des Landes eintragen, oder `null` |
| Müllabfuhr | `ort.json`, `bausteine.muellabfuhr` | Adresse der einbettbaren Abfuhrabfrage des örtlichen Entsorgers eintragen oder `null` setzen. Das Beispiel gilt nur für Südbrandenburg |

Dazu in `ort.json`: `land.name`, `land.kennung`, die Schalter unter `bausteine` und den Fahrplan-Feed (`fahrplan.*`) auf deine Region umstellen. `scripts/ort_pruefen.py` meldet, wenn Brandenburg-Bausteine für ein anderes Land eingeschaltet sind. Die Quellenangaben in `site/js/app.js` („Landesvermessung und Geobasisinformation Brandenburg“, „BORIS Brandenburg“) nennen das Land fest und müssen mit angepasst werden.

Länder, die Gebäude und Adressen als offene Daten bereitstellen, finden sich im GeoPortal des jeweiligen Landes. Die Lizenz (meist dl-de/by-2-0 oder CC BY 4.0) bestimmt den Quellenhinweis auf der Seite.

Beiträge für weitere Länder sind willkommen: bitte als eigene Pull Requests, ein Land je Request.
