"""Historische Klimadaten (DWD, Monatswerte): Jahres- und Monatswerte von Stationen, die ort.json unter bausteine.klima.stationen nennt.

Quelle : DWD Climate Data Center, observations_germany/climate/monthly/kl (historical + recent), Lizenz CC BY 4.0, Quellenvermerk "Deutscher Wetterdienst".
Stationen: [[Stationsnummer, Anzeigename, Entfernung in km, Lage-Text], ...] aus ort.json, z. B. ["02856", "Beispielort", 10.3, "in der Gemeinde"].
         Die Stationsliste steht beim DWD: .../monthly/kl/historical/KL_Monatswerte_Beschreibung_Stationen.txt
Ausgabe: site/data/klima.js   window.AL_KLIMA = {stationen:[{id,name,km,von,bis,jahre:[[jahr,tmittel,niederschlag,sonne,n]], monate:{}}], stand}
Nur vollstaendige Jahre (12 Monate mit Temperatur und Niederschlag) gehen in die Jahresreihen. Aufruf: python scripts/fetch_klima.py (einmal im Jahr genuegt)
"""
import datetime as dt, io, json, os, re, sys, urllib.request, zipfile

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from geo import ORT  # noqa: E402
ROOT = os.path.dirname(HERE)
OUT = os.path.join(ROOT, "site", "data", "klima.js")
RAW = os.path.join(ROOT, "data", "raw", "klima")
BASE = "https://opendata.dwd.de/climate_environment/CDC/observations_germany/climate/monthly/kl/"
STATIONEN = [tuple(x) for x in ((ORT.get("bausteine") or {}).get("klima") or {}).get("stationen", [])]
sys.stdout.reconfigure(encoding="utf-8")


def get(url):
    req = urllib.request.Request(url, headers={"User-Agent": ORT["kontakt_ua"]})
    return urllib.request.urlopen(req, timeout=180).read()


def zips(sid):
    out = []
    for sub in ("historical", "recent"):
        idx = get(BASE + sub + "/").decode("latin-1")
        for m in re.finditer(r'href="(monatswerte_KL_%s_[^"]+\.zip)"' % sid, idx):
            out.append((sub, m.group(1)))
    return out


def lies(sid):
    rows = {}
    for sub, fn in zips(sid):
        z = zipfile.ZipFile(io.BytesIO(get(BASE + sub + "/" + fn)))
        name = next(n for n in z.namelist() if n.startswith("produkt_klima_monat"))
        txt = z.read(name).decode("latin-1")
        ls = txt.splitlines()
        kopf = [c.strip() for c in ls[0].split(";")]
        for l in ls[1:]:
            p = [c.strip() for c in l.split(";")]
            if len(p) < len(kopf) or not p[1].isdigit():
                continue
            r = dict(zip(kopf, p))
            rows[r["MESS_DATUM_BEGINN"][:6]] = r  # recent ueberschreibt historical bei Ueberlappung
    return rows


def num(v):
    try:
        x = float(v)
    except (TypeError, ValueError):
        return None
    return None if x <= -900 else x


def main():
    if not STATIONEN:
        print("Klima: ort.json bausteine.klima.stationen ist leer, uebersprungen")
        return 0
    os.makedirs(RAW, exist_ok=True)
    stationen = []
    for sid, name, km, lage in STATIONEN:
        rows = lies(sid)
        if not rows:
            print("Station", sid, "ohne Daten")
            continue
        jahre = {}
        mon = {m: [] for m in range(1, 13)}
        for ym, r in sorted(rows.items()):
            y, m = int(ym[:4]), int(ym[4:6])
            t, rr, sd = num(r.get("MO_TT")), num(r.get("MO_RR")), num(r.get("MO_SD_S"))
            jahre.setdefault(y, []).append((m, t, rr, sd))
            if t is not None and rr is not None:
                mon[m].append((y, t, rr))
        res = []
        for y in sorted(jahre):
            L = jahre[y]
            if len(L) < 12 or any(x[1] is None or x[2] is None for x in L):
                continue
            sonne = [x[3] for x in L]
            res.append([y, round(sum(x[1] for x in L) / 12, 2), round(sum(x[2] for x in L), 1), round(sum(sonne), 0) if all(s is not None for s in sonne) else None])
        # Monatsmittel der Station ueber alle vollstaendigen Jahre 1991 bis 2020 (WMO-Referenzperiode), sonst alle
        ref = {m: [v for v in mon[m] if 1991 <= v[0] <= 2020] for m in mon}
        use = ref if all(len(ref[m]) >= 15 for m in ref) else mon
        monate = {str(m): [round(sum(v[1] for v in use[m]) / len(use[m]), 1), round(sum(v[2] for v in use[m]) / len(use[m]), 1), len(use[m])] for m in use if use[m]}
        # laufendes Jahr: bisherige Monate
        lj = dt.date.today().year
        lauf = [[m, t, rr] for (m, t, rr, sd) in jahre.get(lj, [])]
        stationen.append({"id": sid.lstrip("0"), "name": name, "km": km, "lage": lage, "von": res[0][0] if res else None, "bis": res[-1][0] if res else None,
                          "jahre": res, "monate": monate, "referenz": "1991 bis 2020" if use is ref else "alle Jahre", "laufend": {"jahr": lj, "monate": lauf}})
        print("Station %s %s: %d volle Jahre (%s bis %s), laufendes Jahr %d Monate" % (sid, name, len(res), res[0][0] if res else "-", res[-1][0] if res else "-", len(lauf)))
    out = {"stand": dt.date.today().isoformat(), "stationen": stationen,
           "quelle": "Deutscher Wetterdienst (DWD), Climate Data Center, Monatswerte der Stationsbeobachtungen", "lizenz": "CC BY 4.0"}
    with open(OUT, "w", encoding="utf-8") as f:
        f.write("window.AL_KLIMA=" + json.dumps(out, ensure_ascii=False, separators=(",", ":")) + ";\n")
    print("geschrieben:", OUT, round(os.path.getsize(OUT) / 1024), "KB")


if __name__ == "__main__":
    main()
