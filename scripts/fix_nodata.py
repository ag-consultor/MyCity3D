"""Bereinigt bereits geladene Luftbilder in site/img: Weissflaechen ausserhalb Brandenburgs werden ersetzt.
Dateien ohne Weissflaeche bleiben unveraendert (kein erneutes JPEG-Komprimieren)."""
import os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from PIL import Image
from fetch import fill_nodata, IMG

changed = []
for fn in sorted(os.listdir(IMG)):
    if not fn.endswith(".jpg"):
        continue
    p = os.path.join(IMG, fn)
    im = Image.open(p).convert("RGB")
    if fill_nodata(im):
        im.save(p, "JPEG", quality=82, optimize=True, progressive=True)
        changed.append(fn)
print("bereinigt:", len(changed), changed)
