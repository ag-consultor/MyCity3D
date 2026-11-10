/* Ein Schalter für alle Live-Daten (Wetter mit Warnungen, Luftqualität, Baustellen, Bahn und Bus samt Fahrzeugen).
   Der Klick öffnet einen Hinweis mit den Diensten; erst „Alle Live-Daten laden“ erteilt die Einwilligung für alle auf einmal und lädt die Seite neu.
   Ohne diesen Klick (oder die Einzelschalter) findet keine Verbindung zu Dritten statt. Eine eingebettete Müllabfuhr-Abfrage (falls in ort.json
   eingetragen; sie setzt meist ein Cookie) bleibt ein eigener Schalter. Gemerkt wird nur im Browser (localStorage), jederzeit widerrufbar.
   Welche Dienste dazugehören, steht in ort.json (window.ORT): fahrplan.live_hosts, bausteine.baustellen, Bodenrichtwerte live (scripts/laender.py brw_live). */
(function () {
  'use strict';
  var O = window.ORT || {}, HOSTS = O.liveHosts || [];
  var KEYS = ['alw-ok', 'alw-luft'];
  if (O.baustellen === 'bb') KEYS.push('alw-bau'); // Bayern: Baustellen kommen aus einer eigenen Datei, ohne Fremdabruf
  if (O.brwLive) KEYS.push('alw-brw');
  if (HOSTS.length) KEYS.push('alw-vbb');
  var CACHES = ['alw-cache2', 'alw-luft-c', 'alw-bau-c'];
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function get(k) { try { return localStorage.getItem(k) === 'ja'; } catch (e) { return false; } }
  function allOn() { return KEYS.every(get); }
  function anyOn() { return KEYS.some(get); }
  var namen = ['Wetter', 'Luftqualität'];
  if (O.baustellen === 'bb') namen.push('Baustellen');
  if (O.brwLive) namen.push('Bodenrichtwerte');
  if (HOSTS.length) namen.push('Bahn und Bus');
  var liste = namen.slice(0, -1).join(', ') + ' sowie ' + namen[namen.length - 1];
  var btn = document.createElement('button');
  btn.type = 'button'; btn.className = 'livebtn'; btn.id = 'liveAlle';
  function label() {
    var on = allOn();
    btn.innerHTML = '<i class="dot' + (on ? ' on' : '') + '"></i><span>' + (on ? 'Live an' : 'Live-Daten laden') + '</span>';
    btn.title = on ? 'Live-Daten sind eingeschaltet. Klicken zum Ausschalten.' : liste.replace(' sowie ', ' und ') + ' mit einem Klick laden';
    btn.setAttribute('aria-label', btn.title);
  }
  label();
  var nav = document.querySelector('.nav nav'), top = document.querySelector('.brand .topline');
  if (nav) nav.insertBefore(btn, nav.querySelector('.btn'));
  else if (top && window.matchMedia && matchMedia('(max-width: 760px)').matches) top.appendChild(btn);
  else { btn.classList.add('fix'); document.body.appendChild(btn); }

  var dlg = document.createElement('dialog'); dlg.className = 'lgdlg'; dlg.setAttribute('aria-labelledby', 'lgdT');
  function fill() {
    if (allOn()) {
      dlg.innerHTML = '<h2 id="lgdT">Live-Daten sind an</h2><p>' + esc(liste) + ' werden direkt aus Ihrem Browser abgerufen.</p>'
        + '<div class="lgbtns"><button type="button" class="wxbtn" data-aus>Live-Daten ausschalten</button><button type="button" class="btn ghost" data-zu>Schließen</button></div>';
    } else {
      var li = '<li><b>Wetter und amtliche Warnungen</b><small>api.brightsky.dev (Deutscher Wetterdienst)</small></li><li><b>Luftqualität</b><small>air-quality-api.open-meteo.com</small></li>';
      if (O.baustellen === 'bb') li += '<li><b>Baustellen und Sperrungen</b><small>isk.geobasis-bb.de (Land Brandenburg)</small></li>';
      if (O.brwLive) li += '<li><b>Bodenrichtwert an der angeklickten Stelle</b><small>' + esc(O.brwLive.host) + ' (Bayerische Vermessungsverwaltung)</small></li>';
      if (HOSTS.length) li += '<li><b>Bahn und Bus, Fahrzeuge auf der Karte</b><small>' + esc(HOSTS.map(function (h) { return h.replace('https://', ''); }).join(' oder ')) + '</small></li>';
      dlg.innerHTML = '<h2 id="lgdT">Live-Daten laden</h2><p>Mit einem Klick werden diese Daten <b>direkt von Ihrem Browser</b> bei den Diensten abgerufen. Dabei wird Ihre IP-Adresse an den jeweiligen Dienst übertragen. Ohne Ihre Zustimmung findet keine Verbindung statt.</p>'
        + '<ul class="lglinks">' + li + '</ul>'
        + '<p class="lgn">' + (O.muell ? 'Die Müllabfuhr-Abfrage (' + esc(O.muell.name) + ') kann ein Cookie setzen und bleibt ein eigener Schalter. ' : '')
        + (O.datenschutz ? 'Mehr in der <a href="' + esc(O.datenschutz) + '" target="_blank" rel="noopener">Datenschutzerklärung</a>. ' : '') + 'Widerruf jederzeit hier.</p>'
        + '<div class="lgbtns"><button type="button" class="wxbtn" data-an>Alle Live-Daten laden</button><button type="button" class="btn ghost" data-zu>Abbrechen</button></div>';
    }
    var z = dlg.querySelector('[data-zu]'); if (z) z.onclick = function () { dlg.close(); };
    var an = dlg.querySelector('[data-an]');
    if (an) an.onclick = function () { try { KEYS.forEach(function (k) { localStorage.setItem(k, 'ja'); }); CACHES.forEach(function (k) { sessionStorage.removeItem(k); }); } catch (e) { /* ohne Speicher: nicht merkbar */ } location.reload(); };
    var aus = dlg.querySelector('[data-aus]');
    if (aus) aus.onclick = function () { try { KEYS.forEach(function (k) { localStorage.removeItem(k); }); CACHES.forEach(function (k) { sessionStorage.removeItem(k); }); } catch (e) { /* egal */ } location.reload(); };
  }
  document.body.appendChild(dlg);
  btn.onclick = function () { fill(); if (dlg.showModal) dlg.showModal(); else dlg.setAttribute('open', ''); };
  dlg.addEventListener('click', function (e) { if (e.target === dlg) dlg.close(); });
  if (anyOn() && !allOn()) btn.title += ' (einzelne Dienste sind schon an)';
})();
