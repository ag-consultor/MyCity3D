/* Wetter des Deutschen Wetterdienstes (DWD) fuer Startseite und Karte.
   Die Daten kommen aus dem Browser des Besuchers von der freien DWD-Schnittstelle Bright Sky (api.brightsky.dev), und zwar nur nach
   ausdruecklicher Einwilligung (Schalter "Wetter einblenden", gemerkt im Browser, jederzeit widerrufbar). Ohne Einwilligung findet
   KEINE Verbindung zu Dritten statt. Eigene Dateien oder ein Betreiber-Abruf sind nicht noetig. */
(function () {
  'use strict';
  var API = 'https://api.brightsky.dev', LAT = ((window.ORT || {}).wetter || [51.95, 12.95])[0], LON = ((window.ORT || {}).wetter || [51.95, 12.95])[1];
  var queue = [], done = false, consent = false;
  try { consent = localStorage.getItem('alw-ok') === 'ja'; } catch (e) { /* ohne Speicher: keine Einwilligung merkbar */ }
  window.AL_WETTER = null;
  window.ALW = {
    ready: function (fn) { if (done) fn(window.ALW); else queue.push(fn); },
    consent: consent,
    giveConsent: function () { try { localStorage.setItem('alw-ok', 'ja'); } catch (e) { /* egal */ } location.reload(); },
    revoke: function () { try { localStorage.removeItem('alw-ok'); sessionStorage.removeItem('alw-cache2'); } catch (e) { /* egal */ } location.reload(); }
  };
  function finish() { init(); done = true; queue.splice(0).forEach(function (fn) { try { fn(window.ALW); } catch (e) { /* ein Fehler im Wetter darf die Seite nicht stoeren */ } }); }
  function getJson(u) { // nach 12 s aufgeben, statt die Seite warten zu lassen
    var ctl = new AbortController(), tm = setTimeout(function () { ctl.abort(); }, 12000);
    return fetch(u, { credentials: 'omit', referrerPolicy: 'no-referrer', signal: ctl.signal }).then(function (r) { clearTimeout(tm); if (!r.ok) throw new Error(r.status); return r.json(); }, function (e) { clearTimeout(tm); throw e; });
  }
  // Tageswerte der nächsten Tage aus den stündlichen DWD-Vorhersagewerten (Bright Sky): Höchst- und Tiefstwert, Niederschlag, Wind, Symbol
  function tageswerte(rows) {
    var by = {}, order = [];
    rows.forEach(function (r) {
      var d = new Date(r.timestamp).toLocaleDateString('sv-SE', { timeZone: 'Europe/Berlin' });
      if (!by[d]) { by[d] = []; order.push(d); }
      by[d].push(r);
    });
    var PREC = { thunderstorm: 1, hail: 1, snow: 1, sleet: 1, rain: 1 };
    return order.map(function (d, i) {
      var a = by[d];
      if (a.length < 12 && i > 0) return null; // angeschnittener letzter Tag
      var temps = a.map(function (r) { return r.temperature; }).filter(function (v) { return v != null; });
      if (!temps.length) return null;
      var day = a.filter(function (r) { var h = +new Date(r.timestamp).toLocaleTimeString('en-GB', { hour: '2-digit', timeZone: 'Europe/Berlin' }).slice(0, 2); return h >= 7 && h <= 20; });
      if (!day.length) day = a;
      var cnt = {}, prec = 0, thunder = 0;
      day.forEach(function (r) {
        var ic = (r.icon || 'cloudy').replace('-night', '-day');
        cnt[ic] = (cnt[ic] || 0) + 1;
        if (PREC[ic]) prec++;
        if (ic === 'thunderstorm') thunder++;
      });
      var icon, keys = Object.keys(cnt);
      function top(list) { return list.sort(function (x, y) { return cnt[y] - cnt[x]; })[0]; }
      if (thunder) icon = 'thunderstorm';
      else if (prec >= 3) icon = top(keys.filter(function (k) { return PREC[k]; }));
      else icon = top(keys.filter(function (k) { return !PREC[k]; })) || top(keys);
      var sum = 0, p = 0, wind = 0;
      a.forEach(function (r) { sum += r.precipitation || 0; if (r.precipitation_probability > p) p = r.precipitation_probability; if (r.wind_speed > wind) wind = r.wind_speed; });
      return { d: d, tmax: Math.max.apply(null, temps), tmin: Math.min.apply(null, temps), regen: Math.round(sum * 10) / 10, wahrsch: p, wind: Math.round(wind), icon: icon };
    }).filter(Boolean);
  }
  // Niederschlag der letzten 7 Tage aus den stündlichen DWD-Werten (Bright Sky): letzte Nacht (22 bis 7 Uhr), 12 und 24 Stunden, 7 Tage, Tagessummen
  function berlinDay(t) { return new Date(t).toLocaleDateString('sv-SE', { timeZone: 'Europe/Berlin' }); }
  function regenwerte(rows) {
    if (!rows || !rows.length) return null;
    var now = Date.now(), today = berlinDay(now), yest = berlinDay(now - 864e5), days = {}, order = [], s = { h12: 0, h24: 0, d7: 0, nacht: 0 }, n = 0;
    rows.forEach(function (r) {
      var t = Date.parse(r.timestamp), p = r.precipitation;
      if (p == null || t > now) return;
      n++; s.d7 += p;
      if (now - t <= 12 * 3600e3) s.h12 += p;
      if (now - t <= 24 * 3600e3) s.h24 += p;
      var d = berlinDay(t), h = +new Date(t).toLocaleTimeString('en-GB', { hour: '2-digit', timeZone: 'Europe/Berlin' }).slice(0, 2);
      if ((d === yest && h >= 22) || (d === today && h < 7)) s.nacht += p;
      if (!(d in days)) { days[d] = 0; order.push(d); }
      days[d] += p;
    });
    if (n < 24) return null;
    var r1 = function (v) { return Math.round(v * 10) / 10; };
    return { h12: r1(s.h12), h24: r1(s.h24), d7: r1(s.d7), nacht: r1(s.nacht), tage: order.slice(-7).map(function (d) { return { d: d, mm: r1(days[d]) }; }), n: n, bis: new Date(now).toISOString() };
  }
  function build(cur, fc) {
    var w = cur.weather, now = new Date();
    var rows = (fc.weather || []).filter(function (r) { return r.temperature != null; });
    return {
      stand: now.toISOString(), messung: w.timestamp, temp: w.temperature, wind: w.wind_speed_10 != null ? w.wind_speed_10 : w.wind_speed_60, boe: w.wind_gust_speed_10,
      wolken: w.cloud_cover, windrichtung: w.wind_direction_10 != null ? w.wind_direction_10 : w.wind_direction_60, regen60: w.precipitation_60, feuchte: w.relative_humidity, sicht: w.visibility, bedingung: w.condition, icon: w.icon,
      stationen: (cur.sources || []).filter(function (x) { return x.distance < 20000; }).map(function (x) { return x.station_name; }).slice(0, 3),
      vorhersage: rows.filter(function (r, i) { return i % 3 === 0; }).slice(0, 9).map(function (r) {
        return { t: r.timestamp, temp: r.temperature, icon: r.icon, bedingung: r.condition, regen: r.precipitation, wahrsch: r.precipitation_probability, wolken: r.cloud_cover };
      }),
      tage: tageswerte(rows),
      quelle: 'Deutscher Wetterdienst (DWD), über Bright Sky', quelleUrl: 'https://www.dwd.de/DE/leistungen/opendata/opendata.html'
    };
  }
  function load() {
    if (!consent || !window.fetch) { finish(); return; }
    try { var c = JSON.parse(sessionStorage.getItem('alw-cache2') || 'null'); if (c && Date.now() - c.t < 600000) { window.AL_WETTER = c.d; finish(); return; } } catch (e) { /* kein Cache */ }
    var start = new Date(Math.floor(Date.now() / 3600000) * 3600000), end = new Date(start.getTime() + 7 * 24 * 3600000);
    var iso = function (d) { return d.toISOString().slice(0, 16); };
    Promise.all([getJson(API + '/current_weather?lat=' + LAT + '&lon=' + LON), getJson(API + '/weather?lat=' + LAT + '&lon=' + LON + '&date=' + iso(start) + '&last_date=' + iso(end)),
      getJson(API + '/alerts?lat=' + LAT + '&lon=' + LON + '&tz=Europe/Berlin')['catch'](function () { return null; }),
      getJson(API + '/weather?lat=' + LAT + '&lon=' + LON + '&date=' + iso(new Date(start.getTime() - 7 * 24 * 3600000)) + '&last_date=' + iso(start))['catch'](function () { return null; })])
      .then(function (r) {
        window.AL_WETTER = build(r[0], r[1]);
        window.AL_WETTER.regen = r[3] && r[3].weather ? regenwerte(r[3].weather) : null;
        // Warnungen: null = Abruf fehlgeschlagen (nicht als "keine Warnung" zeigen), [] = keine Warnung
        window.AL_WETTER.warn = r[2] && r[2].alerts ? r[2].alerts.map(function (a) {
          return { stufe: a.severity, ereignis: a.event_de, titel: a.headline_de, text: a.description_de, hinweis: a.instruction_de, ab: a.onset || a.effective, bis: a.expires };
        }) : null;
        try { sessionStorage.setItem('alw-cache2', JSON.stringify({ t: Date.now(), d: window.AL_WETTER })); } catch (e) { /* egal */ }
        finish();
      })['catch'](function () { window.AL_WETTER = null; finish(); });
  }
  load();

  function init() {
  var W = window.AL_WETTER, MAXAGE = 4 * 3600 * 1000;
  var fresh = !!(W && W.stand && Date.now() - Date.parse(W.stand) < MAXAGE);
  var P = {
    'clear-day': '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/>',
    'clear-night': '<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/>',
    'partly': '<path d="M12 2v2M4.93 4.93l1.41 1.41M20 12h2M19.07 4.93l-1.41 1.41"/><path d="M15.95 12.65a4 4 0 0 0-5.93-4.13"/><path d="M13 22H7a5 5 0 1 1 4.9-6H13a3 3 0 0 1 0 6Z"/>',
    'cloudy': '<path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z"/>',
    'rain': '<path d="M4 14.9A7 7 0 1 1 15.71 8h1.79a4.5 4.5 0 0 1 2.5 8.24"/><path d="M16 14v6M8 14v6M12 16v6"/>',
    'snow': '<path d="M12 2v20M4.93 6l14.14 12M19.07 6 4.93 18"/><path d="m9 4 3 2 3-2M9 20l3-2 3 2"/>',
    'fog': '<path d="M4 14.9A7 7 0 1 1 15.71 8h1.79a4.5 4.5 0 0 1 2.5 8.24"/><path d="M16 17H7M17 21H9"/>',
    'storm': '<path d="M4 14a1 1 0 0 1-.78-1.63l9.9-10.2a.5.5 0 0 1 .86.46l-1.92 6.02A1 1 0 0 0 13 10h7a1 1 0 0 1 .78 1.63l-9.9 10.2a.5.5 0 0 1-.86-.46l1.92-6.02A1 1 0 0 0 11 14z"/>'
  };
  var TXT = { 'clear-day': 'klar', 'clear-night': 'klar', 'partly-cloudy-day': 'wolkig', 'partly-cloudy-night': 'wolkig', cloudy: 'bedeckt', fog: 'Nebel', wind: 'windig',
    rain: 'Regen', sleet: 'Schneeregen', snow: 'Schnee', hail: 'Hagel', thunderstorm: 'Gewitter' };
  var KIND = { 'clear-day': 'sun', 'clear-night': 'night', 'partly-cloudy-day': 'cloud', 'partly-cloudy-night': 'night', cloudy: 'cloud', fog: 'fog', wind: 'cloud',
    rain: 'rain', sleet: 'rain', snow: 'snow', hail: 'snow', thunderstorm: 'storm' };
  function glyph(icon) {
    if (icon === 'partly-cloudy-day' || icon === 'partly-cloudy-night') return P.partly;
    if (icon === 'rain' || icon === 'sleet') return P.rain;
    if (icon === 'snow' || icon === 'hail') return P.snow;
    if (icon === 'thunderstorm') return P.storm;
    if (icon === 'wind') return P.cloudy;
    return P[icon] || P.cloudy;
  }
  function svg(icon, size) {
    return '<svg class="wxi" width="' + (size || 18) + '" height="' + (size || 18) + '" viewBox="0 0 24 24" aria-hidden="true">' + glyph(icon) + '</svg>';
  }
  var nf = new Intl.NumberFormat('de-DE', { maximumFractionDigits: 0 });
  function temp(t) { return nf.format(Math.round(t)).replace('-', '−') + ' °C'; }
  function hhmm(iso) { return new Date(iso).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Berlin' }); }
  function dayShort(iso) { return new Date(iso).toLocaleDateString('de-DE', { weekday: 'short', timeZone: 'Europe/Berlin' }); }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }

  var kind = fresh ? (KIND[W.icon] || 'cloud') : null;
  if (kind) document.documentElement.setAttribute('data-wx', kind);

  var api = window.ALW;
  api.data = W; api.fresh = fresh; api.kind = kind; api.svg = svg; api.text = function (i) { return TXT[i] || ''; }; api.temp = temp; api.hhmm = hhmm;

  api.summary = function () { return fresh ? TXT[W.icon] + ', ' + temp(W.temp) : ''; };
  api.stand = function () { return W ? 'Stand ' + hhmm(W.stand) + ' Uhr, ' + new Date(W.stand).toLocaleDateString('de-DE', { day: 'numeric', month: 'numeric', timeZone: 'Europe/Berlin' }) : ''; };
  api.details = function () {
    if (!fresh) return '';
    var l = [];
    if (W.wind != null) l.push('Wind ' + nf.format(Math.round(W.wind)) + ' km/h' + (W.boe ? ', Böen ' + nf.format(Math.round(W.boe)) + ' km/h' : ''));
    if (W.wolken != null) l.push('Bewölkung ' + W.wolken + ' %');
    if (W.regen60 > 0) l.push('Niederschlag ' + String(W.regen60).replace('.', ',') + ' mm/h');
    if (W.feuchte != null) l.push('Luftfeuchte ' + W.feuchte + ' %');
    return l.join(' · ');
  };
  // Amtliche DWD-Warnungen fuer die Gemeinde (Warnzelle laut Bright Sky). null = nicht abrufbar.
  var STUFE = { minor: ['Wetterwarnung', 1], moderate: ['Markante Wetterwarnung', 2], severe: ['Unwetterwarnung', 3], extreme: ['Extreme Unwetterwarnung', 4] };
  api.warnings = function () {
    if (!fresh || !W.warn) return null;
    var now = Date.now();
    return W.warn.filter(function (a) { return !a.bis || Date.parse(a.bis) > now; }).sort(function (a, b) { return (STUFE[b.stufe] || [0, 0])[1] - (STUFE[a.stufe] || [0, 0])[1]; });
  };
  api.warnLevel = function () { var l = api.warnings(); return l && l.length ? (STUFE[l[0].stufe] || [0, 1])[1] : 0; };
  function dt(iso) { return new Date(iso).toLocaleString('de-DE', { weekday: 'short', day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Berlin' }); }
  api.warnHtml = function (full) {
    var l = api.warnings();
    if (l === null) return fresh ? '<p class="note">Warnungen zurzeit nicht abrufbar.</p>' : '';
    if (!l.length) return '<p class="note wxok">Keine amtliche Wetterwarnung für die Gemeinde.</p>';
    return l.map(function (a) {
      var s = STUFE[a.stufe] || ['Warnung', 1];
      return '<div class="wxwarn s' + s[1] + '"><b>' + esc(s[0]) + ': ' + esc(a.ereignis || a.titel || '') + '</b>' +
        '<span class="s">' + (a.ab ? 'ab ' + dt(a.ab) : '') + (a.bis ? ' bis ' + dt(a.bis) : '') + ' Uhr</span>' +
        (full && a.text ? '<span class="d">' + esc(a.text) + '</span>' : '') + (full && a.hinweis ? '<span class="d">' + esc(a.hinweis) + '</span>' : '') + '</div>';
    }).join('');
  };
  api.forecastHtml = function (n) {
    if (!W || !W.vorhersage) return '';
    var now = Date.now();
    return W.vorhersage.filter(function (r) { return Date.parse(r.t) > now - 3600e3; }).slice(0, n || 6).map(function (r) {
      return '<div class="wxf"><span class="h">' + hhmm(r.t) + '</span>' + svg(r.icon, 20) + '<b>' + temp(r.temp) + '</b>' +
        (r.wahrsch >= 30 ? '<span class="p">' + r.wahrsch + ' %</span>' : '<span class="p"></span>') + '</div>';
    }).join('');
  };
  api.dailyHtml = function (n) { // Wetterbericht der nächsten Tage (Startseite)
    if (!W || !W.tage || !W.tage.length) return '';
    var today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Berlin' }), short = function (t) { return nf.format(Math.round(t)).replace('-', '−') + '°'; };
    return W.tage.filter(function (t) { return t.d >= today; }).slice(0, n || 7).map(function (t, i) {
      var dt0 = new Date(t.d + 'T12:00:00Z'), name = i === 0 ? 'Heute' : i === 1 ? 'Morgen' : dt0.toLocaleDateString('de-DE', { weekday: 'short', timeZone: 'UTC' }) + ' ' + dt0.toLocaleDateString('de-DE', { day: 'numeric', month: 'numeric', timeZone: 'UTC' });
      return '<div class="wxd"><span class="d">' + esc(name) + '</span>' + svg(t.icon, 24) + '<b>' + short(t.tmax) + '</b><span class="n">' + short(t.tmin) + '</span>' +
        '<span class="p">' + (t.regen >= 0.1 ? String(t.regen).replace('.', ',') + ' mm' : 'trocken') + (t.wahrsch >= 30 ? ' · ' + t.wahrsch + ' %' : '') + '</span><span class="w">Wind bis ' + t.wind + ' km/h</span></div>';
    }).join('');
  };
  api.webcamHtml = function (small) { // Webcam des DWD (ort.json: bausteine.webcam): Bilder vom Open-Data-Server, nur mit Wetter-Einwilligung
    var C = (window.ORT || {}).webcam;
    if (!C || !C.url) return '';
    var base = C.url, t = Math.floor(Date.now() / 600000), nm = esc(C.name || 'Webcam');
    return '<figure class="wxcam"><a href="' + esc(base) + '1920.jpg?t=' + t + '" target="_blank" rel="noopener"><img src="' + esc(base) + (small ? '400' : '640') + '.jpg?t=' + t + '" alt="Webcam des Deutschen Wetterdienstes: ' + nm + (C.blick ? ', Blick nach ' + esc(C.blick) : '') + '" loading="lazy" referrerpolicy="no-referrer" width="640" height="360"></a>' +
      '<figcaption>Webcam: ' + nm + (C.blick ? ', Blick nach ' + esc(C.blick) : '') + (C.entfernung_km ? ', rund ' + esc(C.entfernung_km) + ' km von hier' : '') + '. Bild alle 10 Minuten neu, Klick vergrößert. Quelle: <a href="https://www.dwd.de/DE/service/rechtliche_hinweise/rechtliche_hinweise_node.html" target="_blank" rel="noopener">Deutscher Wetterdienst, CC BY 4.0</a>.</figcaption></figure>';
  };
  api.rainHtml = function (compact) { // Niederschlag der letzten Tage (gemessen)
    var R = W && W.regen;
    if (!fresh || !R) return '';
    var mm = function (v) { return String(v).replace('.', ',') + ' mm'; };
    if (compact) return '<p class="wxrain">Niederschlag: letzte Nacht <b>' + mm(R.nacht) + '</b> · 24 Stunden <b>' + mm(R.h24) + '</b> · 7 Tage <b>' + mm(R.d7) + '</b></p>';
    var max = Math.max(5, Math.max.apply(null, R.tage.map(function (t) { return t.mm; }))), VW = 420, VH = 100, bw = VW / R.tage.length;
    var bars = R.tage.map(function (t, i) {
      var h = Math.round(t.mm / max * 58), d = new Date(t.d + 'T12:00:00Z'), cx = i * bw + bw / 2;
      return '<rect x="' + (i * bw + bw * 0.2).toFixed(1) + '" y="' + (76 - h) + '" width="' + (bw * 0.6).toFixed(1) + '" height="' + Math.max(h, t.mm > 0 ? 2 : 1) + '" rx="2" fill="' + (t.mm > 0 ? 'var(--cyan)' : 'rgba(255,255,255,.2)') + '"><title>' + esc(d.toLocaleDateString('de-DE', { weekday: 'long', day: 'numeric', month: 'numeric', timeZone: 'UTC' }) + ': ' + mm(t.mm)) + '</title></rect>'
        + '<text x="' + cx.toFixed(1) + '" y="94" text-anchor="middle" class="wxrt">' + d.toLocaleDateString('de-DE', { weekday: 'short', timeZone: 'UTC' }).slice(0, 2) + '</text>'
        + (t.mm >= 0.1 ? '<text x="' + cx.toFixed(1) + '" y="' + Math.max(10, 72 - h) + '" text-anchor="middle" class="wxrt wxrv">' + String(t.mm).replace('.', ',') + '</text>' : '');
    }).join('');
    return '<div class="wxrs"><span>Letzte Nacht (22 bis 7 Uhr) <b>' + mm(R.nacht) + '</b></span><span>12 Stunden <b>' + mm(R.h12) + '</b></span><span>24 Stunden <b>' + mm(R.h24) + '</b></span><span>7 Tage <b>' + mm(R.d7) + '</b></span></div>'
      + (R.d7 === 0 ? '' : '<svg class="wxbars" viewBox="0 0 420 100" role="img" aria-label="Niederschlag je Tag in den letzten 7 Tagen">' + bars + '</svg>')
      + (R.d7 === 0 ? '<p class="note">In den letzten 7 Tagen wurde kein Niederschlag gemessen.</p>' : '')
      + '<p class="note">Stündliche Werte der DWD-Stationen in der Umgebung (über Bright Sky), Summen in Millimetern. Ohne Gewähr.</p>';
  };
  api.sourceHtml = function () {
    return 'Quelle: <a href="' + esc(W.quelleUrl) + '" target="_blank" rel="noopener">' + esc(W.quelle) + '</a>, Messung ' + hhmm(W.messung) + ' Uhr' + (W.stationen && W.stationen.length ? ' (Station ' + esc(W.stationen.join(', ')) + ')' : '') + '. Ohne Gewähr.';
  };

  // ------------------------------------------------------------ Effekte (Regen, Schnee, Hagel, Nebel, Gewitter)
  var reduce = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  var pref = null;
  try { pref = localStorage.getItem('alw-fx'); } catch (e) { /* ohne Speicher: Standard */ }
  api.effectsOn = function () { return fresh && !reduce && pref !== 'off'; };
  var cv, cx, raf = 0, parts = [], opt = {}, flash, w = 0, h = 0, last = 0, nextFlash = 0, dpr = 1;
  function rnd(a, b) { return a + Math.random() * (b - a); }
  function build() {
    parts = [];
    var ic = W.icon, heavy = (W.regen60 || 0) > 1.5 || ic === 'thunderstorm';
    var nR = ic === 'rain' || ic === 'thunderstorm' ? (heavy ? 220 : 140) : ic === 'sleet' ? 70 : 0;
    var nS = ic === 'snow' ? 140 : ic === 'sleet' ? 70 : 0, nH = ic === 'hail' ? 90 : 0;
    var i;
    for (i = 0; i < nR; i++) parts.push({ t: 'r', x: rnd(0, w), y: rnd(0, h), l: rnd(9, 20), v: rnd(11, 20), a: rnd(.2, .5) });
    for (i = 0; i < nS; i++) parts.push({ t: 's', x: rnd(0, w), y: rnd(0, h), r: rnd(1, 3), v: rnd(.6, 1.7), ph: rnd(0, 6.28), a: rnd(.5, .9) });
    for (i = 0; i < nH; i++) parts.push({ t: 'h', x: rnd(0, w), y: rnd(0, h), r: rnd(1.3, 2.6), v: rnd(9, 15), a: rnd(.6, .95) });
  }
  function size() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    w = innerWidth; h = innerHeight;
    cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr);
    cx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  function frame(t) {
    raf = requestAnimationFrame(frame);
    var dt = Math.min(48, t - (last || t)) / 16.7; last = t;
    cx.clearRect(0, 0, w, h);
    if (opt.dim) {
      var k = W.icon;
      cx.fillStyle = k === 'snow' || k === 'fog' ? 'rgba(230,240,250,.08)' : k === 'cloudy' || k === 'rain' || k === 'sleet' || k === 'thunderstorm' || k === 'hail' ? 'rgba(20,32,52,.16)' : 'rgba(0,0,0,0)';
      cx.fillRect(0, 0, w, h);
    }
    var slant = Math.max(.08, Math.min(.5, (W.wind || 6) / 40));
    for (var i = 0; i < parts.length; i++) {
      var p = parts[i];
      if (p.t === 'r') {
        cx.strokeStyle = 'rgba(190,215,245,' + p.a + ')'; cx.lineWidth = 1.1; cx.beginPath(); cx.moveTo(p.x, p.y); cx.lineTo(p.x - p.l * slant, p.y + p.l); cx.stroke();
        p.y += p.v * dt; p.x -= p.v * slant * dt;
      } else if (p.t === 's') {
        cx.fillStyle = 'rgba(255,255,255,' + p.a + ')'; cx.beginPath(); cx.arc(p.x, p.y, p.r, 0, 6.283); cx.fill();
        p.y += p.v * dt; p.ph += .02 * dt; p.x += (Math.sin(p.ph) * .6 - slant * 1.2) * dt;
      } else {
        cx.fillStyle = 'rgba(240,248,255,' + p.a + ')'; cx.beginPath(); cx.arc(p.x, p.y, p.r, 0, 6.283); cx.fill();
        p.y += p.v * dt; p.x -= p.v * slant * .5 * dt;
      }
      if (p.y > h + 24) { p.y = -24; p.x = rnd(0, w + 40); }
      if (p.x < -30) p.x = w + 10;
      if (p.x > w + 30) p.x = -10;
    }
    if (flash && W.icon === 'thunderstorm' && t > nextFlash) {
      flash.style.opacity = '.55'; setTimeout(function () { flash.style.opacity = '0'; }, 90); nextFlash = t + rnd(7000, 16000);
    }
  }
  function startStop() {
    if (api.effectsOn()) {
      if (!cv) {
        cv = document.createElement('canvas'); cv.id = 'wxfx'; cv.setAttribute('aria-hidden', 'true');
        if (opt.z) cv.style.zIndex = opt.z;
        document.body.appendChild(cv); cx = cv.getContext('2d');
        if (W.icon === 'thunderstorm') { flash = document.createElement('div'); flash.id = 'wxflash'; if (opt.z) flash.style.zIndex = opt.z; document.body.appendChild(flash); }
        addEventListener('resize', function () { if (cv) { size(); build(); } });
      }
      cv.hidden = false; size(); build();
      if (!raf) raf = requestAnimationFrame(frame);
    } else {
      if (raf) cancelAnimationFrame(raf); raf = 0;
      if (cv) cv.hidden = true;
    }
  }
  api.mountEffects = function (o) {
    opt = o || {};
    document.addEventListener('visibilitychange', function () { if (document.hidden) { if (raf) { cancelAnimationFrame(raf); raf = 0; } } else startStop(); });
    startStop();
  };
  api.setEffects = function (on) { pref = on ? 'on' : 'off'; try { localStorage.setItem('alw-fx', pref); } catch (e) { /* egal */ } startStop(); };
  api.hasMovingEffect = function () { return fresh && ['rain', 'sleet', 'snow', 'hail', 'thunderstorm'].indexOf(W.icon) >= 0; };
  }
})();
