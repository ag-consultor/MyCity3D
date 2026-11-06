/* Links in der Fusszeile. Vollstaendige https-Adresse oder eine Seite auf dieser Subdomain.
   Leer gelassen erscheint kein Link. scripts/pruefe_veroeffentlichung.py bricht das Veroeffentlichen ab, solange ein Feld leer ist.
   Die Adressen kommen aus ort.json (veroeffentlichung.impressum_url / datenschutz_url). Impressum und Datenschutzerklaerung
   muss, wer die Seite betreibt, selbst bereitstellen. Diese Vorlage liefert keine mit. */
window.AL_RECHT = {
  impressum: (window.ORT || {}).impressum || '',
  datenschutz: (window.ORT || {}).datenschutz || '',
};
