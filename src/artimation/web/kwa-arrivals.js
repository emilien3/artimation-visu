// Step-by-step picture of Cassassolles, Kwa et al. (2026): arrival scheduling as a QUBO, solved with QAOA.
(function () {
  'use strict';
  const M = KwaModel, U = KwaUI, C = U.C;
  const T0 = -7, T1 = 13, MAP = {x: 90, y: 60, w: 500, h: 420, nE: 25, nC: 17, maxE: 12, maxC: 4}, LAND = {x: 70, y: 60, w: 420, h: 420};
  const s = {n: 3, m: 3, step: 1, etas: [0, 3, 6], lamE: 9, lamC: 2, z: 0, g: null, b: null, drag: null};
  let P, cache, hits, axis;

  function neutral() { let z = 0; for (let i = 0; i < s.n; i++) z |= 1 << (i * s.m + (s.m - 1) / 2); return z; }
  function rebuild() { P = M.arrivals({etas: s.etas.slice(0, s.n), m: s.m, step: s.step}); cache = {}; s.z = neutral(); s.g = s.b = null; }
  function reweigh() { for (const k of ['cost', 'order', 'rank', 'land', 'prob']) delete cache[k]; s.g = s.b = null; }
  const cost = () => cache.cost ??= M.costs(P, s.lamE, s.lamC);
  const grid = () => P.N <= 10 ? 40 : 14;
  const land = () => cache.land ??= M.landscape(cost(), P.N, grid());
  function order() {
    if (!cache.order) {
      const c = cost();
      cache.order = Uint32Array.from({length: P.size}, (_, z) => z).sort((a, b) => c[a] - c[b]);
      cache.rank = new Uint32Array(P.size); cache.order.forEach((z, r) => { cache.rank[z] = r; });
    }
    return cache.order;
  }
  function optimal() { // every feasible schedule reaching the minimum delay
    if (!cache.opt) {
      const best = M.optimum(P), set = [];
      let feasible = 0;
      for (let z = 0; z < P.size; z++) if (M.feasible(P, z)) { feasible++; if (P.delay[z] === P.delay[best]) set.push(z); }
      cache.opt = {best, set, feasible, delay: best === null ? null : P.delay[best]};
    }
    return cache.opt;
  }
  function angles() { if (s.g === null) { s.g = land().gamma; s.b = land().beta; } return [s.g, s.b]; }
  function measured() {
    const [g, b] = angles(), key = `${g},${b}`;
    if (cache.prob?.key !== key) cache.prob = {key, p: M.qaoa(cost(), P.N, g, b)};
    return cache.prob.p;
  }
  // Random guessing vs a probability vector: mean cost, chance of a feasible schedule, chance of an optimal one.
  function summary(prob, c, feasibleSet, optimalSet) {
    const size = c.length, sum = set => set.reduce((a, z) => a + prob[z], 0);
    let mean = 0; for (const v of c) mean += v / size;
    return {cost: [mean, M.expectation(prob, c)], feasible: [feasibleSet.length / size, sum(feasibleSet)], optimum: [optimalSet.length / size, sum(optimalSet)]};
  }
  function feasibleSet() { return cache.fs ??= Array.from({length: P.size}, (_, z) => z).filter(z => M.feasible(P, z)); }
  function maxcut() {
    if (!cache.mc) {
      const mc = M.maxcut(P.N), l = M.landscape(mc.cost, P.N, grid()), prob = M.qaoa(mc.cost, P.N, l.gamma, l.beta);
      let min = Infinity; for (const v of mc.cost) min = Math.min(min, v);
      const all = Array.from({length: mc.cost.length}, (_, z) => z);
      cache.mc = {cost: mc.cost, sum: summary(prob, mc.cost, all, all.filter(z => mc.cost[z] === min)), opt: all.filter(z => mc.cost[z] === min)};
    }
    return cache.mc;
  }

  // ---- drawing blocks ----
  function timeline(ctx, x, y, w, h, z, {slots = true, record = null} = {}) {
    const px = t => x + 46 + (t - T0) / (T1 - T0) * (w - 60), rowH = (h - 34) / P.n, sel = M.decode(P, z), arrivals = [];
    if (record) axis = {x: x + 46, w: w - 60};
    U.box(ctx, x, y, w, h, {fill: C.bg, stroke: C.line});
    for (let t = T0; t <= T1; t++) {
      U.line(ctx, px(t), y + 8, px(t), y + h - 26, {color: t % 2 ? '#15232f' : '#1e303e'});
      if (t % 2 === 0) U.text(ctx, String(t), px(t), y + h - 10, {color: C.muted, size: 11, align: 'center'});
    }
    U.text(ctx, 'min', x + w - 6, y + h - 10, {color: C.muted, size: 11, align: 'right'});
    const barH = Math.min(36, rowH * 0.5);
    for (let i = 0; i < P.n; i++) {
      const cy = y + 8 + rowH * (i + 0.5), color = U.AIRCRAFT[i];
      U.text(ctx, 'ABC'[i], x + 16, cy, {color, size: 18, bold: true, base: 'middle'});
      ctx.globalAlpha = 0.55; ctx.beginPath(); ctx.arc(px(P.etas[i]), cy, 12, 0, 2 * Math.PI); ctx.strokeStyle = color; ctx.lineWidth = 1.5; ctx.setLineDash([3, 3]); ctx.stroke(); ctx.setLineDash([]); ctx.globalAlpha = 1;
      if (record === 'eta') hits.push({kind: 'eta', i, x: px(P.etas[i]), y: cy, r: 22});
      for (let j = 0; j < P.m; j++) {
        const t = P.etas[i] + P.shifts[j], on = sel[i].includes(j), sx = px(t);
        if (on) {
          ctx.globalAlpha = 0.2; U.box(ctx, px(t - P.tmin / 2), cy - barH / 2, px(t + P.tmin / 2) - px(t - P.tmin / 2), barH, {fill: color}); ctx.globalAlpha = 1;
          U.box(ctx, px(t - P.tmin / 2), cy - barH / 2, px(t + P.tmin / 2) - px(t - P.tmin / 2), barH, {stroke: color});
          arrivals.push({i, t, cy});
        }
        if (slots || on) { ctx.beginPath(); ctx.arc(sx, cy, on ? 7 : 5, 0, 2 * Math.PI); ctx.fillStyle = on ? color : C.bg; ctx.fill(); ctx.strokeStyle = color; ctx.lineWidth = 1.5; ctx.stroke(); }
        if (record === 'slot') hits.push({kind: 'slot', i, j, x: sx, y: cy, r: 13});
      }
    }
    for (let a = 0; a < arrivals.length; a++) for (let b = a + 1; b < arrivals.length; b++) {
      const p = arrivals[a], q = arrivals[b], gap = Math.abs(p.t - q.t);
      if (p.i === q.i || gap >= P.tmin) continue;
      const xl = px(Math.max(p.t, q.t) - P.tmin / 2), xr = px(Math.min(p.t, q.t) + P.tmin / 2);
      ctx.globalAlpha = 0.3; U.box(ctx, xl, p.cy, xr - xl, q.cy - p.cy, {fill: C.red, radius: 0}); ctx.globalAlpha = 1;
      U.text(ctx, `${gap} min`, (xl + xr) / 2, (p.cy + q.cy) / 2, {color: C.red, size: 13, bold: true, align: 'center', base: 'middle'});
    }
  }
  function bitGrid(ctx, x, y, w, h, z) {
    const cw = Math.min(70, (w - 220) / P.m), ch = Math.min(56, (h - 26) / P.n), sel = M.decode(P, z);
    for (let j = 0; j < P.m; j++) U.text(ctx, `${P.shifts[j] > 0 ? '+' : ''}${P.shifts[j]}`, x + 50 + cw * (j + 0.5), y + 14, {color: C.muted, size: 12, align: 'center'});
    for (let i = 0; i < P.n; i++) {
      const cy = y + 24 + ch * i, color = U.AIRCRAFT[i], ok = sel[i].length === 1;
      U.text(ctx, 'ABC'[i], x + 16, cy + ch / 2, {color, size: 18, bold: true, base: 'middle'});
      for (let j = 0; j < P.m; j++) {
        const on = sel[i].includes(j), cx = x + 50 + cw * j;
        U.box(ctx, cx + 3, cy + 3, cw - 6, ch - 6, {fill: on ? color : C.surface, stroke: on ? color : C.line});
        U.text(ctx, on ? '1' : '0', cx + cw / 2, cy + ch / 2 + 1, {color: on ? '#10202b' : C.muted, size: 18, bold: true, mono: true, align: 'center', base: 'middle'});
        hits.push({kind: 'bit', i, j, x: cx + cw / 2, y: cy + ch / 2, r: Math.min(cw, ch) / 2});
      }
      U.text(ctx, ok ? '✓' : `✗  ${sel[i].length} slot${sel[i].length === 1 ? '' : 's'}`, x + 62 + cw * P.m, cy + ch / 2, {color: ok ? C.mint : C.red, size: 14, bold: true, base: 'middle'});
    }
  }
  const bitstring = z => Array.from({length: P.n}, (_, i) => Array.from({length: P.m}, (_, j) => z >> (i * P.m + j) & 1).join('')).join(' ');

  function energyBars(ctx, x, y, w) {
    const parts = [['Delay', P.delay[s.z], C.amber, `${P.delay[s.z]} min`], [`λ enc × ${P.encoding[s.z]}`, s.lamE * P.encoding[s.z], C.violet, ''], [`λ conf × ${P.conflict[s.z]}`, s.lamC * P.conflict[s.z], C.red, '']];
    const total = cost()[s.z], scale = (w - 20) / Math.max(24, total);
    parts.forEach(([label, v, color], k) => {
      const cy = y + 40 + k * 62;
      U.text(ctx, label, x, cy - 8, {color: C.muted, size: 13});
      U.box(ctx, x, cy, Math.max(2, v * scale), 22, {fill: color, radius: 3});
      U.text(ctx, U.number(v), x + Math.max(2, v * scale) + 8, cy + 11, {size: 14, bold: true, base: 'middle'});
    });
    const cy = y + 40 + 3 * 62 + 14;
    U.line(ctx, x, cy - 26, x + w, cy - 26);
    U.text(ctx, 'Energy', x, cy - 8, {size: 14, bold: true});
    let px = x;
    for (const [, v, color] of parts) { if (v > 0) U.box(ctx, px, cy, v * scale, 30, {fill: color, radius: 3}); px += v * scale; }
    U.text(ctx, U.number(total), px + 8, cy + 15, {size: 20, bold: true, base: 'middle'});
  }
  function sortedStrip(ctx, x, y, w, h) {
    const o = order(), c = cost(), max = c[o[P.size - 1]] || 1, cols = Math.min(P.size, w), bw = w / cols;
    U.box(ctx, x - 10, y - 26, w + 20, h + 50, {fill: C.bg, stroke: C.line});
    U.text(ctx, `All ${P.size.toLocaleString('en-US')} bit combinations, sorted by energy`, x, y - 8, {color: C.muted, size: 12});
    for (let k = 0; k < cols; k++) {
      const z = o[Math.floor(k * P.size / cols)], bh = Math.max(1, c[z] / max * h);
      ctx.fillStyle = C.slate; ctx.fillRect(x + k * bw, y + h - bh, Math.max(1, bw - (bw > 3 ? 1 : 0)), bh);
    }
    for (const z of feasibleSet()) { const rx = x + cache.rank[z] / P.size * w; ctx.fillStyle = C.mint; ctx.fillRect(rx, y + h + 3, Math.max(2, bw - 1), 8); }
    const rx = x + (cache.rank[s.z] + 0.5) / P.size * w;
    U.line(ctx, rx, y - 2, rx, y + h + 12, {color: C.amber, width: 2});
    const valid = M.feasible(P, o[0]);
    U.text(ctx, valid ? '◀ minimum ✓' : '◀ minimum ✗ cheats', x + 12, y + 14, {color: valid ? C.mint : C.red, size: 13, bold: true});
    U.text(ctx, '▮ valid schedule', x + w, y + h + 12, {color: C.mint, size: 11, align: 'right'});
  }
  function weightMap(ctx) {
    const {x, y, w, h, nE, nC, maxE, maxC} = MAP, cw = w / nE, ch = h / nC;
    if (!cache.map) cache.map = Uint8Array.from({length: nE * nC}, (_, k) => M.weightsValid(P, (k % nE) * maxE / (nE - 1), Math.floor(k / nE) * maxC / (nC - 1)) ? 1 : 0);
    for (let k = 0; k < nE * nC; k++) { ctx.fillStyle = cache.map[k] ? '#1f6a5f' : '#5c2b30'; ctx.fillRect(x + (k % nE) * cw + 0.5, y + h - (Math.floor(k / nE) + 1) * ch + 0.5, cw - 1, ch - 1); }
    const at = (e, c) => [x + (e / maxE * (nE - 1) + 0.5) * cw, y + h - (c / maxC * (nC - 1) + 0.5) * ch];
    for (let e = 0; e <= maxE; e += 2) U.text(ctx, String(e), at(e, 0)[0], y + h + 18, {color: C.muted, size: 12, align: 'center'});
    for (let c = 0; c <= maxC; c++) U.text(ctx, String(c), x - 10, at(0, c)[1], {color: C.muted, size: 12, align: 'right', base: 'middle'});
    U.text(ctx, 'λ enc  (one slot per aircraft)', x + w / 2, y + h + 40, {size: 13, align: 'center'});
    U.text(ctx, 'λ conf  (no conflict)', x - 40, y - 14, {size: 13});
    const [ax, ay] = at(9, 2); ctx.save(); ctx.translate(ax, ay); ctx.rotate(Math.PI / 4); U.box(ctx, -6, -6, 12, 12, {stroke: '#fff', width: 2, radius: 0}); ctx.restore();
    U.text(ctx, 'paper', ax + 12, ay - 10, {size: 12, color: '#fff'});
    const [mx, my] = at(s.lamE, s.lamC); ctx.beginPath(); ctx.arc(mx, my, 8, 0, 2 * Math.PI); ctx.strokeStyle = C.amber; ctx.lineWidth = 3; ctx.stroke();
    U.box(ctx, x + w - 200, y + 2, 196, 46, {fill: 'rgba(9,16,24,.8)', radius: 4}); U.box(ctx, x + w - 190, y + 8, 14, 14, {fill: '#1f6a5f', radius: 2}); U.text(ctx, 'valid minimum', x + w - 170, y + 19, {size: 12});
    U.box(ctx, x + w - 190, y + 28, 14, 14, {fill: '#5c2b30', radius: 2}); U.text(ctx, 'cheating minimum', x + w - 170, y + 39, {size: 12});
  }
  function landscapeMap(ctx, l, mark) {
    const {x, y, w, h} = LAND, G = l.G, cw = w / G, ch = h / G;
    let lo = Infinity, hi = -Infinity; for (const v of l.values) { lo = Math.min(lo, v); hi = Math.max(hi, v); }
    for (let k = 0; k < G * G; k++) { ctx.fillStyle = U.rgb(U.ramp((l.values[k] - lo) / (hi - lo || 1))); ctx.fillRect(x + (k % G) * cw, y + h - (Math.floor(k / G) + 1) * ch, cw + 0.5, ch + 0.5); }
    U.box(ctx, x, y, w, h, {stroke: C.line, radius: 0});
    U.text(ctx, 'γ', x + w / 2, y + h + 22, {size: 15, align: 'center'}); U.text(ctx, 'β', x - 24, y + h / 2, {size: 15, base: 'middle'});
    U.text(ctx, '0', x, y + h + 18, {color: C.muted, size: 12, align: 'center'}); U.text(ctx, 'π', x + w, y + h + 18, {color: C.muted, size: 12, align: 'center'});
    U.text(ctx, '0', x - 8, y + h, {color: C.muted, size: 12, align: 'right'}); U.text(ctx, 'π', x - 8, y + 10, {color: C.muted, size: 12, align: 'right'});
    const gx = x + mark[0] / Math.PI * w, gy = y + h - mark[1] / Math.PI * h;
    U.line(ctx, gx - 12, gy, gx + 12, gy, {color: '#fff', width: 2}); U.line(ctx, gx, gy - 12, gx, gy + 12, {color: '#fff', width: 2});
    for (let k = 0; k <= 40; k++) { ctx.fillStyle = U.rgb(U.ramp(k / 40)); ctx.fillRect(x + k * 4, y - 28, 4, 10); }
    U.text(ctx, 'low mean cost', x, y - 34, {color: C.muted, size: 11}); U.text(ctx, 'high', x + 164, y - 34, {color: C.muted, size: 11, align: 'right'});
  }
  function distribution(ctx, x, y, w, h, prob) {
    const o = order(), bins = Math.min(P.size, 250), bw = w / bins, opt = new Set(optimal().set), mean = new Float64Array(bins), kind = new Uint8Array(bins);
    for (let r = 0; r < P.size; r++) { const k = Math.floor(r * bins / P.size), z = o[r]; mean[k] += prob[z]; if (opt.has(z)) kind[k] = 2; else if (M.feasible(P, z) && !kind[k]) kind[k] = 1; }
    const per = P.size / bins, uniform = 1 / P.size;
    let top = uniform * 2; for (let k = 0; k < bins; k++) { mean[k] /= per; top = Math.max(top, mean[k]); }
    U.box(ctx, x - 10, y - 26, w + 20, h + 50, {fill: C.bg, stroke: C.line});
    U.text(ctx, 'Probability of measuring each combination', x, y - 8, {color: C.muted, size: 12});
    for (let k = 0; k < bins; k++) { const bh = mean[k] / top * h; ctx.fillStyle = [C.slate, C.mint, C.amber][kind[k]]; ctx.fillRect(x + k * bw, y + h - bh, Math.max(1, bw - (bw > 3 ? 1 : 0)), Math.max(kind[k] ? 2 : 0, bh)); }
    const uy = y + h - uniform / top * h; U.line(ctx, x, uy, x + w, uy, {color: '#fff', dash: [4, 4]}); U.text(ctx, 'random', x + w, uy - 5, {size: 11, align: 'right'});
    U.text(ctx, 'sorted by cost →', x, y + h + 16, {color: C.muted, size: 11});
    U.text(ctx, '▮ optimum', x + w - 90, y + h + 16, {color: C.amber, size: 11, align: 'right'}); U.text(ctx, '▮ valid', x + w, y + h + 16, {color: C.mint, size: 11, align: 'right'});
  }
  // rows: [label, [random, qaoa], lowerIsBetter]
  function versus(ctx, x, y, w, rows, name = 'QAOA') {
    rows.forEach(([label, [random, value], format], k) => {
      const cy = y + k * 78, max = Math.max(random, value) || 1, bw = w - 190;
      U.text(ctx, label, x, cy, {size: 14, bold: true});
      U.text(ctx, 'random', x, cy + 22, {color: C.muted, size: 12}); U.box(ctx, x + 60, cy + 11, Math.max(2, random / max * bw), 14, {fill: C.slate, radius: 2}); U.text(ctx, format(random), x + 68 + random / max * bw, cy + 22, {size: 12});
      U.text(ctx, name, x, cy + 44, {color: C.mint, size: 12}); U.box(ctx, x + 60, cy + 33, Math.max(2, value / max * bw), 14, {fill: C.mint, radius: 2}); U.text(ctx, format(value), x + 68 + value / max * bw, cy + 44, {size: 12});
    });
  }
  function histogram(ctx, x, y, w, h, c, feasibleStates, optimalStates, title) {
    let lo = Infinity, hi = -Infinity; for (const v of c) { lo = Math.min(lo, v); hi = Math.max(hi, v); }
    const bins = 44, count = new Float64Array(bins), kind = new Uint8Array(bins), at = v => Math.min(bins - 1, Math.floor((v - lo) / (hi - lo || 1) * bins));
    for (const v of c) count[at(v)]++;
    for (const z of feasibleStates) kind[at(c[z])] = 1;
    for (const z of optimalStates) kind[at(c[z])] = 2;
    const top = Math.max(...count), bw = w / bins;
    U.box(ctx, x - 10, y - 30, w + 20, h + 56, {fill: C.bg, stroke: C.line});
    U.text(ctx, title, x, y - 10, {size: 14, bold: true});
    for (let k = 0; k < bins; k++) if (count[k]) { const bh = Math.max(2, Math.sqrt(count[k] / top) * h); ctx.fillStyle = [C.slate, C.mint, C.amber][kind[k]]; ctx.fillRect(x + k * bw, y + h - bh, bw - 1, bh); }
    U.text(ctx, 'cost →', x, y + h + 18, {color: C.muted, size: 11}); U.text(ctx, 'number of combinations ↑', x + w, y + 4, {color: C.muted, size: 11, align: 'right'});
  }

  function instance(ui) {
    ui.choice('Aircraft', [[2, '2'], [3, '3']], s.n, v => { s.n = Number(v); rebuild(); });
    ui.choice('Slots per aircraft', [[3, '3'], [5, '5']], s.m, v => { s.m = Number(v); rebuild(); });
    ui.choice('Slot spacing', [[1, '1 min'], [2, '2 min'], [3, '3 min']], s.step, v => { s.step = Number(v); rebuild(); });
  }
  function weights(ui) {
    ui.slider('λ enc', {min: 0, max: 12, step: 0.5, value: s.lamE}, v => { s.lamE = v; reweigh(); });
    ui.slider('λ conf', {min: 0, max: 4, step: 0.25, value: s.lamC}, v => { s.lamC = v; reweigh(); });
  }
  const conflictsNow = z => P.conflict[z];

  rebuild();
  KwaPapers.arrivals = {
    label: 'Arrivals · QUBO + QAOA',
    source: 'Cassassolles, Kwa, Chai, Gan — Constrained Quantum Optimization for Scheduling Aircraft Arrivals (2026). Example instance: arrival times, slot spacing and the MaxCut graph are chosen here, the paper does not give them. QAOA is simulated exactly and its two angles are scanned on a grid; the paper tunes them with COBYLA.',
    state: s,
    steps: [
      {title: 'Conflict', caption: 'Two arrivals less than 4 min apart at the same waypoint are in conflict. Drag the circles.'},
      {title: 'Slots', caption: 'A speed advisory picks one time slot per aircraft. Click to separate everyone while moving as little as possible.'},
      {title: 'Bits', caption: 'For the machine: one bit per aircraft and slot. Nothing stops it from picking none or two. Click the bits.'},
      {title: 'Energy', caption: 'A QUBO has no rules: each rule becomes a penalty added to the cost. Lower the λ weights and watch the minimum.'},
      {title: 'Weights', caption: 'Each cell is a pair of weights. Green: the minimum is still a valid schedule. Aim for the smallest green corner.'},
      {title: 'QAOA', caption: 'One circuit, two angles. Each point of the map is a setting. Right: what a measurement returns. Click the map.'},
      {title: 'MaxCut', caption: 'Same number of qubits. Without constraints everything is valid and the landscape is regular; with them, almost everything is forbidden.'},
    ],
    enter(step) { if (step === 0) s.z = neutral(); },
    controls(step, ui) {
      if (step === 0) ui.button('Reset', () => { s.etas = [0, 3, 6]; rebuild(); });
      if ([1, 2, 5, 6].includes(step)) instance(ui);
      if (step === 3 || step === 4) { weights(ui); ui.button('Paper weights (9, 2)', () => { s.lamE = 9; s.lamC = 2; reweigh(); }); }
      if (step === 5) ui.button('Best setting', () => { s.g = s.b = null; });
    },
    draw(step, ctx) {
      hits = [];
      if (step === 0) {
        timeline(ctx, 40, 50, 1020, 440, neutral(), {slots: false, record: 'eta'});
        U.box(ctx, 60, 520, 130, 26, {stroke: C.muted}); U.text(ctx, '4 min reserved around each arrival', 204, 538, {color: C.muted, size: 13});
        U.box(ctx, 60, 560, 130, 26, {fill: '#5a2c31', radius: 0}); U.text(ctx, 'overlap = conflict', 204, 578, {color: C.red, size: 13});
      } else if (step === 1) {
        timeline(ctx, 40, 50, 1020, 440, s.z, {record: 'slot'});
        U.text(ctx, '◀ speed up', 100, 530, {color: C.muted, size: 14}); U.text(ctx, 'slow down ▶', 1040, 530, {color: C.muted, size: 14, align: 'right'});
        U.text(ctx, '○ possible slot     ● chosen slot     ◌ planned time', 570, 530, {color: C.muted, size: 13, align: 'center'});
      } else if (step === 2) {
        timeline(ctx, 40, 20, 1020, 300, s.z, {record: 'slot'});
        bitGrid(ctx, 40, 350, 620, 240, s.z);
        U.text(ctx, 'What the machine sees', 700, 380, {color: C.muted, size: 13});
        U.text(ctx, bitstring(s.z), 700, 420, {size: P.N > 10 ? 20 : 28, bold: true, mono: true});
        U.text(ctx, `2^${P.N} = ${P.size.toLocaleString('en-US')} combinations`, 700, 470, {size: 15});
        U.text(ctx, `of which ${optimal().feasible} valid schedule${optimal().feasible === 1 ? '' : 's'}`, 700, 496, {color: C.mint, size: 15});
      } else if (step === 3) {
        timeline(ctx, 40, 20, 640, 240, s.z, {record: 'slot'});
        bitGrid(ctx, 40, 268, 640, 150, s.z);
        energyBars(ctx, 720, 20, 340);
        sortedStrip(ctx, 50, 470, 1000, 110);
      } else if (step === 4) {
        weightMap(ctx);
        const g = order()[0], valid = M.feasible(P, g);
        U.text(ctx, 'Minimum with these weights', 640, 80, {size: 15, bold: true});
        U.text(ctx, valid ? '✓ valid schedule' : '✗ the machine cheats', 1060, 80, {color: valid ? C.mint : C.red, size: 15, bold: true, align: 'right'});
        timeline(ctx, 640, 96, 420, 300, g);
        U.text(ctx, bitstring(g), 640, 430, {size: 18, mono: true, bold: true});
        U.text(ctx, `λ enc = ${s.lamE}     λ conf = ${s.lamC}`, 640, 462, {color: C.amber, size: 14});
      } else if (step === 5) {
        landscapeMap(ctx, land(), angles());
        const prob = measured(), sum = summary(prob, cost(), feasibleSet(), optimal().set);
        distribution(ctx, 570, 56, 490, 190, prob);
        versus(ctx, 570, 330, 490, [['Mean cost (lower is better)', sum.cost, U.number], ['Chance of a valid schedule', sum.feasible, U.percent], ['Chance of the optimum', sum.optimum, U.percent]]);
      } else {
        const l = land(), prob = M.qaoa(cost(), P.N, l.gamma, l.beta), a = summary(prob, cost(), feasibleSet(), optimal().set), mc = maxcut();
        histogram(ctx, 50, 60, 470, 260, cost(), feasibleSet(), optimal().set, 'Arrivals — constrained');
        histogram(ctx, 590, 60, 470, 260, mc.cost, Array.from({length: mc.cost.length}, (_, z) => z), mc.opt, 'MaxCut — unconstrained');
        versus(ctx, 50, 400, 470, [['Chance of the optimum, best setting', a.optimum, U.percent]]);
        versus(ctx, 590, 400, 470, [['Chance of the optimum, best setting', mc.sum.optimum, U.percent]]);
        U.text(ctx, a.optimum[0] ? `× ${(a.optimum[1] / a.optimum[0]).toFixed(1)} better than random` : 'no valid schedule exists', 50, 500, {color: C.amber, size: 18, bold: true});
        U.text(ctx, `× ${(mc.sum.optimum[1] / mc.sum.optimum[0]).toFixed(1)} better than random`, 590, 500, {color: C.amber, size: 18, bold: true});
        U.text(ctx, '▮ optimum   ', 50, 560, {color: C.amber, size: 12}); U.text(ctx, '▮ contains a valid schedule', 130, 560, {color: C.mint, size: 12}); U.text(ctx, '▮ invalid', 330, 560, {color: C.muted, size: 12});
      }
    },
    stats(step) {
      const z = step === 0 ? neutral() : s.z, opt = optimal(), tone = v => v ? 'good' : 'bad';
      if (step === 0) {
        const rows = [];
        for (let i = 0; i < P.n; i++) for (let k = i + 1; k < P.n; k++) { const gap = Math.abs(P.etas[i] - P.etas[k]); rows.push([`${'ABC'[i]} – ${'ABC'[k]}`, `${gap} min`, tone(gap >= P.tmin)]); }
        return rows.concat([['Conflicts', String(conflictsNow(z)), tone(!conflictsNow(z))]]);
      }
      if (step === 1) return [['Total shift', `${P.delay[z]} min`], ['Conflicts', String(P.conflict[z]), tone(!P.conflict[z])], ['Best possible', opt.best === null ? 'none' : `${opt.delay} min`]];
      if (step === 2) return [['Bits', String(P.N)], ['Combinations', P.size.toLocaleString('en-US')], ['Valid schedules', String(opt.feasible)], ['Current state', M.feasible(P, z) ? 'valid' : 'invalid', tone(M.feasible(P, z))]];
      if (step === 3) return [['Current energy', U.number(cost()[z])], ['Minimum energy', U.number(cost()[order()[0]])], ['Minimum is valid', M.feasible(P, order()[0]) ? 'yes' : 'no', tone(M.feasible(P, order()[0]))]];
      if (step === 4) return [['λ enc', String(s.lamE)], ['λ conf', String(s.lamC)], ['Weights valid', M.weightsValid(P, s.lamE, s.lamC) ? 'yes' : 'no', tone(M.weightsValid(P, s.lamE, s.lamC))]];
      if (step === 5) {
        const c = cost(), sum = summary(measured(), c, feasibleSet(), opt.set), lo = c[order()[0]], hi = c[order()[P.size - 1]], r = v => ((v - hi) / (lo - hi)).toFixed(3);
        return [['Qubits', String(P.N)], ['γ', angles()[0].toFixed(2)], ['β', angles()[1].toFixed(2)], ['Approximation ratio', r(sum.cost[1])], ['… by random guessing', r(sum.cost[0])]];
      }
      return [['Qubits', String(P.N)], ['Distinct costs, arrivals', String(new Set(cost()).size)], ['Distinct costs, MaxCut', String(new Set(maxcut().cost).size)], ['Valid, arrivals', U.percent(opt.feasible / P.size)], ['Valid, MaxCut', '100 %']];
    },
    pointer(step, type, x, y) {
      if (type === 'up') { s.drag = null; return false; }
      if (type === 'down') {
        const hit = hits.find(h => Math.hypot(h.x - x, h.y - y) <= h.r);
        if (hit?.kind === 'eta') s.drag = {kind: 'eta', i: hit.i};
        else if (hit) {
          const bit = 1 << (hit.i * P.m + hit.j);
          if (step === 1) { for (let j = 0; j < P.m; j++) s.z &= ~(1 << (hit.i * P.m + j)); s.z |= bit; } else s.z ^= bit;
          return true;
        } else if (step === 4 && x >= MAP.x && x <= MAP.x + MAP.w && y >= MAP.y && y <= MAP.y + MAP.h) s.drag = {kind: 'map'};
        else if (step === 5 && x >= LAND.x && x <= LAND.x + LAND.w && y >= LAND.y && y <= LAND.y + LAND.h) s.drag = {kind: 'land'};
      }
      if (!s.drag) return false;
      const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
      if (s.drag.kind === 'eta') {
        const t = clamp(Math.round(T0 + (x - axis.x) / axis.w * (T1 - T0)), -2, 9);
        if (t === s.etas[s.drag.i]) return false;
        s.etas[s.drag.i] = t; rebuild();
      } else if (s.drag.kind === 'map') {
        const e = clamp(Math.round((x - MAP.x) / MAP.w * MAP.nE - 0.5), 0, MAP.nE - 1) * MAP.maxE / (MAP.nE - 1), c = clamp(Math.round((MAP.y + MAP.h - y) / MAP.h * MAP.nC - 0.5), 0, MAP.nC - 1) * MAP.maxC / (MAP.nC - 1);
        if (e === s.lamE && c === s.lamC) return false;
        s.lamE = e; s.lamC = c; reweigh(); return 'controls';
      } else {
        s.g = clamp((x - LAND.x) / LAND.w, 0, 1) * Math.PI; s.b = clamp((LAND.y + LAND.h - y) / LAND.h, 0, 1) * Math.PI;
      }
      return true;
    },
  };
})();
