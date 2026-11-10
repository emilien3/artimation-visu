"""Genetic conflict-resolution algorithm (reimplementation of the GA principle by N. Durand, ENAC).

The original GA's exact parameters are unpublished. The population, generation count and operators
below are implementation choices (about 100 individuals × 100 generations, like the dataset's roughly 10,100 candidates).
"""
from dataclasses import dataclass

import numpy as np

from .conflict import SEP_FT, SEP_NM, evaluate, fitness_weights

ALPHAS = np.arange(-40, 45, 5)  # Observed ENAC range, including both ±40° endpoints.
LEVELS = np.array([-2000.0, -1000.0, 1000.0, 2000.0])  # allowed level changes (ft), when `vertical` is enabled


@dataclass
class GAConfig:
    pop: int = 100
    generations: int = 100
    elite: int = 2
    tournament: int = 3
    p_cross: float = 0.7
    p_mut: float = 0.4
    immigrants: float = 0.1
    seed: int = 0
    sep: float = SEP_NM
    sep_v: float = SEP_FT
    weights: dict | None = None
    vertical: bool = False  # allow level changes (3D extension)


@dataclass
class GAResult:
    genes: np.ndarray  # (N, A, 4): t1, t2, alpha, dz for all evaluated candidates (for the heatmap)
    generation: np.ndarray
    ids: np.ndarray
    origin: list
    fitness: np.ndarray
    dmin: np.ndarray
    conflict_s: np.ndarray
    pair_dmin: np.ndarray  # (N, A, A)
    best_idx: int

    @property
    def best_genes(self):
        return self.genes[self.best_idx]


def _random_gene(rng, route, vertical=False):
    if rng.random() < 0.25:
        return np.array([route.t[0], route.t[0], 0.0, 0.0])  # unchanged route
    start = route.command_start
    t1 = rng.uniform(start, start + (route.t[-1] - start) * 0.9)
    t2 = t1 + rng.uniform(20, 350)
    alpha, dz = rng.choice(ALPHAS[ALPHAS != 0]), 0.0
    if vertical:
        kind = rng.random()  # 50% level only, 25% heading + level, 25% heading only
        if kind < 0.75:
            dz = rng.choice(LEVELS)
        if kind < 0.5:
            alpha = 0.0
    return np.array([t1, t2, alpha, dz])


def _mutate(rng, gene, route, vertical=False):
    t1, t2, a, dz = gene
    if (a == 0 and dz == 0) or rng.random() < 0.15:
        return _random_gene(rng, route, vertical)
    start = route.command_start
    t1 = np.clip(t1 + rng.normal(0, 30), start, start + (route.t[-1] - start) * 0.95)
    t2 = max(t1 + 10, t2 + rng.normal(0, 40))
    if a != 0:
        a = np.clip(a + 5 * rng.integers(-2, 3), ALPHAS[0], ALPHAS[-1])
        if a == 0 and dz == 0:
            a = rng.choice([-5, 5])
    if vertical and rng.random() < 0.2:
        dz = rng.choice(np.concatenate([LEVELS, [0.0]]))
        if dz == 0 and a == 0:
            a = rng.choice([-5, 5])
    return np.array([t1, t2, a, dz])


def run_ga(scn, cfg=None):
    cfg = cfg or GAConfig()
    if not scn.n or any(not isinstance(v, int) or isinstance(v, bool) for v in (cfg.pop, cfg.generations, cfg.elite, cfg.tournament)):
        raise ValueError("A nonempty scenario and integer parameters are required")
    if cfg.pop < 1 or cfg.generations < 0 or not 0 <= cfg.elite <= cfg.pop or cfg.tournament < 1:
        raise ValueError("Invalid population, generations, elite or tournament parameters")
    if any(not 0 <= p <= 1 for p in (cfg.p_cross, cfg.p_mut, cfg.immigrants)):
        raise ValueError("Probabilities must be between 0 and 1")
    weights = fitness_weights(cfg.weights)
    rng = np.random.default_rng(cfg.seed)
    rec = dict(genes=[], gen=[], ids=[], origin=[], fit=[], dmin=[], conf=[], pair=[])
    next_id = [0]
    cache = {}

    def add(genes, gen, origin):
        key = genes.tobytes()
        if key not in cache:
            cache[key] = evaluate(scn, genes, cfg.sep, cfg.sep_v, weights)
        ev = cache[key]
        i = next_id[0]
        next_id[0] += 1
        for k, v in zip(rec, (genes.copy(), gen, i, origin, ev.fitness, ev.dmin, ev.conflict_s, ev.pair_dmin)):
            rec[k].append(v)
        return i

    def new_random():
        return np.array([_random_gene(rng, r, cfg.vertical) for r in scn.routes])

    pop = [add(np.array([[r.t[0], r.t[0], 0., 0.] for r in scn.routes]), 0, "B")]
    pop += [add(new_random(), 0, "G") for _ in range(cfg.pop - 1)]
    for gen in range(1, cfg.generations + 1):
        fit = np.array([rec["fit"][i] for i in pop])
        order = np.argsort(-fit)
        nxt = [pop[i] for i in order[: cfg.elite]]
        pick = lambda: pop[max(rng.choice(len(pop), cfg.tournament), key=lambda k: fit[k])]
        while len(nxt) < cfg.pop:
            if rng.random() < cfg.immigrants:
                nxt.append(add(new_random(), gen, "G"))
                continue
            pa = pick()
            child, origin = rec["genes"][pa].copy(), f"M_{pa}"
            if rng.random() < cfg.p_cross:
                pb = pick()
                mask = rng.random(scn.n) < 0.5  # crossover: each aircraft inherits its maneuver from either existing solution
                child[mask] = rec["genes"][pb][mask]
                origin = f"C_{pa}_{pb}"
            for a in range(scn.n):
                if rng.random() < cfg.p_mut:
                    child[a] = _mutate(rng, child[a], scn.routes[a], cfg.vertical)
            nxt.append(add(child, gen, origin))
        pop = nxt

    fit = np.array(rec["fit"])
    return GAResult(np.array(rec["genes"]), np.array(rec["gen"]), np.array(rec["ids"]), rec["origin"], fit,
                    np.array(rec["dmin"]), np.array(rec["conf"]), np.array(rec["pair"]), int(np.argmax(fit)))
