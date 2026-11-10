// Binary catalogue selection: one option per aircraft and no incompatible pair.
// Exact branch-and-bound for this finite formulation; a node limit is never an optimality certificate.
(function (root) {
  'use strict';
  const CM = root.ConflictModel || require('./model.js');
  const DEFAULTS = Object.freeze({sep: 7, sepV: 1000, seed: 0, vertical: false, window: Infinity,
    starts: [0, 60], holds: [180, 300, 420], angles: [-40, -30, -20, -10, 10, 20, 30, 40],
    nodeLimit: 200000, yieldEvery: 250});

  function settings(options = {}) {
    const cfg = {...DEFAULTS, ...options};
    if (!Number.isFinite(cfg.sep) || cfg.sep <= 0 || !Number.isFinite(cfg.sepV) || cfg.sepV < 0 || !Number.isInteger(cfg.seed))
      throw new Error('Invalid separation or seed');
    cfg.tmax = options.tmax ?? cfg.window;
    if (typeof cfg.tmax !== 'number' || !(cfg.tmax > 0)) throw new Error('Horizon must be positive or Infinity');
    if (!Number.isInteger(cfg.nodeLimit) || cfg.nodeLimit < 1 || !Number.isInteger(cfg.yieldEvery) || cfg.yieldEvery < 1)
      throw new Error('Node limit and progress interval must be positive integers');
    cfg.weights = CM.fitnessWeights(cfg.weights);
    return cfg;
  }
  function validatePath(path) {
    if (!path || !Array.isArray(path.t) || path.t.length < 2 || !Array.isArray(path.tz) || !path.tz.length)
      throw new Error('Each catalogue option needs a timed 3D path');
    for (const [time, coordinates] of [[path.t, [path.x, path.y]], [path.tz, [path.z]]]) {
      if (!time.every((t, k) => Number.isFinite(t) && (!k || t > time[k - 1])) ||
          coordinates.some(values => !Array.isArray(values) || values.length !== time.length || !values.every(Number.isFinite)))
        throw new Error('Catalogue paths need finite coordinates and increasing times');
    }
  }

  function makeCatalogue(routes, options = {}) {
    const cfg = settings(options);
    if (!Array.isArray(routes) || !routes.length) throw new Error('At least one aircraft is required');
    if (cfg.vertical) throw new Error('Catalogue maneuvers currently keep the original altitude');
    for (const [values, valid] of [[cfg.starts, v => v >= 0], [cfg.holds, v => v > 0], [cfg.angles, v => v !== 0 && Math.abs(v) <= 40]])
      if (!Array.isArray(values) || !values.every(v => Number.isFinite(v) && valid(v))) throw new Error('Invalid catalogue timings or angles');
    return routes.map(route => {
      const start = CM.commandStart(route), end = route.t.at(-1), genes = [[route.t[0], route.t[0], 0, 0]], seen = new Set([JSON.stringify(genes[0])]);
      for (const delay of cfg.starts) for (const hold of cfg.holds) for (const angle of cfg.angles) {
        const t1 = start + delay, t2 = Math.min(end, t1 + hold);
        if (!(t1 < end && t2 > t1)) continue;
        const gene = [t1, t2, angle, 0], key = JSON.stringify(gene);
        if (!seen.has(key)) { genes.push(gene); seen.add(key); }
      }
      return genes.map(gene => {
        const path = CM.fullPath(route, gene); validatePath(path);
        const evaluation = CM.evaluate([route], [gene], {weights: cfg.weights});
        return {gene, path, extra: evaluation.extra, maneuvering: evaluation.nMan,
          cost: cfg.weights.length * evaluation.extra + cfg.weights.maneuver * evaluation.nMan};
      });
    });
  }

  // Returns a selection certificate for the supplied options, costs and evaluation interval.
  function* solveCatalogue(catalogues, options = {}) {
    const cfg = settings(options), n = catalogues?.length;
    if (!Array.isArray(catalogues) || !n || catalogues.some(c => !Array.isArray(c) || !c.length))
      throw new Error('Each aircraft requires at least one catalogue option');
    catalogues.forEach(c => c.forEach(option => validatePath(option.path)));
    const costs = options.costs ?? catalogues.map(c => c.map(option => option.cost));
    if (!Array.isArray(costs) || costs.length !== n || costs.some((c, i) => !Array.isArray(c) || c.length !== catalogues[i].length || !c.every(Number.isFinite)))
      throw new Error('Every catalogue option needs one finite cost');
    const compatibility = Array.from({length: n}, () => []);
    let checks = 0, incompatibilities = 0;
    for (let a = 0; a < n; a++) for (let b = a + 1; b < n; b++) {
      const width = catalogues[b].length, table = new Uint8Array(catalogues[a].length * width);
      compatibility[a][b] = table;
      for (let i = 0; i < catalogues[a].length; i++) for (let j = 0; j < width; j++) {
        const pair = CM.pairStats(catalogues[a][i].path, catalogues[b][j].path, cfg.sep, cfg.sepV, cfg.tmax);
        const safe = pair.dmin >= cfg.sep && pair.conflict === 0;
        table[i * width + j] = safe ? 1 : 0; if (!safe) incompatibilities++;
        checks++;
        if (checks % cfg.yieldEvery === 0) yield {type: 'progress', phase: 'compatibility', checks, nodes: 0, completeAssignments: 0};
      }
    }
    const order = costs.map(row => row.map((_, i) => i).sort((a, b) => row[a] - row[b] || a - b));
    const suffix = new Array(n + 1).fill(0);
    for (let a = n - 1; a >= 0; a--) suffix[a] = suffix[a + 1] + costs[a][order[a][0]];
    const chosen = new Array(n);
    let nodes = 0, completeAssignments = 0, best = null, bestCost = Infinity, limited = false;
    function* visit(depth, cost) {
      if (nodes >= cfg.nodeLimit) { limited = true; return; }
      nodes++;
      if (nodes % cfg.yieldEvery === 0) yield {type: 'progress', phase: 'search', nodes, completeAssignments, cost: bestCost};
      let compatible = true;
      if (depth > 1) for (let a = 0; a < depth - 1; a++) {
        const b = depth - 1;
        if (!compatibility[a][b][chosen[a] * catalogues[b].length + chosen[b]]) { compatible = false; break; }
      }
      if (depth === n) {
        completeAssignments++;
        const incumbent = compatible && cost < bestCost;
        if (incumbent) { best = chosen.slice(); bestCost = cost; }
        yield {type: 'assignment', phase: 'search', choice: chosen.slice(), cost, compatible, incumbent, nodes, completeAssignments};
        return;
      }
      if (!compatible || cost + suffix[depth] >= bestCost) return;
      for (const option of order[depth]) {
        chosen[depth] = option;
        yield* visit(depth + 1, cost + costs[depth][option]);
        if (limited) return;
      }
    }
    yield* visit(0, 0);
    const termination = limited ? 'node-limit' : best ? 'optimal' : 'infeasible';
    return {choice: best, cost: bestCost, termination, provenOptimal: termination === 'optimal',
      nodes, completeAssignments, checks, incompatibilities,
      binaryVariables: catalogues.reduce((sum, c) => sum + c.length, 0),
      lowerBound: limited ? suffix[0] : bestCost};
  }
  function solveCatalogueSync(catalogues, cfg) {
    const iterator = solveCatalogue(catalogues, cfg); let step;
    do { step = iterator.next(); } while (!step.done);
    return step.value;
  }

  function* run(routes, options = {}) {
    const cfg = settings(options), catalogues = makeCatalogue(routes, cfg);
    const rec = {genes: [], gen: [], origin: [], fit: [], dmin: [], conflict: [], perAircraft: [], meta: [], controls: []};
    const cache = new Map(); let bestIdx = 0;
    function add(genes, origin, meta) {
      const key = JSON.stringify(genes);
      if (!cache.has(key)) cache.set(key, CM.evaluate(routes, genes, {sep: cfg.sep, sepV: cfg.sepV, tmax: cfg.tmax, weights: cfg.weights}));
      const evaluation = cache.get(key), id = rec.genes.length;
      rec.genes.push(genes.map(g => g.slice())); rec.gen.push(meta.nodes ?? 0); rec.origin.push(origin);
      rec.fit.push(evaluation.fitness); rec.dmin.push(evaluation.dmin); rec.conflict.push(evaluation.conflict); rec.perAircraft.push(evaluation.perAircraft); rec.meta.push(meta);
      rec.controls.push(genes.flatMap((gene, a) => CM.hActive(routes[a], gene) ? [
        {aircraft_index: a, t_s: gene[0], kind: 'turn', alpha_deg: gene[2]},
        {aircraft_index: a, t_s: gene[1], kind: 'direct'}] : []));
      if (evaluation.fitness > rec.fit[bestIdx]) bestIdx = id;
      return id;
    }
    add(catalogues.map(c => c[0].gene), 'B', {kind: 'baseline', objective: catalogues.reduce((sum, c) => sum + c[0].cost, 0)});
    yield {gen: 0, best: rec.fit[bestIdx], evaluated: rec.genes.length, phase: 'catalogue'};
    const iterator = solveCatalogue(catalogues, cfg); let step, finalIdx = 0;
    do {
      step = iterator.next();
      if (!step.done) {
        const event = step.value;
        if (event.type === 'assignment') {
          const id = add(event.choice.map((k, a) => catalogues[a][k].gene), `L_${event.nodes}`,
            {kind: 'complete-assignment', objective: event.cost, compatible: event.compatible, incumbent: event.incumbent, nodes: event.nodes});
          if (event.incumbent) finalIdx = id;
        }
        yield {gen: event.nodes, best: rec.fit[bestIdx], evaluated: rec.genes.length, phase: event.phase};
      }
    } while (!step.done);
    const certificate = step.value;
    if (!certificate.choice) finalIdx = bestIdx;
    rec.meta[finalIdx] = {...rec.meta[finalIdx], ...certificate};
    return {...rec, algorithm: 'milp', cfg, bestIdx, finalIdx, best: rec.genes[bestIdx],
      termination: certificate.termination, objective: certificate.cost, certificate,
      catalogue: catalogues.map(c => c.map(({gene, cost}) => ({gene: gene.slice(), cost})))};
  }
  function runSync(routes, cfg) {
    const iterator = run(routes, cfg); let step;
    do { step = iterator.next(); } while (!step.done);
    return step.value;
  }
  root.MILPSolver = {DEFAULTS, makeCatalogue, solveCatalogue, solveCatalogueSync, run, runSync};
  if (typeof module !== 'undefined' && module.exports) module.exports = root.MILPSolver;
})(typeof globalThis !== 'undefined' ? globalThis : this);
