"""Edge cases independent of ENAC scenarios and the Python/JS port."""
import numpy as np
import pytest

from artimation.conflict import Route, Scenario, evaluate, heat_layers, instructions
from artimation.ga import GAConfig, _mutate, _random_gene, run_ga


def route(xy, t=(0., 1000.)):
    return Route(np.array(xy, float), np.array(t, float))


def test_safe_solution_always_beats_a_short_conflict():
    scn = Scenario('grazing', [route([[0, 0], [100, 0]]), route([[100, 6.999999], [0, 6.999999]])])
    unsafe = evaluate(scn, np.zeros((2, 4)))
    safe = evaluate(scn, [[0, 300, -35, 0], [0, 0, 0, 0]])
    assert 0 < unsafe.conflict_s < .04 and safe.conflict_s == 0
    assert unsafe.fitness < .5 < safe.fitness


def test_shifted_short_route_keeps_maneuvers_in_flight():
    r = route([[0, 0], [10, 0]], (100., 105.))
    rng = np.random.default_rng(0)
    for _ in range(50):
        g = _random_gene(rng, r)
        assert 100 <= g[0] < 105
        assert 100 <= _mutate(rng, g, r)[0] < 105


def test_one_aircraft_and_heatmap_preserve_distance():
    scn = Scenario('one', [route([[0, 0], [10.2, 0]])])
    genes = np.zeros((1, 1, 4))
    ev = evaluate(scn, genes[0])
    assert ev.dmin == np.inf and ev.fitness == 1
    heat = heat_layers(scn, genes, ev.pair_dmin[None], cell=5, step=.5)
    assert heat['safe'].sum() == pytest.approx(10.2)
    assert heat['unsafe'].sum() == 0


def test_vertical_instruction_waits_until_level_is_reached():
    scn = Scenario('one', [route([[0, 0], [100, 0]])])
    assert 'start returning to the original route altitude at t+40 s' in instructions(scn, [[0, 10, 0, 1000]])[0]


def test_ga_includes_unchanged_routes_and_reuses_duplicate_evaluations(monkeypatch):
    import artimation.ga as ga

    scn = Scenario('safe', [route([[0, 0], [100, 0]]), route([[0, 20], [100, 20]])])
    calls = []
    def counted(*args):
        calls.append(1)
        return evaluate(*args)
    monkeypatch.setattr(ga, 'evaluate', counted)
    cfg = GAConfig(pop=10, generations=5, p_cross=0, p_mut=0, immigrants=0)
    result = run_ga(scn, cfg)
    assert evaluate(scn, result.best_genes).fitness == 1
    assert result.origin[0] == 'B'
    assert len(result.genes) == 50  # offspring remain visible in the heatmap
    assert len(calls) <= 10


@pytest.mark.parametrize('genes', [[[0, 0]], [[0, 0, float('nan')]], []])
def test_evaluation_rejects_invalid_genes(genes):
    with pytest.raises(ValueError, match='gene'):
        evaluate(Scenario('one', [route([[0, 0], [10, 0]])]), genes)


@pytest.mark.parametrize('options', [dict(pop=0), dict(pop=1), dict(generations=-1), dict(pop=2.5), dict(tournament=0), dict(p_mut=2)])
def test_ga_rejects_invalid_configuration(options):
    with pytest.raises(ValueError):
        run_ga(Scenario('one', [route([[0, 0], [10, 0]])]), GAConfig(**options))


@pytest.mark.parametrize('value', [0, 1e300])
def test_weights_cannot_remove_safety_priority(value):
    from artimation.conflict import DEFAULT_WEIGHTS
    weights = dict.fromkeys(DEFAULT_WEIGHTS, value)
    scn = Scenario('grazing', [route([[0, 0], [100, 0]]), route([[100, 6.999999], [0, 6.999999]])])
    assert evaluate(scn, np.zeros((2, 4)), weights=weights).fitness < .5
    assert evaluate(scn, [[0, 300, -35, 0], [0, 0, 0, 0]], weights=weights).fitness > .5


@pytest.mark.parametrize('weights', [{'length': -1}, {'altitude': float('inf')}, {'conflict': float('nan')}, {'typo': 1}])
def test_invalid_weights_are_rejected(weights):
    with pytest.raises(ValueError, match='weights'):
        evaluate(Scenario('one', [route([[0, 0], [100, 0]])]), [[0, 0, 0, 0]], weights=weights)


def test_weights_change_ranking_and_reach_ga():
    scn = Scenario('one', [route([[0, 0], [100, 0]])])
    horizontal, vertical = [[0, 300, 35, 0]], [[0, 300, 0, 1000]]
    for weights, horizontal_wins in [({'length': 10, 'altitude': 0}, False), ({'length': 0, 'altitude': 10}, True)]:
        assert (evaluate(scn, horizontal, weights=weights).fitness > evaluate(scn, vertical, weights=weights).fitness) == horizontal_wins
        result = run_ga(scn, GAConfig(pop=10, generations=2, vertical=True, weights=weights))
        for genes, score in zip(result.genes, result.fitness):
            assert score == evaluate(scn, genes, weights=weights).fitness
