# Five-method verification, 9 November 2026

The active application sources, interface and documentation use English. The Studio and Trajectory Explorer have persistent keyboard-accessible tabs. Detailed controls are collapsed by default. The standalone HTML includes all five methods and works offline.

## Checks

- 108 model, search and export tests passed across the non-UI runs, with no skips. The final 22-test planning suite passed after the last metadata and CSV changes.
- All 25 Firefox UI tests passed on the final method and export logic, with no skips or JavaScript errors (115.80 seconds).
- The Streamlit application smoke test passed.
- Desktop and small-screen inspection confirmed visible tabs, preserved Studio state and no horizontal overflow. Expanded small-screen search settings stayed inside the viewport.
- The seven-slide English PPTX was imported, rendered and inspected. Package, font, geometry and editable-table validation reported zero errors and warnings. Native PowerPoint rendering was not exercised.

Commands:

```sh
.venv/bin/python -m pytest --ignore=tests/test_web_ui.py
.venv/bin/python -m pytest tests/test_planning.py -q
.venv/bin/python -m pytest tests/test_web_ui.py -q --maxfail=5
node scripts/export_exploration.cjs --methods orca,mpc,milp --out NEW_DIRECTORY
```

The exporter completed all six new method/scenario runs. Existing files are not overwritten. `--methods all` additionally includes GA and simulated annealing; omitting the option retains the original four-run default.

## Independent numerical evidence

All 9,520 original seed-0 GA/annealing proposals retained their genes, fitness, separation, conflict duration, extra distance, maneuver counts, labels and run identifiers. Python independently evaluated the new complete paths using continuous piecewise-linear geometry. SciPy/HiGHS independently confirmed both default MILP catalogue optimum values using Python-reconstructed incompatibilities and costs.

| Scenario | ORCA minimum separation | MPC minimum separation | MILP minimum separation |
|---|---:|---:|---:|
| Two-aircraft crossing | 7.000010 NM | 7.576437 NM | 7.367268 NM |
| Four-aircraft convergence | 7.000010 NM | 7.153129 NM | 7.153129 NM |

All six default complete results have zero conflict duration. These are demonstrations on two scenarios, not universal guarantees or a controlled ranking of the methods. ORCA can vary speed up to 360 kt. The other methods retain 360 kt. All displayed examples remain at FL360.

## Trace semantics and limits

GA and annealing retain their version 1 exports. New methods use version 2, with method metadata, commands, full timed paths and a separate solution identifier. Controller forecasts and actual executions remain distinct. The Result button selects the executed ORCA/MPC flight, rather than the highest-fitness hypothetical forecast. A failed run without an actual solution has a null solution identifier.

MILP selects one trajectory per aircraft from a finite catalogue. Its exact branch-and-bound certificate applies only to that catalogue. MPC repeatedly solves a catalogue problem, applies the first 20 seconds and replans over a 400-second prediction horizon. Its trace stores selected forecasts and actual execution; it does not store every alternative considered inside its internal MILP solver. Standard ORCA uses local reciprocal velocity constraints and does not model aircraft acceleration limits.

Version 2 CSV files retain 37 columns. `commands_json` contains only the relevant aircraft's commands on knot index 0; subsequent point rows leave that field empty. The JSON retains the full joint command list. Tests reconstruct commands losslessly from the CSVs.
