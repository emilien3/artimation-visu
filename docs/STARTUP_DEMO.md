# Startup demo: trajectories, datasets and a possible quantum formulation

In Artimation Visu, open the **Trajectory Explorer** tab. This view uses its own scenarios and settings; the studio retains its situation. The English demo also works in the standalone HTML. Five classical methods are executable: genetic algorithm, simulated annealing, ORCA, MPC and finite-catalogue MILP.

## Suggested walkthrough, 8 to 10 minutes

1. **The problem, with two aircraft.** Select “Crossing · 2 aircraft”, then run the GA. The original routes pass through the same point at t = 300 s. Return to candidate #0 to show the conflict, move the flight-time slider, then select the best candidate.
2. **The search.** Browse candidate IDs or use the candidate slider. Each aircraft panel shows all its attempts: green for trajectories separated from the other aircraft in the same candidate, red dashed for conflicting trajectories. The thick line shows the selected attempt. Pairwise minimum distances and conflict durations explain the label.
3. **Interactions between aircraft.** Switch to “Convergence · 4 aircraft” and run again. Two aircraft produce one pair to check; four aircraft produce six. A trajectory that is safe in one combination can become unsafe in another. Geometric crossings alone do not establish conflicts: time and, when enabled, altitude also matter.
4. **Another classical search.** Select “Simulated annealing”, then run the same scenario with the same seed. Show accepted and rejected proposals: a rejected proposal remains visible and exportable. Accepted does not mean safe; rejected does not mean conflicting.
   ORCA and MPC instead record successive forecasts and the trajectory they actually execute. Select their final executed result to inspect the flight. MILP selects from a finite catalogue and reports whether its search proves optimality for that catalogue or reaches its node budget.
5. **The data.** Download the complete JSON and both CSVs. Filters do not reduce the exports. The CSVs split trajectories by their local label and also retain the joint candidate's label.
6. **The quantum discussion.** One possible experiment is selecting one trajectory per aircraft from a finite catalog, with costs and incompatibilities. Geometry supplies the constraints, then an optimizer searches for a combination. This is a proposal to discuss with the startup.

## The two scenarios

| Case | Aircraft | Start → destination, in screen-frame NM | Original duration |
|---|---:|---|---:|
| `crossing-2` | 2 | AC001: (30,45) → (90,45); AC002: (60,75) → (60,15) | 600 s |
| `convergence-4` | 4 | The previous two, plus AC003: (90,45) → (30,45); AC004: (60,15) → (60,75) | 600 s |

These synthetic scenarios are independent of the ENAC scenarios: initial speed 360 kt, FL360, horizontal separation 7 NM and vertical separation 1,000 ft. The 7 NM threshold is a configurable modeling choice. Altitude changes are disabled by default for an initial 2D explanation. GA and annealing can optionally change level. ORCA, MPC and MILP currently retain each route's altitude. ORCA can vary speed from zero to the original 360 kt limit; the other four methods keep their nominal segment speeds. When altitude changes are enabled, ground projections can overlap while aircraft remain vertically separated; labels refer to cylindrical separation, not only to the drawing's pixels.

Maneuvers retain the studio model: `[t1, t2, alpha, dz]`, turn at `t1`, head directly to the final waypoint at `t2`, optional level change at 1,500 ft/min, then return to the route altitude. Complete trajectories are evaluated piecewise in continuous time until arrival. Flight times can exceed the original routes' 600 seconds.

## Executable simulated annealing

The browser's annealing solver is in `src/artimation/web/annealing.js`. It reuses the GA's mutation operators and pseudorandom generator, along with `ConflictModel.evaluate`. Each proposal modifies at most one aircraft. The initial state follows the original routes without maneuvers.

Energy is `E = 1 − fitness`: it preserves the model's ranking, where conflict-free solutions outrank conflicting ones. An improvement or tie is accepted; a deterioration of `ΔE` is accepted with probability `exp(−ΔE / T)`. Temperature decreases geometrically from 0.15 to 0.00001 by default. It has no physical unit. Every proposal is recorded, including rejected proposals and repetitions; rejection retains the previous current state. The result displays the best candidate encountered, which can differ from the chain's final state.

