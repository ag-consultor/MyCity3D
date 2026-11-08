"""Dachfarbe je Gebaeude aus dem Luftbild (DOP, LGB) in die fertigen Kacheln site/data/t_<i>_<j>.js schreiben.

Je Gebaeude werden die Dachdreiecke aus LoD2 (rv/ri der Kachel) auf das Luftbild der Kachel gelegt, der Rand um einen
Bildpunkt verkleinert und aus den uebrigen Bildpunkten der Mittelwert je Farbkanal (Median) gebildet. Ergebnis: Feld "rc"
(0xRRGGBB als Ganzzahl). Das Luftbild ist kein echtes Orthophoto, hohe Gebaeude kippen im Bild; Schatten und Baeume
verfaelschen einzelne Daecher. Daher nur als Schaetzung beschriften.

Aufruf: python scripts/prepare_dach.py   (idempotent, ueberschreibt "rc"). Wird am Ende von prepare_gemeinde.py mit aufgerufen.
Quelle der Bilder: site/img/d_<i>_<j>.jpg (1 m/Bildpunkt) bzw. p_<i>_<j>.jpg (2 m); Lizenz wie das Luftbild (GeoBasis-DE/LGB, dl-de/by-2-0).
"""
import json, os, re, sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
DATA = os.path.join(ROOT, "site", "data")
IMG = os.path.join(ROOT, "site", "img")
sys.stdout.reconfigure(encoding="utf-8")


def median(v):
    v = sorted(v)
    return v[len(v) // 2]


def run(verbose=True):
    try:
        from PIL import Image, ImageChops, ImageDraw, ImageFilter
    except ImportError:
        print("Pillow fehlt: keine Dachfarben")
        return 0
    cells = json.load(open(os.path.join(ROOT, "data", "raw", "gemeinde", "cells.json"), encoding="utf-8"))
    X0, Z0, CELL = cells["x0"], cells["z0"], cells["cell"]
    n_ok = n_all = 0
    for i, j in cells["cells"]:
        tp = os.path.join(DATA, "t_%d_%d.js" % (i, j))
        if not os.path.exists(tp):
            continue
        txt = open(tp, encoding="utf-8").read()
        m = re.match(r'(AL_TILES\["[^"]+"\]=)(.*);\s*$', txt, re.S)
        if not m:
            continue
        tile = json.loads(m.group(2))
        if not tile["b"]:
            continue
        ip = os.path.join(IMG, "d_%d_%d.jpg" % (i, j))
        if not os.path.exists(ip):
            ip = os.path.join(IMG, "p_%d_%d.jpg" % (i, j))
        if not os.path.exists(ip):
            continue
        im = Image.open(ip).convert("RGB")
        size = im.width
        xa, za = X0 + i * CELL, Z0 + j * CELL
        k = size / CELL
        for b in tile["b"]:
            n_all += 1
            rv, ri = b["rv"], b["ri"]
            if not ri:
                b.pop("rc", None)
                continue
            pts = [((b["x"] + rv[q] - xa) * k, (b["z"] + rv[q + 2] - za) * k) for q in range(0, len(rv), 3)]
            xs = [p[0] for p in pts]; ys = [p[1] for p in pts]
            x0, y0 = max(0, int(min(xs)) - 2), max(0, int(min(ys)) - 2)
            x1, y1 = min(size, int(max(xs)) + 3), min(size, int(max(ys)) + 3)
            if x1 - x0 < 2 or y1 - y0 < 2:
                b.pop("rc", None)
                continue
            mask = Image.new("L", (x1 - x0, y1 - y0), 0)
            dr = ImageDraw.Draw(mask)
            for t in range(0, len(ri), 3):
                dr.polygon([(pts[ri[t + s]][0] - x0, pts[ri[t + s]][1] - y0) for s in range(3)], fill=255)
            if mask.getbbox() is None:
                b.pop("rc", None)
                continue
            inner = mask.filter(ImageFilter.MinFilter(3))
            if inner.getbbox() is not None:
                mask = inner
            crop = im.crop((x0, y0, x1, y1))
            rch, gch, bch = crop.split()
            mv = list(mask.getdata())
            sel = [q for q, v in enumerate(mv) if v]
            if not sel:
                b.pop("rc", None)
                continue
            R, G, B = list(rch.getdata()), list(gch.getdata()), list(bch.getdata())
            b["rc"] = (median([R[q] for q in sel]) << 16) | (median([G[q] for q in sel]) << 8) | median([B[q] for q in sel])
            n_ok += 1
        with open(tp, "w", encoding="utf-8") as f:
            f.write(m.group(1) + json.dumps(tile, ensure_ascii=False, separators=(",", ":")) + ";\n")
        if verbose:
            print("Dachfarben", i, j, len(tile["b"]))
    print("Dachfarben: %d von %d Gebaeuden" % (n_ok, n_all))
    return n_ok


if __name__ == "__main__":
    run()
