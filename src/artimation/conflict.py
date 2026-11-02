"""Géométrie et évaluation des résolutions de conflits aériens (réimplémentation du cas d'usage CD&R d'ARTIMATION).

Un avion suit une route (waypoints en NM, heures, altitudes en ft) à vitesse constante par tronçon. Une manœuvre est un gène
(t1, t2, alpha[, dz]) : à t1 l'avion tourne de `alpha` degrés, vole droit jusqu'à t2, puis rejoint directement son
dernier waypoint ; en parallèle il change de niveau de `dz` ft à t1 (1 500 ft/min) et revient à son niveau initial à t2.
Une solution = un gène par avion. Le codage horizontal a été retrouvé en recoupant les trajectoires du jeu de données ENAC
(Zenodo 10.5281/zenodo.7437654) ; le changement de niveau est une extension du modèle.

Séparation : cylindre `sep` NM × `sep_v` ft. Toute distance renvoyée est une « distance équivalente » en NM,
max(distance horizontale, distance verticale × sep/sep_v) : elle vaut la distance horizontale quand les avions sont au même niveau
(donc le modèle 2D d'origine est un cas particulier) et il y a conflit si elle est inférieure à `sep`.
"""
import ast
from dataclasses import dataclass
from pathlib import Path

import numpy as np

SEP_NM = 7.0  # séparation horizontale minimale visée (zone verte de la HeatMap)
SEP_FT = 1000.0  # séparation verticale minimale (RVSM)
FT_PER_S = 25.0  # vitesse verticale des changements de niveau (1 500 ft/min)
DEFAULT_FL = 360  # les vols réels recoupés des scénarios 2 et 9 volent au FL360, taux vertical nul
DATA_DIR = Path(__file__).resolve().parents[2] / "data"


@dataclass(frozen=True)
class Route:
    xy: np.ndarray  # (n, 2) en NM
    t: np.ndarray  # (n,) secondes depuis le début du scénario
    z: np.ndarray = None  # (n,) altitude en ft ; FL360 constant par défaut

    def __post_init__(self):
        if self.z is None:
            object.__setattr__(self, "z", np.full(len(self.t), DEFAULT_FL * 100.0))

    def leg(self, t):
        """Indice du tronçon en cours à l'instant t."""
        return int(np.clip(np.searchsorted(self.t, t, side="right") - 1, 0, len(self.t) - 2))

    def position(self, t):
        return np.array([np.interp(t, self.t, self.xy[:, 0]), np.interp(t, self.t, self.xy[:, 1])])

    def altitude(self, t):
        return float(np.interp(t, self.t, self.z))

    @property
    def length(self):
        return float(np.linalg.norm(np.diff(self.xy, axis=0), axis=1).sum())


@dataclass(frozen=True)
class Scenario:
    name: str
    routes: list
    labels: tuple = None

    @property
    def n(self):
        return len(self.routes)

    @property
    def ids(self):
        return self.labels or tuple(f"AC{i + 1:03d}" for i in range(self.n))

    def bounds(self, margin=40.0):
        pts = np.vstack([r.xy for r in self.routes])
        return pts.min(0) - margin, pts.max(0) + margin

    def with_levels(self, levels_ft, rates_ft_min=None):
        """Copie du scénario avec un niveau (ft) par avion et, en option, un taux vertical (ft/min)."""
        rates = rates_ft_min if rates_ft_min is not None else [0.0] * self.n
        routes = [Route(r.xy, r.t, lv + rt * (r.t - r.t[0]) / 60.0) for r, lv, rt in zip(self.routes, levels_ft, rates)]
        return Scenario(self.name, routes, self.labels)

    def to_dict(self):
        return dict(name=self.name, labels=list(self.ids),
                    routes=[dict(xy=r.xy.tolist(), t=r.t.tolist(), z=r.z.tolist()) for r in self.routes])

    @staticmethod
    def from_dict(d):
        return Scenario(d["name"], [Route(np.array(r["xy"], float), np.array(r["t"], float), np.array(r["z"], float)) for r in d["routes"]],
                        tuple(d["labels"]))


