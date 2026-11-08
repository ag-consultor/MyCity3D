# Datenquellen, Lizenzen und Grundsätze

Stand 08.11.2026. **Grundsatz:** Auf die Karte kommen nur Daten und Funktionen mit **bekannter** Lizenz, keine personenbezogenen Daten, und kein Fremdserver wird ohne Einwilligung des Besuchers angesprochen. Was sich nicht belegen ließ, bleibt draußen.

## Daten, die beim Bauen entstehen (Betreiber-Abruf, keine Besucher-Verbindung)

| Baustein | Quelle | Lizenz | Gilt für |
|---|---|---|---|
| Gebäude (3D, LoD2), Adressen, Luftbild 20 cm | LGB Brandenburg, Geodienste | dl-de/by-2-0, „GeoBasis-DE/LGB“, Daten geändert | Brandenburg |
| Gelände (DGM, 10 m) und Relief | LGB Brandenburg, WCS `dgm_wcs` | dl-de/by-2-0 | Brandenburg (`bausteine.gelaende`) |
| Dachfarbe | aus dem Luftbild gerechnet | wie das Luftbild | wo das Luftbild vorliegt |
| Solar-Eignung | im Browser aus den LoD2-Dachflächen gerechnet | wie LoD2 | wo LoD2 vorliegt |
| Bodenrichtwerte | BORIS Brandenburg | dl-de/by-2-0 | Brandenburg |
| Straßen, Orte, Haltestellen, Grenzen, Öffnungszeiten | OpenStreetMap über Overpass | ODbL | überall |
| Fahrplan (Sollfahrplan, Fahrten) | GTFS-Feed des Verkehrsverbunds | im Beispiel VBB, CC BY 4.0 | je Feed, in `ort.json` |

## Live-Daten im Browser (nur nach Klick, ein gemeinsamer Schalter)

Kein Betreiber-Abruf, nichts im Wochenlauf. Der Schalter „Live-Daten laden“ (`site/live-alle.js`) erteilt die Einwilligung für alle Dienste gemeinsam und listet sie vorher auf; die Einzelschalter in den Karten bleiben. Gemerkt wird nur im Browser (`localStorage`), Widerruf jederzeit. Alle Dienste erlauben Abrufe aus dem Browser (CORS).

| Thema | Dienst | Lizenz / Hinweis |
|---|---|---|
| Wetter, amtliche Warnungen, Wolkenebene | `api.brightsky.dev` (Daten des Deutschen Wetterdienstes) | DWD-Daten, GeoNutzV; die Wolkenebene nutzt Bedeckungsgrad und Windrichtung |
| Luftqualität | `air-quality-api.open-meteo.com` (Copernicus CAMS) | CC BY 4.0, nur nichtkommerzielle Nutzung ohne Schlüssel; Modellrechnung, **keine Messung vor Ort** |
| Baustellen und Sperrungen | `isk.geobasis-bb.de` (Landesbetrieb Straßenwesen) | dl-de/by-2-0, **nur Brandenburg** (`bausteine.baustellen`) |
| Bahn und Bus live, Fahrzeugpositionen | freie `transport.rest`-Instanzen (HAFAS) | inoffiziell, ohne Zusage; Instanzen in `fahrplan.live_hosts` |
| Müllabfuhr | eingebettete Abfuhrabfrage des Entsorgers | Sache des Entsorgers, setzt oft ein Cookie; eigener Schalter; `bausteine.muellabfuhr` |

Die Inhaltsrichtlinie (CSP) der Seiten wird in `scripts/baue_seiten.py` aus genau diesen Einstellungen erzeugt: Verbindungen gehen nur zu den Diensten, die `ort.json` einschaltet. Wer einen weiteren Dienst anbindet, trägt ihn dort ein, sonst blockiert der Browser ihn.

## Geprüft und bewusst nicht aufgenommen

| Thema | Grund |
|---|---|
| 3D-Luftbild und 3D-Mesh (Cesium) | Lizenz des Produkts ließ sich nicht belegen; Aufnahme nur nach schriftlicher Auskunft der Landesvermessung |
| Flugzeuge am Flugplatz (ADS-B) | die frei nutzbaren Dienste lassen Abrufe aus dem Browser nicht zu (CORS); ein Betreiber-Abruf widerspräche dem Grundsatz |
| Mietspiegel, Mietkarte | für Gemeinden meist kein amtlicher Bestand; Portale sind nicht amtlich |
| Vorschau fremder Webseiten beim Überfahren | Nachladen fremder Seiten widerspräche dem Grundsatz und scheitert an Einbettungsverboten |
| Stromstörungen, Pegel | keine offene Schnittstelle mit CORS belegt |

## Annahmen der Einfärbungen

- **Dachfarbe:** mittlerer Farbton (Median) des Dachs im Luftbild. Das Luftbild ist kein echtes Orthophoto, hohe Gebäude kippen im Bild, Schatten und Bäume verfälschen einzelne Dächer. Nur eine Schätzung.
- **Solar-Eignung:** Strahlung relativ zur besten Lage (Süd, 35 Grad) je LoD2-Dachfläche; nutzbar 75 % einer geneigten und 50 % einer flachen Fläche, 0,21 kWp je m², Jahresertrag aus `bausteine.solar_kwh_je_kwp` (Standard 980 kWh je kWp bei bester Ausrichtung, Mitteldeutschland). Ohne Verschattung, Statik, Denkmalschutz und Anlagenplanung: grobe Schätzung ohne Gewähr. Die Annahmen stehen auch im Quellen-Dialog der Karte.
- **Gelände:** 10-m-Raster, Relief als Schummerung mit Faktor 6 überhöht, Höhenangaben je Gebäude und Ort (`hn`).
- **Fahrzeuge:** Miniaturmodelle nach Betreiber (Farben symbolisch, Wagenzahl angenommen). Ohne Live-Daten fahren sie nach dem Sollfahrplan (`data/fahrten.js`, gebaut von `scripts/prepare_fahrten.py`) und folgen dem Gleisnetz aus OpenStreetMap (`data/gleise.js`).
