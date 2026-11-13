// Models behind the step-by-step visual explainers: two Kwa et al. (Thales CortAIx Singapore) papers and Stollenwerk et al. (2020).
// Arrivals: Cassassolles, Kwa, Chai, Gan (2026), speed-advisory QUBO solved with QAOA.
// Drones: Kwa, Teh, Chai, Gan (2026), potential-field control QUBO solved once per time step.
// Stollenwerk: Stollenwerk, O'Gorman, Venturelli et al. (2020), departure-delay QUBO for a quantum annealer.
// Formulas follow the papers; instance values the papers do not give (ETAs, step, map) are illustrative.
(function (root) {
  'use strict';

  function rng(seed) { // mulberry32
    let a = seed >>> 0;
    return () => { a = (a + 0x6D2B79F5) >>> 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  }

  // ---------- Arrivals ----------
  // Eq. 3: shift j (1..m) moves the arrival by step * (j - (m + 1) / 2) minutes.
  function shifts(m, step) { return Array.from({length: m}, (_, j) => step * (j - (m - 1) / 2)); }

  // Bit i * m + j is x_ij. Returns per-bitstring delay (Eq. 5), one-hot violation (Eq. 9) and conflict count (Eq. 10).
  function arrivals({etas, m, step, tmin = 4}) {
    const n = etas.length, N = n * m, size = 1 << N, s = shifts(m, step);
    const pairs = [];
    for (let i = 0; i < n; i++) for (let k = i + 1; k < n; k++) for (let j = 0; j < m; j++) for (let l = 0; l < m; l++) {
      if (Math.abs(etas[i] + s[j] - etas[k] - s[l]) < tmin) pairs.push((1 << (i * m + j)) | (1 << (k * m + l)));
    }
    const delay = new Float64Array(size), encoding = new Float64Array(size), conflict = new Float64Array(size);
    for (let z = 0; z < size; z++) {
      for (let i = 0; i < n; i++) {
        let count = 0;
        for (let j = 0; j < m; j++) if (z >> (i * m + j) & 1) { count++; delay[z] += Math.abs(s[j]); }
        encoding[z] += (count - 1) ** 2;
      }
      for (const p of pairs) if ((z & p) === p) conflict[z]++;
    }
    return {etas, n, m, N, size, step, tmin, shifts: s, delay, encoding, conflict};
  }
  const feasible = (p, z) => p.encoding[z] === 0 && p.conflict[z] === 0;

  function costs(p, lamE, lamC) {
    const c = new Float64Array(p.size);
    for (let z = 0; z < p.size; z++) c[z] = p.delay[z] + lamE * p.encoding[z] + lamC * p.conflict[z];
    return c;
  }

  // Best feasible schedule; null when the instance cannot be separated with the allowed shifts.
  function optimum(p) {
    let best = null;
    for (let z = 0; z < p.size; z++) if (feasible(p, z) && (best === null || p.delay[z] < p.delay[best])) best = z;
    return best;
  }

  // A weight pair is valid when every minimiser of the penalised cost is a feasible schedule (paper, section 2.4).
  function weightsValid(p, lamE, lamC) {
    let good = Infinity, bad = Infinity;
    for (let z = 0; z < p.size; z++) {
      const c = p.delay[z] + lamE * p.encoding[z] + lamC * p.conflict[z];
      if (feasible(p, z)) { if (c < good) good = c; } else if (c < bad) bad = c;
    }
    return good < bad;
  }

  // Selected slot per aircraft for a bitstring: list of chosen shift indices (may be empty or multiple).
  function decode(p, z) {
    return Array.from({length: p.n}, (_, i) => Array.from({length: p.m}, (_, j) => j).filter(j => z >> (i * p.m + j) & 1));
  }

  // Unweighted MaxCut on a seeded random graph with N vertices; cost = -cut size.
  function maxcut(N, seed = 1) {
    const r = rng(seed), edges = [];
    for (let a = 0; a < N; a++) for (let b = a + 1; b < N; b++) if (r() < 0.5) edges.push([a, b]);
    const c = new Float64Array(1 << N);
    for (let z = 0; z < c.length; z++) for (const [a, b] of edges) if ((z >> a & 1) !== (z >> b & 1)) c[z]--;
    return {N, edges, cost: c};
  }

  // Exact p = 1 QAOA state: |+>^N, phase exp(-i gamma C), then RX(2 beta) on every qubit. Returns probabilities.
  function qaoa(cost, N, gamma, beta) {
    const size = 1 << N, re = new Float64Array(size), im = new Float64Array(size), a = 1 / Math.sqrt(size);
    for (let z = 0; z < size; z++) { re[z] = a * Math.cos(gamma * cost[z]); im[z] = -a * Math.sin(gamma * cost[z]); }
    const c = Math.cos(beta), s = Math.sin(beta);
    for (let q = 0; q < N; q++) {
      const bit = 1 << q;
      for (let z = 0; z < size; z++) if (!(z & bit)) {
        const y = z | bit, r0 = re[z], i0 = im[z], r1 = re[y], i1 = im[y];
        re[z] = c * r0 + s * i1; im[z] = c * i0 - s * r1;
        re[y] = c * r1 + s * i0; im[y] = c * i1 - s * r0;
      }
    }
    const prob = new Float64Array(size);
    for (let z = 0; z < size; z++) prob[z] = re[z] * re[z] + im[z] * im[z];
    return prob;
  }
  function expectation(prob, cost) { let e = 0; for (let z = 0; z < prob.length; z++) e += prob[z] * cost[z]; return e; }

  // Expected cost over a G x G grid of (gamma, beta) in [0, pi) x [0, pi). Row index = beta, column = gamma.
  function landscape(cost, N, G) {
    const values = new Float64Array(G * G);
    let best = 0;
    for (let b = 0; b < G; b++) for (let g = 0; g < G; g++) {
      const k = b * G + g;
      values[k] = expectation(qaoa(cost, N, Math.PI * g / G, Math.PI * b / G), cost);
      if (values[k] < values[best]) best = k;
    }
    return {G, values, best, gamma: Math.PI * (best % G) / G, beta: Math.PI * Math.floor(best / G) / G};
  }

  // ---------- Drones ----------
  const TURNS = [-25, 0, 25], SPEEDS = [10, 15]; // deg/s and m/s, as in the paper
  const K_ATT = 1e3, K_REP = 1e7, RANGE = 30;   // Eqs. 2-3 constants

  // Buildings closer than `gap` metres become one restricted area (avoids potential wells in narrow corridors).
  function mergeRects(rects, gap) {
    const out = rects.map(r => r.slice());
    for (let merged = true; merged;) {
      merged = false;
      for (let a = 0; a < out.length && !merged; a++) for (let b = a + 1; b < out.length && !merged; b++) {
        const [ax, ay, aw, ah] = out[a], [bx, by, bw, bh] = out[b];
        if (ax - gap < bx + bw && bx - gap < ax + aw && ay - gap < by + bh && by - gap < ay + ah) {
          const x = Math.min(ax, bx), y = Math.min(ay, by);
          out[a] = [x, y, Math.max(ax + aw, bx + bw) - x, Math.max(ay + ah, by + bh) - y];
          out.splice(b, 1); merged = true;
        }
      }
    }
    return out;
  }
  // Point cloud filling each restricted rectangle [x, y, w, h].
  function cloud(rects, spacing = 10) {
    const pts = [];
    for (const [x, y, w, h] of rects) {
      const nx = Math.max(1, Math.round(w / spacing)), ny = Math.max(1, Math.round(h / spacing));
      for (let i = 0; i <= nx; i++) for (let j = 0; j <= ny; j++) pts.push([x + w * i / nx, y + h * j / ny]);
    }
    return pts;
  }
  // Sum over obstacle points of k_rep (1 / D - 1 / R)^2, before the distance-to-target factor of Eq. 3.
  function repulsion(points, x, y) {
    let sum = 0;
    for (const [px, py] of points) {
      const dx = px - x, dy = py - y;
      if (Math.abs(dx) >= RANGE || Math.abs(dy) >= RANGE) continue;
      const d = Math.max(Math.hypot(dx, dy), 0.5);
      if (d < RANGE) sum += K_REP * (1 / d - 1 / RANGE) ** 2;
    }
    return sum;
  }
  // Eq. 1: attractive (Eq. 2, alpha = 2) + repulsive (Eq. 3, beta = 2). `points: []` gives attraction only.
  function potential(field, x, y) {
    const d = Math.hypot(x - field.target[0], y - field.target[1]);
    return K_ATT * d * d + repulsion(field.points, x, y) * d;
  }
  // Fixed-wing kinematics for one time step: turn, then advance. Heading in degrees, screen frame.
  function advance(state, turn, speed, dt = 1) {
    const h = state.h + TURNS[turn] * dt, r = h * Math.PI / 180;
    return {x: state.x + SPEEDS[speed] * dt * Math.cos(r), y: state.y + SPEEDS[speed] * dt * Math.sin(r), h};
  }
  // 5-bit control QUBO for one drone: bits 0-2 = turn rates, bits 3-4 = speeds.
  // Eq. 6 gives the turn x speed couplings; Eq. 8 adds K (1 - sum u)^2 per exclusivity group.
  function controlQubo(field, state, K) {
    const Q = Array.from({length: 5}, () => new Array(5).fill(0));
    const next = TURNS.map((_, t) => SPEEDS.map((_, s) => advance(state, t, s)));
    for (let t = 0; t < 3; t++) for (let s = 0; s < 2; s++) Q[t][3 + s] = potential(field, next[t][s].x, next[t][s].y);
    for (const group of [[0, 1, 2], [3, 4]]) for (const a of group) {
      Q[a][a] -= K;
      for (const b of group) if (b > a) Q[a][b] += 2 * K;
    }
    return {Q, offset: 2 * K, next};
  }
  function controlEnergy(qubo, u) {
    let e = qubo.offset;
    for (let a = 0; a < 5; a++) if (u >> a & 1) for (let b = a; b < 5; b++) if (u >> b & 1) e += qubo.Q[a][b];
    return e;
  }
  const controlValid = u => [1, 2, 4].includes(u & 7) && [1, 2].includes(u >> 3);
  // Exhaustive minimum over the 32 bitstrings (what an ideal QUBO solver returns).
  function decide(field, state, K) {
    const qubo = controlQubo(field, state, K), energies = Array.from({length: 32}, (_, u) => controlEnergy(qubo, u));
    let best = 0;
    for (let u = 1; u < 32; u++) if (energies[u] < energies[best]) best = u;
    const valid = controlValid(best), turn = [1, 2, 4].indexOf(best & 7), speed = [1, 2].indexOf(best >> 3);
    return {qubo, energies, best, valid, turn, speed};
  }
  // One QUBO per second until arrival; stops early when the minimiser is not a legal command.
  function fly(field, start, K, {maxSteps = 400, arrive = 20} = {}) {
    const path = [{...start}];
    let status = 'timeout';
    for (let k = 0; k < maxSteps; k++) {
      const state = path[path.length - 1];
      if (Math.hypot(state.x - field.target[0], state.y - field.target[1]) < arrive) { status = 'arrived'; break; }
      const d = decide(field, state, K);
      if (!d.valid) { status = 'invalid'; break; }
      path.push(d.qubo.next[d.turn][d.speed]);
    }
    return {path, status};
  }

  // ---------- Stollenwerk et al. (2020): de-conflicting trajectories with departure delays ----------
  const SEP_NM = 30, SEP_MIN = 3; // North Atlantic separation standards used in the paper
  // Flight: {from: [x, y], to: [x, y], t0, speed} in NM and minutes; straight route, constant speed.
  function duration(f) { return Math.hypot(f.to[0] - f.from[0], f.to[1] - f.from[1]) / f.speed; }
  function position(f, time, delay = 0) {
    const u = (time - f.t0 - delay) / duration(f);
    return u < 0 || u > 1 ? null : [f.from[0] + (f.to[0] - f.from[0]) * u, f.from[1] + (f.to[1] - f.from[1]) * u];
  }
  // Every pair of flights with trajectory points closer than 30 NM: sorted distinct time offsets t - s and the points involved.
  function proximity(flights) {
    const tracks = flights.map(f => Array.from({length: Math.floor(duration(f)) + 1}, (_, k) => position(f, f.t0 + k))), out = [];
    for (let i = 0; i < flights.length; i++) for (let j = i + 1; j < flights.length; j++) {
      const offsets = new Set(), si = new Set(), sj = new Set();
      tracks[i].forEach((a, s) => tracks[j].forEach((b, t) => {
        if (Math.hypot(a[0] - b[0], a[1] - b[1]) < SEP_NM) { offsets.add(flights[j].t0 + t - flights[i].t0 - s); si.add(s); sj.add(t); }
      }));
      if (offsets.size) out.push({i, j, offsets: [...offsets].sort((x, y) => x - y), zone: [[Math.min(...si), Math.max(...si)], [Math.min(...sj), Math.max(...sj)]]});
    }
    return out;
  }
  // Potential conflicts for a maximum delay (Eq. 3), one cluster per flight pair, each a forbidden interval
  // [lo, hi] for d_i - d_j (Eqs. 8-11).
  function conflicts(pairs, dmax) {
    const out = [];
    for (const p of pairs) {
      const near = p.offsets.filter(v => Math.abs(v) < dmax + SEP_MIN);
      if (near.length) out.push({i: p.i, j: p.j, lo: 1 - SEP_MIN + near[0], hi: SEP_MIN - 1 + near[near.length - 1], zone: p.zone});
    }
    return out;
  }
  const violated = (c, d) => d[c.i] - d[c.j] >= c.lo && d[c.i] - d[c.j] <= c.hi;
  // Connected components of the conflict graph: component id per flight and the component sizes.
  function components(n, edges) {
    const parent = Array.from({length: n}, (_, i) => i), find = a => parent[a] === a ? a : (parent[a] = find(parent[a]));
    for (const e of edges) parent[find(e.i)] = find(e.j);
    const ids = new Map(), id = parent.map((_, i) => { const r = find(i); if (!ids.has(r)) ids.set(r, ids.size); return ids.get(r); });
    const sizes = new Array(ids.size).fill(0); for (const c of id) sizes[c]++;
    return {id, sizes};
  }
  // Exact minimum total delay with d_i in {0, step, ..., dmax}; null when no assignment avoids every conflict.
  function solveDelays(n, edges, step, dmax) {
    const levels = Math.floor(dmax / step), d = new Array(n).fill(0), before = Array.from({length: n}, () => []);
    for (const e of edges) before[Math.max(e.i, e.j)].push(e);
    let best = null;
    (function assign(k, sum) {
      if (best && sum >= best.total) return;
      if (k === n) { best = {delays: d.slice(), total: sum}; return; }
      for (let l = 0; l <= levels; l++) { d[k] = l * step; if (!before[k].some(e => violated(e, d))) assign(k + 1, sum + d[k]); }
      d[k] = 0;
    })(0, 0);
    return best;
  }
  // Standard clique embedding of K_n into a Chimera lattice of m x m cells (4 + 4 qubits each):
  // variable v = 4 g + k is an L-shaped chain, horizontal qubit k of row g (columns 0..g) and vertical qubit k of column g (rows g..m-1).
  function cliqueEmbedding(n) { const m = Math.ceil(n / 4); return {m, chain: m + 1, physical: n * (m + 1), available: 8 * m * m}; }

  root.KwaModel = {shifts, arrivals, feasible, costs, optimum, weightsValid, decode, maxcut, qaoa, expectation, landscape,
    TURNS, SPEEDS, K_ATT, K_REP, RANGE, mergeRects, cloud, repulsion, potential, advance, controlQubo, controlEnergy, controlValid, decide, fly,
    SEP_NM, SEP_MIN, duration, position, proximity, conflicts, violated, components, solveDelays, cliqueEmbedding, rng};
  if (typeof module !== 'undefined' && module.exports) module.exports = root.KwaModel;
})(typeof globalThis !== 'undefined' ? globalThis : this);
