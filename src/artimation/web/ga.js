// Genetic conflict solver (port of src/artimation/ga.py) and heatmaps of explored candidates.
// Reimplementation of N. Durand's ENAC GA principle; the original GA's exact parameters are unpublished.
(function (root) {
  'use strict';
  const CM = root.ConflictModel || require('./model.js');
  const ALPHAS = [-40, -35, -30, -25, -20, -15, -10, -5, 5, 10, 15, 20, 25, 30, 35, 40]; // Observed ENAC range; idle genes handle 0°.
  const LEVELS = [-2000, -1000, 1000, 2000];                                       // Altitude offsets (ft) when `vertical` is enabled.
  function rng(seed) { // mulberry32
    let a = (seed >>> 0) + 0x6D2B79F5;
    const u = () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
    const r = {u, uniform: (lo, hi) => lo + (hi - lo) * u(), choice: arr => arr[Math.floor(u() * arr.length)], int: (lo, hi) => lo + Math.floor(u() * (hi - lo)),
               normal: (m, s) => m + s * Math.sqrt(-2 * Math.log(1 - u())) * Math.cos(2 * Math.PI * u())};
    return r;
  }
  const DEFAULTS = {pop: 100, generations: 100, elite: 2, tournament: 3, pCross: 0.7, pMut: 0.4, immigrants: 0.1, seed: 0, sep: 7, sepV: 1000, vertical: false, window: Infinity};

  function randomGene(R, route, vertical, win) {
    const start = CM.commandStart(route);
    if (win <= start) return [route.t[0], route.t[0], 0, 0];
    if (R.u() < 0.25) return [route.t[0], route.t[0], 0, 0]; // Unchanged route.
    const t1 = R.uniform(start, start + (win - start) * 0.9), t2 = t1 + R.uniform(20, 350);
    let alpha = R.choice(ALPHAS), dz = 0;
    if (vertical) { const k = R.u(); if (k < 0.75) dz = R.choice(LEVELS); if (k < 0.5) alpha = 0; }
    return [t1, t2, alpha, dz];
  }
  function mutate(R, g, route, vertical, win) {
    let [t1, t2, a, dz] = g;
    if ((a === 0 && dz === 0) || R.u() < 0.15) return randomGene(R, route, vertical, win);
    const start = CM.commandStart(route);
    if (win <= start) return [route.t[0], route.t[0], 0, 0];
    t1 = CM.clamp(t1 + R.normal(0, 30), start, start + (win - start) * 0.95);
    t2 = Math.max(t1 + 10, t2 + R.normal(0, 40));
    if (a !== 0) { a = CM.clamp(a + 5 * R.int(-2, 3), ALPHAS[0], ALPHAS[ALPHAS.length - 1]); if (a === 0 && dz === 0) a = R.choice([-5, 5]); }
    if (vertical && R.u() < 0.2) { dz = R.choice([...LEVELS, 0]); if (dz === 0 && a === 0) a = R.choice([-5, 5]); }
    return [t1, t2, a, dz];
  }

  // Yield {gen, best, evaluated} after each generation to keep the UI responsive; return the full result.
  function* run(routes, options) {
    const cfg = {...DEFAULTS, ...options}, R = rng(cfg.seed), A = routes.length;
    if (!A || ![cfg.pop, cfg.generations, cfg.elite, cfg.tournament].every(Number.isInteger) || cfg.pop < 1 || cfg.generations < 0 || cfg.elite < 0 || cfg.elite > cfg.pop || cfg.tournament < 1)
      throw new Error('Invalid scenario or population parameters');
    if (![cfg.pCross, cfg.pMut, cfg.immigrants].every(p => Number.isFinite(p) && p >= 0 && p <= 1))
      throw new Error('Probabilities must be between 0 and 1');
    if (!Number.isFinite(cfg.sep) || cfg.sep <= 0 || !Number.isFinite(cfg.sepV) || cfg.sepV < 0 || !Number.isInteger(cfg.seed))
      throw new Error('Invalid separation or seed');
    if (typeof cfg.window !== 'number' || !(cfg.window > 0)) throw new Error('Horizon must be positive or Infinity');
    cfg.weights = CM.fitnessWeights(cfg.weights);
    const win = routes.map(r => Math.min(r.t[r.t.length - 1], cfg.window));
    const ev = {sep: cfg.sep, sepV: cfg.sepV, tmax: cfg.window, weights: cfg.weights};
    const rec = {genes: [], gen: [], origin: [], fit: [], dmin: [], conflict: [], perAircraft: []};
    const cache = new Map();
    const add = (genes, gen, origin) => {
      const key = JSON.stringify(genes);
      if (!cache.has(key)) cache.set(key, CM.evaluate(routes, genes, ev));
      const e = cache.get(key), id = rec.fit.length;
      rec.genes.push(genes.map(g => g.slice())); rec.gen.push(gen); rec.origin.push(origin);
      rec.fit.push(e.fitness); rec.dmin.push(e.dmin); rec.conflict.push(e.conflict); rec.perAircraft.push(e.perAircraft);
      return id;
    };
    const fresh = () => routes.map((r, i) => randomGene(R, r, cfg.vertical, win[i]));
    let pop = [add(routes.map(r => [r.t[0], r.t[0], 0, 0]), 0, 'B'), ...Array.from({length: cfg.pop - 1}, () => add(fresh(), 0, 'G'))];
    yield {gen: 0, best: Math.max(...pop.map(i => rec.fit[i])), evaluated: rec.fit.length};
    for (let gen = 1; gen <= cfg.generations; gen++) {
      const fit = pop.map(i => rec.fit[i]), order = fit.map((f, k) => k).sort((a, b) => fit[b] - fit[a]);
      const next = order.slice(0, cfg.elite).map(k => pop[k]);
      const pick = () => { let best = -1; for (let k = 0; k < cfg.tournament; k++) { const c = R.int(0, pop.length); if (best < 0 || fit[c] > fit[best]) best = c; } return pop[best]; };
      while (next.length < cfg.pop) {
        if (R.u() < cfg.immigrants) { next.push(add(fresh(), gen, 'G')); continue; }
        const pa = pick(); let child = rec.genes[pa].map(g => g.slice()), origin = `M_${pa}`;
        if (R.u() < cfg.pCross) { const pb = pick(); child = child.map((g, a) => (R.u() < 0.5 ? rec.genes[pb][a].slice() : g)); origin = `C_${pa}_${pb}`; }
        for (let a = 0; a < A; a++) if (R.u() < cfg.pMut) child[a] = mutate(R, child[a], routes[a], cfg.vertical, win[a]);
        next.push(add(child, gen, origin));
      }
      pop = next;
      yield {gen, best: Math.max(...pop.map(i => rec.fit[i])), evaluated: rec.fit.length};
    }
    let bestIdx = 0; rec.fit.forEach((f, i) => { if (f > rec.fit[bestIdx]) bestIdx = i; });
    return {...rec, bestIdx, best: rec.genes[bestIdx], cfg};
  }
  const runSync = (routes, options) => { const it = run(routes, options); let s; do { s = it.next(); } while (!s.done); return s.value; };

  // Per-aircraft heatmap: trajectory NM per cell for explored safe/conflicting maneuvers.
  // Aircraft i is safe when its minimum equivalent distance to every other aircraft is >= sep.
  function heatLayers(routes, result, {cols = 160, rows = 120, width = 120, height = 90, sep = 7, step = 0.5} = {}) {
    const A = routes.length, safe = Array.from({length: A}, () => new Float32Array(cols * rows)), unsafe = Array.from({length: A}, () => new Float32Array(cols * rows));
    const dx = width / cols, dy = height / rows;
    for (let n = 0; n < result.genes.length; n++) for (let i = 0; i < A; i++) {
      const p = CM.maneuverPath(routes[i], result.genes[n][i]), target = (result.perAircraft[n][i] >= sep ? safe : unsafe)[i];
      for (let k = 1; k < p.x.length; k++) {
        const len = Math.hypot(p.x[k] - p.x[k - 1], p.y[k] - p.y[k - 1]), m = Math.max(1, Math.ceil(len / step));
        for (let s = 0; s < m; s++) {
          const f = (s + 0.5) / m, cx = Math.floor((p.x[k - 1] + (p.x[k] - p.x[k - 1]) * f) / dx), cy = Math.floor((p.y[k - 1] + (p.y[k] - p.y[k - 1]) * f) / dy);
          if (cx >= 0 && cx < cols && cy >= 0 && cy < rows) target[cy * cols + cx] += len / m;
        }
      }
    }
    return {cols, rows, width, height, safe, unsafe};
  }
  root.GeneticSolver = {DEFAULTS, run, runSync, heatLayers, randomGene, mutate, rng};
  if (typeof module !== 'undefined' && module.exports) module.exports = root.GeneticSolver;
})(typeof globalThis !== 'undefined' ? globalThis : this);
