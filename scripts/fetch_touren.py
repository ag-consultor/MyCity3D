"""Touren (Rad, Wandern, Inline-Skaten, MTB) aus OpenStreetMap fuer das Gebiet (ort.json: bausteine.touren).
Optional: bausteine.touren.wikivoyage = "Artikeltitel" holt die Einleitung eines Wikivoyage-Artikels (CC BY-SA 4.0, Urhebernennung auf der Touren-Seite).

Quelle : OpenStreetMap-Routenrelationen (ODbL), Overpass-API. Beruecksichtigt werden Routen, die mindestens 500 m im Gemeindegebiet verlaufen.
Ausgabe: site/data/touren.js   window.AL_TOUREN = {stand, routen:[{id,name,ref,art,netz,von,nach,betreiber,web,km_gem,km_gesamt,lines:[[x,z,x,z,...]]}]}
         data/raw/osm_touren.json (Rohdaten, nicht im Repository)
Hinweis: Die Laenge im Gemeindegebiet wird aus der Geometrie gerechnet, die Gesamtlaenge nur, wenn OSM sie als "distance" fuehrt.
Aufruf : python scripts/fetch_touren.py [--lokal]
"""
import datetime as dt, json, math, os, re, sys, time, urllib.parse, urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from geo import ORT, UMGRENZUNG  # noqa: E402
ROOT = os.path.dirname(HERE)
RAW = os.path.join(ROOT, "data", "raw", "osm_touren.json")
OUT = os.path.join(ROOT, "site", "data", "touren.js")
BB = "%s,%s,%s,%s" % UMGRENZUNG
UA = ORT["kontakt_ua"]
CFG = (ORT.get("bausteine") or {}).get("touren")
ART = {"bicycle": "Rad", "hiking": "Wandern", "inline_skates": "Inline-Skaten", "mtb": "Mountainbike"}
Q = ('[out:json][timeout:240];rel["route"~"^(bicycle|hiking|inline_skates|mtb)$"](%s);out geom(%s);' % (BB, BB))
sys.stdout.reconfigure(encoding="utf-8")


def overpass(q, tries=4):
    for i in range(tries):
        for host in ("https://overpass-api.de/api/interpreter", "https://overpass.kumi.systems/api/interpreter"):
            try:
                req = urllib.request.Request(host, data=urllib.parse.urlencode({"data": q}).encode(), headers={"User-Agent": UA})
                return json.load(urllib.request.urlopen(req, timeout=300))
            except Exception as e:
                print("Overpass %s: %s" % (host, e))
                time.sleep(10 * (i + 1))
    raise RuntimeError("Overpass nicht erreichbar")


