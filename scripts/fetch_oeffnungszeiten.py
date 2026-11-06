"""Liest Oeffnungszeiten von den Webseiten der Betriebe, wenn OpenStreetMap keine hat.

Quelle: nur die in OpenStreetMap hinterlegte Webseite des Ortes (eine Anfrage je Seite, robots.txt wird beachtet,
2 Sekunden Pause, keine sozialen Netzwerke). Gelesen werden ausschliesslich maschinenlesbare Angaben der Seite
(schema.org: JSON-LD "openingHoursSpecification"/"openingHours", Mikrodaten). Freitext wird NICHT geraten.
Ergebnis: data/ergaenzung/oeffnungszeiten_web.json, wird von prepare_gemeinde.py eingelesen.
Die Zeiten sind die Angabe des Betriebs, nicht geprueft; die Seite kennzeichnet sie entsprechend.

Aufruf: python3 scripts/fetch_oeffnungszeiten.py [--probe]     (--probe: nur anzeigen, nichts schreiben)
"""
import datetime as dt, html, json, os, re, sys, time, urllib.parse, urllib.request, urllib.robotparser

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
META = os.path.join(ROOT, "site", "data", "meta.js")
OUT = os.path.join(ROOT, "data", "ergaenzung", "oeffnungszeiten_web.json")
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from geo import ORT  # noqa: E402
UA = ORT["kontakt_ua"]
SKIP_HOSTS = ("facebook.com", "instagram.com", "linkedin.com", "twitter.com", "x.com", "youtube.com", "google.", "tiktok.com", "wikipedia.org")
PAUSE = 2.0
sys.stdout.reconfigure(encoding="utf-8")

DAY = {"monday": "Mo", "tuesday": "Tu", "wednesday": "We", "thursday": "Th", "friday": "Fr", "saturday": "Sa", "sunday": "Su"}
ORDER = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"]


def load_pois():
    s = open(META, encoding="utf-8").read()
    m = json.loads(re.search(r"window\.AL_META=(.*);\s*$", s, re.S).group(1))
    return m["pois"]


def fetch(url, robots):
    u = urllib.parse.urlparse(url)
    host = u.netloc
    if host not in robots:
        rp = urllib.robotparser.RobotFileParser("%s://%s/robots.txt" % (u.scheme, host))
        try:
            rp.read()
        except Exception:
            rp = None  # keine lesbare robots.txt: wie ueblich erlaubt
        robots[host] = rp
    rp = robots[host]
    if rp is not None and not rp.can_fetch(UA, url):
        raise PermissionError("robots.txt untersagt den Abruf")
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept-Language": "de"})
    with urllib.request.urlopen(req, timeout=20) as r:
        return r.read(2_000_000).decode("utf-8", "replace"), r.geturl()


def hhmm(t):
    m = re.match(r"(\d{1,2}):(\d{2})", str(t))
    return "%02d:%02d" % (int(m.group(1)), int(m.group(2))) if m else None


def from_spec(spec):
    """openingHoursSpecification (Liste oder einzelnes Objekt) -> OSM-Schreibweise oder None."""
    if isinstance(spec, dict):
        spec = [spec]
    per_day = {}
    for s in spec:
        if not isinstance(s, dict):
            continue
        days = s.get("dayOfWeek") or []
        days = [days] if isinstance(days, str) else days
        o, c = hhmm(s.get("opens")), hhmm(s.get("closes"))
        for d in days:
            k = DAY.get(str(d).rsplit("/", 1)[-1].lower())
            if k and o and c and c != o:
                per_day.setdefault(k, []).append("%s-%s" % (o, c))
    if not per_day:
        return None
    # gleiche Zeiten benachbarter Tage zusammenfassen
    groups, i = [], 0
    days = [d for d in ORDER if d in per_day]
    while i < len(days):
        j = i
        while j + 1 < len(days) and ORDER.index(days[j + 1]) == ORDER.index(days[j]) + 1 and per_day[days[j + 1]] == per_day[days[i]]:
            j += 1
        groups.append(("%s-%s" % (days[i], days[j]) if j > i else days[i]) + " " + ",".join(per_day[days[i]]))
        i = j + 1
    return "; ".join(groups)


