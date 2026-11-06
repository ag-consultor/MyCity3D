/* Startseite: Aktualisierungsstand, Neuigkeiten, Ortsteil-Liste und rechtliche Links. Alles aus den Dateien in data/, nichts von Fremdservern. */
(function () {
  'use strict';
  var $ = function (s) { return document.querySelector(s); };
  var ST = window.AL_STAND, NEWS = window.AL_NEWS, META = window.AL_META, R = window.AL_RECHT || {};
  var MON = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];
  function lang(iso) { if (!iso) return 'unbekannt'; var p = iso.split('-'); return +p[2] + '. ' + MON[+p[1] - 1] + ' ' + p[0]; }
  function kurz(iso) { if (!iso) return 'unbekannt'; var p = iso.split('-'); return p[2] + '.' + p[1] + '.' + p[0]; }
  function zahl(n) { return new Intl.NumberFormat('de-DE').format(n); }
  function el(tag, cls, txt) { var e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; }

  if (ST) {
    $('#standLauf').textContent = lang(ST.lauf);
    $('#standKurz').textContent = 'Stand: ' + kurz(ST.lauf);
    $('#nGeb').textContent = zahl(Math.round(ST.gebaeude / 100) * 100);
    $('#nOrte').textContent = ST.orte;
    $('#nHalt').textContent = ST.haltestellen;
    var rows = [
      ['Orte und Haltestellen', kurz(ST.osm), 'OpenStreetMap, ' + ST.orte + ' Orte, ' + ST.haltestellen + ' Haltestellen'],
      ['Fahrplan', 'gültig bis ' + kurz(ST.fahrplan.bis), ((window.ORT || {}).betreiberKurz || 'Sollfahrplan') + '-Sollfahrplan, gelesen ' + kurz(ST.fahrplan.stand)],
      ST.termine.stand ? ['Termine', kurz(ST.termine.stand), ST.termine.anzahl + ' Termine' + (ST.termine.quelle ? ', ' + ST.termine.quelle : '')] : null,
      ST.ortsteilInfo ? ['Ortsteil-Porträts', kurz(ST.ortsteilInfo), 'Website der Gemeinde'] : null,
      ['Gebäude und Adressen', 'abgerufen ' + kurz(ST.lgb), zahl(ST.gebaeude) + ' Gebäude, ' + zahl(ST.adressen) + ' Adressen (LGB)'],
      ['Bodenrichtwerte', 'Stichtag ' + kurz(ST.brw), 'BORIS Brandenburg']
    ].filter(Boolean);
    var grid = $('#standGrid');
    rows.forEach(function (r) {
      var d = el('div'), dd = el('dd', null, r[1]);
      dd.appendChild(el('small', null, r[2]));
      d.appendChild(el('dt', null, r[0])); d.appendChild(dd); grid.appendChild(d);
    });
  } else {
    $('#standLauf').textContent = 'nicht verfügbar';
  }

  var ul = $('#neuListe');
  if (NEWS && NEWS.items && NEWS.items.length) {
    NEWS.items.slice(0, 8).forEach(function (n) {
      var li = el('li'), t = el('time', null, kurz(n.date)), b = el('div');
      t.dateTime = n.date; b.appendChild(document.createTextNode(n.title));
      if (n.sub) b.appendChild(el('span', 's', n.sub));
      li.appendChild(t); li.appendChild(b); ul.appendChild(li);
    });
  } else {
    ul.appendChild(el('li', 'neu-leer', 'Seit dem letzten Wochenlauf (' + (NEWS ? kurz(NEWS.stand) : '-') + ') hat sich bei Orten, Haltestellen und Terminen nichts geändert.'));
  }

  var ol = $('#otListe');
  if (META && META.ortsteile) {
    META.ortsteile.forEach(function (o, i) {
      var li = el('li'), a = el('a', null, o.n);
      a.href = 'karte.html#ortsteil=' + i; li.appendChild(a); ol.appendChild(li);
    });
  }

  var ok = function (u) { return /^https:\/\//i.test(u || '') || /^(\.\/|\/)?[\w./-]+\.html?$/i.test(u || ''); };
  var host = $('#legal');
  [['Impressum', R.impressum], ['Datenschutz', R.datenschutz]].forEach(function (p) {
    if (!ok(p[1])) return;
    var a = el('a', null, p[0]); a.href = p[1]; host.appendChild(a); a.style.marginRight = '16px';
  });
})();
