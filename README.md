# Artimation Visu

Teaching prototype for aircraft conflict resolution. It extends Christophe Hurter's ENAC [Vector](https://recherche.enac.fr/~hurter/NextQCM/) crossing studio with altitude maneuvers, a genetic solver, explored-trajectory heatmaps and a 3D view.

Inspired by Hurter et al. ([2022](https://doi.org/10.1016/j.trpro.2022.12.027), [2024](https://doi.org/10.5220/0012471900003636)) and the SESAR [ARTIMATION](https://www.sesarju.eu/projects/artimation) project. It does **not** contain Nicolas Durand's original solver and does not reproduce the user studies.

## Run

```bash
git clone https://github.com/emilien3/artimation-visu.git
cd artimation-visu
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
.venv/bin/python app.py
```

Open http://localhost:8501. Use `--port 8502` if the port is taken. Node.js is required for the tests and the dataset export.

## What it does

- **Studio:** place and drag aircraft, edit heading, speed and altitude, play the situation, and inspect encounters. Run the genetic solver to get a conflict-free solution with controller instructions, 2D and 3D views, and a heatmap of the explored trajectories.
- **Trajectory Explorer:** two- and four-aircraft toy scenarios (all at FL360, 7 NM separation). Browse every recorded joint plan, inspect each aircraft's safe and conflicting paths, and export JSON and labeled CSV datasets.
- **Five methods:** genetic algorithm, simulated annealing, ORCA, MPC and MILP. They are demonstrations, not a controlled performance ranking.

The separation cylinder is 7 NM horizontally and 1,000 ft vertically. A conflict requires both limits to be violated.

## Datasets

```bash
node scripts/export_exploration.cjs                       # GA and annealing
node scripts/export_exploration.cjs --methods all --out docs/output/artifacts/five-methods
```

Existing files are never overwritten. Schema and formulas are in [STARTUP_DEMO.md](docs/STARTUP_DEMO.md).

## Tests

```bash
.venv/bin/python -m pytest
```

The UI tests (Selenium) need Firefox. Reports from past runs are in `docs/output/artifacts/`.

## Documentation

- [Demo guide, dataset schema and method formulas](docs/STARTUP_DEMO.md)
- [Formulas explained](docs/FORMULAS_EXPLAINED.md) · [PDF](docs/output/pdf/artimation_visu_formulas_guide_en.pdf)
- [Presentation, 7 slides](docs/output/artimation_visu_demo_en_formulas.pptx)
- [Scientific and technical audit](docs/AUDIT_SCIENTIFIQUE.md)
- [ENAC reconstruction audit](docs/ENAC_RECONSTRUCTION.md)
- [Comparison with the 2022 paper](docs/PAPER_2022_COMPARISON.md)
- [Architecture and the NextQCM source](docs/NEXTQCM_ANALYSIS.md)

## Layout

| Path | Content |
|---|---|
| `app.py`, `src/artimation/server.py` | Local web server |
| `src/artimation/web/` | The application (HTML, JS solvers, views) |
| `src/artimation/*.py` | Python reference model, used to cross-check the JS |
| `vendor/nextqcm/` | Original Vector page, unchanged |
| `data/scenarios/` | Ten ENAC scenarios adapted from 2016 traffic |
| `scripts/` | Dataset export and audits |
| `docs/output/` | Presentations, PDF and audit artifacts |

## Limits and license

The papers do not specify the exact ARTIMATION solver configuration. Fitness weights, GA operators and altitude behavior are modeling choices. The GA gives no guarantee of global optimality, and the papers' Storyboard is absent.

Datasets are CC BY 4.0. The archived Vector code has no explicit license identified in the audit: clarify redistribution permission with its author before reusing it.
