// Algorithme génétique de résolution de conflits (portage de src/artimation/ga.py) + cartes HeatMap des candidats explorés.
// Réimplémentation du principe du GA de N. Durand (ENAC) : les paramètres exacts du GA original ne sont pas publiés.
(function (root) {
  'use strict';
  const CM = root.ConflictModel || require('./model.js');
  const ALPHAS = [-35, -30, -25, -20, -15, -10, -5, 5, 10, 15, 20, 25, 30, 35];   // pas de 5°, 0 exclu (= pas de virage)
  const LEVELS = [-2000, -1000, 1000, 2000];                                       // changements de niveau (ft), si `vertical`
  function rng(seed) { // mulberry32
    let a = (seed >>> 0) + 0x6D2B79F5;
    const u = () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
    const r = {u, uniform: (lo, hi) => lo + (hi - lo) * u(), choice: arr => arr[Math.floor(u() * arr.length)], int: (lo, hi) => lo + Math.floor(u() * (hi - lo)),
               normal: (m, s) => m + s * Math.sqrt(-2 * Math.log(1 - u())) * Math.cos(2 * Math.PI * u())};
    return r;
  }
  const DEFAULTS = {pop: 100, generations: 100, elite: 2, tournament: 3, pCross: 0.7, pMut: 0.4, immigrants: 0.1, seed: 0, sep: 7, sepV: 1000, vertical: false, window: 600};

  function randomGene(R, route, vertical, win) {
    if (R.u() < 0.25) return [route.t[0], route.t[0], 0, 0]; // route inchangée
    const t1 = R.uniform(route.t[0], win * 0.9), t2 = t1 + R.uniform(20, 350);
    let alpha = R.choice(ALPHAS), dz = 0;
    if (vertical) { const k = R.u(); if (k < 0.75) dz = R.choice(LEVELS); if (k < 0.5) alpha = 0; }
    return [t1, t2, alpha, dz];
  }
  function mutate(R, g, route, vertical, win) {
    let [t1, t2, a, dz] = g;
    if ((a === 0 && dz === 0) || R.u() < 0.15) return randomGene(R, route, vertical, win);
    t1 = CM.clamp(t1 + R.normal(0, 30), route.t[0], win * 0.95);
    t2 = Math.max(t1 + 10, t2 + R.normal(0, 40));
    if (a !== 0) { a = CM.clamp(a + 5 * R.int(-2, 3), -35, 35); if (a === 0 && dz === 0) a = R.choice([-5, 5]); }
    if (vertical && R.u() < 0.2) { dz = R.choice([...LEVELS, 0]); if (dz === 0 && a === 0) a = R.choice([-5, 5]); }
    return [t1, t2, a, dz];
  }

  // Générateur : exécute le GA génération par génération (yield {gen, best, evaluated}) pour ne pas bloquer l'interface ; retourne le résultat.
  function* run(routes, options) {
    const cfg = {...DEFAULTS, ...options}, R = rng(cfg.seed), A = routes.length;
    const win = routes.map(r => Math.min(r.t[r.t.length - 1], cfg.window));
    const ev = {sep: cfg.sep, sepV: cfg.sepV, tmax: cfg.window};
    const rec = {genes: [], gen: [], origin: [], fit: [], dmin: [], conflict: [], perAircraft: []};
    const add = (genes, gen, origin) => {
      const e = CM.evaluate(routes, genes, ev), id = rec.fit.length;
      rec.genes.push(genes.map(g => g.slice())); rec.gen.push(gen); rec.origin.push(origin);
      rec.fit.push(e.fitness); rec.dmin.push(e.dmin); rec.conflict.push(e.conflict); rec.perAircraft.push(e.perAircraft);
      return id;
    };
    const fresh = () => routes.map((r, i) => randomGene(R, r, cfg.vertical, win[i]));
    let pop = Array.from({length: cfg.pop}, () => add(fresh(), 0, 'G'));
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

  // HeatMap : par avion, densité (NM de trajectoire par cellule) des modifications sûres / dangereuses explorées. Une modification de l'avion i est
  // sûre si sa distance équivalente minimale avec tous les autres est >= sep.
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
