"""Liest Angaben (Oeffnungszeiten, Telefon, E-Mail, Kurzbeschreibung) von den Webseiten der Orte der Karte.

Quelle: ausschliesslich das in OpenStreetMap hinterlegte Feld "web" eines Ortes (nichts wird geraten oder gesucht).
Pro Ort hoechstens 3 Anfragen: die Seite selbst plus bis zu zwei Unterseiten derselben Domain, die von der Seite
aus verlinkt sind (Oeffnungszeiten / Kontakt / Impressum, eine Ebene tief). robots.txt wird beachtet (je Host
einmal geladen), mindestens 1 Sekunde Pause je Host, Zeitlimit je Anfrage 20 s, Gesamtlauf hoechstens ca. 9 Minuten.
Soziale Netzwerke werden nicht besucht.

Methoden (in dieser Reihenfolge): schema.org JSON-LD (openingHoursSpecification, openingHours, telephone, email),
Mikrodaten (itemprop), tel:/mailto:-Verweise, <meta name="description">, Textmuster im sichtbaren Text
(Abschnitte "Oeffnungszeiten", "Sprechzeiten", "Geoeffnet", Zeilen wie "Mo-Fr 08:00-12:00" oder
"Montag bis Freitag 8-12 Uhr"). Nichts wird erfunden: "oh_osm" (Oeffnungszeiten in OSM-Schreibweise) gibt es nur,
wenn der gesamte Zeitenblock eindeutig lesbar war; sonst steht nur "oeffnungszeiten_text" (Wortlaut der Seite).

Ergebnis: data/ergaenzung/orte_web.json
  { "gelesen": "YYYY-MM-DD", "orte": { "<osm-Kennung>": {
      "name", "quelle" (URL der Hauptseite), "gelesen" (Datum), "status": "ok" | "keine_zeiten" | "nicht_erreichbar",
      "oeffnungszeiten_text", "oh_osm", "telefon", "telefon_weitere", "email", "beschreibung", "hinweis_zeiten",
      "felder_quelle": {Feld: URL, auf der es stand}, "felder_methode": {telefon/email: Fundart}, "hinweis" } } }
Status: ok = Oeffnungszeiten gefunden; keine_zeiten = Seite erreichbar, aber keine Oeffnungszeiten lesbar (Telefon,
E-Mail, Beschreibung koennen trotzdem vorliegen); nicht_erreichbar = Abruf fehlgeschlagen oder per robots.txt untersagt.
Die Angaben sind die der Betriebe selbst, nicht geprueft. Bei Totalausfall (keine einzige Seite erreichbar): Exit 1,
bestehende JSON bleibt unangetastet.

Aufruf: python3 scripts/fetch_orte_web.py [--probe]     (--probe: nur anzeigen, nichts schreiben)
"""
import datetime as dt, html, json, os, re, sys, time, urllib.error, urllib.parse, urllib.request, urllib.robotparser

sys.stdout.reconfigure(encoding="utf-8")

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
META = os.path.join(ROOT, "site", "data", "meta.js")
OUT = os.path.join(ROOT, "data", "ergaenzung", "orte_web.json")
UA = "GemeindeKarte-Prototyp/0.4"
SKIP_HOSTS = ("facebook.com", "instagram.com", "linkedin.com", "twitter.com", "x.com", "youtube.com", "google.",
              "tiktok.com", "wikipedia.org")
PAUSE_HOST = 1.1          # Sekunden zwischen zwei Anfragen an denselben Host
TIMEOUT = 20
MAX_REQ_ORT = 3
BUDGET = 9 * 60           # Sekunden fuer den Gesamtlauf
MAX_BYTES = 2_000_000


def load_js(path, var):
    s = open(path, encoding="utf-8").read()
    m = re.search(r"%s=(.*);\s*$" % re.escape(var), s, re.S)
    return json.loads(m.group(1))


# ------------------------------------------------------------------ Abruf

class Fetcher:
    def __init__(self):
        self.robots = {}      # host -> RobotFileParser | None (alles erlaubt) | "block"
        self.last = {}        # host -> Zeitpunkt der letzten Anfrage
        self.cache = {}       # url -> (text, finale url) oder Exception
        self.n_requests = 0

    def _wait(self, host):
        t = self.last.get(host)
        if t is not None:
            d = PAUSE_HOST - (time.time() - t)
            if d > 0:
                time.sleep(d)
        self.last[host] = time.time()

    def _raw(self, url, accept="text/html,application/xhtml+xml"):
        host = urllib.parse.urlparse(url).netloc.lower()
        self._wait(host)
        self.n_requests += 1
        req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": accept, "Accept-Language": "de"})
        with urllib.request.urlopen(req, timeout=TIMEOUT) as r:
            data = r.read(MAX_BYTES)
            ctype = r.headers.get("Content-Type", "") or ""
            return data, ctype, r.geturl()

    def _robots(self, url):
        u = urllib.parse.urlparse(url)
        host = u.netloc.lower()
        if host in self.robots:
            return self.robots[host]
        rp = urllib.robotparser.RobotFileParser()
        res = None
        try:
            data, _, _ = self._raw("%s://%s/robots.txt" % (u.scheme, u.netloc), "text/plain")
            rp.parse(data.decode("utf-8", "replace").splitlines())
            res = rp
        except urllib.error.HTTPError as e:
            res = "block" if e.code >= 500 else None   # 4xx: keine robots.txt, alles erlaubt
        except Exception:
            res = None                                  # nicht lesbar: wie ueblich erlaubt (Seite selbst scheitert ggf. ohnehin)
        self.robots[host] = res
        return res

    def get(self, url):
        """Liefert (html_text, finale_url). Wirft Exception bei Fehler (auch bei robots.txt-Sperre)."""
        if url in self.cache:
            c = self.cache[url]
            if isinstance(c, Exception):
                raise c
            return c
        try:
            rp = self._robots(url)
            if rp == "block":
                raise PermissionError("robots.txt nicht abrufbar (Serverfehler), Seite nicht besucht")
            if rp is not None and not rp.can_fetch(UA, url):
                raise PermissionError("robots.txt untersagt den Abruf")
            data, ctype, final = self._raw(url)
            if ctype and "html" not in ctype.lower() and "xml" not in ctype.lower() and "text" not in ctype.lower():
                raise ValueError("kein HTML (%s)" % ctype.split(";")[0])
            m = re.search(r"charset=([\w-]+)", ctype, re.I) or re.search(rb'<meta[^>]+charset=["\']?([\w-]+)', data[:4000], re.I)
            enc = (m.group(1).decode() if m and isinstance(m.group(1), bytes) else (m.group(1) if m else "utf-8"))
            try:
                text = data.decode(enc, "replace")
            except LookupError:
                text = data.decode("utf-8", "replace")
            if enc.lower().replace("_", "-") in ("utf-8", "utf8") and "\ufffd" in text[:20000]:
                text = data.decode("cp1252", "replace")
            res = (text, final)
        except Exception as e:
            self.cache[url] = e
            raise
        self.cache[url] = res
        return res


