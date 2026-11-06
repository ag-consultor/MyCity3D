@echo off
rem Wochenlauf fuer die Ortskarte: Orte, Haltestellen, Fahrplan, Neuigkeiten.
rem Manuell starten per Doppelklick oder einplanen (siehe docs/VEROEFFENTLICHEN.md).
rem Das Ergebnis liegt danach in site\ und muss noch veroeffentlicht werden.
cd /d "%~dp0.."
echo ==== %date% %time% ==== >> data\state\wochenlauf.log
python scripts\update_weekly.py >> data\state\wochenlauf.log 2>&1
if errorlevel 1 (
  echo FEHLER, siehe data\state\wochenlauf.log
  exit /b 1
)
echo Wochenlauf fertig. Letzte Zeilen:
powershell -NoProfile -Command "Get-Content data\state\wochenlauf.log -Tail 6"
rem Automatisch veroeffentlichen nur, wenn die Datei data\state\auto-veroeffentlichen.on existiert
rem (leere Datei anlegen, sobald die WinSCP-Sitzung (ort.json) eingerichtet und ein erster Upload geklappt hat).
if exist data\state\auto-veroeffentlichen.on (
  call scripts\veroeffentlichen.bat auto >> data\state\wochenlauf.log 2>&1
)