def wikivoyage(titel):
    """Einleitung des Wikivoyage-Artikels (CC BY-SA 4.0), unveraendert, nur auf ganze Saetze gekuerzt."""
    try:
        url = "https://de.wikivoyage.org/w/api.php?" + urllib.parse.urlencode({"action": "query", "prop": "extracts|info|revisions", "titles": titel, "exintro": "1", "explaintext": "1", "inprop": "url", "rvprop": "timestamp", "redirects": "1", "format": "json", "formatversion": "2"})
        d = json.load(urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": UA}), timeout=60))
        pg = d["query"]["pages"][0]
        t = re.sub(r"\s+", " ", pg.get("extract") or "").strip()
        if not t:
            return None
        if len(t) > 1400:
            cut = t[:1400]
            i = max(cut.rfind(". "), cut.rfind("! "))
            t = cut[:i + 1] if i > 400 else cut.rsplit(" ", 1)[0] + " …"
        return {"titel": pg["title"], "text": t, "url": pg["fullurl"], "hist": "https://de.wikivoyage.org/w/index.php?title=%s&action=history" % urllib.parse.quote(pg["title"].replace(" ", "_")), "version": ((pg.get("revisions") or [{}])[0].get("timestamp") or "")[:10]}
    except Exception as e:
        print("Wikivoyage: nicht abrufbar (%s)" % e)
        return None


def main():
    if not CFG:
        print("Touren: ort.json bausteine.touren ist aus, uebersprungen")
        return 0
    try:
        if "--lokal" in sys.argv:
            raise RuntimeError("--lokal")
        d = overpass(Q)
        json.dump(d, open(RAW, "w", encoding="utf-8"), ensure_ascii=False)
    except Exception as e:
        print("Touren: Abruf nicht moeglich (%s)" % e)
        if not os.path.exists(RAW):
            return 0
        d = json.load(open(RAW, encoding="utf-8"))
        print("Touren: Rohdaten vom letzten Lauf werden verwendet")
    import prepare_gemeinde as pg
    from geo import xz, simplify
    routen = []
    for r in d["elements"]:
        t = r.get("tags") or {}
        art = ART.get(t.get("route"))
        if not art:
            continue
        lines, km = [], 0.0
        for m in r.get("members", []):
            g = m.get("geometry")
            if m.get("type") != "way" or not g or len(g) < 2:
                continue
            runs, run = [], []
            for p in g:  # Punkte ausserhalb des abgefragten Ausschnitts kommen als null
                if p is None:
                    if len(run) > 1:
                        runs.append(run)
                    run = []
                else:
                    run.append(xz(p["lat"], p["lon"]))
            if len(run) > 1:
                runs.append(run)
            for pts in runs:
                cur = []
                for a, b in zip(pts, pts[1:]):
                    mid = ((a[0] + b[0]) / 2, (a[1] + b[1]) / 2)
                    if pg.in_gemeinde(*mid):
                        if not cur:
                            cur.append(a)
                        cur.append(b)
                        km += math.hypot(a[0] - b[0], a[1] - b[1]) / 1000
                    elif len(cur) > 1:
                        lines.append(cur); cur = []
                if len(cur) > 1:
                    lines.append(cur)
        if km < 0.5:
            continue
        flat = []
        for ln in lines:
            ln = simplify(ln, 2.0) if len(ln) > 3 else ln
            flat.append([round(v, 1) for p in ln for v in p])
        dist = t.get("distance")
        try:
            gesamt = float(str(dist).replace(",", ".").split()[0]) if dist else None
        except ValueError:
            gesamt = None
        routen.append({"id": "relation/%d" % r["id"], "name": t.get("name") or t.get("ref") or "(ohne Namen)", "ref": t.get("ref"), "art": art, "netz": t.get("network"),
                       "von": t.get("from"), "nach": t.get("to"), "betreiber": t.get("operator"), "web": t.get("website") or t.get("url"), "km_gem": round(km, 1),
                       "km_gesamt": gesamt, "lines": flat})
    # Skate-Routen sind in OSM zusaetzlich als Radroute gleichen Namens erfasst: nur die Skate-Route behalten
    skate = {x["name"] for x in routen if x["art"] == "Inline-Skaten"}
    routen = [x for x in routen if not (x["art"] == "Rad" and x["name"] in skate)]
    routen.sort(key=lambda x: (-x["km_gem"], x["name"]))
    wv = wikivoyage(CFG["wikivoyage"]) if isinstance(CFG, dict) and CFG.get("wikivoyage") else None
    with open(OUT, "w", encoding="utf-8") as f:
        f.write("window.AL_TOUREN=" + json.dumps({"stand": dt.date.today().isoformat(), "routen": routen, "wikivoyage": wv, "quelle": "© OpenStreetMap-Mitwirkende, ODbL"}, ensure_ascii=False, separators=(",", ":")) + ";\n")
    print("Touren: %d Routen im Gemeindegebiet" % len(routen))
    for x in routen[:25]:
        print("  %-14s %-42s %5.1f km in der Gemeinde%s%s" % (x["art"], x["name"][:42], x["km_gem"], (", gesamt %.0f km" % x["km_gesamt"]) if x["km_gesamt"] else "", (" [%s]" % x["netz"]) if x["netz"] else ""))
    return len(routen)


if __name__ == "__main__":
    main()
