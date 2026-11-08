"""Haengt allen lokalen Skripten, Stilblaettern und Icons in site/index.html und site/karte.html eine Versionskennung aus dem Dateiinhalt an.

Beispiel: src="js/app.js"  ->  src="js/app.js?v=3fa91c2b"
Aendert sich eine Datei, aendert sich ihre Adresse, und Browser (auch wiederkehrende Besucher) laden sie neu,
statt tage- oder wochenlang eine alte Fassung aus dem Zwischenspeicher zu zeigen. Unveraenderte Dateien behalten
ihre Adresse und bleiben im Zwischenspeicher.

Aufruf: python3 scripts/versionieren.py      (laeuft vor jedem Veroeffentlichen und im Wochenlauf)
"""
import hashlib, os, re, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SITE = os.path.join(ROOT, "site")
SEITEN = ("index.html", "karte.html", "impressum.html", "datenschutz.html", "touren.html")
sys.stdout.reconfigure(encoding="utf-8")


def kachelkennung():
    """Gemeinsame Kennung aller Kacheln (data/t_*.js, areas.js, relief.png): Die Kacheln werden von app.js nachgeladen und stehen nicht im HTML.
    Ohne Kennung zeigten wiederkehrende Besucher alte Kacheln aus dem Zwischenspeicher. Ergebnis: site/data/tv.js"""
    h = hashlib.md5()
    d = os.path.join(SITE, "data")
    for fn in sorted(os.listdir(d)):
        if re.match(r"t_\d+_\d+\.js$", fn) or fn == "areas.js":
            h.update(fn.encode()); h.update(open(os.path.join(d, fn), "rb").read())
    for nm in ("relief.png", "hang.png", "senken.png"):
        rp = os.path.join(SITE, "img", nm)
        if os.path.exists(rp):
            h.update(open(rp, "rb").read())
    txt = 'window.AL_TV="%s";\n' % h.hexdigest()[:8]
    p = os.path.join(d, "tv.js")
    if not os.path.exists(p) or open(p, encoding="utf-8").read() != txt:
        open(p, "w", encoding="utf-8").write(txt)
        return ["data/tv.js"]
    return []


def main():
    changed = kachelkennung()

    def sub(m):
        attr, path = m.group(1), m.group(2)
        f = os.path.join(SITE, path)
        if not os.path.exists(f):
            return m.group(0)
        v = hashlib.md5(open(f, "rb").read()).hexdigest()[:8]
        new = '%s="%s?v=%s"' % (attr, path, v)
        if new != m.group(0):
            changed.append(path)
        return new

    for seite in SEITEN:
        pfad = os.path.join(SITE, seite)
        if not os.path.exists(pfad):
            continue
        html = open(pfad, encoding="utf-8").read()
        out = re.sub(r'(src|href)="((?!https?:)[\w./-]+\.(?:js|css|svg|ico|png))(?:\?v=\w+)?"', sub, html)
        if out != html:
            open(pfad, "w", encoding="utf-8").write(out)
    print("versioniert: %d Dateien geaendert%s" % (len(changed), (" (" + ", ".join(sorted(set(changed))) + ")") if changed else ""))


if __name__ == "__main__":
    main()
