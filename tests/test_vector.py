"""Le portage Python est comparé au JS d'origine de l'outil ENAC (exécuté sous node), si node est installé."""
import json
import shutil
import subprocess
from pathlib import Path

import numpy as np
import pytest

from artimation.vector import Ac, analyze, density_maps, encounter, heading_space

JS_DIR = Path(__file__).resolve().parents[1] / "vendor" / "nextqcm" / "Vector — Aircraft crossing studio_files"
ORACLE = Path(__file__).resolve().parents[1] / "scripts" / "vector_oracle.js"
needs_node = pytest.mark.skipif(not (shutil.which("node") and JS_DIR.exists()), reason="node ou JS d'origine absent")

DEMO = [Ac("AC001", 20, 30, 360, 90), Ac("AC002", 50, 60, 360, 0), Ac("AC003", 90, 20, 300, 225),
        Ac("AC004", 30, 75, 240, 45), Ac("AC005", 100, 65, 300, 270)]


def oracle(aircraft, horizon, separation, density=None):
    payload = dict(aircraft=[a.__dict__ for a in aircraft], horizon=horizon, separation=separation, density=density)
    out = subprocess.run(["node", str(ORACLE), str(JS_DIR)], input=json.dumps(payload), capture_output=True, text=True, check=True)
    return json.loads(out.stdout)


def test_head_on_encounter():
    a, b = Ac("A", 0, 45, 360, 90), Ac("B", 60, 45, 360, 270)  # face à face, 60 NM, 12 NM/min de rapprochement
    e = encounter(a, b, 10, 5)
    assert e["t"] == pytest.approx(5.0) and e["distance"] < 1e-9 and e["risk"]


def test_heading_space_blocks_current_heading():
    a, b = Ac("A", 0, 45, 360, 90), Ac("B", 60, 45, 360, 270)
    hs = heading_space([a, b], "A", 10, 5)
    assert not hs["current_safe"] and hs["safe_degrees"] < 360
    assert not any(lo <= 90 < hi for lo, hi in hs["safe"])  # tout droit = conflit


@needs_node
@pytest.mark.parametrize("horizon,sep", [(10, 5), (5, 3), (15, 10), (30, 5)])
def test_physics_matches_js(horizon, sep):
    js = oracle(DEMO, horizon, sep)
    assert [(e["a"], e["b"], e["risk"]) for e in analyze(DEMO, horizon, sep)] == [(e["a"], e["b"], e["risk"]) for e in js["analyze"]]
    for e_py, e_js in zip(analyze(DEMO, horizon, sep), js["analyze"]):
        assert e_py["distance"] == pytest.approx(e_js["distance"], abs=1e-6)
    for a in DEMO:
        py, ref = heading_space(DEMO, a.id, horizon, sep), js["headingSpace"][a.id]
        assert py["safe_degrees"] == pytest.approx(ref["safeDegrees"], abs=1e-6)
        assert py["current_safe"] == ref["currentSafe"] and py["already_inside"] == ref["alreadyInside"]
        np.testing.assert_allclose(py["safe"], ref["safe"], atol=1e-6)


@needs_node
def test_density_matches_js():
    settings = dict(cols=80, rows=60, sigma=1.5)
    js = oracle(DEMO, 10, 5, density=settings)["density"]
    py = density_maps(DEMO, 10, 5, cols=80, rows=60, sigma=1.5)
    for key in ("positive", "negative", "signed"):
        ref = np.array(js[key]).reshape(60, 80)
        # le JS classe les cellules traversées par une frontière par segment, pas au centre : écarts de bord seulement
        assert np.mean(np.abs(py[key] - ref) < 1e-6) > 0.97, key
        assert np.corrcoef(py[key].ravel(), ref.ravel())[0, 1] > 0.995, key
    assert (py["signed"] < 0).any() and (py["signed"] > 0).any()
