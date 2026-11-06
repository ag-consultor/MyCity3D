@echo off
rem Startet einen lokalen Webserver fuer die Seite und oeffnet sie im Browser.
rem Per Doppelklick auf index.html laeuft die Seite nicht richtig (Luftbild fehlt), sie braucht http://.
rem Beenden: dieses Fenster schliessen oder Strg+C.
cd /d "%~dp0site"
echo Seite laeuft auf http://localhost:8123/  (Fenster offen lassen, zum Beenden schliessen)
start "" http://localhost:8123/
python -m http.server 8123
