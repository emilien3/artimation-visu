"""Géométrie et évaluation des résolutions de conflits aériens (réimplémentation du cas d'usage CD&R d'ARTIMATION).

Un avion suit une route (waypoints en NM, heures) à vitesse constante par tronçon. Une manœuvre est un gène
(t1, t2, alpha) : à t1 l'avion tourne de `alpha` degrés, vole droit jusqu'à t2, puis rejoint directement son
dernier waypoint. Une solution = un gène par avion. Ce codage a été retrouvé en recoupant les trajectoires du
jeu de données ENAC (Zenodo 10.5281/zenodo.7437654).
"""
import ast
from dataclasses import dataclass
from pathlib import Path

import numpy as np

SEP_NM = 7.0  # séparation minimale visée (zone verte de la HeatMap)
DATA_DIR = Path(__file__).resolve().parents[2] / "data"


@dataclass(frozen=True)
class Route:
    xy: np.ndarray  # (n, 2) en NM
    t: np.ndarray  # (n,) secondes depuis le début du scénario

    def leg(self, t):
        """Indice du tronçon en cours à l'instant t."""
        return int(np.clip(np.searchsorted(self.t, t, side="right") - 1, 0, len(self.t) - 2))

    def position(self, t):
        return np.array([np.interp(t, self.t, self.xy[:, 0]), np.interp(t, self.t, self.xy[:, 1])])

    @property
    def length(self):
        return float(np.linalg.norm(np.diff(self.xy, axis=0), axis=1).sum())


@dataclass(frozen=True)
class Scenario:
    name: str
    routes: list

    @property
    def n(self):
        return len(self.routes)

    def bounds(self, margin=40.0):
        pts = np.vstack([r.xy for r in self.routes])
        return pts.min(0) - margin, pts.max(0) + margin


def _hms(s):
    h, m, sec = (int(v) for v in s.split(":"))
    return h * 3600 + m * 60 + sec


def load_scenario(path):
    """Lit un fichier `Ga-Trajectory-ScenarioN.txt` (une liste Python de ((x, y), 'hh:mm:ss') par avion)."""
    lines = [ast.literal_eval(ln) for ln in Path(path).read_text().splitlines() if ln.strip()]
    t0 = min(_hms(w[0][1]) for w in lines)
    routes = [Route(np.array([p for p, _ in w], float), np.array([_hms(h) - t0 for _, h in w], float)) for w in lines]
    return Scenario(Path(path).stem.replace("Ga-Trajectory-", ""), routes)


def list_scenarios():
    files = sorted((DATA_DIR / "scenarios").glob("Ga-Trajectory-Scenario*.txt"), key=lambda p: int(''.join(c for c in p.stem if c.isdigit())))
    return [load_scenario(f) for f in files]


def maneuver_path(route, gene):
    """Polyligne (xy, t) d'un avion après application du gène (t1, t2, alpha)."""
    t1, t2, alpha = gene
    if alpha == 0 or t2 <= t1 or t1 < route.t[0] or t1 >= route.t[-1]:
        return route.xy, route.t
    k = route.leg(t1)
    leg = route.xy[k + 1] - route.xy[k]
    dist = np.linalg.norm(leg)
    speed = dist / (route.t[k + 1] - route.t[k])
    heading = np.arctan2(leg[1], leg[0]) + np.radians(alpha)
    p = route.position(t1)
    q = p + speed * (t2 - t1) * np.array([np.cos(heading), np.sin(heading)])
    final = route.xy[-1]
    before = route.t < t1
    xy = np.vstack([route.xy[before], p, q, final])
    t = np.concatenate([route.t[before], [t1, t2, t2 + np.linalg.norm(final - q) / speed]])
    return xy, t


def _pair_stats(a, b, sep):
    """(distance minimale, secondes sous `sep`) entre deux polylignes, exactes (mouvement linéaire par morceaux)."""
    (xa, ta), (xb, tb) = a, b
    lo, hi = max(ta[0], tb[0]), min(ta[-1], tb[-1])
    if hi <= lo:
        return np.inf, 0.0
    ts = np.unique(np.concatenate([ta, tb, [lo, hi]]))
    ts = ts[(ts >= lo) & (ts <= hi)]
    pa = np.stack([np.interp(ts, ta, xa[:, 0]), np.interp(ts, ta, xa[:, 1])], 1)
    pb = np.stack([np.interp(ts, tb, xb[:, 0]), np.interp(ts, tb, xb[:, 1])], 1)
    r = pa - pb
    dt = np.diff(ts)
    r0, dv = r[:-1], (r[1:] - r[:-1]) / dt[:, None]
    aa = (dv ** 2).sum(1)
    tau = np.where(aa > 1e-12, np.clip(-(r0 * dv).sum(1) / np.where(aa > 1e-12, aa, 1), 0, dt), 0)
    dmin = float(np.linalg.norm(r0 + dv * tau[:, None], axis=1).min())
    b_ = 2 * (r0 * dv).sum(1)
    c = (r0 ** 2).sum(1) - sep ** 2
    disc = b_ ** 2 - 4 * aa * c
    safe_aa = np.where(aa > 1e-12, aa, 1)
    sq = np.sqrt(np.clip(disc, 0, None))
    t_in = np.clip((-b_ - sq) / (2 * safe_aa), 0, dt)
    t_out = np.clip((-b_ + sq) / (2 * safe_aa), 0, dt)
    inside = np.where(aa > 1e-12, np.where(disc > 0, t_out - t_in, 0.0), np.where(c < 0, dt, 0.0))
    return dmin, float(inside.sum())


