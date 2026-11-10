# Bayern

Seit November 2026 ist neben Brandenburg auch Bayern verdrahtet. Beispielort ist die Stadt Cham in der Oberpfalz (`beispiele/cham.json`). Für einen anderen bayerischen Ort reicht es, in `ort.json` Name, Mittelpunkt, OSM-Relation und Gemeindeschlüssel zu ersetzen und `land.kennung` auf `BY` zu lassen.

Die Dienste je Land stehen gesammelt in `scripts/laender.py`. Dort steht auch, welcher Quellenhinweis auf der Seite erscheint.

## Was aus welcher Quelle kommt

| Baustein | Quelle in Bayern | Lizenz |
|---|---|---|
| Luftbild | DOP20 der Bayerischen Vermessungsverwaltung, WMS `geoservices.bayern.de/od/wms/dop/v1/dop20`, Ebene `by_dop20c` | CC BY 4.0 |
| 3D-Gebäude | LoD2 als CityGML-Kacheln (2 × 2 km, UTM 32), Liste je Gemeinde im Metalink `geodaten.bayern.de/odd/a/lod2/citygml/meta/metalink/<AGS>.meta4` | CC BY 4.0 |
| Adressen | aus den LoD2-Gebäuden (Feld `ThoroughfareName`), ergänzt um Hausnummern aus OpenStreetMap | CC BY 4.0, ODbL |
| Gemeindeteile | OpenStreetMap kennt für Cham keine Ortsteil-Grenzen. Ersatz: Ortsmarken (`place=town/suburb/village/hamlet/isolated_dwelling`, also auch Weiler und Einöden), jedes Gebäude gehört zur nächsten Marke, die Fläche ist die Hülle der Gebäude | ODbL |
| Fahrplan | bundesweiter GTFS-Feed von gtfs.de (DELFI), rund 280 MB | CC BY 4.0 |
| Wetter, Luft, Sonnenstand | wie in Brandenburg | wie dort |

Die amtlichen Hauskoordinaten sind in Bayern kein OpenData. Deshalb ist die Adresssuche brauchbar, aber nicht vollständig. In Cham enthält nur ein Teil der Gebäude eine Adresse, den Rest füllt OpenStreetMap, soweit dort Hausnummern eingetragen sind.

Gebäude der Gemeinde erkennt das Skript am Attribut `Gemeindeschluessel`, das jedes bayerische LoD2-Gebäude trägt. Die Nutzungsklassen der Karte (Wohnen, Gewerbe, Landwirtschaft …) leitet `use_by()` in `prepare_gemeinde.py` aus dem ALKIS-Schlüssel `bldg:function` ab.

## Gebäudenutzung

Das bayerische LoD2 unterscheidet grob. In Cham tragen 10.396 von 18.456 Gebäuden den Sammelschlüssel 2000 „Gebäude für Wirtschaft oder Gewerbe“, darunter Scheunen, Schuppen, Garagen und Hallen. Ohne Nacharbeit wären sie auf der Karte alle Handel und Gewerbe.

`refine_use_by()` ordnet diese Gebäude nach Regeln neu ein, die erste passende gilt:

1. Gebäudeart aus OpenStreetMap (`building=barn`, `garage`, `house` …), wenn ihr Mittelpunkt im Dach liegt. Die Arten lädt `fetch.py boundary` nach `gebaeudearten.json`.
2. Unter 40 m² Grundfläche oder niedriger als 3,5 m und ohne Adresse: Nebengebäude.
3. Steht das Gebäude auf einer OSM-Fläche für Hof, Industrie oder Gewerbe (`landuse=farmyard`, `industrial`, `commercial`, `retail`), bekommt es deren Nutzung.
4. Mit Adresse bleibt es Handel und Gewerbe.
5. Ohne Adresse in der freien Flur: Landwirtschaft. Im Dorf (`place=village`) ab 100 m²: Landwirtschaft, gemeint sind Scheunen und Ställe. Sonst Nebengebäude.

