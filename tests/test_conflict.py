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
    # ENAC gene (scenario 2, aircraft 0): it defines the turn and return points.
    s = SCN["Scenario2"]
    xy, t = maneuver_path(s.routes[0], (50, 320, 35))
    np.testing.assert_allclose(xy[1], (218.507, -157.936), atol=0.3)  # point de virage
    np.testing.assert_allclose(xy[2], (185.160, -147.905), atol=0.3)  # end of the deviation


def test_enac_first_individual_dmin():
    # Individual 52 in ENAC GA generation 0: dmin = 8.210316.
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
    assert "left" in instructions(s, g)[0] and "unchanged" in instructions(s, g)[1]


# --- extension 3D (altitude) -------------------------------------------------------------------
from artimation.conflict import SEP_FT, SEP_NM, scenario_from_aircraft, separation_curves3d, state_at  # noqa: E402


def test_vertical_separation_removes_conflict():
    s = SCN["Scenario2"]
    same = evaluate(s, np.zeros((3, 4)))
    stacked = evaluate(s.with_levels([36000, 37000 + 500, 39000]), np.zeros((3, 4)))  # >= 1000 ft between every pair
    assert same.conflict_s > 100 and stacked.conflict_s == 0 and stacked.dmin >= SEP_NM
    # 500 ft seulement : toujours en conflit
    assert evaluate(s.with_levels([36000, 36500, 37000]), np.zeros((3, 4))).conflict_s > 0


def test_equivalent_distance_reduces_to_horizontal_when_same_level():
    s = SCN["Scenario5"]
    g3 = np.array([[40, 201, -30], [316, 338, 0], [90, 224, -40]], float)
    g4 = np.hstack([g3, np.zeros((3, 1))])
    a, b = evaluate(s, g3), evaluate(s, g4)
    np.testing.assert_allclose(a.pair_dmin, b.pair_dmin)
    assert a.fitness == b.fitness and a.dmin >= 6.9


def test_level_change_maneuver_profile_and_cost():
    s = SCN["Scenario2"]
    g = np.zeros((3, 4))
    g[1] = [0, 400, 0, 1000]  # AC002 climbs 1000 ft for 400 s: 40 s ramp at 1500 ft/min
    ev = evaluate(s, g)
    assert ev.conflict_s < evaluate(s, np.zeros((3, 4))).conflict_s and ev.n_maneuvers == 1 and ev.extra_nm == 0
    x, y, z, t = (np.asarray(v) for v in __import__("artimation.conflict", fromlist=["path_samples"]).path_samples(s.routes[1], g[1]))
    assert z.max() == pytest.approx(37000) and z[0] == pytest.approx(36000) and z[-1] == pytest.approx(36000)
    assert state_at(s.routes[1], g[1], 20)[5] == pytest.approx(1500)  # vertical rate during the ramp


def test_free_situation_head_on_with_and_without_level_gap():
    rows = [dict(id="A", x=0, y=0, heading=90, speed=480, fl=350), dict(id="B", x=100, y=0, heading=270, speed=480, fl=350)]
    s = scenario_from_aircraft(rows, 900)
    assert evaluate(s, np.zeros((2, 4))).dmin < 0.5
    rows[1]["fl"] = 360
    assert evaluate(scenario_from_aircraft(rows, 900), np.zeros((2, 4))).dmin == pytest.approx(7.0, abs=0.01)  # 1000 ft = exactly the separation threshold
    rows[1]["fl"] = 370
    assert evaluate(scenario_from_aircraft(rows, 900), np.zeros((2, 4))).conflict_s == 0
    t, dh, dv = separation_curves3d(scenario_from_aircraft(rows, 900), np.zeros((2, 4)))[(0, 1)]
    assert dv.min() == pytest.approx(2000) and dh.min() < 1


def test_ga_uses_level_change_when_allowed_and_resolves_all():
    from artimation.ga import GAConfig
    for name in ("Scenario2", "Scenario4", "Scenario10"):
        s = SCN[name]
        r = run_ga(s, GAConfig(pop=60, generations=60, seed=2, vertical=True))
        ev = evaluate(s, r.best_genes)
        assert r.genes.shape[2] == 4 and ev.conflict_s == 0 and ev.dmin >= SEP_NM, name


def test_heat_grid_is_bounded_for_huge_scenarios():
    from artimation.conflict import MAX_HEAT_CELLS, heat_layers
    rows = [dict(id="A", x=-1000, y=-1000, heading=45, speed=700, fl=350), dict(id="B", x=1000, y=1000, heading=225, speed=700, fl=350)]
    s = scenario_from_aircraft(rows, 900)
    g = np.zeros((1, 2, 4))
    h = heat_layers(s, g, evaluate(s, g[0]).pair_dmin[None])
    assert h["safe"].shape[1] * h["safe"].shape[2] <= MAX_HEAT_CELLS * 1.1
