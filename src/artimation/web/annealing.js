// Simulated annealing on the shared conflict model. Self-contained: its own state space, neighborhood,
// acceptance rule and cooling schedule. It only uses the common trajectory evaluation (model.js).
// State: one maneuver [t1, t2, alpha, dz] per aircraft, or the unchanged route. Energy: E = 1 - fitness.
(function (root) {
  'use strict';
  const CM = root.ConflictModel || require('./model.js');
  const ANGLE_STEP = 5, ANGLE_MAX = 40;            // Heading changes on a 5 degree lattice, within +/-40 degrees.
  const LEVELS = [-2000, -1000, 1000, 2000];       // Altitude offsets (ft) when `vertical` is enabled.
  const HOLD = [20, 350];                          // Seconds flown on the new heading before turning back.
  const DEFAULTS = Object.freeze({iterations: 2379, temperatureStart: 0.15, temperatureEnd: 0.00001,
    seed: 0, vertical: false, sep: 7, sepV: 1000, window: Infinity,
    timeStep: 30, holdStep: 40, removeProbability: 0.1});
  const idle = route => [route.t[0], route.t[0], 0, 0];
  const isIdle = g => g[2] === 0 && g[3] === 0;
  // Reflect a value into [lo, hi]: unlike clamping, this keeps the random walk symmetric at the bounds.
  function reflect(v, lo, hi) {
    if (!(hi > lo)) return lo;
    const span = hi - lo, m = ((v - lo) % (2 * span) + 2 * span) % (2 * span);
    return lo + (m <= span ? m : 2 * span - m);
  }
  // Draw a new maneuver for an aircraft on its original route.
  function randomManeuver(R, route, vertical, win) {
    const start = CM.commandStart(route), t1 = R.uniform(start, start + (win - start) * 0.9);
    let alpha = ANGLE_STEP * R.int(1, ANGLE_MAX / ANGLE_STEP + 1) * (R.u() < 0.5 ? -1 : 1), dz = 0;
    if (vertical) { const k = R.u(); if (k < 0.75) dz = R.choice(LEVELS); if (k < 0.5) alpha = 0; }
    return [t1, t1 + R.uniform(HOLD[0], HOLD[1]), alpha, dz];
  }
  // One local move on one aircraft. Every move changes a single component by one step, adds a maneuver, or removes it.
  function neighbor(R, g, route, cfg, win) {
    const start = CM.commandStart(route);
    if (win <= start) return idle(route);
    if (isIdle(g)) return randomManeuver(R, route, cfg.vertical, win);
    if (R.u() < cfg.removeProbability) return idle(route);
    let [t1, t2, alpha, dz] = g;
    const moves = ['time', 'hold'];
    if (alpha !== 0) moves.push('angle');
    if (cfg.vertical) moves.push('level');
    const move = R.choice(moves);
    if (move === 'time') { const hold = t2 - t1; t1 = reflect(t1 + R.normal(0, cfg.timeStep), start, start + (win - start) * 0.95); t2 = t1 + hold; }
    else if (move === 'hold') t2 = t1 + reflect(t2 - t1 + R.normal(0, cfg.holdStep), HOLD[0], HOLD[1]);
    else if (move === 'angle') {
      // Step on the lattice {-40..-5, 5..40}: 0 is skipped, and both ends reflect.
      const lattice = []; for (let a = -ANGLE_MAX; a <= ANGLE_MAX; a += ANGLE_STEP) if (a !== 0) lattice.push(a);
      const k = lattice.indexOf(alpha) + (R.u() < 0.5 ? -1 : 1);
      alpha = lattice[k < 0 ? 1 : k >= lattice.length ? lattice.length - 2 : k];
    } else {
      const options = [...LEVELS, ...(alpha !== 0 ? [0] : [])].filter(v => v !== dz);
      dz = R.choice(options);
    }
    return [t1, t2, alpha, dz];
  }
  function* run(routes, options) {
    const cfg = {...DEFAULTS, ...options};
    if (!routes.length || !Number.isInteger(cfg.iterations) || cfg.iterations < 1) throw new Error('A scenario and a positive integer iteration count are required');
    if (![cfg.temperatureStart, cfg.temperatureEnd].every(t => Number.isFinite(t) && t > 0) || cfg.temperatureEnd > cfg.temperatureStart)
      throw new Error('Temperatures must be positive and decreasing');
    if (!Number.isFinite(cfg.sep) || cfg.sep <= 0 || !Number.isFinite(cfg.sepV) || cfg.sepV < 0 || !Number.isInteger(cfg.seed)) throw new Error('Invalid separation or seed');
    if (typeof cfg.window !== 'number' || !(cfg.window > 0)) throw new Error('Horizon must be positive or Infinity');
    if (![cfg.timeStep, cfg.holdStep].every(v => Number.isFinite(v) && v > 0) || !(cfg.removeProbability >= 0 && cfg.removeProbability <= 1))
      throw new Error('Invalid neighborhood step sizes or removal probability');
    cfg.weights = CM.fitnessWeights(cfg.weights);
    const R = CM.rng(cfg.seed), win = routes.map(r => Math.min(r.t[r.t.length - 1], cfg.window));
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
    let current = record(routes.map(idle), 0, null, cfg.temperatureStart), bestIdx = current;
    rec.accepted.push(true);
    yield {gen: 0, best: rec.fit[bestIdx], evaluated: 1};
    for (let step = 1; step <= cfg.iterations; step++) {
      const fraction = (step - 1) / Math.max(1, cfg.iterations - 1), ratio = cfg.temperatureEnd / cfg.temperatureStart;
      // Geometric cooling; interpolate logarithms when the ratio underflows.
      const temperature = ratio > 0 ? cfg.temperatureStart * ratio ** fraction
        : step === 1 ? cfg.temperatureStart : step === cfg.iterations ? cfg.temperatureEnd
          : Math.exp((1 - fraction) * Math.log(cfg.temperatureStart) + fraction * Math.log(cfg.temperatureEnd));
      const genes = rec.genes[current].map(g => g.slice()), a = R.int(0, routes.length);
      genes[a] = neighbor(R, genes[a], routes[a], cfg, win[a]);
      const id = record(genes, step, current, temperature), delta = rec.fit[current] - rec.fit[id];
      // Metropolis rule on E = 1 - fitness.
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
  root.AnnealingSolver = {DEFAULTS, run, runSync, neighbor, randomManeuver};
  if (typeof module !== 'undefined' && module.exports) module.exports = root.AnnealingSolver;
})(typeof globalThis !== 'undefined' ? globalThis : this);
