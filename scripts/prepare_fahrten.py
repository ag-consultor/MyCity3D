"""Zieht aus dem VBB-GTFS-Feed alle Fahrten, die den Kartenausschnitt der Gemeinde beruehren.

Eingabe : data/raw/vbb/gtfs.zip  (https://unternehmen.vbb.de/gtfs, VBB, CC BY 4.0)
Ausgabe : site/data/fahrten.js   window.AL_FAHRTEN = Fahrten mit Halten (x, z, Ankunft, Abfahrt) allein aus dem Sollfahrplan

Damit fahren im Browser Zuege und Busse ohne Live-Daten. Je Fahrt stehen nur die Halte im erweiterten Ausschnitt
(x -15000..15000, z -11000..11000 m) plus je ein Halt davor und danach, damit Fahrzeuge von aussen hereinkommen und
hinausfahren. Eine Fahrt zaehlt als beruehrend, wenn ein Halt im Ausschnitt liegt oder die Strecke zwischen zwei
aufeinanderfolgenden Halten (Luftlinie) den Ausschnitt schneidet (Durchfahrt ohne Halt).
Zeiten: ganze Sekunden seit Betriebstagbeginn, Werte ueber 86400 sind Fahrten nach Mitternacht.
Betriebstage wie in prepare_fahrplan.py: 0/1-Zeichenkette ab `base` ueber `n` Tage, identische Ketten zusammengelegt.

Aufruf: python3 -I scripts/prepare_fahrten.py
Der Feed wird nur gelesen (zipfile, csv), nichts daraus ausgefuehrt.
"""
import datetime as dt, json, os, sys, zipfile

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from geo import xz  # noqa: E402
from prepare_fahrplan import rows, rtype, N_DAYS, ZIP  # noqa: E402  (Funktionen und Konstanten, main() laeuft nicht)

import re  # noqa: E402

ROOT = os.path.dirname(HERE)
OUT = os.path.join(ROOT, "site", "data", "fahrten.js")
X0, X1, Z0, Z1 = -15000.0, 15000.0, -11000.0, 11000.0
sys.stdout.reconfigure(encoding="utf-8")


def sec(t):
    h, m, s = t.split(":")
    return int(h) * 3600 + int(m) * 60 + int(s)


def inbox(x, z):
    return X0 <= x <= X1 and Z0 <= z <= Z1


def seg_hits(ax, az, bx, bz):
    """Schneidet die Strecke a-b das Rechteck? (Liang-Barsky)"""
    t0, t1 = 0.0, 1.0
    dx, dz = bx - ax, bz - az
    for p, q in ((-dx, ax - X0), (dx, X1 - ax), (-dz, az - Z0), (dz, Z1 - az)):
        if p == 0:
            if q < 0:
                return False
        else:
            r = q / p
            if p < 0:
                if r > t1:
                    return False
                t0 = max(t0, r)
            else:
                if r < t0:
                    return False
                t1 = min(t1, r)
    return True


