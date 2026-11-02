"""model.js / ga.js (navigateur) == conflict.py (Python, validé contre les données de l'ENAC), sur des manœuvres aléatoires."""
import json
import shutil
import subprocess
from pathlib import Path

import numpy as np
import pytest

from artimation.conflict import evaluate, list_scenarios
from artimation.webapp import to_vector_frame

ORACLE = Path(__file__).resolve().parents[1] / "scripts" / "model_oracle.js"
pytestmark = pytest.mark.skipif(not shutil.which("node"), reason="node absent")
SCN = {s.name: s for s in list_scenarios()}


def node(payload):
    out = subprocess.run(["node", str(ORACLE)], input=json.dumps(payload), capture_output=True, text=True, check=True)
    return json.loads(out.stdout)


def random_genes(rng, scn, n):
    out = []
    for _ in range(n):
        g = []
        for r in scn.routes:
            if rng.random() < 0.3:
                g.append([0.0, 0.0, 0.0, 0.0]); continue
            t1 = rng.uniform(0, r.t[-1] * 0.9)
            g.append([t1, t1 + rng.uniform(15, 400), float(rng.choice([-35, -20, -5, 0, 5, 15, 30])), float(rng.choice([-2000, -1000, 0, 0, 1000, 2000]))])
        out.append(g)
    return out


@pytest.mark.parametrize("name", ["Scenario2", "Scenario5", "Scenario9", "Scenario1"])
def test_js_evaluate_equals_python(name):
    scn = SCN[name].with_levels([36000, 36500, 37000][: SCN[name].n], [0, 300, -200][: SCN[name].n])  # altitudes et taux verticaux variés
    genes = random_genes(np.random.default_rng(7), scn, 80)
    js = node(dict(routes=to_vector_frame(scn), genes=genes, opts=dict(sep=7, sepV=1000)))["evals"]
    for g, e in zip(genes, js):
        py = evaluate(scn, np.array(g), 7.0, 1000.0)
        np.testing.assert_allclose(np.where(np.isfinite(py.pair_dmin), py.pair_dmin, -1), np.array([[-1 if v is None else v for v in row] for row in e["pair"]]), atol=1e-6)
        assert e["conflict"] == pytest.approx(py.conflict_s, abs=1e-6) and e["extra"] == pytest.approx(py.extra_nm, abs=1e-6)
        assert e["nMan"] == py.n_maneuvers and e["fitness"] == pytest.approx(py.fitness, abs=1e-9)


def test_js_evaluate_2d_equals_python_without_altitude_and_with_sepv_off():
    scn = SCN["Scenario5"]
    genes = random_genes(np.random.default_rng(3), scn, 50)
    for sep_v in (0, 1000):
        js = node(dict(routes=to_vector_frame(scn), genes=genes, opts=dict(sep=7, sepV=sep_v)))["evals"]
        for g, e in zip(genes, js):
            py = evaluate(scn, np.array(g), 7.0, float(sep_v))
            assert e["fitness"] == pytest.approx(py.fitness, abs=1e-9) and e["conflict"] == pytest.approx(py.conflict_s, abs=1e-6)


@pytest.mark.parametrize("vertical", [False, True])
def test_js_ga_resolves_every_scenario(vertical):
    for name, scn in SCN.items():
        g = node(dict(routes=to_vector_frame(scn), ga=dict(pop=60, generations=60, seed=1, vertical=vertical, window=600)))["ga"]
        assert g["conflict"] == 0 and g["dmin"] >= 7.0 - 1e-9, (name, g)
        # la meilleure solution trouvée par le JS est aussi sans conflit pour le Python
        py = evaluate(scn, np.array(g["best"]), 7.0, 1000.0)
        assert py.conflict_s == 0 and py.dmin >= 7.0 - 1e-6, name