# ------------------------------------------------------------------ HTML -> Text

def html_to_lines(page):
    s = re.sub(r"(?is)<!--.*?-->", " ", page)
    s = re.sub(r"(?is)<(script|style|noscript|svg|template|head)\b.*?</\1>", " ", s)
    s = re.sub(r"(?i)<br\s*/?>", "\n", s)
    s = re.sub(r"(?i)</(td|th)\s*>", " ", s)
    s = re.sub(r"(?i)</?(p|div|li|ul|ol|tr|table|h[1-6]|section|article|header|footer|nav|main|aside|dd|dt|dl|address|form|tbody|thead|blockquote|figure)\b[^>]*>", "\n", s)
    s = re.sub(r"(?s)<[^>]+>", " ", s)
    s = html.unescape(s).replace("\xa0", " ").replace("\u200b", "").replace("\u00ad", "")
    s = re.sub("[\u2010-\u2015\u2212]", "-", s)   # alle Strich-Varianten (auch geschuetzter Bindestrich, Minus) -> "-"
    lines = []
    for l in s.split("\n"):
        l = re.sub(r"[ \t\r\f\v]+", " ", l).strip()
        if l:
            lines.append(l)
    return lines


# ------------------------------------------------------------------ Strukturierte Daten

DAY_EN = {"monday": "Mo", "tuesday": "Tu", "wednesday": "We", "thursday": "Th", "friday": "Fr", "saturday": "Sa", "sunday": "Su"}
ORDER = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"]


def hhmm(t):
    m = re.match(r"\s*(\d{1,2})[:.](\d{2})", str(t))
    if not m:
        m2 = re.match(r"^\s*(\d{1,2})\s*$", str(t))
        if m2:
            return "%02d:00" % int(m2.group(1))
        return None
    h, mi = int(m.group(1)), int(m.group(2))
    if h > 24 or mi > 59:
        return None
    return "%02d:%02d" % (h, mi)


def group_days(per_day):
    """{'Mo': ['08:00-12:00'], ...} -> OSM-Schreibweise 'Mo-Fr 08:00-12:00; Sa 09:00-11:00'."""
    if not per_day:
        return None
    groups, i = [], 0
    days = [d for d in ORDER if d in per_day]
    while i < len(days):
        j = i
        while j + 1 < len(days) and ORDER.index(days[j + 1]) == ORDER.index(days[j]) + 1 and per_day[days[j + 1]] == per_day[days[i]]:
            j += 1
        groups.append(("%s-%s" % (days[i], days[j]) if j > i else days[i]) + " " + ",".join(per_day[days[i]]))
        i = j + 1
    return "; ".join(groups)


def from_spec(spec):
    """schema.org openingHoursSpecification -> OSM-Schreibweise oder None."""
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
            k = DAY_EN.get(str(d).rsplit("/", 1)[-1].lower())
            if k and o and c and c > o:
                per_day.setdefault(k, []).append("%s-%s" % (o, c))
    return group_days(per_day)


def from_string(v):
    """schema.org openingHours als Text ('Mo-Fr 09:00-17:00') -> OSM-Schreibweise (neu gruppiert) oder None (nur eindeutige Formen)."""
    vs = [v] if isinstance(v, str) else [x for x in v if isinstance(x, str)]
    d = r"(?:Mo|Tu|We|Th|Fr|Sa|Su)"
    t = r"\d{1,2}:\d{2}\s*-\s*\d{1,2}:\d{2}"
    per_day = {}
    for x in vs:
        x = x.strip()
        m = re.match(r"^(%s(?:\s*-\s*%s)?(?:\s*,\s*%s(?:\s*-\s*%s)?)*)\s+(%s(?:\s*,\s*%s)*)$" % (d, d, d, d, t, t), x)
        if not m:
            return None
        times = []
        for a_, b_ in re.findall(r"(\d{1,2}:\d{2})\s*-\s*(\d{1,2}:\d{2})", m.group(2)):
            a_, b_ = hhmm(a_), hhmm(b_)
            if not a_ or not b_ or b_ <= a_:
                return None
            times.append("%s-%s" % (a_, b_))
        for part in m.group(1).split(","):
            ends = [e.strip() for e in part.split("-")]
            i0 = ORDER.index(ends[0])
            i1 = ORDER.index(ends[-1])
            if i1 < i0:
                return None
            for dd in ORDER[i0:i1 + 1]:
                per_day[dd] = times
    return group_days(per_day)


def walk(o):
    if isinstance(o, dict):
        yield o
        for v in o.values():
            yield from walk(v)
    elif isinstance(o, list):
        for v in o:
            yield from walk(v)


def clean_tel(s):
    s = html.unescape(str(s)).strip()
    s = re.sub(r"^(tel(efon)?|phone|fon)\s*[:.]?\s*", "", s, flags=re.I)
    s = re.sub(r"\s+", " ", s).strip(" .;,:-")
    s = re.sub(r"^\+\+", "+", s)
    digits = re.sub(r"\D", "", s)
    if not (7 <= len(digits) <= 15):
        return None
    if not re.match(r"^(\+|0|\()", s):
        return None
    return s


