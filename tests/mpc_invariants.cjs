const assert = require('node:assert/strict');
const CM = require('../src/artimation/web/model.js');
const E = require('../src/artimation/web/exploration.js');
const MPC = require('../src/artimation/web/mpc.js');
const near = (a, b, tolerance = 1e-8) => assert(Math.abs(a - b) <= tolerance, `${a} != ${b}`);
const at = (p, t) => [CM.interp(p.t, p.x, t), CM.interp(p.t, p.y, t)];

// Independent horizontal closest approach over exact piecewise-linear intervals.
function minimumDistance(a, b) {
  const lo = Math.max(a.t[0], b.t[0]), hi = Math.min(a.t.at(-1), b.t.at(-1));
  const times = [...new Set([...a.t, ...b.t, lo, hi])].filter(t => t >= lo && t <= hi).sort((a, b) => a - b);
  let minimum = Infinity;
  for (let k = 1; k < times.length; k++) {
    const t0 = times[k - 1], dt = times[k] - t0, a0 = at(a, t0), b0 = at(b, t0), a1 = at(a, t0 + dt), b1 = at(b, t0 + dt);
    const r = [a0[0] - b0[0], a0[1] - b0[1]], v = [(a1[0] - b1[0] - r[0]) / dt, (a1[1] - b1[1] - r[1]) / dt];
    const vv = v[0] ** 2 + v[1] ** 2, tau = vv ? Math.max(0, Math.min(dt, -(r[0] * v[0] + r[1] * v[1]) / vv)) : 0;
    minimum = Math.min(minimum, Math.hypot(r[0] + v[0] * tau, r[1] + v[1] * tau));
  }
  return minimum;
}

for (const key of ['crossing-2', 'convergence-4']) {
  const scn = E.scenario(key), original = JSON.stringify(scn.routes), result = MPC.runSync(scn.routes);
  assert.equal(JSON.stringify(scn.routes), original, 'The controller must not edit the input scenario');
  assert.equal(result.algorithm, 'mpc'); assert.equal(result.termination, 'completed'); assert(result.completed);
  assert(result.replans > 2); assert.equal(result.paths.length, result.replans + 2);
  assert.equal(result.bestIdx, result.fit.indexOf(Math.max(...result.fit)));
  assert.equal(result.finalIdx, result.paths.length - 1);
  assert.equal(result.meta[result.finalIdx].kind, 'executed');
  assert(result.meta.filter(m => m.kind === 'forecast').every(m => m.first_interval_safe));
  const actual = result.paths[result.finalIdx], evaluation = CM.evaluatePaths(scn.routes, actual);
  assert(evaluation.dmin >= 7); assert.equal(evaluation.conflict, 0);
  let independent = Infinity;
  for (let a = 0; a < actual.length; a++) for (let b = a + 1; b < actual.length; b++) independent = Math.min(independent, minimumDistance(actual[a], actual[b]));
  near(evaluation.dmin, independent);
  for (let i = 0; i < result.paths.length; i++) {
    const paths = result.paths[i], method = result.meta[i];
    near(result.fit[i], CM.evaluatePaths(scn.routes, paths).fitness);
    paths.forEach((p, a) => {
      assert(p.t.every((t, k) => Number.isFinite(t) && (!k || t > p.t[k - 1])));
      assert(p.z.every(z => z === 36000));
      near(p.x[0], scn.routes[a].x[0]); near(p.y[0], scn.routes[a].y[0]);
      near(p.x.at(-1), scn.routes[a].x.at(-1)); near(p.y.at(-1), scn.routes[a].y.at(-1));
      for (let k = 1; k < p.t.length; k++) near(Math.hypot(p.x[k] - p.x[k - 1], p.y[k] - p.y[k - 1]) / (p.t[k] - p.t[k - 1]) * 3600, 360, 1e-6);
      if (method.kind === 'forecast') {
        near(method.horizon_end_s, method.time_s + MPC.DEFAULTS.horizon);
        near(method.control_end_s, method.time_s + MPC.DEFAULTS.controlStep);
        for (const t of p.t.filter(t => t <= method.time_s)) {
          const expected = at(actual[a], t), recorded = at(p, t);
          near(recorded[0], expected[0]); near(recorded[1], expected[1]);
        }
      }
    });
  }
  assert(result.finalControls.every(c => c.executed && c.duration_s > 0 && c.duration_s <= 20 + 1e-8));
  for (const command of result.finalControls) {
    near(command.speed_kt, 360, 1e-6);
    const p = actual[command.aircraft_index], first = at(p, command.time_s), end = at(p, command.time_s + command.duration_s);
    command.from_nm.forEach((v, k) => near(v, first[k])); command.to_nm.forEach((v, k) => near(v, end[k]));
  }
  // Replanning changes the original forecast, while its executed prefix stays fixed.
  assert.notDeepEqual(result.paths[1], actual);
  assert.equal(result.meta[result.bestIdx].kind, 'forecast');
  assert.deepEqual(result, MPC.runSync(scn.routes), 'Identical deterministic inputs must reproduce the full controller trace');
}