def main():
    z = zipfile.ZipFile(ZIP)

    # 1. Alle Haltepunkte mit lokalen Koordinaten
    pos = {}
    for r in rows(z, "stops.txt"):
        try:
            pos[r["stop_id"]] = xz(float(r["stop_lat"]), float(r["stop_lon"]))
        except (ValueError, KeyError):
            pass
    inside = {sid for sid, (x, zz) in pos.items() if inbox(x, zz)}
    print("Haltepunkte im Feed:", len(pos), "davon im Ausschnitt:", len(inside))

    # 2. Haltezeiten, alle Fahrten sammeln (Zeilen je Fahrt), danach nach Beruehrung filtern
    seqs = {}
    for r in rows(z, "stop_times.txt"):
        if r["stop_id"] not in pos:
            continue
        a, d = r["arrival_time"].strip(), r["departure_time"].strip()
        if not a and not d:
            continue
        seqs.setdefault(r["trip_id"], []).append((int(r["stop_sequence"]), r["stop_id"], a or d, d or a))
    print("Fahrten im Feed:", len(seqs))

    kept = {}  # trip_id -> [[x, z, an, ab], ...]
    for t, lst in seqs.items():
        lst.sort()
        marked = [i for i, s in enumerate(lst) if s[1] in inside]
        if not marked:
            # Durchfahrt ohne Halt im Ausschnitt: zaehlt, wenn eine Strecke zwischen zwei Halten den Ausschnitt schneidet
            for i in range(len(lst) - 1):
                a, b = pos[lst[i][1]], pos[lst[i + 1][1]]
                if seg_hits(a[0], a[1], b[0], b[1]):
                    marked += [i, i + 1]
        if not marked:
            continue
        lo, hi = max(min(marked) - 1, 0), min(max(marked) + 1, len(lst) - 1)
        stops = []
        for s in lst[lo:hi + 1]:
            x, zz = pos[s[1]]
            stops.append([round(x, 1), round(zz, 1), sec(s[2]), sec(s[3])])
        if len(stops) >= 2:
            kept[t] = stops
    del seqs
    print("beruehrende Fahrten:", len(kept))

    # 3. Fahrten, Linien, Betreiber
    trips = {}
    for r in rows(z, "trips.txt"):
        if r["trip_id"] in kept:
            trips[r["trip_id"]] = (r["route_id"], r["service_id"], r.get("trip_headsign") or "")
    agencies = {r["agency_id"]: r["agency_name"] for r in rows(z, "agency.txt")}
    routes = {}
    for r in rows(z, "routes.txt"):
        name = r.get("route_short_name") or r.get("route_long_name") or "?"
        typ = rtype(r["route_type"])
        if typ == "bus" and re.match(r"^(RE|RB|S|U|IC|ICE|EC|FEX)\d", name):
            typ = "sev"  # wie prepare_fahrplan.py: Bus unter Bahnliniennummer = vermutlich Schienenersatzverkehr
        routes[r["route_id"]] = (name, typ, agencies.get(r.get("agency_id", ""), ""))

    # 4. Betriebstage (wie prepare_fahrplan.py), identische Bitketten zusammenlegen
    base = dt.date.today() - dt.timedelta(days=1)
    days = [base + dt.timedelta(days=i) for i in range(N_DAYS)]
    used = {v[1] for v in trips.values()}
    cal = {r["service_id"]: r for r in rows(z, "calendar.txt") if r["service_id"] in used}
    exc = {}
    for r in rows(z, "calendar_dates.txt"):
        if r["service_id"] in used:
            exc.setdefault(r["service_id"], {})[r["date"]] = r["exception_type"]
    wk = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"]
    bits_of = {}
    for s in sorted(used):
        bits, c = [], cal.get(s)
        for d in days:
            ds = d.strftime("%Y%m%d")
            on = bool(c and c["start_date"] <= ds <= c["end_date"] and c[wk[d.weekday()]] == "1")
            e = exc.get(s, {}).get(ds)
            if e == "1":
                on = True
            elif e == "2":
                on = False
            bits.append("1" if on else "0")
        bits_of[s] = "".join(bits)
    zero = "0" * N_DAYS

    # 5. Ausgabe
    r_list, r_idx, h_list, h_idx, s_list, s_idx = [], {}, [], {}, [], {}
    out_trips, per_line, dropped = [], {}, 0
    for t in sorted(kept, key=lambda k: kept[k][0][3]):
        if t not in trips:
            continue
        rid, sid, head = trips[t]
        bits = bits_of[sid]
        if bits == zero:  # faehrt im Zeitfenster nie
            dropped += 1
            continue
        if rid not in r_idx:
            r_idx[rid] = len(r_list)
            r_list.append(list(routes.get(rid, ("?", "sonst", ""))))
        if head not in h_idx:
            h_idx[head] = len(h_list)
            h_list.append(head)
        if bits not in s_idx:
            s_idx[bits] = len(s_list)
            s_list.append(bits)
        out_trips.append([r_idx[rid], h_idx[head], s_idx[bits], kept[t]])
        nm = r_list[r_idx[rid]][0]
        per_line[nm] = per_line.get(nm, 0) + 1
    out = {"base": base.isoformat(), "n": N_DAYS, "stand": dt.date.today().isoformat(),
           "routes": r_list, "heads": h_list, "svc": s_list, "trips": out_trips}
    with open(OUT, "w", encoding="utf-8", newline="") as f:
        f.write("window.AL_FAHRTEN=" + json.dumps(out, ensure_ascii=False, separators=(",", ":")) + ";\n")
    size = os.path.getsize(OUT)
    print("geschrieben:", OUT, round(size / 1024), "KB;", len(out_trips), "Fahrten,", len(r_list), "Linien,", len(h_list), "Ziele,",
          len(s_list), "Betriebstagmuster; ohne Betriebstag im Zeitfenster verworfen:", dropped)
    for nm, c in sorted(per_line.items(), key=lambda kv: -kv[1]):
        print("  %-12s %5d Fahrten" % (nm, c))


if __name__ == "__main__":
    main()
