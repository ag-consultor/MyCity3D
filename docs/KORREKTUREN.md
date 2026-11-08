# Korrekturen von Betreibern

Stimmen Name, Webseite oder Kontaktangaben eines Ortes nicht mehr, gehört die Korrektur zuerst in **OpenStreetMap**, denn dort hilft sie allen. Bis die Änderung in den Daten angekommen ist (oder wenn jemand sie nicht selbst eintragen will), kann die Karte eine Korrektur selbst anwenden.

## So geht es

1. Die Vorlage liegt in `data/ergaenzung/poi_korrekturen.beispiel.json`. Kopieren als `data/ergaenzung/poi_korrekturen.json` (nur diese Datei wird gelesen).
2. Je Korrektur ein Eintrag unter `korrekturen`. Pflicht ist `osm` (Kennung des Ortes in OpenStreetMap, etwa `way/344285774` oder `node/123456789`; sie steht in der Adresszeile der OSM-Seite des Objekts). Alle übrigen Felder sind freiwillig:

| Feld | Wirkung auf der Karte |
|---|---|
| `name` | ersetzt den Namen |
| `web` | ersetzt die Webseite |
| `tel`, `mail` | Telefon und E-Mail aus eigener Angabe des Betreibers |
| `wt`, `wq`, `wg` | Zeiten oder sonstige Angabe als Text (`wt`), Quelladresse (`wq`) und Lesedatum (`wg`) |
| `quelle` | erscheint als Quellenzeile an der Ortskarte, etwa „Mitteilung des Betreibers per E-Mail“ |
| `alt`, `adresse`, `datum` | nur zur eigenen Nachvollziehbarkeit, werden nicht angezeigt |

3. `python scripts/prepare_gemeinde.py` (oder der nächste Wochenlauf) wendet die Korrekturen an. Sie laufen **nach** dem Abgleich mit den Webseiten der Orte und gewinnen daher immer. Die Ausgabe nennt die Zahl der angewendeten Korrekturen.

## Hinweise

- Nur Tatsachen eintragen, die der Betreiber selbst mitgeteilt hat oder die seine eigene Webseite nennt. Quelle und Datum festhalten.
- Keine Angaben über Privatpersonen übernehmen. Telefonnummern und E-Mail-Adressen nur, wenn sie geschäftlich und öffentlich sind.
- Die Datei steht in `.gitignore` (der Ordner `data/ergaenzung/` gehört dem Betreiber und nicht der Vorlage). Wer sie versionieren will, nimmt sie dort heraus.
