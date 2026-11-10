// ORCA for the toy scenarios, with a velocity disc and reciprocal pairwise constraints.
// Geometry follows van den Berg et al., https://gamma.cs.unc.edu/ORCA/.
// The small 2D convex problem is solved by enumerating its possible optimal boundary points.
(function (root) {
  'use strict';
  const CM = root.ConflictModel || require('./model.js');
  const DEFAULTS = Object.freeze({seed: 0, sep: 7, sepV: 1000, vertical: false, dt: 10, horizon: 400,
    maxTime: 1800, safetyMargin: 0.00001, window: Infinity});
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1];
  const det = (a, b) => a[0] * b[1] - a[1] * b[0];
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1]];
  const mul = (a, s) => [a[0] * s, a[1] * s];
  const norm = a => Math.hypot(a[0], a[1]);
  const unit = (a, fallback = [1, 0]) => norm(a) > 1e-14 ? mul(a, 1 / norm(a)) : fallback;
  const clonePath = p => ({x: p.x.slice(), y: p.y.slice(), t: p.t.slice(), tz: p.tz.slice(), z: p.z.slice()});
  function append(p, point, time) {
    if (time <= p.t.at(-1)) return;
    p.x.push(point[0]); p.y.push(point[1]); p.t.push(time); p.tz.push(time); p.z.push(p.z[0]);
  }

  function pairConstraint(position, velocity, otherPosition, otherVelocity, radius, horizon, dt, tie = 1) {
    const p = sub(otherPosition, position), v = sub(velocity, otherVelocity), distance2 = dot(p, p);
    let direction, correction;
    // Contact belongs to the non-overlapping case, including roundoff at the boundary.
    if (distance2 >= radius * radius - 1e-10) {
      const w = sub(v, mul(p, 1 / horizon)), projection = dot(w, p), length2 = dot(w, w);
      if (projection < 0 && projection * projection > radius * radius * length2) {
        const normal = unit(w, mul(unit(p), -1));
        direction = [normal[1], -normal[0]];
        correction = mul(normal, radius / horizon - Math.sqrt(length2));
      } else {
        const leg = Math.sqrt(Math.max(0, distance2 - radius * radius));
        direction = det(p, w) > 0
          ? [(p[0] * leg - p[1] * radius) / distance2, (p[0] * radius + p[1] * leg) / distance2]
          : [-(p[0] * leg + p[1] * radius) / distance2, -(-p[0] * radius + p[1] * leg) / distance2];
        correction = sub(mul(direction, dot(v, direction)), v);
      }
    } else {
      const w = sub(v, mul(p, 1 / dt)), normal = unit(w, [tie, 0]);
      direction = [normal[1], -normal[0]];
      correction = mul(normal, radius / dt - norm(w));
    }
    const normal = [-direction[1], direction[0]];
    const point = [velocity[0] + correction[0] / 2, velocity[1] + correction[1] / 2];
    return {normal, offset: dot(normal, point)};
  }

  function feasibleVelocity(constraints, preferred, speed, relaxation = 0) {
    const clipped = norm(preferred) > speed ? mul(unit(preferred), speed) : preferred;
    const candidates = [clipped, [0, 0]];
    const lines = constraints.map(c => ({normal: c.normal, offset: c.offset - relaxation}));
    for (const line of lines) {
      const n = line.normal, b = line.offset, projection = dot(n, preferred) - b;
      candidates.push(sub(preferred, mul(n, projection)));
      const radius2 = speed * speed - b * b;
      if (radius2 >= -1e-14) {
        const half = Math.sqrt(Math.max(0, radius2)), tangent = [-n[1], n[0]], base = mul(n, b);
        candidates.push([base[0] + half * tangent[0], base[1] + half * tangent[1]],
          [base[0] - half * tangent[0], base[1] - half * tangent[1]]);
      }
    }
    for (let a = 0; a < lines.length; a++) for (let b = a + 1; b < lines.length; b++) {
      const A = lines[a], B = lines[b], d = det(A.normal, B.normal);
      if (Math.abs(d) > 1e-12) candidates.push([
        (A.offset * B.normal[1] - A.normal[1] * B.offset) / d,
        (A.normal[0] * B.offset - A.offset * B.normal[0]) / d]);
    }
    let best = null, cost = Infinity;
    for (const candidate of candidates) {
      if (!candidate.every(Number.isFinite) || norm(candidate) > speed + 1e-10 || lines.some(c => dot(c.normal, candidate) < c.offset - 1e-10)) continue;
      const delta = sub(candidate, preferred), value = dot(delta, delta);
      if (value < cost) { best = candidate; cost = value; }
    }
    return best;
  }
  function solveVelocity(constraints, preferred, speed) {
    const solution = feasibleVelocity(constraints, preferred, speed);
    if (solution) return {velocity: solution, feasible: true, violation: 0};
    // Infeasible ORCA halfplanes: explicitly report the least necessary common relaxation.
    let lo = 0, hi = Math.max(1, ...constraints.map(c => c.offset + speed));
    for (let i = 0; i < 45; i++) {
      const mid = (lo + hi) / 2;
      if (feasibleVelocity(constraints, preferred, speed, mid)) hi = mid; else lo = mid;
    }
    const velocity = feasibleVelocity(constraints, preferred, speed, hi + 1e-10) || [0, 0];
    return {velocity, feasible: false, violation: Math.max(0, ...constraints.map(c => c.offset - dot(c.normal, velocity)))};
  }

  function* run(routes, options = {}) {
    const cfg = {...DEFAULTS, ...options};
    if (!Array.isArray(routes) || !routes.length || ![cfg.sep, cfg.dt, cfg.horizon, cfg.maxTime].every(v => Number.isFinite(v) && v > 0)
      || !Number.isFinite(cfg.sepV) || cfg.sepV < 0 || !Number.isFinite(cfg.safetyMargin) || cfg.safetyMargin < 0
      || !Number.isInteger(cfg.seed) || cfg.vertical || cfg.maxTime < cfg.dt || cfg.horizon < cfg.dt || typeof cfg.window !== 'number' || !(cfg.window > 0))
      throw new Error('Invalid ORCA scenario, timing or separation parameters');
    cfg.weights = CM.fitnessWeights(cfg.weights);
    const agents = routes.map((r, index) => {
      if (!r || ![r.x, r.y, r.t, r.z].every(a => Array.isArray(a) && a.length >= 2 && a.every(Number.isFinite))
        || r.x.length !== r.t.length || r.y.length !== r.t.length || r.z.length !== r.t.length
        || r.t[0] !== 0 || r.t.some((t, i) => i && t <= r.t[i - 1]) || r.z.some(z => z !== r.z[0]))
        throw new Error('ORCA requires finite routes starting at zero with constant altitude');
      const position = [r.x[0], r.y[0]], goal = [r.x.at(-1), r.y.at(-1)];
      const speed = Math.hypot(r.x[1] - r.x[0], r.y[1] - r.y[0]) / (r.t[1] - r.t[0]);
      if (!(speed > 0) || norm(sub(goal, position)) < 1e-9) throw new Error('ORCA requires positive route speed and distinct endpoints');
      const velocity = mul(unit(sub(goal, position)), speed);
      return {index, position, goal, speed, velocity, arrived: false};
    });
    const executed = agents.map((a, i) => ({x: [a.position[0]], y: [a.position[1]], t: [0], tz: [0], z: [routes[i].z[0]]}));
    const rec = {algorithm: 'orca', cfg, paths: [], gen: [], origin: [], fit: [], meta: [], controls: []};
    const evaluation = {sep: cfg.sep, sepV: cfg.sepV, tmax: cfg.window, weights: cfg.weights};
    let bestIdx = 0, infeasibleSteps = 0, maxViolation = 0, step = 0, time = 0;
    const applied = [];
    function record(paths, kind, commands, at, infeasible = []) {
      const id = rec.paths.length, e = CM.evaluatePaths(routes, paths, evaluation);
      rec.paths.push(paths); rec.gen.push(step); rec.origin.push(kind === 'baseline' ? 'B' : kind === 'executed' ? 'EXECUTED' : `O_${step}`);
      rec.fit.push(e.fitness); rec.controls.push(commands);
      rec.meta.push({kind, time_s: at, infeasible_agents: infeasible.slice(), horizon_s: cfg.horizon,
        objective: commands.length ? commands.reduce((sum, command) => sum + command.local_objective, 0) : null,
        objective_scope: kind === 'executed' ? 'sum of applied local velocity objectives' : 'sum of next-command velocity objectives',
        ...(kind === 'executed' ? {termination: 'reached_goals', completed: true} : {})});
      if (rec.fit[id] > rec.fit[bestIdx]) bestIdx = id;
      return id;
    }
    record(routes.map(r => clonePath(CM.fullPath(r, [0, 0, 0, 0]))), 'baseline', [], 0);
    yield {gen: 0, best: rec.fit[bestIdx], evaluated: rec.paths.length};
    while (agents.some(a => !a.arrived) && time < cfg.maxTime) {
      const dt = Math.min(cfg.dt, cfg.maxTime - time), active = agents.filter(a => !a.arrived), proposed = new Map(), preferences = new Map(), infeasible = [];
      for (const a of active) {
        const preferred = mul(unit(sub(a.goal, a.position)), Math.min(a.speed, norm(sub(a.goal, a.position)) / dt));
        preferences.set(a.index, preferred);
        const constraints = active.filter(b => b !== a).map(b => pairConstraint(a.position, a.velocity, b.position, b.velocity,
          cfg.sep + cfg.safetyMargin, cfg.horizon, dt, a.index < b.index ? -1 : 1));
        const next = solveVelocity(constraints, preferred, a.speed);
        if (!next.feasible) infeasible.push(a.index);
        maxViolation = Math.max(maxViolation, next.violation); proposed.set(a.index, next.velocity);
      }
      if (infeasible.length) infeasibleSteps++;
      const forecast = executed.map(clonePath), commands = [];
      for (const a of active) {
        const v = proposed.get(a.index), toGoal = sub(a.goal, a.position), speed2 = dot(v, v);
        const arrival = speed2 > 1e-20 ? dot(toGoal, v) / speed2 : Infinity;
        const reaches = arrival > 0 && arrival <= dt + 1e-8 && norm(sub(toGoal, mul(v, arrival))) < 1e-8;
        const duration = reaches ? Math.min(dt, arrival) : dt;
        const point = reaches ? a.goal.slice() : [a.position[0] + v[0] * duration, a.position[1] + v[1] * duration];
        append(forecast[a.index], point, time + duration);
        if (!reaches) append(forecast[a.index], a.goal, time + duration + norm(sub(a.goal, point)) / a.speed);
        const preferred = preferences.get(a.index);
        const command = {aircraft_index: a.index, start_s: time, end_s: time + duration,
          vx_nm_s: v[0], vy_nm_s: v[1], speed_kt: norm(v) * 3600,
          preferred_vx_nm_s: preferred[0], preferred_vy_nm_s: preferred[1],
          local_objective: (v[0] - preferred[0]) ** 2 + (v[1] - preferred[1]) ** 2,
          heading_deg: (Math.atan2(v[0], -v[1]) * 180 / Math.PI + 360) % 360, arrived: reaches};
        commands.push(command); applied.push({...command});
        append(executed[a.index], point, time + duration);
        a.position = point; a.velocity = v; a.arrived = reaches;
      }
      step++;
      record(forecast, 'forecast', commands, time, infeasible);
      time += dt;
      yield {gen: step, best: rec.fit[bestIdx], evaluated: rec.paths.length};
    }
    if (agents.some(a => !a.arrived)) throw new Error('ORCA reached its time limit before every aircraft reached its destination');
    const finalIdx = record(executed.map(clonePath), 'executed', applied, Math.max(...executed.map(p => p.t.at(-1))));
    return {...rec, bestIdx, finalIdx, diagnostics: {completed: true, termination: 'reached_goals',
      infeasible_steps: infeasibleSteps, maximum_velocity_constraint_violation: maxViolation,
      speed_control: '0 to each original route speed', forecast: 'executed prefix, next ORCA command, then direct-to-goal continuation'}};
  }
  const runSync = (routes, options) => { const iterator = run(routes, options); let step; do { step = iterator.next(); } while (!step.done); return step.value; };
  root.OrcaSolver = {DEFAULTS, run, runSync, pairConstraint, solveVelocity};
  if (typeof module !== 'undefined' && module.exports) module.exports = root.OrcaSolver;
})(typeof globalThis !== 'undefined' ? globalThis : this);
