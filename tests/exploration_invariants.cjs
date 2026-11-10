const assert = require('node:assert/strict');
const CM = require('../src/artimation/web/model.js');
const GA = require('../src/artimation/web/ga.js');
const SA = require('../src/artimation/web/annealing.js');
const E = require('../src/artimation/web/exploration.js');

assert.throws(() => E.scenario('unknown'));
for (const key of ['crossing-2', 'convergence-4']) {
  const scn = E.scenario(key);
  assert.equal(scn.routes.length, key === 'crossing-2' ? 2 : 4);
  assert(CM.evaluate(scn.routes, scn.routes.map(() => [0, 0, 0, 0])).conflict > 0);
  for (const solver of [GA, SA]) {
    const result = solver.runSync(scn.routes, {...(solver === GA ? E.DEFAULTS : SA.DEFAULTS)}), data = E.dataset(scn, result);
    assert.equal(result.genes.length, 2380); // Equal recorded-proposal budgets, not equal unique evaluations.
    assert.equal(data.candidates.length, result.genes.length);
    assert.equal(data.candidates[data.best_candidate_id].label, 'safe');
    assert(data.candidates.some(c => c.label === 'unsafe'));
    assert.equal(data.unique_candidate_count, new Set(result.genes.map(g => JSON.stringify(g))).size);
    for (const c of data.candidates) {
      assert.equal(c.label, c.pairs.every(p => p.label === 'safe') ? 'safe' : 'unsafe');
      assert.equal(c.fitness, result.fit[c.candidate_id]);
      for (const tr of c.trajectories) {
        assert.equal(tr.label, tr.conflicting_aircraft.length ? 'unsafe' : 'safe');
        assert.equal(tr.knots[0].t_s, 0);
        assert(tr.knots.every(p => Object.values(p).every(Number.isFinite)));
        assert(tr.knots.every((p, i) => !i || p.t_s > tr.knots[i - 1].t_s));
      }
    }
    for (const value of ['safe', 'unsafe']) {
      const csv = E.csv(data, value);
      const expected = data.candidates.reduce((sum, c) => sum + c.trajectories.filter(tr => tr.label === value).reduce((s, tr) => s + tr.knots.length, 0), 0);
      assert.equal(csv.trimEnd().split('\r\n').length - 1, expected);
    }
  }
}

const scn = E.scenario('convergence-4');
const options = {iterations: 300, seed: 7, vertical: true};
const rec = SA.runSync(scn.routes, options);
assert.deepEqual(rec, SA.runSync(scn.routes, options));
assert.equal(rec.temperature[1], SA.DEFAULTS.temperatureStart);
assert(Math.abs(rec.temperature.at(-1) - SA.DEFAULTS.temperatureEnd) < 1e-15);
assert(rec.accepted.includes(false), 'Rejected proposals must be recorded');
let current = 0;
for (let i = 1; i < rec.genes.length; i++) {
  assert.equal(rec.parent[i], current);
  assert.equal(rec.origin[i], `S_${current}`);
  const changed = rec.genes[i].filter((g, a) => JSON.stringify(g) !== JSON.stringify(rec.genes[current][a])).length;
  assert(changed <= 1, 'One aircraft changes per proposal');
  if (rec.fit[i] >= rec.fit[current]) assert(rec.accepted[i]);
  if (rec.accepted[i]) current = i;
}
assert.equal(rec.currentIdx, current);
assert.equal(rec.fit[rec.bestIdx], Math.max(...rec.fit));
assert(rec.accepted[rec.bestIdx]);
const exported = E.dataset(scn, rec);
assert(exported.candidates.every((c, i) => c.generation === null && c.accepted === rec.accepted[i] && c.temperature === rec.temperature[i]));
const cold = SA.runSync(scn.routes, {iterations: 300, seed: 7, temperatureStart: 1e-12, temperatureEnd: 1e-12});
for (let i = 1; i < cold.fit.length; i++) if (cold.fit[i] < cold.fit[cold.parent[i]]) assert.equal(cold.accepted[i], false);
const hot = SA.runSync(scn.routes, {iterations: 300, seed: 7, temperatureStart: 1e12, temperatureEnd: 1e12});
assert(hot.accepted.every(Boolean));
// The ratio of two valid temperatures can underflow even though each endpoint is finite.
const extreme = SA.runSync(scn.routes, {iterations: 3, temperatureStart: 1e308, temperatureEnd: 1e-308});
assert(extreme.temperature.every(t => Number.isFinite(t) && t > 0));
assert(Math.abs(extreme.temperature[1] / 1e308 - 1) < 1e-12);
assert(Math.abs(extreme.temperature.at(-1) / 1e-308 - 1) < 1e-12);
assert(extreme.temperature.every((t, i) => !i || t <= extreme.temperature[i - 1] * (1 + 1e-12)));
for (const options of [{iterations: 0}, {iterations: 1.2}, {temperatureStart: 0}, {temperatureEnd: NaN}, {temperatureStart: .01, temperatureEnd: .1}, {sep: -1}, {seed: .5}, {weights: {length: -1}},
  {window: 0}, {window: -1}, {window: NaN}, {window: -Infinity}, {window: null}, {window: '600'}])
  assert.throws(() => SA.runSync(scn.routes, options));
assert.throws(() => SA.runSync([], {}));
for (const window of [100, Infinity]) {
  const control = SA.runSync(scn.routes, {iterations: 3, sepV: 0, window});
  assert.equal(control.cfg.sepV, 0); assert.equal(control.cfg.window, window);
  assert(control.fit.every(Number.isFinite));
}

// A safe aircraft can belong to an unsafe joint candidate; preserve both labels.
const mixed = E.scenario('crossing-2');
mixed.ids.push('AC003'); mixed.routes.push(CM.makeRoute([[5, 85], [115, 85]], [0, 1100], [36000, 36000]));
const mixedData = E.dataset(mixed, GA.runSync(mixed.routes, {pop: 2, generations: 0}));
assert.equal(mixedData.candidates[0].label, 'unsafe');
assert.equal(mixedData.candidates[0].trajectories[2].label, 'safe');
assert(E.csv(mixedData, 'safe').includes('"unsafe","AC003","safe"'));

// The same aircraft gene changes label when the other aircraft changes trajectory.
const context = E.scenario('crossing-2');
const contextual = E.dataset(context, {cfg: {...GA.DEFAULTS}, gen: [0, 1], origin: ['B', 'test'], bestIdx: 1,
  genes: [[[0, 0, 0, 0], [0, 0, 0, 0]], [[0, 0, 0, 0], [0, 250, 40, 0]]]});
assert.deepEqual(contextual.candidates.map(c => c.trajectories[0].label), ['unsafe', 'safe']);
console.log('Exploration, simulated annealing and export invariants passed.');
