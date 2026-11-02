"""Intègre l'outil ENAC « Vector — Aircraft crossing studio » (HTML + 4 fichiers JS, hors ligne) dans l'app,
et fait le pont entre ses avions et les scénarios ARTIMATION.

Le code d'origine reste intact dans vendor/nextqcm/ ; la page est reconstruite en mémoire avec UN ajout :
`window.VectorStudio.load(avions, séparation)`, qui permet de charger une situation depuis Python.
"""
import json
import re
from math import atan2, degrees, hypot
from pathlib import Path
from urllib.parse import unquote

import numpy as np

from dataclasses import dataclass

from .conflict import state_at
from .vector import Ac

VENDOR = Path(__file__).resolve().parents[2] / "vendor" / "nextqcm"
PAGE = VENDOR / "Vector — Aircraft crossing studio.html"
W, H = 120.0, 90.0  # zone de l'outil, en NM

_LOAD_HOOK = (
    "window.VectorStudio={load(list,sep){setPlaying(false);setPlacing(false);state.aircraft=[];state.nextId=1;state.time=0;"
    "state.focus=null;list.forEach(a=>{const o=newAircraft(a.x,a.y,a.speed,a.heading);o.id=a.id;});"
    "state.selected=state.aircraft[0]?.id??null;if(sep){state.separation=sep;$('separation').value=String(sep);}"
    "$('count').value=state.aircraft.length;render();}};"
    "demo();if(window.__VECTOR_INIT)window.VectorStudio.load(window.__VECTOR_INIT.aircraft,window.__VECTOR_INIT.separation);"
    "updateScale();requestAnimationFrame(tick);"
)
_ORIGINAL_TAIL = "demo();updateScale();requestAnimationFrame(tick);"


def scenario_frame(scn):
    """Translation scénario (y nord) -> repère de l'outil (y vers le bas), scénario centré dans 120 × 90 NM."""
    pts = np.vstack([r.xy for r in scn.routes])
    cx, cy = (pts.min(0) + pts.max(0)) / 2
    if np.ptp(pts[:, 0]) > W or np.ptp(pts[:, 1]) > H:
        raise ValueError("Scénario plus grand que la zone de l'outil (120 × 90 NM)")
    return lambda x, y: (x - cx + W / 2, -(y - cy) + H / 2)


@dataclass(frozen=True)
class Frame:
    """Passage du repère du scénario (y vers le nord) au repère de l'outil Vector (y vers le bas), sans changement d'échelle."""
    x0: float
    y1: float
    width: float
    height: float

    @staticmethod
    def from_scenario(scn, margin=40.0):
        lo, hi = scn.bounds(margin)
        return Frame(float(lo[0]), float(hi[1]), float(hi[0] - lo[0]), float(hi[1] - lo[1]))

    def to_vec(self, x, y):
        return x - self.x0, self.y1 - y

    def to_world(self, xv, yv):
        return xv + self.x0, self.y1 - yv


def aircraft_states(scn, genes, t, frame):
    """Avions en vol à l'instant t sous la solution `genes`, au format Vector : position, cap, vitesse, altitude, taux vertical."""
    out = []
    for i, (r, g) in enumerate(zip(scn.routes, genes)):
        st = state_at(r, g, t)
        if st is None:
            continue
        x, y = frame.to_vec(st[0], st[1])
        out.append(Ac(scn.ids[i], float(x), float(y), round(st[3], 1), round(st[4], 2), round(st[2], 1), round(st[5], 1)))
    return out


def aircraft_at(scn, t):
    """Avions du scénario (sans manœuvre) dans la zone 120 × 90 NM de l'outil d'origine, centrés."""
    to_vec, out = scenario_frame(scn), []
    for i, r in enumerate(scn.routes):
        st = state_at(r, (0, 0, 0, 0), t)
        if st is not None:
            x, y = to_vec(st[0], st[1])
            out.append(Ac(scn.ids[i], float(x), float(y), round(st[3], 1), round(st[4], 2), round(st[2], 1), round(st[5], 1)))
    return out


def build_html(aircraft=None, separation=5):
    """Page autonome (CSS et JS en ligne), prête pour un iframe. `aircraft` : liste d'`Ac` à charger au démarrage."""
    html = PAGE.read_text(encoding="utf-8")

    def asset(match):
        return (VENDOR / unquote(match.group(1))).read_text(encoding="utf-8")

    html = re.sub(r'<link rel="stylesheet" href="([^"]+)">', lambda m: f"<style>{asset(m)}</style>", html)
    scripts = []

    def take_script(m):
        src = asset(m)
        scripts.append(src.replace(_ORIGINAL_TAIL, _LOAD_HOOK) if _ORIGINAL_TAIL in src else src)
        return ""

    html = re.sub(r'<script src="([^"]+)" defer="defer"></script>', take_script, html)
    if len(scripts) != 4:
        raise RuntimeError("Structure inattendue de la page Vector")
    html = html.replace('<option value="10">10 NM</option>', '<option value="7">7 NM</option><option value="10">10 NM</option>', 1)
    init = json.dumps(dict(aircraft=[a.__dict__ for a in aircraft], separation=separation)) if aircraft else "null"
    tail = f"<script>window.__VECTOR_INIT={init};</script>" + "".join(f"<script>{s}</script>" for s in scripts)
    return html.replace("</body>", tail + "</body>", 1)
