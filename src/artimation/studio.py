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


def aircraft_at(scn, t):
    """Avions du scénario à l'instant t (secondes), dans le repère de l'outil, vitesse en kt et cap horaire depuis le nord."""
    to_vec, out = scenario_frame(scn), []
    for i, r in enumerate(scn.routes):
        if not (r.t[0] <= t <= r.t[-1]):
            continue
        k = r.leg(t)
        dx, dy = r.xy[k + 1] - r.xy[k]
        speed = hypot(dx, dy) / (r.t[k + 1] - r.t[k]) * 3600
        x, y = to_vec(*r.position(t))
        out.append(Ac(f"AC{i + 1:03d}", float(x), float(y), round(float(speed), 1), round(degrees(atan2(dx, dy)) % 360, 2)))
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
