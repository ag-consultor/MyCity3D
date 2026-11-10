"""Baustellen und Sperrungen in Bayern aus der Mobilithek (DATEX II v2) fuer die Seite aufbereiten.

Quelle: "Baustellenmeldungen in Bayern", Zentralstelle Verkehrsmanagement (VIZ-BY), ueber mobilithek.info.
Kostenfrei, Lizenz GeoNutzV, auf die Quellennennung wird verzichtet (GovData). Siehe docs/BAYERN.md.

Zugang (einmalig, durch den Betreiber):
  1. Konto bei mobilithek.info, Angebot "Baustellenmeldungen in Bayern" abonnieren, Maschinenkonto anlegen
  2. Zertifikat (.p12) ausserhalb des Projekts ablegen und in PEM umwandeln:
       openssl pkcs12 -in client.p12 -clcerts -nokeys -out client.crt
       openssl pkcs12 -in client.p12 -nocerts -nodes -out client.key
  3. Pfade und Abo-Nummer in data/state/mobilithek.json eintragen (nicht versioniert):
       {"abo": "123456789012345678", "zertifikat": "C:/.../client.crt", "schluessel": "C:/.../client.key"}
     oder als Umgebungsvariablen MOBILITHEK_SUBSCRIPTION_ID, MOBILITHEK_CERT_FILE, MOBILITHEK_KEY_FILE.

Aufruf:
  python scripts/fetch_baustellen_by.py                      Abruf ueber das Abonnement
  python scripts/fetch_baustellen_by.py --datei meldungen.xml   vorhandene DATEX-II-Datei (z. B. Referenzdatei von BayernInfo)
  --stichtag 2025-06-10   zeigt den Stand zu diesem Tag statt heute (nur zum Testen mit alten Dateien)

Schreibt site/data/baustellen.json: Meldungen, die heute laufen oder in den naechsten 30 Tagen beginnen,
getrennt nach Gemeinde ("hier") und Umgebung bis UMKREIS_KM um den Ortsmittelpunkt.
"""
import argparse
import datetime as dt
import gzip
import json
import math
import os
import re
import ssl
import sys
import urllib.request
import xml.etree.ElementTree as ET

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from geo import LAND, LAT0, LON0, ORT, ROOT, pip, stitch, xz  # noqa: E402

NS = "{http://datex2.eu/schema/2/2_0}"
XSI = "{http://www.w3.org/2001/XMLSchema-instance}type"
BASIS = "https://mobilithek.info:8443/mobilithek/api/v1.0/subscription/{id}/clientPullService?subscriptionID={id}"
UMKREIS_KM = 15.0
VORLAUF_TAGE = 30
SPERR = {"roadClosed", "carriagewayClosures"}
RAW = os.path.join(ROOT, "data", "raw", "gemeinde")
OUT = os.path.join(ROOT, "site", "data", "baustellen.json")


def zugang():
    p = os.path.join(ROOT, "data", "state", "mobilithek.json")
    cfg = json.load(open(p, encoding="utf-8")) if os.path.exists(p) else {}
    abo = os.environ.get("MOBILITHEK_SUBSCRIPTION_ID") or cfg.get("abo")
    crt = os.environ.get("MOBILITHEK_CERT_FILE") or cfg.get("zertifikat")
    key = os.environ.get("MOBILITHEK_KEY_FILE") or cfg.get("schluessel")
    if not (abo and crt and key):
        raise SystemExit("Kein Mobilithek-Zugang eingetragen (data/state/mobilithek.json oder MOBILITHEK_*). Siehe Kopf dieses Skripts.")
    if not re.fullmatch(r"\d+", str(abo).strip()):
        raise SystemExit("Abo-Nummer darf nur Ziffern enthalten: %r" % abo)
    return str(abo).strip(), crt, key


def abrufen():
    abo, crt, key = zugang()
    ctx = ssl.create_default_context()
    ctx.load_cert_chain(crt, key)
    req = urllib.request.Request(BASIS.format(id=abo), headers={"Accept-Encoding": "gzip", "User-Agent": ORT.get("kontakt_ua", "MyCity3D")})
    with urllib.request.urlopen(req, context=ctx, timeout=180) as r:
        blob = r.read()
        if r.headers.get("Content-Encoding") == "gzip" or blob[:2] == b"\x1f\x8b":
            blob = gzip.decompress(blob)
    return blob


def gemeinde_ringe():
    rel = json.load(open(os.path.join(RAW, "boundary.json"), encoding="utf-8"))["elements"][0]
    parts = [[(g["lat"], g["lon"]) for g in m["geometry"]] for m in rel.get("members", [])
             if m.get("type") == "way" and (m.get("role") or "outer") == "outer" and m.get("geometry")]
    return [[xz(a, b) for a, b in r] for r in stitch(parts)]


def km(lat, lon):
    return math.hypot((lat - LAT0) * 111.132, (lon - LON0) * 111.320 * math.cos(math.radians(LAT0)))


