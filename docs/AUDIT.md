# Audit

Source-code and document review of Artimation Visu, November 2026. It is not a user study, and it does not validate the original ARTIMATION solver.

## Summary

- The project combines Christophe Hurter's **Vector** visualization with a **local adaptation of an ARTIMATION-style genetic solver**.
- The papers cite Durand and Gotteland (2006) for the algorithm but do not give enough detail to reproduce it. The solver here is a teaching adaptation, not the original.
- The application finds conflict-free solutions on all tested scenarios. Its agreement with the ENAC data covers geometry only, not the original search behavior.

## Sources

| Source | Used for |
|---|---|
| Hurter et al., [ICAART 2024](https://doi.org/10.5220/0012471900003636) | GA criteria, BlackBox / HeatMap / Storyboard, user evaluation. Read in full. |
| Hurter et al., [Transportation Research Procedia 66 (2022)](https://doi.org/10.1016/j.trpro.2022.12.027) | Published record. The PDF returned HTTP 403, so the authors' [accessible manuscript](https://zenodo.org/records/7194009/files/EAAP_Artimation_Final-1.pdf) was read instead. Its title and pagination differ from the published version. |
| Durand & Gotteland, [2006](https://doi.org/10.1007/3-540-30966-7_10) | Algorithmic lineage cited by both papers. Identified, not read. |
| [ARTIMATION project](https://www.sesarju.eu/projects/artimation) (SESAR) | Project context. |
| [ENAC scenarios](https://zenodo.org/records/7437564) and [ENAC solutions](https://zenodo.org/records/7437654) (Zenodo) | Ten scenarios adapted from 2016 traffic, and the outputs of Nicolas Durand's GA. A dataset, not the solver source. Archive MD5 `e0997d1839f8c9ce80dc7099be32bbd7`. |
| [Vector / NextQCM](https://recherche.enac.fr/~hurter/NextQCM/) | The original visualization. A copy was used as a test oracle during the audit and is no longer in the repository. |

The two papers disagree on sample sizes (the 2024 abstract and methods swap the expert and student counts; the 2022 draft says nine controllers in one place and sixteen in another). Check the final records before quoting subgroup results.

## What is and is not reproduced

| Topic | This repository | Assessment |
|---|---|---|
| Candidate | One `(t1, t2, alpha, dz)` gene per aircraft; unchanged baseline included | Same principle as the papers. The exact encoding comes from the ENAC data, and `dz` is a local extension. |
| Operators | Tournament selection (size 3), 2 elites, per-aircraft crossover (0.7) and mutation (0.4), random immigrants (0.1); defaults 100 × 100 | A real GA with local settings. The papers do not specify them. |
| Objective | `P = C + 10 max(0, 7 − d_min) + 0.02 ΔL + 0.05 M + 0.04 Z/1000`, `f = 0.5·safe + 0.5/(1+P)` | Related to the papers' criteria (conflict duration, trajectory length, number of orders). The weights are local. `C` sums pairs, so simultaneous conflicts add up. |
| Dynamics | Continuous time, instantaneous turns, constant speed per segment | Simplified: no wind, turn rate or uncertainty. |
| Altitude | FL360 by default, optional ±1,000 / 2,000 ft offsets at 1,500 ft/min | Local extension. Untick **allow level changes** for a horizontal comparison. |
| Separation | Analytic cylinder, 7 NM / 1,000 ft | A model choice, not an operational standard. |
| Python and JavaScript | Same formulas, different random generators | The same seed does not give the same search. |

### Visual explanations

| Paper | Here |
|---|---|
| BlackBox: selected solution with colored trajectories | Present. There are no numbered command markers and no annotation of the closest approach on the full plan. |
| HeatMap: good and bad explored trajectories, Gaussian-smoothed | Present, with an adjustable Gaussian width. Not an exact reproduction of the paper's contour maps. |
| Storyboard: command-by-command snapshots, alternative, delayed limit solution | **Absent.** Playback and manual maneuvers do not replace it. |

How to read the **GA heatmap**:
- It accumulates the explored trajectories, not every possible one and not a probability.
- A path is green if that aircraft is separated from the others **in the same candidate**. Green paths from different candidates cannot be combined without re-evaluating the joint solution.
- A path is red over its entire length as soon as that aircraft has a conflict in the candidate.
- Safe and unsafe layers are each log-scaled by their own maximum, so the color strength is not a proportion.
- It differs from the **heading density** map, which changes one aircraft's heading while the others stay fixed.

## Validation against the ENAC data

The reconstructed horizontal model reproduces all **151,500 candidates** of `sols1-1.csv` to `sols10-1.csv`, repetitions included:
- **0 classification disagreements** at 7 NM (9,992 with the first, generic model).
- Maximum distance error **1.1e-6 NM**, which is the six-decimal rounding of the CSVs.
- All **414,100 polylines** match, with a maximum point error of 1.4e-6 NM.

The reconstruction comes from published outputs, not from the solver source, and the same corpus was used to build and check it. It validates **genes → trajectories → separation**, not the evolution, the ranking or the stopping behavior.

**Recovered model**
1. Each aircraft's speed is the first segment of its scenario file. The polyline is retimed at that constant speed.
2. Displayed trajectories start at the exported snapshot, offset by 1.31–5.73 s per scenario (`data/scenarios/enac-starts.json`). Genes keep the original clock.
3. A maneuver turns by `alpha` at `t1` on the retimed route and flies until `t2`.
4. Points are kept only if the angle between rays from the last kept point is at least **2.5°**. Pruning explains why nonzero genes can produce no turn.

**Cumulative counters.** The `conflits` column is not always the duration of the row's own trajectory: each repeated export of a candidate adds another copy. Integer multiples of the first export explain every counter. The application ignores them and recomputes durations analytically. Recorded fitness never changes for a repeated ID (16,794 IDs recur, 3,705 with changing counters), so there is no sign that the counters affect it.

**Fitness.** For the 100,572 safe records, `f = 0.5 + 1/(4+M) + 1/(4+T)` matches within rounding. `M` is the number of nonzero angle genes. `T` is the sum of arrival times. This is empirical, not confirmed by the authors. The formula for the other 50,928 (conflicting) records is unknown, so the app keeps its own **Local fitness**.

Scenario 10's original final solution is unsafe: **6.399745 NM**, reproduced exactly.

**Own searches.** 10 scenarios × seeds 0/1/2 × with and without altitude, population 60, 60 generations: **60/60 conflict-free**. Every JavaScript result was re-evaluated in Python.

## Defects found and fixed

- A tiny residual conflict could outrank a safe solution. Scores above 0.5 are now reserved for safe solutions in both evaluators.
- The initial population now includes the unchanged scenario.
- Short routes starting late could get invalid maneuver times, and single-aircraft evaluation crashed in Python.
- Python heatmaps lost repeated contributions to a cell (`np.add.at` now accumulates them).
- Duplicate candidates are cached. The best-fitness chart no longer appears to regress despite elitism.
- Vertical instructions could announce the return before the target level was reached.
- The interface mixed two assumptions: encounter analysis ignores future maneuvers, while the solution panel includes them. Both are now labeled.
- Search angles now include −40° and +40°.
- Simulated annealing reused the genetic mutation as its move and the GA's random generator. It now has its own neighborhood (one component per move, symmetric steps that reflect at the bounds, explicit add and remove moves). Its traces and the slide 5 example changed; the generator moved to `model.js`.
- MPC called the MILP module for its candidates and its horizon optimization. It now builds its own candidate maneuvers and runs its own exact search. Its traces are unchanged.
- Exports used two schemas (genetic and annealing without solver status, solution identifier or commands) and three command formats. All five methods now write one schema (version 3) with a common leg-by-leg command list.
- Heading space with altitude: an intruder horizontally inside the separation radius but vertically separated at the current time blocked every heading. Headings are now blocked outright only when the vertical window is already open; otherwise they are sampled like any partial window.

## Architecture

The original Vector uses x to the right and y downward, headings clockwise from north, speeds in knots and time in minutes, with constant velocity and no altitude.

| File in `src/artimation/web/` | Role |
|---|---|
| `physics.js`, `density.js`, `density-view.js` | Vector physics and heading density, extended with vertical separation |
| `model.js` | Routes, timed maneuvers, continuous trajectory evaluation |
| `ga.js`, `annealing.js`, `orca.js`, `mpc.js`, `milp.js` | The five solvers. Each depends on `model.js` only, never on another solver. |
| `exploration.js`, `exploration-view.js` | Trajectory Explorer and dataset export |
| `view3d.js` | 3D view |
| `app.js`, `index.html`, `charts.js` | UI, scenarios, charts |

`app.py` serves the page through `src/artimation/server.py`. The Python modules (`conflict.py`, `ga.py`, `vector.py`) are reference implementations used to cross-check the JavaScript.

The heading density is analytic in the horizontal case. With altitude it samples headings at 0.05° over partial vertical windows, so the extended model is not exact.

## Open questions for the authors

The most useful material would be the solver revision and configuration behind Zenodo 7437654, its conflict and distance conventions, the status of scenario 10's sub-7 NM reference, and the score of conflicting candidates.

## Reproduce

```bash
.venv/bin/python -m pytest
.venv/bin/python scripts/audit_enac.py > docs/output/artifacts/enac-audit.json
.venv/bin/python scripts/audit_solver.py --enac > docs/output/artifacts/solver-enac-audit.json
```

The ENAC audits need Node.js and the optional Zenodo archive (`scripts/fetch_zenodo.py`, about 49 MB). Results: [enac-audit.json](output/artifacts/enac-audit.json), [solver-enac-audit.json](output/artifacts/solver-enac-audit.json), [solver-audit.json](output/artifacts/solver-audit.json).
