/* Startseite: Luftqualität, Baustellen und (falls in ort.json eingetragen) Müllabfuhr einhängen.
   Ausgelagert, damit die Inhaltsrichtlinie (CSP) keine Inline-Skripte erlauben muss. */
(function () {
  'use strict';
  var O = window.ORT || {}, A = window.ALL, el = function (id) { return document.getElementById(id); };
  if (!A) return;
  A.luft(el('lageLuft'));
  if (O.baustellen) A.baustellen(el('lageBau')); else if (el('lageBau')) el('lageBau').hidden = true;
  if (O.muell && A.muell) A.muell(el('lageMuell')); else if (el('lageMuell')) el('lageMuell').hidden = true;
})();
