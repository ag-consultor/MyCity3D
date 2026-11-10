/* Startseite: Rubrik "Landwirtschaft, Wald und Meldungen" (Bausteine aus landwirt.js) */
(function () {
  'use strict';
  var A = window.ALA; if (!A) return;
  A.mountBoden(document.getElementById('agrBoden'));
  var b = document.getElementById('agrBrand'); if (b) b.innerHTML = A.brandHtml();
  var d = document.getElementById('agrDrohne'); if (d) d.innerHTML = A.drohneHtml();
  var m = document.getElementById('agrMaerker'); if (m) m.innerHTML = A.maerkerHtml();
})();
