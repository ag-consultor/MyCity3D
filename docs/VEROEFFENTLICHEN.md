# Veröffentlichen und wöchentlich aktualisieren

Die Seite in `site/` ist rein statisch (HTML, JavaScript, Datendateien, Luftbilder, rund 50 bis 60 MB). Sie läuft auf jedem Webspace mit HTTPS.

## Wege

| | A: GitHub Pages | B: Subdomain beim Hoster | C: Unterseite in WordPress |
|---|---|---|---|
| Aufwand | gering | gering bis mittel | mittel, störanfällig |
| Eigene Adresse | nur mit Domain-Einstellung | ja | ja |
| Aktualisieren | `git push` des Ordners `site/` | Ordner hochladen (SFTP) | wie B |
| Haken | `site/data` und `site/img` sind in `.gitignore`, müssten für Pages freigegeben werden. Das Repo wird groß | Hosting-Tarif mit Subdomain und HTTPS nötig | Themes und Cache-Plugins stören Vollbild-Seiten |

Empfohlen ist **B**. Das mitgelieferte `scripts/veroeffentlichen.bat` lädt per WinSCP (SFTP) hoch.

## Hochladen mit WinSCP einrichten

1. Beim Hoster eine Subdomain anlegen, HTTPS einschalten und einen SFTP-Zugang einrichten.
2. In WinSCP eine neue Sitzung anlegen (SFTP, Server, Port 22, Benutzer, Passwort) und unter einem Namen speichern.
3. In `ort.json` unter `veroeffentlichung` eintragen: `winscp_sitzung` (Name der Sitzung) und `zielordner` (Ordner der Subdomain auf dem Server, Groß-/Kleinschreibung exakt).
4. Zugangsdaten stehen **nur in WinSCP**, nie im Projekt und nie in Git.
5. Probelauf: `scripts\veroeffentlichen.bat vorschau` zeigt nur an, was hochgeladen würde.
6. Hochladen: `scripts\veroeffentlichen.bat`. Zuerst läuft `pruefe_veroeffentlichung.py`, erst danach wird übertragen. Es wird nichts gelöscht.

## Impressum und Datenschutz (Pflicht für Betreiber)

Die Vorlage bringt keine Texte mit. Wer die Seite betreibt, braucht in Deutschland ein Impressum und eine Datenschutzerklärung. Die Adressen kommen in `ort.json` unter `veroeffentlichung.impressum_url` und `datenschutz_url` (vollständige https-Adressen, etwa auf der eigenen Homepage). Die Fußzeile zeigt die Links dann an. Die Datenschutzerklärung muss die Abrufe aus dem Browser nennen, die erst nach Klick des Besuchers stattfinden (Schalter „Live-Daten laden“ und Einzelschalter): `api.brightsky.dev`, `air-quality-api.open-meteo.com`, `isk.geobasis-bb.de` (nur bei `bausteine.baustellen`), die in `fahrplan.live_hosts` eingetragenen Dienste, bei einer Webcam der Bilderserver des DWD (`opendata.dwd.de`) und, falls eingetragen, die eingebettete Müllabfuhr-Abfrage (sie setzt oft ein Cookie). Die Seiten gehen mit einer Inhaltsrichtlinie (CSP als `meta`-Tag) hinaus, die `baue_seiten.py` aus `ort.json` erzeugt; ein neuer Dienst muss dort eingetragen werden, sonst blockiert ihn der Browser. Die Rechtsprüfung liegt bei dir.

## Wochenlauf

`scripts/wochenlauf.bat` (oder `python scripts/update_weekly.py`):

1. Orte und Haltestellen aus OpenStreetMap neu holen.
2. Fahrplan-Feed laden, auf das Gebiet filtern und die Fahrten für die fahrenden Fahrzeuge ausziehen (`prepare_fahrten.py`).
3. Seitendaten, Dachfarben und (bei `bausteine.gelaende`) Gelände neu bauen, Seiten erzeugen.
4. Mit dem letzten Stand vergleichen und die Neuigkeiten schreiben.

**Achtung:** Jeder Fahrplan-Feed hat ein Ende. Ohne Wochenlauf zeigt die Seite danach „keine Daten“, und `pruefe_veroeffentlichung.py` bricht das Veröffentlichen ab.

Täglich (`scripts/taeglich.bat`): Waldbrandstufe und Bodenfeuchte, danach `versionieren.py` und, wenn `data/state/auto-veroeffentlichen.on` existiert, das Hochladen. Die Seite zeigt die Waldbrandstufe nur, wenn sie nicht älter als 36 Stunden ist; fällt der tägliche Lauf aus, verschwindet die Stufe und ein Verweis auf die amtliche Seite bleibt. Einplanen wie den Wochenlauf, nur mit `/SC DAILY /ST 08:30`.

Selten (einmal im Jahr oder bei Bedarf): Klima (`fetch_klima.py`) und Ortsgeschichte (`fetch_ortsgeschichte.py`, Zweifelsfälle landen in `data/ergaenzung/ortsgeschichte_pruefen.json` und werden nicht angezeigt; eigene Artikeltitel in `data/ergaenzung/ortsgeschichte_titel.json`).

Nicht wöchentlich: Gebäude und Adressen vierteljährlich (`python scripts/fetch.py addr lod2`, dazu `fetch_osm_gebaeude.py` für die ergänzenden Umrisse, danach `prepare_gemeinde.py`), Bodenrichtwerte jährlich nach dem Stichtag (`fetch_boris.py`, `prepare_brw.py`).

Einplanen unter Windows, einmalig (Pfad anpassen):

```
schtasks /Create /SC WEEKLY /D MON /ST 04:30 /TN "MyCity3D Wochenlauf" /TR "\"C:\Pfad\zu\MyCity3D\scripts\wochenlauf.bat\""
```

Automatisches Hochladen nach dem Wochenlauf: erst wenn der erste Upload von Hand geklappt hat, eine leere Datei `data/state/auto-veroeffentlichen.on` anlegen.

## Zwischenspeicher

`scripts/versionieren.py` hängt an Skripte, Stilblätter und Kacheln eine Kennung aus dem Dateiinhalt (`?v=…`; die Kennung aller Kacheln, der Flächen und des Reliefs steht in `site/data/tv.js`). So sehen Wiederkehrer nach einem Neubau keine alten Kacheln aus dem Zwischenspeicher. Das Skript läuft im Wochenlauf und vor dem Veröffentlichen.

## Vorschaubild

Die Startseite zeigt `site/img/vorschau.jpg`, ein Bildschirmfoto der Karte (1280 × 800). Bei laufender Seite nimmt `python scripts/vorschaubild.py --ortsteil <Name>` es auf (braucht `pip install playwright` und `playwright install chromium`). Ohne `--ortsteil` zeigt es die Ansicht beim Laden der Karte. Es wird nicht automatisch erneuert.
