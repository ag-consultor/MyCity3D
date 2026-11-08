/* Klima im Rueckblick (Startseite): Jahreswerte der DWD-Stationen aus data/klima.js. Eigene Daten, keine Verbindung zu Dritten. */
(function () {
  'use strict';
  var K = window.AL_KLIMA, A = {};
  window.ALK = A;
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function de(v, n) { return v == null ? '–' : v.toFixed(n == null ? 1 : n).replace('.', ',').replace('-', '−'); }
  function mean(a) { return a.reduce(function (s, v) { return s + v; }, 0) / a.length; }
  function slope(xs, ys) { var mx = mean(xs), my = mean(ys), n = 0, d = 0; for (var i = 0; i < xs.length; i++) { n += (xs[i] - mx) * (ys[i] - my); d += (xs[i] - mx) * (xs[i] - mx); } return d ? n / d : 0; }
  var MON = ['Jan', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez'];

  function col(dev) { // blau (kuehler) ... weiss ... rot (waermer), +-1,6 Grad
    var t = Math.max(-1, Math.min(1, dev / 1.6)), a = t < 0 ? [33, 102, 172] : [178, 24, 43], w = [244, 244, 244], f = Math.abs(t);
    return 'rgb(' + [0, 1, 2].map(function (i) { return Math.round(w[i] + (a[i] - w[i]) * f); }).join(',') + ')';
  }
  function stripes(J, mt) {
    var y0 = J[0][0], y1 = J[J.length - 1][0], n = y1 - y0 + 1, W = 420, bw = W / n, by = {};
    J.forEach(function (j) { by[j[0]] = j; });
    var r = '';
    for (var y = y0; y <= y1; y++) if (by[y]) r += '<rect x="' + ((y - y0) * bw).toFixed(2) + '" y="0" width="' + (bw + 0.4).toFixed(2) + '" height="56" fill="' + col(by[y][1] - mt) + '"><title>' + y + ': ' + de(by[y][1]) + ' °C (' + (by[y][1] - mt >= 0 ? '+' : '−') + de(Math.abs(by[y][1] - mt)) + ' zum Mittel der Reihe)</title></rect>';
    return '<svg class="kl-svg" viewBox="0 0 420 70" role="img" aria-label="Klimastreifen: Jahresmitteltemperatur von ' + y0 + ' bis ' + y1 + ', blau kühler, rot wärmer als das Mittel der Reihe">' + r
      + '<text class="kl-t" x="0" y="68">' + y0 + '</text><text class="kl-t" x="420" y="68" text-anchor="end">' + y1 + '</text></svg>';
  }
  function lineChart(J, key, ymin, ymax, unit, color) {
    var y0 = J[0][0], y1 = J[J.length - 1][0], W = 420, H = 150, L = 30, R = 6, T = 8, B = 20;
    function X(y) { return L + (W - L - R) * (y - y0) / Math.max(1, y1 - y0); }
    function Y(v) { return T + (H - T - B) * (1 - (v - ymin) / (ymax - ymin)); }
    var g = '', step = ymax - ymin > 8 ? 2 : 1;
    for (var v = Math.ceil(ymin); v <= ymax; v += step) g += '<line class="kl-g" x1="' + L + '" x2="' + (W - R) + '" y1="' + Y(v).toFixed(1) + '" y2="' + Y(v).toFixed(1) + '"/><text class="kl-t" x="' + (L - 4) + '" y="' + (Y(v) + 3).toFixed(1) + '" text-anchor="end">' + v + '</text>';
    var pts = J.map(function (j) { return X(j[0]).toFixed(1) + ',' + Y(j[key]).toFixed(1); });
    // gleitender 10-Jahres-Durchschnitt (aus den vorhandenen Jahren)
    var mv = J.map(function (j) { var w = J.filter(function (k) { return Math.abs(k[0] - j[0]) <= 5; }); return X(j[0]).toFixed(1) + ',' + Y(mean(w.map(function (k) { return k[key]; }))).toFixed(1); });
    var dots = J.map(function (j) { return '<circle cx="' + X(j[0]).toFixed(1) + '" cy="' + Y(j[key]).toFixed(1) + '" r="1.8" fill="' + color + '"><title>' + j[0] + ': ' + de(j[key]) + ' ' + unit + '</title></circle>'; }).join('');
    return '<svg class="kl-svg" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Verlauf von ' + y0 + ' bis ' + y1 + '">' + g + '<polyline fill="none" stroke="' + color + '" stroke-opacity=".45" stroke-width="1" points="' + pts.join(' ') + '"/>' + dots
      + '<polyline fill="none" stroke="#fff" stroke-width="2" stroke-linejoin="round" points="' + mv.join(' ') + '"/>'
      + [y0, Math.round((y0 + y1) / 2), y1].map(function (y, i) { return '<text class="kl-t" x="' + X(y).toFixed(1) + '" y="' + (H - 5) + '" text-anchor="' + (i === 0 ? 'start' : i === 2 ? 'end' : 'middle') + '">' + y + '</text>'; }).join('') + '</svg>';
  }
  function rainChart(J) {
    var y0 = J[0][0], y1 = J[J.length - 1][0], W = 420, H = 150, L = 30, R = 6, T = 8, B = 20, ymax = Math.ceil(Math.max.apply(null, J.map(function (j) { return j[2]; })) / 200) * 200, m = mean(J.map(function (j) { return j[2]; }));
    function X(y) { return L + (W - L - R) * (y - y0 + 0.5) / (y1 - y0 + 1); }
    function Y(v) { return T + (H - T - B) * (1 - v / ymax); }
    var bw = (W - L - R) / (y1 - y0 + 1), g = '';
    for (var v = 0; v <= ymax; v += 200) g += '<line class="kl-g" x1="' + L + '" x2="' + (W - R) + '" y1="' + Y(v).toFixed(1) + '" y2="' + Y(v).toFixed(1) + '"/><text class="kl-t" x="' + (L - 4) + '" y="' + (Y(v) + 3).toFixed(1) + '" text-anchor="end">' + v + '</text>';
    var bars = J.map(function (j) { return '<rect x="' + (X(j[0]) - bw * 0.4).toFixed(1) + '" y="' + Y(j[2]).toFixed(1) + '" width="' + (bw * 0.8).toFixed(1) + '" height="' + (Y(0) - Y(j[2])).toFixed(1) + '" fill="' + (j[2] >= m ? '#4aa3ff' : '#e8a24a') + '"><title>' + j[0] + ': ' + Math.round(j[2]) + ' mm</title></rect>'; }).join('');
    return '<svg class="kl-svg" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Jahresniederschlag von ' + y0 + ' bis ' + y1 + ' in Millimetern">' + g + bars
      + '<line x1="' + L + '" x2="' + (W - R) + '" y1="' + Y(m).toFixed(1) + '" y2="' + Y(m).toFixed(1) + '" stroke="#fff" stroke-width="1.4" stroke-dasharray="4 3"/><text class="kl-t" x="' + (W - R) + '" y="' + (Y(m) - 3).toFixed(1) + '" text-anchor="end" fill="#fff">Mittel ' + Math.round(m) + ' mm</text>'
      + [y0, Math.round((y0 + y1) / 2), y1].map(function (y, i) { return '<text class="kl-t" x="' + X(y).toFixed(1) + '" y="' + (H - 5) + '" text-anchor="' + (i === 0 ? 'start' : i === 2 ? 'end' : 'middle') + '">' + y + '</text>'; }).join('') + '</svg>';
  }
  function facts(st) {
    var J = st.jahre, T = J.map(function (j) { return j[1]; }), R = J.map(function (j) { return j[2]; }), Y = J.map(function (j) { return j[0]; });
    var iw = T.indexOf(Math.max.apply(null, T)), ik = T.indexOf(Math.min.apply(null, T)), it = R.indexOf(Math.min.apply(null, R)), inn = R.indexOf(Math.max.apply(null, R));
    var tr = slope(Y, T) * 10, k = [];
    k.push('Mittel ' + de(mean(T)) + ' °C und ' + Math.round(mean(R)) + ' mm Niederschlag im Jahr (' + J.length + ' vollständige Jahre)');
    k.push('Wärmstes Jahr <b>' + Y[iw] + '</b> (' + de(T[iw]) + ' °C), kältestes <b>' + Y[ik] + '</b> (' + de(T[ik]) + ' °C)');
    k.push('Trockenstes Jahr <b>' + Y[it] + '</b> (' + Math.round(R[it]) + ' mm), nassestes <b>' + Y[inn] + '</b> (' + Math.round(R[inn]) + ' mm)');
    if (J.length >= 15) k.push('Trend der Reihe: <b>' + (tr >= 0 ? '+' : '−') + de(Math.abs(tr)) + ' °C je Jahrzehnt</b> (lineare Anpassung, nur für diese Station)');
    return '<ul class="kl-facts">' + k.map(function (x) { return '<li>' + x + '</li>'; }).join('') + '</ul>';
  }
  function laufend(st) {
    var L = st.laufend && st.laufend.monate;
    if (!L || !L.length) return '';
    var rows = L.map(function (m) {
      var ref = st.monate[String(m[0])]; if (!ref) return '';
      var dt = m[1] - ref[0], dr = ref[1] > 0 ? Math.round(m[2] / ref[1] * 100) : null;
      return '<tr><td>' + MON[m[0] - 1] + '</td><td>' + de(m[1]) + ' °C <small style="color:' + (dt >= 0 ? '#e8833a' : '#6fb3ff') + '">' + (dt >= 0 ? '+' : '−') + de(Math.abs(dt)) + '</small></td><td>' + Math.round(m[2]) + ' mm <small>' + (dr == null ? '' : dr + ' %') + '</small></td></tr>';
    }).join('');
    return '<h4 class="kl-h">' + st.laufend.jahr + ' bisher, verglichen mit dem Mittel ' + esc(st.referenz) + '</h4><table class="kl-tab"><thead><tr><th>Monat</th><th>Temperatur (Abweichung)</th><th>Niederschlag (Anteil)</th></tr></thead><tbody>' + rows + '</tbody></table>';
  }

  A.mount = function (el) {
    if (!el) return;
    if (!K || !K.stationen || !K.stationen.length) { el.innerHTML = '<p class="note">Zurzeit liegen keine Klimadaten vor.</p>'; return; }
    var cur = 0;
    function draw() {
      var st = K.stationen[cur], J = st.jahre;
      el.innerHTML = '<div class="chips kl-st" role="group" aria-label="Station">' + K.stationen.map(function (s, i) { return '<button type="button" class="chip' + (i === cur ? ' on' : '') + '" data-i="' + i + '">' + esc(s.name) + ' <small>' + s.von + (s.bis >= new Date().getFullYear() - 1 ? ' bis heute' : ' bis ' + s.bis) + '</small></button>'; }).join('') + '</div>'
        + '<div class="kl-grid"><div><h4 class="kl-h">Klimastreifen: Jahresmitteltemperatur</h4>' + stripes(J, mean(J.map(function (j) { return j[1]; }))) + '<p class="kl-s">Jeder Streifen ein Jahr, blau kühler und rot wärmer als das Mittel dieser Station.</p>'
        + '<h4 class="kl-h">Jahresmitteltemperatur in °C</h4>' + lineChart(J, 1, Math.floor(Math.min.apply(null, J.map(function (j) { return j[1]; })) - 0.5), Math.ceil(Math.max.apply(null, J.map(function (j) { return j[1]; })) + 0.5), '°C', '#f1b44c') + '<p class="kl-s">Weiße Linie: gleitender Durchschnitt über 10 Jahre.</p></div>'
        + '<div><h4 class="kl-h">Jahresniederschlag in mm</h4>' + rainChart(J) + '<p class="kl-s">Blau über, orange unter dem Mittel.</p>' + facts(st) + '</div></div>'
        + laufend(st)
        + '<p class="lgn">Stationswerte des Deutschen Wetterdienstes (Monatswerte, Climate Data Center). ' + esc(st.name) + ' (' + esc(st.lage) + ')' + (st.bis < new Date().getFullYear() - 1 ? ', die Messreihe endet ' + st.bis : '') + '. Es zählen nur Jahre mit allen 12 Monaten, fehlende Jahre bleiben leer. Reihen verschiedener Stationen sind wegen Standort und Messhöhe nicht unmittelbar vergleichbar. Quelle: <a href="https://www.dwd.de/DE/service/rechtliche_hinweise/rechtliche_hinweise_node.html" target="_blank" rel="noopener">Deutscher Wetterdienst, CC BY 4.0</a>, <a href="https://opendata.dwd.de/climate_environment/CDC/observations_germany/climate/monthly/kl/" target="_blank" rel="noopener">observations_germany/climate/monthly/kl</a>, Stand ' + K.stand.slice(8, 10) + '.' + K.stand.slice(5, 7) + '.' + K.stand.slice(0, 4) + '.</p>';
      Array.prototype.forEach.call(el.querySelectorAll('[data-i]'), function (b) { b.onclick = function () { cur = +b.dataset.i; draw(); }; });
    }
    draw();
  };
})();
