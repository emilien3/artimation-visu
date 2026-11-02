"""Cohérence géométrique des figures 2D/3D du studio (le rendu WebGL n'est pas testable sans navigateur graphique)."""
import numpy as np
import pytest

from artimation.conflict import heat_layers, list_scenarios, state_at
from artimation.ga import GAConfig, run_ga
from artimation.studio import Frame, aircraft_states
from artimation.studio_view import ViewData, figure_2d, figure_3d
from artimation.vector import density_maps3d

S = {s.name: s for s in list_scenarios()}["Scenario2"]
R = run_ga(S, GAConfig(pop=40, generations=30, seed=0, vertical=True))
FR = Frame.from_scenario(S, 40.0)


def make_vd(bg, t=100.0):
    st = [(S.ids[i], *state_at(r, g, t)) for i, (r, g) in enumerate(zip(S.routes, R.best_genes))]
    vd = ViewData(S, R.best_genes, t, st, 7.0, 1000.0, frame=FR)
    if bg == "heat":
        vd.background, vd.heat = "heat", heat_layers(S, R.genes, R.pair_dmin, 7.0)
    if bg == "density":
        vd.background = "density"
        vd.density = density_maps3d(aircraft_states(S, R.best_genes, t, FR), 10, 7, 1000, cols=int(FR.width), rows=int(FR.height), width=FR.width, height=FR.height)
    return vd


def _range(fig, axis):
    return fig.layout.scene[axis + "axis"].range


@pytest.mark.parametrize("bg", ["none", "heat", "density"])
@pytest.mark.parametrize("axis", ["Altitude", "Temps", "Relief"])
def test_3d_traces_inside_scene_ranges(bg, axis):
    fig = figure_3d(make_vd(bg), axis)
    rx, ry, rz = _range(fig, "x"), _range(fig, "y"), _range(fig, "z")
    n_solution = 0
    for tr in fig.data:
        x, y, z = (np.asarray(getattr(tr, k), float) for k in "xyz")
        assert np.isfinite(x).all() and np.isfinite(y).all()
        tol = 1.0 if tr.type == "surface" else 1e-6  # la grille de la HeatMap est arrondie à la cellule (1 NM) supérieure
        for v, (lo, hi) in ((x, rx), (y, ry), (z[np.isfinite(z)], rz)):
            if v.size:
                assert lo - tol <= v.min() and v.max() <= hi + tol, (tr.type, tr.name)
        if tr.type == "surface":
            assert np.isfinite(z).any(), "surface vide"
        n_solution += tr.name in S.ids
    assert n_solution == S.n


def test_same_layers_in_2d_and_3d():
    """Chaque couche cochée apparaît dans les deux vues (seule la projection change)."""
    vd = make_vd("heat")
    names2, names3 = {t.name for t in figure_2d(vd).data}, {t.name for t in figure_3d(vd, "Altitude").data}
    assert set(S.ids) <= names2 and set(S.ids) <= names3
    for layers in ({"routes"}, {"solution"}, {"aircraft"}, {"zones"}):
        vd.layers = layers
        assert len(figure_2d(vd).data) > 0 and len(figure_3d(vd, "Temps").data) > 0
    vd.layers = set()
    vd.background = "none"
    assert len(figure_2d(vd).data) == 0 and len(figure_3d(vd, "Altitude").data) == 0


def test_altitude_axis_shows_the_level_change():
    best = R.best_genes
    z = [np.asarray(t.z, float) for t in figure_3d(make_vd("none"), "Altitude").data if t.name in S.ids]
    if (np.abs(best[:, 3]) > 0).any():  # l'AG a monté/descendu un avion : l'altitude de sa ligne varie
        assert max(a.max() - a.min() for a in z) >= 1000 - 1e-6
