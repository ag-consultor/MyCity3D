/* Touren (Rad, Wandern, Inline-Skaten): Seite touren.html. Routen aus data/touren.js (OpenStreetMap, ODbL), Grenze aus data/meta.js. Keine Verbindung zu Dritten. */
(function () {
  'use strict';
  var T = window.AL_TOUREN, M = window.AL_META, O = window.ORT || {}, ON = O.name || 'dem Gebiet';
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function de1(v) { return String(Math.round(v * 10) / 10).replace('.', ','); }
  var COL = { 'Inline-Skaten': '#ff5aa5', 'Rad': '#3aa0ff', 'Wandern': '#7fd64f', 'Mountainbike': '#e8883a' };
  var ART_TXT = { 'Inline-Skaten': 'Inline-Skaten', 'Rad': 'Radrouten', 'Wandern': 'Wanderwege', 'Mountainbike': 'Mountainbike' };
  var NETZ = { icn: 'international', ncn: 'national', rcn: 'regional', lcn: 'lokal', nwn: 'national', rwn: 'regional', lwn: 'lokal', regional: 'regional', local: 'lokal' };
  var sel = null, art = null;

  function karte(routen) { // einfache 2D-Karte: Gemeindegrenze und Routen
    var b = M.boundary || [], xs = [], zs = [];
    b.forEach(function (r) { for (var i = 0; i < r.length; i += 2) { xs.push(r[i]); zs.push(r[i + 1]); } });
    var x0 = Math.min.apply(null, xs), x1 = Math.max.apply(null, xs), z0 = Math.min.apply(null, zs), z1 = Math.max.apply(null, zs), W = 640, pad = 14, k = (W - 2 * pad) / (x1 - x0), H = Math.round((z1 - z0) * k + 2 * pad);
    function P(x, z) { return ((x - x0) * k + pad).toFixed(1) + ',' + ((z - z0) * k + pad).toFixed(1); }
    function path(flat) { var s = []; for (var i = 0; i < flat.length; i += 2) s.push(P(flat[i], flat[i + 1])); return s.join(' '); }
    var g = b.map(function (r) { return '<polygon points="' + path(r) + '" fill="rgba(255,255,255,.04)" stroke="rgba(255,255,255,.35)" stroke-width="1"/>'; }).join('');
    var ort = (M.ortsteile || []).map(function (o) { var p = P(o.x, o.z).split(','); return '<text class="tr-o" x="' + p[0] + '" y="' + p[1] + '" text-anchor="middle">' + esc(o.n) + '</text>'; }).join('');
    // gewaehlte Route zuletzt zeichnen
    var order = routen.slice().sort(function (a, c) { return (a.id === sel ? 1 : 0) - (c.id === sel ? 1 : 0); });
    var lines = order.map(function (r) {
      var dim = sel && r.id !== sel, c = COL[r.art] || '#fff';
      return r.lines.map(function (l) { return '<polyline fill="none" stroke="' + c + '" stroke-width="' + (r.id === sel ? 3.6 : r.art === 'Inline-Skaten' ? 2.4 : 1.8) + '" stroke-opacity="' + (dim ? 0.18 : 0.9) + '" stroke-linecap="round" stroke-linejoin="round" points="' + path(l) + '"><title>' + esc(r.name) + '</title></polyline>'; }).join('');
    }).join('');
    return '<svg class="tr-svg" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Übersichtskarte der Touren in ' + ON + '">' + g + lines + ort + '</svg>';
  }

  function liste(routen) {
    var arten = ['Inline-Skaten', 'Rad', 'Wandern', 'Mountainbike'].filter(function (a) { return routen.some(function (r) { return r.art === a; }); });
    return arten.map(function (a) {
      return '<h3 class="tr-h"><i style="background:' + COL[a] + '"></i>' + ART_TXT[a] + '</h3><ul class="tr-list">' + routen.filter(function (r) { return r.art === a; }).map(function (r) {
        var sub = [(NETZ[r.netz] || r.netz) ? 'Netz: ' + (NETZ[r.netz] || r.netz) : '', r.km_gesamt ? 'gesamt ' + Math.round(r.km_gesamt) + ' km' : '', r.von && r.nach ? esc(r.von) + ' - ' + esc(r.nach) : '', r.betreiber ? esc(r.betreiber) : ''].filter(Boolean).join(' · ');
        return '<li><button type="button" class="tr-b' + (sel === r.id ? ' on' : '') + '" data-id="' + esc(r.id) + '"><b>' + esc(r.name) + '</b>' + (r.ref && r.ref !== r.name ? ' <small>' + esc(r.ref) + '</small>' : '') + '<span class="tr-km">' + de1(r.km_gem) + ' km im Gebiet</span>' + (sub ? '<small class="tr-sub">' + sub + '</small>' : '') + '</button>'
          + (r.web && /^https?:\/\//.test(r.web) ? '<a class="tr-w" href="' + esc(r.web) + '" target="_blank" rel="noopener">Webseite der Route →</a>' : '') + '</li>';
      }).join('') + '</ul>';
    }).join('');
  }

  A();
  function A() {
    var el = document.getElementById('trBox');
    if (!el) return;
    if (!T || !T.routen || !T.routen.length) { el.innerHTML = '<p class="note">Zurzeit liegen keine Tourendaten vor.</p>'; return; }
    var wv = T.wikivoyage;
    function draw() {
      var skate = T.routen.filter(function (r) { return r.art === 'Inline-Skaten'; }), skm = skate.reduce(function (s, r) { return s + r.km_gem; }, 0);
      el.innerHTML = '<div class="tr-grid"><div class="tr-map">' + karte(T.routen) + '<p class="tr-s">Grenze und Routen laut OpenStreetMap. Eine Route anklicken, um sie hervorzuheben. Pink: Inline-Skaten, blau: Radrouten, grün: Wanderwege.</p>'
        + '<p><a class="wxbtn" href="karte.html#l=photo.buildings.places.stops.labels.borders.shadows.touren">In der 3D-Karte zeigen</a></p></div>'
        + '<div class="tr-lst">' + liste(T.routen) + '</div></div>'
        + (skate.length ? '<p class="tr-fact">In ' + esc(ON) + ' verlaufen rund <b>' + Math.round(skm) + ' km</b> Inline-Skate-Strecke (' + skate.length + ' Routen).</p>' : '')
        + (wv ? '<h3 class="tr-h">Mehr zu den Touren</h3><p class="ge">' + esc(wv.text) + '</p><p class="note">Text aus dem Wikivoyage-Artikel <a href="' + esc(wv.url) + '" target="_blank" rel="noopener">„' + esc(wv.titel) + '“</a> (Version vom ' + wv.version.slice(8, 10) + '.' + wv.version.slice(5, 7) + '.' + wv.version.slice(0, 4) + '), Autoren siehe <a href="' + esc(wv.hist) + '" target="_blank" rel="noopener">Versionsgeschichte</a>, Lizenz <a href="https://creativecommons.org/licenses/by-sa/4.0/deed.de" target="_blank" rel="noopener">CC BY-SA 4.0</a> (gekürzt).</p>' : '')
        + '<p class="lgn">Routen: © OpenStreetMap-Mitwirkende, <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">ODbL</a>, Stand ' + T.stand.slice(8, 10) + '.' + T.stand.slice(5, 7) + '.' + T.stand.slice(0, 4) + '. Die Längen im Gebiet sind aus der Geometrie gerechnet, die Gesamtlängen stehen nur, wo OpenStreetMap sie führt. Zustand, Sperrungen und Beschilderung vor Ort können abweichen. Die Seiten der Tourismusverbände sind nicht übernommen, ihre Texte sind nicht frei.</p>';
      Array.prototype.forEach.call(el.querySelectorAll('.tr-b'), function (b) { b.onclick = function () { sel = sel === b.dataset.id ? null : b.dataset.id; draw(); }; });
    }
    draw();
  }
})();
