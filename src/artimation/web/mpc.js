// Receding-horizon control: optimize a finite set of plans, execute one interval, then replan.
(function (root) {
  'use strict';
  const CM = root.ConflictModel || require('./model.js');
  const MILP = root.MILPSolver || require('./milp.js');
  const COST_WEIGHTS = Object.freeze({distance: 0.02, maneuver: 0.05, continuity: 0.01, terminal: 0.002});
  const DEFAULTS = Object.freeze({horizon: 400, controlStep: 20, maxTime: 1800, nodeLimit: 100000,
    seed: 0, sep: 7, sepV: 1000, vertical: false, costWeights: COST_WEIGHTS});
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
    if (!cfg.costWeights || Object.keys(cfg.costWeights).some(k => !Object.hasOwn(COST_WEIGHTS, k)) ||
        Object.values(cfg.costWeights).some(v => !Number.isFinite(v) || v < 0)) throw new Error('Invalid MPC cost weights');
    routes.forEach(r => {
      if (!r || r.enacStart || !Array.isArray(r.xy) || r.xy.length !== 2 || r.xy.some(p => !Array.isArray(p) || p.length !== 2 || !p.every(Number.isFinite)) ||
          !Array.isArray(r.t) || r.t.length !== 2 || !r.t.every(Number.isFinite) || r.t[1] <= r.t[0] || r.t[0] !== routes[0].t[0] ||
          !Array.isArray(r.z) || r.z.length !== 2 || !r.z.every(Number.isFinite) || r.z[0] !== r.z[1] || distance(r.xy[0], r.xy[1]) <= 0)
        throw new Error('MPC requires straight, constant-altitude routes with a common start time');
    });
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
      // shortcut: optimize a finite maneuver catalogue; expand it for richer aircraft dynamics.
      const catalogues = MILP.makeCatalogue(currentRoutes, {...cfg, vertical: false});
      active.forEach((i, a) => {
        if (!previous || last(previous[i].t) <= time) return;
        const path = clip(previous[i], time), extra = Math.max(0, pathLength(path) - CM.routeLength(currentRoutes[a]));
        const key = JSON.stringify([path.t, path.x, path.y]);
        if (!catalogues[a].some(o => JSON.stringify([o.path.t, o.path.x, o.path.y]) === key))
          catalogues[a].push({gene: null, path, cost: 0, extra, maneuvering: extra > 1e-7, shifted: true});
      });
      const costs = catalogues.map((catalogue, a) => catalogue.map(o => {
        const i = active[a], v = velocityAt(o.path, time), delta = ((v[0] - velocities[i][0]) ** 2 + (v[1] - velocities[i][1]) ** 2) / (speed[i] ** 2);
        const terminal = distance(xyAt(o.path, time + cfg.horizon), goals[i]), w = cfg.costWeights;
        return w.distance * o.extra + w.maneuver * Number(o.maneuvering) + w.continuity * delta + w.terminal * terminal;
      }));
      const solution = MILP.solveCatalogueSync(catalogues, {sep: cfg.sep, sepV: cfg.sepV, tmax: time + cfg.horizon, nodeLimit: cfg.nodeLimit, costs});
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
  root.MPCSolver = {DEFAULTS, COST_WEIGHTS, OBJECTIVE, run, runSync};
  if (typeof module !== 'undefined' && module.exports) module.exports = root.MPCSolver;
})(typeof globalThis !== 'undefined' ? globalThis : this);