def clean_mail(s):
    s = html.unescape(str(s)).strip().lower()
    s = re.sub(r"^mailto:", "", s).split("?")[0].strip()
    if not re.fullmatch(r"[a-z0-9._%+\-]+@[a-z0-9.\-]+\.[a-z]{2,}", s):
        return None
    if re.search(r"(datenschutz|privacy|webmaster|noreply|no-reply|example\.|sentry|wixpress|@2x|\.png|\.jpg)", s):
        return None
    return s


def structured(page):
    """JSON-LD und Mikrodaten -> dict(oh, oh_text, tel, mail, desc) (nur vorhandene Felder)."""
    r = {}
    for b in re.findall(r'<script[^>]+type=["\']application/ld\+json["\'][^>]*>(.*?)</script>', page, re.S | re.I):
        try:
            data = json.loads(html.unescape(b.strip()))
        except Exception:
            continue
        for node in walk(data):
            if "openingHoursSpecification" in node and "oh" not in r:
                x = from_spec(node["openingHoursSpecification"])
                if x:
                    r["oh"] = x
            if "openingHours" in node and "oh" not in r:
                x = from_string(node["openingHours"])
                if x:
                    r["oh"] = x
            if "telephone" in node and "tel" not in r and isinstance(node["telephone"], (str, int)):
                x = clean_tel(node["telephone"])
                if x:
                    r["tel"] = x
            if "email" in node and "mail" not in r and isinstance(node["email"], str):
                x = clean_mail(node["email"])
                if x:
                    r["mail"] = x
    # Mikrodaten
    for m in re.finditer(r'<[^>]+itemprop=["\']openingHours["\'][^>]*>', page, re.I):
        tag = m.group(0)
        c = re.search(r'(?:content|datetime)=["\']([^"\']+)["\']', tag, re.I)
        if c and "oh" not in r:
            x = from_string(html.unescape(c.group(1)))
            if x:
                r["oh"] = x
    m = re.search(r'<[^>]+itemprop=["\']telephone["\'][^>]*>(?:\s*<[^>]+>)*\s*([^<]{6,30})', page, re.I)
    if m and "tel" not in r:
        x = clean_tel(m.group(1))
        if x:
            r["tel"] = x
    return r


BOILER_DESC = re.compile(r"(?i)template|bootstrap|lorem ipsum|typo3|wordpress|joomla|just another|wix\.com|squarespace|jimdo|website-baukasten|startseite$")


def meta_description(page):
    for pat in (r'<meta[^>]+name=["\']description["\'][^>]*>', r'<meta[^>]+property=["\']og:description["\'][^>]*>'):
        for m in re.finditer(pat, page, re.I):
            c = re.search(r'content=(?:"([^"]*)"|\'([^\']*)\')', m.group(0), re.I | re.S)
            if c:
                d = re.sub(r"\s+", " ", html.unescape(c.group(1) or c.group(2) or "")).strip()
                if len(d) >= 20 and not BOILER_DESC.search(d):
                    return d
    return None


def cut(s, n):
    s = re.sub(r"\s+", " ", s).strip()
    if len(s) <= n:
        return s
    t = s[:n - 1].rsplit(" ", 1)[0].rstrip(" ,;:-")
    return t + "\u2026"


# ------------------------------------------------------------------ Kontaktdaten aus Verweisen und Text

def decode_cf(h):
    try:
        k = int(h[:2], 16)
        return "".join(chr(int(h[i:i + 2], 16) ^ k) for i in range(2, len(h), 2))
    except Exception:
        return None


FREEMAIL = ("t-online.de", "gmx.de", "gmx.net", "web.de", "gmail.com", "googlemail.com", "freenet.de", "outlook.de", "outlook.com",
            "yahoo.de", "yahoo.com", "icloud.com", "posteo.de", "arcor.de", "online.de", "mail.de", "hotmail.com", "hotmail.de", "live.de",
            "1und1.de", "kabelmail.de", "aol.com", "me.com", "mailbox.org", "protonmail.com", "proton.me")
TEL_SKIP_CTX = re.compile(r"(?i)ansprechpartner|hotline|bewerber|pressekontakt|presse\b|datenschutzbeauftragt|schulamt|standesamt|ordnungsamt|bauamt|schiedsstelle")


def mail_fits(mail, host):
    """E-Mail passt zur Seite: gleiche Domain (auch Teilstueck, z. B. niedergoersdorf.de zu gemeinde-niedergoersdorf.de) oder Freemail."""
    dom = mail.split("@", 1)[1]
    h = host.lower().removeprefix("www.")
    if dom in FREEMAIL:
        return True
    return h.endswith(dom) or dom.endswith(h)


