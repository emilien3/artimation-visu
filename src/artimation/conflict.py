"""Geometry and evaluation for aircraft conflict resolution (reimplementation of ARTIMATION's CD&R use case).

An aircraft follows a route (waypoints in NM, times, altitudes in ft) at constant speed on each segment. A maneuver is a gene
(t1, t2, alpha[, dz]): at t1 the aircraft turns by `alpha` degrees, flies straight until t2, then heads directly to its
final waypoint. In parallel, it changes level by `dz` ft at t1 (1,500 ft/min) and returns to its original level at t2.
A solution contains one gene per aircraft. Horizontal encoding was inferred by cross-checking ENAC dataset trajectories
(Zenodo 10.5281/zenodo.7437654). Level changes extend the model.

Separation uses a `sep` NM × `sep_v` ft cylinder. Every returned distance is an equivalent distance in NM,
max(horizontal distance, vertical distance × sep/sep_v). This equals horizontal distance when aircraft share a level
(the original 2D model is therefore a special case). A conflict occurs when this distance is below `sep`.
"""
import ast
import json
from dataclasses import dataclass
from pathlib import Path

import numpy as np

SEP_NM = 7.0  # target minimum horizontal separation (green area in the heatmap)
SEP_FT = 1000.0  # minimum vertical separation (RVSM)
FT_PER_S = 25.0  # vertical speed for level changes (1,500 ft/min)
DEFAULT_FL = 360  # cross-checked real flights in scenarios 2 and 9 use FL360 with zero vertical rate
MAX_HEAT_CELLS = 40_000  # maximum heatmap cells per aircraft
DATA_DIR = Path(__file__).resolve().parents[2] / "data"


@dataclass(frozen=True)
class Route:
    xy: np.ndarray  # (n, 2), in NM
    t: np.ndarray  # (n,), seconds since the scenario starts
    z: np.ndarray = None  # (n,), altitude in ft; constant FL360 by default
    enac_start: np.ndarray = None  # Exported snapshot position; enables ENAC horizontal reconstruction.

    def __post_init__(self):
        if self.z is None:
            object.__setattr__(self, "z", np.full(len(self.t), DEFAULT_FL * 100.0))

    def leg(self, t):
        """Index of the current segment at time t."""
        return int(np.clip(np.searchsorted(self.t, t, side="right") - 1, 0, len(self.t) - 2))

    def position(self, t):
        return np.array([np.interp(t, self.t, self.xy[:, 0]), np.interp(t, self.t, self.xy[:, 1])])

    def altitude(self, t):
        return float(np.interp(t, self.t, self.z))

    @property
    def playback_offset(self):
        if self.enac_start is None:
            return 0.0
        speed = np.linalg.norm(self.xy[1] - self.xy[0]) / (self.t[1] - self.t[0])
        return float(self.t[0] + np.linalg.norm(self.enac_start - self.xy[0]) / speed)

    @property
    def command_start(self):
        return self.playback_offset if self.enac_start is not None else float(self.t[0])

    @property
    def length(self):
        if self.enac_start is not None:
            return float(np.linalg.norm(self.xy[-1] - self.enac_start))
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
        """Copy the scenario with one level (ft) per aircraft and an optional vertical rate (ft/min)."""
        rates = rates_ft_min if rates_ft_min is not None else [0.0] * self.n
        routes = [Route(r.xy, r.t, lv + rt * (r.t - r.t[0]) / 60.0, r.enac_start) for r, lv, rt in zip(self.routes, levels_ft, rates)]
        return Scenario(self.name, routes, self.labels)

    def to_dict(self):
        return dict(name=self.name, labels=list(self.ids),
                    routes=[dict(xy=r.xy.tolist(), t=r.t.tolist(), z=r.z.tolist(),
                                 enac_start=None if r.enac_start is None else r.enac_start.tolist()) for r in self.routes])

    @staticmethod
    def from_dict(d):
        return Scenario(d["name"], [Route(np.array(r["xy"], float), np.array(r["t"], float), np.array(r["z"], float),
                                        None if r.get("enac_start") is None else np.array(r["enac_start"], float)) for r in d["routes"]],
                        tuple(d["labels"]))


