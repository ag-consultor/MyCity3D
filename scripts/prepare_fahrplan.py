"""Zieht aus dem VBB-GTFS-Feed die Abfahrten der Haltestellen in der Gemeinde aus ort.json.

Eingabe : data/raw/vbb/gtfs.zip  (https://unternehmen.vbb.de/gtfs, VBB, CC BY 4.0)
Ausgabe : site/data/fahrplan.js  window.AL_FAHRPLAN = Haltestellengruppen mit Abfahrten (Sollfahrplan)

Aufruf: python3 -I scripts/prepare_fahrplan.py
Der Feed wird nur gelesen (zipfile, csv), nichts daraus ausgefuehrt. Zeiten laufen ab Betriebstagbeginn
in Minuten und koennen ueber 1440 liegen (Fahrten nach Mitternacht). Betriebstage je Fahrplan-Kennung
stehen als 0/1-Zeichenkette ab `base` ueber `n` Tage.
"""
import csv, datetime as dt, io, json, math, os, re, sys, zipfile

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from fetch import boundary_rings  # noqa: E402
from geo import ORT, in_nb, pip, xz  # noqa: E402
NB_HALTE = tuple(h.lower() for h in ((ORT.get("nachbarort") or {}).get("haltestellen") or []))

ROOT = os.path.dirname(HERE)
ZIP = os.path.join(ROOT, "data", "raw", "vbb", "gtfs.zip")
OUT = os.path.join(ROOT, "site", "data", "fahrplan.js")
N_DAYS = 120
sys.stdout.reconfigure(encoding="utf-8")


def rows(z, name):
    with z.open(name) as f:
        rd = csv.DictReader(io.TextIOWrapper(f, encoding="utf-8-sig", newline=""))
        for r in rd:
            yield r


def hm(t):
    h, m, _s = t.split(":")
    return int(h) * 60 + int(m)


def rtype(t):
    t = int(t or 3)
    if 100 <= t < 200 or t == 2:
        return "bahn"
    if t in (1, 400, 401, 402, 403, 404, 405) or 400 <= t < 500:
        return "ubahn"
    if t == 109 or t == 1000:
        return "sbahn"
    if 700 <= t < 800 or t == 3:
        return "bus"
    if 900 <= t < 1000 or t == 0:
        return "tram"
    if t == 4 or 1000 <= t < 1100:
        return "fähre"
    return "sonst"