Ergebnis für Cham am 08.11.2026: 10.308 Nebengebäude, 5.196 Wohnen, 1.497 Landwirtschaft, 623 Handel und Gewerbe, 328 Industrie. Das ist eine Schätzung. Einzelne Werkstätten im Dorf landen bei der Landwirtschaft, und eine Scheune in der Stadt wird zum Nebengebäude. Die Gebäudekarte nennt die Nutzung ohne Hinweis darauf *(noch offen)*.

## Bausteine für ganz Deutschland

Bodenfeuchte, Klima, Notfall-Ebenen, Touren, Ortsgeschichte und der Drohnenhinweis funktionieren auch in Bayern. Für Cham stehen die Klimastationen Schorndorf-Knöbling (5 km, Reihe bis 2024), Waldmünchen (21 km) und Straubing (42 km, volle Jahre seit 1942) in `beispiele/cham.json`. Waldbrandstufe und Meldeportal bleiben aus, die nächste Webcam des DWD steht am Hohenpeißenberg.

Bei der Ortsgeschichte ist „Cham“ als Gemeindename kurz und steht in fast jedem Artikel aus dem Landkreis. `fetch_ortsgeschichte.py` übernimmt deshalb keine Begriffsklärungen, verlangt den Gemeindenamen als ganzes Wort und nimmt Suchtreffer nur, wenn der Titel genau der Ortsteil ist oder der Ortsteil mit einem Klammerzusatz, der die Gemeinde nennt. In Cham finden so 23 von 52 Gemeindeteilen einen Artikel. Ohne diese Regeln kamen auch Personen, Bundesstraßen und Listen dazu. Für Niedergörsdorf ändert sich nichts (23 von 23). Der Artikel zur Stadt heißt „Cham (Oberpfalz)“, „Cham“ ist eine Begriffsklärung. Deshalb gehört in `data/ergaenzung/ortsgeschichte_titel.json`:

```json
{"Cham (Gemeinde)": "Cham (Oberpfalz)", "Cham": "Cham (Oberpfalz)"}
```

## Noch nicht angebunden

Diese Bausteine fehlen für Bayern noch und sollen nachkommen. Die Karte blendet Schalter und Kacheln dazu aus, solange sie fehlen.

- Bodenrichtwerte, eingefärbte Zonen *(noch offen)*. Seit 08.11.2026 fragt die Karte den Wert auf Klick live ab (siehe unten). Stand der Prüfung vom 08.11.2026:
  - Das LDBV betreibt je Stichtag einen WMS, der aktuelle ist `https://gdi.bayern.de/services/bodenrichtwerte/2026/vboris` mit der Ebene `bodenrichtwerte_2026`. Für 2024 gilt derselbe Pfad mit `2024`. Die ältere Adresse `geoservices.bayern.de/wms/v1/ogc_bodenrichtwerte.cgi` aus den Katalogen antwortet nicht mehr.
  - Der Landkreis Cham ist enthalten. GetFeatureInfo liefert Wert, Zone, Entwicklungszustand und Nutzungsart, als JSON auch die Zonenfläche. Ein Beispiel ist die Zone „Cham (Cham_01)“ in der Altstadt, Mischgebiet, 250 €/m² zum 01.01.2026. Der Dienst erlaubt Abrufe aus dem Browser (CORS `*`).
  - Die Nutzung ist eingeschränkt. Laut GetCapabilities ist der Dienst „kostenfrei für private Nutzung“, sonst gelten die Bedingungen in den Metadaten. Ein Katalogeintrag nennt CC BY-ND, also ohne Bearbeitung. Eine Erlaubnis, die Werte abzuspeichern und als eigene Datei mit der Seite auszuliefern, wie es `prepare_brw.py` für Brandenburg tut, habe ich nicht gefunden.
  - Umgesetzt ist der erste Weg. Ein Klick auf ein Gebäude oder eine freie Stelle zeigt nach einmaliger Zustimmung Wert, Nutzung, Zustand, Zone und Stichtag, dazu den Link auf die Erläuterungen des Gutachterausschusses. Die Karte speichert keine Werte. Einstellungen in `laender.py` unter `brw_live`, der Code steht in `site/js/app.js` bei `brwLiveFill`. Zum nächsten Stichtag (01.01.2028) Adresse und Ebene dort umstellen.
  - Eingefärbte Zonen wie in Brandenburg gehen erst mit einer Erlaubnis zum Speichern. Anfragen ließe sich beim LDBV oder beim Gutachterausschuss Cham (gutachterausschuss@lra.landkreis-cham.de).
