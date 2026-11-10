const assert = require('node:assert/strict');
const CM = require('../src/artimation/web/model.js');
const ORCA = require('../src/artimation/web/orca.js');
const E = require('../src/artimation/web/exploration.js');

// The convex disc/halfplane solver finds the nearest feasible velocity.
const bounded = ORCA.solveVelocity([{normal: [1, 0], offset: 0.04}], [0, 0.1], 0.1);
assert(bounded.feasible);
assert(Math.abs(bounded.velocity[0] - 0.04) < 1e-10);
assert(Math.abs(bounded.velocity[1] - Math.sqrt(0.01 - 0.0016)) < 1e-10);
const outsidePreferred = ORCA.solveVelocity([{normal: [-1, 0], offset: -0.5}], [2, 0.5], 1);
assert(outsidePreferred.feasible);
assert(Math.abs(outsidePreferred.velocity[0] - 0.5) < 1e-10);
assert(Math.abs(outsidePreferred.velocity[1] - 0.5) < 1e-10);
const impossible = ORCA.solveVelocity([{normal: [1, 0], offset: 0.2}], [0.1, 0], 0.1);
assert.equal(impossible.feasible, false);
assert(impossible.violation > 0.09);
assert(Math.hypot(...impossible.velocity) <= 0.1 + 1e-9);

// Pairwise constraints split the same relative-velocity correction equally.
const A = [0, 0], B = [10, 0], va = [0.1, 0], vb = [-0.1, 0];
const ab = ORCA.pairConstraint(A, va, B, vb, 7, 400, 10, -1);
const ba = ORCA.pairConstraint(B, vb, A, va, 7, 400, 10, 1);
assert(Math.abs(ab.normal[0] + ba.normal[0]) < 1e-12);
assert(Math.abs(ab.normal[1] + ba.normal[1]) < 1e-12);
assert(Number.isFinite(ab.offset) && Number.isFinite(ba.offset));

for (const key of ['crossing-2', 'convergence-4']) {
  const scenario = E.scenario(key), result = ORCA.runSync(scenario.routes);
  assert.equal(result.algorithm, 'orca');
  assert.equal(result.finalIdx, result.paths.length - 1);
  assert.equal(result.meta[result.finalIdx].kind, 'executed');
  assert.equal(result.diagnostics.completed, true);
  assert.equal(result.fit[result.bestIdx], Math.max(...result.fit));
  const paths = result.paths[result.finalIdx], evaluation = CM.evaluatePaths(scenario.routes, paths, result.cfg);
  assert.equal(evaluation.conflict, 0, `${key}: executed trajectory must remain separated`);
  assert(evaluation.dmin >= 7, `${key}: minimum separation ${evaluation.dmin}`);
  for (const [index, path] of paths.entries()) {
    assert(path.x.concat(path.y, path.t, path.tz, path.z).every(Number.isFinite));
    assert(path.t.every((t, i) => !i || t > path.t[i - 1]));
    assert(path.z.every(z => z === 36000));
    assert(Math.abs(path.x.at(-1) - scenario.routes[index].x.at(-1)) < 1e-9);
    assert(Math.abs(path.y.at(-1) - scenario.routes[index].y.at(-1)) < 1e-9);
    for (let i = 1; i < path.t.length; i++) {
      const speed = Math.hypot(path.x[i] - path.x[i - 1], path.y[i] - path.y[i - 1]) / (path.t[i] - path.t[i - 1]) * 3600;
      assert(speed >= 0 && speed <= 360 + 1e-6);
    }
  }
  assert.deepEqual(result, ORCA.runSync(scenario.routes), 'ORCA must be deterministic');
  assert.equal(result.paths[0].length, scenario.routes.length);
  assert(result.meta.some(m => m.kind === 'forecast'));
  assert(result.fit.every(Number.isFinite));
  console.log(`${key}: ORCA dmin=${evaluation.dmin.toFixed(6)} NM, added=${evaluation.extra.toFixed(6)} NM, duration=${Math.max(...paths.map(p => p.t.at(-1))).toFixed(3)} s, forecasts=${result.paths.length - 2}`);
}
for (const options of [{dt: 0}, {horizon: NaN}, {horizon: 5}, {maxTime: 1}, {sep: -1}, {sepV: -1}, {vertical: true}, {seed: 0.1}, {safetyMargin: -1}])
  assert.throws(() => ORCA.runSync(E.scenario('crossing-2').routes, options));
assert.throws(() => ORCA.runSync([], {}));
assert.throws(() => ORCA.runSync(E.scenario('crossing-2').routes, {maxTime: 10}), /time limit/);
const solo = E.scenario('crossing-2').routes.slice(0, 1), soloResult = ORCA.runSync(solo);
assert.equal(soloResult.paths[soloResult.finalIdx][0].t.at(-1), 600);
assert.equal(soloResult.diagnostics.infeasible_steps, 0);
for (const dt of [5, 20]) {
  const scenario = E.scenario('convergence-4'), result = ORCA.runSync(scenario.routes, {dt});
  assert.equal(CM.evaluatePaths(scenario.routes, result.paths[result.finalIdx], result.cfg).conflict, 0);
}
console.log('ORCA geometry, execution and trace invariants passed.');