def scenario_from_aircraft(rows, horizon_s=1800.0, name="Situation libre"):
    """Scénario à partir d'avions en route directe : rows = [dict(id, x, y, heading, speed, fl, vz)] (repère y vers le nord)."""
    routes = []
    for r in rows:
        h, v = np.radians(r["heading"]), r["speed"] / 3600.0  # NM/s
        p0 = np.array([r["x"], r["y"]], float)
        routes.append(Route(np.array([p0, p0 + horizon_s * v * np.array([np.sin(h), np.cos(h)])]), np.array([0.0, horizon_s]),
                            np.array([r["fl"] * 100.0, r["fl"] * 100.0 + r.get("vz", 0.0) * horizon_s / 60.0])))
    return Scenario(name, routes, tuple(str(r["id"]) for r in rows))


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


def _g(gene):
    """Gène à 4 composantes (t1, t2, alpha, dz) ; les gènes à 3 composantes (jeu ENAC) n'ont pas de changement de niveau."""
    return (*gene, 0.0)[:4] if len(gene) < 4 else tuple(gene[:4])


def _horizontal_active(route, gene):
    t1, t2, alpha, _ = _g(gene)
    return not (alpha == 0 or t2 <= t1 or t1 < route.t[0] or t1 >= route.t[-1])


def _vertical_active(route, gene):
    t1, t2, _, dz = _g(gene)
    return not (dz == 0 or t2 <= t1 or t1 < route.t[0] or t1 >= route.t[-1])


def maneuver_path(route, gene):
    """Polyligne horizontale (xy, t) d'un avion après application du gène."""
    if not _horizontal_active(route, gene):
        return route.xy, route.t
    t1, t2, alpha, _ = _g(gene)
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


def vertical_profile(route, gene):
    """Profil d'altitude (tz, z) : niveau de la route + palier de `dz` ft entre t1 et t2, rampes à 1 500 ft/min."""
    if not _vertical_active(route, gene):
        return route.t, route.z
    t1, t2, _, dz = _g(gene)
    ramp = abs(dz) / FT_PER_S
    tb = t1 + ramp
    tc = max(t2, tb)
    knots = [t1, tb, tc, tc + ramp]
    times = np.unique(np.concatenate([route.t, knots]))
    return times, np.interp(times, route.t, route.z) + np.interp(times, knots, [0, dz, dz, 0], left=0, right=0)


def full_path(route, gene):
    """(xy, t, tz, z) : trajectoire horizontale et profil d'altitude."""
    xy, t = maneuver_path(route, gene)
    tz, z = vertical_profile(route, gene)
    return xy, t, tz, z


def path_samples(route, gene):
    """Points (x, y, z, t) de la trajectoire, à chaque instant où elle change de direction ou de pente verticale."""
    xy, t, tz, z = full_path(route, gene)
    ts = np.unique(np.concatenate([t, tz[tz <= t[-1]]]))
    return np.interp(ts, t, xy[:, 0]), np.interp(ts, t, xy[:, 1]), np.interp(ts, tz, z), ts


def state_at(route, gene, t):
    """(x, y, z ft, vitesse kt, cap ° horaire depuis le nord, taux vertical ft/min) à l'instant t, ou None si l'avion n'est pas en vol."""
    xy, ts, tz, z = full_path(route, gene)
    if not (ts[0] <= t <= ts[-1]):
        return None
    k = int(np.clip(np.searchsorted(ts, t, side="right") - 1, 0, len(ts) - 2))
    dx, dy = xy[k + 1] - xy[k]
    kz = int(np.clip(np.searchsorted(tz, t, side="right") - 1, 0, max(len(tz) - 2, 0)))
    vz = (z[kz + 1] - z[kz]) / (tz[kz + 1] - tz[kz]) * 60 if len(tz) > 1 and t < tz[-1] else 0.0
    return (float(np.interp(t, ts, xy[:, 0])), float(np.interp(t, ts, xy[:, 1])), float(np.interp(t, tz, z)),
            float(np.hypot(dx, dy) / (ts[k + 1] - ts[k]) * 3600), float(np.degrees(np.arctan2(dx, dy)) % 360), float(vz))