def from_string(v):
    """openingHours als Text, z. B. 'Mo-Fr 09:00-17:00' -> OSM-Schreibweise oder None (nur eindeutige Formen)."""
    vs = [v] if isinstance(v, str) else [x for x in v if isinstance(x, str)]
    out = []
    for x in vs:
        x = x.strip()
        m = re.match(r"^((?:Mo|Tu|We|Th|Fr|Sa|Su)(?:\s*-\s*(?:Mo|Tu|We|Th|Fr|Sa|Su))?(?:\s*,\s*(?:Mo|Tu|We|Th|Fr|Sa|Su)(?:\s*-\s*(?:Mo|Tu|We|Th|Fr|Sa|Su))?)*)\s+(\d{1,2}:\d{2}\s*-\s*\d{1,2}:\d{2}(?:\s*,\s*\d{1,2}:\d{2}\s*-\s*\d{1,2}:\d{2})*)$", x)
        if not m:
            return None
        out.append(re.sub(r"\s*-\s*", "-", m.group(1)) + " " + re.sub(r"\s*-\s*", "-", re.sub(r"\s*,\s*", ",", m.group(2))))
    return "; ".join(out) if out else None


def walk(o):
    if isinstance(o, dict):
        yield o
        for v in o.values():
            yield from walk(v)
    elif isinstance(o, list):
        for v in o:
            yield from walk(v)


def parse(page):
    """Gibt (oeffnungszeiten, art) zurueck oder (None, grund)."""
    blocks = re.findall(r'<script[^>]+type=["\']application/ld\+json["\'][^>]*>(.*?)</script>', page, re.S | re.I)
    if not blocks:
        return None, "keine strukturierten Daten (kein JSON-LD)"
    found_any = False
    for b in blocks:
        try:
            data = json.loads(html.unescape(b.strip()))
        except Exception:
            continue
        for node in walk(data):
            if "openingHoursSpecification" in node:
                found_any = True
                r = from_spec(node["openingHoursSpecification"])
                if r:
                    return r, "JSON-LD openingHoursSpecification"
            if "openingHours" in node:
                found_any = True
                r = from_string(node["openingHours"])
                if r:
                    return r, "JSON-LD openingHours"
    return None, "JSON-LD ohne lesbare Oeffnungszeiten" if found_any else "JSON-LD ohne Oeffnungszeiten-Feld"


def main():
    probe = "--probe" in sys.argv
    pois = [p for p in load_pois() if p.get("web") and not p.get("oh")]
    old = json.load(open(OUT, encoding="utf-8")) if os.path.exists(OUT) else {"items": {}}
    items, robots, report = {}, {}, []
    today = dt.date.today().isoformat()
    for k, p in enumerate(pois):
        url = p["web"]
        host = urllib.parse.urlparse(url).netloc.lower()
        if not url.startswith("http") or any(h in host for h in SKIP_HOSTS):
            report.append((p["n"], url, None, "uebersprungen (soziales Netzwerk oder keine http-Adresse)"))
            continue
        try:
            page, final = fetch(url, robots)
            oh, why = parse(page)
        except PermissionError as e:
            oh, why = None, str(e)
        except Exception as e:
            oh, why = None, "Abruf fehlgeschlagen: %s" % str(e)[:80]
        report.append((p["n"], url, oh, why))
        if oh:
            items[p["osm"]] = {"name": p["n"], "oh": oh, "url": url, "stand": today}
        elif p["osm"] in old.get("items", {}):
            items[p["osm"]] = old["items"][p["osm"]]  # Abruf diesmal ohne Ergebnis: letzten Stand behalten
        if k < len(pois) - 1:
            time.sleep(PAUSE)
    ok = sum(1 for r in report if r[2])
    print("Kandidaten (Webseite, aber keine Oeffnungszeiten in OSM): %d | gelesen: %d" % (len(pois), ok))
    for n, u, oh, why in report:
        print("  %-3s %-40s %s" % ("OK" if oh else "--", n[:40], oh if oh else why))
    if not probe:
        os.makedirs(os.path.dirname(OUT), exist_ok=True)
        json.dump({"stand": today, "items": items}, open(OUT, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
        print("geschrieben:", OUT, "(%d Orte)" % len(items))


if __name__ == "__main__":
    main()
