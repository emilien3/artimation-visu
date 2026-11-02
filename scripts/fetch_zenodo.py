"""Télécharge les solutions du GA original (49 Mo) dans data/zenodo/ : `python scripts/fetch_zenodo.py`."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))
from artimation.zenodo import fetch  # noqa: E402

print("Extrait dans", fetch())
