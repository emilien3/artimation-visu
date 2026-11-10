const assert = require('node:assert/strict');
const CM = require('../src/artimation/web/model.js');
const GA = require('../src/artimation/web/ga.js');
const route = (xy, t = [0, 1000]) => CM.makeRoute(xy, t, [36000, 36000]);
const routes = [route([[0, 0], [100, 0]]), route([[100, -6.999999], [0, -6.999999]])];
const unsafe = CM.evaluate(routes, [[0, 0, 0, 0], [0, 0, 0, 0]]);
const safe = CM.evaluate(routes, [[0, 300, -35, 0], [0, 0, 0, 0]]);
assert(unsafe.conflict > 0 && unsafe.conflict < .04 && safe.conflict === 0);
assert(unsafe.fitness < .5 && safe.fitness > .5);

const shifted = route([[0, 0], [10, 0]], [100, 105]), R = GA.rng(0);
for (let i = 0; i < 50; i++) {
  const g = GA.randomGene(R, shifted, false, 105);
  assert(g[0] >= 100 && g[0] < 105);
  const m = GA.mutate(R, g, shifted, false, 105);
  assert(m[0] >= 100 && m[0] < 105);
}
assert.deepEqual(GA.randomGene(R, shifted, false, 50), [100, 100, 0, 0]);
const angles = new Set(Array.from({length: 500}, () => GA.randomGene(R, shifted, false, 105)[2]));
assert(angles.has(-40) && angles.has(40));
assert([...angles].every(a => Math.abs(a) <= 40 && a % 5 === 0));

const parallel = [route([[0, 0], [100, 0]]), route([[0, 20], [100, 20]])];
const evaluate = CM.evaluate;
let calls = 0;
CM.evaluate = (...args) => { calls++; return evaluate(...args); };
const cfg = {pop: 10, generations: 5, pCross: 0, pMut: 0, immigrants: 0};
const result = GA.runSync(parallel, cfg);
assert(calls <= 10);
assert.equal(result.genes.length, 50);
assert.equal(result.fit[result.bestIdx], 1);
assert.equal(result.origin[0], 'B');
CM.evaluate = evaluate;
assert.deepEqual(GA.runSync(parallel, cfg).best, result.best);
for (const cfg of [{pop: 0}, {pop: 1}, {pop: 2.5}, {generations: -1}, {tournament: 0}, {pMut: 2},
  {sep: NaN}, {sep: 0}, {sep: -1}, {sep: Infinity}, {sepV: NaN}, {sepV: -1}, {sepV: Infinity},
  {seed: NaN}, {seed: 0.5}, {seed: Infinity},
  {window: 0}, {window: -1}, {window: NaN}, {window: -Infinity}, {window: null}, {window: '600'}])
  assert.throws(() => GA.runSync(parallel, cfg));
// A positive finite look-ahead and the unbounded horizon are both supported.
for (const window of [100, Infinity]) {
  const control = GA.runSync(parallel, {pop: 4, generations: 1, sepV: 0, window});
  assert.equal(control.cfg.sepV, 0); assert.equal(control.cfg.window, window);
  assert(control.fit.every(Number.isFinite));
}
for (const genes of [[], [[0, 0]], [[0, 0, NaN], [0, 0, 0]]])
  assert.throws(() => CM.evaluate(parallel, genes));
assert.equal(CM.evaluate([parallel[0]], [[0, 0, 0]]).dmin, Infinity);
assert(CM.instructions([parallel[0]], ['A'], [[0, 10, 0, 1000]])[0].includes('start returning to the original route altitude at t+40 s'));

// Zero costs and extreme costs must not erase the strict safety partition.
for (const value of [0, 1e300]) {
  const weights = Object.fromEntries(Object.keys(CM.DEFAULT_WEIGHTS).map(k => [k, value]));
  assert(CM.evaluate(routes, [[0, 0, 0, 0], [0, 0, 0, 0]], {weights}).fitness < .5);
  assert(CM.evaluate(routes, [[0, 300, -35, 0], [0, 0, 0, 0]], {weights}).fitness > .5);
}
for (const weights of [{length: -1}, {altitude: Infinity}, {conflict: NaN}, {typo: 1}])
  assert.throws(() => CM.evaluate(parallel, [[0, 0, 0], [0, 0, 0]], {weights}));
const horizontal = [[0, 300, 35, 0]], vertical = [[0, 300, 0, 1000]];
const distanceFirst = {length: 10, altitude: 0}, altitudeFirst = {length: 0, altitude: 10};
assert(CM.evaluate([parallel[0]], horizontal, {weights: distanceFirst}).fitness < CM.evaluate([parallel[0]], vertical, {weights: distanceFirst}).fitness);
assert(CM.evaluate([parallel[0]], horizontal, {weights: altitudeFirst}).fitness > CM.evaluate([parallel[0]], vertical, {weights: altitudeFirst}).fitness);
const weighted = GA.runSync(routes, {pop: 20, generations: 5, weights: distanceFirst});
weighted.genes.forEach((g, i) => assert.equal(weighted.fit[i], CM.evaluate(routes, g, {weights: distanceFirst}).fitness));

// Half-sized cylinders intersect exactly when both separation limits are violated.
const FM = require('../src/artimation/web/physics.js');
for (const [distance, altitude, sepV, conflict] of [[10,0,1000,false],[7,0,1000,false],[6.99,999,1000,true],[6.99,1000,1000,false],[0,2000,1000,false],[0,2000,0,true]]) {
  const a={id:'A',x:0,y:0,z:36000}, b={id:'B',x:distance,y:0,z:36000+altitude};
  const zones=FM.separationZones([a,b],7,sepV);
  assert.equal(zones.zones[0].radius,3.5);
  assert.equal(zones.zones[0].halfHeight,sepV/2);
  assert.equal(zones.zones[0].conflict,conflict);
  const paths=[a,b].map(a=>({x:[a.x,a.x+1],y:[a.y,a.y],t:[0,10],tz:[0,10],z:[a.z,a.z]}));
  assert.equal(CM.pairStats(paths[0],paths[1],7,sepV).conflict>0,conflict);
}
const multi=FM.separationZones([{id:'A',x:0,y:0,z:36000},{id:'B',x:1,y:0,z:36000},{id:'C',x:2,y:0,z:38000}],7,1000);
assert(multi.zones[0].conflict && multi.zones[0].verticalOnly);
assert(!multi.zones[2].conflict && multi.zones[2].verticalOnly);
