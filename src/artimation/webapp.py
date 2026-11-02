"""Assemble l'application web autonome (HTML/JS/CSS en ligne) : outil Vector de l'ENAC étendu (altitude, GA, HeatMap, 3D)."""
import json
from pathlib import Path

import numpy as np

from .conflict import Scenario, list_scenarios

WEB = Path(__file__).resolve().parent / "web"
W, H = 120.0, 90.0  # zone de l'outil, en NM


def to_vector_frame(scn):
    """Scénario (y vers le nord) -> routes dans le repère de l'outil (y vers le bas), centrées dans 120 × 90 NM.

    Isométrie (translation + symétrie) : distances, caps relatifs et conflits sont conservés ; l'angle de virage « à gauche » reste à gauche.
    """
    pts = np.vstack([r.xy for r in scn.routes])
    cx, cy = (pts.min(0) + pts.max(0)) / 2
    if np.ptp(pts[:, 0]) > W or np.ptp(pts[:, 1]) > H:
        raise ValueError("Scénario plus grand que la zone de l'outil (120 × 90 NM)")
    return [dict(xy=[[float(x - cx + W / 2), float(-(y - cy) + H / 2)] for x, y in r.xy], t=r.t.tolist(), z=r.z.tolist()) for r in scn.routes]


ORDER = ["physics.js", "density.js", "density-view.js", "model.js", "ga.js", "view3d.js", "charts.js", "app.js"]


def scenarios_payload():
    """Les 10 scénarios réels d'ARTIMATION (repère de l'outil) + la solution de l'algorithme original de l'ENAC si elle est téléchargée."""
    from . import zenodo

    out = []
    for scn in list_scenarios():
        k = int("".join(c for c in scn.name if c.isdigit()))
        item = dict(key=scn.name, label=f"Scénario réel {k} ({scn.n} avions)", ids=list(scn.ids), routes=to_vector_frame(scn))
        best = zenodo.best_solution(k)
        if best is not None:
            item["enac"] = [[float(t1), float(t2), float(a), 0.0] for t1, t2, a in best]
        out.append(item)
    return out


def build_html():
    """Page unique, autonome (CSS, JS et données en ligne) : fonctionne hors ligne, dans un iframe ou ouverte directement."""
    html = (WEB / "index.html").read_text(encoding="utf-8")
    style = (WEB / "style.css").read_text(encoding="utf-8") + (WEB / "extra.css").read_text(encoding="utf-8")
    scripts = "".join(f"<script>{(WEB / f).read_text(encoding='utf-8')}</script>" for f in ORDER)
    data = "window.__DATA__=" + json.dumps(dict(scenarios=scenarios_payload())).replace("</", "<\\/") + ";"
    return html.replace("{{STYLE}}", style).replace("{{DATA}}", data).replace("{{SCRIPTS}}", scripts)
