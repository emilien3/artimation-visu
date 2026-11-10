# The 2022 ARTIMATION paper versus Vector+

**Implementation follow-up:** adjustable local fitness weights and Gaussian smoothing of the GA heatmap have since been added. The comparison below records the pre-change audit; its missing-Gaussian and fixed-weight findings are historical. Exact original fitness and heatmap parameter fidelity remain unverified. See the README for current controls.

Reviewed: 9 November 2026, against the current working tree. This is a source-code and document comparison, not a new solver or user-study validation.

## Source qualification

The requested publication is Hurter et al., *Usage of more transparent and explainable conflict resolution algorithm: air traffic controller feedback*, Transportation Research Procedia 66 (2022), 270–278, [DOI 10.1016/j.trpro.2022.12.027](https://doi.org/10.1016/j.trpro.2022.12.027). Its [institutional record](https://iris.uniroma1.it/handle/11573/1694351) identifies the attached PDF as the published version. Both that PDF and ScienceDirect returned HTTP 403 during this review; the alternative institutional resolver timed out.

The full text actually inspected is the authors' accessible 2022 manuscript, *Toward a more transparent and explainable conflict resolution algorithm for air traffic controllers*, [Zenodo record and PDF](https://zenodo.org/records/7194009/files/EAAP_Artimation_Final-1.pdf). Its title, placeholder pagination and running headers differ from the published record. References below to sections and pages refer to this manuscript, not asserted final-publication page numbers. Figures 1 and 2 were rendered and visually inspected. Exact manuscript-to-publication equivalence remains unverified.

The manuscript is principally an explanation-design and controller-feedback paper. It describes the GA concept, but does not give a complete executable solver specification. The implementation should be described as **a teaching adaptation of the 2022 ARTIMATION explanation approach, with a locally implemented GA and an ENAC-output-compatible horizontal trajectory model**.

## Genetic algorithm: what is actually reproduced

| Manuscript evidence | Current implementation | Assessment |
|---|---|---|
| Section 1, p. 2: a candidate contains trajectories for all aircraft, some unchanged; turning-point maneuvers modify routes. | `web/ga.js:run`, `ga.py:run_ga`: one joint candidate, one `(t1, t2, alpha, dz)` gene per aircraft; unchanged baseline included. `web/model.js:maneuverPath/enacPath` builds the paths. | Same general representation principle. Exact gene encoding and ENAC simplification come from dataset reconstruction, not this paper's specification. |
| Section 1: population evolution with selection, mutation and crossover; retain good candidates while exploring others. | Tournament size 3, two elites, per-aircraft parent crossover with probability 0.7, per-aircraft mutation probability 0.4, random immigrants probability 0.1. Defaults: population 100, 100 generations. | A real GA, but local operators and settings. The paper does not establish these probabilities or selection mechanics. |
| Section 1: conflict duration is an evaluation criterion. | `conflict.py:evaluate`, `web/model.js:evaluate`: continuous pairwise conflict duration, summed across pairs, plus minimum-separation shortfall; safe solutions rank above conflicting solutions. | Related criterion; pair aggregation, shortfall penalty and exact score are local. The manuscript gives no matching equation. |
| Section 1: trajectory length is an evaluation criterion. | Sum of positive added horizontal distances relative to each baseline. In ENAC mode, the baseline is the direct snapshot-to-destination path. | Adapted objective. Added NM are not total arrival time, and differ from total path length when baselines or clipping matter. |
| Section 1: number of controller orders is an evaluation criterion. | `nMan` counts aircraft with an effective horizontal or vertical maneuver, at most once per aircraft. ENAC pruned turns are excluded. | Not order counting: an aircraft receiving both an initial turn and a return can still contribute only one unit. |
| Horizontal turning-point description and Figures 1–2. | Optional altitude offsets of ±1,000/2,000 ft, 1,500 ft/min ramps, followed by return. `index.html` checks `ga-vertical` by default, although solver-library defaults are false. | Local extension. Uncheck **allow level changes** for a horizontal comparison; otherwise the feasible solution space already differs. |
| Section 1 references Durand & Gotteland (2006). | No original solver source is imported. Python and JavaScript independently implement the local search with different random generators. | Algorithmic lineage, not source-code reproduction. Equal seeds do not imply identical searches. |

### Objective mismatch is substantive

The browser and Python evaluators use:

```text
P = C + 10 * max(0, separation_limit - minimum_equivalent_separation)
      + 0.02 * extra_horizontal_NM
      + 0.05 * maneuvering_aircraft
      + 0.04 * sum_absolute_active_altitude_offsets_ft / 1000

f = (0.5 if safe else 0) + 0.5 / (1 + P)
```

`C` sums durations over aircraft pairs, rather than measuring the union of all conflict intervals. Two pairs conflicting simultaneously for ten seconds contribute twenty seconds. This aggregation is not specified in the manuscript. For altitude-enabled candidates, equivalent separation uses the cylindrical model, not Euclidean 3D distance.

The separate [ENAC audit](ENAC_RECONSTRUCTION.md) empirically recovered the following formula for all 100,572 safe exported candidates:

```text
f_safe = 0.5 + 1 / (4 + M) + 1 / (4 + T)
```

Here `M` counts nonzero angle genes, including pruned maneuvers, and `T` sums reconstructed arrival times on the original scenario clock. This is evidence from the default ENAC corpus, not an equation published in the 2022 manuscript. It is not our production objective. The 50,928 unsafe scores remain unreconstructed. Different ranking objectives can select different solutions even when every candidate's geometry matches.

The existing audit reproduces 151,500 candidate distance classifications with zero disagreements and all 414,100 exported aircraft polylines at CSV precision. This validates the reconstructed mapping **genes → trajectories → separation on that corpus**. It does not validate population evolution, fitness ranking, stopping behavior or the distribution of explored candidates. The same corpus informed the reconstruction; this is not an independent holdout experiment.

The export-counter accumulation likewise does not justify a solver change: repeated candidates retain their recorded fitness as `conflits` increases. Its effect on unobserved internal state remains unknown.

## Visual explanations: feature-by-feature comparison

| Manuscript evidence | Current implementation | Missing or different |
|---|---|---|
| BlackBox, section 2 and Figure 1, p. 3: selected solution with differently colored aircraft trajectories. | `app.js:draw` overlays colored solution polylines; solution selector exposes original, GA, manual and optional ENAC reference paths. | Core presentation is present. There is no dedicated minimal BlackBox presentation mode. |
| BlackBox: controller orders numbered in their execution order and placed on the trajectories. | `model.js:instructions` generates one text item per aircraft in the solution panel. ENAC instructions use retained turn times. | No global chronological order list or numbered on-path command markers. ENAC text gives turn times but does not give the actual heading at each retained turn. |
| BlackBox: minimum aircraft distances displayed spatially in yellow. | Full-route minimum separation is in the metrics, and pair separation curves are available. Encounter overlays use current constant vectors. | No equivalent annotation of the full planned solution's exact closest approach. The current encounter overlay is not a substitute because it ignores future maneuvers. |
| HeatMap, section 2 and Figure 1: selected solution plus accumulated good/bad explored trajectories. | `ga.js:heatLayers` and `app.js:heatPixels`: per-aircraft safe/unsafe path accumulation with green/red display over the solution. | Same broad explanation idea, with different accumulation, classification and rendering semantics detailed below. |
| HeatMap: Gaussian convolution of trajectories to make density contours. | The GA raster is path-length accumulation followed by logarithmic color normalization. | No Gaussian convolution of the GA maps and no equivalent explicit contour extraction. A Gaussian implementation exists for **Heading density**, which is a separate computation. |
| HeatMap: support reasoning about where a turn remains possible. | Static aggregate of explored complete trajectories. | No computed latest-safe command time, no explicit delay margin, and no conditioning of the map on a selected common joint solution. A colored boundary is not a certified delay limit. |
| Storyboard, section 2 and Figure 2, pp. 3–4: ordered snapshots of aircraft states at successive control orders. | Playback, time slider and 3D time axis. | No generated command-based sequence of explanatory panels or captions. Animation alone does not implement this Storyboard. |
| Storyboard: optional alternative with an explanation of its lower efficiency. | Manual/reference/local solutions can be switched and their metrics inspected. | No automatic alternative selection, aligned comparison or explanation of why one ranks lower. |
| Storyboard: limit solution near the separation boundary for delayed implementation. | Manual start/duration sliders can be adjusted and re-evaluated. | No algorithm computes and presents a latest-safe delayed solution. |

### What our GA heatmap means

The relevant path is `GA.run → GA.heatLayers → app.heatPixels → syncHeat/bg3d`. It is distinct from `FlightDensity` in `density.js`.

1. Every newly recorded candidate contributes trajectories. Retained elite IDs are reused without a new record; duplicate genotypes created as new children still contribute again despite the evaluation cache. With default population 100, two elites and 100 generations, there are **9,900 records**, not 10,100 complete population entries. This affects density weighting.
2. An aircraft's whole trajectory is green if its minimum separation from every other aircraft **within that candidate** passes the threshold. A third aircraft may be green while the other two conflict. The manuscript does not fully specify this per-aircraft versus joint classification choice.
3. A path is not colored red only at its actual conflict interval. Its entire path enters the unsafe layer when that aircraft has any conflict in the candidate.
4. Contributions are horizontal path length in NM, sampled at at most 0.5 NM per segment. The browser uses a 160 × 120 grid over 120 × 90 NM and clips outside it. The Python helper chooses scenario bounds and a different sampling grid; it is not a pixel-identical rendering oracle.
5. Safe and unsafe accumulated values are each transformed by `log1p` and normalized by their separate maxima before blending. Red/green strength therefore does not measure a safe-candidate proportion or a calibrated probability.
6. The 2D RGBA raster is not Gaussian-smoothed. A separate signed field receives two 3 × 3 box-average passes for the 3D representation. This is not the manuscript's Gaussian density construction.
7. Time, altitude and candidate identity are collapsed in the 2D map. In altitude-enabled mode, a green path may rely on vertical separation. Green paths from different candidates cannot safely be combined without re-evaluating the joint solution.

The UI already warns against combining green trajectories. That is a useful qualification, but the map still cannot answer precisely *why this candidate outranks that one* or *how long this instruction can be delayed*. Gaussian smoothing alone would not supply either answer.

## Controller feedback: implications for this prototype

Sections 5–6, pp. 7–8, report a preference among the discussed experts for simple proposals under time pressure; dense overlays could obstruct aircraft/pair identification. They also report concern about red being read as an immediate operational alert, and interest in explanation for training, briefing and debriefing. These are reported qualitative findings, not evidence that our interface improves performance.

The prototype partly addresses clutter through per-aircraft map selection, layer toggles and collapsible panels. However, after every GA run `app.js:runGA` automatically selects the heatmap, and the map still uses red/green. There is no explicit simple-result-first versus explanation-on-demand workflow. The most relevant design lesson is therefore not to add every available overlay by default.

No experimental protocol is reproduced: no controlled BB/HM/SB conditions, easy/hard assignment, participant questionnaires or interview analysis. Existing 88 passing tests, including 13 Firefox UI cases, establish prior regression checks, not comprehension, trust or workload outcomes. The manuscript itself contains inconsistent sample descriptions (16 in methods; 9 experts in the reported feedback); do not transfer its participant-level conclusions without checking the final article.

## Prioritized work to approach the described system

| Priority | Concrete change | Acceptance evidence |
|---|---|---|
| 1 | Provide a clearly identified horizontal comparison configuration and keep local fitness explicitly labeled. | Altitude genes are zero, thresholds and seed recorded; reference and local metrics remain distinguishable. |
| 2 | Improve the minimal solution view with actual headings, globally ordered command events and full-trajectory closest-approach annotations. Offer explanations on demand. | Every annotated event lies on the evaluated path and uses the playback clock; closest-approach labels agree with the analytic evaluator. |
| 3 | Implement the GA Gaussian density pipeline with explicit bandwidth, weighting and classification rules. Keep provenance of the contributing candidates. | Small synthetic paths verify accumulation and convolution; UI states units and conditional safety. Exact paper fidelity remains limited by unspecified kernel parameters. |
| 4 | Build a command-based Storyboard, then a distinct alternative comparison and delayed limit-solution analysis. | Snapshot states agree with trajectory evaluation; alternatives are jointly re-evaluated. Any limit is qualified by its search resolution, feasible family and unchanged other commands. Do not assume safety varies monotonically with delay. |
| 5 | Obtain the original solver revision/configuration, including unsafe fitness and operator details. | Match objective values and controlled generation traces, not only final paths. Do not claim solver replication from another local tuning exercise. |

These are proposed changes, not implementations delivered in this comparison. No runtime code was changed. The final published PDF and original solver source remain the main evidence gaps.

## Code and evidence map

Paths below are relative to the repository root; function names remain useful if line numbers move.

- `src/artimation/web/ga.js`: `DEFAULTS`, `randomGene`, `mutate`, `run`, `heatLayers`.
- `src/artimation/ga.py`: `GAConfig`, `_random_gene`, `_mutate`, `run_ga`.
- `src/artimation/web/model.js`: `enacPath`, `verticalProfile`, `pairStats`, `evaluate`, `instructions`.
- `src/artimation/conflict.py`: `evaluate`, `heat_layers`, trajectory and pair-statistics helpers.
- `src/artimation/web/app.js`: `draw`, `heatPixels`, `renderSolutionPanel`, `drawCharts`, `runGA`, `applyBackground`.
- `src/artimation/web/index.html`: `ga-vertical`, `background`, solution and chart panels.
- `src/artimation/web/density.js`: `gaussianKernel`, `convolve`, heading-density pipeline; not the GA heatmap.
- [ENAC numerical evidence](../artifacts/enac-audit.json), [local solver runs](../artifacts/solver-enac-audit.json), [prior test results](../artifacts/test-results.txt).
