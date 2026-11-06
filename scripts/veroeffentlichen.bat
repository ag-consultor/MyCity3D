@echo off
rem Prueft site\ und laedt sie per WinSCP auf deinen Webspace hoch.
rem   veroeffentlichen.bat            -> hochladen (Fenster bleibt am Ende offen)
rem   veroeffentlichen.bat vorschau   -> nur anzeigen, was hochgeladen wuerde, nichts wird uebertragen
rem   veroeffentlichen.bat auto       -> wie hochladen, ohne Pause (fuer den Wochenlauf)
rem Voraussetzung: WinSCP-Sitzung (Name in ort.json: veroeffentlichung.winscp_sitzung) mit gespeichertem Passwort (siehe docs\VEROEFFENTLICHEN.md).
rem Achtung: Pfade mit Klammern, z. B. (x86), duerfen nicht in if-Bloecken ausgegeben werden. Deshalb goto statt Bloecke.
cd /d "%~dp0.."
set "MODUS=%~1"

python scripts\baue_seiten.py
python scripts\versionieren.py
python scripts\pruefe_veroeffentlichung.py
if errorlevel 1 goto pruefung_fehlt

set "WINSCP=C:\Program Files (x86)\WinSCP\WinSCP.com"
if not exist "%WINSCP%" goto winscp_fehlt

set "SKRIPT=scripts\winscp_sync.txt"
if /i "%MODUS%"=="vorschau" set "SKRIPT=scripts\winscp_vorschau.txt"

for /f "delims=" %%a in ('python scripts\ort_wert.py veroeffentlichung.winscp_sitzung') do set "SITZUNG=%%a"
for /f "delims=" %%a in ('python scripts\ort_wert.py veroeffentlichung.zielordner') do set "ZIEL=%%a"
"%WINSCP%" /log=data\state\winscp.log /script=%SKRIPT% /parameter "%CD%\site" "%SITZUNG%" "%ZIEL%"
if errorlevel 1 goto upload_fehlt

if /i "%MODUS%"=="vorschau" goto vorschau_fertig
echo %date% %time% > data\state\letzte_veroeffentlichung.txt
echo.
echo Fertig: Hochladen abgeschlossen. Seite im Browser pruefen.
goto ende

:vorschau_fertig
echo.
echo Vorschau beendet, es wurde nichts uebertragen.
goto ende

:pruefung_fehlt
echo.
echo ABBRUCH: Die Pruefung ist nicht bestanden, es wurde nichts hochgeladen.
set "FEHLER=1"
goto ende

:winscp_fehlt
echo.
echo ABBRUCH: WinSCP wurde am erwarteten Ort nicht gefunden.
set "FEHLER=1"
goto ende

:upload_fehlt
echo.
echo FEHLER beim Hochladen oder bei der Verbindung. Siehe data\state\winscp.log
echo Haeufige Ursachen: WinSCP-Sitzung (Name in ort.json) fehlt oder ohne gespeichertes Passwort,
echo Zielordner heisst anders, keine Internetverbindung.
set "FEHLER=1"
goto ende

:ende
if /i not "%MODUS%"=="auto" pause
if defined FEHLER exit /b 1
exit /b 0
