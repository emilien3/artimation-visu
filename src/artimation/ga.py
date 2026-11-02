"""Algorithme génétique de résolution de conflits (réimplémentation du principe du GA de N. Durand, ENAC).

Les paramètres exacts du GA original ne sont pas publiés ; population, nombre de générations et opérateurs
ci-dessous sont des choix raisonnables (≈ 100 individus × 100 générations, comme les ~10 100 candidats du jeu de données).
"""
from dataclasses import dataclass

import numpy as np

from .conflict import SEP_FT, SEP_NM, evaluate

ALPHAS = np.arange(-35, 40, 5)  # angles de déviation observés dans les données ENAC (pas de 5°)
LEVELS = np.array([-2000.0, -1000.0, 1000.0, 2000.0])  # changements de niveau autorisés (ft), si `vertical`


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
    vertical: bool = False  # autorise les changements de niveau (extension 3D)


@dataclass
class GAResult:
    genes: np.ndarray  # (N, A, 4) : t1, t2, alpha, dz tous les candidats évalués (pour la HeatMap)
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
        return np.array([route.t[0], route.t[0], 0.0, 0.0])  # route inchangée
    t1 = rng.uniform(route.t[0], route.t[-1] * 0.9)
    t2 = t1 + rng.uniform(20, 350)
    alpha, dz = rng.choice(ALPHAS[ALPHAS != 0]), 0.0
    if vertical:
        kind = rng.random()  # 50 % niveau seul, 25 % cap + niveau, 25 % cap seul
        if kind < 0.75:
            dz = rng.choice(LEVELS)
        if kind < 0.5:
            alpha = 0.0
    return np.array([t1, t2, alpha, dz])


def _mutate(rng, gene, route, vertical=False):
    t1, t2, a, dz = gene
    if (a == 0 and dz == 0) or rng.random() < 0.15:
        return _random_gene(rng, route, vertical)
    t1 = np.clip(t1 + rng.normal(0, 30), route.t[0], route.t[-1] * 0.95)
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


def run_ga(scn, cfg=GAConfig()):
    rng = np.random.default_rng(cfg.seed)
    rec = dict(genes=[], gen=[], ids=[], origin=[], fit=[], dmin=[], conf=[], pair=[])
    next_id = [0]

    def add(genes, gen, origin):
        ev = evaluate(scn, genes, cfg.sep, cfg.sep_v)
        i = next_id[0]
        next_id[0] += 1
        for k, v in zip(rec, (genes.copy(), gen, i, origin, ev.fitness, ev.dmin, ev.conflict_s, ev.pair_dmin)):
            rec[k].append(v)
        return i

    def new_random():
        return np.array([_random_gene(rng, r, cfg.vertical) for r in scn.routes])

    pop = [add(g, 0, "G") for g in (new_random() for _ in range(cfg.pop))]
    best_so_far = []
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
                mask = rng.random(scn.n) < 0.5  # croisement : chaque avion hérite de l'un ou l'autre parent
                child[mask] = rec["genes"][pb][mask]
                origin = f"C_{pa}_{pb}"
            for a in range(scn.n):
                if rng.random() < cfg.p_mut:
                    child[a] = _mutate(rng, child[a], scn.routes[a], cfg.vertical)
            nxt.append(add(child, gen, origin))
        pop = nxt
        best_so_far.append(max(pop, key=lambda i: rec["fit"][i]))

    fit = np.array(rec["fit"])
    return GAResult(np.array(rec["genes"]), np.array(rec["gen"]), np.array(rec["ids"]), rec["origin"], fit,
                    np.array(rec["dmin"]), np.array(rec["conf"]), np.array(rec["pair"]), int(np.argmax(fit)))
