# Artimation Visu

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
- **Five methods:** genetic algorithm, simulated annealing, ORCA, MPC and MILP.

The separation cylinder is 7 NM horizontally and 1,000 ft vertically. A conflict requires both limits to be violated.

## Datasets

```bash
node scripts/export_exploration.cjs                       # GA and annealing
node scripts/export_exploration.cjs --methods all --out docs/output/artifacts/five-methods
```

Existing files are never overwritten. Formulas are in [FORMULAS_EXPLAINED.md](docs/FORMULAS_EXPLAINED.md).

## Tests

```bash
.venv/bin/python -m pytest
```

The UI tests (Selenium) need Firefox. Reports from past runs are in `docs/output/artifacts/`.

## Documentation

- [Formulas explained](docs/FORMULAS_EXPLAINED.md) · [PDF](docs/output/pdf/artimation_visu_formulas_guide_en.pdf)
- [Presentation, 7 slides](docs/output/artimation_visu_demo_en_formulas.pptx) · [same deck with the formulas spread over 4 slides](docs/output/artimation_visu_demo_en_formulas_light.pptx)
- [Audit: sources, comparison with the papers, ENAC validation, architecture](docs/AUDIT.md)

## Layout

| Path | Content |
|---|---|
| `app.py`, `src/artimation/server.py` | Local web server |
| `src/artimation/web/` | The application (HTML, JS solvers, views) |
| `src/artimation/*.py` | Python reference model, used to cross-check the JS |
| `data/scenarios/` | Ten ENAC scenarios adapted from 2016 traffic |
| `scripts/` | Dataset export and audits |
| `docs/output/` | Presentations, PDF and audit artifacts |
