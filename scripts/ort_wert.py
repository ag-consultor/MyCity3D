"""Gibt einen Wert aus ort.json aus, z. B. python scripts/ort_wert.py veroeffentlichung.winscp_sitzung
Wird von veroeffentlichen.bat benutzt, damit dort keine Ortsangaben stehen."""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from geo import ORT  # noqa: E402

v = ORT
for k in sys.argv[1].split("."):
    v = v[k]
print(v)