def contacts(page, lines, host):
    """-> dict(tel, mail, tel_h, mail_h). Telefon: beschriftete Textstelle vor tel:-Verweis; E-Mail nur, wenn sie zur Seite passt."""
    r = {}
    for i, l in enumerate(lines):
        m = re.search(r"(?<![A-Za-z])(?:Tel(?:efon)?|Fon|Mobil|Handy|Rufnummer|Telefonnummer)\b\.?\s*[:/]?\s*((?:\+49|0049|\(?0)[\d\s/().\-]{5,24}\d)", l)
        if m:
            ctx = " ".join(lines[max(0, i - 3):i]) + " " + l[:m.start()]
            if TEL_SKIP_CTX.search(ctx):
                continue
            x = clean_tel(m.group(1))
            if x:
                r["tel"], r["tel_h"] = x, "Text"
                more = []
                for l2 in lines[i + 1:i + 3]:   # direkt folgende Zeilen, die nur eine Nummer enthalten
                    if re.fullmatch(r"(?:\+49|0049|\(?0)[\d\s/().\-]{5,24}\d", l2.strip()):
                        y = clean_tel(l2)
                        if y and y != x and y not in more:
                            more.append(y)
                if more:
                    r["tel_weitere"] = more
                break
    if "tel" not in r:
        m = re.search(r'href=["\']tel:([^"\']+)["\']', page, re.I)
        if m:
            x = clean_tel(urllib.parse.unquote(html.unescape(m.group(1))))
            if x:
                r["tel"], r["tel_h"] = x, "tel-Verweis"
    cand = []
    for i, l in enumerate(lines):
        for m in re.finditer(r"([A-Za-z0-9._%+\-]+)\s*(@~@|@|\[at\]|\(at\)|\[\s*@\s*\])\s*([A-Za-z0-9.\-]+\.[A-Za-z]{2,})", l):
            x = clean_mail(m.group(1) + "@" + m.group(3))
            if x:
                ctx = " ".join(lines[max(0, i - 3):i]) + " " + l[:m.start()]
                if TEL_SKIP_CTX.search(ctx):
                    continue
                lab = 0 if re.search(r"(?i)e-?\s?mail|mail|tel|fon", l[:m.start()]) else 1   # beschriftete Fundstellen zuerst
                cand.append((lab, x, "Text (Schreibweise @~@ aufgeloest)" if m.group(2) == "@~@" else "Text"))
    for m in re.finditer(r'href=["\']mailto:([^"\']+)["\']', page, re.I):
        x = clean_mail(urllib.parse.unquote(html.unescape(m.group(1))))
        if x:
            cand.append((2, x, "mailto-Verweis"))
    for m in re.finditer(r'data-cfemail=["\']([0-9a-f]+)["\']', page, re.I):
        x = clean_mail(decode_cf(m.group(1)) or "")
        if x:
            cand.append((2, x, "Text (Cloudflare-Schutz entschluesselt)"))
    for _, x, h in sorted(cand, key=lambda c: c[0]):
        if mail_fits(x, host):
            r["mail"], r["mail_h"] = x, h
            break
    return r


# ------------------------------------------------------------------ Oeffnungszeiten aus Text

DAYS = r"(?:(?:montag|dienstag|mittwoch|donnerstag|freitag|samstag|sonnabend|sonntag)s?|mo|di|mi|do|fr|sa|so)"   # klein (nach lower())
# im Fliesstext: Abkuerzungen nur gross geschrieben (Mo, MO), sonst waeren "so", "do", "mi" normale Woerter
DS = r"(?:(?i:montag|dienstag|mittwoch|donnerstag|freitag|samstag|sonnabend|sonntag)s?|Mo|MO|Di|DI|Mi|MI|Do|DO|Fr|FR|Sa|SA|So|SO)"
DAY_MAP = {"mo": "Mo", "di": "Tu", "mi": "We", "do": "Th", "fr": "Fr", "sa": "Sa", "so": "Su"}
TIME_TOK = r"\d{1,2}(?:[:.]\d{2})?"
HEAD_RE = re.compile(r"(?i)(öffnungs?\s*-?\s*zeit|oeffnungszeit|sprechzeit|sprechstunde|geöffnet|besuchszeit|betreuungszeit|"
                     r"bürozeit|buerozeit|verkaufszeit|servicezeit|öffnungstage|praxiszeit|küchenzeit|kuechenzeit|sprechtag|"
                     r"geschäftszeit|geschaeftszeit|ladenzeit)\w*")
DAY_IN_LINE = re.compile(r"(?<![A-Za-zäöüÄÖÜß])%s(?![A-Za-zäöüÄÖÜß])\.?" % DS)
HH = r"(?:[01]?\d|2[0-4])"
TIME_IN_LINE = re.compile(r"(?<![\d.,/:])(?:%s[:.][0-5]\d(?!\d|\.\d)|%s\s*(?:-|–|bis)\s*%s\s*uhr|%s\s*uhr)" % (HH, HH, HH, HH), re.I)
DATE_IN_LINE = re.compile(r"\b\d{1,2}\.\d{1,2}\.\d{2,4}\b")
CLOSED = re.compile(r"(?i)geschlossen|ruhetag")
HOURS_SKIP_CTX = re.compile(r"(?i)hotline|bewerber|ansprechpartner|schulamt|pressekontakt|beratung(?:s)?(?:zeit|stelle)|telefonzeit")
FILLER = re.compile(r"(?i)^(uhr|geschlossen|ruhetag|ruhe\s*tag|nach (telefonischer )?vereinbarung|und|sowie|oder|bis|von|ab|pause|mittagspause|feiertags?|ganztägig|ganztags|-|–|,)$")


def has_day(l):
    return bool(DAY_IN_LINE.search(l))


def is_hours_line(l):
    if len(l) > 170 or DATE_IN_LINE.search(l):
        return False
    if has_day(l) and TIME_IN_LINE.search(l):
        return True
    return has_day(l) and len(l) < 60 and bool(CLOSED.search(l))


def is_dayonly(l):
    return has_day(l) and not TIME_IN_LINE.search(l) and len(l) < 40 and not CLOSED.search(l) and not re.search(r"\d", l)


def is_timeonly(l):
    return bool(TIME_IN_LINE.search(l)) and not has_day(l) and len(l) < 60 and not DATE_IN_LINE.search(l)


def collect_block(lines, start):
    """Sammelt ab Zeile 'start' aufeinanderfolgende Zeilen mit Tag + Uhrzeit (Wortlaut)."""
    n = len(lines)
    out, i = [], start
    while i < n and len(out) < 14:
        l = lines[i]
        if is_hours_line(l):
            out.append(l)
            i += 1
        elif is_dayonly(l) and i + 1 < n and (is_timeonly(lines[i + 1]) or (CLOSED.search(lines[i + 1]) and len(lines[i + 1]) < 40)):
            out.append(l + " " + lines[i + 1])
            i += 2
        elif out and is_timeonly(l) and (has_day(out[-1]) or CLOSED.search(out[-1])):
            out[-1] += " " + l   # zweite Uhrzeit-Zeile zum selben Tag (z. B. Nachmittag)
            i += 1
        elif out and FILLER.match(l.strip(" ,;:.")):
            i += 1
        else:
            break
    return out


