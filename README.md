# Artimation Visu

## Run
Mac/Linux :

```bash
git clone https://github.com/emilien3/artimation-visu.git
cd artimation-visu
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
.venv/bin/python app.py
```

Windows :
```
git clone https://github.com/emilien3/artimation-visu.git
cd artimation-visu
python -m venv .venv
.venv\Scripts\pip install -r requirements.txt
.venv\Scripts\python app.py
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

Existing files are never overwritten.

Every method writes the same format (schema version 3): the same JSON keys and the same 37 CSV columns.

- `solution_candidate_id` is the result to use: the best proposal for the genetic algorithm and annealing, the proven assignment for MILP, the executed flight for ORCA and MPC. `best_candidate_id` is the highest fitness among all records and can be a forecast.
- `commands` has one entry per straight leg flown (`start_s`, `end_s`, `heading_deg`, `speed_kt`, `vertical_rate_ft_min`), identical for every method. `method_commands` keeps each method's own instructions.
- `method` always has `kind`, `time_s`, `objective` and `termination`. `model.step` and `model.objective` say what the step counter and the objective mean for that method.
- `gene` is empty for ORCA and MPC, which do not use genes. Files written before this version (schema 1 or 2) have fewer fields.

Formulas are in [FORMULAS_EXPLAINED.md](docs/FORMULAS_EXPLAINED.md).

## Tests

```bash
.venv/bin/python -m pytest
```

The UI tests (Selenium) need Firefox. Reports from past runs are in `docs/output/artifacts/`.

## Documentation

- [Formulas explained](docs/FORMULAS_EXPLAINED.md) · [PDF](docs/output/pdf/artimation_visu_formulas_guide_en.pdf), rebuilt with `pdflatex` from the `.tex` file next to it
- [Presentation, formulas spread over 4 slides](docs/output/artimation_visu_demo_en_formulas_light.pptx)
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
