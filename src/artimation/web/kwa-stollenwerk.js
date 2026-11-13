// Step-by-step picture of Stollenwerk et al. (2020): de-conflicting trajectories with departure delays on a quantum annealer.
(function () {
  'use strict';
  const M = KwaModel, U = KwaUI, C = U.C;
  const AREA = {x: 20, y: 40, w: 750, h: 500}, PX = 800, PW = 280, COLORS = [C.amber, C.blue, C.violet, '#9be37a'];
  const MINI = [{from: [0, 80], to: [600, 320], t0: 0}, {from: [0, 320], to: [600, 80], t0: 2}, {from: [0, 210], to: [600, 190], t0: 9}, {from: [380, 400], to: [500, 0], t0: 30}].map(f => ({...f, speed: 8}));
  const STEPS = [1, 2, 3, 6, 9], MAXES = [3, 6, 9, 12, 18, 24], GRID = {x: PX + 40, y: 80, cw: 39, ch: 34};
  // Tables I and II of the paper: largest embeddable instances per delay step.
  const TABLES = [['D-Wave 2X', [[3, 13, 27, 91, 631], [6, 19, 47, 76, 395], [9, 50, 104, 150, 543]]], ['D-Wave 2000Q', [[3, 19, 47, 133, 1235], [6, 50, 104, 200, 1080], [9, 64, 261, 192, 1121]]]];
  const s = {time: 0, playing: false, delays: [0, 0, 0, 0], reach: 6, step: 3, dmax: 18, embed: 6, bit: 0, logp: -2};
  let cache = {}, bitHits = [];

  const pairs = () => cache.pairs ??= M.proximity(MINI);
  const edges = (dmax = 18) => M.conflicts(pairs(), dmax);
  function big() {
    if (!cache.big) {
      const r = M.rng(1), flights = Array.from({length: 36}, () => ({from: [0, 40 + r() * 620], to: [1200, 40 + r() * 620], t0: Math.round(r() * 150), speed: 8}));
      cache.big = {flights, pairs: M.proximity(flights)};
    }
    return cache.big;
  }
  const solution = (step, dmax) => (cache.sol ??= {})[`${step}|${dmax}`] ??= M.solveDelays(MINI.length, edges(dmax), step, dmax) || false;
  const end = delays => Math.max(...MINI.map((f, i) => f.t0 + M.duration(f) + delays[i]));
  const name = e => `F${e.i + 1} – F${e.j + 1}`;

  function plane(ctx, x, y, angle, color) {
    ctx.save(); ctx.translate(x, y); ctx.rotate(angle);
    ctx.beginPath(); ctx.moveTo(11, 0); ctx.lineTo(-8, 7); ctx.lineTo(-4, 0); ctx.lineTo(-8, -7); ctx.closePath();
    ctx.fillStyle = color; ctx.fill(); ctx.strokeStyle = '#10202b'; ctx.lineWidth = 1.5; ctx.stroke(); ctx.restore();
  }
  function scene(ctx, delays, title) {
    const k = AREA.w / 600, X = p => AREA.x + p[0] * k, Y = p => AREA.y + p[1] * k, at = (f, u) => [f.from[0] + (f.to[0] - f.from[0]) * u, f.from[1] + (f.to[1] - f.from[1]) * u];
    U.box(ctx, AREA.x, AREA.y, AREA.w, AREA.h, {fill: C.bg, stroke: C.line});
    U.text(ctx, title, AREA.x, AREA.y - 14, {color: C.muted, size: 13});
    MINI.forEach((f, i) => { U.line(ctx, X(f.from), Y(f.from), X(f.to), Y(f.to), {color: COLORS[i], width: 1.5, dash: [6, 6]}); U.text(ctx, `F${i + 1}`, X(at(f, 0.04)) + 6, Y(at(f, 0.04)) - 10, {color: COLORS[i], size: 15, bold: true}); });
    for (const e of edges()) {
      const hot = M.violated(e, delays);
      [e.i, e.j].forEach((id, n) => { const f = MINI[id], d = M.duration(f), a = at(f, e.zone[n][0] / d), b = at(f, Math.min(1, e.zone[n][1] / d)); U.line(ctx, X(a), Y(a), X(b), Y(b), {color: hot ? C.red : '#5d7385', width: hot ? 6 : 3}); });
    }
    const now = MINI.map((f, i) => M.position(f, s.time, delays[i]));
    now.forEach((p, i) => {
      if (!p) return;
      const close = now.some((q, j) => q && j !== i && Math.hypot(p[0] - q[0], p[1] - q[1]) < M.SEP_NM), f = MINI[i];
      ctx.beginPath(); ctx.arc(X(p), Y(p), M.SEP_NM * k / 2, 0, 2 * Math.PI); ctx.strokeStyle = close ? C.red : COLORS[i]; ctx.lineWidth = close ? 2.5 : 1; ctx.stroke();
      plane(ctx, X(p), Y(p), Math.atan2(f.to[1] - f.from[1], f.to[0] - f.from[0]), COLORS[i]);
    });
    U.line(ctx, AREA.x + 20, AREA.y + AREA.h - 18, AREA.x + 20 + 100 * k, AREA.y + AREA.h - 18, {color: '#fff', width: 2}); U.text(ctx, '100 NM', AREA.x + 28 + 100 * k, AREA.y + AREA.h - 14, {size: 11});
    U.text(ctx, `t = ${Math.floor(s.time)} min`, AREA.x + AREA.w - 14, AREA.y + 24, {size: 16, bold: true, align: 'right', mono: true});
    U.line(ctx, AREA.x + 20, AREA.y + AREA.h + 26, AREA.x + 60, AREA.y + AREA.h + 26, {color: C.red, width: 6}); U.text(ctx, 'conflict: same place less than 3 min apart', AREA.x + 70, AREA.y + AREA.h + 30, {color: C.red, size: 12});
    U.line(ctx, AREA.x + 380, AREA.y + AREA.h + 26, AREA.x + 420, AREA.y + AREA.h + 26, {color: '#5d7385', width: 3}); U.text(ctx, 'close routes, far enough in time', AREA.x + 430, AREA.y + AREA.h + 30, {color: C.muted, size: 12});
  }
  function pairList(ctx) {
    U.text(ctx, 'Flight pairs', PX, 60, {size: 15, bold: true});
    edges().forEach((e, k) => {
      const hot = M.violated(e, s.delays), y = 96 + k * 44;
      U.box(ctx, PX, y - 22, PW, 36, {fill: C.surface, stroke: hot ? C.red : C.line});
      U.text(ctx, name(e), PX + 12, y, {size: 14, bold: true}); U.text(ctx, hot ? 'conflict' : 'clear', PX + PW - 12, y, {color: hot ? C.red : C.mint, size: 13, bold: true, align: 'right'});
    });
  }
  function intervals(ctx) {
    const span = 20, x = d => PX + 10 + (d + span) / (2 * span) * (PW - 20);
    U.text(ctx, 'Delay difference, forbidden range in red', PX, 60, {size: 13, bold: true});
    edges().forEach((e, k) => {
      const y = 100 + k * 66, diff = s.delays[e.i] - s.delays[e.j], hot = M.violated(e, s.delays);
      U.text(ctx, `d${e.i + 1} − d${e.j + 1}`, PX + 10, y - 14, {color: C.muted, size: 12}); U.text(ctx, `${diff > 0 ? '+' : ''}${diff} min`, PX + PW - 10, y - 14, {color: hot ? C.red : C.mint, size: 12, bold: true, align: 'right'});
      U.line(ctx, x(-span), y, x(span), y, {color: C.slate, width: 2});
      U.box(ctx, x(Math.max(-span, e.lo - 0.5)), y - 7, x(Math.min(span, e.hi + 0.5)) - x(Math.max(-span, e.lo - 0.5)), 14, {fill: '#7a3238', radius: 3});
      U.line(ctx, x(0), y - 10, x(0), y + 10, {color: C.muted});
      ctx.beginPath(); ctx.arc(x(Math.max(-span, Math.min(span, diff))), y, 7, 0, 2 * Math.PI); ctx.fillStyle = hot ? C.red : C.mint; ctx.fill(); ctx.strokeStyle = '#10202b'; ctx.lineWidth = 2; ctx.stroke();
    });
    U.text(ctx, '−20', x(-span), 490, {color: C.muted, size: 11}); U.text(ctx, '0', x(0), 490, {color: C.muted, size: 11, align: 'center'}); U.text(ctx, '+20 min', x(span), 490, {color: C.muted, size: 11, align: 'right'});
  }
  function graph(ctx) {
    const {flights, pairs: all} = big(), list = M.conflicts(all, s.reach), comp = M.components(flights.length, list), k = AREA.w / 1200, palette = [C.mint, C.amber, C.blue, C.violet, C.red, '#9be37a', '#f29bd4', '#7fe0ff', '#d8c36a'];
    const X = p => AREA.x + p[0] * k, Y = p => AREA.y + 30 + p[1] * k, spot = flights.map((f, i) => { const u = 0.12 + 0.76 * ((i * 0.618034) % 1); return [f.from[0] + (f.to[0] - f.from[0]) * u, f.from[1] + (f.to[1] - f.from[1]) * u]; }), mid = f => spot[flights.indexOf(f)];
    const order = comp.sizes.map((size, id) => ({size, id})).filter(c => c.size > 1).sort((a, b) => b.size - a.size), color = id => { const n = order.findIndex(c => c.id === id); return n < 0 ? C.slate : palette[n % palette.length]; };
    U.box(ctx, AREA.x, AREA.y, AREA.w, AREA.h, {fill: C.bg, stroke: C.line});
    U.text(ctx, '36 flights (illustrative). One dot per flight, placed on its route; one link per potential conflict.', AREA.x, AREA.y - 14, {color: C.muted, size: 13});
    for (const f of flights) U.line(ctx, X(f.from), Y(f.from), X(f.to), Y(f.to), {color: '#1c2d3b'});
    for (const e of list) U.line(ctx, X(mid(flights[e.i])), Y(mid(flights[e.i])), X(mid(flights[e.j])), Y(mid(flights[e.j])), {color: color(comp.id[e.i]), width: 1.5});
    flights.forEach((f, i) => { ctx.beginPath(); ctx.arc(X(mid(f)), Y(mid(f)), comp.sizes[comp.id[i]] > 1 ? 7 : 4, 0, 2 * Math.PI); ctx.fillStyle = color(comp.id[i]); ctx.fill(); ctx.strokeStyle = '#10202b'; ctx.lineWidth = 1.5; ctx.stroke(); });
    U.text(ctx, 'Independent sub-problems', PX, 60, {size: 15, bold: true}); U.text(ctx, 'flights in each', PX, 80, {color: C.muted, size: 12});
    order.slice(0, 12).forEach((c, n) => { const y = 96 + n * 30; U.box(ctx, PX, y, Math.max(6, c.size / 36 * (PW - 40)), 20, {fill: color(c.id), radius: 3}); U.text(ctx, String(c.size), PX + Math.max(6, c.size / 36 * (PW - 40)) + 8, y + 15, {size: 13, bold: true}); });
    if (!order.length) U.text(ctx, 'none: every flight is alone', PX, 110, {color: C.mint, size: 13});
    cache.graph = {edges: list.length, parts: order.length, largest: Math.max(...comp.sizes), alone: comp.sizes.filter(v => v === 1).length};
  }
  function table(ctx) {
    const best = solution(1, 24), {x, y, cw, ch} = GRID;
    U.text(ctx, 'Best total delay (min)', PX, 40, {size: 15, bold: true}); U.text(ctx, 'maximum delay →', x, y - 26, {color: C.muted, size: 11}); U.text(ctx, 'step', PX, y - 8, {color: C.muted, size: 11});
    MAXES.forEach((m, c) => U.text(ctx, String(m), x + cw * (c + 0.5), y - 8, {size: 12, align: 'center'}));
    STEPS.forEach((st, r) => {
      U.text(ctx, String(st), PX + 20, y + ch * (r + 0.5), {size: 12, align: 'center', base: 'middle'});
      MAXES.forEach((m, c) => {
        const sol = solution(st, m), on = st === s.step && m === s.dmax;
        U.box(ctx, x + cw * c + 2, y + ch * r + 2, cw - 4, ch - 4, {fill: sol ? U.rgb(U.ramp(0.25 + 0.6 * (sol.total - best.total) / 20)) : '#3a2226', stroke: on ? '#fff' : undefined, width: 2.5, radius: 4});
        U.text(ctx, sol ? String(sol.total) : '✗', x + cw * (c + 0.5), y + ch * (r + 0.5), {color: sol ? '#10202b' : C.red, size: 13, bold: true, align: 'center', base: 'middle'});
      });
    });
    const sol = solution(s.step, s.dmax), top = y + ch * STEPS.length + 44;
    U.text(ctx, sol ? 'Delay per flight' : 'No conflict-free answer', PX, top, {size: 14, bold: true, color: sol ? C.text : C.red});
    if (sol) sol.delays.forEach((d, i) => { const by = top + 16 + i * 34; U.text(ctx, `F${i + 1}`, PX, by + 15, {color: COLORS[i], size: 13, bold: true}); U.box(ctx, PX + 30, by, Math.max(3, d / 24 * (PW - 90)), 20, {fill: COLORS[i], radius: 3}); U.text(ctx, `${d} min`, PX + 38 + d / 24 * (PW - 90), by + 15, {size: 12}); });
  }
  function chimera(ctx) {
    const levels = Math.floor(18 / s.embed) + 1, N = MINI.length * levels, emb = M.cliqueEmbedding(N), m = emb.m, ox = 330, oy = 40, cs = 540 / m, gx = 20, gy = 90, cell = Math.min(34, 250 / levels);
    bitHits = [];
    U.text(ctx, 'One bit per flight and delay value', gx, 60, {size: 14, bold: true});
    for (let l = 0; l < levels; l++) U.text(ctx, String(l * s.embed), gx + 34 + cell * (l + 0.5), gy - 6, {color: C.muted, size: 11, align: 'center'});
    for (let i = 0; i < MINI.length; i++) {
      U.text(ctx, `F${i + 1}`, gx, gy + cell * (i + 0.5), {color: COLORS[i], size: 13, bold: true, base: 'middle'});
      for (let l = 0; l < levels; l++) { const v = i * levels + l, bx = gx + 34 + cell * l, by = gy + cell * i; U.box(ctx, bx + 2, by + 2, cell - 4, cell - 4, {fill: v === s.bit ? '#fff' : COLORS[i], radius: 4}); bitHits.push({v, x: bx, y: by, size: cell}); }
    }
    U.text(ctx, `${N} bits`, gx, gy + cell * 4 + 34, {size: 22, bold: true}); U.text(ctx, 'each must be linked to many others', gx, gy + cell * 4 + 56, {color: C.muted, size: 12});
    U.text(ctx, '↓', gx + 20, gy + cell * 4 + 92, {size: 22});
    U.text(ctx, `${emb.physical} qubits`, gx, gy + cell * 4 + 130, {size: 22, bold: true, color: C.amber}); U.text(ctx, `chains of ${emb.chain}, on a chip where a`, gx, gy + cell * 4 + 152, {color: C.muted, size: 12}); U.text(ctx, 'qubit has at most 6 neighbours', gx, gy + cell * 4 + 170, {color: C.muted, size: 12});
    U.text(ctx, 'Click a bit: its chain lights up.', gx, 560, {color: C.muted, size: 12});
    const off = k => cs * (0.2 + 0.2 * k);
    U.text(ctx, `Chimera chip, ${m} × ${m} cells of 8 qubits`, ox, oy - 14, {color: C.muted, size: 13});
    for (let r = 0; r < m; r++) for (let c = 0; c < m; c++) {
      U.box(ctx, ox + c * cs + 3, oy + r * cs + 3, cs - 6, cs - 6, {stroke: '#1e303e', radius: 6});
      for (let k = 0; k < 4; k++) { U.line(ctx, ox + c * cs + cs * 0.1, oy + r * cs + off(k), ox + (c + 1) * cs - cs * 0.1, oy + r * cs + off(k), {color: '#2b3d49', width: 2}); U.line(ctx, ox + c * cs + off(k), oy + r * cs + cs * 0.1, ox + c * cs + off(k), oy + (r + 1) * cs - cs * 0.1, {color: '#2b3d49', width: 2}); }
    }
    const chain = (v, color, width) => { const g = Math.floor(v / 4), k = v % 4, y = oy + g * cs + off(k), x = ox + g * cs + off(k); U.line(ctx, ox + cs * 0.1, y, x, y, {color, width}); U.line(ctx, x, y, x, oy + m * cs - cs * 0.1, {color, width}); };
    for (let v = 0; v < N; v++) if (v !== s.bit) chain(v, COLORS[Math.floor(v / levels)], Math.max(1.5, 14 / m));
    chain(s.bit, '#fff', Math.max(3, 24 / m));
    cache.emb = {N, ...emb};
  }
  function machine(ctx) {
    const max = 1300, bw = 260;
    U.text(ctx, 'Largest sub-problems that fit on the real chips (paper, Tables I and II)', 20, 36, {size: 15, bold: true});
    TABLES.forEach(([chip, rows], t) => {
      const y0 = 70 + t * 268;
      U.text(ctx, chip, 20, y0, {size: 14, bold: true, color: C.amber});
      rows.forEach(([step, flights, conflicts, logical, physical], r) => {
        const y = y0 + 26 + r * 76;
        U.text(ctx, `step ${step} min`, 20, y + 14, {size: 13, bold: true}); U.text(ctx, `${flights} flights · ${conflicts} conflicts`, 20, y + 34, {color: C.muted, size: 12});
        U.box(ctx, 190, y, logical / max * bw * 2, 18, {fill: C.mint, radius: 3}); U.text(ctx, `${logical} bits`, 198 + logical / max * bw * 2, y + 14, {size: 12});
        U.box(ctx, 190, y + 24, physical / max * bw * 2, 18, {fill: C.violet, radius: 3}); U.text(ctx, `${physical} qubits`, 198 + physical / max * bw * 2, y + 38, {size: 12});
      });
    });
    const p = 10 ** s.logp, t99 = Math.log(0.01) / Math.log(1 - p) * 20e-6, x0 = PX + 10, y0 = 90, w = PW - 20, h = 220, X = lp => x0 + (lp + 6) / 6 * w, Y = sec => y0 + h - (Math.log10(sec) + 5) / 7 * h;
    U.text(ctx, 'Time to be 99 % sure', PX, 36, {size: 15, bold: true}); U.text(ctx, 'one anneal = 20 µs, repeated until it works', PX, 56, {color: C.muted, size: 12});
    U.box(ctx, x0 - 10, y0 - 10, w + 20, h + 40, {fill: C.bg, stroke: C.line});
    ctx.beginPath(); for (let lp = -6; lp <= -0.05; lp += 0.05) { const sec = Math.log(0.01) / Math.log(1 - 10 ** lp) * 20e-6; lp === -6 ? ctx.moveTo(X(lp), Y(sec)) : ctx.lineTo(X(lp), Y(sec)); } ctx.strokeStyle = C.mint; ctx.lineWidth = 2; ctx.stroke();
    ctx.beginPath(); ctx.arc(X(s.logp), Y(t99), 7, 0, 2 * Math.PI); ctx.fillStyle = C.amber; ctx.fill();
    U.text(ctx, 'success chance per anneal →', x0, y0 + h + 22, {color: C.muted, size: 11}); U.text(ctx, 'time ↑', x0, y0 + 4, {color: C.muted, size: 11});
    U.text(ctx, t99 < 1e-3 ? `${(t99 * 1e6).toFixed(0)} µs` : t99 < 1 ? `${(t99 * 1e3).toFixed(1)} ms` : U.duration(t99), PX, y0 + h + 76, {size: 26, bold: true, color: C.amber});
    U.text(ctx, `at ${U.percent(p)} success per anneal`, PX, y0 + h + 98, {color: C.muted, size: 12});
    U.text(ctx, 'Success fades as sub-problems grow and', PX, 470, {size: 12}); U.text(ctx, 'steps get finer: the chip cannot set', PX, 488, {size: 12}); U.text(ctx, 'coefficients more precisely than about 1/30.', PX, 506, {size: 12});
  }
  function play() { s.time = 0; s.playing = true; }
  const timeSlider = ui => ui.slider('Time', {min: 0, max: Math.ceil(end(s.delays)), step: 1, value: Math.floor(s.time), format: v => `${v} min`}, v => { s.time = v; s.playing = false; });

  KwaPapers.stollenwerk = {
    label: 'Trajectories · quantum annealing',
    source: 'Stollenwerk, O’Gorman, Venturelli, Mandrà, Rodionova, Ng, Sridhar, Rieffel, Biswas — Quantum Annealing Applied to De-Conflicting Optimal Trajectories for Air Traffic Management (IEEE T-ITS, 2020). Flights shown are illustrative, and the chains drawn are a textbook clique embedding (the paper uses D-Wave’s heuristic embedder); separation standards, model and chip figures are from the paper.',
    state: s,
    steps: [
      {title: 'Conflict', caption: 'Each flight has its ideal route. Two flights conflict when they pass within 30 NM of the same place less than 3 min apart.'},
      {title: 'Delay', caption: 'The only lever: hold a flight on the ground. Each conflict forbids a range of delay differences. Move the sliders.'},
      {title: 'Graph', caption: 'Flights as dots, possible conflicts as links. Separate groups can be solved separately. Allow longer delays and watch them merge.'},
      {title: 'Step size', caption: 'A quantum chip needs a few allowed delay values. Finer steps give better answers; a modest maximum is enough. Click a cell.'},
      {title: 'Qubits', caption: 'One bit per flight and delay value. The chip has few links per qubit, so each bit becomes a chain of qubits.'},
      {title: 'Machine', caption: 'What fitted on the real D-Wave chips, and how run time explodes when the chance of success per run drops.'},
    ],
    enter(step) {
      if (step === 0) s.delays = [0, 0, 0, 0];
      if (step === 3) { const sol = solution(s.step, s.dmax); s.delays = sol ? sol.delays.slice() : [0, 0, 0, 0]; }
      s.time = 0; s.playing = step === 0 || step === 3;
    },
    controls(step, ui) {
      if (step === 0 || step === 1 || step === 3) { ui.button('▶ Play', play); timeSlider(ui); }
      if (step === 1) {
        MINI.forEach((_, i) => ui.slider(`Delay F${i + 1}`, {min: 0, max: 18, step: 1, value: s.delays[i], format: v => `${v} min`}, v => { s.delays[i] = v; }));
        ui.button('Best answer', () => { s.delays = solution(1, 18).delays.slice(); play(); });
        ui.button('Reset', () => { s.delays = [0, 0, 0, 0]; });
      }
      if (step === 2) ui.slider('Maximum delay allowed', {min: 0, max: 60, step: 1, value: s.reach, format: v => `${v} min`}, v => { s.reach = v; });
      if (step === 4) ui.choice('Delay step', [[3, '3 min (7 values)'], [6, '6 min (4 values)'], [9, '9 min (3 values)']], s.embed, v => { s.embed = Number(v); s.bit = 0; });
      if (step === 5) ui.slider('Success chance per anneal', {min: -6, max: -0.05, step: 0.05, value: s.logp, format: v => U.percent(10 ** v)}, v => { s.logp = v; });
    },
    tick(step, dt) {
      if (!s.playing || ![0, 1, 3].includes(step)) return false;
      const last = end(s.delays);
      s.time = Math.min(last, s.time + dt * 9); if (s.time >= last) s.playing = false;
      return true;
    },
    draw(step, ctx) {
      if (step === 0) { scene(ctx, s.delays, 'Routes as planned, no delay'); pairList(ctx); }
      else if (step === 1) { scene(ctx, s.delays, 'Routes with your departure delays'); intervals(ctx); }
      else if (step === 2) graph(ctx);
      else if (step === 3) { scene(ctx, s.delays, `Best answer with a ${s.step} min step and at most ${s.dmax} min`); table(ctx); }
      else if (step === 4) chimera(ctx);
      else machine(ctx);
    },
    stats(step) {
      const hot = edges().filter(e => M.violated(e, s.delays)).length, total = s.delays.reduce((a, b) => a + b, 0), tone = v => v ? 'good' : 'bad';
      if (step === 0) return [['Flights', String(MINI.length)], ['Conflicts', String(hot), tone(!hot)], ['Separation', '30 NM · 3 min']];
      if (step === 1) return [['Total delay', `${total} min`], ['Conflicts left', String(hot), tone(!hot)], ['Best possible', `${solution(1, 18).total} min`]];
      if (step === 2) return [['Flights', '36'], ['Potential conflicts', String(cache.graph.edges)], ['Sub-problems', String(cache.graph.parts)], ['Largest', `${cache.graph.largest} flights`], ['Flights alone', String(cache.graph.alone)]];
      if (step === 3) { const sol = solution(s.step, s.dmax); return [['Delay step', `${s.step} min`], ['Maximum delay', `${s.dmax} min`], ['Total delay', sol ? `${sol.total} min` : 'no answer', tone(sol)], ['Finest, largest setting', `${solution(1, 24).total} min`]]; }
      if (step === 4) return [['Logical bits', String(cache.emb.N)], ['Physical qubits', String(cache.emb.physical)], ['Chain length', String(cache.emb.chain)], ['Layout', 'full-clique embedding']];
      return [['Anneal time', '20 µs'], ['Precision limit', '≈ 1 / 30'], ['Largest embedded', '64 flights · 261 conflicts']];
    },
    pointer(step, type, x, y) {
      if (type !== 'down') return false;
      if (step === 3) {
        const c = Math.floor((x - GRID.x) / GRID.cw), r = Math.floor((y - GRID.y) / GRID.ch);
        if (c < 0 || c >= MAXES.length || r < 0 || r >= STEPS.length) return false;
        s.step = STEPS[r]; s.dmax = MAXES[c];
        const sol = solution(s.step, s.dmax); s.delays = sol ? sol.delays.slice() : [0, 0, 0, 0]; play();
        return 'controls';
      }
      if (step === 4) { const hit = bitHits.find(b => x >= b.x && x < b.x + b.size && y >= b.y && y < b.y + b.size); if (hit) { s.bit = hit.v; return true; } }
      return false;
    },
  };
})();
