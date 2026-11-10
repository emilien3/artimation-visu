# Scientific and technical audit of Artimation Visu

Date: 5 November 2026. Scope: the existing working tree, the original Vector source (since removed from the repository), the supplied 2024 paper, accessible related publications, and the locally available ENAC datasets. Pre-existing uncommitted changes were retained; no commit or publication was made.

**Follow-up:** the distance discrepancies recorded below are now resolved by [ENAC trajectory reconstruction](ENAC_RECONSTRUCTION.md): zero disagreements on all 151,500 candidates. The follow-up also explains cumulative export counters and their lack of observed effect on recorded fitness. The results below are retained as the initial audit baseline.

## Main finding

The project combines two related but distinct systems: Christophe Hurter's interactive **Vector** visualization and a **local adaptation of an ARTIMATION-style genetic conflict solver**. The supplied 2024 paper is directly relevant. Both it and the accessible 2022 manuscript point back to **Durand and Gotteland (2006)** for the algorithmic lineage. Neither inspected article supplies enough implementation detail to establish that this repository reproduces the original solver exactly.

The prototype works on the tested scenarios after the corrections below. Its agreement with the original ENAC data is approximate and should not be presented as full validation of the original algorithm.

## Sources and their relevance

| Source | What it establishes | Inspection status |
|---|---|---|
| Hurter et al., *Examining Decision-Making in Air Traffic Control: Enhancing Transparency and Decision Support Through Machine Learning, Explanation, and Visualization: A Case Study*, ICAART 2024, pp. 622–634, [DOI](https://doi.org/10.5220/0012471900003636), [publisher record](https://www.scitepress.org/PublishedPapers/2024/124719/) | ARTIMATION conflict resolution, GA criteria, BlackBox/HeatMap/Storyboard, user evaluation | Supplied PDF read; relevant figures inspected. HAL ID hal-04739928. |
| Hurter et al., *Usage of more transparent and explainable conflict resolution algorithm: air traffic controller feedback*, Transportation Research Procedia 66 (2022), pp. 270–278, [DOI](https://doi.org/10.1016/j.trpro.2022.12.027) | Earlier ARTIMATION explanation and controller-feedback work | Published metadata located; direct published PDF returned HTTP 403. |
| Accessible 2022 manuscript, *Toward a more transparent and explainable conflict resolution algorithm for air traffic controllers*, [Zenodo PDF](https://zenodo.org/records/7194009/files/EAAP_Artimation_Final-1.pdf) | Earlier description of the same three presentation principles and GA criteria | Downloaded and read. Its title and draft status differ from the published record. |
| Durand & Gotteland, *Genetic Algorithms Applied to Air Traffic Management*, 2006, pp. 277–306, [DOI](https://doi.org/10.1007/3-540-30966-7_10), [author bibliography](https://cv.hal.science/nicolasdurand) | Algorithmic reference explicitly cited by both inspected papers | Identified, not read in full; publisher/HAL retrieval was unsuccessful. |
| Durand, *Algorithmes Génétiques et autres méthodes d’optimisation appliqués à la gestion de trafic aérien*, HDR, 2004 | Source credited for the 50-aircraft evolution figure in the 2024 paper | Identified from that paper, not independently inspected. |
| Degas et al., *A Survey on Artificial Intelligence (AI) and eXplainable AI in Air Traffic Management: Current Trends and Development with Future Research Trajectory*, Applied Sciences 12(3), 1295 (2022), [DOI](https://doi.org/10.3390/app12031295) | Wider AI/XAI background; not the solver specification | Identified in both papers; direct publisher retrieval was rate-limited. |
| [ARTIMATION project](https://www.sesarju.eu/projects/artimation) | Project-level transparency and decision-support context | Official SESAR page consulted. |
| [ENAC scenarios, Zenodo 7437564](https://zenodo.org/records/7437564) | Scenarios adapted from 2016 traffic for validation; includes REJEU exercise and trajectory data | Record consulted; local trajectory files inspected. |
| [ENAC solutions, Zenodo 7437654](https://zenodo.org/records/7437654) | Outputs of a genetic algorithm developed by Nicolas Durand, including candidate trajectories and metrics | Record consulted; all local default candidate files compared. Archive MD5 verified: `e0997d1839f8c9ce80dc7099be32bbd7`. This is a dataset, not the solver source. |
| [Vector / NextQCM](https://recherche.enac.fr/~hurter/NextQCM/) | Visualization source attributed to Christophe Hurter | Local HTML/JS copy inspected and exercised as an oracle during the audit; no longer in the repository. Current live version not verified. |

The 2024 paper describes three visualizations, not just two. The heatmap accumulates explored good/bad trajectories with Gaussian convolution. Storyboard adds temporal steps, alternatives and a limiting solution. The current application provides adapted BlackBox and HeatMap views, but not that Storyboard.

The paper reports 21 participants, but its abstract and methods reverse the expert/student counts (10/11 versus 11/10). The accessible 2022 draft also contains inconsistent sample descriptions: nine controllers in its introduction/conclusion versus sixteen participants in its methods. These details should be checked against final author-approved records before quoting subgroup results. Neither paper establishes that more explanation always improves performance or acceptance.

## Code versus research

| Topic | Repository behavior | Assessment |
|---|---|---|
| Candidate representation | One `(t1, t2, alpha, dz)` gene per aircraft; direct return to final waypoint after the heading maneuver | Horizontal encoding inferred from dataset trajectories. `dz` is a local extension. |
| GA objective | Conflict duration/shortfall, added distance, maneuvering-aircraft count and altitude cost | Broad criteria resemble the papers; exact weights and score are local. Counting maneuvering aircraft is not counting individual controller orders. |
| Genetic operators | Tournament selection, per-aircraft crossover, mutation, elitism, immigrants; defaults 100 × 100 | Local configuration. Candidate row counts alone cannot establish original operators or rates. |
| Timing | Continuous seconds, instantaneous heading changes, fixed speed within each segment | Simplified dynamics. No wind, turn-rate limits or trajectory uncertainty. |
| Altitude | FL360 default, optional original vertical rate, ±1,000/2,000 ft offsets at 1,500 ft/min | Exploratory modeling choice, not a reproduction of the published horizontal experiment. |
| Separation | Piecewise analytic cylinder intersection; default 7 NM / 1,000 ft | Deterministic model criteria, not a universal operational standard. |
| Heatmap | Per-aircraft accumulated path length over sampled candidates, conditioned on their joint maneuvers | Not a complete safe region or probability. Pixel colors use a log scale; the local rendering is not an exact reproduction of the paper's Gaussian contour maps. |
| Heading density | Original Vector's single-heading analysis, extended to altitude | Different from the GA heatmap. Partial vertical windows use 0.05° heading sampling. |
| Python / JavaScript | Matching evaluation formulas, different random generators | Numerical parity on tested inputs does not make the searches identical. |
| Interface | Common 2D/3D scene, playback, manual maneuvers and charts | Useful teaching extension; no replication of the experimental protocol. |

The active application is `app.py` → `webapp.build_html()` → browser code. Despite the repository name, the current app has no running CBR/SHAP/LIME workflow. Historical plans describe an earlier state and should not be mistaken for active requirements.

## Reproduced defects and corrections

1. **A residual conflict could beat a safe candidate.** With two nearly grazing trajectories, the old score gave a 0.0374-second conflict a fitness of 0.9639, versus 0.8352 for a safe detour. Both evaluators now reserve scores above 0.5 for safe solutions and below 0.5 for conflicting ones. Selection, elitism and final ranking inherit this strict priority.
2. **The initial population omitted the unchanged joint scenario.** It now includes that baseline explicitly. An already safe scenario can retain the zero-maneuver solution even with a small population or no evolution.
3. **Short routes starting late could fail or generate invalid maneuver start times.** The old bound `0.9 * end` was earlier than the start for a route spanning 100–105 seconds. Random and mutated times now use a fraction of route duration. The JS finite-window variant returns an idle gene if the aircraft has not entered the window.
4. **Single-aircraft Python evaluation crashed.** Minimum separation now returns infinity when there is no pair, consistently with JavaScript.
5. **Python heatmaps lost repeated contributions to a cell.** NumPy advanced-index `+=` did not accumulate repeated indices. `np.add.at` now preserves all contributions, including a fractional final sample. A 20 NM example previously accumulated only 10 NM.
6. **Invalid genes/configuration could fail obscurely.** Both solvers validate population settings and probabilities; both evaluators require one finite, correctly sized gene per aircraft.
7. **Duplicate candidates were re-evaluated unnecessarily.** Run-local caches reuse deterministic evaluations. All candidate records remain available for heatmaps. A scenario-2 example had 3,540 candidate records but only 3,006 distinct genes, avoiding about 15% of evaluations. Illustrative Python timings were 1.93 seconds before and 1.62 seconds after; these are not controlled performance benchmarks.
8. **The best-fitness chart could appear to regress despite elitism.** Since elites are retained without new evaluation records, the chart now carries forward the best score found so far. Mean and safe share still describe newly recorded candidates, not the complete retained population.
9. **Vertical instructions could announce the return before the target level was reached.** Instructions now match `max(t2, t1 + abs(dz)/25)` and distinguish starting the return from completing it.
10. **Hidden heatmap controls remained visible.** A CSS display rule overrode the HTML hidden attribute on density labels. The override is now explicit, so heading-density smoothing controls are not shown for the GA heatmap.
11. **The interface mixed two prediction assumptions.** Encounter analysis now explicitly states that future maneuvers are excluded; the full-route solution panel includes them. Heatmap interpretation and scenario provenance are also clarified.

The application UI, generated instructions, main documentation and this report are in English. Historical research records remain unchanged.

## Reproducible results

Commands:

```bash
.venv/bin/python -m pytest -q
.venv/bin/python scripts/audit_solver.py > docs/output/artifacts/solver-audit.json
```

The initial suite had **39 passed / 13 skipped**. The final run completed with **54 passed / 13 skipped** in about 30 seconds. The suite includes targeted regression tests in `tests/test_ga_invariants.py` and `tests/ga_invariants.cjs`. Firefox is absent, so the thirteen Selenium tests are skipped; they must not be counted as successful UI validation. Additional interactive browser checks covered scenario loading, horizontal GA, altitude-enabled GA, heatmap display, 3D selection and playback. These spot checks do not replace the full drag/keyboard/Selenium suite.

The audit script runs **10 scenarios × 3 seeds × 2 maneuver modes = 60 searches**, with population 60 and 60 generations. **All 60 produced zero modeled conflict duration and minimum equivalent separation at least 7 NM** (within numerical tolerance), and the Python evaluator checked every returned JS solution. Median elapsed JS subprocess time was about **0.34 seconds**, including Node startup and serialization but excluding heatmap construction and rendering.

### Comparison with original ENAC candidate records

The audit compares local continuous minimum separation with each CSV's `dmin`, not with its fitness. It includes all default `solsN-1.csv` records, including repetitions. These are not independent random samples.

| Scenario | Records | Correlation | Median absolute error (NM) | 95th percentile error (NM) | Different classifications at 7 NM |
|---|---:|---:|---:|---:|---:|
| 1 | 10,100 | 0.99982 | 0.0048 | 0.0112 | 0 |
| 2 | 10,100 | 0.99267 | 0.1011 | 0.5696 | 2,052 |
| 3 | 10,100 | 0.99765 | 0.0306 | 0.4740 | 819 |
| 4 | 10,100 | 0.99899 | <0.000001 | 0.1106 | 76 |
| 5 | 10,100 | 0.99985 | <0.000001 | 0.0498 | 56 |
| 6 | 20,200 | 0.94069 | 0.0237 | 1.4232 | 2,887 |
| 7 | 20,200 | 0.99989 | <0.000001 | 0.0106 | 1 |
| 8 | 20,200 | 0.99543 | 0.0463 | 0.2096 | 438 |
| 9 | 20,200 | 0.99366 | 0.0549 | 0.3109 | 3,663 |
| 10 | 20,200 | 0.99901 | 0.2178 | 0.2567 | 0 |

Total: **151,500 records and 9,992 classification disagreements**. The maximum observed absolute discrepancy was **3.371 NM** in scenario 6. This corrects the earlier README's blanket correlation claim of 0.99–0.9999.

The final ENAC reference solutions for scenarios 2, 3 and 9 report just over 7 NM in their CSVs but evaluate locally at approximately **6.9074, 6.9433 and 6.9485 NM**. Scenario 10's reference already reports **6.399745 NM** in the original CSV, and evaluates locally at **6.1430 NM**. The corresponding files under `Set7NM` have the same final values; the folder name is not a safety certificate.

At this initial stage the cause was unresolved. The subsequent [reconstruction audit](ENAC_RECONSTRUCTION.md) identified constant-speed retiming, the exported snapshot, and 2.5° angular pruning. It reproduces both full geometry and minimum distance without changing the 7 NM threshold. The earlier time-discretization hypothesis was not needed. The browser now evaluates ENAC scenarios using that reconstructed model.

Machine-readable details: [solver-audit.json](output/artifacts/solver-audit.json). The script records runtime versions, configuration, best genes, outcome metrics and comparison statistics; it does not download missing datasets.

## Next checks with the authors

The most useful next material would be the exact solver revision and configuration used to generate Zenodo 7437654, its conflict/distance sampling conventions, the distinction between dataset variants, and the intended status of scenario 10's sub-7-NM reference. Clarifying these would support a faithful reconstruction rather than further tuning by guesswork.

For this toy project, the remaining priorities are reproducible UI checks with Firefox, assessing more seeds and harder traffic configurations, and deciding whether to implement the actual Storyboard or Gaussian heatmap treatment. No new simulator, optimization framework or user study was added during this audit.