def _interp2(ts, xy, t):
    return np.stack([np.interp(ts, t, xy[:, 0]), np.interp(ts, t, xy[:, 1])], 1)


def _pair_stats(a, b, sep, sep_v):
    """(distance équivalente minimale en NM, secondes en conflit) entre deux trajectoires (xy, t, tz, z), exacts.

    Conflit : distance horizontale < sep ET écart d'altitude < sep_v. Entre deux instants de rupture le mouvement relatif est
    linéaire ; la distance équivalente max(|r|, c|dz|) est convexe, son minimum est à une extrémité, au minimum de |r|, au
    passage de dz par 0 ou à l'égalité |r| = c|dz| (racines d'un trinôme).
    """
    (xa, ta, tza, za), (xb, tb, tzb, zb) = a, b
    lo, hi = max(ta[0], tb[0]), min(ta[-1], tb[-1])
    if hi <= lo:
        return np.inf, 0.0
    ts = np.unique(np.concatenate([ta, tb, tza, tzb, [lo, hi]]))
    ts = ts[(ts >= lo) & (ts <= hi)]
    r = _interp2(ts, xa, ta) - _interp2(ts, xb, tb)
    dz = np.interp(ts, tza, za) - np.interp(ts, tzb, zb)
    dt = np.diff(ts)
    r0, dv = r[:-1], (r[1:] - r[:-1]) / dt[:, None]
    z0, dzv = dz[:-1], (dz[1:] - dz[:-1]) / dt
    use_v = sep_v is not None and sep_v > 0
    c = sep / sep_v if use_v else 0.0
    aa, bb, r2 = (dv ** 2).sum(1), (r0 * dv).sum(1), (r0 ** 2).sum(1)
    cand = [np.zeros_like(dt), dt, np.where(aa > 1e-12, np.clip(-bb / np.where(aa > 1e-12, aa, 1), 0, dt), 0)]
    if use_v:
        cand.append(np.where(np.abs(dzv) > 1e-12, np.clip(-z0 / np.where(np.abs(dzv) > 1e-12, dzv, 1), 0, dt), 0))
        qa, qb, qc = aa - c * c * dzv * dzv, bb - c * c * z0 * dzv, r2 - c * c * z0 * z0
        sq = np.sqrt(np.clip(qb * qb - qa * qc, 0, None))
        lin = np.where(np.abs(qb) > 1e-12, -qc / (2 * np.where(np.abs(qb) > 1e-12, qb, 1)), 0)
        for sg in (-1, 1):
            cand.append(np.clip(np.where(np.abs(qa) > 1e-12, (-qb + sg * sq) / np.where(np.abs(qa) > 1e-12, qa, 1), lin), 0, dt))
    f = lambda tau: np.maximum(np.linalg.norm(r0 + dv * tau[:, None], axis=1), c * np.abs(z0 + dzv * tau))
    dmin = float(min(f(tau).min() for tau in cand))
    # secondes en conflit : intervalle où |r| < sep, intersecté avec celui où |dz| < sep_v
    b_ = 2 * bb
    cc = r2 - sep ** 2
    disc = b_ ** 2 - 4 * aa * cc
    safe_aa = np.where(aa > 1e-12, aa, 1)
    sq = np.sqrt(np.clip(disc, 0, None))
    h_lo = np.where(aa > 1e-12, np.where(disc > 0, np.clip((-b_ - sq) / (2 * safe_aa), 0, dt), 0.0), 0.0)
    h_hi = np.where(aa > 1e-12, np.where(disc > 0, np.clip((-b_ + sq) / (2 * safe_aa), 0, dt), 0.0), np.where(cc < 0, dt, 0.0))
    if use_v:
        moving = np.abs(dzv) > 1e-12
        s1, s2 = (-sep_v - z0) / np.where(moving, dzv, 1), (sep_v - z0) / np.where(moving, dzv, 1)
        v_lo = np.where(moving, np.clip(np.minimum(s1, s2), 0, dt), 0.0)
        v_hi = np.where(moving, np.clip(np.maximum(s1, s2), 0, dt), np.where(np.abs(z0) < sep_v, dt, 0.0))
    else:
        v_lo, v_hi = np.zeros_like(dt), dt
    return dmin, float(np.clip(np.minimum(h_hi, v_hi) - np.maximum(h_lo, v_lo), 0, None).sum())


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