def text_of(rec, art="description"):
    for c in rec.iter(NS + "generalPublicComment"):
        t = c.find(NS + "commentType")
        if t is not None and t.text == art:
            v = c.find(".//" + NS + "value")
            if v is not None and v.text:
                return v.text.strip()
    return ""


def meldungen(quelle, stichtag):
    heute = stichtag.isoformat()
    bis_plan = (stichtag + dt.timedelta(days=VORLAUF_TAGE)).isoformat()
    ringe = gemeinde_ringe()
    sit = {}
    for _, el in ET.iterparse(quelle):
        if el.tag != NS + "situationRecord":
            continue
        sid = re.sub(r"\.[^/]*$", "", el.get("id", ""))  # Teilmeldungen (….0, ….diversionRoute.0) einer Lage zusammenfassen
        art = el.get(XSI, "")
        von = (el.findtext(".//" + NS + "overallStartTime") or "")[:10]
        bis = (el.findtext(".//" + NS + "overallEndTime") or "")[:10]
        pts = []
        for p in el.iter(NS + "pointCoordinates"):
            la, lo = p.findtext(NS + "latitude"), p.findtext(NS + "longitude")
            if la and lo:
                pts.append((float(la), float(lo)))
        typen = {e.text for k in ("roadOrCarriagewayOrLaneManagementType", "roadMaintenanceType", "generalNetworkManagementType") for e in el.iter(NS + k)}
        g = sit.setdefault(sid, {"id": sid, "von": von, "bis": bis, "text": "", "umleitung": "", "pts": [], "sperr": False, "arten": set()})
        if art == "ReroutingManagement":
            g["umleitung"] = g["umleitung"] or text_of(el)
        else:
            g["text"] = g["text"] or text_of(el)
            g["pts"] += pts  # Umleitungsstrecken zaehlen nicht fuer die Lage der Baustelle
        g["sperr"] = g["sperr"] or bool(typen & SPERR)
        g["arten"].add(art)
        if von and (not g["von"] or von < g["von"]):
            g["von"] = von
        if bis and bis > g["bis"]:
            g["bis"] = bis
        el.clear()
    out = []
    for g in sit.values():
        pts = g["pts"]
        if not pts or not g["bis"] or g["bis"] < heute or (g["von"] or heute) > bis_plan:
            continue
        hier = any(any(pip(*xz(la, lo), r) for r in ringe) for la, lo in pts)
        d = min(km(la, lo) for la, lo in pts)
        if not hier and d > UMKREIS_KM:
            continue
        text = g["text"] or g["umleitung"]
        erste = text.split("\n")[0]
        m = re.match(r"^((?:A|B|St|K|[A-Z]{1,3}\s?)\s?\d+[a-z]?)\b\s*(.*)$", erste)
        la = sum(p[0] for p in pts) / len(pts); lo = sum(p[1] for p in pts) / len(pts)
        out.append({"strasse": m.group(1).replace(" ", "") if m else "", "ort": (m.group(2) if m else erste)[:120],
                    "von": g["von"], "bis": g["bis"], "sperr": g["sperr"], "text": text[:900],
                    "umleitung": g["umleitung"][:600] if g["text"] and g["umleitung"] and g["umleitung"].strip() not in g["text"] else "",
                    "hier": hier, "km": round(d, 1), "lat": round(la, 5), "lon": round(lo, 5)})
    out.sort(key=lambda e: (not e["hier"], e["von"], e["km"]))
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--datei", help="vorhandene DATEX-II-Datei statt Abruf")
    ap.add_argument("--stichtag", help="JJJJ-MM-TT, Standard heute")
    a = ap.parse_args()
    if LAND.get("baustellen") != "mobilithek":
        raise SystemExit("Fuer %s sind keine Mobilithek-Baustellen verdrahtet (scripts/laender.py)." % LAND["name"])
    stichtag = dt.date.fromisoformat(a.stichtag) if a.stichtag else dt.date.today()
    if a.datei:
        quelle = a.datei
    else:
        blob = abrufen()
        quelle = os.path.join(RAW, "baustellen_mobilithek.xml")
        open(quelle, "wb").write(blob)
    items = meldungen(quelle, stichtag)
    res = {"stand": dt.datetime.now().strftime("%Y-%m-%dT%H:%M"), "stichtag": stichtag.isoformat(), "umkreisKm": UMKREIS_KM,
           "test": bool(a.datei and a.stichtag), "meldungen": items}
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", encoding="utf-8", newline="\n") as f:
        json.dump(res, f, ensure_ascii=False, separators=(",", ":"))
    print("Baustellen: %d in %s, %d in der Umgebung (bis %d km), Stichtag %s -> %s"
          % (sum(e["hier"] for e in items), ORT["name"], sum(not e["hier"] for e in items), UMKREIS_KM, stichtag, os.path.relpath(OUT, ROOT)))


if __name__ == "__main__":
    main()
