"""Vues 3D (plotly) : espace-temps des trajectoires et relief de la densité de l'outil Vector."""
import numpy as np
import plotly.graph_objects as go

from .conflict import SEP_NM, maneuver_path

AC_COLORS = ["#1f77b4", "#ff7f0e", "#9467bd"]
_SCENE = dict(xaxis_title="x (NM)", yaxis_title="y (NM)", zaxis_title="temps (s)", aspectmode="manual", aspectratio=dict(x=1.2, y=1, z=0.9))


def spacetime_figure(scn, best, genes_all=None, pair_dmin_all=None, n_cloud=120, sep=SEP_NM, seed=0):
    """Trajectoires en (x, y, t) : un conflit se voit comme deux lignes qui se rapprochent à la même hauteur.

    En gris pointillé les routes d'origine, en couleur la solution retenue, en vert/rouge un échantillon des candidats explorés.
    """
    fig = go.Figure()
    if genes_all is not None and len(genes_all):
        rng = np.random.default_rng(seed)
        for n in rng.choice(len(genes_all), min(n_cloud, len(genes_all)), replace=False):
            ok = np.min(pair_dmin_all[n][np.isfinite(pair_dmin_all[n])]) >= sep
            for i, r in enumerate(scn.routes):
                xy, t = maneuver_path(r, genes_all[n][i])
                fig.add_trace(go.Scatter3d(x=xy[:, 0], y=xy[:, 1], z=t, mode="lines", hoverinfo="skip", showlegend=False,
                                           line=dict(color="rgba(44,160,44,0.18)" if ok else "rgba(214,39,40,0.18)", width=2)))
    for i, r in enumerate(scn.routes):
        fig.add_trace(go.Scatter3d(x=r.xy[:, 0], y=r.xy[:, 1], z=r.t, mode="lines", showlegend=False, hoverinfo="skip",
                                   line=dict(color="#888", dash="dot", width=3)))
        xy, t = maneuver_path(r, best[i])
        fig.add_trace(go.Scatter3d(x=xy[:, 0], y=xy[:, 1], z=t, mode="lines+markers", name=f"avion {i + 1}",
                                   line=dict(color=AC_COLORS[i], width=7), marker=dict(size=3)))
    fig.update_layout(scene=_SCENE, height=620, margin=dict(l=0, r=0, t=30, b=0), legend=dict(orientation="h"),
                      title="Espace-temps (x, y, t) : routes d'origine, solution retenue, candidats sûrs (vert) / dangereux (rouge)")
    return fig


def density_relief_figure(dens, aircraft, horizon_label=""):
    """Relief 3D de la densité de Vector : sommets verts = caps sûrs fréquents, creux rouges = conflits.

    Hauteur = positif/max(positif) au-dessus de 0 et -négatif/max(négatif) en dessous (échelles indépendantes, comme l'outil).
    """
    pos, neg = dens["positive"], dens["negative"]
    z = np.where(neg > 0, -neg / max(neg.max(), 1e-12), pos / max(pos.max(), 1e-12))
    z = np.where((pos == 0) & (neg == 0), np.nan, z)
    cols, rows = dens["cols"], dens["rows"]
    x, y = (np.arange(cols) + 0.5) * dens["width"] / cols, (np.arange(rows) + 0.5) * dens["height"] / rows
    fig = go.Figure(go.Surface(x=x, y=y, z=z, cmin=-1, cmax=1, cmid=0, showscale=False,
                               colorscale=[[0, "rgb(255,55,65)"], [0.35, "rgb(255,166,129)"], [0.5, "rgb(54,54,54)"], [0.65, "rgb(47,146,120)"], [1, "rgb(47,245,210)"]],
                               lighting=dict(ambient=0.5, diffuse=0.8, specular=0.6, roughness=0.4)))
    for a in aircraft:
        fig.add_trace(go.Scatter3d(x=[a.x], y=[a.y], z=[1.15], mode="markers+text", text=[a.id], textposition="top center",
                                   marker=dict(size=5, color="#ffcb78"), showlegend=False))
    scene = dict(xaxis_title="x (NM)", yaxis=dict(title="y (NM, vers le bas)", autorange="reversed"),
                 zaxis=dict(title="sûr (+) / conflit (−)", range=[-1.1, 1.3]), aspectmode="manual", aspectratio=dict(x=1.33, y=1, z=0.5))
    fig.update_layout(scene=scene, height=620, margin=dict(l=0, r=0, t=30, b=0), title=f"Relief de densité (outil Vector) {horizon_label}")
    return fig
