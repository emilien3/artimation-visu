const assert = require('node:assert/strict');
const K = require('../src/artimation/web/kwa-model.js');

// Arrivals: Table 1 sizes, Eq. 3 shifts, and the paper's penalty weights on the example instance.
assert.deepEqual(K.shifts(3, 1), [-1, 0, 1]);
assert.deepEqual(K.shifts(5, 2), [-4, -2, 0, 2, 4]);
for (const [n, m, qubits] of [[2, 3, 6], [3, 3, 9], [2, 5, 10], [3, 5, 15]]) {
  const p = K.arrivals({etas: [0, 3, 6].slice(0, n), m, step: 1}), best = K.optimum(p);
  assert.equal(p.N, qubits);
  assert.equal(p.delay[best], n - 1);
  assert(K.decode(p, best).every(row => row.length === 1));
  assert(K.weightsValid(p, 9, 2) && !K.weightsValid(p, 0, 0) && !K.weightsValid(p, 9, 0) && !K.weightsValid(p, 0, 2));
  // Brute-force check of the penalised cost against Eqs. 5, 9, 10.
  const c = K.costs(p, 9, 2);
  for (let z = 0; z < p.size; z += 7) {
    let delay = 0, enc = 0, conf = 0;
    const rows = K.decode(p, z);
    rows.forEach((row, i) => { enc += (row.length - 1) ** 2; for (const j of row) delay += Math.abs(p.shifts[j]); });
    for (let i = 0; i < n; i++) for (let k = i + 1; k < n; k++) for (const j of rows[i]) for (const l of rows[k]) {
      if (Math.abs(p.etas[i] + p.shifts[j] - p.etas[k] - p.shifts[l]) < 4) conf++;
    }
    assert.equal(c[z], delay + 9 * enc + 2 * conf);
  }
}
assert.equal(K.optimum(K.arrivals({etas: [0, 0, 0], m: 3, step: 1})), null);

// QAOA: normalised state, uniform at zero angles, and the exact p = 1 result for a single MaxCut edge.
const p = K.arrivals({etas: [0, 3], m: 3, step: 1}), c = K.costs(p, 9, 2);
const sum = a => a.reduce((x, y) => x + y, 0);
assert(Math.abs(sum(K.qaoa(c, p.N, 0.7, 0.3)) - 1) < 1e-12);
assert(K.qaoa(c, p.N, 0, 0).every(v => Math.abs(v - 1 / 64) < 1e-12));
const edge = Float64Array.from([0, -1, -1, 0]);
// Closed form for one edge with cost = -cut: <C> = -(1 - sin(4 beta) sin(gamma)) / 2, optimum -1 at (pi/2, 3 pi/8).
for (const [g, b] of [[Math.PI / 2, 3 * Math.PI / 8], [0.7, 0.3], [1.9, 2.2]]) {
  assert(Math.abs(K.expectation(K.qaoa(edge, 2, g, b), edge) + (1 - Math.sin(4 * b) * Math.sin(g)) / 2) < 1e-12);
}
const land = K.landscape(c, p.N, 12);
assert.equal(land.values[land.best], Math.min(...land.values));
assert(Math.abs(land.values[0] - sum(Array.from(c)) / 64) < 1e-9);

