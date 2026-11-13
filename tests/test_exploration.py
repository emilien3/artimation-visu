"""Trace integrity and independent Python validation of the new toy datasets."""
import csv
import io
import json
import shutil
import subprocess
from pathlib import Path

import numpy as np
import pytest

from artimation.conflict import Route, Scenario, evaluate, path_samples

ROOT = Path(__file__).resolve().parents[1]
pytestmark = pytest.mark.skipif(not shutil.which("node"), reason="node absent")


def test_kwa_model_invariants():
    subprocess.run(["node", str(Path(__file__).with_name("kwa_invariants.cjs"))], check=True)


def test_exploration_and_annealing_invariants():
    subprocess.run(["node", str(Path(__file__).with_name("exploration_invariants.cjs"))], check=True)


@pytest.mark.parametrize("algorithm", ["genetic", "simulated-annealing"])
def test_exported_paths_and_csv_match_python(algorithm):
    code = """
const E=require('./src/artimation/web/exploration.js');
const solver=require(process.argv[1]==='genetic'?'./src/artimation/web/ga.js':'./src/artimation/web/annealing.js');
const scn=E.scenario('convergence-4');
const data=E.dataset(scn,solver.runSync(scn.routes,{pop:12,generations:3,iterations:40,vertical:true,seed:3}));
process.stdout.write(JSON.stringify({data,safe:E.csv(data,'safe'),unsafe:E.csv(data,'unsafe')}));
"""
    payload = json.loads(subprocess.run(["node", "-e", code, algorithm], cwd=ROOT, check=True, capture_output=True, text=True).stdout)
    data = payload["data"]
    # Browser coordinates point south; the independent Python model points north.
    scn = Scenario(data["scenario_id"], [Route(np.array(r["xy_nm"]) * [1, -1], np.array(r["t_s"]), np.array(r["z_ft"])) for r in data["routes"]])
    for candidate in data["candidates"]:
        genes = [tr["gene"] for tr in candidate["trajectories"]]
        ev = evaluate(scn, genes)
        assert candidate["fitness"] == pytest.approx(ev.fitness)
        assert candidate["conflict_s"] == pytest.approx(ev.conflict_s, abs=1e-6)
        assert candidate["min_equivalent_separation_nm"] == pytest.approx(ev.dmin, abs=1e-6)
        assert candidate["label"] == ("safe" if ev.conflict_s == 0 and ev.dmin >= 7 else "unsafe")
        for r, tr in zip(scn.routes, candidate["trajectories"]):
            x, y, z, t = path_samples(r, tr["gene"])
            np.testing.assert_allclose([[p["t_s"], p["x_nm"], p["y_nm"], p["z_ft"]] for p in tr["knots"]], np.column_stack([t, x, -y, z]), atol=1e-7)
    for label in ("safe", "unsafe"):
        rows = list(csv.DictReader(io.StringIO(payload[label])))
        expected = sum(len(tr["knots"]) for c in data["candidates"] for tr in c["trajectories"] if tr["label"] == label)
        assert len(rows) == expected
        assert all(None not in row and row["trajectory_label"] == label for row in rows)
        assert all(data["candidates"][int(row["candidate_id"])]["label"] == row["joint_label"] for row in rows)
