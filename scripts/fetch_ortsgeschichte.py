"""Ortsgeschichte: Einleitung des Wikipedia-Artikels je Ortsteil (und der Gemeinde) lesen (ort.json: bausteine.ortsgeschichte).

Quelle : de.wikipedia.org (MediaWiki-API), Lizenz CC BY-SA 4.0. Pflicht: Urheber nennen (Artikelname, Versionsvermerk, Link auf die
         Versionsgeschichte) und die Lizenz nennen. Die Texte werden unveraendert (nur gekuerzt auf ganze Saetze) uebernommen.
Pruefung: Ein Artikel gilt nur als Treffer, wenn der Einleitungstext den Ortsnamen aus ort.json nennt. Zweifelsfaelle landen in data/ergaenzung/ortsgeschichte_pruefen.json
         und werden NICHT angezeigt. Handarbeit: data/ergaenzung/ortsgeschichte_titel.json ({"Ortsname": "Artikeltitel"}) ueberstimmt die Suche.
Ausgabe: site/data/ortsgeschichte.js   window.AL_GESCHICHTE = {"Ortsname": {titel, text, url, hist, stand}, "_gemeinde": {...}}
Aufruf : python scripts/fetch_ortsgeschichte.py   (selten noetig, Artikel aendern sich langsam)
"""
import datetime as dt, json, os, re, sys, time, urllib.parse, urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from geo import ORT  # noqa: E402

NAME = ORT["name"]
ROOT = os.path.dirname(HERE)
OUT = os.path.join(ROOT, "site", "data", "ortsgeschichte.js")
ERG = os.path.join(ROOT, "data", "ergaenzung")
API = "https://de.wikipedia.org/w/api.php"
MAXZ = 1100
sys.stdout.reconfigure(encoding="utf-8")


def api(**p):
    p.update(format="json", formatversion="2")
    url = API + "?" + urllib.parse.urlencode(p)
    for i in range(4):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": ORT["kontakt_ua"]})
            return json.load(urllib.request.urlopen(req, timeout=60))
        except Exception as e:
            print("  API-Fehler:", e)
            time.sleep(40 * (i + 1) if "429" in str(e) else 3 * (i + 1))
    raise RuntimeError("Wikipedia nicht erreichbar")


def kuerze(t):
    t = re.sub(r"\s*={2,}[^=\n]+={2,}\s*", " ", t)  # Zwischenueberschriften des Artikels
    t = re.sub(r"\s+", " ", re.sub(r"\[\d+\]", "", t)).strip()
    if len(t) <= MAXZ:
        return t
    cut = t[:MAXZ]
    i = max(cut.rfind(". "), cut.rfind("! "), cut.rfind("? "))
    return cut[:i + 1] if i > 300 else cut.rsplit(" ", 1)[0] + " …"


def artikel(titel):
    d = api(action="query", prop="extracts|info|revisions", titles=titel, explaintext="1", exsectionformat="wiki", inprop="url", rvprop="timestamp|ids", redirects="1")
    pg = (d.get("query", {}).get("pages") or [{}])[0]
    if pg.get("missing") or not pg.get("extract"):
        return None
    rev = (pg.get("revisions") or [{}])[0]
    voll = pg["extract"]
    intro = re.split(r"\n==[^=]", voll, maxsplit=1)[0].strip()
    ge = None
    m = re.search(r"\n==\s*(Geschichte[^=\n]*|Ortsgeschichte[^=\n]*|Historie|Historisches)\s*==\s*\n(.*?)(?=\n==[^=]|\Z)", voll, re.S)
    if m:
        t = re.sub(r"\n===[^\n]*===\s*\n", "\n", m.group(2)).strip()
        ge = t if len(t) > 80 else None
    return {"titel": pg["title"], "text": intro, "geschichte": ge, "url": pg.get("fullurl"), "rev": rev.get("revid"), "zeit": (rev.get("timestamp") or "")[:10]}


def suche(name):
    d = api(action="query", list="search", srsearch='"%s" %s' % (name, NAME), srlimit="4")
    return [x["title"] for x in d.get("query", {}).get("search", [])]


def main():
    if not (ORT.get("bausteine") or {}).get("ortsgeschichte"):
        print("Ortsgeschichte: ort.json bausteine.ortsgeschichte ist aus, uebersprungen")
        return
    s = open(os.path.join(ROOT, "site", "data", "meta.js"), encoding="utf-8").read()
    meta = json.loads(s[s.index("window.AL_META=") + 15:s.rindex(";")])
    namen = [o["n"] for o in meta["ortsteile"]]
    hand = {}
    hp = os.path.join(ERG, "ortsgeschichte_titel.json")
    if os.path.exists(hp):
        hand = json.load(open(hp, encoding="utf-8"))
    out, pruefen = {}, {}
    for name in [NAME + " (Gemeinde)"] + namen:
        key = "_gemeinde" if name.endswith("(Gemeinde)") else name
        direkt = [hand[name]] if name in hand else ([name.replace(" (Gemeinde)", "")] if key == "_gemeinde" else [name + " (" + NAME + ")", name])
        gefunden, versucht = None, []
        liste = list(direkt)
        for t in liste:
            a = artikel(t)
            if not a:
                continue
            versucht.append(a["titel"])
            if NAME in a["text"] or NAME in a["titel"]:
                gefunden = a
                break
            time.sleep(1.0)
        if not gefunden and name not in hand and key != "_gemeinde":  # Suche nur, wenn der direkte Titel nicht passt
            for t in suche(name):
                if t in versucht:
                    continue
                a = artikel(t)
                time.sleep(1.0)
                if a:
                    versucht.append(a["titel"])
                    if NAME in a["text"]:
                        gefunden = a
                        break
        if gefunden:
            out[key] = {"titel": gefunden["titel"], "text": kuerze(gefunden["text"]), "geschichte": kuerze(gefunden["geschichte"]) if gefunden.get("geschichte") else None, "url": gefunden["url"], "hist": "https://de.wikipedia.org/w/index.php?title=%s&action=history" % urllib.parse.quote(gefunden["titel"].replace(" ", "_")),
                        "version": gefunden["zeit"], "rev": gefunden["rev"]}
            print("OK     %-18s -> %s (Einleitung %d, Geschichte %s Zeichen)" % (name, gefunden["titel"], len(out[key]["text"]), len(out[key]["geschichte"]) if out[key]["geschichte"] else "fehlt"))
        else:
            pruefen[name] = versucht
            print("KEIN   %-18s (gepruefte Artikel ohne Bezug zu %s: %s)" % (name, NAME, ", ".join(versucht) or "keine"))
        time.sleep(1.5)
    os.makedirs(ERG, exist_ok=True)
    json.dump(pruefen, open(os.path.join(ERG, "ortsgeschichte_pruefen.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    res = {"stand": dt.date.today().isoformat(), "orte": out, "lizenz": "CC BY-SA 4.0", "quelle": "Wikipedia, die freie Enzyklopädie (de.wikipedia.org)"}
    with open(OUT, "w", encoding="utf-8") as f:
        f.write("window.AL_GESCHICHTE=" + json.dumps(res, ensure_ascii=False, separators=(",", ":")) + ";\n")
    print("Treffer: %d von %d" % (len(out), len(namen) + 1))


if __name__ == "__main__":
    main()
