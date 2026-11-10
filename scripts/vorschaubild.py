"""Vorschaubild fuer die Startseite (site/img/vorschau.jpg, 1280 x 800) aus der laufenden Karte aufnehmen.

Die Seite muss lokal laufen (starte-seite.bat oder python -m http.server 8123 --directory site).
Braucht Playwright mit Chromium:  pip install playwright  und  playwright install chromium

  python scripts/vorschaubild.py                 Ansicht beim Laden der Karte
  python scripts/vorschaubild.py --ortsteil Cham auf einen Ortsteil fahren (Name wie in der Auswahlliste)

Orte und Haltestellen werden fuer das Bild ausgeblendet, damit die Gebaeude sichtbar bleiben.
"""
import argparse
import os

from playwright.sync_api import sync_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

ap = argparse.ArgumentParser()
ap.add_argument("--url", default="http://localhost:8123/karte.html")
ap.add_argument("--ortsteil", default="")
ap.add_argument("--aus", default=os.path.join(ROOT, "site", "img", "vorschau.jpg"))
a = ap.parse_args()

with sync_playwright() as p:
    b = p.chromium.launch(args=["--enable-gpu", "--ignore-gpu-blocklist"])
    pg = b.new_page(viewport={"width": 1280, "height": 800})
    pg.goto(a.url)
    pg.wait_for_timeout(8000)
    for layer in ("places", "stops"):
        pg.eval_on_selector("input[data-layer=%s]" % layer, "el => { if (el.checked) el.click(); }")
    if a.ortsteil:
        pg.select_option("select", label=a.ortsteil)
        pg.wait_for_timeout(10000)
        x = pg.locator("button[data-close=card]:visible")  # Ortsteil-Karte schliessen
        if x.count():
            x.first.click()
    pg.wait_for_timeout(2000)
    pg.screenshot(path=a.aus, type="jpeg", quality=84)
    b.close()
print("geschrieben:", a.aus)
