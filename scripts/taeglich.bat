@echo off
rem Taeglicher Lauf (Waldbrandstufe, Bodenfeuchte), danach Veroeffentlichung.
rem Die Waldbrandstufe veroeffentlicht das Ministerium taeglich; eine alte Stufe ist gefaehrlich falsch,
rem deshalb zeigt die Seite sie nur an, wenn sie nicht aelter als 36 Stunden ist.
rem Die Skripte tun nichts, wenn ort.json die Bausteine (bausteine.waldbrand, bausteine.landwirtschaft) nicht einschaltet.
rem Einplanen (08:30 Uhr): siehe docs\VEROEFFENTLICHEN.md. Automatisch hochladen nur, wenn data\state\auto-veroeffentlichen.on existiert.
cd /d "%~dp0.."
echo ==== %date% %time% taeglich ==== >> data\state\taeglich.log
python scripts\fetch_waldbrand.py >> data\state\taeglich.log 2>&1
python scripts\prepare_landwirt.py >> data\state\taeglich.log 2>&1
python scripts\versionieren.py >> data\state\taeglich.log 2>&1
if exist data\state\auto-veroeffentlichen.on (
  call scripts\veroeffentlichen.bat auto >> data\state\taeglich.log 2>&1
)
powershell -NoProfile -Command "Get-Content data\state\taeglich.log -Tail 4"
