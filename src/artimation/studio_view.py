"""Fenêtre de visualisation commune du studio : MÊMES couches en 2D et en 3D, seule la projection change.

Couches : fond (HeatMap du GA | densité exacte Vector | aucun), routes d'origine, solution, avions + vecteurs à l'instant t,
zones de séparation. En 3D, l'axe vertical est l'altitude, le temps, ou la densité (relief).
"""
from dataclasses import dataclass, field

import numpy as np
import plotly.graph_objects as go

from .conflict import path_samples

AC_COLORS = ["#1f77b4", "#ff7f0e", "#9467bd", "#17becf", "#bcbd22", "#e377c2", "#7f7f7f", "#8c564b"]
DENS_SCALE = [[0, "rgb(255,55,65)"], [0.35, "rgb(255,166,129)"], [0.5, "rgb(54,54,54)"], [0.65, "rgb(47,146,120)"], [1, "rgb(47,245,210)"]]
DENS_SCALE_2D = [[0, "rgba(255,55,65,0.9)"], [0.35, "rgba(255,166,129,0.6)"], [0.5, "rgba(54,54,54,0.1)"], [0.65, "rgba(47,146,120,0.6)"], [1, "rgba(47,245,210,0.9)"]]
RED, GREEN = "214,39,40", "44,160,44"


@dataclass
class ViewData:
    scn: object
    genes: np.ndarray  # solution affichée (A, 4)
    t: float  # instant courant (s)
    states: list  # [(id, x, y, z_ft, vitesse_kt, cap, vz)] à l'instant t, repère du scénario (y vers le nord)
    sep: float
    sep_v: float
    background: str = "none"  # "none" | "heat" | "density"
    heat: dict = None  # sortie de conflict.heat_layers
    heat_sel: object = slice(None)  # avions pris en compte dans la HeatMap
    density: dict = None  # sortie de vector.density_maps3d, repère Vector
    frame: object = None  # studio.Frame
    layers: set = field(default_factory=lambda: {"routes", "solution", "aircraft", "zones"})


# --- fonds ---------------------------------------------------------------------------------------------------------
def _heat_arrays(vd):
    H = vd.heat
    lo = H["lo"]
    xs = lo[0] + H["cell"] * (np.arange(H["safe"].shape[2]) + 0.5)
    ys = lo[1] + H["cell"] * (np.arange(H["safe"].shape[1]) + 0.5)
    return xs, ys, H["safe"][vd.heat_sel].sum(0), H["unsafe"][vd.heat_sel].sum(0)


def _density_arrays(vd):
    """(xs, ys, positif, négatif) en repère du scénario, y croissant (la carte Vector a y vers le bas : on la retourne)."""
    d, f = vd.density, vd.frame
    xs = f.x0 + (np.arange(d["cols"]) + 0.5) * d["width"] / d["cols"]
    ys = f.y1 - (np.arange(d["rows"]) + 0.5) * d["height"] / d["rows"]
    return xs, ys[::-1], d["positive"][::-1], d["negative"][::-1]


def _signed(pos, neg):
    z = np.where(neg > 0, -neg / max(neg.max(), 1e-12), pos / max(pos.max(), 1e-12))
    return np.where((pos == 0) & (neg == 0), np.nan, z)


def _bg_arrays(vd):
    if vd.background == "heat" and vd.heat is not None:
        return _heat_arrays(vd)
    if vd.background == "density" and vd.density is not None:
        return _density_arrays(vd)
    return None


def _bg_traces_2d(vd):
    arr = _bg_arrays(vd)
    if arr is None:
        return []
    xs, ys, pos, neg = arr
    if vd.background == "density":
        return [go.Heatmap(x=xs, y=ys, z=_signed(pos, neg), zmin=-1, zmax=1, zmid=0, showscale=False, hoverinfo="skip", colorscale=DENS_SCALE_2D)]
    out = []
    for m, rgb in ((neg, RED), (pos, GREEN)):
        z = np.log1p(m)
        out.append(go.Heatmap(x=xs, y=ys, z=np.where(z > 0, z, np.nan), showscale=False, hoverinfo="skip",
                              colorscale=[[0, f"rgba({rgb},0.15)"], [1, f"rgba({rgb},0.9)"]]))
    return out


