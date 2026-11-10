"""Compare extended app JS (src/artimation/web) against (1) ORIGINAL ENAC JS without altitude and (2) the Python port with altitude."""
import json
import shutil
import subprocess
from pathlib import Path

import numpy as np
import pytest

from artimation.vector import Ac, density_maps3d, encounter3d, heading_space3d

ROOT = Path(__file__).resolve().parents[1]
ORIGINAL = ROOT / "vendor" / "nextqcm" / "Vector — Aircraft crossing studio_files"
EXTENDED = ROOT / "src" / "artimation" / "web"
ORACLE = ROOT / "scripts" / "vector_oracle.js"
pytestmark = pytest.mark.skipif(not (shutil.which("node") and ORIGINAL.exists()), reason="node ou JS d'origine absent")

DEMO = [Ac("AC001", 20, 30, 360, 90), Ac("AC002", 50, 60, 360, 0), Ac("AC003", 90, 20, 300, 225), Ac("AC004", 30, 75, 240, 45), Ac("AC005", 100, 65, 300, 270)]
STACKED = [Ac("A", 20, 30, 360, 90, z=36000), Ac("B", 50, 60, 360, 0, z=37000, vz=0), Ac("C", 90, 20, 300, 225, z=36000, vz=300),
           Ac("D", 30, 75, 240, 45, z=38000, vz=-500), Ac("E", 100, 65, 300, 270, z=36500, vz=200)]


def run(folder, aircraft, horizon, sep, sep_v=None, density=None):
    payload = dict(aircraft=[a.__dict__ for a in aircraft], horizon=horizon, separation=sep, sepV=sep_v, density=density)
    out = subprocess.run(["node", str(ORACLE), str(folder)], input=json.dumps(payload), capture_output=True, text=True, check=True)
    return json.loads(out.stdout)


@pytest.mark.parametrize("horizon,sep", [(10, 5), (5, 3), (30, 10)])
def test_extended_js_equals_original_js_without_altitude(horizon, sep):
    a, b = run(ORIGINAL, DEMO, horizon, sep), run(EXTENDED, DEMO, horizon, sep)
    assert [(e["a"], e["b"], e["risk"], round(e["distance"], 9)) for e in a["analyze"]] == [(e["a"], e["b"], e["risk"], round(e["distance"], 9)) for e in b["analyze"]]
    for k in a["headingSpace"]:
        assert a["headingSpace"][k]["safe"] == b["headingSpace"][k]["safe"] and a["headingSpace"][k]["unsafe"] == b["headingSpace"][k]["unsafe"]


def test_extended_js_density_equals_original_js_without_altitude():
    d = dict(cols=80, rows=60, sigma=1.5)
    a, b = run(ORIGINAL, DEMO, 10, 5, density=d)["density"], run(EXTENDED, DEMO, 10, 5, density=d)["density"]
    for k in ("positive", "negative", "signed"):
        np.testing.assert_array_equal(np.array(a[k]), np.array(b[k]))


def test_altitude_ignored_when_sepv_is_zero_even_with_different_levels():
    a, b = run(EXTENDED, DEMO, 10, 5), run(EXTENDED, STACKED, 10, 5, sep_v=0)
    assert [e["distance"] for e in a["analyze"]] == [e["distance"] for e in b["analyze"]]


@pytest.mark.parametrize("horizon,sep", [(10, 5), (10, 7), (20, 5)])
def test_extended_js_equals_python_with_altitude(horizon, sep):
    js = run(EXTENDED, STACKED, horizon, sep, sep_v=1000)
    for i, a in enumerate(STACKED):
        py = heading_space3d(STACKED, a.id, horizon, sep, 1000)
        ref = js["headingSpace"][a.id]
        assert py["safe_degrees"] == pytest.approx(ref["safeDegrees"], abs=0.5), a.id
        assert py["current_safe"] == ref["currentSafe"], a.id
    for e in js["analyze"]:
        a, b = next(x for x in STACKED if x.id == e["a"]), next(x for x in STACKED if x.id == e["b"])
        p = encounter3d(a, b, horizon, sep, 1000)
        assert p["risk"] == e["risk"] and p["distance"] == pytest.approx(e["distance"], abs=1e-6) and p["vertical_sep"] == pytest.approx(e["vsep"], abs=1e-6)


def test_extended_js_density_equals_python_with_altitude():
    d = dict(cols=80, rows=60, sigma=1.5)
    js = run(EXTENDED, STACKED, 10, 7, sep_v=1000, density=d)["density"]
    py = density_maps3d(STACKED, 10, 7, 1000, cols=80, rows=60)
    for k in ("positive", "negative"):
        assert np.mean(np.abs(np.array(js[k]).reshape(60, 80) - py[k]) < 1e-6) > 0.97, k
    assert (np.array(js["negative"]) > 0).any() and (np.array(js["positive"]) > 0).any()