def with_time(block):
    return block if block and any(TIME_IN_LINE.search(x) for x in block) else None


def find_hours_text(lines):
    """Sucht den ersten glaubwuerdigen Zeitenblock. -> (Zeilenliste, Index der Ueberschriftzeile oder None) oder None.
    1. Block unter/neben einer Ueberschrift 'Oeffnungszeiten/Sprechzeiten/...' (Zeilen mit Tag und Uhrzeit);
    2. sonst nur einzelne Zeilen, die vollstaendig als 'Tage + Uhrzeiten' lesbar sind (keine Fliesstextsaetze)."""
    n = len(lines)

    def foreign(i):
        """Block gehoert erkennbar zu einer Beratung/Hotline/Presse o. ae. (Zeilen davor), nicht zum Ort."""
        return bool(HOURS_SKIP_CTX.search(" ".join(lines[max(0, i - 4):i + 1])))

    for i, l in enumerate(lines):
        hm = HEAD_RE.search(l)
        if hm and len(l) < 220:
            tail = l[hm.end():].lstrip(" :-–")
            if tail and is_hours_line(tail):
                b = with_time([tail] + collect_block(lines, i + 1))
                if b:
                    return b, i
            for j in (i + 1, i + 2):
                if j < n:
                    b = with_time(collect_block(lines, j))
                    if b:
                        return b, i
    for i in range(n):
        l = lines[i]
        if is_hours_line(l) and TIME_IN_LINE.search(l) and not foreign(i) and text_to_osm([l]):
            b = with_time(collect_block(lines, i))
            if b:
                return b, None
    return None


def head_qualifier(head):
    """Ueberschrift mit Zusatz ('Unsere Oeffnungszeiten von Mai - September:') -> bereinigter Text, sonst None."""
    h = HEAD_RE.sub(" ", head)
    h = re.sub(r"(?i)\b(unsere|unser|die|der|das|und|zeiten)\b|[:]", " ", h)
    h = re.sub(r"\s+", " ", h).strip(" -")
    if len(re.findall(r"[A-Za-zäöüÄÖÜß]", h)) >= 3 and len(head) <= 80:
        return re.sub(r"\s+", " ", head).strip(" :")
    return None


def norm_block(block):
    s = "; ".join(re.sub(r"\s+", " ", b).strip(" ;,") for b in block)
    return s.replace("–", "-").replace("—", "-")


# --- strenger Parser Text -> OSM

def _day(tok):
    tok = tok.lower().rstrip(".")
    if tok == "sonnabend":
        return "Sa"
    return DAY_MAP[tok[:2]]


def _days_to_list(spec):
    """'Mo-Fr', 'Mo, Mi und Fr', 'Montag bis Freitag' -> Liste Kuerzel oder None."""
    spec = spec.lower().replace("–", "-").replace("—", "-")
    spec = re.sub(r"\bbis\b", "-", spec)
    spec = re.sub(r",\s*und\b", ",", spec)
    spec = re.sub(r"\b(?:und|u\.)(?=\s)|\bu\.|&", ",", spec)
    spec = re.sub(r"\s+", "", spec)
    out = []
    for part in [x for x in spec.split(",") if x]:
        m = re.fullmatch(r"(%s)\.?(?:-(%s)\.?)?" % (DAYS, DAYS), part)
        if not m:
            return None
        a = _day(m.group(1))
        if m.group(2):
            b = _day(m.group(2))
            ia, ib = ORDER.index(a), ORDER.index(b)
            if ib < ia:
                return None
            out.extend(ORDER[ia:ib + 1])
        else:
            out.append(a)
    return out or None


def _t(tok):
    tok = tok.replace(".", ":")
    h, m = (tok.split(":") + ["00"])[:2]
    h, m = int(h), int(m)
    if h > 24 or m > 59:
        return None
    return "%02d:%02d" % (h, m)


def _times_to_list(spec):
    """'08:00 - 12:00 Uhr und 13:00 - 17:00 Uhr' -> ['08:00-12:00', '13:00-17:00'] oder None (Reste im Text => None)."""
    spec = spec.lower().replace("–", "-").replace("—", "-")
    spec = re.sub(r"\buhr\b|(?<=\d)uhr\b", " ", spec)
    spec = re.sub(r"\bbis\b", "-", spec)
    rng = re.compile(r"(%s)\s*-\s*(%s)" % (TIME_TOK, TIME_TOK))
    found = rng.findall(spec)
    rest = rng.sub(" ", spec)
    rest = re.sub(r"\b(von|und|sowie|u\.)\b|[&/,;.\s]", "", rest)
    if not found or rest:
        return None
    out = []
    for a, b in found:
        a, b = _t(a), _t(b)
        if not a or not b or b <= a:
            return None
        out.append("%s-%s" % (a, b))
    return out


SEPD = r"\s*(?:-|bis|–)\s*"
LISTD = r"\s*(?:,\s*(?i:und\s+)?|(?i:und)\s+|(?i:u)\.\s*|&\s*)"
DAYSPEC = DS + r"\.?(?:" + SEPD + DS + r"\.?)?(?:" + LISTD + DS + r"\.?(?:" + SEPD + DS + r"\.?)?)*"
UNIT_RE = re.compile(r"(?P<d>" + DAYSPEC + r")\s*:?\s*(?P<t>.+)")
CLOSED_RE = re.compile(r"(?:" + DAYSPEC + r")\s*:?\s*(?i:geschlossen|ruhetag)")


