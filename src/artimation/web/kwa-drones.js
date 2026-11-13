// Step-by-step picture of Kwa, Teh, Chai, Gan (2026): urban drone path planning, one small QUBO per second of flight.
(function () {
  'use strict';
  const M = KwaModel, U = KwaUI, C = U.C;
  const WORLD = {x: 20, y: 10, w: 760, h: 600}, CELL = 4, GW = WORLD.w / CELL, GH = WORLD.h / CELL, PX = 806, PW = 274;
  const RECTS = [[240, 240, 150, 30], [410, 240, 30, 160], [540, 120, 90, 80], [150, 90, 90, 70]]; // fictional map, metres
  const START = {x: 60, y: 540, h: -40}, LAYER = ['att', 'rep', 'total', 'total', 'total', 'total'], FLYING = [0, 2, 5];
  const NAMES = ['−25°', '0°', '+25°', '10', '15'];
  const s = {merge: true, target: [690, 70], K: 1e10, k: 12, t: 0, playing: false, drag: false};
  let cache = {};

  const rects = () => s.merge ? M.mergeRects(RECTS, 30) : RECTS;
  function points() { if (cache.points?.key !== s.merge) cache.points = {key: s.merge, v: M.cloud(rects())}; return cache.points.v; }
  function base() { // repulsion before the distance-to-target factor, on the heat-map grid
    if (cache.base?.key !== s.merge) {
      const v = new Float64Array(GW * GH), pts = points();
      for (let k = 0; k < v.length; k++) v[k] = M.repulsion(pts, (k % GW + 0.5) * CELL, (Math.floor(k / GW) + 0.5) * CELL);
      cache.base = {key: s.merge, v};
    }
    return cache.base.v;
  }
  const field = step => ({target: s.target, points: step === 0 ? [] : points()});
  function flight(step) {
    const key = `${step === 0}|${s.merge}|${s.target}|${s.K}`;
    if (cache.flight?.key !== key) cache.flight = {key, v: M.fly(field(step), START, s.K)};
    return cache.flight.v;
  }
  function heat(layer) {
    const key = `${layer}|${s.merge}|${s.target}`;
    if (cache.heat?.key === key) return cache.heat.v;
    const canvas = cache.heat?.v || Object.assign(document.createElement('canvas'), {width: GW, height: GH}), ctx = canvas.getContext('2d');
    const image = ctx.createImageData(GW, GH), b = base(), values = new Float64Array(GW * GH);
    for (let k = 0; k < values.length; k++) {
      const d = Math.hypot((k % GW + 0.5) * CELL - s.target[0], (Math.floor(k / GW) + 0.5) * CELL - s.target[1]);
      values[k] = (layer === 'rep' ? 0 : M.K_ATT * d * d) + (layer === 'att' ? 0 : b[k] * d);
    }
    // Colour by rank so the bowl and the walls both stay readable despite the huge value range.
    const sorted = Float64Array.from(values).sort(), zero = sorted.findIndex(v => v > 0), span = sorted.length - Math.max(0, zero);
    const rank = v => { let lo = 0, hi = sorted.length; while (lo < hi) { const mid = (lo + hi) >> 1; if (sorted[mid] < v) lo = mid + 1; else hi = mid; } return lo; };
    for (let k = 0; k < values.length; k++) { const c = U.ramp(values[k] > 0 ? 0.08 + 0.92 * (rank(values[k]) - zero) / span : 0); image.data.set([c[0], c[1], c[2], 255], k * 4); }
    ctx.putImageData(image, 0, 0);
    cache.heat = {key, v: canvas};
    return canvas;
  }
  const inside = p => RECTS.some(([x, y, w, h]) => p.x > x && p.x < x + w && p.y > y && p.y < y + h);
  function margin(path) {
    let min = Infinity;
    for (const p of path) for (const [x, y, w, h] of RECTS) min = Math.min(min, Math.hypot(Math.max(x - p.x, 0, p.x - x - w), Math.max(y - p.y, 0, p.y - y - h)));
    return min;
  }
  const sx = x => WORLD.x + x, sy = y => WORLD.y + y;
  function drone(ctx, p, size = 9) {
    ctx.save(); ctx.translate(sx(p.x), sy(p.y)); ctx.rotate(p.h * Math.PI / 180);
    ctx.beginPath(); ctx.moveTo(size * 1.5, 0); ctx.lineTo(-size, size * 0.8); ctx.lineTo(-size * 0.5, 0); ctx.lineTo(-size, -size * 0.8); ctx.closePath();
    ctx.fillStyle = '#fff'; ctx.fill(); ctx.strokeStyle = '#10202b'; ctx.lineWidth = 1.5; ctx.stroke(); ctx.restore();
  }
  function map(ctx, step, path, upto) {
    ctx.imageSmoothingEnabled = true; ctx.drawImage(heat(LAYER[step]), WORLD.x, WORLD.y, WORLD.w, WORLD.h);
    if (step >= 1 && step <= 2) { ctx.fillStyle = 'rgba(255,255,255,.55)'; for (const [x, y] of points()) ctx.fillRect(sx(x) - 1, sy(y) - 1, 2, 2); }
    for (const [x, y, w, h] of RECTS) U.box(ctx, sx(x), sy(y), w, h, {fill: step === 0 ? 'rgba(9,16,24,.55)' : 'rgba(9,16,24,.88)', stroke: '#8fa3b3', radius: 2});
    if (step >= 1 && s.merge) for (const [x, y, w, h] of rects()) U.box(ctx, sx(x) - 3, sy(y) - 3, w + 6, h + 6, {stroke: C.mint, dash: [6, 5], radius: 4, width: 1.5});
    U.box(ctx, WORLD.x, WORLD.y, WORLD.w, WORLD.h, {stroke: C.line, radius: 0});
    ctx.beginPath(); ctx.arc(sx(START.x), sy(START.y), 6, 0, 2 * Math.PI); ctx.fillStyle = '#fff'; ctx.fill();
    U.text(ctx, 'start', sx(START.x) + 12, sy(START.y) + 22, {size: 12});
    ctx.save(); ctx.translate(sx(s.target[0]), sy(s.target[1])); ctx.rotate(Math.PI / 4); U.box(ctx, -9, -9, 18, 18, {fill: C.amber, stroke: '#10202b', radius: 2, width: 2}); ctx.restore();
    U.text(ctx, 'target', sx(s.target[0]) + 16, sy(s.target[1]) + 5, {size: 12, bold: true});
    if (!path) return;
    for (let k = 1; k <= upto; k++) U.line(ctx, sx(path[k - 1].x), sy(path[k - 1].y), sx(path[k].x), sy(path[k].y), {color: inside(path[k]) ? C.red : '#fff', width: inside(path[k]) ? 4 : 2.5});
    drone(ctx, path[upto]);
    U.line(ctx, WORLD.x + 20, WORLD.y + WORLD.h - 18, WORLD.x + 120, WORLD.y + WORLD.h - 18, {color: '#fff', width: 2}); U.text(ctx, '100 m', WORLD.x + 126, WORLD.y + WORLD.h - 14, {size: 11});
  }
  // Potential along the straight line from start to target: the bowl, the walls, and their sum.
  function profile(ctx, step) {
    const y = 70, h = 190, n = 220, f = field(step), layer = LAYER[step], values = [];
    for (let k = 0; k <= n; k++) {
      const px = START.x + (s.target[0] - START.x) * k / n, py = START.y + (s.target[1] - START.y) * k / n, d = Math.hypot(px - s.target[0], py - s.target[1]);
      values.push(Math.log10((layer === 'rep' ? 0 : M.K_ATT * d * d) + (layer === 'att' ? 0 : M.repulsion(points(), px, py) * d) + 1e4));
    }
    const lo = Math.min(...values), hi = Math.min(Math.max(...values), lo + 7) || lo + 1;
    U.box(ctx, PX, y - 30, PW, h + 60, {fill: C.bg, stroke: C.line});
    U.text(ctx, 'Cross-section, start → target', PX + 10, y - 10, {color: C.muted, size: 12});
    ctx.beginPath();
    values.forEach((v, k) => { const px = PX + 10 + (PW - 20) * k / n, py = y + h - Math.min(1, (v - lo) / (hi - lo || 1)) * (h - 10); k ? ctx.lineTo(px, py) : ctx.moveTo(px, py); });
    ctx.strokeStyle = C.amber; ctx.lineWidth = 2; ctx.stroke();
    U.text(ctx, 'start', PX + 10, y + h + 18, {color: C.muted, size: 11}); U.text(ctx, 'target', PX + PW - 10, y + h + 18, {color: C.muted, size: 11, align: 'right'});
    U.text(ctx, 'potential ↑', PX + PW - 10, y + 8, {color: C.muted, size: 11, align: 'right'});
    for (let k = 0; k <= 50; k++) { ctx.fillStyle = U.rgb(U.ramp(k / 50)); ctx.fillRect(PX + 10 + k * 5, 340, 5, 12); }
    U.text(ctx, 'low potential', PX + 10, 372, {color: C.muted, size: 11}); U.text(ctx, 'high', PX + 265, 372, {color: C.muted, size: 11, align: 'right'});
    void f;
  }
  function fan(ctx, state, d) {
    const cx = PX + PW / 2, by = 300, scale = 15, r = -(state.h + 90) * Math.PI / 180, cos = Math.cos(r), sin = Math.sin(r);
    U.box(ctx, PX, 20, PW, 310, {fill: C.bg, stroke: C.line});
    U.text(ctx, 'The 6 reachable positions in 1 s', PX + 10, 42, {color: C.muted, size: 12});
    const best = d.valid ? d.qubo.Q[d.turn][3 + d.speed] : Infinity;
    for (let t = 0; t < 3; t++) for (let v = 0; v < 2; v++) {
      const q = d.qubo.next[t][v], dx = q.x - state.x, dy = q.y - state.y, px = cx + (dx * cos - dy * sin) * scale, py = by + (dx * sin + dy * cos) * scale;
      const chosen = d.valid && t === d.turn && v === d.speed, delta = d.qubo.Q[t][3 + v] - best;
      U.line(ctx, cx, by, px, py, {color: chosen ? C.amber : C.slate, width: chosen ? 3 : 1.5});
      ctx.beginPath(); ctx.arc(px, py, chosen ? 9 : 6, 0, 2 * Math.PI); ctx.fillStyle = chosen ? C.amber : C.slate; ctx.fill();
      U.text(ctx, chosen ? 'min' : `+${U.number(delta)}`, px, py - 14, {color: chosen ? C.amber : C.text, size: 11, bold: chosen, align: 'center'});
    }
    ctx.save(); ctx.translate(cx - WORLD.x, by - WORLD.y); drone(ctx, {x: 0, y: 0, h: -90}, 10); ctx.restore();
  }
  function bits(ctx, d, y) {
    U.text(ctx, 'Command = 5 bits', PX, y, {color: C.muted, size: 12});
    U.text(ctx, 'turn (°/s)', PX + 75, y + 86, {color: C.muted, size: 11, align: 'center'}); U.text(ctx, 'speed (m/s)', PX + 218, y + 86, {color: C.muted, size: 11, align: 'center'});
    for (let k = 0; k < 5; k++) {
      const x = PX + k * 50 + (k > 2 ? 22 : 0), on = d.best >> k & 1;
      U.box(ctx, x, y + 12, 46, 44, {fill: on ? C.amber : C.surface, stroke: on ? C.amber : C.line});
      U.text(ctx, on ? '1' : '0', x + 23, y + 35, {color: on ? '#10202b' : C.muted, size: 20, bold: true, mono: true, align: 'center', base: 'middle'});
      U.text(ctx, NAMES[k], x + 23, y + 70, {size: 12, align: 'center'});
    }
  }
  function matrix(ctx, d) {
    const x = PX + 34, y = 46, c = 48, Q = d.qubo.Q, cross = [];
    for (let t = 0; t < 3; t++) for (let v = 0; v < 2; v++) cross.push(Q[t][3 + v]);
    const lo = Math.min(...cross), hi = Math.max(...cross);
    U.text(ctx, 'QUBO matrix for this second', PX, 20, {color: C.muted, size: 12});
    for (let a = 0; a < 5; a++) {
      U.text(ctx, NAMES[a], x + c * (a + 0.5), y - 6, {size: 11, align: 'center'}); U.text(ctx, NAMES[a], x - 6, y + c * (a + 0.5), {size: 11, align: 'right', base: 'middle'});
      for (let b = a; b < 5; b++) {
        const penalty = (a < 3) === (b < 3), fill = penalty ? '#4a3a6b' : U.rgb(U.ramp(0.25 + 0.6 * (Q[a][b] - lo) / (hi - lo || 1)));
        U.box(ctx, x + c * b + 2, y + c * a + 2, c - 4, c - 4, {fill, radius: 4});
        U.text(ctx, penalty ? (a === b ? '−K' : '+2K') : U.number(Q[a][b]), x + c * (b + 0.5), y + c * (a + 0.5), {color: penalty ? '#e6dcff' : '#10202b', size: 11, bold: true, align: 'center', base: 'middle'});
      }
    }
    U.box(ctx, PX, 300, 12, 12, {fill: '#4a3a6b', radius: 2}); U.text(ctx, 'rule: one choice per group', PX + 18, 311, {size: 11});
    U.box(ctx, PX, 318, 12, 12, {fill: U.rgb(U.ramp(0.5)), radius: 2}); U.text(ctx, 'potential of the next position', PX + 18, 329, {size: 11});
  }
  function energies(ctx, d) {
    const x = PX, y = 372, w = PW, h = 130, logs = d.energies.map(e => Math.log10(Math.max(e, 1))), lo = Math.min(...logs) - 0.3, hi = Math.max(...logs);
    U.text(ctx, '32 combinations, 6 legal', x, y - 8, {color: C.muted, size: 12});
    for (let u = 0; u < 32; u++) {
      const bh = Math.max(3, (logs[u] - lo) / (hi - lo || 1) * h), color = u === d.best ? (d.valid ? C.amber : C.red) : M.controlValid(u) ? C.mint : C.slate;
      ctx.fillStyle = color; ctx.fillRect(x + u * w / 32, y + h - bh, w / 32 - 2, bh);
    }
    U.text(ctx, d.valid ? '▮ choice: legal' : '▮ choice: illegal', x, y + h + 18, {color: d.valid ? C.amber : C.red, size: 12, bold: true});
    U.text(ctx, 'energy (log scale)', x + w, y + h + 18, {color: C.muted, size: 11, align: 'right'});
  }
  function clocks(ctx, steps, total) {
    const rows = [['Real flight', steps, '#fff'], ['Enumerate the 6 cases', 0, C.mint], ['D-Wave  ≈ 6 s per step', steps * 6, C.blue], ['Pasqal  ≈ 30 min per step (estimated)', steps * 1800, C.violet]];
    const max = Math.log10(1 + total * 1800);
    U.text(ctx, 'Cumulative computing time', PX, 40, {size: 15, bold: true});
    rows.forEach(([label, sec, color], k) => {
      const y = 80 + k * 86, w = Math.max(3, Math.log10(1 + sec) / max * PW);
      U.text(ctx, label, PX, y, {color: C.muted, size: 12});
      U.box(ctx, PX, y + 10, w, 20, {fill: color, radius: 3});
      U.text(ctx, k === 1 ? 'instant' : U.duration(sec), PX, y + 54, {size: 18, bold: true});
    });
    U.text(ctx, 'bars on a log scale', PX, 440, {color: C.muted, size: 11});
    U.text(ctx, `1 QUBO per second of flight · step ${steps} / ${total}`, PX, 470, {size: 12});
  }
  function inspected(step) {
    const path = flight(step).path, k = Math.min(s.k, path.length - 1);
    return {path, k, state: path[k], d: M.decide(field(step), path[k], s.K)};
  }
  function replay() { s.t = 0; s.playing = true; }

  KwaPapers.drones = {
    label: 'Drones · potential field',
    source: 'Kwa, Teh, Chai, Gan — A Hybrid Quantum-Classical Approach for Urban Drone Path Planning (2026). Fictional map; constants, commands and computing times are from the paper.',
    state: s,
    steps: [
      {title: 'Attraction', caption: 'The target digs a bowl and the drone rolls downhill. Alone, it flies straight through buildings. Drag the target.'},
      {title: 'Repulsion', caption: 'Each building becomes a cloud of points that push back within 30 m. Buildings close together are merged.'},
      {title: 'Total field', caption: 'Bowl plus walls. The drone always goes for the lowest point it can reach. Try it without merging.'},
      {title: 'Commands', caption: 'Every second: 3 turn rates × 2 speeds = 6 next positions. Keep the one with the lowest potential.'},
      {title: 'QUBO', caption: 'The same choice written for a quantum machine: 5 bits, potentials as couplings, rules as a penalty K. Lower K.'},
      {title: 'Time', caption: 'In the paper the three solvers give paths within 4 % of each other. What differs is the time to answer each second of flight.'},
    ],
    enter(step) { s.t = 0; s.playing = FLYING.includes(step); },
    controls(step, ui) {
      if (step === 1 || step === 2) ui.toggle('Merge nearby buildings', s.merge, v => { s.merge = v; replay(); });
      if (FLYING.includes(step)) ui.button('▶ Replay', replay);
      if (step === 3 || step === 4) ui.slider('Second of flight', {min: 0, max: Math.max(1, flight(step).path.length - 1), step: 1, value: Math.min(s.k, flight(step).path.length - 1)}, v => { s.k = v; });
      if (step === 4) ui.slider('Penalty K', {min: 6, max: 11, step: 0.5, value: Math.log10(s.K), format: v => `10^${v}`}, v => { s.K = 10 ** v; });
    },
    tick(step, dt) {
      if (!s.playing || !FLYING.includes(step)) return false;
      const last = flight(step).path.length - 1;
      s.t = Math.min(last, s.t + dt * 14); if (s.t >= last) s.playing = false;
      return true;
    },
    draw(step, ctx) {
      if (step === 1) { map(ctx, step); profile(ctx, step); return; }
      if (FLYING.includes(step)) {
        const path = flight(step).path, upto = Math.min(path.length - 1, Math.floor(s.t));
        map(ctx, step, path, upto);
        if (step === 5) clocks(ctx, upto, path.length - 1); else profile(ctx, step);
        return;
      }
      const {path, k, state, d} = inspected(step);
      map(ctx, step, path, k);
      for (const row of d.qubo.next) for (const q of row) U.line(ctx, sx(state.x), sy(state.y), sx(q.x), sy(q.y), {color: C.amber, width: 1.5});
      if (step === 3) { fan(ctx, state, d); bits(ctx, d, 368); } else { matrix(ctx, d); energies(ctx, d); }
    },
    stats(step) {
      const f = flight(step), status = {arrived: 'arrived', timeout: 'never arrives', invalid: 'illegal command'}[f.status], tone = v => v ? 'good' : 'bad';
      if (step === 0) { const hit = f.path.some(inside); return [['Flight time', `${f.path.length - 1} s`], ['Crosses a building', hit ? 'yes' : 'no', tone(!hit)]]; }
      if (step === 1) return [['Buildings', String(RECTS.length)], ['Restricted areas', String(rects().length)], ['Repulsive points', String(points().length)], ['Range', `${M.RANGE} m`]];
      if (step === 2) return [['Result', status, tone(f.status === 'arrived')], ['Flight time', `${f.path.length - 1} s`], ['Closest approach to a building', `${margin(f.path).toFixed(0)} m`, tone(!f.path.some(inside))]];
      if (step === 5) return [['Flight', `${f.path.length - 1} s`], ['D-Wave, whole flight', U.duration((f.path.length - 1) * 6)], ['Pasqal, whole flight', U.duration((f.path.length - 1) * 1800)]];
      const {k, d} = inspected(step), cross = d.qubo.Q.slice(0, 3).flatMap(r => r.slice(3)), spread = (Math.max(...cross) - Math.min(...cross)) / Math.min(...cross);
      if (step === 3) return [['Second of flight', String(k)], ['Turn', d.valid ? `${M.TURNS[d.turn]} °/s` : '—'], ['Speed', d.valid ? `${M.SPEEDS[d.speed]} m/s` : '—'], ['Spread across the 6 choices', U.percent(spread)]];
      return [['K', U.number(s.K)], ['Largest potential', U.number(Math.max(...cross))], ['Legal command', d.valid ? 'yes' : 'no', tone(d.valid)], ['Flight result', status, tone(f.status === 'arrived')]];
    },
    pointer(step, type, x, y) {
      if (type === 'up') { const was = s.drag; s.drag = false; if (was) replay(); return was; }
      if (type === 'down' && FLYING.includes(step) && Math.hypot(x - sx(s.target[0]), y - sy(s.target[1])) < 22) s.drag = true;
      if (!s.drag) return false;
      s.target = [Math.round(Math.min(WORLD.w - 20, Math.max(20, x - WORLD.x))), Math.round(Math.min(WORLD.h - 20, Math.max(20, y - WORLD.y)))];
      s.t = 0; s.playing = false;
      return true;
    },
  };
})();
