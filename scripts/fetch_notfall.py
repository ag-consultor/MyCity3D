"""Loeschwasser, Sirenen, Energieanlagen, Freizeit- und Alltagsorte, Strassenlampen aus OpenStreetMap (ODbL) fuer das Gebiet (ort.json: bausteine.notfall).

Abruf  : Overpass-API, die Umgrenzung aus ort.json (geo.umgrenzung_sued_west_nord_ost); Filter auf das Gemeindegebiet beim Aufbereiten.
Ausgabe: data/raw/osm_notfall.json (Rohdaten, nicht im Repository), site/data/notfall.js  window.AL_NOTFALL
Arten  : F Flugplatz, H Hydrant (Unterflur, Ueberflur, Rohr, Wand), B Loeschbrunnen, T Loeschwasserbehaelter, P Loeschteich, S Saugstelle, I Sirene,
         W Windrad, G Biogas/Biomasse, O Solarpark
Hinweis: Angaben stammen von Mitwirkenden und koennen unvollstaendig oder veraltet sein. Massgeblich ist die Feuerwehr bzw. der Betreiber.
Aufruf : python scripts/fetch_notfall.py   (Wochenlauf; faellt Overpass aus, bleibt die alte Datei stehen)
"""
import datetime as dt, json, os, re, sys, time, urllib.parse, urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from geo import ORT, UMGRENZUNG  # noqa: E402
ROOT = os.path.dirname(HERE)
RAW = os.path.join(ROOT, "data", "raw", "osm_notfall.json")
OUT = os.path.join(ROOT, "site", "data", "notfall.js")
BB = "(%s,%s,%s,%s)" % UMGRENZUNG
UA = ORT["kontakt_ua"]
BAUSTEIN = ORT.get("bausteine") or {}
sys.stdout.reconfigure(encoding="utf-8")

Q = ("[out:json][timeout:180];(" +
     'nwr["emergency"~"^(fire_hydrant|water_tank|fire_water_pond|suction_point|siren)$"]' + BB + ";" +
     'nwr["man_made"="siren"]' + BB + ";" +
     'nwr["power"="generator"]["generator:source"="wind"]' + BB + ";" +
     'nwr["power"~"^(plant|generator)$"]["plant:source"="wind"]' + BB + ";" +
     'nwr["power"~"^(plant|generator)$"]["generator:source"~"^(biogas|biomass)$"]' + BB + ";" +
     'nwr["power"~"^(plant|generator)$"]["plant:source"~"^(biogas|biomass)$"]' + BB + ";" +
     'nwr["aeroway"~"^(aerodrome|heliport)$"]' + BB + ";" +
     'nwr["leisure"="playground"]' + BB + ";" +
     'nwr["leisure"~"^(pitch|sports_centre|stadium)$"]["sport"]' + BB + ";" +
     'nwr["tourism"~"^(viewpoint|picnic_site)$"]' + BB + ";" +
     'nwr["tourism"="information"]["information"~"^(board|guidepost|office|map)$"]' + BB + ";" +
     'nwr["historic"~"^(memorial|wayside_cross|wayside_shrine|monument|ruins|archaeological_site|castle|manor|battlefield)$"]' + BB + ";" +
     'nwr["amenity"~"^(bench|shelter|drinking_water|toilets|charging_station|bicycle_parking|vending_machine)$"]' + BB + ";" +
     'node["highway"="street_lamp"]' + BB + ";" +
     'nwr["power"="plant"]["plant:source"="solar"]' + BB + ";" +
     'nwr["power"="generator"]["generator:source"="solar"]["generator:output:electricity"~"^[0-9.]+ ?M?W"]' + BB + ";" +
     ");out center tags;")


def overpass(q, tries=4):
    for i in range(tries):
        for host in ("https://overpass-api.de/api/interpreter", "https://overpass.kumi.systems/api/interpreter"):
            try:
                req = urllib.request.Request(host, data=urllib.parse.urlencode({"data": q}).encode(), headers={"User-Agent": UA})
                return json.load(urllib.request.urlopen(req, timeout=240))
            except Exception as e:
                print("Overpass %s: %s" % (host, e))
                time.sleep(10 * (i + 1))
    raise RuntimeError("Overpass nicht erreichbar")


