"""Waldbrandgefahrenstufe fuer einen Landkreis von der Seite des Ministeriums (MLEUV) lesen. NUR BRANDENBURG.
ort.json: bausteine.waldbrand = {"kreis": "Barnim"}  (Name wie auf der Seite des Ministeriums); fehlt der Eintrag, laeuft nichts.

Quelle : https://mleuv.brandenburg.de/mleuv/de/umwelt/forst/waldschutz/waldbrandgefahr-in-brandenburg/waldbrandgefahrenstufen/
         Das Ministerium veroeffentlicht die Stufen 1 bis 5 je Landkreis taeglich (Textliste mit Datum neben der Karte). Es gibt keine
         offene Schnittstelle und keine CORS-Freigabe, deshalb liest dieses Skript die Seite und schreibt eine kleine Datei.
Ausgabe: site/data/waldbrand.js   window.AL_WALDBRAND = {stufe, stand, gelesen, ...}
Wichtig: Eine alte Stufe ist gefaehrlich falsch. Die Seiten zeigen die Stufe nur, wenn "gelesen" nicht aelter als 36 Stunden ist
         und weisen immer auf die amtliche Seite hin. Das Skript muss deshalb taeglich laufen (scripts/taeglich.bat).
Aufruf : python scripts/fetch_waldbrand.py
"""
import datetime as dt, json, os, re, sys, urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from geo import ORT  # noqa: E402
ROOT = os.path.dirname(HERE)
OUT = os.path.join(ROOT, "site", "data", "waldbrand.js")
URL = "https://mleuv.brandenburg.de/mleuv/de/umwelt/forst/waldschutz/waldbrandgefahr-in-brandenburg/waldbrandgefahrenstufen/"
CFG = (ORT.get("bausteine") or {}).get("waldbrand") or {}
KREIS = CFG.get("kreis")
LABEL = {1: "sehr geringe Gefahr", 2: "geringe Gefahr", 3: "mittlere Gefahr", 4: "hohe Gefahr", 5: "sehr hohe Gefahr"}
sys.stdout.reconfigure(encoding="utf-8")


def main():
    if not KREIS:
        print("Waldbrand: ort.json bausteine.waldbrand ist aus, uebersprungen")
        return 0
    try:
        req = urllib.request.Request(URL, headers={"User-Agent": ORT["kontakt_ua"]})
        html = urllib.request.urlopen(req, timeout=60).read().decode("utf-8", "ignore")
    except Exception as e:
        print("Waldbrand: Abruf fehlgeschlagen (%s), alte Datei bleibt" % e)
        return 0
    txt = re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", re.sub(r"<style.*?</style>|<script.*?</script>", " ", html, flags=re.S))).replace("&nbsp;", " ")
    m = re.search(r"(\d\d)\.(\d\d)\.(\d{4})\s+Barnim\s+\d", txt)  # Datum steht direkt vor der Liste der Landkreise
    s = re.search(re.escape(KREIS) + r"\s+([1-5])\b", txt)
    if not m or not s:
        print("Waldbrand: Seite nicht lesbar (Aufbau geaendert?), alte Datei bleibt")
        return 0
    stand = "%s-%s-%s" % (m.group(3), m.group(2), m.group(1))
    stufe = int(s.group(1))
    # zur Einordnung: hoechste Stufe im Land
    alle = [int(x) for x in re.findall(r"(?:Barnim|Dahme-Spreewald|Elbe-Elster|Havelland|Märkisch-Oderland|Oberhavel|Oberspreewald-Lausitz|Ostprignitz-Ruppin|Prignitz|Uckermark|Teltow-Fläming)\s+([1-5])\b", txt)]
    out = {"kreis": KREIS, "stufe": stufe, "text": LABEL[stufe], "stand": stand, "gelesen": dt.datetime.now().isoformat(timespec="minutes"),
           "max_land": max(alle) if alle else None, "url": URL,
           "quelle": "Ministerium für Landwirtschaft, Umwelt und Klimaschutz des Landes Brandenburg (MLEUV)"}
    with open(OUT, "w", encoding="utf-8") as f:
        f.write("window.AL_WALDBRAND=" + json.dumps(out, ensure_ascii=False, separators=(",", ":")) + ";\n")
    print("Waldbrand: %s Stufe %d (%s), Stand %s" % (KREIS, stufe, LABEL[stufe], stand))
    return 1


if __name__ == "__main__":
    main()
