"""Assemble the standalone web app (inline HTML/JS/CSS): the extended ENAC Vector tool (altitude, GA, heatmap, 3D)."""
import json
from pathlib import Path

import numpy as np

from .conflict import Scenario, list_scenarios

WEB = Path(__file__).resolve().parent / "web"
W, H = 120.0, 90.0  # tool area, in NM


def to_vector_frame(scn):
    """Convert a scenario (north-positive y) to tool coordinates (downward-positive y), centered in 120 × 90 NM.

    This isometry (translation + reflection) preserves distances, relative headings and conflicts. Left turns remain left turns.
    """
    pts = np.vstack([r.xy for r in scn.routes])
    cx, cy = (pts.min(0) + pts.max(0)) / 2
    if np.ptp(pts[:, 0]) > W or np.ptp(pts[:, 1]) > H:
        raise ValueError("Scenario exceeds the tool area (120 × 90 NM)")
    def point(p):
        return [float(p[0] - cx + W / 2), float(-(p[1] - cy) + H / 2)]
    return [dict(xy=[point(p) for p in r.xy], t=r.t.tolist(), z=r.z.tolist(),
                 enacStart=None if r.enac_start is None else point(r.enac_start)) for r in scn.routes]


ORDER = ["physics.js", "density.js", "density-view.js", "model.js", "ga.js", "annealing.js", "orca.js", "milp.js", "mpc.js", "view3d.js", "charts.js", "app.js", "exploration.js", "exploration-view.js"]


def scenarios_payload():
    """The 10 real ARTIMATION scenarios (tool coordinates), plus the original ENAC solution when downloaded."""
    from . import zenodo

    out = []
    for scn in list_scenarios(enac=True):
        k = int("".join(c for c in scn.name if c.isdigit()))
        item = dict(key=scn.name, label=f"ENAC scenario {k} ({scn.n} aircraft)", ids=list(scn.ids), routes=to_vector_frame(scn))
        best = zenodo.best_solution(k)
        if best is not None:
            item["enac"] = [[float(t1), float(t2), float(a), 0.0] for t1, t2, a in best]
        out.append(item)
    return out


def build_html():
    """One standalone page with inline CSS, JS and data, usable offline or served directly."""
    html = (WEB / "index.html").read_text(encoding="utf-8")
    style = (WEB / "style.css").read_text(encoding="utf-8") + (WEB / "extra.css").read_text(encoding="utf-8")
    scripts = "".join(f"<script>{(WEB / f).read_text(encoding='utf-8')}</script>" for f in ORDER)
    data = "window.__DATA__=" + json.dumps(dict(scenarios=scenarios_payload())).replace("</", "<\\/") + ";"
    return html.replace("{{STYLE}}", style).replace("{{DATA}}", data).replace("{{SCRIPTS}}", scripts)
