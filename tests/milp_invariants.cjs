const assert = require('node:assert/strict');
const CM = require('../src/artimation/web/model.js');
const M = require('../src/artimation/web/milp.js');
const E = require('../src/artimation/web/exploration.js');

function bruteForce(catalogues, cfg = {}) {
  let choice = null, cost = Infinity;
  const indices = new Array(catalogues.length);
  function visit(a) {
    if (a < catalogues.length) {
      for (let k = 0; k < catalogues[a].length; k++) { indices[a] = k; visit(a + 1); }
      return;
    }
    let sum = 0;
    for (let i = 0; i < indices.length; i++) {
      sum += cfg.costs ? cfg.costs[i][indices[i]] : catalogues[i][indices[i]].cost;
      for (let j = 0; j < i; j++) {
        const pair = CM.pairStats(catalogues[j][indices[j]].path, catalogues[i][indices[i]].path, cfg.sep ?? 7, cfg.sepV ?? 1000, cfg.tmax ?? Infinity);
        if (pair.dmin < (cfg.sep ?? 7) || pair.conflict > 0) return;
      }
    }
    if (sum < cost) { cost = sum; choice = indices.slice(); }
  }
  visit(0); return {choice, cost};
}

for (const scenario of ['crossing-2', 'convergence-4']) {
  const {routes} = E.scenario(scenario), snapshot = JSON.stringify(routes);
  const small = M.makeCatalogue(routes, {starts: [0], holds: [300], angles: [-30, 30]});
  for (const cfg of [{}, {tmax: 100}, {costs: small.map((c, a) => c.map((_, k) => (a + 1) * (2 - k) / 10 - .5))}]) {
    const expected = bruteForce(small, cfg), actual = M.solveCatalogueSync(small, cfg);
    assert.equal(actual.cost, expected.cost);
    assert.equal(actual.termination, expected.choice ? 'optimal' : 'infeasible');
    assert.equal(actual.provenOptimal, Boolean(expected.choice));
    assert.equal(actual.lowerBound, actual.cost);
  }
  const result = M.runSync(routes);
  assert.equal(result.algorithm, 'milp');
  assert.equal(result.termination, 'optimal');
  assert.equal(result.certificate.provenOptimal, true);
  const best = CM.evaluate(routes, result.genes[result.bestIdx]);
  assert(best.dmin >= 7 && best.conflict === 0, `${scenario} must resolve safely`);
  assert(Math.abs(result.objective - (.02 * best.extra + .05 * best.nMan)) < 1e-12);
  assert(result.conflict[0] > 0, 'The original conflicting routes remain in the trace');
  assert.equal(result.meta[result.finalIdx].termination, 'optimal');
  assert.equal(result.genes.length, result.controls.length);
  assert(result.genes.every(joint => joint.every(g => g[3] === 0)));
  for (let k = 0; k < result.genes.length; k++) {
    const ev = CM.evaluate(routes, result.genes[k]);
    assert.equal(result.fit[k], ev.fitness);
    assert(Math.abs(result.meta[k].objective - (.02 * ev.extra + .05 * ev.nMan)) < 1e-12);
    assert.equal(result.genes[k].length, routes.length, 'No partial search node becomes a trajectory candidate');
  }
  assert.equal(JSON.stringify(routes), snapshot);
  assert.deepEqual(result, M.runSync(routes));
}

const routes = E.scenario('crossing-2').routes;
const idleOnly = M.makeCatalogue(routes, {angles: []});
const infeasible = M.solveCatalogueSync(idleOnly);
assert.equal(infeasible.termination, 'infeasible');
assert.equal(infeasible.choice, null);
assert.equal(infeasible.provenOptimal, false);
assert.equal(infeasible.incompatibilities, 1);
const capped = M.solveCatalogueSync(idleOnly, {nodeLimit: 1});
assert.equal(capped.termination, 'node-limit');
assert.equal(capped.choice, null);
assert.equal(capped.nodes, 1);
assert.equal(capped.provenOptimal, false);
const cappedRun = M.runSync(routes, {nodeLimit: 1});
assert.equal(cappedRun.termination, 'node-limit');
assert.equal(cappedRun.genes.length, 1);
assert.equal(cappedRun.meta[0].termination, 'node-limit');
const early = M.solveCatalogueSync(idleOnly, {tmax: 100});
assert.equal(early.termination, 'optimal');
assert.deepEqual(early.choice, [0, 0]);

// A finite node budget with an incumbent remains an unproved result.
const options = M.makeCatalogue(routes, {starts: [0], holds: [300], angles: [-30, 30]});
const full = M.solveCatalogueSync(options);
let budgetWithIncumbent = null;
for (let nodeLimit = 1; nodeLimit < full.nodes; nodeLimit++) {
  const r = M.solveCatalogueSync(options, {nodeLimit});
  if (r.choice) { budgetWithIncumbent = r; break; }
}
assert(budgetWithIncumbent);
assert.equal(budgetWithIncumbent.termination, 'node-limit');
assert.equal(budgetWithIncumbent.provenOptimal, false);
assert(budgetWithIncumbent.lowerBound <= budgetWithIncumbent.cost);

const short = [CM.makeRoute([[0, 0], [1, 0]], [100, 110], [36000, 36000])];
const shortCatalog = M.makeCatalogue(short);
assert(shortCatalog[0].every(o => o.gene[2] === 0 || (o.gene[0] >= 100 && o.gene[1] <= 110)));
assert.equal(new Set(shortCatalog[0].map(o => JSON.stringify(o.gene))).size, shortCatalog[0].length);
const iterator = M.solveCatalogue(options, {yieldEvery: 1}); let step, progress = 0;
do { step = iterator.next(); if (!step.done && step.value.type === 'progress') progress++; } while (!step.done);
assert(progress > 1, 'Preprocessing and search yield to the browser');

for (const cfg of [{sep: 0}, {sepV: -1}, {seed: .5}, {nodeLimit: 0}, {nodeLimit: 1.2}, {yieldEvery: 0}, {window: 0}, {window: NaN}, {tmax: -1}, {weights: {length: -1}},
  {starts: [-1]}, {holds: [0]}, {angles: [NaN]}, {angles: [50]}, {vertical: true}])
  assert.throws(() => M.runSync(routes, cfg));
assert.throws(() => M.makeCatalogue([]));
assert.throws(() => M.solveCatalogueSync([]));
assert.throws(() => M.solveCatalogueSync([[]]));
assert.throws(() => M.solveCatalogueSync(options, {costs: [[0], [0]]}));
assert.throws(() => M.solveCatalogueSync([[{path: {t: [0, 1], x: [0, NaN], y: [0, 0], tz: [0], z: [36000]}, cost: 0}]]));
console.log('Finite-catalogue MILP branch-and-bound invariants passed.');
