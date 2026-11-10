/* Landwirtschaft und Sicherheit: Bausteine fuer Startseite und Karte.
   Alles aus eigenen Dateien (data/landwirt.js, data/waldbrand.js), keine Verbindung zu Dritten. Einwilligung ist daher nicht noetig.
   Waldbrandstufe, Meldeportal und Drohnenhinweis kommen aus ort.json (bausteine.waldbrand, bausteine.meldeportal, bausteine.drohnenhinweis). */
(function () {
  'use strict';
  var D = window.AL_LANDW, B = window.AL_WALDBRAND, A = {}, O = window.ORT || {};
  window.ALA = A;
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function dm(d) { d = String(d); return d.slice(6, 8) + '.' + d.slice(4, 6) + '.'; }
  function dmy(iso) { return iso.slice(8, 10) + '.' + iso.slice(5, 7) + '.' + iso.slice(0, 4); }
  function de1(v) { return v == null ? '–' : String(Math.round(v * 10) / 10).replace('.', ','); }
  function last(a) { for (var i = a.length - 1; i >= 0; i--) if (a[i] != null) return a[i]; return null; }

  // ---- Bodenfeuchte (Modellrechnung des DWD, % nutzbare Feldkapazitaet)
  var KL = [[80, 'feucht', '#4aa3ff'], [50, 'gut versorgt', '#4fd08a'], [30, 'trocknet ab', '#f1b44c'], [20, 'trocken', '#e8833a'], [-1, 'sehr trocken', '#d04a4a']];
  function klasse(v) { for (var i = 0; i < KL.length; i++) if (v >= KL[i][0]) return KL[i]; return KL[KL.length - 1]; }
  var CROPS = [['Gras', 'g', '#4fd08a'], ['Wintergetreide', 'w', '#f1b44c'], ['Mais', 'm', '#6fb3ff']];
  function key(c, soil) { return 'bf' + c + (soil === 'l' ? 'l' : 's'); }

  function chart(soil) {
    var n = D.tage.length, W = 320, H = 132, L = 28, R = 8, T = 8, Bt = 22, ymax = 120;
    function X(i) { return L + (W - L - R) * i / Math.max(1, n - 1); }
    function Y(v) { return T + (H - T - Bt) * (1 - Math.min(Math.max(v, 0), ymax) / ymax); }
    var g = '';
    [[30, 'trocken'], [50, ''], [80, '']].forEach(function (l) { g += '<line class="agr-g" x1="' + L + '" x2="' + (W - R) + '" y1="' + Y(l[0]).toFixed(1) + '" y2="' + Y(l[0]).toFixed(1) + '"/><text class="agr-t" x="' + (L - 4) + '" y="' + (Y(l[0]) + 3).toFixed(1) + '" text-anchor="end">' + l[0] + '</text>'; });
    var lines = CROPS.map(function (c) {
      var s = D.serien[key(c[1], soil)], pts = [], seg = '';
      for (var i = 0; i < n; i++) { if (s[i] == null) { if (pts.length) { seg += '<polyline fill="none" stroke="' + c[2] + '" stroke-width="1.8" stroke-linejoin="round" points="' + pts.join(' ') + '"/>'; pts = []; } continue; } pts.push(X(i).toFixed(1) + ',' + Y(s[i]).toFixed(1)); }
      if (pts.length) seg += '<polyline fill="none" stroke="' + c[2] + '" stroke-width="1.8" stroke-linejoin="round" points="' + pts.join(' ') + '"/>';
      return seg;
    }).join('');
    var xl = [0, Math.floor((n - 1) / 2), n - 1].map(function (i, k) { return '<text class="agr-t" x="' + X(i).toFixed(1) + '" y="' + (H - 6) + '" text-anchor="' + (k === 0 ? 'start' : k === 2 ? 'end' : 'middle') + '">' + dm(D.tage[i]) + '</text>'; }).join('');
    return '<svg class="agr-svg" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Verlauf der Bodenfeuchte der letzten ' + n + ' Tage in Prozent nutzbarer Feldkapazität">' + g + lines + xl + '</svg>';
  }

  A.bodenHtml = function (soil) {
    if (!D) return '<p class="note">Zurzeit liegen keine Bodenfeuchte-Daten vor.</p>';
    var rows = CROPS.map(function (c) {
      var v = last(D.serien[key(c[1], soil)]), k = v == null ? null : klasse(v);
      return '<div class="agr-row"><span class="agr-n"><i style="background:' + c[2] + '"></i>' + c[0] + '</span><b>' + (v == null ? '–' : Math.round(v) + ' %') + '</b><span class="agr-k" style="color:' + (k ? k[2] : 'inherit') + '">' + (k ? esc(k[1]) : '') + '</span>'
        + '<span class="agr-bar"><i style="width:' + (v == null ? 0 : Math.min(100, Math.round(v / 1.2))) + '%;background:' + (k ? k[2] : '#777') + '"></i></span></div>';
    }).join('');
    var S = D.serien, frost = last(S.frost);
    var extra = '<div class="agr-extra"><span>Bodentemperatur 5 cm <b>' + de1(last(S.ts05)) + ' °C</b></span><span>20 cm <b>' + de1(last(S.ts20)) + ' °C</b></span><span>50 cm <b>' + de1(last(S.ts50)) + ' °C</b></span>'
      + (frost ? '<span>Frost im Boden bis <b>' + Math.round(frost) + ' cm</b></span>' : '') + '<span>Verdunstung (Gras) <b>' + de1(last(S.etp)) + ' mm</b>/Tag</span></div>';
    return rows + chart(soil) + '<div class="agr-leg">' + CROPS.map(function (c) { return '<span><i style="background:' + c[2] + '"></i>' + c[0] + '</span>'; }).join('') + '<span class="agr-hint">Linien: 30 = trocken, 50 und 80 = Orientierung</span></div>' + extra;
  };

  // baut die Bodenfeuchte-Karte in ein Element (mit Umschalter Sand | Lehm)
  A.mountBoden = function (el) {
    if (!el) return;
    if (!D) { el.innerHTML = '<p class="note">Zurzeit liegen keine Bodenfeuchte-Daten vor.</p>'; return; }
    var soil = 's';
    function draw() {
      el.innerHTML = '<div class="chips agr-soil" role="group" aria-label="Bodenart"><button type="button" class="chip' + (soil === 's' ? ' on' : '') + '" data-s="s">Sandboden</button><button type="button" class="chip' + (soil === 'l' ? ' on' : '') + '" data-s="l">Lehm/Schluff</button></div>'
        + '<div class="agr-body">' + A.bodenHtml(soil) + '</div>'
        + '<p class="lgn">Modellrechnung des DWD für typische Böden (Sand, lehmiger Schluff), keine Messung auf dem Acker. Werte in Prozent der nutzbaren Feldkapazität (nFK, 0 = Welkepunkt, 100 = Feldkapazität) in 0 bis 60 cm Tiefe. Die Einordnung ist eine grobe Orientierung ohne Gewähr. Station ' + esc(D.station.name) + ', Tageswert vom ' + dmy(D.stand) + '. Quelle: <a href="https://www.dwd.de/DE/service/rechtliche_hinweise/rechtliche_hinweise_node.html" target="_blank" rel="noopener">Deutscher Wetterdienst, CC BY 4.0</a>, Datensatz <a href="https://opendata.dwd.de/climate_environment/CDC/derived_germany/soil/daily/recent/" target="_blank" rel="noopener">derived_germany/soil/daily</a>, Stand der Seite ' + dmy(D.gelesen) + '.</p>';
      Array.prototype.forEach.call(el.querySelectorAll('[data-s]'), function (b) { b.onclick = function () { soil = b.dataset.s; draw(); }; });
    }
    draw();
  };

  // ---- Waldbrandgefahrenstufe (MLEUV), nur mit frischen Daten
  var COLB = { 1: '#5fbf5f', 2: '#d6e04a', 3: '#f5a623', 4: '#e9161d', 5: '#7f0126' };
  function berlinDay(t) { return new Date(t).toLocaleDateString('sv-SE', { timeZone: 'Europe/Berlin' }); }
  A.brandFrisch = function () {
    if (!B || !B.gelesen || !B.stand) return false;
    var alt = Date.now() - Date.parse(B.gelesen), tage = (Date.parse(berlinDay(Date.now())) - Date.parse(B.stand)) / 864e5;
    return alt < 36 * 3600e3 && tage <= 1;
  };
  A.brandHtml = function () {
    var cfg = O.waldbrand || {}, url = (B && B.url) || cfg.url || '';
    var head = '<b class="lgt">Waldbrandgefahr im Landkreis ' + esc((B && B.kreis) || cfg.kreis || '') + '</b>';
    if (!B) return head + '<p class="lgd">Die tägliche Stufe (1 bis 5) steht auf der <a href="' + url + '" target="_blank" rel="noopener">Seite des Landesministeriums</a>.</p>';
    if (!A.brandFrisch()) return head + '<p class="lgd">Die gespeicherte Stufe (' + dmy(B.stand) + ') ist nicht mehr aktuell und wird deshalb nicht angezeigt. <b>Aktuelle Stufe: <a href="' + url + '" target="_blank" rel="noopener">Seite des Landesministeriums</a>.</b></p>';
    return head + '<div class="lgbig"><i class="dot" style="background:' + COLB[B.stufe] + ';color:' + COLB[B.stufe] + '"></i><span class="num">' + B.stufe + '</span><span class="lbl">' + esc(B.text) + '</span></div>'
      + '<p class="lgd">Stufe 1 bis 5, einheitlich für den ganzen Landkreis. Stand ' + dmy(B.stand) + ', gelesen am ' + dmy(B.gelesen.slice(0, 10)) + ' um ' + B.gelesen.slice(11, 16) + ' Uhr. Höchste Stufe im Land: ' + (B.max_land || '–') + '.</p>'
      + '<p class="lgn">Quelle: ' + esc(B.quelle) + ', <a href="' + url + '" target="_blank" rel="noopener">amtliche Seite</a> (maßgeblich). Ohne Gewähr, bei Stufe 4 und 5 gelten besondere Regeln für den Wald.</p>';
  };

  // ---- Drohnenflug: nur Verweis auf die amtliche Karte (Lizenz der Geozonen fuer eine Einbindung nicht eindeutig)
  A.DIPUL = 'https://maptool-dipul.dfs.de/?language=de';
  A.drohneHtml = function () {
    return '<b class="lgt">Drohnenflug: Beschränkungen prüfen</b>'
      + '<p class="lgd">Für Drohnen gelten rund um Flugplätze, Naturschutzgebiete, Verkehrswege und andere Bereiche Beschränkungen. Flugplätze in der Nähe zeigt die Ebene „Flugplätze“ der Karte. Welche Zonen genau gelten, zeigt die amtliche Karte der Deutschen Flugsicherung (dipul). Bitte vor jedem Flug dort nachsehen.</p>'
      + '<p><a class="wxbtn" href="' + A.DIPUL + '" target="_blank" rel="noopener">Amtliche Karte der Flugbeschränkungen (dipul)</a></p>'
      + '<p class="lgn">Die Zonen sind hier nicht eingebunden: Die Daten stehen laut Bundesamt für Kartographie unter CC BY-ND 4.0 (<a href="https://www.dipul.de/homepage/de/" target="_blank" rel="noopener">dipul</a>), die WMS-Anleitung nennt zusätzlich eine nicht-kommerzielle Nutzung. Für diese Seite ist das nicht eindeutig genug. Die Flugplätze in der Karte stammen aus OpenStreetMap und ersetzen keine amtliche Auskunft.</p>';
  };

  // ---- Meldeportal der Kommune (z. B. Maerker Brandenburg): nur Verweis, keine Schnittstelle (ort.json: bausteine.meldeportal)
  var MP = O.meldeportal || null;
  A.MAERKER = MP ? MP.url : '';
  A.MAERKER_APP = MP ? MP.app : '';
  A.maerkerHtml = function () {
    if (!MP) return '';
    var nm = esc(MP.name || 'Meldeportal');
    return '<b class="lgt">Mängel melden: ' + nm + '</b>'
      + '<p class="lgd">' + esc(MP.beschreibung || 'Defekte Straßenlampe, Schlagloch, wilde Müllkippe, beschädigtes Schild: Hinweise zur kommunalen Infrastruktur gehen an die Kommune.') + '</p>'
      + '<p><a class="wxbtn" href="' + esc(MP.url) + '" target="_blank" rel="noopener">Zum Meldeportal: ' + nm + '</a></p>'
      + '<p class="lgn">' + (MP.app ? '<a href="' + esc(MP.app) + '" target="_blank" rel="noopener">App</a>. ' : '') + 'Eine Meldung direkt aus dieser Karte ist nicht möglich, das Portal bietet dafür keine offene Schnittstelle.'
      + (MP.betreiber ? ' Betrieben von ' + esc(MP.betreiber) + (MP.nutzungsbedingungen ? ', <a href="' + esc(MP.nutzungsbedingungen) + '" target="_blank" rel="noopener">Nutzungsbedingungen</a>' : '') + '.' : '') + '</p>';
  };
})();