def scenario_from_aircraft(rows, horizon_s=1800.0, name="Custom scenario"):
    """Build a scenario from aircraft on direct routes: rows = [dict(id, x, y, heading, speed, fl, vz)] (north-positive y)."""
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


def load_scenario(path, *, enac=False):
    """Read a `Ga-Trajectory-ScenarioN.txt` file (one Python list of ((x, y), 'hh:mm:ss') per aircraft)."""
    lines = [ast.literal_eval(ln) for ln in Path(path).read_text().splitlines() if ln.strip()]
    t0 = min(_hms(w[0][1]) for w in lines)
    routes = [Route(np.array([p for p, _ in w], float), np.array([_hms(h) - t0 for _, h in w], float)) for w in lines]
    if enac:
        starts = json.loads((DATA_DIR / "scenarios/enac-starts.json").read_text())[Path(path).stem]
        if len(starts) != len(routes):
            raise ValueError("ENAC snapshot must contain one position per aircraft")
        for i, r in enumerate(routes):
            speed = np.linalg.norm(r.xy[1] - r.xy[0]) / (r.t[1] - r.t[0])
            times = r.t[0] + np.r_[0, np.cumsum(np.linalg.norm(np.diff(r.xy, axis=0), axis=1) / speed)]
            routes[i] = Route(r.xy, times, enac_start=np.array(starts[i], float))
    return Scenario(Path(path).stem.replace("Ga-Trajectory-", ""), routes)


def list_scenarios(*, enac=False):
    files = sorted((DATA_DIR / "scenarios").glob("Ga-Trajectory-Scenario*.txt"), key=lambda p: int(''.join(c for c in p.stem if c.isdigit())))
    return [load_scenario(f, enac=enac) for f in files]


def _g(gene):
    """Four-component gene (t1, t2, alpha, dz); three-component genes (ENAC dataset) have no level change."""
    return (*gene, 0.0)[:4] if len(gene) < 4 else tuple(gene[:4])


def _horizontal_active(route, gene):
    t1, t2, alpha, _ = _g(gene)
    return not (alpha == 0 or t2 <= t1 or t1 + 1e-9 < route.command_start or t1 >= route.t[-1])


def _vertical_active(route, gene):
    t1, t2, _, dz = _g(gene)
    return not (dz == 0 or t2 <= t1 or t1 + 1e-9 < route.command_start or t1 >= route.t[-1])


def maneuver_path(route, gene):
    """Aircraft horizontal polyline (xy, t) after applying its gene."""
    if route.enac_start is not None:
        return _enac_path(route, gene)
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


def _enac_path(route, gene):
    """Reconstruct the default Zenodo export: constant speed and 2.5° angular pruning.

    Genes use the original scenario clock; playback starts at the exported snapshot.
    This is an inference from all 151,500 candidates, not the original solver source.
    """
    speed = np.linalg.norm(route.xy[1] - route.xy[0]) / (route.t[1] - route.t[0])
    points = [route.enac_start]
    final = route.xy[-1]
    if _horizontal_active(route, gene):
        t1, t2, alpha, _ = _g(gene)
        # Retiming can move an exact waypoint boundary by a few floating-point ulps.
        k = route.leg(t1 + 1e-9)
        leg = route.xy[k + 1] - route.xy[k]
        heading = np.arctan2(leg[1], leg[0]) + np.radians(alpha)
        p = route.enac_start if abs(t1 - route.command_start) < 1e-8 else route.position(t1)
        q = p + speed * (t2 - t1) * np.array([np.cos(heading), np.sin(heading)])

        def angle(u, v):
            if np.linalg.norm(u) < 1e-12 or np.linalg.norm(v) < 1e-12:
                return 0.0
            return np.degrees(np.arctan2(abs(u[0] * v[1] - u[1] * v[0]), u @ v))

        # Compare rays from the last retained point, not the turn angle at p or q.
        if angle(p - points[-1], q - points[-1]) >= 2.5:
            points.append(p)
        if angle(q - points[-1], final - points[-1]) >= 2.5:
            points.append(q)
    points.append(final)
    xy = np.array(points)
    return xy, np.r_[0, np.cumsum(np.linalg.norm(np.diff(xy, axis=0), axis=1) / speed)]


