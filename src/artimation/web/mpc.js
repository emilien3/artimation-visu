// Receding-horizon control. Self-contained: its own maneuver set, its own exact horizon optimizer and its own
// replanning loop. It only uses the common trajectory model (model.js).
// Each cycle: build candidate plans from the current positions, pick the cheapest conflict-free joint plan over the
// prediction horizon, execute one control interval, then replan.
(function (root) {
  'use strict';
  const CM = root.ConflictModel || require('./model.js');
  const COST_WEIGHTS = Object.freeze({distance: 0.02, maneuver: 0.05, continuity: 0.01, terminal: 0.002});
  const DEFAULTS = Object.freeze({horizon: 400, controlStep: 20, maxTime: 1800, nodeLimit: 100000,
    seed: 0, sep: 7, sepV: 1000, vertical: false, costWeights: COST_WEIGHTS,
    // Candidate maneuvers at each replan: turn after `starts` s, hold the heading for `holds` s, then fly direct.
    starts: [0, 60], holds: [180, 300, 420], angles: [-40, -30, -20, -10, 10, 20, 30, 40]});
  const OBJECTIVE = 'sum_i(0.02*added_distance_nm_i + 0.05*maneuver_i + 0.01*||v_first_i-v_previous_i||^2/v_nominal_i^2 + 0.002*distance_to_goal_at_horizon_nm_i)';
  const last = a => a[a.length - 1];
  const distance = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
  const xyAt = (p, t) => [CM.interp(p.t, p.x, t), CM.interp(p.t, p.y, t)];
  function pathLength(p) {
    let length = 0;
    for (let k = 1; k < p.t.length; k++) length += Math.hypot(p.x[k] - p.x[k - 1], p.y[k] - p.y[k - 1]);
    return length;
  }
  function velocityAt(p, time) {
    let k = 0;
    while (k + 1 < p.t.length - 1 && p.t[k + 1] <= time) k++;
    const dt = p.t[k + 1] - p.t[k];
    return [(p.x[k + 1] - p.x[k]) / dt, (p.y[k + 1] - p.y[k]) / dt];
  }
  function clip(p, start, end = last(p.t)) {
    const finish = Math.min(end, last(p.t));
    if (!(finish > start)) throw new Error('MPC cannot execute an empty path interval');
    const t = [start, ...p.t.filter(t => t > start && t < finish), finish];
    const z = CM.interp(p.tz, p.z, start);
    return {x: t.map(t => CM.interp(p.t, p.x, t)), y: t.map(t => CM.interp(p.t, p.y, t)), t, tz: [start, finish], z: [z, z]};
  }
  function append(prefix, tail) {
    if (Math.abs(last(prefix.t) - tail.t[0]) > 1e-7 || distance([last(prefix.x), last(prefix.y)], [tail.x[0], tail.y[0]]) > 1e-7)
      throw new Error('MPC path continuity check failed');
    const t = [...prefix.t, ...tail.t.slice(1)], z = prefix.z[0];
    return {x: [...prefix.x, ...tail.x.slice(1)], y: [...prefix.y, ...tail.y.slice(1)], t, tz: [t[0], last(t)], z: [z, z]};
  }
  function validate(routes, cfg) {
    if (!Array.isArray(routes) || !routes.length || routes.length > 4) throw new Error('MPC requires one to four aircraft');
    if (![cfg.horizon, cfg.controlStep, cfg.maxTime, cfg.sep].every(v => Number.isFinite(v) && v > 0) || cfg.controlStep > cfg.horizon || cfg.maxTime < cfg.controlStep ||
        !Number.isFinite(cfg.sepV) || cfg.sepV < 0 || !Number.isInteger(cfg.nodeLimit) || cfg.nodeLimit < 1 || !Number.isInteger(cfg.seed))
      throw new Error('Invalid MPC horizon, interval, budget, separation or seed');
    if (cfg.vertical) throw new Error('MPC currently uses constant altitude');
    for (const [values, valid] of [[cfg.starts, v => v >= 0], [cfg.holds, v => v > 0], [cfg.angles, v => v !== 0 && Math.abs(v) <= 40]])
      if (!Array.isArray(values) || !values.every(v => Number.isFinite(v) && valid(v))) throw new Error('Invalid MPC maneuver timings or angles');
    if (!cfg.costWeights || Object.keys(cfg.costWeights).some(k => !Object.hasOwn(COST_WEIGHTS, k)) ||
        Object.values(cfg.costWeights).some(v => !Number.isFinite(v) || v < 0)) throw new Error('Invalid MPC cost weights');
    routes.forEach(r => {
      if (!r || r.enacStart || !Array.isArray(r.xy) || r.xy.length !== 2 || r.xy.some(p => !Array.isArray(p) || p.length !== 2 || !p.every(Number.isFinite)) ||
          !Array.isArray(r.t) || r.t.length !== 2 || !r.t.every(Number.isFinite) || r.t[1] <= r.t[0] || r.t[0] !== routes[0].t[0] ||
          !Array.isArray(r.z) || r.z.length !== 2 || !r.z.every(Number.isFinite) || r.z[0] !== r.z[1] || distance(r.xy[0], r.xy[1]) <= 0)
        throw new Error('MPC requires straight, constant-altitude routes with a common start time');
    });
  }

  // Candidate plans for each aircraft from its current position: the direct route first, then every timed turn.
  function candidatePlans(routes, cfg) {
    return routes.map(route => {
      const start = route.t[0], end = last(route.t), genes = [[start, start, 0, 0]], seen = new Set([JSON.stringify(genes[0])]);
      for (const delay of cfg.starts) for (const hold of cfg.holds) for (const angle of cfg.angles) {
        const t1 = start + delay, t2 = Math.min(end, t1 + hold);
        if (!(t1 < end && t2 > t1)) continue;
        const gene = [t1, t2, angle, 0], key = JSON.stringify(gene);
        if (!seen.has(key)) { genes.push(gene); seen.add(key); }
      }
      return genes.map(gene => {
        const path = CM.fullPath(route, gene);
        return {gene, path, extra: Math.max(0, pathLength(path) - CM.routeLength(route)), maneuvering: Number(CM.hActive(route, gene))};
      });
    });
  }
  // Exact horizon optimization: one plan per aircraft, no conflicting pair before `tmax`, minimum total cost.
  // Depth-first branch and bound; a node limit is reported and is never an optimality certificate.
  function selectPlans(plans, costs, cfg) {
    const n = plans.length, compatible = Array.from({length: n}, () => []);
    for (let a = 0; a < n; a++) for (let b = a + 1; b < n; b++)
      compatible[a][b] = plans[a].map(p => plans[b].map(q => { const s = CM.pairStats(p.path, q.path, cfg.sep, cfg.sepV, cfg.tmax); return s.dmin >= cfg.sep && s.conflict === 0; }));
    const order = costs.map(row => row.map((_, i) => i).sort((a, b) => row[a] - row[b] || a - b)), bound = new Array(n + 1).fill(0);
    for (let a = n - 1; a >= 0; a--) bound[a] = bound[a + 1] + costs[a][order[a][0]];
    const chosen = new Array(n);
    let nodes = 0, best = null, bestCost = Infinity, limited = false;
    (function visit(depth, cost) {
      if (nodes >= cfg.nodeLimit) { limited = true; return; }
      nodes++;
      for (let a = 0; a < depth - 1; a++) if (!compatible[a][depth - 1][chosen[a]][chosen[depth - 1]]) return;
      if (depth === n) { if (cost < bestCost) { best = chosen.slice(); bestCost = cost; } return; }
      if (cost + bound[depth] >= bestCost) return;
      for (const option of order[depth]) { chosen[depth] = option; visit(depth + 1, cost + costs[depth][option]); if (limited) return; }
    })(0, 0);
    return {choice: best, cost: bestCost, nodes, termination: limited ? 'node-limit' : best ? 'optimal' : 'infeasible'};
  }

  function* run(routes, options = {}) {
    const cfg = {...DEFAULTS, ...options, costWeights: {...COST_WEIGHTS, ...options.costWeights}};
    validate(routes, cfg); cfg.weights = CM.fitnessWeights(cfg.weights);
    const opts = {sep: cfg.sep, sepV: cfg.sepV, weights: cfg.weights};
    const goals = routes.map(r => last(r.xy)), speed = routes.map(r => distance(r.xy[0], last(r.xy)) / (last(r.t) - r.t[0]));
    const originTime = routes[0].t[0], limit = originTime + cfg.maxTime;
    let time = originTime, step = 0, previous = null, termination = 'max-time';
    const executed = routes.map(r => ({x: [r.x[0]], y: [r.y[0]], t: [originTime], tz: [originTime], z: [r.z[0]]}));
    const done = routes.map(() => false), velocities = routes.map(r => velocityAt(CM.fullPath(r, [r.t[0], r.t[0], 0, 0]), originTime));
    const rec = {algorithm: 'mpc', cfg, paths: [], gen: [], origin: [], fit: [], meta: [], controls: [], finalControls: []};
    function record(paths, kind, method, commands = []) {
      const id = rec.paths.length;
      rec.paths.push(paths.map(p => ({x: p.x.slice(), y: p.y.slice(), t: p.t.slice(), tz: p.tz.slice(), z: p.z.slice()})));
      rec.gen.push(step); rec.origin.push(kind === 'baseline' ? 'B' : kind === 'forecast' ? `MPC_${step}` : 'EXECUTED');
      rec.fit.push(CM.evaluatePaths(routes, paths, opts).fitness);
      rec.meta.push({kind, time_s: time, ...method}); rec.controls.push(commands);
      return id;
    }
    record(routes.map(r => CM.fullPath(r, [r.t[0], r.t[0], 0, 0])), 'baseline', {objective: null, termination: 'reference'});
    yield {gen: 0, best: rec.fit[0], evaluated: 1};
    while (time < limit && !done.every(Boolean)) {
      step++;
      const active = routes.map((_, i) => i).filter(i => !done[i]);
      const currentRoutes = active.map(i => {
        const p = [last(executed[i].x), last(executed[i].y)], arrival = time + distance(p, goals[i]) / speed[i], z = routes[i].z[0];
        return CM.makeRoute([p, goals[i]], [time, arrival], [z, z]);
      });
      const catalogues = api.candidatePlans(currentRoutes, cfg);
      active.forEach((i, a) => {
        if (!previous || last(previous[i].t) <= time) return;
        const path = clip(previous[i], time), extra = Math.max(0, pathLength(path) - CM.routeLength(currentRoutes[a]));
        const key = JSON.stringify([path.t, path.x, path.y]);
        if (!catalogues[a].some(o => JSON.stringify([o.path.t, o.path.x, o.path.y]) === key))
          catalogues[a].push({gene: null, path, extra, maneuvering: extra > 1e-7, shifted: true});
      });
      const costs = catalogues.map((catalogue, a) => catalogue.map(o => {
        const i = active[a], v = velocityAt(o.path, time), delta = ((v[0] - velocities[i][0]) ** 2 + (v[1] - velocities[i][1]) ** 2) / (speed[i] ** 2);
        const terminal = distance(xyAt(o.path, time + cfg.horizon), goals[i]), w = cfg.costWeights;
        return w.distance * o.extra + w.maneuver * Number(o.maneuvering) + w.continuity * delta + w.terminal * terminal;
      }));
      const solution = api.selectPlans(catalogues, costs, {sep: cfg.sep, sepV: cfg.sepV, tmax: time + cfg.horizon, nodeLimit: cfg.nodeLimit});
      if (!solution.choice) { termination = solution.termination; break; }
      const plans = previous ? previous.slice() : new Array(routes.length);
      active.forEach((i, a) => { plans[i] = catalogues[a][solution.choice[a]].path; });
      const nextTime = Math.min(time + cfg.controlStep, limit);
      const intervals = active.map(i => clip(plans[i], time, nextTime));
      let safe = true;
      for (let a = 0; a < intervals.length; a++) for (let b = a + 1; b < intervals.length; b++) {
        const stats = CM.pairStats(intervals[a], intervals[b], cfg.sep, cfg.sepV);
        if (stats.conflict > 0 || stats.dmin < cfg.sep) safe = false;
      }
      const commands = [];
      intervals.forEach((p, a) => {
        const i = active[a];
        for (let k = 0; k < p.t.length - 1; k++) {
          const dt = p.t[k + 1] - p.t[k], vx = (p.x[k + 1] - p.x[k]) / dt, vy = (p.y[k + 1] - p.y[k]) / dt;
          commands.push({aircraft_index: i, time_s: p.t[k], duration_s: dt, heading_deg: (Math.atan2(vx, -vy) * 180 / Math.PI + 360) % 360,
            speed_kt: Math.hypot(vx, vy) * 3600, from_nm: [p.x[k], p.y[k]], to_nm: [p.x[k + 1], p.y[k + 1]], executed: safe});
        }
      });
      const forecast = routes.map((_, i) => done[i] ? executed[i] : append(executed[i], plans[i]));
      record(forecast, 'forecast', {objective: solution.cost, termination: solution.termination, horizon_end_s: time + cfg.horizon,
        control_end_s: nextTime, constraint_scope: 'prediction-horizon', first_interval_safe: safe,
        catalogue_sizes: catalogues.map(c => c.length), nodes: solution.nodes}, commands);
      if (!safe) { termination = 'unsafe-control-interval'; break; }
      active.forEach((i, a) => {
        const p = intervals[a];
        executed[i] = append(executed[i], p);
        velocities[i] = velocityAt(p, last(p.t));
        done[i] = distance([last(p.x), last(p.y)], goals[i]) < 1e-8 && last(p.t) === last(plans[i].t);
      });
      rec.finalControls.push(...commands); previous = plans;
      time = nextTime;
      yield {gen: step, best: Math.max(...rec.fit), evaluated: rec.paths.length};
    }
    if (done.every(Boolean)) termination = 'completed';
    rec.finalIdx = executed.every(p => p.t.length >= 2) ? record(executed, 'executed', {objective: null, termination, completed: done.every(Boolean)}, rec.finalControls) : null;
    rec.bestIdx = rec.fit.reduce((best, f, i) => f > rec.fit[best] ? i : best, 0);
    rec.termination = termination; rec.completed = done.every(Boolean); rec.replans = step;
    return rec;
  }
  const runSync = (routes, options) => { const it = run(routes, options); let s; do { s = it.next(); } while (!s.done); return s.value; };
  // The loop calls these through `api` so tests can observe each optimization.
  const api = {DEFAULTS, COST_WEIGHTS, OBJECTIVE, candidatePlans, selectPlans, run, runSync};
  root.MPCSolver = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
