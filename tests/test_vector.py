"""Tests of the Python port of the Vector physics."""
import numpy as np
import pytest

from artimation.vector import Ac, analyze, density_maps, encounter, heading_space

DEMO = [Ac("AC001", 20, 30, 360, 90), Ac("AC002", 50, 60, 360, 0), Ac("AC003", 90, 20, 300, 225),
        Ac("AC004", 30, 75, 240, 45), Ac("AC005", 100, 65, 300, 270)]


def test_head_on_encounter():
    a, b = Ac("A", 0, 45, 360, 90), Ac("B", 60, 45, 360, 270)  # head-on, 60 NM apart, closing at 12 NM/min
    e = encounter(a, b, 10, 5)
    assert e["t"] == pytest.approx(5.0) and e["distance"] < 1e-9 and e["risk"]


def test_heading_space_blocks_current_heading():
    a, b = Ac("A", 0, 45, 360, 90), Ac("B", 60, 45, 360, 270)
    hs = heading_space([a, b], "A", 10, 5)
    assert not hs["current_safe"] and hs["safe_degrees"] < 360
    assert not any(lo <= 90 < hi for lo, hi in hs["safe"])  # tout droit = conflit


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
