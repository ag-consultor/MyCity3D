/* Wetter auf der Karte: Chip in der Kopfkarte, Details bzw. Einwilligung als Fenster, Regen/Schnee-Effekte ueber der Karte. */
(window.ALW ? window.ALW.ready : function () {})(function (A) {
  'use strict';
  var chip = document.getElementById('wx');
  if (!A || !chip) return;
  if (A.consent && !A.fresh) return; // Dienst nicht erreichbar: kein Chip
  var W = A.data, pop = document.createElement('div');
  pop.className = 'wxpop'; pop.hidden = true; pop.setAttribute('role', 'dialog'); pop.setAttribute('aria-label', 'Wetter');
  chip.hidden = false;
  if (!A.consent) {
    chip.innerHTML = A.svg('cloudy', 16) + '<span>Wetter</span>';
    chip.setAttribute('aria-label', 'Wetter einblenden');
    pop.innerHTML = '<div class="big"><span style="font-size:20px">Wetter einblenden?</span></div>'
      + '<p>Aktuelle Werte, Vorhersage, amtliche Warnungen und Regen- oder Schneeeffekte auf der Karte, Daten vom Deutschen Wetterdienst.</p>'
      + '<p>Dafür verbindet sich Ihr Browser mit <b>api.brightsky.dev</b> (freie Schnittstelle auf DWD-Daten). Dabei wird Ihre IP-Adresse an diesen Dienst übertragen. Ohne Zustimmung findet keine Verbindung statt. Mehr in der <a href="datenschutz.html" target="_blank" rel="noopener">Datenschutzerklärung</a>.</p>'
      + '<p><button class="wxbtn" id="wxOkK" type="button">Wetter einblenden</button></p>';
  } else {
    chip.innerHTML = A.svg(W.icon, 16) + '<span>' + A.temp(W.temp) + '</span>';
    var wl = A.warnLevel();
    if (wl) chip.classList.add('w' + wl);
    chip.title = 'Wetter: ' + A.summary() + (wl ? ' - amtliche Warnung' : '');
    chip.setAttribute('aria-label', 'Wetter: ' + A.summary() + (wl ? ', amtliche Warnung' : '') + ', Details öffnen');
    pop.innerHTML = '<div class="big">' + A.svg(W.icon, 30) + '<span>' + A.temp(W.temp) + '</span><small>' + A.text(W.icon) + '</small></div>'
      + A.warnHtml(true) + '<p>' + A.details() + '</p><div class="wxstrip">' + A.forecastHtml(6) + '</div>'
      + (A.hasMovingEffect() ? '<label><input type="checkbox" id="wxFxK"> Wettereffekte auf der Karte</label>' : '')
      + '<p>' + A.sourceHtml() + ' ' + A.stand() + '</p><p><a href="#" id="wxOffK">Wetter ausblenden</a></p>';
  }
  document.body.appendChild(pop);
  var ok = pop.querySelector('#wxOkK'); if (ok) ok.onclick = function () { A.giveConsent(); };
  var off = pop.querySelector('#wxOffK'); if (off) off.onclick = function (e) { e.preventDefault(); A.revoke(); };
  var fx = pop.querySelector('#wxFxK');
  if (fx) { fx.checked = A.effectsOn(); fx.onchange = function () { A.setEffects(fx.checked); }; }

  function place() {
    var r = chip.getBoundingClientRect(), w = pop.offsetWidth;
    pop.style.top = Math.round(r.bottom + 8) + 'px';
    pop.style.left = Math.max(10, Math.min(innerWidth - w - 10, r.left)) + 'px';
  }
  chip.addEventListener('click', function (e) { e.stopPropagation(); pop.hidden = !pop.hidden; if (!pop.hidden) place(); });
  document.addEventListener('click', function (e) { if (!pop.hidden && !pop.contains(e.target)) pop.hidden = true; });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') pop.hidden = true; });
  addEventListener('resize', function () { if (!pop.hidden) place(); });
  if (A.fresh) A.mountEffects({ dim: true, z: 3 });
});