def _bg_traces_3d(vd, floor, relief):
    arr = _bg_arrays(vd)
    if arr is None:
        return []
    xs, ys, pos, neg = arr
    if relief or vd.background == "density":
        sg = _signed(pos, neg)
        z = sg if relief else np.where(np.isnan(sg), np.nan, floor)
        return [go.Surface(x=xs, y=ys, z=z, surfacecolor=sg, cmin=-1, cmax=1, cmid=0, showscale=False, colorscale=DENS_SCALE, hoverinfo="skip",
                           opacity=1.0 if relief else 0.75, lighting=dict(ambient=0.5, diffuse=0.8, specular=0.6, roughness=0.4))]
    out = []
    for m, rgb in ((neg, "255,200,200"), (pos, "200,240,200")):
        c = np.log1p(m)
        c = np.where(c > 0, c, np.nan)
        top = RED if rgb.startswith("255") else GREEN
        out.append(go.Surface(x=xs, y=ys, z=np.where(np.isnan(c), np.nan, floor), surfacecolor=c, showscale=False, hoverinfo="skip", opacity=0.75,
                              colorscale=[[0, f"rgb({rgb})"], [1, f"rgb({top})"]]))
    return out


# --- éléments communs ----------------------------------------------------------------------------------------------
def _circle(cx, cy, r, n=48):
    a = np.linspace(0, 2 * np.pi, n + 1)
    return cx + r * np.cos(a), cy + r * np.sin(a)


def _layout_2d(fig, vd, height, title):
    lo, hi = vd.scn.bounds(10)
    fig.update_layout(title=title, height=height, margin=dict(l=0, r=0, t=40, b=0), legend=dict(orientation="h"),
                      xaxis=dict(range=[lo[0], hi[0]], title="x (NM)"), yaxis=dict(range=[lo[1], hi[1]], scaleanchor="x", title="y (NM)"))


def figure_2d(vd, height=640):
    fig = go.Figure(_bg_traces_2d(vd))
    for i, r in enumerate(vd.scn.routes):
        name = vd.scn.ids[i]
        if "routes" in vd.layers:
            x, y, _, _ = path_samples(r, (0, 0, 0, 0))
            fig.add_trace(go.Scatter(x=x, y=y, mode="lines", line=dict(color="#888", dash="dot", width=1), showlegend=False, hoverinfo="skip"))
        if "solution" in vd.layers:
            x, y, z, _ = path_samples(r, vd.genes[i])
            fig.add_trace(go.Scatter(x=x, y=y, mode="lines+markers", name=name, line=dict(color=AC_COLORS[i % 8], width=3), marker=dict(size=5),
                                     customdata=z, hovertemplate=name + "<br>x %{x:.1f} y %{y:.1f}<br>%{customdata:.0f} ft<extra></extra>"))
    if "aircraft" in vd.layers or "zones" in vd.layers:
        for k, (name, x, y, z, speed, hdg, vz) in enumerate(vd.states):
            col = AC_COLORS[vd.scn.ids.index(name) % 8] if name in vd.scn.ids else "#ffcb78"
            if "zones" in vd.layers:
                cx, cy = _circle(x, y, vd.sep)
                fig.add_trace(go.Scatter(x=cx, y=cy, mode="lines", line=dict(color=col, width=1, dash="dot"), showlegend=False, hoverinfo="skip"))
            if "aircraft" in vd.layers:
                h = np.radians(hdg)
                ex, ey = x + np.sin(h) * speed / 60 * 3, y + np.cos(h) * speed / 60 * 3
                fig.add_trace(go.Scatter(x=[x, ex], y=[y, ey], mode="lines+markers", line=dict(color="#ffcb78", width=2),
                                         marker=dict(size=[11, 4], color="#ffcb78", symbol=["diamond", "circle"]), showlegend=False,
                                         text=[f"{name}<br>FL{z / 100:.0f} · {speed:.0f} kt · cap {hdg:.0f}°", ""], hoverinfo="text"))
                fig.add_annotation(x=x, y=y, text=name, showarrow=False, yshift=14, font=dict(color="#ffcb78", size=11))
    _layout_2d(fig, vd, height, f"Vue 2D · t = {vd.t:.0f} s")
    return fig


