# ENAC trajectory reconstruction and cumulative-counter audit

Date: 5 November 2026. This follow-up supersedes the unresolved distance discrepancy in the initial [scientific audit](AUDIT_SCIENTIFIQUE.md).

## Result and scope

The reconstructed model reproduces all **151,500 joint candidates** in the default `sols1-1.csv` through `sols10-1.csv`, including repeated entries. The previous **9,992 classification disagreements at 7 NM become zero**. Maximum absolute minimum-distance error is **0.000001113 NM** (about 2.1 mm), consistent with CSV coordinates and distances rounded to six decimal places. This precision describes agreement between deterministic models, not real aircraft-position accuracy.

All **414,100 individual exported polylines** have the correct number of points. Maximum point-position error is **0.000001416 NM**. Independent replay of the CSV polylines also produces zero classification disagreements; its maximum distance error is 0.000001527 NM.

Sources: [ENAC scenario data](https://zenodo.org/records/7437564) and [ENAC solution data](https://zenodo.org/records/7437654), by Nicolas Durand, Augustin Degas and Christophe Hurter. The solution record attributes the GA to Nicolas Durand. Archive MD5: `e0997d1839f8c9ce80dc7099be32bbd7`. The report records individual CSV SHA-256 hashes. Other archive variants are not included in these fidelity claims.

These are reconstructions from published outputs, not inspection of the original solver source. Repeated candidates are not independent validation samples, and the same corpus informed and checked the reconstruction.

## Where the 9,992 disagreements came from

The old importer loaded `(t1, t2, alpha)` but ignored the exported `traj` geometry. Reapplying those genes with the generic multi-waypoint model produced different paths and timings. The analytic closest-approach calculation itself was not the cause.

| Scenario | Previous model | Constant speed | Snapshot, without pruning | Full reconstruction |
|---|---:|---:|---:|---:|
| 1 | 0 | 0 | 0 | 0 |
| 2 | 2,052 | 2,051 | 2,051 | 0 |
| 3 | 819 | 817 | 817 | 0 |
| 4 | 76 | 75 | 75 | 0 |
| 5 | 56 | 56 | 56 | 0 |
| 6 | 2,887 | 2,753 | 2,753 | 0 |
| 7 | 1 | 0 | 0 | 0 |
| 8 | 438 | 270 | 270 | 0 |
| 9 | 3,663 | 3,653 | 3,653 | 0 |
| 10 | 0 | 0 | 0 | 0 |
| **Total** | **9,992** | **9,675** | **9,675** | **0** |

This is an ordered ablation, not an additive attribution of independent causes. Previously, 614 candidates were classified safe locally but unsafe in the reference; 9,378 had the opposite disagreement.

The recovered horizontal model is:

1. Compute each aircraft's speed from the first segment of the scenario file, retaining full floating-point precision. Retime the original waypoint polyline at this constant speed. The original file's later segment speeds must not be reused.
2. Start displayed trajectories at the exported snapshot. Its position is advanced by a common per-scenario offset, approximately 1.31–5.73 seconds. The checked-in `data/scenarios/enac-starts.json` contains these 27 exported positions. Genes retain the original scenario clock; playback starts at zero at the snapshot.
3. For an active maneuver, locate the turn point `p` at `t1` on the retimed original polyline. Use its outgoing segment direction, rotate by `alpha`, and fly at the constant speed for `t2 - t1` to obtain `q`.
4. Starting at snapshot `o`, retain `p` only if the angle between rays `o→p` and `o→q` is at least **2.5°**. Then retain `q` only if the angle from the last retained point towards `q` and towards the final waypoint is at least **2.5°**. Finish at the final waypoint. This compares rays from the last retained point, not the heading change at the candidate vertex.
5. Retime the retained polyline by cumulative arc length divided by the initial speed. Removed vertices also remove their commanded timing constraints. An idle or fully pruned maneuver flies directly from the snapshot to the final waypoint.

The exported point counts are 130,408 two-point paths, 796 three-point paths and 282,896 four-point paths. Nonzero genes can therefore produce no physical turn. The snapshot offset matters for clock alignment and replay, but changing it alone did not change the safety classifications in this corpus.

At exact waypoint times, retiming can introduce floating-point errors of a few ulps. Both implementations select the outgoing segment with a 1e-9-second boundary tolerance. This is a time-boundary correction, not a relaxed separation threshold.

## Why conflict durations accumulate

The `conflits` column is not always the duration of the trajectory in that row. Each repeated export adds another copy of that candidate's per-aircraft conflict duration. The count includes both population exports (`sols...`) and best-candidate exports (`sol...`). Within each generation, the population is written before the best candidate. Repeated IDs within the same generation count as separate writes.

For a population row, the multiplier is:

```text
population occurrences of (candidate ID, aircraft) up to this row
+ best-file occurrences of that ID and aircraft in earlier generations
```

For a best-file row, it is:

```text
population occurrences through the current generation
+ best-file occurrences through this best-file row
```

The resulting integer multiples explain **every population and best-file counter** within the propagated uncertainty of six-decimal CSV rounding. Maximum residuals against the first exported counter multiplied by the write count are 5e-6 seconds for population rows and 2e-6 seconds for best rows. The population contains 13,432 aircraft rows whose raw counter differs from independently replayed duration by more than 1 ms.

Example: scenario 10, candidate 90. Its true joint conflict duration is approximately 183.426958 s. The first population export records 183.426955 s, the best-file export records 366.853909 s, and the next population export records 550.280863 s. Its fitness remains **0.001423**. These are pair-summed durations, obtained by dividing the sum of aircraft counters by two; each conflicting pair appears in two aircraft counters.

After dividing by the full write count, replayed rounded geometry agrees within approximately **1.56 ms**. Sixteen individual rows exceed 1 ms. This residual is consistent with tiny coordinate rounding errors being amplified near tangent pairwise crossings. Counter-to-counter arithmetic itself agrees at the CSV rounding limit; there is no remaining unexplained multiplicity in these files.

The application does not consume these cumulative counters as physical durations. It recomputes conflict duration analytically from trajectories. The audit preserves the source CSVs and reports raw and normalized values separately.

## Does this change the original fitness?

**There is no observed effect on the recorded fitness in this corpus.**

- 16,794 candidate IDs recur in the population files.
- 3,705 IDs have changing conflict counters, while retaining identical genes and trajectories.
- No ID changes fitness in either the population or best files.
- Identical complete genotypes also retain identical fitness when they occur under different IDs.
- The fitness split at 0.5 agrees with the 7 NM safety classification for all 151,500 records.

These observations strongly support an accumulation associated with export or reporting, rather than a penalty reapplied to the exported fitness. They do **not** prove that the mutable counters never affect internal selection or genetic operators. That would require the original implementation and its export call sites. No such source code is contained in the inspected solution archive.

An additional reconstruction matches all **100,572 conflict-free fitness values** within their 0.5e-6 rounding interval:

```text
fitness_safe = 0.5 + 1 / (4 + M) + 1 / (4 + T)
```

Here `M` is the number of nonzero horizontal angle genes, including ones whose turns are later pruned. `T` is the sum of the aircraft's reconstructed arrival times on the original scenario clock: replay duration plus snapshot offset for each aircraft. This is an empirical formula verified against the default corpus, not an author-confirmed specification.

The score formula for the remaining **50,928 conflicting records** has not been established. Simple proportional penalties based on either raw or normalized `conflits` do not reproduce it. The application therefore retains its explicitly labeled **Local fitness**, with strict priority for conflict-free solutions. It does not silently substitute a partially recovered original objective.

## Application corrections

- Bundled ENAC scenarios now use the reconstructed horizontal model in both Python and JavaScript. Python opts in with `list_scenarios(enac=True)`; the browser uses that mode automatically for these ten scenarios. `list_scenarios()` retains the generic model for comparisons, and free situations keep their general waypoint behavior.
- Scenario serialization, altitude changes, web payloads, plotting, playback, heatmaps and evaluation preserve the ENAC metadata.
- Instructions use actual retained turn times. Fully pruned genes no longer display nonexistent turns or incur a local maneuver cost; added distance is measured against the matching direct baseline.
- Search angles include the observed **−40° and +40°** endpoints, previously missing from the GA search space.
- GA and manual start bounds exclude commands before the snapshot. Past commands are inactive. An immediate command starts at the snapshot without a backward or microscopic extra segment.
- The local altitude extension converts gene times to the playback clock; samples before the snapshot are excluded. This extension is not part of the original horizontal dataset.
- CSV trajectory parsing validates finite coordinates and rejects malformed content without executing it.
- The interface distinguishes local fitness from the original GA's score.

The original final solution for scenario 10 remains **unsafe at 7 NM**: its reconstructed minimum distance is **6.39974456 NM**, matching the CSV's 6.399745 NM. The reconstruction corrects agreement; it does not relabel that reference as a successful resolution.

## Reproduction and remaining limits

```bash
.venv/bin/python -m pytest -q
.venv/bin/python scripts/audit_enac.py > artifacts/enac-audit.json
.venv/bin/python scripts/audit_solver.py --enac > artifacts/solver-enac-audit.json
```

Node.js and the optional downloaded Zenodo solution archive are required for the exhaustive audits. The tests include small attributed fixtures and run without that download. `audit_enac.py` checks complete geometry, ordered model ablations, export-counter arithmetic, repeated-ID and genotype fitness consistency, and the inferred safe-score formula. `solver-enac-audit.json` records 60 searches, using ten scenarios, seeds 0/1/2, with and without altitude changes, population 60 and 60 generations. Each returned browser solution is independently evaluated in Python.

Final checks, updated after Firefox validation: **88 tests passed, zero skipped, in 81.90 seconds**, including all **13 Firefox/Selenium UI cases**. The UI suite checks playback/reset, 2D placement and dragging, vector steering, field validation, keyboard movement and retained focus, ENAC loading, GA resolution and heatmap controls, vertical separation, three 3D axes with dragging/orbit/placement/playback, layers, backgrounds, manual maneuvers and safe headings. An installed browser or driver that fails to launch now fails setup instead of silently skipping the suite.

Validation environment: macOS, Firefox **159.0.1**, geckodriver **0.37.1**, Selenium **4.52.0**, Python **3.14.7** and pytest **9.2.0**. Firefox and geckodriver were already present when this follow-up began; no replacement installation was needed. Run only the UI cases with `.venv/bin/python -m pytest tests/test_web_ui.py -v -ra`. Tests launch a separate headless browser with a temporary profile and a generated offline HTML page.

All **60/60 reconstructed-model searches** also found a conflict-free solution in the earlier numerical audit. Browser spot checks additionally confirmed scenario 10's unsafe reference and its successful local resolution. See the latest [test output](../artifacts/test-results.txt), [JUnit results](../artifacts/test-results.xml), [UI-only results](../artifacts/ui-tests.xml) and [browser screenshot](../artifacts/enac-reconstruction-ui.png). Passing these regression cases does not establish correctness for every possible interaction or browser.

The original fitness for conflicting candidates, selection/crossover/mutation details, and effects of reporting on internal solver state remain unverified. The model is deterministic, uses instantaneous turns and has no uncertainty or wind model. Agreement with this small research corpus does not establish operational suitability or global optimization guarantees.
