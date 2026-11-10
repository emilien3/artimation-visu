# Artimation Visu

**Artimation Visu** is a teaching prototype combining Christophe Hurter's ENAC **Vector — Aircraft crossing studio** with a locally adapted genetic solver, altitude maneuvers, explored-trajectory heatmaps and a 3D view.

It is inspired by Hurter et al. ([2022](https://doi.org/10.1016/j.trpro.2022.12.027), [2024](https://doi.org/10.5220/0012471900003636)) within the SESAR [ARTIMATION](https://www.sesarju.eu/projects/artimation) project. It does **not** contain Nicolas Durand's original solver or reproduce the user studies.

See the [scientific and technical audit](docs/AUDIT_SCIENTIFIQUE.md) for the source lineage, implementation differences, measured results and remaining limitations.

The [ENAC reconstruction audit](docs/ENAC_RECONSTRUCTION.md) explains and resolves the initial 9,992 distance-classification disagreements, and traces the cumulative conflict counters in the original exports.

The [2022 paper comparison](docs/PAPER_2022_COMPARISON.md) maps the available manuscript to the current GA, BlackBox-style solution view, heatmap and missing Storyboard, with explicit source-version and implementation limits.

## Run

```bash
git clone https://github.com/emilien3/artimation-visu.git
cd artimation-visu
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
.venv/bin/python app.py
.venv/bin/python -m pytest
```

Open **http://localhost:8501**. The application serves the visualization directly, with no embedded page. Refresh the browser after editing sources. The downloadable standalone HTML runs offline.

If Artimation Visu is already running, launching it again prints its address and exits cleanly. If another application uses the port, choose another one with `.venv/bin/python app.py --port 8502`.

Open the **Trajectory Explorer** tab for the startup demo: two- and four-aircraft toy scenarios, every recorded joint plan, per-aircraft safe/conflicting paths, flight-time inspection, and JSON / labeled CSV exports. Five methods are executable: **genetic algorithm, simulated annealing, ORCA, MPC and MILP**. The Studio tab retains its own editable scenario. Detailed controls are under **Search settings**, **Aircraft settings** and **Display settings**.

The demo keeps all aircraft at FL360 with a 7 NM horizontal separation requirement. GA, annealing, MPC and MILP keep 360 kt. ORCA adjusts direction and speed, up to 360 kt, using a desired velocity toward the destination. Its extra freedom means these outputs are demonstrations, not a controlled performance ranking. MPC replans every 20 seconds over a 400-second horizon. MILP selects from a finite catalogue and certifies optimality only within that catalogue.

Controller forecasts and actual executed flights are separate records. **Result** selects the executed flight for ORCA/MPC and the selected catalogue plan for MILP. It does not select a controller's highest-scoring hypothetical forecast. New methods use schema version 2, with timed paths, commands, method objectives and termination status. GA/annealing retain their version 1 exports and seed-0 numerical traces.

Version 2 CSVs have 37 columns. The first point of each aircraft trajectory (`knot_index = 0`) carries that aircraft's `commands_json`; subsequent points leave this field empty. JSON retains the complete joint command list for every record.

See the [demo guide, dataset schema and method formulas](docs/STARTUP_DEMO.md). Generate the original four GA/annealing datasets with `node scripts/export_exploration.cjs`. To export all five methods on both scenarios, use `node scripts/export_exploration.cjs --methods all --out docs/output/artifacts/five-methods`. Existing files are never overwritten. All five executable methods are classical; the startup discussion can identify a suitable quantum formulation.

## Presentation and speaker guide

- [English presentation, 7 slides with editable equations](docs/output/artimation_visu_demo_en_formulas.pptx)
- [English formula guide, PDF](docs/output/pdf/artimation_visu_formulas_guide_en.pdf)
- [English formula guide, Markdown](docs/FORMULAS_EXPLAINED.md)

## Model and implementation

| Component | Implementation |
|---|---|
| One gene per aircraft: `(t1, t2, alpha, dz)` | `conflict.py`, browser `model.js` |
| Turn at `t1`, hold the new heading until `t2`, then head directly to the final waypoint | `maneuver_path` / `maneuverPath` |
| Optional altitude offset, reached at 1,500 ft/min, then return to the original route altitude | `vertical_profile` / `verticalProfile` |
| Continuous separation evaluation along piecewise linear trajectories | `_pair_stats` / `pairStats` |
| Tournament selection, per-aircraft crossover, mutation, elitism and random immigrants | `ga.py`, browser `ga.js` |
| Safe candidates always outrank conflicting ones; then minimize maneuver cost | `evaluate` |
| Original routes included in the initial population; duplicate evaluations cached | Both genetic solvers |
| Reciprocal collision avoidance with local velocity optimization | Browser `orca.js` |
| Receding-horizon catalogue optimization and first-interval execution | Browser `mpc.js`, using `milp.js` |
| Exact binary trajectory selection with compatibility constraints | Browser `milp.js` |
| Ten ENAC scenarios adapted from 2016 traffic | `data/scenarios/` |
| ENAC snapshot, constant-speed retiming and 2.5° angular path simplification | `list_scenarios(enac=True)`; automatic for bundled browser scenarios |
| Optional original ENAC solver outputs | `scripts/fetch_zenodo.py`, approximately 49 MB |

The default separation cylinder is **7 NM horizontally and 1,000 ft vertically**. A conflict requires both limits to be violated. The displayed equivalent separation is `max(horizontal distance, vertical distance × horizontal limit / vertical limit)`; it is not a Euclidean 3D distance. Ignoring altitude recovers the horizontal model.

The Python and JavaScript genetic solvers share their evaluation model but use different random generators: the same seed does not imply identical solutions.

ENAC gene times use the original scenario clock; playback begins at the exported snapshot. Displayed instructions use actual reconstructed turn times. The generic waypoint model remains available with `list_scenarios()` and for free situations. Search angles span −40° to +40° in 5° increments.

## Interface

The original Vector controls remain available: place and drag aircraft, adjust heading and speed, play/pause/scrub time, inspect encounters and safe heading intervals, and configure the heading-density map. Artimation Visu adds altitude and vertical rate, the genetic solver, manual maneuvers, solution instructions, charts, and 2D/3D views with altitude, time or density relief as the vertical axis.

**Separation zones** use half the separation limits: with 7 NM / 1,000 ft settings, each aircraft has a 3.5 NM radius and a vertical half-height of 500 ft. Overlapping cylinder interiors indicate an instantaneous conflict; touching boundaries do not. In 2D (and non-altitude 3D views), horizontal projections can overlap safely: blue dashed zones and a **VERTICALLY SEPARATED** label identify these cases. Actual conflicts are red and explicitly labeled, with pair distances. The zones switch applies to the selected aircraft too.

The radar distinguishes **NOW** (instantaneous separation during playback) from **DISPLAYED ROUTES** (the complete evaluated trajectories). Current-heading forecast overlays are suppressed by default when a solution is displayed; explicitly focusing an encounter can show its forecast, in amber, independently of planned future turns.

**Encounter analysis and heading density** project current vectors at constant heading and vertical rate. They exclude future planned maneuvers. **Solution and instructions** evaluates complete planned trajectories. The two panels can therefore show different results.

Open **Fitness weights** under **Genetic algorithm** to adjust conflict duration, separation shortfall, added distance, maneuvering aircraft and altitude costs. Values must be nonnegative; **Reset weights** restores the defaults. Changes immediately re-score the displayed solution and clear the previous search charts/heatmap. Run the solver again to optimize with the new weights, keeping the same scenario and seed for comparisons. Conflict-free solutions always outrank conflicting solutions, including when every weight is zero.

**Gaussian width σ** controls smoothing for both background types, including **GA heatmap**: None, 0.75, 1.5 or 3 NM. The kernel extends to approximately three standard deviations on each side. It updates the display without rerunning the solver; smoothing does not change safety classification or fitness. The GA map convolves safe and unsafe path-length layers separately before logarithmic normalization, using the same smoothed field for 2D colors and 3D relief.

The **GA heatmap** accumulates explored trajectories, not all possible trajectories or probabilities. Green means that an aircraft was separated from the other aircraft **in the same candidate**. Freely combining green trajectories does not guarantee a conflict-free solution. This differs from Vector's heading-density calculation.

## Validation

The November 2026 audit found conflict-free solutions in **60/60 runs**: ten scenarios, seeds 0/1/2, with and without altitude changes, population 60 and 60 generations. Every returned JavaScript solution was independently re-evaluated by the Python implementation.

The corrected reconstruction matches **151,500 original ENAC candidate records**, with **zero classification disagreements at 7 NM** and maximum distance error below **0.000001113 NM**. All 414,100 exported aircraft polylines also match at CSV precision. The initial generic model had 9,992 disagreements. Scenario 10's original final reference remains unsafe at **6.399745 NM**.

Original conflict counters accumulate across population and best-candidate exports. Repeated IDs retain the same recorded fitness despite these counters changing. The application recomputes physical durations and labels its objective **Local fitness**. Neither matching geometry nor unchanged exported scores proves that all original internal GA behavior has been reproduced.

Reproduce the audit with:

```bash
.venv/bin/python scripts/audit_enac.py > docs/output/artifacts/enac-audit.json
.venv/bin/python scripts/audit_solver.py --enac > docs/output/artifacts/solver-enac-audit.json
```

Node.js is required. The exhaustive ENAC audit requires the optional Zenodo files; it does not download them automatically. Detailed results are stored in [enac-audit.json](docs/output/artifacts/enac-audit.json) and [solver-enac-audit.json](docs/output/artifacts/solver-enac-audit.json). The initial generic-model results are retained in [solver-audit.json](docs/output/artifacts/solver-audit.json).

The tests compare the extended browser physics with the archived original JavaScript, compare Python and JavaScript evaluation, exercise the genetic solvers, and cover regression cases. Selenium UI tests additionally require Firefox; a skipped test is not a successful UI check.

Latest local validation: **142 tests passed, zero skipped** (108 model/export tests, 7 HTTP tests and 27 Firefox UI tests). This includes all five methods on the two toy scenarios, continuous Python geometry checks, independent SciPy/HiGHS confirmation of the catalogue optima, original GA/annealing trace fingerprints, JSON/CSV downloads, keyboard tabs, playback, 2D/3D interaction and Studio state preservation. The HTTP/UI regression run also verifies the direct page, inert application name and document scrolling over the radar and sidebar. See the [direct-page verification summary](docs/output/artifacts/direct-page-verification-2026-11-09.json) and the [five-method verification report](docs/output/artifacts/five-methods-verification-2026-11-09/README.md). Run the UI suite alone with `.venv/bin/python -m pytest tests/test_web_ui.py -v -ra`. Browser startup failures are errors when Firefox is installed. Historical separation-zone checks remain in [the regression report](docs/output/artifacts/separation-zone-tests.txt) and [UI checks](docs/output/artifacts/separation-zone-ui-final.txt).

## Provenance and limits

The unchanged original page and assets are in `vendor/nextqcm/`; the adapted application is in `src/artimation/web/`. See [the Vector architecture notes](docs/NEXTQCM_ANALYSIS.md).

The papers consulted do not specify the exact configuration of the ARTIMATION solver. Local fitness weights, GA operators and altitude behavior are modeling choices. BlackBox and HeatMap are adaptations; the papers' Storyboard is absent. The GA offers no guarantee of global optimality or successful resolution for every scenario. FL360 is the route loader's default; the trajectory text files do not encode altitude. Instantaneous turns, deterministic trajectories and simplified speed control are modeling choices.

Dataset licensing is CC BY 4.0. The archived Vector code has no explicit license identified in this audit; clarify redistribution permission with its author before publishing it.