def vertical_profile(route, gene):
    """Altitude profile (tz, z): route level plus a `dz` ft offset between t1 and t2, with ramps at 1,500 ft/min."""
    base_t = route.t - route.playback_offset
    if not _vertical_active(route, gene):
        return base_t, route.z
    t1, t2, _, dz = _g(gene)
    t1 = max(0.0, t1 - route.playback_offset) if route.enac_start is not None else t1
    t2 -= route.playback_offset
    ramp = abs(dz) / FT_PER_S
    tb = t1 + ramp
    tc = max(t2, tb)
    knots = [t1, tb, tc, tc + ramp]
    times = np.unique(np.concatenate([base_t, knots]))
    return times, np.interp(times, base_t, route.z) + np.interp(times, knots, [0, dz, dz, 0], left=0, right=0)


def full_path(route, gene):
    """(xy, t, tz, z): horizontal trajectory and altitude profile."""
    xy, t = maneuver_path(route, gene)
    tz, z = vertical_profile(route, gene)
    return xy, t, tz, z


def path_samples(route, gene):
    """Trajectory points (x, y, z, t) at each change in direction or vertical slope."""
    xy, t, tz, z = full_path(route, gene)
    ts = np.unique(np.concatenate([t, tz[(tz >= t[0]) & (tz <= t[-1])]]))
    return np.interp(ts, t, xy[:, 0]), np.interp(ts, t, xy[:, 1]), np.interp(ts, tz, z), ts


