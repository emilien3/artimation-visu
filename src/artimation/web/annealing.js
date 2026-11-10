// Classical simulated annealing: same genes, geometry and objective as the GA.
(function (root) {
  'use strict';
  const CM = root.ConflictModel || require('./model.js');
  const GA = root.GeneticSolver || require('./ga.js');
  const DEFAULTS = Object.freeze({iterations: 2379, temperatureStart: 0.15, temperatureEnd: 0.00001,
    seed: 0, vertical: false, sep: 7, sepV: 1000, window: Infinity});
  function* run(routes, options) {
    const cfg = {...DEFAULTS, ...options};
    if (!routes.length || !Number.isInteger(cfg.iterations) || cfg.iterations < 1) throw new Error('A scenario and a positive integer iteration count are required');
    if (![cfg.temperatureStart, cfg.temperatureEnd].every(t => Number.isFinite(t) && t > 0) || cfg.temperatureEnd > cfg.temperatureStart)
      throw new Error('Temperatures must be positive and decreasing');
    if (!Number.isFinite(cfg.sep) || cfg.sep <= 0 || !Number.isFinite(cfg.sepV) || cfg.sepV < 0 || !Number.isInteger(cfg.seed)) throw new Error('Invalid separation or seed');
    if (typeof cfg.window !== 'number' || !(cfg.window > 0)) throw new Error('Horizon must be positive or Infinity');
    cfg.weights = CM.fitnessWeights(cfg.weights);
    const R = GA.rng(cfg.seed), win = routes.map(r => Math.min(r.t[r.t.length - 1], cfg.window));
    const opts = {sep: cfg.sep, sepV: cfg.sepV, tmax: cfg.window, weights: cfg.weights};
    const rec = {genes: [], gen: [], origin: [], fit: [], dmin: [], conflict: [], perAircraft: [], accepted: [], temperature: [], parent: []};
    const cache = new Map();
    function record(genes, step, parent, temperature) {
      const key = JSON.stringify(genes);
      if (!cache.has(key)) cache.set(key, CM.evaluate(routes, genes, opts));
      const e = cache.get(key), id = rec.genes.length;
      rec.genes.push(genes); rec.gen.push(step); rec.origin.push(step === 0 ? 'B' : `S_${parent}`);
      rec.fit.push(e.fitness); rec.dmin.push(e.dmin); rec.conflict.push(e.conflict); rec.perAircraft.push(e.perAircraft);
      rec.parent.push(parent); rec.temperature.push(temperature);
      return id;
    }
    let current = record(routes.map(r => [r.t[0], r.t[0], 0, 0]), 0, null, cfg.temperatureStart), bestIdx = current;
    rec.accepted.push(true);
    yield {gen: 0, best: rec.fit[bestIdx], evaluated: 1};
    for (let step = 1; step <= cfg.iterations; step++) {
      const fraction = (step - 1) / Math.max(1, cfg.iterations - 1), ratio = cfg.temperatureEnd / cfg.temperatureStart;
      // Keep the default trace unchanged; interpolate logs when the ratio underflows.
      const temperature = ratio > 0 ? cfg.temperatureStart * ratio ** fraction
        : step === 1 ? cfg.temperatureStart : step === cfg.iterations ? cfg.temperatureEnd
          : Math.exp((1 - fraction) * Math.log(cfg.temperatureStart) + fraction * Math.log(cfg.temperatureEnd));
      const genes = rec.genes[current].map(g => g.slice()), a = R.int(0, routes.length);
      genes[a] = GA.mutate(R, genes[a], routes[a], cfg.vertical, win[a]);
      const id = record(genes, step, current, temperature), delta = rec.fit[current] - rec.fit[id];
      const accepted = delta <= 0 || R.u() < Math.exp(-delta / temperature);
      rec.accepted.push(accepted);
      if (accepted) current = id;
      if (rec.fit[id] > rec.fit[bestIdx]) bestIdx = id;
      // Yield small batches to keep the browser responsive without one timer per proposal.
      if (step % 50 === 0 || step === cfg.iterations) yield {gen: step, best: rec.fit[bestIdx], evaluated: rec.genes.length};
    }
    return {...rec, bestIdx, best: rec.genes[bestIdx], currentIdx: current, algorithm: 'simulated-annealing', cfg};
  }
  const runSync = (routes, options) => { const it = run(routes, options); let s; do { s = it.next(); } while (!s.done); return s.value; };
  root.AnnealingSolver = {DEFAULTS, run, runSync};
  if (typeof module !== 'undefined' && module.exports) module.exports = root.AnnealingSolver;
})(typeof globalThis !== 'undefined' ? globalThis : this);