def art(t):
    em, mm, pw = t.get("emergency"), t.get("man_made"), t.get("power")
    if em == "fire_hydrant":
        ty = (t.get("fire_hydrant:type") or "").lower()
        if "brunnen" in ty or "sauger" in ty or "löschbr" in ty.replace("oe", "ö"):
            return "B"
        return "H"
    if em == "water_tank":
        return "T"
    if em == "fire_water_pond":
        return "P"
    if em == "suction_point":
        return "S"
    if em == "siren" or mm == "siren":
        return "I"
    if t.get("aeroway") in ("aerodrome", "heliport"):
        return "F"
    am, le, to, hi = t.get("amenity"), t.get("leisure"), t.get("tourism"), t.get("historic")
    if le == "playground":
        return "k"
    if le in ("pitch", "sports_centre", "stadium"):
        return "q"
    if to in ("viewpoint", "picnic_site"):
        return "a"
    if to == "information":
        return "i"
    if hi:
        return "d"
    amap = {"bench": "b", "shelter": "u", "drinking_water": "w", "toilets": "t", "charging_station": "l", "bicycle_parking": "r", "vending_machine": "v"}
    if am in amap:
        return amap[am]
    if t.get("highway") == "street_lamp":
        return "L"
    src = (t.get("generator:source") or t.get("plant:source") or "").lower()
    if src == "wind":
        return "W"
    if src in ("biogas", "biomass"):
        return "G"
    if src == "solar":
        return "O"
    return None


TYP_DE = {"underground": "Unterflurhydrant", "pillar": "Überflurhydrant", "pipe": "Rohrleitung/Entnahmestelle", "wall": "Wandhydrant"}


def detail(a, t):
    d = []
    ty = (t.get("fire_hydrant:type") or "").strip()
    if a in ("H",) and ty:
        d.append(TYP_DE.get(ty.lower(), ty))
    elif a == "B" and ty:
        d.append(ty.replace("_", " "))
    dn = t.get("fire_hydrant:diameter")
    if dn and re.match(r"^\d+$", dn):
        d.append("DN " + dn)
    vol = t.get("water_volume") or t.get("capacity")
    if vol and re.match(r"^[\d.,]+$", vol):
        d.append(vol.replace(".", ",") + " m³")
    if t.get("fire_hydrant:pressure"):
        d.append("Druck: " + t["fire_hydrant:pressure"].replace("_", " "))
    if t.get("siren:type"):
        d.append({"electronic": "elektronische Sirene", "mechanical": "mechanische Sirene"}.get(t["siren:type"], t["siren:type"]))
    out = t.get("generator:output:electricity") or t.get("plant:output:electricity")
    if out and re.match(r"^\d", out):
        d.append("Leistung " + out.replace("_", " "))
    if t.get("height") and a == "W":
        d.append("Höhe " + t["height"] + " m")
    HIST = {"memorial": "Denkmal/Gedenkort", "wayside_cross": "Wegkreuz", "wayside_shrine": "Bildstock", "monument": "Monument", "ruins": "Ruine", "archaeological_site": "Bodendenkmal", "castle": "Burg", "manor": "Gutshaus/Herrenhaus", "battlefield": "Schlachtfeld"}
    VEND = {"eggs": "Eier", "milk": "Milch", "potatoes": "Kartoffeln", "honey": "Honig", "vegetables": "Gemüse", "fruit": "Obst", "sausages": "Wurst", "bread": "Brot", "flowers": "Blumen", "bread;eggs": "Brot, Eier", "cigarettes": "Zigaretten", "drinks": "Getränke", "sweets": "Süßigkeiten", "newspapers": "Zeitungen", "parcel_pickup": "Paketabholung"}
    if a == "d":
        d.append(HIST.get(t.get("historic"), t.get("historic")))
        if t.get("inscription") and len(t["inscription"]) < 120:
            d.append("Inschrift: " + t["inscription"].replace("\n", " "))
    if a == "q" and t.get("sport"):
        d.append(t["sport"].replace(";", ", ").replace("_", " "))
    if a == "a":
        d.append({"viewpoint": "Aussichtspunkt", "picnic_site": "Rastplatz"}.get(t.get("tourism"), ""))
    if a == "i" and t.get("information"):
        d.append({"board": "Informationstafel", "guidepost": "Wegweiser", "office": "Infostelle", "map": "Karte"}.get(t["information"], t["information"]))
    if a == "v" and t.get("vending"):
        d.append(", ".join(VEND.get(x, x) for x in t["vending"].split(";")))
    if a == "l" and t.get("capacity"):
        d.append(t["capacity"] + " Ladepunkte")
    if a == "b" and t.get("seats"):
        d.append(t["seats"] + " Sitze")
    if a == "F":
        for k in ("icao", "iata"):
            if t.get(k):
                d.append(k.upper() + " " + t[k])
        if t.get("sport"):
            d.append("Sport: " + t["sport"].replace(";", ", "))
    for k in ("name", "operator", "ref", "description"):
        if t.get(k) and len(t[k]) < 90 and t[k] not in d and not (k == "name" and a == "F" and t[k].lower().startswith("airfield")):
            d.append(t[k] if k != "ref" else "Nr. " + t[k])
    return ", ".join(d)


