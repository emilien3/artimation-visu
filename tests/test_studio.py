import re
import shutil
import subprocess
import tempfile
from pathlib import Path

import pytest

from artimation.conflict import list_scenarios
from artimation.studio import aircraft_at, build_html
from artimation.vector import analyze, density_maps

SCN = {s.name: s for s in list_scenarios()}


def test_scenario_bridge_speed_heading_and_conflict():
    s = SCN["Scenario2"]
    ac = aircraft_at(s, 0)
    assert len(ac) == 3 and all(300 < a.speed < 700 for a in ac)  # vitesses d'avions de ligne
    # sans manœuvre, ces trois avions sont en conflit à 7 NM dans les 10 min, comme dans l'évaluateur du GA
    assert any(e["risk"] for e in analyze(ac, 10, 7))
    assert aircraft_at(s, 10_000) == []  # tous arrivés


def test_build_html_is_self_contained_and_valid_js():
    html = build_html(aircraft_at(SCN["Scenario2"], 0), 7)
    assert not re.search(r'<script src=|<link rel="stylesheet"', html)
    assert "window.VectorStudio" in html and "__VECTOR_INIT" in html and 'value="7"' in html
    if shutil.which("node"):
        for i, js in enumerate(re.findall(r"<script>(.*?)</script>", html, re.S)):
            with tempfile.NamedTemporaryFile("w", suffix=".js", delete=False) as f:
                f.write(js)
            r = subprocess.run(["node", "--check", f.name], capture_output=True, text=True)
            Path(f.name).unlink()
            assert r.returncode == 0, (i, r.stderr[:300])