def main():
    rings = boundary_rings()
    z = zipfile.ZipFile(ZIP)

    # 1. Haltestellen der Gemeinde, zu Gruppen (Bahnhof/Haltestelle) zusammengefasst
    stops, allnames = {}, {}
    for r in rows(z, "stops.txt"):
        allnames[r["stop_id"]] = r["stop_name"]  # alle Haltestellen: Name des Starthalts einer Fahrt (Herkunft bei Ankuenften)
        if r.get("location_type") not in ("", "0", None):
            continue
        x, zz = xz(float(r["stop_lat"]), float(r["stop_lon"]))
        # Gemeinde, dazu im Nachbarort nur die in ort.json unter nachbarort.haltestellen genannten Haltestellen (schlank)
        if any(pip(x, zz, ring) for ring in rings) or (in_nb(x, zz) and r["stop_name"].lower() in NB_HALTE):
            stops[r["stop_id"]] = {"n": r["stop_name"], "x": x, "z": zz, "p": r.get("parent_station") or ""}
    print("Haltepunkte in der Gemeinde:", len(stops))
    groups, gid_of = [], {}
    for sid, s in sorted(stops.items(), key=lambda kv: kv[1]["n"]):
        hit = None
        for gi, g in enumerate(groups):
            if g["n"] == s["n"] and math.hypot(g["x"] - s["x"], g["z"] - s["z"]) < 250:
                hit = gi
                break
        if hit is None:
            groups.append({"n": s["n"], "x": s["x"], "z": s["z"], "ids": [], "d": []})
            hit = len(groups) - 1
        groups[hit]["ids"].append(sid)
        gid_of[sid] = hit
    print("Haltestellengruppen:", len(groups))

    # 2. Haltestellenzeiten: nur Zeilen der Gemeinde, dazu je Fahrt die letzte Haltestelle
    last_seq, cand, first_seq, acand = {}, [], {}, []
    for r in rows(z, "stop_times.txt"):
        t, sq = r["trip_id"], int(r["stop_sequence"])
        if sq > last_seq.get(t, -1):
            last_seq[t] = sq
        if t not in first_seq or sq < first_seq[t][0]:
            first_seq[t] = (sq, r["stop_id"])
        if r["stop_id"] in gid_of:
            cand.append((t, sq, r["departure_time"] or r["arrival_time"], gid_of[r["stop_id"]]))
            acand.append((t, sq, r["arrival_time"] or r["departure_time"], gid_of[r["stop_id"]]))
    cand = [c for c in cand if c[1] < last_seq[c[0]]]  # an der Endhaltestelle faehrt nichts ab
    acand = [c for c in acand if c[1] > first_seq[c[0]][0]]  # am Starthalt kommt nichts an
    trips_needed = {c[0] for c in cand} | {c[0] for c in acand}
    print("Abfahrten (alle Tage):", len(cand), "Fahrten:", len(trips_needed))

    # 3. Fahrten, Linien, Betreiber
    trips = {}
    for r in rows(z, "trips.txt"):
        if r["trip_id"] in trips_needed:
            trips[r["trip_id"]] = (r["route_id"], r["service_id"], r.get("trip_headsign") or "")
    agencies = {r["agency_id"]: r["agency_name"] for r in rows(z, "agency.txt")}
    routes = {}
    for r in rows(z, "routes.txt"):
        name = r.get("route_short_name") or r.get("route_long_name") or "?"
        typ = rtype(r["route_type"])
        # Bus unter einer Bahnliniennummer (RE3, RB33 ...): im Feed als Typ 700 gefuehrt, vermutlich Schienenersatzverkehr.
        # Das ist eine Schlussfolgerung aus den Daten, kein Feld des Feeds, die Seite kennzeichnet es entsprechend.
        if typ == "bus" and re.match(r"^(RE|RB|S|U|IC|ICE|EC|FEX)\d", name):
            typ = "sev"
        routes[r["route_id"]] = (name, typ, agencies.get(r.get("agency_id", ""), ""))

    # 4. Betriebstage
    base = dt.date.today() - dt.timedelta(days=1)
    days = [base + dt.timedelta(days=i) for i in range(N_DAYS)]
    used = {v[1] for v in trips.values()}
    cal, valid = {}, [None, None]
    for r in rows(z, "calendar.txt"):
        if r["service_id"] in used:
            cal[r["service_id"]] = r
            a, b = r["start_date"], r["end_date"]
            valid[0] = a if valid[0] is None else min(valid[0], a)
            valid[1] = b if valid[1] is None else max(valid[1], b)
    exc = {}
    for r in rows(z, "calendar_dates.txt"):
        if r["service_id"] in used:
            exc.setdefault(r["service_id"], {})[r["date"]] = r["exception_type"]
    wk = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"]
    svc_ids = sorted(used)
    svc_idx = {s: i for i, s in enumerate(svc_ids)}
    svc_bits = []
    for s in svc_ids:
        bits = []
        c = cal.get(s)
        for d in days:
            ds = d.strftime("%Y%m%d")
            on = bool(c and c["start_date"] <= ds <= c["end_date"] and c[wk[d.weekday()]] == "1")
            e = exc.get(s, {}).get(ds)
            if e == "1":
                on = True
            elif e == "2":
                on = False
            bits.append("1" if on else "0")
        svc_bits.append("".join(bits))
        if exc.get(s):
            for ds in exc[s]:
                valid[0] = ds if valid[0] is None else min(valid[0], ds)
                valid[1] = ds if valid[1] is None else max(valid[1], ds)

    # 5. Ausgabe: Linien und Fahrtziele nummeriert, Abfahrten je Gruppe sortiert
    r_list, r_idx, h_list, h_idx = [], {}, [], {}
    for t, sq, dep, gi in cand:
        rid, sid, head = trips[t]
        if rid not in r_idx:
            r_idx[rid] = len(r_list)
            r_list.append(list(routes.get(rid, ("?", "sonst", ""))))
        if head not in h_idx:
            h_idx[head] = len(h_list)
            h_list.append(head)
        groups[gi]["d"].append([hm(dep), r_idx[rid], h_idx[head], svc_idx[sid]])
    RAIL = ("bahn", "sbahn", "ubahn", "sev")
    n_arr = 0
    for t, sq, arr, gi in acand:  # Ankuenfte nur von Zuegen (und Schienenersatzverkehr), mit Herkunft = Name des Starthalts der Fahrt
        rid, sid, head = trips[t]
        if routes.get(rid, ("?", "sonst", ""))[1] not in RAIL:
            continue
        if rid not in r_idx:
            r_idx[rid] = len(r_list)
            r_list.append(list(routes.get(rid, ("?", "sonst", ""))))
        origin = re.sub(r"\s*\(Berlin\)$", "", allnames.get(first_seq[t][1], "")) or head
        if origin not in h_idx:
            h_idx[origin] = len(h_list)
            h_list.append(origin)
        groups[gi].setdefault("a", []).append([hm(arr), r_idx[rid], h_idx[origin], svc_idx[sid]])
        n_arr += 1
    print("Ankuenfte (Bahn, alle Tage):", n_arr)
    for g in groups:
        if g.get("a"):
            g["a"] = [list(x) for x in sorted({tuple(x) for x in g["a"]})]
        g["d"] = sorted({tuple(x) for x in g["d"]})
        g["d"] = [list(x) for x in g["d"]]
        g["x"], g["z"] = round(g["x"], 1), round(g["z"], 1)
        # Kennung der Haltestelle im Echtzeitdienst (HAFAS): steckt in der Feed-Kennung, z. B. de:12072:900245128::1 -> 900245128
        hid = next((m.group(1) for m in (re.match(r"^de:\d+:(\d{9})(?::|$)", i) for i in g["ids"]) if m), None)
        if hid:
            g["h"] = hid
        del g["ids"]
    out = {"base": base.isoformat(), "n": N_DAYS, "feedFrom": valid[0], "feedTo": valid[1], "stand": dt.date.today().isoformat(),
           "groups": groups, "routes": r_list, "heads": h_list, "svc": svc_bits}
    with open(OUT, "w", encoding="utf-8") as f:
        f.write("window.AL_FAHRPLAN=" + json.dumps(out, ensure_ascii=False, separators=(",", ":")) + ";\n")
    print("geschrieben:", OUT, round(os.path.getsize(OUT) / 1e6, 2), "MB; Feed-Gueltigkeit", valid)
    for g in groups:
        print("  %-38s %5d Abfahrten %5d Ankuenfte" % (g["n"], len(g["d"]), len(g.get("a", []))))


if __name__ == "__main__":
    main()