// Inspect the actual optimization calls: the second plan must start only 20 s later, at the first plan's executed position.
const scn = E.scenario('crossing-2'), calls = [], candidatePlans = MPC.candidatePlans, selectPlans = MPC.selectPlans;
MPC.candidatePlans = (routes, cfg) => { calls.push({routes}); return candidatePlans(routes, cfg); };
MPC.selectPlans = (catalogues, costs, cfg) => {
  const selected = selectPlans(catalogues, costs, cfg), call = calls.at(-1);
  call.catalogues = catalogues; call.cfg = cfg; call.solution = selected;
  return selected;
};
try {
  const iterator = MPC.run(scn.routes);
  iterator.next(); iterator.next(); iterator.next(); iterator.return();
  assert.equal(calls.length, 2);
  calls[1].routes.forEach((r, a) => {
    near(r.t[0], 20);
    const expected = at(calls[0].catalogues[a][calls[0].solution.choice[a]].path, 20);
    r.xy[0].forEach((value, k) => near(value, expected[k]));
    near(Math.hypot(...r.xy[0].map((v, k) => v - scn.routes[a].xy[0][k])), 2);
  });
  near(calls[0].cfg.tmax, 400); near(calls[1].cfg.tmax, 420);
} finally { MPC.candidatePlans = candidatePlans; MPC.selectPlans = selectPlans; }

// The controller is self-contained: it must not load another solver, and its optimizer must be exact.
const source = require('node:fs').readFileSync(require.resolve('../src/artimation/web/mpc.js'), 'utf8');
assert(!/milp|MILPSolver|ga\.js|GeneticSolver/.test(source), 'MPC must not depend on another method');
{
  const plans = MPC.candidatePlans(E.scenario('convergence-4').routes, MPC.DEFAULTS), costs = plans.map(c => c.map(o => 0.02 * o.extra + 0.05 * o.maneuvering));
  const cfg = {sep: 7, sepV: 1000, tmax: 400, nodeLimit: 1e7}, selected = MPC.selectPlans(plans, costs, cfg);
  const ok = (a, i, b, j) => { const s = CM.pairStats(plans[a][i].path, plans[b][j].path, 7, 1000, 400); return s.dmin >= 7 && s.conflict === 0; };
  let best = Infinity; const pick = [];
  (function search(depth, cost) {
    if (cost >= best) return;
    if (depth === plans.length) { best = cost; return; }
    for (let k = 0; k < plans[depth].length; k++) if (pick.every((i, a) => ok(a, i, depth, k))) { pick[depth] = k; search(depth + 1, cost + costs[depth][k]); pick.length = depth; }
  })(0, 0);
  assert.equal(selected.termination, 'optimal'); near(selected.cost, best, 1e-12);
}

for (const options of [{horizon: 0}, {horizon: 10, controlStep: 20}, {controlStep: 0}, {maxTime: NaN}, {maxTime: 1},
  {nodeLimit: 0}, {nodeLimit: 1.5}, {sep: -1}, {sepV: -1}, {seed: .5}, {vertical: true}, {costWeights: {terminal: -1}}, {costWeights: {unknown: 1}}])
  assert.throws(() => MPC.runSync(scn.routes, options));
assert.throws(() => MPC.runSync([], {}));
const malformed = JSON.parse(JSON.stringify(scn.routes)); malformed[0].z[1] = 37000;
assert.throws(() => MPC.runSync(malformed));
const limited = MPC.runSync(scn.routes, {nodeLimit: 1});
assert.equal(limited.termination, 'node-limit'); assert.equal(limited.finalIdx, null); assert(!limited.completed); assert.equal(limited.finalControls.length, 0);
const infeasible = MPC.runSync(scn.routes, {angles: []});
assert.equal(infeasible.termination, 'infeasible'); assert.equal(infeasible.finalIdx, null); assert(!infeasible.completed);
const timedOut = MPC.runSync(scn.routes, {maxTime: 20});
assert.equal(timedOut.termination, 'max-time'); assert(!timedOut.completed);
assert(timedOut.paths[timedOut.finalIdx].every(p => p.t.at(-1) === 20));
assert(timedOut.paths[timedOut.finalIdx].some((p, a) => p.x.at(-1) !== scn.routes[a].x.at(-1) || p.y.at(-1) !== scn.routes[a].y.at(-1)));

console.log('MPC replanning, fixed-speed flight, exact separation, trace and termination invariants passed.');
