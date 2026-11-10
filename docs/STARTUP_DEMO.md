# Startup demo

Open the **Trajectory Explorer** tab. It has its own scenarios and settings; the Studio keeps its situation. The standalone HTML works offline. Five classical methods run: genetic algorithm, simulated annealing, ORCA, MPC and finite-catalogue MILP. The formulas are in [FORMULAS_EXPLAINED.md](FORMULAS_EXPLAINED.md).

## Walkthrough, 8 to 10 minutes

1. **Two aircraft.** Select "Crossing · 2 aircraft" and run the GA. The original routes meet at t = 300 s. Show candidate #0 (the conflict), move the flight-time slider, then select the best candidate.
2. **The search.** Browse candidates. Each aircraft panel shows all its attempts: green if separated from the others in the same candidate, red dashed if in conflict. The thick line is the selected attempt.
3. **Four aircraft.** Select "Convergence · 4 aircraft" and run again. Two aircraft give one pair to check, four give six. A trajectory safe in one combination can be unsafe in another.
4. **Other methods.** Run simulated annealing with the same seed: rejected proposals stay visible and exportable, and accepted does not mean safe. ORCA and MPC record successive forecasts and the flight they actually execute. MILP picks from a finite catalogue.
5. **The data.** Download the full JSON and both CSVs. Filters do not shrink the exports.
6. **Quantum discussion.** See the last section. It is a proposal to discuss, not a result.

## Scenarios

| Case | Aircraft | Start → destination (NM) |
|---|---:|---|
| `crossing-2` | 2 | AC001 (30,45) → (90,45); AC002 (60,75) → (60,15) |
| `convergence-4` | 4 | The two above, plus AC003 (90,45) → (30,45); AC004 (60,15) → (60,75) |

Both last 600 s, with 360 kt, FL360 and 7 NM / 1,000 ft separation. They are synthetic and independent of the ENAC scenarios. Altitude changes are off by default and available for GA and annealing only. ORCA can vary speed up to 360 kt; the other four methods keep their nominal speed. That extra freedom means the results are demonstrations, not a performance ranking.

A maneuver is `[t1, t2, alpha, dz]`: turn by `alpha` at `t1`, head to the final waypoint at `t2`, with an optional level change at 1,500 ft/min.

## Methods

| Method | How it works | Key settings |
|---|---|---|
| GA | Evolves complete joint plans | Population 60, 40 generations: 2,380 recorded attempts |
| Annealing | Changes one aircraft per proposal, accepts a worse one with probability `exp(−ΔE/T)`, `E = 1 − fitness` | T from 0.15 to 0.00001, 2,380 proposals |
| ORCA | Every 10 s, each aircraft takes the velocity closest to its desired one under the pairwise ORCA constraints | 400 s horizon, 0.1 NM/s limit |
| MPC | Plans 400 s ahead, executes 20 s, replans. Uses the MILP inside | Forecasts and executed flight are separate records |
| MILP | Picks one of 49 catalogue options per aircraft, minimizing cost under pairwise incompatibilities | Optimality is proven only within the catalogue (200,000-node budget) |

On the default two-aircraft case, the minimum separations are about 7.000 NM (ORCA), 7.576 NM (MPC) and 7.367 NM (MILP). MILP's added distance is 3.423 NM.

All five are scored with the same fitness, so their final paths are comparable, but their native objectives and search budgets differ. Annealing reuses the GA mutation operators and `ConflictModel.evaluate`. The solvers are `src/artimation/web/{annealing,orca,mpc,milp}.js`.

## Datasets

```bash
node scripts/export_exploration.cjs                       # 4 historical GA / annealing runs
node scripts/export_exploration.cjs --seed 1 --out /tmp/exploration-seed-1
node scripts/export_exploration.cjs --methods all --out docs/output/artifacts/five-methods
```

Each run gives one JSON, one `safe` CSV and one `unsafe` CSV. `--methods` also accepts a list such as `orca,mpc,milp`. The default output is `docs/output/artifacts/exploration/` (not tracked by git). The script never overwrites a file.

Coordinates are x east and y south in NM, time in seconds, altitude in ft. One CSV row is one timed trajectory point. The main JSON fields:

| Field | Meaning |
|---|---|
| `candidate_id`, `step`, `generation` | Run-local ID; GA generation (`null` for annealing) |
| `first_seen_candidate_id` | First candidate with the same joint genes. Repetitions stay in the exports. |
| `origin` | `B` baseline, `G` random, `M_`/`C_` GA offspring, `S_` annealing proposal |
| Candidate `label` | `safe` if every pair is separated. Safe does not mean optimal. |
| Trajectory `label` | Separated from every other aircraft **in this candidate**, or in conflict |
| `pairs`, `conflicting_aircraft` | Minimum separations and conflict durations per pair. The global duration sums the pairs. |
| `knots` | `(t_s, x_nm, y_nm, z_ft)` at each change of heading or vertical slope; interpolate linearly |
| `accepted`, `temperature`, `energy`, `acceptance_probability` | Annealing state, including rejected proposals (`null` for the GA) |

ORCA, MPC and MILP export `schema_version = 2`, with these additions:

| Field | Meaning |
|---|---|
| `solution_candidate_id` | Executed record (ORCA, MPC) or selected MILP incumbent; `null` if none |
| `best_candidate_id` | Highest fitness among stored records. For a controller this can be an earlier forecast. |
| `solver_status`, `diagnostics` | Completion, constraint relaxation or catalogue certificate |
| Candidate `method`, `commands` | Record kind (`baseline`, `forecast`, `executed`, `complete-assignment`), controller time, native objective, commands |
| Trajectory `gene` | `null` for ORCA and MPC, a four-component gene for MILP |

The version 2 CSV has 37 columns: the five added are `record_type`, `controller_time_s`, `method_objective`, `method_status` and `commands_json`. `commands_json` is filled only on the first row of each aircraft's trajectory (`knot_index = 0`).

The data are synthetic and conditioned on the algorithm: a trajectory's frequency in the search is not an operational probability. For machine learning, split by run and scenario, not by point, or the trajectories leak between sets.

## Possible quantum formulation

This is a proposal for the toy project. [Stollenwerk et al.](https://arxiv.org/abs/1711.04889) already study QUBO formulations of simplified deconfliction, and [D-Wave](https://docs.dwavequantum.com/en/latest/quantum_research/reformulating.html) describes penalties for binary constraints.

| Part of the problem | Treatment |
|---|---|
| Generate trajectories, test separation over time | Classical: build a finite catalogue per aircraft and compute the incompatibilities between all options |
| Choose one option per aircraft at minimum cost | Candidate for a QUBO, to compare with a classical solver |
| Revalidate and display | Classical, with the existing separation model |

With `x_ik = 1` when aircraft `i` takes option `k`:

```text
E(x) = Σ c_ik x_ik + A Σ_i (Σ_k x_ik − 1)² + B Σ_(ik,jl incompatible) x_ik x_jl
```

The first term is a nonnegative cost per option, the second imposes one option per aircraft, the third penalizes conflicts. If the catalogue contains a safe combination, `A` and `B` strictly greater than `Σ_i max_k c_ik` rank every invalid state below a valid one. The solver's range and precision must then be checked. This does not reproduce the full fitness: the safety priority and the separation shortfall need explicit choices.

First experiment: **5 options per aircraft**, including the original route and a known safe solution. That is 10 or 20 logical binary variables and 25 or 625 combinations, not qubit counts. Recompute all incompatibilities, solve exactly as a reference, then compare classical QUBO annealing and a quantum solver on the same objective, including classical and access costs.

Nothing here shows a quantum advantage.