def text_to_osm(block):
    """OSM-Schreibweise nur, wenn JEDE Zeile des Blocks eindeutig lesbar ist (sonst None)."""
    per_day = {}
    for unit in block:
        u = re.sub(r"\s+", " ", unit).strip().strip(";,. ")
        u = u.replace("–", "-").replace("—", "-")
        if CLOSED_RE.fullmatch(u):
            continue   # ausdruecklich geschlossen: in OSM einfach weglassen
        m = UNIT_RE.fullmatch(u)
        if not m:
            return None
        days = _days_to_list(m.group("d"))
        tstr = m.group("t").strip()
        if not days or not re.search(r"\d", tstr):
            return None
        if not (re.search(r"\d[:.]\d{2}", tstr) or re.search(r"(?i)uhr", tstr)):
            return None   # '8-12' ohne Minuten/Uhr ist nicht eindeutig
        times = _times_to_list(tstr)
        if not times:
            return None
        for d in days:
            if d in per_day and per_day[d] != times:
                return None
            per_day[d] = times
    return group_days(per_day)


# ------------------------------------------------------------------ Seitenauswertung

RANGE_RE = re.compile(r"(%s)\s*(?:uhr)?\s*(?:-|–|bis)\s*(%s)" % (r"\d{1,2}[:.]\d{2}", r"\d{1,2}[:.]\d{2}"), re.I)
UNSURE_RE = re.compile(r"(?i)wechselnd|abweichend|aktuell|saison|sommer|winter|google|ändern|aendern|vorbehalt|nur nach|feiertag|januar|februar|märz|maerz|april|\bmai\b|juni|juli|august|september|oktober|november|dezember|ferien")
OTHER_TIMES_SKIP = re.compile(r"(?i)erreichbarkeit|telefon|küche|kuechen|frühstück|fruehstueck|mittagessen|veranstaltung|termin|führung|fuehrung")


def unsure_hours(lines, block):
    """Gibt einen Hinweistext zurueck, wenn die Seite die Zeiten selbst relativiert oder an anderer Stelle andere Zeiten nennt
    (dann wird KEIN oh_osm abgeleitet; der Wortlaut bleibt als Text erhalten)."""
    mine = set()
    for b in block:
        for a, c in RANGE_RE.findall(b):
            mine.add((_t(a), _t(c)))
    first = next((i for i, l in enumerate(lines) if block[0][:40] in l), 0)
    near = " ".join(lines[max(0, first - 2):first + 1])
    if UNSURE_RE.search(near):
        return "Seite relativiert die Zeiten (z. B. wechselnd/aktuell/Saison) - Wortlaut pruefen"
    for l in lines:
        if l in block or not has_day(l) or OTHER_TIMES_SKIP.search(l) or DATE_IN_LINE.search(l):
            continue
        for a, c in RANGE_RE.findall(l):
            if (_t(a), _t(c)) not in mine:
                return "Seite nennt an anderer Stelle abweichende Zeiten (%s) - Wortlaut pruefen" % cut(l, 90)
    return None


def analyse(page, host):
    lines = html_to_lines(page)
    st = structured(page)
    ct = contacts(page, lines, host)
    r = {"desc": meta_description(page)}
    found = find_hours_text(lines)
    if found:
        block, hidx = found
        parts = []
        head = None
        if hidx is not None:
            hm0 = HEAD_RE.search(lines[hidx])
            tail0 = lines[hidx][hm0.end():].lstrip(" :-–") if hm0 else ""
            if not (tail0 and is_hours_line(tail0)):
                head = head_qualifier(lines[hidx])
        parts.append(((head + ": ") if head else "") + norm_block(block))
        extra = other = 0
        if hidx is not None:
            j = hidx + len(block) + 1
            while j < min(len(lines), hidx + len(block) + 25):
                if HEAD_RE.search(lines[j]) and len(lines[j]) < 220 and lines[j] not in block:
                    b2 = None
                    hm2 = HEAD_RE.search(lines[j])
                    tail2 = lines[j][hm2.end():].lstrip(" :-–")
                    if tail2 and is_hours_line(tail2):
                        b2 = with_time([tail2] + collect_block(lines, j + 1))
                    for k in (j + 1, j + 2):
                        if b2:
                            break
                        b2 = with_time(collect_block(lines, k)) if k < len(lines) else None
                    if b2 and not set(b2) <= set(block):   # Wiederholung desselben Blocks (z. B. Fusszeile) zaehlt nicht
                        h2 = head_qualifier(lines[j])
                        if head and h2:
                            parts.append(h2 + ": " + norm_block(b2))   # Saison-/Zeitraum-Varianten derselben Stelle
                            extra += 1
                        else:
                            other += 1                                   # weitere Standorte/Bereiche: nicht uebernommen
                        j += len(b2) + 1
                        continue
                j += 1
        r["text"] = cut(" | ".join(parts), 300)
        oh = text_to_osm(block)
        why = unsure_hours(lines, block)
        if not why and extra:
            why = "Seite nennt mehrere Zeitenbloecke (z. B. Saison oder Bereiche) - Wortlaut pruefen"
        if not why and other:
            why = "Seite nennt weitere Zeitenbloecke (andere Standorte/Bereiche?); nur der erste Block uebernommen - Wortlaut pruefen"
        if not why and head:
            why = "Zeiten gelten laut Ueberschrift nur fuer einen Zeitraum/Bereich (%s)" % head
        if why:
            r["zeiten_hinweis"] = why
        elif oh:
            r["oh_text"] = oh
    if "oh" in st:
        r["oh_struct"] = st["oh"]
    r["tel"], r["tel_h"] = (st["tel"], "schema.org") if "tel" in st else (ct.get("tel"), ct.get("tel_h"))
    if "tel" not in st and ct.get("tel_weitere"):
        r["tel_weitere"] = ct["tel_weitere"]
    r["mail"], r["mail_h"] = (st["mail"], "schema.org") if "mail" in st else (ct.get("mail"), ct.get("mail_h"))
    return r