def main():
    if not BAUSTEIN.get("notfall"):
        print("Notfall: ort.json bausteine.notfall ist aus, uebersprungen")
        return 0
    try:
        if "--lokal" in sys.argv:
            raise RuntimeError("--lokal: nur die vorhandenen Rohdaten auswerten")
        d = overpass(Q)
        with open(RAW, "w", encoding="utf-8") as f:
            json.dump(d, f, ensure_ascii=False)
    except Exception as e:
        print("Notfall: Abruf fehlgeschlagen (%s)" % e)
        if not os.path.exists(RAW):
            return 0
        d = json.load(open(RAW, encoding="utf-8"))
        print("Notfall: Rohdaten vom letzten Lauf werden verwendet")
    import prepare_gemeinde as pg  # Gemeindegrenze und Koordinaten
    from geo import xz
    items, cnt = [], {}
    for e in d["elements"]:
        t = e.get("tags") or {}
        a = art(t)
        if not a:
            continue
        la = e.get("lat") if "lat" in e else (e.get("center") or {}).get("lat")
        lo = e.get("lon") if "lon" in e else (e.get("center") or {}).get("lon")
        if la is None:
            continue
        x, z = xz(la, lo)
        if not pg.in_gemeinde(x, z):
            continue
        items.append([a, round(x, 1), round(z, 1), detail(a, t), "%s/%s" % (e["type"], e["id"])])
        cnt[a] = cnt.get(a, 0) + 1
    items.sort(key=lambda r: (r[0], r[1], r[2]))
    # Biogas- und Solaranlagen sind in OSM oft mehrfach erfasst (Anlage, Gebaeude, Generatoren): Eintraege nahe beieinander zusammenfassen
    merged = []
    for it in items:
        r = 80 if it[0] in ("G", "O") else 0
        dup = next((m for m in merged if r and m[0] == it[0] and ((m[1] - it[1]) ** 2 + (m[2] - it[2]) ** 2) ** 0.5 < r), None)
        if dup:
            if len(it[3]) > len(dup[3]):
                dup[3], dup[4] = it[3], it[4]
        else:
            merged.append(it)
    items = merged
    cnt = {}
    for it in items:
        cnt[it[0]] = cnt.get(it[0], 0) + 1
    out = {"stand": dt.date.today().isoformat(), "n": cnt, "items": items,
           "quelle": "© OpenStreetMap-Mitwirkende, ODbL"}
    with open(OUT, "w", encoding="utf-8") as f:
        f.write("window.AL_NOTFALL=" + json.dumps(out, ensure_ascii=False, separators=(",", ":")) + ";\n")
    print("Notfall und Energie in der Gemeinde: %d %s" % (len(items), cnt))
    return len(items)


if __name__ == "__main__":
    main()