@dataclass
class Evaluation:
    pair_dmin: np.ndarray  # (A, A) distance minimale entre chaque paire
    conflict_s: float  # secondes cumulées sous la séparation
    extra_nm: float  # longueur ajoutée par les manœuvres
    n_maneuvers: int
    fitness: float

    @property
    def dmin(self):
        return float(self.pair_dmin[np.triu_indices_from(self.pair_dmin, 1)].min())


# Pondérations de la fitness : conflits (dominant) > longueur > nombre de manœuvres, les trois critères du papier.
W_CONFLICT, W_LENGTH, W_MANEUVER = 1.0, 0.02, 0.05


def evaluate(scn, genes, sep=SEP_NM):
    """Évalue une solution (genes : (A, 3)). fitness ∈ (0, 1], à maximiser ; 1 = rien à changer et aucun conflit."""
    paths = [maneuver_path(r, g) for r, g in zip(scn.routes, genes)]
    n = scn.n
    pair = np.full((n, n), np.inf)
    conflict = 0.0
    for i in range(n):
        for j in range(i + 1, n):
            d, c = _pair_stats(paths[i], paths[j], sep)
            pair[i, j] = pair[j, i] = d
            conflict += c
    extra = sum(max(0.0, np.linalg.norm(np.diff(xy, axis=0), axis=1).sum() - r.length) for (xy, _), r in zip(paths, scn.routes))
    n_man = sum(1 for (xy, t), r in zip(paths, scn.routes) if len(t) != len(r.t) or not np.array_equal(t, r.t))
    finite = pair[np.isfinite(pair)]
    shortfall = max(0.0, sep - (finite.min() if finite.size else sep))  # gradient pour guider l'AG vers la zone sûre
    penalty = W_CONFLICT * (conflict + 10 * shortfall) + W_LENGTH * extra + W_MANEUVER * n_man
    return Evaluation(pair, conflict, float(extra), n_man, 1.0 / (1.0 + penalty))


def heat_layers(scn, genes_all, pair_dmin_all, sep=SEP_NM, cell=1.0, step=0.5):
    """Cartes de densité HeatMap : pour chaque avion, où passent les modifications sûres (vert) ou dangereuses (rouge).

    genes_all : (N, A, 3), pair_dmin_all : (N, A, A). Une modification de l'avion i est sûre si sa
    séparation minimale avec tous les autres avions est >= sep.
    """
    lo, hi = scn.bounds()
    nx, ny = (np.ceil((hi - lo) / cell)).astype(int)
    safe = np.zeros((scn.n, ny, nx))
    unsafe = np.zeros((scn.n, ny, nx))
    for g, pd_ in zip(genes_all, pair_dmin_all):
        for i, route in enumerate(scn.routes):
            xy, _ = maneuver_path(route, g[i])
            s = np.concatenate([[0], np.cumsum(np.linalg.norm(np.diff(xy, axis=0), axis=1))])
            ss = np.arange(0, s[-1], step)
            x, y = np.interp(ss, s, xy[:, 0]), np.interp(ss, s, xy[:, 1])
            ix, iy = ((x - lo[0]) / cell).astype(int), ((y - lo[1]) / cell).astype(int)
            ok = (ix >= 0) & (ix < nx) & (iy >= 0) & (iy < ny)
            others = np.delete(pd_[i], i)
            (safe if others.min() >= sep else unsafe)[i][iy[ok], ix[ok]] += step
    return dict(lo=lo, hi=hi, cell=cell, safe=safe, unsafe=unsafe)


def separation_curves(scn, genes, dt=1.0):
    """Distance entre chaque paire d'avions au cours du temps -> {(i, j): (t, d)}."""
    paths = [maneuver_path(r, g) for r, g in zip(scn.routes, genes)]
    out = {}
    for i in range(scn.n):
        for j in range(i + 1, scn.n):
            (xa, ta), (xb, tb) = paths[i], paths[j]
            lo, hi = max(ta[0], tb[0]), min(ta[-1], tb[-1])
            t = np.arange(lo, hi, dt)
            d = np.hypot(np.interp(t, ta, xa[:, 0]) - np.interp(t, tb, xb[:, 0]),
                         np.interp(t, ta, xa[:, 1]) - np.interp(t, tb, xb[:, 1]))
            out[(i, j)] = (t, d)
    return out


def instructions(scn, genes):
    """Consignes en français pour chaque avion manœuvrant."""
    out = []
    for i, (g, r) in enumerate(zip(genes, scn.routes)):
        t1, t2, a = g
        if a == 0 or t2 <= t1 or t1 >= r.t[-1]:
            out.append(f"Avion {i + 1} : route inchangée.")
        else:
            side = "gauche" if a > 0 else "droite"
            out.append(f"Avion {i + 1} : à t+{t1:.0f} s, virer de {abs(a):.0f}° à {side} ; à t+{t2:.0f} s, rejoindre directement le dernier point de la route.")
    return out
