# MyCity3D

3D-Ortskarte aus offenen Daten für eine Gemeinde: jedes Gebäude als Volumen auf dem Luftbild, dazu Adresssuche, Orte und Betriebe, Fahrpläne von Bus und Bahn mit Live-Abfahrten, Wetter, Luftqualität, Baustellen, Bodenrichtwerte, Sonnenstand und Schatten.

Die Seite ist **rein statisch** (HTML, JavaScript, Datendateien). Sie braucht keinen Server, keine Datenbank und kein PHP. Alles, was von Dritten live kommt (Wetter, Luft, Baustellen, Abfahrten), wird erst nach einem Klick des Besuchers aus dessen Browser abgerufen.

Gebaut als Vorlage: Ort in **einer** Datei (`ort.json`) eintragen, Skript starten, fertig.
Vorschau am Beispielort Niedergörsdorf: https://niedergoersdorf-in-3d.digital-audit.info/

## Wichtig vorab: nur Brandenburg ist fertig verdrahtet

| Baustein | Quelle | Gilt für |
|---|---|---|
| Gebäude (3D, LoD2), Adressen, Luftbild | Landesvermessung und Geobasisinformation Brandenburg (LGB), dl-de/by-2-0 | **Brandenburg** |
| Bodenrichtwerte | BORIS Brandenburg | **Brandenburg** |
| Baustellen und Sperrungen | Landesbetrieb Straßenwesen Brandenburg | **Brandenburg** |
| Fahrplan (Sollfahrplan) | VBB-GTFS, CC BY 4.0 (austauschbar, `ort.json`) | VBB-Gebiet, sonst anderen Feed eintragen |
| Live-Abfahrten | freie `transport.rest`-Instanzen (austauschbar) | Netz der gewählten Instanz |
| Straßen, Orte, Haltestellen, Grenzen | OpenStreetMap, ODbL | überall |
| Wetter, Warnungen | Deutscher Wetterdienst über Bright Sky | Deutschland |
| Luftqualität | Copernicus CAMS über Open-Meteo, CC BY 4.0 | Europa |

Für andere Bundesländer müssen die Geodienste in `scripts/fetch.py` ausgetauscht werden: `docs/ANDERES-BUNDESLAND.md`.

## Schnellstart

Voraussetzung: Python 3.10 oder neuer und `pip install pillow`. Auf Windows läuft alles; die `.bat`-Dateien sind für Windows, die Python-Skripte laufen überall.

1. **Ort eintragen:** `ort.json` öffnen und Name, Koordinaten, OSM-Relation und Gemeindeschlüssel ersetzen. Die Datei enthält ein lauffähiges Beispiel (Niedergörsdorf, Kopie in `beispiele/`).
2. **Prüfen:** `python scripts/ort_pruefen.py`
3. **Aufbauen:** `python scripts/erstaufbau.py` (lädt alle Rohdaten und baut die Seite; je nach Ortsgröße 30 bis 90 Minuten, wiederaufnehmbar mit `--ab N`)
4. **Ansehen:** `starte-seite.bat` (oder `python -m http.server` im Ordner `site/`). Die Seite läuft nur über http, nicht per Doppelklick.
5. **Pflegen:** `python scripts/update_weekly.py` aktualisiert Orte, Haltestellen und Fahrplan. Einplanen und Hochladen: `docs/VEROEFFENTLICHEN.md`.

So findest du die Angaben für `ort.json`:

| Feld | Woher |
|---|---|
| `geo.osm_relation` | openstreetmap.org: Gemeinde suchen, in der Seitenleiste steht „Relation: Name (Nummer)“ |
| `geo.gemeindeschluessel` | 8-stelliger amtlicher Gemeindeschlüssel (AGS), z. B. Statistikportal oder Wikipedia-Seite der Gemeinde |
| `geo.lat0`, `geo.lon0` | Mittelpunkt der Gemeinde, Grad dezimal |
| `geo.umgrenzung_sued_west_nord_ost` | etwas größeres Rechteck um die Gemeinde: Süd, West, Nord, Ost |
| `nachbarort` | optional, `null` für keinen Nachbarort |
| `fahrplan.gtfs_url` | GTFS-Feed deines Verkehrsverbunds |

## Was die Vorlage nicht enthält

- **Impressum und Datenschutzerklärung.** Wer die Seite betreibt, muss beides selbst stellen und in `ort.json` unter `veroeffentlichung` verlinken. Die Vorlage liefert keine mit, und `pruefe_veroeffentlichung.py` warnt, solange die Felder leer sind.
- **Ortsspezifische Inhalte**, etwa Behörden, Ärzte, Müllabfuhr und Veranstaltungsquellen. Eigene Termine gehören in `site/events.js`.
- **Fertige Daten.** Erzeugte Seitendaten und Luftbilder (rund 60 MB) liegen nicht im Repository, sie entstehen beim Bauen.

## Aufbau

```
ort.json              ein Ort = diese Datei
vorlage/              index.html und karte.html mit Platzhaltern
scripts/              Abruf, Aufbereitung, Wochenlauf, Veröffentlichen
site/                 die fertige statische Seite (Ausgabe von baue_seiten.py)
data/raw, data/state  Rohdaten und Zustand (nicht versioniert)
beispiele/            Beispielkonfiguration
docs/                 Anleitungen
```

## Lizenz und Quellenpflichten

Der Code steht unter der **Apache-Lizenz 2.0** (`LICENSE`): freie Nutzung, Veränderung und Weitergabe, auch gewerblich. Wer weitergibt, legt den Lizenztext und die Datei `NOTICE` bei und kennzeichnet geänderte Dateien. Die Lizenz enthält eine Patentklausel.

Die **Daten** haben eigene Lizenzen, deren Hinweise auf der Seite stehen und nicht entfernt werden dürfen: LGB und Landesbetrieb Straßenwesen (dl-de/by-2-0, Daten geändert), OpenStreetMap-Mitwirkende (ODbL), Fahrplan des Verkehrsverbunds (hier CC BY 4.0), Open-Meteo (CC BY 4.0), DWD (GeoNutzV). Mitgeliefert und unter eigener Lizenz: three.js (MIT), Sora und JetBrains Mono (SIL OFL 1.1).

Die Live-Schnittstellen von `transport.rest` sind freie, inoffizielle Dienste ohne Zusage. Bitte nicht automatisiert abfragen, die Seite ruft sie nur auf Klick des Besuchers aus dem Browser ab.
