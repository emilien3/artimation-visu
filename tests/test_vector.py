"""Compare the Python port against the original ENAC tool JS (executed under Node), when Node is installed."""
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
    a, b = Ac("A", 0, 45, 360, 90), Ac("B", 60, 45, 360, 270)  # head-on, 60 NM apart, closing at 12 NM/min
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
        # the JS classifies boundary cells by segment rather than center: edge differences only
        assert np.mean(np.abs(py[key] - ref) < 1e-6) > 0.97, key
        assert np.corrcoef(py[key].ravel(), ref.ravel())[0, 1] > 0.995, key
    assert (py["signed"] < 0).any() and (py["signed"] > 0).any()


# --- extension 3D ------------------------------------------------------------------------------------------------------
from artimation.vector import analyze3d, density_maps3d, encounter3d, heading_space3d  # noqa: E402


def test_3d_reduces_to_2d_at_same_level():
    py2, py3 = density_maps(DEMO, 10, 5, cols=80, rows=60), density_maps3d(DEMO, 10, 5, 1000, cols=80, rows=60)
    for key in ("positive", "negative"):
        assert np.mean(np.abs(py2[key] - py3[key]) < 1e-6) > 0.995, key
    for a in DEMO:
        h2, h3 = heading_space(DEMO, a.id, 10, 5), heading_space3d(DEMO, a.id, 10, 5, 1000)
        assert h3["safe_degrees"] == pytest.approx(h2["safe_degrees"], abs=0.3)
        assert h3["current_safe"] == h2["current_safe"]


def test_3d_vertical_separation_removes_conflict_and_window_logic():
    a, b = Ac("A", 0, 45, 360, 90, z=36000), Ac("B", 60, 45, 360, 270, z=36000)
    assert encounter3d(a, b, 10, 5, 1000)["risk"]
    b2 = Ac("B", 60, 45, 360, 270, z=38000)  # 2000 ft plus haut : plus de conflit
    e = encounter3d(a, b2, 10, 5, 1000)
    assert not e["risk"] and e["separated_vertically"] and heading_space3d([a, b2], "A", 10, 5, 1000)["safe_degrees"] == pytest.approx(360)
    # B descends toward A's level at 400 ft/min: 2000 ft difference -> < 1000 ft from t = 2.5 to 7.5 min; closest approach at t = 5 min
    b3 = Ac("B", 60, 45, 360, 270, z=38000, vz=-400)
    assert not encounter3d(a, b3, 4, 5, 1000)["risk"]  # at t = 4 min they are still 12 NM apart
    assert encounter3d(a, b3, 10, 5, 1000)["risk"]  # closest approach (t = 5 min) lies within the vertical window


def test_3d_analysis_flags_vertically_separated_crossings():
    a, b = Ac("A", 0, 45, 360, 90, z=36000), Ac("B", 30, 75, 360, 0, z=38000)  # arrive together at (30, 45), 2000 ft apart vertically
    res = analyze3d([a, b], 10, 5, 1000)
    assert res and not res[0]["risk"] and res[0]["separated_vertically"] and res[0]["vertical_sep"] == pytest.approx(2000)
    assert analyze3d([a, Ac("B", 30, 75, 360, 0, z=36000)], 10, 5, 1000)[0]["risk"]
