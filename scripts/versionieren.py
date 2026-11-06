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
SEITEN = ("index.html", "karte.html", "impressum.html", "datenschutz.html")
sys.stdout.reconfigure(encoding="utf-8")


def main():
    changed = []

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
