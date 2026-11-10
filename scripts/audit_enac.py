"""Explain ENAC distance disagreements, with ordered trajectory-model ablations.

Run: .venv/bin/python scripts/audit_enac.py > docs/output/artifacts/enac-audit.json
Requires the optional, checksum-verified Zenodo archive and Node.js.
No downloads or changes to the source CSV files are performed.
"""
import hashlib
import json
from pathlib import Path
import sys

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'src'))
from artimation.conflict import list_scenarios
from artimation.webapp import to_vector_frame
from artimation import zenodo
from audit_solver import node


def stats(values, reference):
    error = np.abs(values - reference)
    return dict(median_error_nm=float(np.median(error)), p95_error_nm=float(np.quantile(error, .95)),
                max_error_nm=float(error.max()),
                disagreements=int(np.count_nonzero((values >= 7) != (reference >= 7))),
                local_unsafe_reference_safe=int(np.count_nonzero((values < 7) & (reference >= 7))),
                local_safe_reference_unsafe=int(np.count_nonzero((values >= 7) & (reference < 7))))


def path(xy, speed):
    return dict(x=xy[:, 0].tolist(), y=xy[:, 1].tolist(),
                t=np.r_[0, np.cumsum(np.linalg.norm(np.diff(xy, axis=0), axis=1) / speed)].tolist(),
                tz=[0], z=[36000])


def export_counts(candidates, best):
    """Count writes per (ID, aircraft): population first, then best, each generation.

    Preserve duplicate IDs within a generation: they are additional writes too.
    Returned arrays follow the input row order. This explains counters, not fitness.
    """
    c_counts = candidates.groupby(['id', 'i'], sort=False).cumcount().to_numpy() + 1
    b_counts = best.groupby(['id', 'i'], sort=False).cumcount().to_numpy() + 1
    c_gens = {key: np.sort(g.generation.to_numpy()) for key, g in candidates.groupby(['id', 'i'])}
    b_gens = {key: np.sort(g.generation.to_numpy()) for key, g in best.groupby(['id', 'i'])}
    for j, row in enumerate(candidates.itertuples()):
        c_counts[j] += np.searchsorted(b_gens.get((row.id, row.i), []), row.generation, side='left')
    for j, row in enumerate(best.itertuples()):
        b_counts[j] += np.searchsorted(c_gens.get((row.id, row.i), []), row.generation, side='right')
    return c_counts, b_counts