def state_at(route, gene, t):
    """(x, y, z ft, speed kt, heading ° clockwise from north, vertical rate ft/min) at time t, or None when not in flight."""
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
    """Exact (minimum equivalent distance in NM, seconds in conflict) between two trajectories (xy, t, tz, z).

    Conflict: horizontal distance < sep AND altitude difference < sep_v. Relative motion is linear between knots.
    Equivalent distance max(|r|, c|dz|) is convex. Its minimum occurs at an endpoint, at the minimum of |r|,
    where dz crosses zero, or where |r| = c|dz| (roots of a quadratic).
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
    # seconds in conflict: intersect the |r| < sep interval with the |dz| < sep_v interval
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
    pair_dmin: np.ndarray  # (A, A), minimum distance for each pair
    conflict_s: float  # cumulative seconds below separation
    extra_nm: float  # distance added by maneuvers
    n_maneuvers: int
    fitness: float

    @property
    def dmin(self):
        return float(self.pair_dmin[np.triu_indices_from(self.pair_dmin, 1)].min(initial=np.inf))


# Conflict-free solutions occupy (0.5, 1]; other solutions occupy (0, 0.5).
DEFAULT_WEIGHTS = dict(conflict=1.0, shortfall=10.0, length=0.02, maneuver=0.05, altitude=0.04)


def fitness_weights(weights=None):
    if weights is not None and (not isinstance(weights, dict) or set(weights) - DEFAULT_WEIGHTS.keys()):
        raise ValueError("Invalid fitness weights")
    w = {**DEFAULT_WEIGHTS, **(weights or {})}
    if any(not isinstance(v, (int, float)) or not np.isfinite(v) or v < 0 for v in w.values()):
        raise ValueError("Fitness weights must be finite and nonnegative")
    return w


def evaluate(scn, genes, sep=SEP_NM, sep_v=SEP_FT, weights=None):
    """Evaluate a solution (genes: (A, 3) or (A, 4)). Maximize fitness ∈ (0, 1]; 1 means no changes and no conflict."""
    w = fitness_weights(weights)
    genes = np.asarray(genes, dtype=float)
    if genes.ndim != 2 or genes.shape[0] != scn.n or genes.shape[1] not in (3, 4) or not np.isfinite(genes).all():
        raise ValueError("Each aircraft requires a finite gene with 3 or 4 components")
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
    h_act = [len(p[0]) > 2 if r.enac_start is not None else _horizontal_active(r, g)
             for r, g, p in zip(scn.routes, genes, paths)]
    v_act = [_vertical_active(r, g) for r, g in zip(scn.routes, genes)]
    n_man = sum(h or v for h, v in zip(h_act, v_act))
    alt = sum(abs(_g(g)[3]) for g, v in zip(genes, v_act) if v)
    finite = pair[np.isfinite(pair)]
    shortfall = max(0.0, sep - (finite.min() if finite.size else sep))  # gradient to guide the GA toward the safe region
    penalty = w["conflict"] * conflict + w["shortfall"] * shortfall + w["length"] * extra + w["maneuver"] * n_man + w["altitude"] * alt / 1000.0
    safe = conflict == 0 and shortfall == 0
    score = 0.5 / (1.0 + penalty)
    fitness = max(0.5 + np.finfo(float).eps, 0.5 + score) if safe else min(0.5 - np.finfo(float).eps, score)
    return Evaluation(pair, conflict, float(extra), n_man, fitness)


def heat_layers(scn, genes_all, pair_dmin_all, sep=SEP_NM, cell=1.0, step=0.5):
    """Heatmap density layers: where each aircraft's safe (green) or unsafe (red) modified trajectories pass.

    genes_all: (N, A, 3), pair_dmin_all: (N, A, A). A modification for aircraft i is safe when its
    minimum separation from every other aircraft is >= sep.
    """
    lo, hi = scn.bounds()
    cell = max(cell, float(np.sqrt(np.prod(hi - lo) / MAX_HEAT_CELLS)))  # bounded grid: cells grow with the map extent
    step = max(step, cell / 2)
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
            target = (safe if others.min(initial=np.inf) >= sep else unsafe)[i]
            np.add.at(target, (iy[ok], ix[ok]), np.minimum(step, s[-1] - ss[ok]))
    return dict(lo=lo, hi=hi, cell=cell, safe=safe, unsafe=unsafe)


def separation_curves(scn, genes, dt=1.0):
    """Horizontal distance over time for each aircraft pair -> {(i, j): (t, d)}."""
    return {k: (t, dh) for k, (t, dh, _) in separation_curves3d(scn, genes, dt).items()}


def separation_curves3d(scn, genes, dt=1.0):
    """{(i, j): (t, horizontal distance NM, altitude difference ft)} over the common flight interval."""
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
    """English instructions for each aircraft."""
    out = []
    for i, (g, r) in enumerate(zip(genes, scn.routes)):
        t1, t2, a, dz = _g(g)
        h, v = _horizontal_active(r, g), _vertical_active(r, g)
        name = scn.ids[i]
        if not (h or v) and r.enac_start is None:
            out.append(f"{name}: route unchanged.")
            continue
        parts = []
        if r.enac_start is not None:
            _, times = maneuver_path(r, g)
            turns = " and ".join(f"t+{t:.1f} s" for t in times[1:-1])
            parts.append(f"follow the reconstructed ENAC path; turn at {turns}, then fly directly to the final waypoint"
                         if turns else "fly directly to the final waypoint (ENAC path simplification)")
        elif h:
            parts.append(f"turn {abs(a):.0f}° {'left' if a > 0 else 'right'} at t+{t1:.0f} s, then head directly to the final waypoint at t+{t2:.0f} s")
        if v:
            start = t1 - r.playback_offset
            back = max(t2, t1 + abs(dz) / FT_PER_S) - r.playback_offset
            parts.append(f"{'climb' if dz > 0 else 'descend'} {abs(dz):.0f} ft at t+{start:.0f} s, then start returning to the original route altitude at t+{back:.0f} s")
        out.append(f"{name}: " + "; ".join(parts) + ".")
    return out
