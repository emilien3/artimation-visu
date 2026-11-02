import numpy as np
import pytest

from artimation.conflict import evaluate, instructions, list_scenarios, maneuver_path, separation_curves
from artimation.ga import GAConfig, run_ga

SCN = {s.name: s for s in list_scenarios()}


def test_ten_scenarios_loaded():
    assert len(SCN) == 10 and all(s.n in (2, 3) for s in SCN.values())


def test_unchanged_routes_conflict():
    s = SCN["Scenario2"]
    ev = evaluate(s, np.zeros((s.n, 3)))
    assert ev.dmin < 7.0 and ev.conflict_s > 100 and ev.n_maneuvers == 0 and ev.extra_nm == 0


def test_maneuver_geometry_matches_enac_data():
    # Gène de l'ENAC (scénario 2, avion 0) : ils donnent le point de virage et le point de retour.
    s = SCN["Scenario2"]
    xy, t = maneuver_path(s.routes[0], (50, 320, 35))
    np.testing.assert_allclose(xy[1], (218.507, -157.936), atol=0.3)  # point de virage
    np.testing.assert_allclose(xy[2], (185.160, -147.905), atol=0.3)  # fin de la déviation


def test_enac_first_individual_dmin():
    # Individu 52 de la génération 0 du GA ENAC : dmin = 8.210316.
    s = SCN["Scenario2"]
    genes = np.array([[50, 320, 35], [317, 366, 20], [318, 366, 5]], float)
    assert evaluate(s, genes).dmin == pytest.approx(8.21, abs=0.3)


def test_ga_resolves_every_conflict():
    for s in SCN.values():
        r = run_ga(s, GAConfig(pop=60, generations=60, seed=1))
        ev = evaluate(s, r.best_genes)
        assert ev.conflict_s == 0 and ev.dmin >= 7.0, s.name


def test_separation_curves_and_instructions():
    s = SCN["Scenario2"]
    g = np.array([[50, 320, 35], [0, 0, 0], [0, 0, 0]], float)
    curves = separation_curves(s, g)
    assert set(curves) == {(0, 1), (0, 2), (1, 2)}
    assert min(d.min() for _, d in curves.values()) == pytest.approx(evaluate(s, g).dmin, abs=0.3)
    assert "gauche" in instructions(s, g)[0] and "inchangée" in instructions(s, g)[1]