def sub_links(page, base_url, need_hours):
    """Verlinkte Unterseiten derselben Domain (Oeffnungszeiten, Kontakt, Impressum), nach Eignung sortiert."""
    host = urllib.parse.urlparse(base_url).netloc.lower().removeprefix("www.")
    cands = {}
    for m in re.finditer(r'(?is)<a\b[^>]*?href=["\']([^"\']+)["\'][^>]*>(.*?)</a>', page):
        href = html.unescape(m.group(1)).strip()
        if href.startswith(("#", "mailto:", "tel:", "javascript:")):
            continue
        url = urllib.parse.urljoin(base_url, href).split("#")[0]
        pu = urllib.parse.urlparse(url)
        if pu.scheme not in ("http", "https") or pu.netloc.lower().removeprefix("www.") != host:
            continue
        if re.search(r"(?i)\.(pdf|jpe?g|png|gif|svg|zip|docx?|xlsx?|mp[34])($|\?)", pu.path):
            continue
        text = re.sub(r"<[^>]+>", " ", m.group(2))
        label = (html.unescape(text) + " " + urllib.parse.unquote(pu.path + " " + pu.query)).lower()
        score = 0
        if re.search(r"öffnungs?zeit|oeffnungszeit|offnungszeit|sprechzeit|sprechstunde|besuchszeit", label):
            score = 3 if need_hours else 1
        elif re.search(r"kontakt|contact|ansprechpartner|so erreichen", label):
            score = 2
        elif re.search(r"impressum|imprint|legal-notice", label):
            score = 1
        if score and url.rstrip("/") != base_url.rstrip("/"):
            cands[url] = max(score, cands.get(url, 0))
    return [u for u, _ in sorted(cands.items(), key=lambda kv: -kv[1])]


def merge(acc, r, url):
    """Nimmt je Feld den ersten Treffer (Hauptseite vor Unterseiten) und merkt Fundstelle und Methode.
    Oeffnungszeiten (Text, OSM-Ableitung, Hinweis) werden nur gemeinsam von derselben Seite uebernommen."""
    f = acc["felder"]
    if r.get("text") and "oeffnungszeiten_text" not in f:
        f["oeffnungszeiten_text"] = r["text"]
        acc["fq"]["oeffnungszeiten_text"] = url
        if r.get("oh_text"):
            f["oh_osm"] = r["oh_text"]
            acc["fq"]["oh_osm"] = url
        if r.get("zeiten_hinweis"):
            f["hinweis_zeiten"] = r["zeiten_hinweis"]
    for key, src in (("tel", "telefon"), ("mail", "email"), ("desc", "beschreibung")):
        if r.get(key) and src not in f:
            f[src] = r[key]
            acc["fq"][src] = url
            if key == "tel" and r.get("tel_weitere"):
                f["telefon_weitere"] = r["tel_weitere"]
            if key in ("tel", "mail") and r.get(key + "_h"):
                acc["h"][src] = r[key + "_h"]
    if r.get("oh_struct") and "oh_struct" not in f:
        f["oh_struct"] = r["oh_struct"]
        acc["fq"]["oh_struct"] = url


def process_ort(fetcher, p, shared):
    """Eine Ort-Eintrag; max. MAX_REQ_ORT Seitenabrufe. -> dict (Eintrag fuer die JSON)."""
    url = p["web"]
    acc = {"felder": {}, "fq": {}, "h": {}}
    reqs = 0
    reached = 0
    err = None
    todo_sub = []
    try:
        page, final = fetcher.get(url)
        reqs += 1
        reached += 1
        merge(acc, analyse(page, urllib.parse.urlparse(final).netloc), url)
        need_hours = "oeffnungszeiten_text" not in acc["felder"]
        need_contact = "telefon" not in acc["felder"] or "email" not in acc["felder"]
        if (need_hours or need_contact) and not shared:
            todo_sub = sub_links(page, final, need_hours)
    except Exception as e:
        err = "%s: %s" % (type(e).__name__, str(e)[:100])
    for u in todo_sub:
        if reqs >= MAX_REQ_ORT:
            break
        if "oeffnungszeiten_text" in acc["felder"] and "telefon" in acc["felder"] and "email" in acc["felder"]:
            break
        try:
            pg, fin = fetcher.get(u)
            reqs += 1
            merge(acc, analyse(pg, urllib.parse.urlparse(fin).netloc), u)
        except Exception:
            reqs += 1
    f = acc["felder"]
    e = {"name": p["n"], "quelle": url}
    if not reached:
        e["status"] = "nicht_erreichbar"
        e["hinweis"] = err or "Abruf fehlgeschlagen"
        e["_requests"] = reqs
        return e
    # strukturierte Zeit (JSON-LD) hat Vorrang fuer oh_osm; sonst Text-Ableitung
    if f.get("oh_struct") and "hinweis_zeiten" not in f:
        f["oh_osm"] = f["oh_struct"]
        acc["fq"]["oh_osm"] = acc["fq"].get("oh_struct")
        if "oeffnungszeiten_text" not in f:
            f["oeffnungszeiten_text"] = f["oh_struct"]   # nur Maschinenform vorhanden
            acc["fq"]["oeffnungszeiten_text"] = acc["fq"]["oh_struct"]
    f.pop("oh_struct", None)
    acc["fq"].pop("oh_struct", None)
    if shared:
        # Seite gehoert mehreren Orten: Angaben koennen nicht eindeutig diesem Ort zugeordnet werden
        for k in ("oeffnungszeiten_text", "oh_osm", "telefon", "telefon_weitere", "email", "beschreibung", "hinweis_zeiten"):
            f.pop(k, None)
            acc["fq"].pop(k, None)
        e["hinweis"] = "Seite wird von mehreren Orten der Karte genutzt; Angaben nicht eindeutig zuordenbar, daher nicht uebernommen"
    for k in ("oeffnungszeiten_text", "oh_osm", "telefon", "email"):
        if k in f:
            e[k] = f[k]
    if f.get("telefon_weitere") and "telefon" in e:
        e["telefon_weitere"] = f["telefon_weitere"]
    if f.get("hinweis_zeiten") and "oeffnungszeiten_text" in e:
        e["hinweis_zeiten"] = f["hinweis_zeiten"]
    if f.get("beschreibung"):
        e["beschreibung"] = cut(f["beschreibung"], 200)
    e["status"] = "ok" if "oeffnungszeiten_text" in e else "keine_zeiten"
    herk = {k: v for k, v in acc["fq"].items() if k in e}
    if herk:
        e["felder_quelle"] = herk
    meth = {k: v for k, v in acc["h"].items() if k in e}
    if meth:
        e["felder_methode"] = meth
    e["_requests"] = reqs
    return e