def audit(k, raw, scn):
    file = zenodo.ZEN_DIR / f'sols{k}-1.csv'
    df = pd.read_csv(file)
    best_file = zenodo.ZEN_DIR / f'sol{k}-1.csv'
    best = pd.read_csv(best_file)
    n = scn.n
    assert len(df) % n == 0
    assert np.array_equal(df.i.to_numpy().reshape(-1, n), np.tile(np.arange(n), (len(df) // n, 1)))
    for column in ['id', 'generation', 'dmin', 'fitness']:
        values = df[column].to_numpy().reshape(-1, n)
        assert np.all(values == values[:, :1]), (file, column)
    genes = df[['t1', 't2', 'alpha']].to_numpy(float).reshape(-1, n, 3).tolist()
    reference = df.dmin.to_numpy()[::n]
    generic = node(dict(routes=to_vector_frame(raw), genes=genes))
    constant_routes = to_vector_frame(scn)
    for r in constant_routes:
        r['enacStart'] = None
    constant = node(dict(routes=constant_routes, genes=genes, paths=True))
    reconstructed = node(dict(routes=to_vector_frame(scn), genes=genes, paths=True))
    snapshot_paths = constant.pop('paths')
    starts = [r['enacStart'] for r in to_vector_frame(scn)]
    speeds = [float(np.linalg.norm(r.xy[1] - r.xy[0]) / (r.t[1] - r.t[0])) for r in scn.routes]
    for group in snapshot_paths:
        for i, p in enumerate(group):
            xy = np.column_stack([p['x'], p['y']]); xy[0] = starts[i]
            p.update(path(xy, speeds[i]))
    snapshot = node(dict(pathGroups=snapshot_paths))['replay']
    expected_xy = [zenodo.parse_trajectory(t) for t in df.traj]
    exported_paths = [[path(expected_xy[j + i], speeds[i]) for i in range(n)] for j in range(0, len(df), n)]
    replay = node(dict(pathGroups=exported_paths))['replay']
    # Compare complete reconstructed geometry, not only the scalar minimum distance.
    points = np.vstack([r.xy for r in scn.routes]); cx, cy = (points.min(0) + points.max(0)) / 2
    shape_mismatches = 0; max_geometry_error = 0.0
    for p, xy in zip((p for group in reconstructed.pop('paths') for p in group), expected_xy):
        actual = np.column_stack([np.array(p['x']) + cx - 60, -(np.array(p['y']) - 45) + cy])
        if actual.shape != xy.shape:
            shape_mismatches += 1
        else:
            max_geometry_error = max(max_geometry_error, float(np.linalg.norm(actual - xy, axis=1).max()))
    durations = np.array([r['perAircraftConflict'] for r in replay]).ravel()
    duration_error = np.abs(durations - df.conflits.to_numpy())
    bad_durations = duration_error > .001
    # Best-candidate writes also increment the counters carried into later populations.
    occurrences, best_occurrences = export_counts(df, best)
    normalized_error = np.abs(df.conflits.to_numpy() / occurrences - durations)
    first = df.groupby(['id', 'i'], sort=False).conflits.first()
    candidate_base = np.array([first.loc[(r.id, r.i)] for r in df.itertuples()])
    best_base = np.array([first.loc[(r.id, r.i)] for r in best.itertuples()])
    counter_error = np.abs(df.conflits.to_numpy() - candidate_base * occurrences)
    best_counter_error = np.abs(best.conflits.to_numpy() - best_base * best_occurrences)
    # A single CSV value is rounded to 1e-6 seconds; multiplying it multiplies that uncertainty.
    assert np.all(counter_error <= (occurrences + 1) * .5001e-6)
    assert np.all(best_counter_error <= (best_occurrences + 1) * .5001e-6)
    joint = df.iloc[::n].copy()
    joint['genes'] = [tuple(g) for g in np.array(genes).reshape(-1, n * 3)]
    joint['trajectory'] = [tuple(g) for g in df.traj.to_numpy().reshape(-1, n)]
    joint['counter'] = df.conflits.to_numpy().reshape(-1, n).sum(axis=1)
    ids = joint.groupby('id').agg(occurrences=('id', 'size'), fitness_values=('fitness', 'nunique'),
                                 gene_values=('genes', 'nunique'), trajectory_values=('trajectory', 'nunique'),
                                 counter_values=('counter', 'nunique'))
    all_fitness = pd.concat([df[['id', 'fitness']], best[['id', 'fitness']]]).groupby('id').fitness.nunique()
    # The safe score's inferred formula is checked separately; it is not used by the local GA.
    command_count = np.count_nonzero(np.array(genes)[:, :, 2], axis=1)
    offset = sum(float(np.linalg.norm(r.enac_start - r.xy[0]) / v) for r, v in zip(scn.routes, speeds))
    flight_time = np.array([sum(p['t'][-1] for p in group) for group in exported_paths]) + offset
    safe = reference >= 7
    safe_score = .5 + 1 / (4 + command_count) + 1 / (4 + flight_time)
    safe_score_error = np.abs(safe_score[safe] - joint.fitness.to_numpy()[safe])
    worst = int(np.argmax(duration_error))
    counts = pd.Series([len(xy) for xy in expected_xy]).value_counts()
    result = dict(scenario=k, candidates=len(reference), sha256=hashlib.sha256(file.read_bytes()).hexdigest(),
                  best_sha256=hashlib.sha256(best_file.read_bytes()).hexdigest(), best_candidates=len(best) // n,
                  geometry_shape_mismatches=shape_mismatches, max_geometry_error_nm=max_geometry_error,
                  point_counts={str(a): int(b) for a, b in counts.items()},
                  snapshot_offset_s=[float(np.linalg.norm(r.enac_start-r.xy[0]) / speed) for r, speed in zip(scn.routes, speeds)],
                  stages={label: stats(np.array([v['dmin'] for v in values]), reference) for label, values in [
                      ('previous_model', generic['evals']), ('constant_speed', constant['evals']),
                      ('snapshot_without_pruning', snapshot), ('reconstructed', reconstructed['evals']), ('export_replay', replay)]},
                  conflict_duration=dict(rows_over_1ms=int(bad_durations.sum()), max_error_s=float(duration_error.max()),
                    normalized_rows_over_1ms=int(np.count_nonzero(normalized_error > .001)),
                    normalized_max_error_s=float(normalized_error.max()),
                    population_counter_max_error_s=float(counter_error.max()),
                    best_counter_max_error_s=float(best_counter_error.max()),
                    max_occurrences=int(occurrences.max()),
                    example=dict(generation=int(df.iloc[worst].generation), id=int(df.iloc[worst].id), aircraft=int(df.iloc[worst].i),
                                 exported_s=float(df.iloc[worst].conflits), replay_s=float(durations[worst]))),
                  fitness=dict(repeated_ids=int((ids.occurrences > 1).sum()),
                    ids_with_changing_counters=int((ids.counter_values > 1).sum()),
                    ids_with_changing_genes=int((ids.gene_values > 1).sum()),
                    ids_with_changing_trajectories=int((ids.trajectory_values > 1).sum()),
                    ids_with_changing_fitness_in_either_file=int((all_fitness > 1).sum()),
                    genotypes_with_changing_fitness=int((joint.groupby('genes').fitness.nunique() > 1).sum()),
                    fitness_safety_disagreements=int(np.count_nonzero((joint.fitness.to_numpy() > .5) != safe)),
                    safe_candidates=int(safe.sum()),
                    safe_score_rounding_matches=int(np.count_nonzero(safe_score_error <= .5001e-6)),
                    safe_score_max_error=float(safe_score_error.max()) if safe.any() else None))
    assert shape_mismatches == 0 and max_geometry_error < 2e-6, result
    for mode in ['reconstructed', 'export_replay']:
        assert result['stages'][mode]['max_error_nm'] < 3e-6, result
        assert result['stages'][mode]['disagreements'] == 0, result
    return result


def main():
    scenarios = [audit(k, raw, scn) for k, (raw, scn) in enumerate(zip(list_scenarios(), list_scenarios(enac=True)), 1)]
    report = dict(source='https://zenodo.org/records/7437654', archive_md5=zenodo.ZIP_MD5,
                  scope='Default sols1-1.csv through sols10-1.csv and corresponding best files; repeated candidates retained',
                  threshold_nm=7, scenarios=scenarios,
                  candidates=sum(s['candidates'] for s in scenarios),
                  disagreements={mode: sum(s['stages'][mode]['disagreements'] for s in scenarios) for mode in scenarios[0]['stages']})
    print(json.dumps(report, indent=2, allow_nan=False))


if __name__ == '__main__':
    main()
