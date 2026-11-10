# Artimation Visu: architecture and integration of the NextQCM Vector studio

Source: Christophe Hurter's [ENAC NextQCM page](https://recherche.enac.fr/~hurter/NextQCM/), archived unchanged under `vendor/nextqcm/`. The current application extends that archived version, rather than verifying against the current live website.

## Original tool

Vector places up to 100 aircraft in a 120 × 90 NM area. It provides position, speed and heading editing; playback; closest-approach analysis; safe heading intervals; and a configurable trajectory-density map.

The coordinate system uses x to the right and y downward, headings clockwise from north, speed in knots and prediction time in minutes. Aircraft move at constant velocity, with instantaneous turns and no altitude in the original model.

| Original module | Role |
|---|---|
| `physics_siQw.js` | Analytic closest approach and route intersection. Safe heading intervals are bounded by tangencies and horizon contacts. |
| `density_siQw.js` | Samples reachable map cells, classifies headings, accumulates safe/unsafe contributions and applies Gaussian smoothing and lighting. |
| `density-view_siQw.js` | Density UI, worker scheduling and main-thread fallback. |
| `app_siQw.js` | Application state, SVG rendering, interaction and playback. |

## Local extension

| File under `src/artimation/web/` | Role |
|---|---|
| `physics.js`, `density.js`, `density-view.js` | Adapted Vector physics and density with vertical separation. |
| `model.js` | Waypoint routes, timed heading/level maneuvers and continuous trajectory evaluation. |
| `ga.js` | Genetic search and accumulation of explored trajectories. |
| `view3d.js` | Canvas orthographic projection, orbit/zoom, aircraft selection and movement. |
| `app.js`, `index.html`, `charts.js`, CSS | English UI, scenarios, solution controls, charts and 2D/3D coordination. |

`webapp.py` embeds all code and scenario data into one offline HTML file. `app.py` hosts it in Streamlit and exposes the download. Python `conflict.py`, `ga.py` and `vector.py` provide comparison implementations.

The heading-density map and genetic heatmap answer different questions. Heading density considers changing one aircraft's current heading while other vectors remain fixed. The genetic heatmap aggregates joint, time-dependent maneuver candidates. A green trace from one candidate cannot be freely combined with green traces from others.

The heading-space calculation is analytic in the original horizontal setting. The altitude extension samples headings at 0.05° when vertical separation is only relevant over a partial time window; calling the entire extended density model “exact” would be misleading.

See [the scientific audit](AUDIT_SCIENTIFIQUE.md) for measured parity and [the ENAC reconstruction audit](ENAC_RECONSTRUCTION.md) for the resolved trajectory discrepancies, export-counter behavior and remaining limits. Agreement with the archived Vector JavaScript is established only for the regression cases actually tested, not for all possible inputs.
