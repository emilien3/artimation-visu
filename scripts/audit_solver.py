"""Reproducible audit: JS GA on ten scenarios, three seeds and two modes,
then geometric comparison with every locally available ENAC candidate.

Run: .venv/bin/python scripts/audit_solver.py > artifacts/solver-audit.json
Timings include Node startup and serialization, but exclude UI rendering.
"""
import json
import argparse
import platform
import subprocess
import sys
from pathlib import Path
from time import perf_counter

import numpy as np

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'src'))
from artimation.conflict import evaluate, list_scenarios
from artimation.webapp import to_vector_frame
from artimation import zenodo


def node(payload):
    result = subprocess.run(['node', str(ROOT / 'scripts/model_oracle.js')], input=json.dumps(payload),
                            capture_output=True, text=True, check=True)
    return json.loads(result.stdout)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--enac', action='store_true', help='Use reconstructed ENAC trajectories instead of the generic model')
    args = parser.parse_args()
    report = dict(python=platform.python_version(), node=subprocess.check_output(['node', '--version'], text=True).strip(),
                  model='enac_reconstruction' if args.enac else 'generic',
                  config=dict(pop=60, generations=60, seeds=[0, 1, 2], sep=7, sepV=1000), ga=[], zenodo=[])
    for k, scn in enumerate(list_scenarios(enac=args.enac), 1):
        routes = to_vector_frame(scn)
        for vertical in (False, True):
            for seed in report['config']['seeds']:
                start = perf_counter()
                result = node(dict(routes=routes, ga=dict(pop=60, generations=60, seed=seed, vertical=vertical)))['ga']
                elapsed = perf_counter() - start
                py = evaluate(scn, result['best'])
                assert abs(py.dmin - result['dmin']) < 1e-6
                assert abs(py.conflict_s - result['conflict']) < 1e-6
                report['ga'].append(dict(scenario=scn.name, vertical=vertical, seed=seed, seconds=elapsed,
                                         safe=py.conflict_s == 0 and py.dmin >= 7 - 1e-9, **result))
        if not zenodo.available(k):
            report['zenodo'].append(dict(scenario=scn.name, available=False))
            continue
        genes, _, ref, _, best = zenodo.load_run(scn, k)
        values = node(dict(routes=routes, genes=genes.tolist()))['evals']
        local = np.array([e['dmin'] for e in values])
        delta = np.abs(local - ref)
        original_best = evaluate(scn, best)
        report['zenodo'].append(dict(scenario=scn.name, available=True, candidates=len(ref),
                                     correlation=float(np.corrcoef(local, ref)[0, 1]),
                                     median_error_nm=float(np.median(delta)), p95_error_nm=float(np.quantile(delta, .95)),
                                     max_error_nm=float(delta.max()),
                                     classification_disagreements=int(np.count_nonzero((local >= 7) != (ref >= 7))),
                                     original_best_local_dmin=original_best.dmin))
    print(json.dumps(report, indent=2, allow_nan=False))


if __name__ == '__main__':
    main()