# Pondérations de la fitness : conflits (dominant) > longueur > nombre de manœuvres, + un coût par 1 000 ft de changement de niveau.
W_CONFLICT, W_LENGTH, W_MANEUVER, W_ALT = 1.0, 0.02, 0.05, 0.04


def evaluate(scn, genes, sep=SEP_NM, sep_v=SEP_FT):
    """Évalue une solution (genes : (A, 3) ou (A, 4)). fitness ∈ (0, 1], à maximiser ; 1 = rien à changer et aucun conflit."""
    paths = [full_path(r, g) for r, g in zip(scn.routes, genes)]
    n = scn.n
    pair = np.full((n, n), np.inf)
    conflict = 0.0
    for i in range(n):
        for j in range(i + 1, n):
            d, c = _pair_stats(paths[i], paths[j], sep, sep_v)
            pair[i, j] = pair[j, i] = d
            conflict += c
    extra = sum(max(0.0, np.linalg.norm(np.diff(xy, axis=0), axis=1).sum() - r.length) for (xy, *_), r in zip(paths, scn.routes))
    h_act = [_horizontal_active(r, g) for r, g in zip(scn.routes, genes)]
    v_act = [_vertical_active(r, g) for r, g in zip(scn.routes, genes)]
    n_man = sum(h or v for h, v in zip(h_act, v_act))
    alt = sum(abs(_g(g)[3]) for g, v in zip(genes, v_act) if v)
    finite = pair[np.isfinite(pair)]
    shortfall = max(0.0, sep - (finite.min() if finite.size else sep))  # gradient pour guider l'AG vers la zone sûre
    penalty = W_CONFLICT * (conflict + 10 * shortfall) + W_LENGTH * extra + W_MANEUVER * n_man + W_ALT * alt / 1000.0
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
    """Distance horizontale entre chaque paire d'avions au cours du temps -> {(i, j): (t, d)}."""
    return {k: (t, dh) for k, (t, dh, _) in separation_curves3d(scn, genes, dt).items()}


def separation_curves3d(scn, genes, dt=1.0):
    """{(i, j): (t, distance horizontale NM, écart d'altitude ft)} sur la période où les deux avions volent."""
    paths = [full_path(r, g) for r, g in zip(scn.routes, genes)]
    out = {}
    for i in range(scn.n):
        for j in range(i + 1, scn.n):
            (xa, ta, tza, za), (xb, tb, tzb, zb) = paths[i], paths[j]
            lo, hi = max(ta[0], tb[0]), min(ta[-1], tb[-1])
            t = np.arange(lo, hi, dt)
            dh = np.hypot(np.interp(t, ta, xa[:, 0]) - np.interp(t, tb, xb[:, 0]), np.interp(t, ta, xa[:, 1]) - np.interp(t, tb, xb[:, 1]))
            out[(i, j)] = (t, dh, np.abs(np.interp(t, tza, za) - np.interp(t, tzb, zb)))
    return out


def instructions(scn, genes):
    """Consignes en français pour chaque avion manœuvrant."""
    out = []
    for i, (g, r) in enumerate(zip(genes, scn.routes)):
        t1, t2, a, dz = _g(g)
        h, v = _horizontal_active(r, g), _vertical_active(r, g)
        name = scn.ids[i]
        if not (h or v):
            out.append(f"{name} : route inchangée.")
            continue
        parts = []
        if h:
            parts.append(f"virer de {abs(a):.0f}° à {'gauche' if a > 0 else 'droite'} à t+{t1:.0f} s, puis rejoindre directement le dernier point de la route à t+{t2:.0f} s")
        if v:
            parts.append(f"{'monter' if dz > 0 else 'descendre'} de {abs(dz):.0f} ft à t+{t1:.0f} s, puis revenir au niveau initial à t+{t2:.0f} s")
        out.append(f"{name} : " + " ; ".join(parts) + ".")
    return out
