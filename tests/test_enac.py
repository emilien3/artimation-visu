"""Regression fixtures from ENAC, independent of the optional 49 MB download."""
import json
from pathlib import Path
import shutil
import subprocess

import numpy as np
import pandas as pd
import pytest

from artimation.conflict import Scenario, evaluate, instructions, list_scenarios, maneuver_path, path_samples, state_at
from artimation.webapp import scenarios_payload, to_vector_frame
from artimation.zenodo import parse_trajectory

FIXTURE = json.loads((Path(__file__).parent / 'fixtures/enac-candidates.json').read_text())
SCENARIOS = list_scenarios(enac=True)
ORACLE = Path(__file__).resolve().parents[1] / 'scripts/model_oracle.js'


@pytest.mark.parametrize('k', range(1, 11))
def test_reconstruction_matches_exported_geometry_and_distance(k):
    scn = SCENARIOS[k - 1]
    for record in FIXTURE['records']:
        if record['scenario'] != k:
            continue
        rows = record['rows']
        genes = [[r['t1'], r['t2'], r['alpha']] for r in rows]
        for route, gene, row in zip(scn.routes, genes, rows):
            xy, t = maneuver_path(route, gene)
            np.testing.assert_allclose(xy, parse_trajectory(row['traj']), atol=2e-6, rtol=0)
            speeds = np.linalg.norm(np.diff(xy, axis=0), axis=1) / np.diff(t)
            np.testing.assert_allclose(speeds, np.linalg.norm(route.xy[1] - route.xy[0]) / (route.t[1] - route.t[0]), atol=1e-12)
        assert evaluate(scn, genes).dmin == pytest.approx(rows[0]['dmin'], abs=3e-6)


@pytest.mark.skipif(not shutil.which('node'), reason='Node.js is unavailable')
def test_browser_matches_reconstructed_python_paths_and_evaluation():
    for k, scn in enumerate(SCENARIOS, 1):
        records = [r for r in FIXTURE['records'] if r['scenario'] == k]
        genes = [[[r['t1'], r['t2'], r['alpha'], 0] for r in record['rows']] for record in records]
        # Exercise the local altitude extension as well as the horizontal reference.
        genes += [[[t1, t2, a, (i - 1) * 1000] for i, (t1, t2, a, _) in enumerate(g)] for g in genes[:2]]
        genes.append([[r.command_start, r.command_start + 100, 25, 1000] for r in scn.routes])
        output = subprocess.run(['node', str(ORACLE)], input=json.dumps(dict(routes=to_vector_frame(scn), genes=genes, paths=True)),
                                capture_output=True, text=True, check=True)
        js = json.loads(output.stdout)
        frame = to_vector_frame(scn)
        for g, actual, paths in zip(genes, js['evals'], js['paths']):
            py = evaluate(scn, g)
            assert actual['dmin'] == pytest.approx(py.dmin, abs=1e-8)
            assert actual['conflict'] == pytest.approx(py.conflict_s, abs=1e-7)
            assert actual['extra'] == pytest.approx(py.extra_nm, abs=1e-8)
            assert actual['nMan'] == py.n_maneuvers
            for route, gene, path, framed in zip(scn.routes, g, paths, frame):
                xy, t = maneuver_path(route, gene)
                np.testing.assert_allclose(path['t'], t, atol=1e-9)
                # Derive the translation from a known original waypoint.
                np.testing.assert_allclose(path['x'], xy[:, 0] + framed['xy'][0][0] - route.xy[0, 0], atol=1e-9)
                np.testing.assert_allclose(path['y'], -xy[:, 1] + framed['xy'][0][1] + route.xy[0, 1], atol=1e-9)


def test_enac_metadata_survives_serialization_levels_and_web_payload():
    scn = SCENARIOS[1]
    copy = Scenario.from_dict(scn.with_levels([36000, 37000, 38000]).to_dict())
    assert evaluate(copy, np.zeros((3, 3))).conflict_s == 0
    for before, after in zip(scn.routes, copy.routes):
        np.testing.assert_array_equal(before.enac_start, after.enac_start)
    assert all(r['enacStart'] is not None for s in scenarios_payload() for r in s['routes'])
    assert all(r.enac_start is None for s in list_scenarios() for r in s.routes)


def test_pruned_genes_do_not_report_nonexistent_turns_or_added_distance():
    scn = SCENARIOS[1]
    genes = [[211, 355, 5], [265, 339, -5], [320, 366, -5]]
    assert all(len(maneuver_path(r, g)[0]) == 2 for r, g in zip(scn.routes, genes))
    ev = evaluate(scn, genes)
    assert ev.extra_nm == pytest.approx(0) and ev.n_maneuvers == 0
    assert all('fly directly' in line and 'turn at' not in line for line in instructions(scn, genes))


def test_search_angles_cover_the_exported_range():
    from artimation.ga import ALPHAS
    assert set(ALPHAS) == set(range(-40, 41, 5))


def test_snapshot_clock_does_not_create_past_turns_or_preflight_samples():
    from artimation.ga import _random_gene, _mutate
    route = SCENARIOS[5].routes[0]
    past = [0, 100, 25, 1000]
    assert len(maneuver_path(route, past)[0]) == 2
    assert state_at(route, past, 20)[2] == 36000
    start = route.command_start
    gene = [start, start + 100, 25, 1000]
    xy, t = maneuver_path(route, gene)
    assert (np.diff(t) > 0).all() and t[0] == 0
    assert path_samples(route, gene)[-1][0] == 0
    assert state_at(route, gene, 20)[2] == pytest.approx(36500)
    rng = np.random.default_rng(42)
    for _ in range(50):
        g = _random_gene(rng, route, vertical=True)
        g = _mutate(rng, g, route, vertical=True)
        assert not (g[2] or g[3]) or g[0] >= start


def test_export_counters_include_best_writes_without_changing_fitness(monkeypatch):
    monkeypatch.syspath_prepend(str(ORACLE.parent))
    from audit_enac import export_counts
    fixture = json.loads((Path(__file__).parent / 'fixtures/enac-counter-traces.json').read_text())
    for trace in fixture['traces']:
        candidates = pd.DataFrame(trace['candidates'])
        best = pd.DataFrame(trace['best'], columns=candidates.columns)
        cc, bc = export_counts(candidates, best)
        first = candidates.groupby(['id', 'i']).conflits.first()
        for frame, counts in [(candidates, cc), (best, bc)]:
            if frame.empty:
                continue
            initial = np.array([first.loc[(r.id, r.i)] for r in frame.itertuples()])
            np.testing.assert_allclose(frame.conflits, initial * counts, rtol=0, atol=3e-6)
        assert (pd.concat([candidates, best]).groupby('id').fitness.nunique() == 1).all()
    # In scenario 10, population writes have counters 1 then 3; the best write is 2.
    np.testing.assert_array_equal(cc, [1, 1, 1, 3, 3, 3])
    np.testing.assert_array_equal(bc, [2, 2, 2])


@pytest.mark.parametrize('value', ['[]', '[(0;0)]', '[(0;0)(nan;1)]', '[(0;0)(0;0)]', '[(0;0)garbage(1;1)]'])
def test_trajectory_parser_rejects_invalid_content(value):
    with pytest.raises(ValueError):
        parse_trajectory(value)