def figure_3d(vd, axis="Altitude", height=700):
    """Mêmes couches qu'en 2D. axis : "Altitude" (ft), "Temps" (s) ou "Relief" (la densité devient la hauteur)."""
    relief = axis == "Relief"
    samples = [path_samples(r, g) for r, g in zip(vd.scn.routes, vd.genes)]
    base = [path_samples(r, (0, 0, 0, 0)) for r in vd.scn.routes]
    arrow_z = [z + vz * 3 for _, _, _, z, _, _, vz in vd.states]  # bout de la flèche de vitesse (3 min devant)
    alts = np.concatenate([s[2] for s in samples + base] + [np.array(arrow_z + [z for _, _, _, z, *_ in vd.states])])
    tmax = max(max(s[3][-1] for s in samples), vd.t + 180)
    if axis == "Altitude":
        zi, floor, zrange, ztitle = 2, alts.min() - 2500, [alts.min() - 2500, alts.max() + 2500], "altitude (ft)"
    elif axis == "Temps":
        zi, floor, zrange, ztitle = 3, 0.0, [0, tmax * 1.02], "temps (s)"
    else:
        zi, floor, zrange, ztitle = None, 0.0, [-1.1, 1.5], "sûr (+) / conflit (−)"
    line_z = (lambda s: np.full(len(s[0]), 1.2)) if relief else (lambda s: s[zi])
    fig = go.Figure(_bg_traces_3d(vd, floor, relief))
    for i in range(vd.scn.n):
        name = vd.scn.ids[i]
        if "routes" in vd.layers:
            fig.add_trace(go.Scatter3d(x=base[i][0], y=base[i][1], z=line_z(base[i]), mode="lines", line=dict(color="#888", dash="dot", width=3),
                                       showlegend=False, hoverinfo="skip"))
        if "solution" in vd.layers:
            s = samples[i]
            fig.add_trace(go.Scatter3d(x=s[0], y=s[1], z=line_z(s), mode="lines+markers", name=name, line=dict(color=AC_COLORS[i % 8], width=7),
                                       marker=dict(size=3), customdata=np.stack([s[2], s[3]], 1),
                                       hovertemplate=name + "<br>x %{x:.1f} y %{y:.1f}<br>%{customdata[0]:.0f} ft · t=%{customdata[1]:.0f} s<extra></extra>"))
    for name, x, y, z, speed, hdg, vz in vd.states:
        zz = 1.2 if relief else (z if axis == "Altitude" else vd.t)
        col = AC_COLORS[vd.scn.ids.index(name) % 8] if name in vd.scn.ids else "#ffcb78"
        if "zones" in vd.layers:
            cx, cy = _circle(x, y, vd.sep)
            levels = [zz - vd.sep_v, zz + vd.sep_v] if axis == "Altitude" and vd.sep_v > 0 else [zz]
            for lv in levels:
                fig.add_trace(go.Scatter3d(x=cx, y=cy, z=np.full(len(cx), lv), mode="lines", line=dict(color=col, width=3), showlegend=False, hoverinfo="skip"))
            if len(levels) == 2:
                for k in (0, 12, 24, 36):
                    fig.add_trace(go.Scatter3d(x=[cx[k]] * 2, y=[cy[k]] * 2, z=levels, mode="lines", line=dict(color=col, width=2), showlegend=False, hoverinfo="skip"))
        if "aircraft" in vd.layers:
            h = np.radians(hdg)
            ex, ey = x + np.sin(h) * speed / 60 * 3, y + np.cos(h) * speed / 60 * 3
            ez = zz if relief else (z + vz * 3 if axis == "Altitude" else vd.t + 180)
            fig.add_trace(go.Scatter3d(x=[x, ex], y=[y, ey], z=[zz, ez], mode="lines+markers+text", text=[name, ""], textposition="top center",
                                       line=dict(color="#ffcb78", width=5), marker=dict(size=[6, 2], color="#ffcb78"), showlegend=False,
                                       hovertemplate=f"{name} · FL{z / 100:.0f} · {speed:.0f} kt · cap {hdg:.0f}°<extra></extra>"))
    lo, hi = vd.scn.bounds(40)
    ext = hi - lo
    fig.update_layout(height=height, margin=dict(l=0, r=0, t=40, b=0), legend=dict(orientation="h"), title=f"Vue 3D · {axis.lower()} · t = {vd.t:.0f} s",
                      scene=dict(xaxis=dict(title="x (NM)", range=[lo[0], hi[0]]), yaxis=dict(title="y (NM)", range=[lo[1], hi[1]]),
                                 zaxis=dict(title=ztitle, range=zrange), aspectmode="manual",
                                 aspectratio=dict(x=1.0, y=float(ext[1] / ext[0]), z=0.55)))
    return fig
