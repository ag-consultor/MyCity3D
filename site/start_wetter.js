/* Wetterkarte der Startseite (Daten, Einwilligung und Effekte: wetter.js). */
(window.ALW ? window.ALW.ready : function () {})(function (A) {
  'use strict';
  var sec = document.getElementById('wetter'), now = document.getElementById('wxNow');
  if (!A || !sec) return;
  sec.hidden = false;
  var O = window.ORT || {}, CAM = O.webcam || null;
  var HINT = 'Dafür verbindet sich Ihr Browser mit <b>api.brightsky.dev</b>, einer freien Schnittstelle auf den offenen Daten des Deutschen Wetterdienstes' + (CAM ? ', und für die Webcam-Vorschau mit <b>' + String(CAM.url).replace(/^https?:\/\//, '').split('/')[0] + '</b>' : '') + '. Dabei wird Ihre IP-Adresse an diesen Dienst übertragen. Ohne Ihre Zustimmung findet keine Verbindung statt.' + (O.datenschutz ? ' Mehr in der <a href="' + O.datenschutz + '" target="_blank" rel="noopener">Datenschutzerklärung</a>.' : '');
  if (!A.consent) {
    now.innerHTML = '<div><div class="t" style="font-size:22px">Wetter in der Gemeinde</div><small>Aktuelle Werte, Vorhersage und amtliche Warnungen vom DWD, dazu passt sich die Seite dem Wetter an.</small></div>';
    document.getElementById('wxStrip').innerHTML = '<button class="btn" id="wxOk" type="button">Wetter einblenden</button>';
    document.getElementById('wxSrc').innerHTML = HINT;
    document.getElementById('wxOk').onclick = function () { A.giveConsent(); };
    return;
  }
  if (!A.fresh) {
    now.innerHTML = '<div><div class="t" style="font-size:20px">Wetter zurzeit nicht abrufbar</div><small>Der Dienst hat nicht geantwortet. Bitte später erneut versuchen.</small></div>';
    document.getElementById('wxSrc').innerHTML = '<a href="#wetter" id="wxOff">Wetter ausblenden</a>';
    document.getElementById('wxOff').onclick = function (e) { e.preventDefault(); A.revoke(); };
    return;
  }
  var W = A.data;
  now.innerHTML = A.svg(W.icon, 44) + '<div><div class="t">' + A.temp(W.temp) + '</div><small>' + A.text(W.icon) + ' · ' + A.details() + '</small></div>';
  document.getElementById('wxStrip').innerHTML = A.forecastHtml(7);
  var days = A.dailyHtml(7), dEl = document.getElementById('wxDays');
  if (dEl && days) { dEl.innerHTML = '<h3>Wetterbericht für die nächsten Tage</h3><div class="wxdays">' + days + '</div>'; dEl.hidden = false; }
  var rn = A.rainHtml(false), rEl = document.getElementById('wxRain');
  if (rEl && rn) { rEl.innerHTML = '<h3>Niederschlag der letzten Tage</h3>' + rn; rEl.hidden = false; }
  var cEl = document.getElementById('wxCam'), cam = A.webcamHtml(false); if (cEl && cam) { cEl.innerHTML = cam; cEl.hidden = false; }
  document.getElementById('wxWarn').innerHTML = A.warnHtml(true);
  document.getElementById('wxSrc').innerHTML = A.sourceHtml() + ' ' + A.stand() + ' Die Seite passt Stimmung und Hintergrund dem Wetter an. <a href="#wetter" id="wxOff">Wetter ausblenden</a>';
  document.getElementById('wxOff').onclick = function (e) { e.preventDefault(); A.revoke(); };
  if (A.hasMovingEffect()) {
    var sw = document.getElementById('wxSw'), cb = document.getElementById('wxFx');
    sw.hidden = false; cb.checked = A.effectsOn(); cb.onchange = function () { A.setEffects(cb.checked); };
  }
  A.mountEffects({ z: 3 });
});