This is a classical heuristic over the model's genes, using the GA's asymmetric neighborhood; it makes no claim of certified equilibrium sampling. The annealing solver currently uses neither QUBO nor quantum hardware. Its parameters are local choices, not a reproduction of a published solver. The [D-Wave classical annealing documentation](https://docs.dwavequantum.com/en/latest/ocean/api_ref_samplers/generated/dwave.samplers.SimulatedAnnealingSampler.sample.html) provides a separate example of annealing applied directly to a binary quadratic model.

Default budgets produce **2,380 recorded attempts per run**: 60 initial individuals + 40 × 58 descendants for the GA, or one initial state + 2,379 proposals for annealing. Retained elites are not new records. Duplicate proposals use an evaluation cache. Equal proposal budgets therefore guarantee neither the same number of distinct evaluations nor the same computation time.

## ORCA: reciprocal velocity adjustments

`src/artimation/web/orca.js` implements the reciprocal velocity-obstacle geometry described by [van den Berg et al.](https://gamma.cs.unc.edu/ORCA/). Every 10 seconds, each aircraft chooses a velocity close to its preferred velocity toward its destination, subject to pairwise ORCA halfplanes and its speed limit. Each aircraft takes half of the required pairwise relative-velocity correction. This does not imply equal heading changes or equal detours.

The local objective and constraints are:

```text
minimize ||v_i − v_preferred_i||²
subject to n_ij · v_i ≥ b_ij for every active neighbor j
           ||v_i|| ≤ v_nominal_i
```

Velocities use NM/s, so 360 kt is 0.1 NM/s. The prediction horizon is 400 seconds. Pair geometry uses 7 NM plus a 0.00001 NM numerical margin. A small two-dimensional convex solver enumerates the possible optimal interior and boundary points. If the halfplanes have no feasible point within the speed disc, the implementation explicitly records the common relaxation and constraint violation. Its original guarantees therefore must not be transferred to arbitrary aircraft situations.

Each recorded forecast contains the already executed prefix, the next ORCA command, and a direct-to-destination continuation. That continuation is a forecast, not the sequence of commands ORCA will necessarily execute. The final record contains the accumulated actual trajectory and all applied commands. Each command retains its preferred velocity and local objective; the final objective sums the applied local objectives and has an explicit scope. Instantaneous direction and speed changes remain toy-model simplifications. The default two-aircraft execution reaches a minimum horizontal separation of approximately **7.000010 NM**.

## MPC: optimize, execute one interval, then replan

`src/artimation/web/mpc.js` plans 400 seconds ahead, executes the first 20 seconds, then plans again from the updated positions. This is [model predictive control](https://web.stanford.edu/~boyd/papers/code_gen_rhc.html). It uses the finite-catalogue MILP solver below internally, adding the previous plan's remaining trajectory as an option when applicable. MPC is the replanning framework; MILP is the optimization formulation used inside it.

Its local objective, summed over active aircraft, is:

```text
J = Σ_i [0.02 ΔL_i + 0.05 M_i
       + 0.01 ||v_first_i − v_previous_i||² / v_nominal_i²
       + 0.002 d_goal_i(t + 400)]
```

`ΔL_i` is the remaining plan's added distance in NM, `M_i` indicates a maneuver, and `d_goal_i` is the distance in NM to the destination at the end of the prediction horizon. The continuity term discourages abrupt changes between successive commands. These coefficients are local modeling choices. Separation constraints apply over the prediction horizon, and the next execution interval is independently checked in continuous time before application.

The recorded forecasts and actual execution can differ. The MPC export retains the chosen joint forecast at each replanning step and the actual execution, rather than every alternative examined by its internal catalogue optimizer. A forecast's common evaluation score is not this local MPC objective. The final record reports whether every aircraft reached its destination. A node-budget failure before any motion supplies no solution candidate; a time-limited partial execution remains explicitly incomplete. On the default two-aircraft case, the actual execution has minimum horizontal separation approximately **7.576437 NM**.

## MILP: choose one catalogue trajectory per aircraft

`src/artimation/web/milp.js` formulates binary selection from a deterministic catalogue. Each aircraft has 49 default options: the unchanged route, plus start delays of 0 or 60 seconds, hold durations of 180, 300 or 420 seconds, and turn angles of −40°, −30°, −20°, −10°, 10°, 20°, 30° or 40°. Return-to-destination times are clipped to the original route end. Repeated clipped genes are deduplicated. Short routes can therefore have fewer options.

For each option, the implementation reconstructs the complete trajectory and computes every pairwise incompatibility with the continuous separation model. With `x_ik = 1` when aircraft `i` selects option `k`, it solves:

```text
minimize Σ_ik c_ik x_ik
subject to Σ_k x_ik = 1                         for each aircraft i
           x_ik + x_jl ≤ 1                      for incompatible options
           x_ik ∈ {0, 1}

c_ik = 0.02 added_distance_nm_ik + 0.05 maneuvering_aircraft_ik
```

This is a binary linear model. Its specialized branch-and-bound solver uses an admissible lower bound and proves optimality only when the finite search is exhausted. The default node budget is 200,000. A budget-limited incumbent is a feasible result without an optimality certificate; a budget-limited search without an incumbent is not an infeasibility proof. Partial tree nodes are progress events, not complete trajectory candidates.

In the default two-aircraft result, AC001 stays on its route. AC002 turns left 20° at 0 seconds and heads directly to its destination at 300 seconds. Minimum separation is **7.367268 NM**, added distance **3.423144 NM**, and objective **0.118463**. The result is optimal within this 49-option-per-aircraft catalogue. It does not establish an optimum over every possible maneuver.

## Common evaluation and method-specific objectives

The five methods' complete stored trajectories use the same continuous pairwise separation calculation. The common score uses:

```text
P = C + 10 max(0, 7 − d_min) + 0.02 ΔL + 0.05 M + 0.04 Z / 1000
fitness = 0.5 + 0.5 / (1 + P)     if safe
fitness =       0.5 / (1 + P)     otherwise
```

`C` sums conflict seconds across pairs, `d_min` is minimum equivalent separation in NM, `ΔL` is total added horizontal distance in NM, `M` counts maneuvering aircraft, and `Z` sums active altitude offsets in ft. At common FL360, equivalent separation is horizontal separation and `Z = 0`. The implementation preserves a strict score boundary around 0.5 even at floating-point extremes. This score is not a probability.

GA directly maximizes this fitness and annealing minimizes `1 − fitness`. ORCA minimizes local velocity change, MPC minimizes its local planning objective, and MILP minimizes catalogue cost under separation constraints. Their final paths can all be evaluated with the common fitness, but their native objectives and search records differ. Equal recorded-candidate counts would not make these computational budgets equivalent.

## Dataset contract, version 1

The JSON contains original routes, units, separation limits, the complete configuration, effective weights, candidates in proposal order, their provenance and global metrics, pairwise results, and per-aircraft trajectories. The `run_id` includes the scenario, algorithm, seed, budget, vertical mode, and a fingerprint of the configuration and routes. The fingerprint names files; it is not cryptographic proof of identity.

| Field | Meaning |
|---|---|
| `candidate_id`, `step`, `generation` | Run-local identifier; GA generation or annealing iteration (`generation = null` for annealing). |
| `first_seen_candidate_id` | First candidate with exactly the same joint genes. Repetitions remain in the exports. |
| `origin` | `B`: original routes; `G`: random draw; `M_parent` / `C_parent_parent`: GA offspring; `S_parent`: annealing proposal. |
| Candidate `label` | `safe` if every pair remains separated, otherwise `unsafe`. Safe does not mean optimal. |
| Trajectory `label` | Separated from every other aircraft **in this candidate**, or in conflict with at least one of them. |
| `pairs`, `conflicting_aircraft` | Minimum equivalent separations, pairwise conflict durations and aircraft involved. The global duration sums pairwise durations, even when conflicts occur simultaneously. |
| `knots` | Exact `(t_s, x_nm, y_nm, z_ft)` points at heading or vertical-slope changes. Interpolate linearly between points. |
| `accepted`, `temperature`, `parent_candidate_id` | Annealing chain state, including rejected proposals; `null` for the GA. The initial state is marked accepted. |
| `energy`, `acceptance_probability` | Annealing energy and acceptance probability, independent of the safety label; `null` for the GA. |

Coordinates use **x east and y south**, in NM; times are in seconds and altitudes in ft. Equivalent separation is `max(horizontal distance, vertical difference × 7/1000)` with the default settings. A JSON separation of `null` represents the model's infinity when two flights have no common time interval. A safe pair must meet the separation threshold and have zero conflict duration. CSVs contain one trajectory knot per row; every row belonging to a trajectory shares its context and labels.

To create all four datasets without a browser:

```bash
node scripts/export_exploration.cjs
node scripts/export_exploration.cjs --seed 1 --out /tmp/artimation-exploration-seed-1
node scripts/export_exploration.cjs --methods all --out docs/output/artifacts/five-methods
```

Each run produces one complete JSON, one `safe` CSV and one `unsafe` CSV. The default remains the four historical GA/annealing runs: both scenarios, with GA population 60 and 40 generations. Use `--methods all` for all five methods on both scenarios, or a comma-separated selection such as `--methods orca,mpc,milp`. The default directory is `docs/output/artifacts/exploration/`, with a `summary-seed-0.json` summary. The script refuses to overwrite an existing file: use another directory to repeat an identical run. The standalone HTML download also contains this view for offline demonstrations.

### Version 2 for ORCA, MPC and MILP

The browser exports these three methods with `schema_version = 2`, retaining the original fields and adding method-specific information:

| Field | Meaning |
|---|---|
| `best_candidate_id` | Highest common fitness among stored records. For a controller, this can identify an earlier hypothetical forecast. |
| `solution_candidate_id` | Actual executed record for ORCA/MPC, or the selected feasible MILP incumbent. `null` when no such result exists. |
| `solver_status`, `diagnostics` | Completion, constraint-relaxation or finite-catalogue certificate information. |
| Candidate `method` | Record kind, controller time, native objective, solver status or search certificate, as applicable. |
| Candidate `commands` | Commands associated with this forecast or executed trajectory. The final controller record retains all applied commands. |
| Trajectory `gene` | `null` for ORCA/MPC, which can issue multiple commands; a four-component gene for MILP catalogue options. No gene is invented for a controller trajectory. |

`method.kind` distinguishes `baseline`, `forecast`, `executed` and `complete-assignment`. The CSV adds five columns, giving 37 in total: `record_type`, `controller_time_s`, `method_objective`, `method_status` and `commands_json`. Its original four gene columns are empty for ORCA/MPC. One row still represents one exact timed trajectory point. `commands_json` contains only that aircraft's commands on its first row (`knot_index = 0`) and is empty on later rows; read the first row of each `(run_id, candidate_id, aircraft_id)` group to reconstruct the commands. Commas and quotation marks in command JSON use CSV escaping. The complete joint command list remains in each JSON candidate.

The Trajectory Explorer tab and the command-line exporter both support all five methods. Model tests independently check complete default executions for both scenarios against the Python analytic geometry, validate CSV round trips and preserve the four original numeric trace fingerprints. Separate SciPy/HiGHS tests reconstruct catalogue costs and incompatibilities with Python and confirm both default MILP optimum values independently of the JavaScript search.

These data are synthetic and conditioned on the algorithm: a trajectory's frequency in the search is not an operational probability. For future machine learning, separate runs and scenarios between training and evaluation, then check for duplicate genes across partitions. Randomly splitting points from the same trajectory would leak information.

## Possible quantum formulation and next experiment

The following translation is a **proposal for our toy project**. [Stollenwerk et al.](https://arxiv.org/abs/1711.04889) already study QUBO formulations of simplified strategic deconfliction problems using conflict graphs; their study concerns different instances and decisions. The [D-Wave formulation techniques](https://docs.dwavequantum.com/en/latest/quantum_research/reformulating.html) describe penalties for binary constraints.

| Part of the toy problem | Proposed treatment |
|---|---|
| Generate and reconstruct trajectories | Classical computation; create a finite catalog and deduplicate genes per aircraft. |
| Test separation over time | Classically compute incompatibilities between **all** options for two aircraft, including options from different candidates. |
| Choose one option per aircraft while minimizing cost | A possible QUBO formulation, to compare with a classical solver and a suitable quantum solver. |
| Revalidate and display the solution | Classical reevaluation using the existing separation model. |

With `x_ik = 1` when aircraft `i` takes trajectory `k`, one possible formulation is:

```text
E(x) = Σ c_ik x_ik
     + A Σ_i (Σ_k x_ik − 1)²
     + B Σ_(ik,jl incompatible) x_ik x_jl
```

The first term is an **additive, nonnegative** per-trajectory cost, such as detour and maneuver magnitude. The second imposes one trajectory per aircraft; the third discourages conflicts between options. If the catalog contains a safe combination, choosing `A` and `B` strictly greater than `Σ_i max_k c_ik` mathematically suffices to rank every invalid state below a valid combination. This choice must then account for the selected solver's ranges and precision.

This energy does not directly reproduce the complete current fitness: the reciprocal transformation, safety priority and global separation shortfall require explicit choices. Retain geometry and safety constraints, then state the objective differences precisely.

The next experiment can start with **5 options per aircraft**, including original routes and the genes of a safe joint solution when one has been found. This gives 10 or 20 logical binary variables and respectively 25 or 625 choice combinations to enumerate classically. These are not physical-qubit counts. Recompute all catalog incompatibilities, solve these small cases exactly as a reference, then compare classical QUBO annealing and a quantum solver on the same objective, including classical computation and solver-access costs.

The current view establishes no quantum advantage, global optimum or success rate beyond these demonstrations.