- Baustellen und Sperrungen, Zugang zur Mobilithek *(noch offen)*. Stand vom 08.11.2026:
  - Die einzige vollständige Quelle ist der Datensatz „Baustellenmeldungen in Bayern“ der Zentralstelle Verkehrsmanagement in der Mobilithek. Er enthält Autobahnen, Bundes-, Staats- und Kreisstraßen sowie Meldungen der Gemeinden, als DATEX II (XML), alle 3 Minuten neu. Die Nutzung ist kostenfrei, die Lizenz ist GeoNutzV, auf die Quellennennung wird verzichtet (GovData-Eintrag).
  - Für den Abruf braucht es ein Konto bei mobilithek.info, ein Abonnement des Angebots und ein Maschinenkonto mit Zertifikat (`.p12`). Der Abruf läuft über HTTPS mit diesem Zertifikat. Aus dem Browser des Besuchers geht das nicht, das Zertifikat darf nicht auf die Seite.
  - Abruf und Anzeige sind gebaut und mit der Referenzdatei von BayernInfo getestet (Stand Februar 2025, 2.759 Meldungen). `scripts/fetch_baustellen_by.py` holt die Meldungen mit dem Zertifikat, behält die laufenden und die in den nächsten 30 Tagen beginnenden und schreibt sie nach `site/data/baustellen.json`, getrennt nach Gemeinde und Umkreis bis 15 km. Startseite und Kartenpanel „Aktuell“ zeigen die Datei. Fehlt sie, bleibt der Kasten ausgeblendet. Besucher verbinden sich mit keinem fremden Dienst.
  - Was noch fehlt, ist der Zugang. Den legt der Betreiber der Seite an, die Schritte stehen im Kopf des Skripts. Abo-Nummer und Pfade zu Zertifikat und Schlüssel kommen nach `data/state/mobilithek.json`, das nicht versioniert wird. Danach läuft der Abruf im Wochenlauf mit (`update_weekly.py`). Für tagesaktuelle Meldungen bräuchte es zusätzlich einen täglichen Lauf *(noch offen)*.
  - Zum Testen ohne Zugang: `python scripts/fetch_baustellen_by.py --datei <Referenzdatei.xml> --stichtag 2025-08-15`. Die Datei ist dann als Testdaten markiert, und `pruefe_veroeffentlichung.py` lässt sie nicht hochladen.
  - Die Autobahn-API (verkehr.autobahn.de) ist frei, hilft Cham aber nicht, weil keine Autobahn durch das Gemeindegebiet führt. Der BAYSIS-WMS zeigt nur Bedarfsumleitungen, keine Baustellen.
- Live-Abfahrten *(noch offen)*. Für Bayern war am 08.11.2026 keine freie transport.rest-Instanz erreichbar. Die Seite zeigt den Sollfahrplan ohne Echtzeit.

## Grenzen

Das Luftbild liefert der WMS auch außerhalb Bayerns, dort bleibt es weiß und wird wie in Brandenburg durch die Hintergrundfarbe ersetzt. Cham liegt rund 20 km von der tschechischen Grenze entfernt, das betrifft also nur Orte direkt an der Grenze.

Die LoD2-Kacheln für Cham sind zusammen rund 400 MB groß. Sie liegen in `data/raw/gemeinde/lod2/` und werden nicht versioniert. Die Vermessungsverwaltung aktualisiert LoD2 laufend. Ein neuer Abruf alle paar Monate reicht: die Dateien in `lod2/` löschen und `python scripts/fetch.py lod2` starten.
