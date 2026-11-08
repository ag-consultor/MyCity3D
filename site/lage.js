/* Aktuelle Lage: Luftqualitaet (Open-Meteo) und Baustellen/Sperrungen (Landesbetrieb Strassenwesen Brandenburg).
   Beide Quellen werden aus dem Browser des Besuchers abgerufen, und zwar jede erst nach eigener Einwilligung ("einblenden", gemerkt im
   Browser, jederzeit widerrufbar). Ohne Einwilligung findet KEINE Verbindung zu Dritten statt. Eigene Dateien oder ein Betreiber-Abruf sind nicht noetig. */
(function () {
  'use strict';
  var LUFT = 'https://air-quality-api.open-meteo.com/v1/air-quality?latitude=' + ((window.ORT || {}).wetter || [51.95, 12.95])[0] + '&longitude=' + ((window.ORT || {}).wetter || [51.95, 12.95])[1] + '&current=european_aqi,pm10,pm2_5,nitrogen_dioxide,ozone&timezone=Europe%2FBerlin';
  var BAU = 'https://isk.geobasis-bb.de/ows/baustelleninfo_wfs?service=WFS&version=2.0.0&request=GetFeature&typeNames=app:baustelleninfo&outputFormat=application/geo%2Bjson&srsName=EPSG:4326&bbox=' + (((window.ORT || {}).umgrenzung || [51.86, 12.75, 52.04, 13.15]).join(',')) + ',urn:ogc:def:crs:EPSG::4326';
  var TZ = 'Europe/Berlin';
  var ORTN = (window.ORT || {}).name || '';

  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function ok(key) { try { return localStorage.getItem(key) === 'ja'; } catch (e) { return false; } }
  function setOk(key, on) { try { if (on) localStorage.setItem(key, 'ja'); else localStorage.removeItem(key); } catch (e) { /* ohne Speicher: nur bis zum Neuladen */ } }
  function getJson(u) { // nach 12 s aufgeben, statt ewig zu laden
    var ctl = new AbortController(), tm = setTimeout(function () { ctl.abort(); }, 12000);
    return fetch(u, { credentials: 'omit', referrerPolicy: 'no-referrer', signal: ctl.signal }).then(function (r) { clearTimeout(tm); if (!r.ok) throw new Error(r.status); return r.json(); }, function (e) { clearTimeout(tm); throw e; });
  }
  function cached(k, ms, fn) { // kurzer Zwischenspeicher je Sitzung, schont die Dienste
    try { var c = JSON.parse(sessionStorage.getItem(k) || 'null'); if (c && Date.now() - c.t < ms) return Promise.resolve(c.d); } catch (e) { /* kein Cache */ }
    return fn().then(function (d) { try { sessionStorage.setItem(k, JSON.stringify({ t: Date.now(), d: d })); } catch (e) { /* egal */ } return d; });
  }
  var nf = new Intl.NumberFormat('de-DE', { maximumFractionDigits: 0 });
  function hhmm(iso) { return new Date(iso).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit', timeZone: TZ }); }
  function dmy(iso) { var p = String(iso).slice(0, 10).split('-'); return p[2] + '.' + p[1] + '.' + p[0]; }
  function bind(box, key, again) {
    var b = box.querySelector('[data-lg-ok]'); if (b) b.onclick = function () { setOk(key, true); again(); };
    var o = box.querySelector('[data-lg-off]'); if (o) o.onclick = function (e) { e.preventDefault(); setOk(key, false); again(); };
  }
  function consentHtml(title, why, host, what) {
    return '<div class="lg"><b class="lgt">' + title + '</b><p class="lgn">' + why + ' Dafür verbindet sich Ihr Browser mit <b>' + host + '</b> (' + what + '). Dabei wird Ihre IP-Adresse an diesen Dienst übertragen. Ohne Ihre Zustimmung findet keine Verbindung statt. ' + ((window.ORT || {}).datenschutz ? '<a href="' + (window.ORT || {}).datenschutz + '" target="_blank" rel="noopener">Datenschutz</a>' : '') + '</p>'
      + '<button class="wxbtn" type="button" data-lg-ok>' + title + ' einblenden</button></div>';
  }

  // ------------------------------------------------------------------------- Luftqualitaet (Europaeischer Luftqualitaetsindex)
  var EAQI = [[20, 'gut', '#2fd0b0'], [40, 'ausreichend', '#7bdc6a'], [60, 'mäßig', '#f2d34a'], [80, 'schlecht', '#f59639'], [100, 'sehr schlecht', '#f04646'], [1e9, 'extrem schlecht', '#be5af0']];
  function luft(box) {
    var KEY = 'alw-luft', again = function () { luft(box); };
    if (!window.fetch) return;
    if (!ok(KEY)) { box.innerHTML = consentHtml('Luftqualität', 'Der Europäische Luftqualitätsindex mit Feinstaub, Stickstoffdioxid und Ozon für die Gemeinde.', 'air-quality-api.open-meteo.com', 'freie Schnittstelle von Open-Meteo auf Modelldaten des Copernicus-Dienstes CAMS'); bind(box, KEY, again); return; }
    box.innerHTML = '<p class="lgn">Luftqualität wird geladen …</p>';
    cached('alw-luft-c', 600000, function () { return getJson(LUFT); }).then(function (d) {
      var c = d.current, a = Math.round(c.european_aqi), lv = EAQI.filter(function (x) { return a <= x[0]; })[0];
      var v = function (x, u) { return x == null ? '–' : nf.format(Math.round(x)) + ' ' + u; };
      box.innerHTML = '<div class="lg"><b class="lgt">Luftqualität</b><div class="lgbig"><span class="dot" style="background:' + lv[2] + '"></span><span class="num">' + a + '</span><span class="lbl">' + lv[1] + '</span></div>'
        + '<p class="lgd">Feinstaub PM10 ' + v(c.pm10, 'µg/m³') + ' · PM2,5 ' + v(c.pm2_5, 'µg/m³') + ' · Stickstoffdioxid ' + v(c.nitrogen_dioxide, 'µg/m³') + ' · Ozon ' + v(c.ozone, 'µg/m³') + '</p>'
        + '<p class="lgn">Modellrechnung (Copernicus CAMS) für das Gemeindegebiet, <b>keine Messung vor Ort</b>. Europäischer Luftqualitätsindex von 0 bis über 100. Stand ' + hhmm(c.time) + ' Uhr. Quelle: <a href="https://open-meteo.com/en/docs/air-quality-api" target="_blank" rel="noopener">Open-Meteo</a>, CC BY 4.0. Ohne Gewähr. <a href="#" data-lg-off>Luftqualität ausblenden</a></p></div>';
      bind(box, KEY, again);
    })['catch'](function () { box.innerHTML = '<p class="lgn">Luftqualität zurzeit nicht abrufbar. <a href="#" data-lg-off>Ausblenden</a></p>'; bind(box, KEY, again); });
  }

  // ------------------------------------------------------------------------- Baustellen und Sperrungen (Strassen des Landes und Bundes)
  function gruppen(fc) { // Abschnitte einer Massnahme (ID_1, ID_3, ...) zu einer Meldung zusammenfassen
    var heute = new Date().toISOString().slice(0, 10), in30 = new Date(Date.now() + 30 * 864e5).toISOString().slice(0, 10), m = {};
    (fc.features || []).forEach(function (f) {
      var p = f.properties || {}, id = String(p.ID || f.id).replace(/_\d+$/, '');
      if (!p.Baustellen_Ende || p.Baustellen_Ende < heute || (p.Baustellen_Beginn || '') > in30) return;
      var g = m[id] || (m[id] = { id: id, ort: String(p.Ortsangabe || '').replace(/\s+\d+\s*m\.?$/, ''), strasse: p.Straßenummner || '', von: p.Baustellen_Beginn, bis: p.Baustellen_Ende, sperr: false, text: p.Verkehrsinformation || '', stand: p.Zeitstempel || '' });
      if (p.Art === 'Sperrung' || p.Status_Fahrstreifen === 'Fahrstreifen gesperrt') g.sperr = true;
      if (p.Baustellen_Beginn < g.von) g.von = p.Baustellen_Beginn;
      if (p.Baustellen_Ende > g.bis) g.bis = p.Baustellen_Ende;
    });
    return Object.keys(m).map(function (k) { return m[k]; }).sort(function (a, b) { return a.von < b.von ? -1 : 1; });
  }
  function eintrag(g) {
    var kurz = g.text.replace(/\n{2,}/g, '\n').trim(), erst = kurz.split('\n')[0];
    return '<details class="lgbau"><summary><b>' + esc(g.strasse) + '</b> · ' + esc(g.ort.replace(/\s*\([^)]*\)\s*$/, '')) + ' <span class="lgtag' + (g.sperr ? ' s' : '') + '">' + (g.sperr ? 'Sperrung' : 'Baustelle') + '</span>'
      + '<span class="lgz">' + dmy(g.von) + ' bis ' + dmy(g.bis) + (g.von > new Date().toISOString().slice(0, 10) ? ' (geplant)' : '') + (erst ? ' · ' + esc(erst.slice(0, 90)) : '') + '</span></summary>'
      + '<p class="lgd">' + esc(kurz.slice(0, 700)).replace(/\n/g, '<br>') + '</p></details>';
  }
  function baustellen(box) {
    var KEY = 'alw-bau', again = function () { baustellen(box); };
    if (!window.fetch) return;
    if (!ok(KEY)) { box.innerHTML = consentHtml('Baustellen und Sperrungen', 'Aktuelle Baustellen und Sperrungen auf Bundes- und Landesstraßen in der Gemeinde und Umgebung.', 'isk.geobasis-bb.de', 'Geodienst des Landes Brandenburg, Daten des Landesbetriebs Straßenwesen'); bind(box, KEY, again); return; }
    box.innerHTML = '<p class="lgn">Baustellen werden geladen …</p>';
    cached('alw-bau-c', 900000, function () { return getJson(BAU); }).then(function (fc) {
      var all = gruppen(fc), hier = all.filter(function (g) { return g.ort.indexOf(ORTN) === 0; }), nah = all.filter(function (g) { return g.ort.indexOf(ORTN) !== 0; });
      var html = '<div class="lg"><b class="lgt">Baustellen und Sperrungen</b><h4 class="lgh">In ' + ORTN + '</h4>'
        + (hier.length ? hier.map(eintrag).join('') : '<p class="lgd">Keine Meldung für Bundes-, Landes- und Kreisstraßen in der Gemeinde.</p>');
      if (nah.length) html += '<h4 class="lgh">In der Umgebung</h4>' + nah.slice(0, 10).map(eintrag).join('');
      var st = all.reduce(function (a, g) { return g.stand > a ? g.stand : a; }, '');
      html += '<p class="lgn">Quelle: Landesbetrieb Straßenwesen Brandenburg über <a href="https://isk.geobasis-bb.de/ows/baustelleninfo_wms?service=WMS&request=GetCapabilities" target="_blank" rel="noopener">isk.geobasis-bb.de</a>, <a href="https://www.govdata.de/dl-de/by-2-0" target="_blank" rel="noopener">dl-de/by-2.0</a>. '
        + 'Erfasst sind Straßen des Bundes und des Landes; Gemeindestraßen und kurzfristige Arbeiten fehlen womöglich. Keine Meldung heißt nicht, dass es keine Baustelle gibt.' + (st ? ' Jüngste Meldung vom ' + dmy(st) + '.' : '') + ' Ohne Gewähr. <a href="#" data-lg-off>Baustellen ausblenden</a></p></div>';
      box.innerHTML = html; bind(box, KEY, again);
    })['catch'](function () { box.innerHTML = '<p class="lgn">Baustellen zurzeit nicht abrufbar. <a href="#" data-lg-off>Ausblenden</a></p>'; bind(box, KEY, again); });
  }

  // ------------------------------------------------------------------------- Muellabfuhr (optional, nur wenn ort.json "bausteine.muellabfuhr" eintraegt)
  // Das Formular des Entsorgers wird unveraendert eingebettet (dieselbe Adresse, die er auf der eigenen Seite nutzt). Wir speichern und kopieren keine Termine.
  // Ein Beispiel (Suedbrandenburg: SBAZV) steht in ort.json; die Einbettung ist ein eigener Schalter, weil Entsorger dabei meist ein Cookie setzen.
  function muell(box) {
    var M = (window.ORT || {}).muell;
    if (!box || !M || !M.url) return;
    var KEY = 'alw-muell', again = function () { muell(box); };
    if (!ok(KEY)) {
      var host = M.url.replace(/^https?:\/\//, '').split('/')[0];
      box.innerHTML = consentHtml('Müllabfuhr', 'Abfuhrtermine für Ihre Straße.', host, 'Abfuhrabfrage: ' + esc(M.name || host) + (M.hinweis ? '; ' + esc(M.hinweis) : ''));
      bind(box, KEY, again); return;
    }
    box.innerHTML = '<div class="lg"><b class="lgt">Müllabfuhr</b><p class="lgn">' + esc(M.anleitung || 'Ort wählen, dann Straße und Hausnummer.') + '</p>'
      + '<iframe class="lgframe" src="' + esc(M.url) + '" title="Abfuhrtermine: ' + esc(M.name || '') + '" loading="lazy" referrerpolicy="no-referrer" sandbox="allow-scripts allow-forms allow-same-origin allow-popups"></iframe>'
      + '<p class="lgn">Angaben von ' + (M.seite ? '<a href="' + esc(M.seite) + '" target="_blank" rel="noopener">' + esc(M.name || M.seite) + '</a>' : esc(M.name || '')) + ', nicht von dieser Seite; maßgeblich ist dessen Auskunft. <a href="' + esc(M.url) + '" target="_blank" rel="noopener">In neuem Fenster öffnen</a> · <a href="#" data-lg-off>Müllabfuhr ausblenden</a></p></div>';
    bind(box, KEY, again);
  }

  window.ALL = { luft: luft, baustellen: baustellen, muell: muell };
})();