# ------------------------------------------------------------------ Hauptprogramm

def main():
    probe = "--probe" in sys.argv
    t0 = time.time()
    pois = [p for p in load_js(META, "window.AL_META")["pois"] if p.get("web")]
    # gleiche Adresse bei mehreren Orten -> nur einmal abrufen, Angaben nicht zuordenbar
    count = {}
    for p in pois:
        count[p["web"]] = count.get(p["web"], 0) + 1
    old = {}
    if os.path.exists(OUT):
        try:
            old = json.load(open(OUT, encoding="utf-8")).get("orte", {})
        except Exception:
            old = {}
    today = dt.date.today().isoformat()
    fetcher = Fetcher()
    orte, report = {}, []
    for p in pois:
        key = p["osm"]
        url = p["web"]
        host = urllib.parse.urlparse(url).netloc.lower()
        if time.time() - t0 > BUDGET:
            e = {"name": p["n"], "quelle": url, "status": "nicht_erreichbar", "hinweis": "Zeitbudget des Laufs erschoepft, nicht besucht", "_requests": 0}
        elif not url.startswith("http") or any(h in host for h in SKIP_HOSTS):
            e = {"name": p["n"], "quelle": url, "status": "nicht_erreichbar", "hinweis": "nicht besucht (soziales Netzwerk, Baukasten-Adresse oder keine http-Adresse)", "_requests": 0}
        else:
            try:
                e = process_ort(fetcher, p, count[url] > 1)
            except Exception as ex:
                e = {"name": p["n"], "quelle": url, "status": "nicht_erreichbar", "hinweis": "Fehler bei der Auswertung: %s" % str(ex)[:100], "_requests": 0}
        e["gelesen"] = today
        report.append((key, e))
        orte[key] = e
    # Kontaktdaten, die bei >= 3 Orten derselben Domain identisch sind, sind Kopf-/Fusszeilen der Seite (z. B. Zentrale der
    # Gemeinde), nicht die des einzelnen Ortes: nur beim Gemeindeamt behalten.
    by_host = {}
    for p in pois:
        by_host.setdefault(urllib.parse.urlparse(p["web"]).netloc.lower(), []).append(p)
    for host, ps in by_host.items():
        for fld in ("telefon", "email"):
            vals = {}
            for p in ps:
                v = orte[p["osm"]].get(fld)
                if v:
                    vals.setdefault(v, []).append(p)
            for v, owners in vals.items():
                if len(owners) >= 3 or (len(owners) >= 2 and any(o.get("t") == "townhall" for o in owners)):
                    for p in owners:
                        if p.get("t") != "townhall":
                            e = orte[p["osm"]]
                            e.pop(fld, None)
                            if fld == "telefon":
                                e.pop("telefon_weitere", None)
                            e.get("felder_quelle", {}).pop(fld, None)
                            e.get("felder_methode", {}).pop(fld, None)
                            e["hinweis"] = (e.get("hinweis", "") + " Gemeinsame Zentrale-%s der Domain nicht uebernommen." % fld).strip()
    reached = sum(1 for _, e in report if e["status"] != "nicht_erreichbar")
    # Zusammenfassung
    n = len(report)
    c_ok = sum(1 for _, e in report if e["status"] == "ok")
    c_osm = sum(1 for _, e in report if e.get("oh_osm"))
    c_tel = sum(1 for _, e in report if e.get("telefon"))
    c_mail = sum(1 for _, e in report if e.get("email"))
    c_desc = sum(1 for _, e in report if e.get("beschreibung"))
    print("Orte mit Webseite: %d | erreicht: %d | nicht erreichbar/nicht besucht: %d" % (n, reached, n - reached))
    print("Oeffnungszeiten (Text): %d, davon sicher als OSM ableitbar: %d | Telefon: %d | E-Mail: %d | Beschreibung: %d" % (c_ok, c_osm, c_tel, c_mail, c_desc))
    print("HTTP-Anfragen gesamt (inkl. robots.txt): %d | Dauer: %.0f s" % (fetcher.n_requests, time.time() - t0))
    for key, e in report:
        extra = []
        if e.get("oeffnungszeiten_text"):
            extra.append("Z: " + e["oeffnungszeiten_text"][:70])
        if e.get("oh_osm"):
            extra.append("OSM: " + e["oh_osm"][:60])
        if e.get("telefon"):
            extra.append("T: " + e["telefon"])
        if e.get("email"):
            extra.append("M: " + e["email"])
        if e.get("hinweis"):
            extra.append("(" + e["hinweis"][:80] + ")")
        print("  %-16s %-34s %-16s %s" % (e["status"], e["name"][:34], "req=%d" % e.get("_requests", 0), " | ".join(extra)))
    if reached == 0:
        print("TOTALAUSFALL: keine einzige Seite erreichbar - bestehende Datei bleibt unveraendert.", file=sys.stderr)
        sys.exit(1)
    # Orte, die diesmal nicht erreichbar waren, aber frueher Daten hatten: letzten Stand behalten
    for key, e in orte.items():
        if e["status"] == "nicht_erreichbar" and old.get(key, {}).get("status") in ("ok", "keine_zeiten"):
            keep = dict(old[key])
            keep["hinweis"] = ("Abruf am %s fehlgeschlagen (%s); Stand vom %s" % (today, e.get("hinweis", ""), keep.get("gelesen", "?")))[:200]
            orte[key] = keep
    for e in orte.values():
        e.pop("_requests", None)
    if not probe:
        os.makedirs(os.path.dirname(OUT), exist_ok=True)
        tmp = OUT + ".part"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump({"gelesen": today, "orte": orte}, f, ensure_ascii=False, indent=1)
        os.replace(tmp, OUT)
        print("geschrieben:", OUT, "(%d Orte)" % len(orte))


if __name__ == "__main__":
    main()