// Drones: Eq. 8 makes a legal command cost exactly its potential; kinematics and merging behave.
assert.deepEqual(K.mergeRects([[0, 0, 10, 10], [25, 0, 10, 10], [200, 0, 10, 10]], 30), [[0, 0, 35, 10], [200, 0, 10, 10]]);
const field = {target: [690, 70], points: K.cloud([[300, 200, 60, 60]])}, state = {x: 60, y: 540, h: -40};
const q = K.controlQubo(field, state, 1e10);
for (let t = 0; t < 3; t++) for (let v = 0; v < 2; v++) {
  const next = K.advance(state, t, v);
  assert(Math.abs(Math.hypot(next.x - state.x, next.y - state.y) - K.SPEEDS[v]) < 1e-9);
  assert.equal(next.h, state.h + K.TURNS[t]);
  assert(Math.abs(K.controlEnergy(q, (1 << t) | (8 << v)) / K.potential(field, next.x, next.y) - 1) < 1e-6);
}
assert.equal(Array.from({length: 32}, (_, u) => u).filter(K.controlValid).length, 6);
assert(K.decide(field, state, 1e10).valid && !K.decide(field, state, 1e6).valid);
assert.equal(K.potential({target: [0, 0], points: []}, 3, 4), K.K_ATT * 25);
assert.equal(K.repulsion([[0, 0]], 40, 0), 0);
assert(K.repulsion([[0, 0]], 5, 0) > K.repulsion([[0, 0]], 20, 0));
const flight = K.fly(field, state, 1e10);
assert.equal(flight.status, 'arrived');
assert(flight.path.every(pt => !(pt.x > 300 && pt.x < 360 && pt.y > 200 && pt.y < 260)));
assert.equal(K.fly(field, state, 1e6).status, 'invalid');

// Stollenwerk: forbidden delay-difference intervals, conflict graph, exact delays, clique embedding.
const flights = [{from: [0, 80], to: [600, 320], t0: 0}, {from: [0, 320], to: [600, 80], t0: 2}, {from: [0, 210], to: [600, 190], t0: 9}, {from: [380, 400], to: [500, 0], t0: 30}].map(f => ({...f, speed: 8}));
const near = K.proximity(flights), all = K.conflicts(near, 18);
assert.equal(K.conflicts(near, 0).length <= all.length, true);
assert.deepEqual(K.position(flights[0], 0), [0, 80]);
assert.equal(K.position(flights[0], 5, 6), null);
// An interval is exactly the set of delay differences that put two flights within 30 NM less than 3 min apart.
for (const e of all) for (let diff = -18; diff <= 18; diff++) {
  const di = Math.max(0, diff), dj = Math.max(0, -diff);
  let clash = false;
  for (let s = 0; s <= K.duration(flights[e.i]) && !clash; s++) for (let t = 0; t <= K.duration(flights[e.j]) && !clash; t++) {
    const a = K.position(flights[e.i], flights[e.i].t0 + s), b = K.position(flights[e.j], flights[e.j].t0 + t);
    clash = Math.hypot(a[0] - b[0], a[1] - b[1]) < K.SEP_NM && Math.abs(flights[e.i].t0 + s + di - flights[e.j].t0 - t - dj) < K.SEP_MIN;
  }
  if (clash) assert(K.violated(e, {[e.i]: di, [e.j]: dj}), `interval misses a real conflict ${e.i}-${e.j} at ${diff}`);
}
const answer = K.solveDelays(4, all, 1, 18);
assert(answer && all.every(e => !K.violated(e, answer.delays)));
assert.equal(K.solveDelays(4, K.conflicts(near, 3), 1, 3), null);
assert(K.solveDelays(4, all, 3, 18).total >= answer.total && K.solveDelays(4, K.conflicts(near, 24), 1, 24).total <= answer.total);
assert.deepEqual(K.components(5, [{i: 0, j: 1}, {i: 3, j: 4}]), {id: [0, 0, 1, 2, 2], sizes: [2, 1, 2]});
assert.deepEqual(K.cliqueEmbedding(16), {m: 4, chain: 5, physical: 80, available: 128});
// Every pair of chains in the clique embedding shares a cell, so any two bits can be coupled.
for (const n of [12, 16, 28]) {
  const m = K.cliqueEmbedding(n).m, cells = v => { const g = Math.floor(v / 4), out = new Set(); for (let c = 0; c <= g; c++) out.add(`${g},${c}`); for (let r = g; r < m; r++) out.add(`${r},${g}`); return out; };
  for (let a = 0; a < n; a++) for (let b = a + 1; b < n; b++) assert([...cells(a)].some(c => cells(b).has(c)));
}
