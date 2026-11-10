// Artimation Visu extends the ENAC / C. Hurter studio with altitude, an adapted genetic solver, explored-trajectory heatmaps and 3D.
(() => {
  'use strict';
  const $ = id => document.getElementById(id), M = FlightMath, CM = ConflictModel, GA = GeneticSolver, NS = 'http://www.w3.org/2000/svg';
  const DATA = window.__DATA__ || {scenarios: []}, svg = $('radar'), COLORS = View3D.COLORS;
  const state = {aircraft: [], routes: null, selected: null, time: 0, horizon: 10, separation: 7, sepV: 1000, playing: false, placing: false, focus: null, nextId: 1,
    view: '2d', axis: 'alt', background: 'none', layers: {routes: true, solution: true, aircraft: true, zones: true}, showSolutions: false,
    weights: {...CM.DEFAULT_WEIGHTS}, solutions: {ga: null, manual: null, enac: null}, source: 'none', ga: null, heat: null, heatRev: 0, rev: 0, gaRunning: false, scenario: 'demo'};
  let drag = null, lastFrame = 0, lastAnalysis = 0, noticeTimer, results = [], solutionPanelKey = '', manualDirty = true, view3d = null, routeCache = {rev: -1, routes: null};
  const clamp = (n, min, max) => Math.max(min, Math.min(max, n));
  const clock = n => { const s = Math.round(n * 60); return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`; };
  const fmt = n => Number(n).toFixed(1);
  const selected = () => state.aircraft.find(a => a.id === state.selected);
  const aircraftColor = id => COLORS[Math.max(0, state.aircraft.findIndex(a => a.id === id)) % COLORS.length];
  const densityView = new DensityView(() => draw());
  const el = (tag, attrs, parent) => { const node = document.createElementNS(NS, tag); for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v); parent?.appendChild(node); return node; };
  function notify(text) { $('notice').textContent = text; $('notice').classList.add('visible'); clearTimeout(noticeTimer); noticeTimer = setTimeout(() => $('notice').classList.remove('visible'), 3500); }

  // ------------------------------------------------------------------ Routes, displayed solution and positions at time t
  function getRoutes() {
    if (routeCache.rev !== state.rev) routeCache = {rev: state.rev, routes: state.routes || state.aircraft.map(a => CM.routeFromAircraft(a))};
    return routeCache.routes;
  }
  const zeroGenes = () => getRoutes().map(() => [0, 0, 0, 0]);
  const solutionOn = () => state.layers.solution && state.source !== 'none' && state.solutions[state.source];
  const shownGenes = () => (solutionOn() ? state.solutions[state.source] : zeroGenes());
  const routeEnd = () => Math.max(60, ...getRoutes().map(r => r.t[r.t.length - 1]));
  const simDuration = () => Math.max(1, ...getRoutes().map((r, i) => { const t = CM.maneuverPath(r, shownGenes()[i]).t; return t[t.length - 1] / 60; }));
  function current(time = state.time) {
    const routes = getRoutes(), genes = shownGenes(), out = [];
    routes.forEach((r, i) => { const s = CM.stateAt(r, genes[i], time * 60); if (s) out.push({id: state.aircraft[i].id, x: s.x, y: s.y, z: s.z, speed: s.speed, heading: s.heading, vz: s.vz}); });
    return out;
  }
  const evalOpts = () => ({sep: state.separation, sepV: state.sepV, tmax: Infinity, weights: state.weights});

  // Editing the scenario invalidates computed solutions.
  function touch() {
    state.gaRunning = false; $('run-ga').textContent = '▶ Run solver'; $('ga-progress').hidden = true;
    state.rev++; state.solutions = {ga: null, manual: null, enac: null}; state.source = 'none'; state.ga = null; state.heat = null; state.heatRev++; manualDirty = true;
    refreshSolutionSelect();
  }
  function setPlaying(value) { state.playing = value; $('play').innerHTML = value ? 'Ⅱ <span>Pause</span>' : '▶ <span>Play</span>'; $('run-status').textContent = value ? 'RUNNING' : 'PAUSED'; $('run-status').classList.toggle('running', value); }
  function setPlacing(value) { state.placing = value; $('add').classList.toggle('active', value); $('add').textContent = value ? '× Cancel placement' : '＋ Place aircraft'; $('radar-mode').textContent = value ? 'CLICK TO PLACE' : (state.view === '3d' ? 'DRAG TO ROTATE / MOVE' : 'DRAG TO EDIT'); svg.style.cursor = value ? 'crosshair' : ''; if (view3d) { view3d.cv.style.cursor = value ? 'crosshair' : 'grab'; if (state.view === '3d') draw(); } }
  function commitTime() {
    if (state.time > 0) { const cur = current(); state.aircraft = cur; state.routes = null; state.time = 0; touch(); if (!selected()) state.selected = state.aircraft[0]?.id ?? null; }
    setPlaying(false);
  }
  function edit(fn) { commitTime(); fn(); state.routes = null; touch(); }
  function newAircraft(x, y, speed = 300, heading = 90, z = 36000, vz = 0) { const a = {id: `AC${String(state.nextId++).padStart(3, '0')}`, x, y, z, speed, heading, vz}; state.aircraft.push(a); state.selected = a.id; return a; }
  function resetSituation() { setPlaying(false); setPlacing(false); state.aircraft = []; state.routes = null; state.nextId = 1; state.time = 0; state.focus = null; touch(); }
  function demo() {
    resetSituation(); state.scenario = 'demo';
    [[20, 30, 360, 90], [50, 60, 360, 0], [90, 20, 300, 225], [30, 75, 240, 45], [100, 65, 300, 270]].forEach(args => newAircraft(...args));
    state.selected = 'AC001'; $('count').value = 5; $('scenario').value = 'demo'; $('scenario-note').textContent = "Five aircraft · FL360.";
    render();
  }
  function generate() {
    const n = Number($('count').value);
    if (!Number.isInteger(n) || n < 1 || n > 100) { notify('Choose a whole number from 1 to 100.'); return; }
    resetSituation(); state.scenario = 'custom'; $('scenario').value = 'custom';
    for (let i = 0; i < n; i++) {
      const angle = 2 * Math.PI * i / n + Math.random() * .2, x = 60 + 43 * Math.cos(angle), y = 45 + 31 * Math.sin(angle);
      const heading = (Math.atan2(60 - x, -(45 - y)) * 180 / Math.PI + 360 + Math.random() * 60 - 30) % 360;
      newAircraft(x, y, Math.round((220 + Math.random() * 240) / 10) * 10, Math.round(heading) % 360);
    }
    state.selected = state.aircraft[0].id; render(); notify(`${n} aircraft ready. Drag an aircraft or its vector to adjust it.`);
  }
  function loadScenario(key) {
    if (key === 'demo') return demo();
    if (key === 'custom') { $('scenario-note').textContent = 'Custom scenario.'; return; }
    const sc = DATA.scenarios.find(s => s.key === key); if (!sc) return;
    resetSituation(); state.scenario = key;
    state.routes = sc.routes.map(r => CM.makeRoute(r.xy, r.t, r.z, r.enacStart));
    state.aircraft = state.routes.map((r, i) => { const s = CM.stateAt(r, [0, 0, 0, 0], r.t[0]); return {id: sc.ids[i], x: s.x, y: s.y, z: s.z, speed: s.speed, heading: s.heading, vz: s.vz}; });
    state.nextId = state.aircraft.length + 1; state.selected = state.aircraft[0].id; state.rev++;
    state.separation = 7; state.horizon = 10; $('separation').value = '7'; $('horizon').value = '10';
    if (sc.enac) { state.solutions.enac = sc.enac; }
    refreshSolutionSelect(); $('count').value = state.aircraft.length;
    $('scenario-note').textContent = `FL360 · ENAC snapshot${sc.enac ? ' · Reference available' : ''}`;
    render();
  }

  // ------------------------------------------------------------------ Sidebar
  function renderFleet() {
    const fleet = $('fleet'); fleet.replaceChildren();
    state.aircraft.forEach(a => {
      const b = document.createElement('button'); b.className = 'fleet-item' + (a.id === state.selected ? ' selected' : ''); b.setAttribute('aria-pressed', a.id === state.selected);
      b.innerHTML = `<span class="callsign"><i style="background:${aircraftColor(a.id)}"></i>${a.id}</span><span class="fleet-meta" title="Heading ${Math.round(a.heading) % 360}°">FL${Math.round(a.z / 100)} · ${Math.round(a.speed)} kt</span>`;
      b.onclick = () => { state.selected = a.id; state.focus = null; $('aircraft-settings').open = true; render(); }; fleet.appendChild(b);
    });
    $('fleet-count').textContent = String(state.aircraft.length).padStart(2, '0');
    const a = selected(); $('selected-name').textContent = a?.id || 'No aircraft';
    ['speed', 'heading', 'level', 'vz', 'speed-range', 'remove'].forEach(id => $(id).disabled = !a);
    if (a) { $('speed').value = Math.round(a.speed); $('heading').value = Math.round(a.heading) % 360; $('level').value = Math.round(a.z / 100); $('vz').value = Math.round(a.vz); $('speed-range').value = a.speed; $('speed-label').textContent = `${Math.round(a.speed)} kt`; }
    else ['speed', 'heading', 'level', 'vz'].forEach(id => $(id).value = '');
  }
  function refreshSolutionSelect() {
    const sel = $('solution-source'), names = {none: "Original routes (no maneuver)", ga: 'Genetic algorithm', manual: 'My solution', enac: "ENAC solution (reference)"};
    sel.replaceChildren(...Object.keys(names).filter(k => k === 'none' || state.solutions[k]).map(k => new Option(names[k], k))); sel.value = state.source;
  }

  // ------------------------------------------------------------------ 2D rendering
  const clip = (s, t1) => { // Path clipped to [0, t1] seconds.
    const k = s.t.findIndex(t => t > t1); if (k < 0) return s; if (k === 0) return null;
    const f = (t1 - s.t[k - 1]) / (s.t[k] - s.t[k - 1]), lerp = (a, b) => a + (b - a) * f;
    return {t: [...s.t.slice(0, k), t1], x: [...s.x.slice(0, k), lerp(s.x[k - 1], s.x[k])], y: [...s.y.slice(0, k), lerp(s.y[k - 1], s.y[k])], z: [...s.z.slice(0, k), lerp(s.z[k - 1], s.z[k])]};
  };
  const polyline = (s, parent, attrs) => el('polyline', {points: s.x.map((x, i) => `${x * 10},${s.y[i] * 10}`).join(' '), fill: 'none', ...attrs}, parent);
  function windowSamples(genesFn) { return getRoutes().map((r, i) => { const s = CM.pathSamples(r, genesFn(i)); return s && s.t.length > 1 ? s : null; }); }

  function draw() {
    const aircraft = current(), dur = simDuration();
    syncView();
    const safety = M.separationZones(aircraft, state.separation, state.sepV);
    const conflicts = safety.pairs.filter(p => p.conflict).length;
    $('separation-status').textContent = conflicts ? `NOW: ${conflicts} loss-of-separation pair${conflicts > 1 ? 's' : ''}` : 'NOW: no loss of separation';
    $('separation-status').className = conflicts ? 'bad' : 'good';
    $('zone-help').textContent = `Zone radius: ${state.separation / 2} NM${state.sepV > 0 ? `; vertical half-height: ${state.sepV / 2} ft` : '; altitude ignored'}. Red = conflict now. Blue dashed = horizontal overlap, vertically separated. Touching boundaries are safe. Full-route safety: see Solution and instructions.`;
    $('elapsed').textContent = clock(state.time); $('timeline').max = dur; $('timeline').value = state.time; $('duration').textContent = clock(dur);
    densityView.request(aircraft, state.horizon, state.separation, state.sepV, state.time, state.playing);
    syncHeat();
    if (state.view === '3d') { draw3d(aircraft); return; }
    ['paths', 'crossings', 'aircraft'].forEach(id => $(id).replaceChildren());
    const focused = results.find(e => `${e.a}-${e.b}` === state.focus), genes = shownGenes();
    if (state.layers.routes) windowSamples(() => [0, 0, 0, 0]).forEach(s => s && polyline(s, $('paths'), {stroke: '#8197a6', 'stroke-width': 1.3, 'stroke-dasharray': '3 6', opacity: .75}));
    if (state.layers.solution && state.source !== 'none') windowSamples(i => genes[i]).forEach((s, i) => s && polyline(s, $('paths'), {stroke: COLORS[i % COLORS.length], 'stroke-width': 3.2, 'stroke-linejoin': 'round', 'stroke-linecap': 'round'}));
    aircraft.forEach(a => {
      const v = M.velocity(a), isSel = a.id === state.selected, color = isSel ? '#ffcb78' : '#64dfcb', end = M.position(a, state.horizon);
      el('line', {x1: a.x * 10, y1: a.y * 10, x2: end.x * 10, y2: end.y * 10, stroke: color, class: 'trajectory'}, $('paths'));
      if (state.layers.zones) {
        const zone = safety.zones.find(z => z.id === a.id), zoneColor = zone.conflict ? '#ff8c83' : zone.verticalOnly ? '#8ab6ff' : '#64dfcb';
        const circle = el('circle', {'data-zone': a.id, 'data-conflict': String(zone.conflict), cx:a.x*10, cy:a.y*10, r:zone.radius*10,
          fill:zone.conflict ? zoneColor : 'none', 'fill-opacity':'.18', stroke:zoneColor, 'stroke-width':zone.conflict ? 2.5 : 1.5,
          'stroke-dasharray':zone.conflict ? '' : zone.verticalOnly ? '4 5' : ''}, $('paths'));
        el('title', {}, circle).textContent = zone.conflict ? `${a.id}: loss of separation now` : zone.verticalOnly ? `${a.id}: horizontal overlap is vertically separated` : `${a.id}: separated now`;
      }
      if (!state.layers.aircraft) return;
      const vx = (a.x + v.x * 3) * 10, vy = (a.y + v.y * 3) * 10;
      el('line', {x1: a.x * 10, y1: a.y * 10, x2: vx, y2: vy, stroke: color, class: 'vector-line', 'marker-end': 'url(#arrow)'}, $('aircraft'));
      const handle = el('g', {'data-id': a.id, 'data-drag': 'velocity', tabindex: 0, role: 'button', 'aria-label': `${a.id} : speed handle. Use the speed and heading fields for precise adjustments.`}, $('aircraft'));
      el('circle', {cx: vx, cy: vy, r: 17, fill: 'transparent'}, handle); el('circle', {cx: vx, cy: vy, r: isSel ? 6 : 4, stroke: color, class: 'velocity-handle'}, handle);
      const g = el('g', {'data-id': a.id, 'data-drag': 'position', class: 'aircraft-symbol', tabindex: 0, role: 'button', 'aria-label': `${a.id}, FL${Math.round(a.z / 100)}, ${Math.round(a.speed)} knots, heading ${Math.round(a.heading)}°. Arrow keys: move; Shift: faster.`}, $('aircraft'));
      el('circle', {cx: a.x * 10, cy: a.y * 10, r: 24, class: 'plane-hit'}, g);
      if (isSel) el('circle', {cx: a.x * 10, cy: a.y * 10, r: 21, fill: 'none', stroke: color, 'stroke-opacity': '.5'}, g);
      el('path', {d: 'M0 -17 L4 -4 L15 4 L15 8 L4 4 L4 12 L8 16 L8 19 L0 15 L-8 19 L-8 16 L-4 12 L-4 4 L-15 8 L-15 4 L-4 -4Z', transform: `translate(${a.x * 10} ${a.y * 10}) rotate(${a.heading})`, fill: color}, g);
      const right = a.x > 100 ? -85 : 28;
      el('text', {x: a.x * 10 + right, y: a.y * 10 - 3, class: 'plane-label'}, g).textContent = a.id;
      el('text', {x: a.x * 10 + right, y: a.y * 10 + 16, class: 'plane-label plane-meta'}, g).textContent = `FL${Math.round(a.z / 100)} · ${Math.round(a.speed)} kt`;
    });
    (state.source === 'none' ? results : []).forEach(e => { if (!e.crossing) return; const p = e.crossing, g = el('g', {class: 'cross-marker', tabindex: 0, role: 'button', 'data-pair': `${e.a}-${e.b}`, 'aria-label': `${e.a} and ${e.b}, crossing with ${fmt(p.gap)} min between arrivals`}, $('crossings'));
      el('circle', {cx: p.x * 10, cy: p.y * 10, r: 20, fill: 'transparent'}, g); el('path', {d: `M${p.x * 10} ${p.y * 10 - 8}l8 8-8 8-8-8Z`, fill: '#12222e', stroke: e.risk ? '#ff8c83' : (e.separatedVertically ? '#64dfcb' : '#8ab6c9'), 'stroke-width': 2}, g);
      el('title', {}, g).textContent = `${e.a} × ${e.b} · arrival gap ${fmt(p.gap)} min`; });
    (focused ? [focused] : state.source === 'none' ? results.filter(e => e.risk).slice(0, 12) : []).forEach(e => { const color = '#ffcb78';
      el('line', {x1: e.pa.x * 10, y1: e.pa.y * 10, x2: e.pb.x * 10, y2: e.pb.y * 10, stroke: color, 'stroke-dasharray': '3 4'}, $('crossings'));
      el('text', {x:(e.pa.x+e.pb.x)*5, y:(e.pa.y+e.pb.y)*5-8, fill:color, 'font-size':12}, $('crossings')).textContent = 'Current-heading forecast'; });
    if (state.layers.zones) safety.pairs.forEach(pair => {
      const a=aircraft.find(a=>a.id===pair.a), b=aircraft.find(a=>a.id===pair.b), color=pair.conflict ? '#ff8c83' : '#8ab6ff';
      el('line', {x1:a.x*10,y1:a.y*10,x2:b.x*10,y2:b.y*10,stroke:color,'stroke-dasharray':pair.conflict ? '' : '4 5'}, $('crossings'));
      el('text', {'data-zone-pair':`${pair.a}-${pair.b}`,x:(a.x+b.x)*5,y:Math.min(a.y,b.y)*10-state.separation*5-16,fill:color,'font-size':13,'text-anchor':'middle',stroke:'#0b121b','stroke-width':3,'paint-order':'stroke'}, $('crossings')).textContent = `${pair.conflict ? 'CONFLICT' : 'VERTICALLY SEPARATED'} · ${pair.horizontal.toFixed(1)} NM / ${Math.round(pair.vertical)} ft`;
    });
    drawSolutions(aircraft);
  }
  function syncView() {
    const is3d = state.view === '3d';
    svg.style.display = is3d ? 'none' : ''; $('view3d').hidden = !is3d; $('compass').style.display = is3d ? 'none' : ''; $('scale').style.display = is3d ? 'none' : ''; $('axis').disabled = !is3d;
    $('plan-label').textContent = is3d ? '3D VIEW' : 'PLAN VIEW';
  }
  function syncHeat() {
    const img = $('heat-image'), H = state.background === 'heat' ? heatPixels() : null;
    if (H && img.getAttribute('data-key') !== H.key) { const c = document.createElement('canvas'); c.width = H.cols; c.height = H.rows; c.getContext('2d').putImageData(new ImageData(H.pixels, H.cols, H.rows), 0, 0); img.setAttribute('href', c.toDataURL('image/png')); img.setAttribute('data-key', H.key); }
    if (!H) { img.removeAttribute('href'); img.removeAttribute('data-key'); }
  }
  // Heatmap: safe GA maneuvers in green and conflicting ones in red, using a log scale and selected aircraft scope.
  let heatCache = {key: ''};
  function heatPixels() {
    const Hd = state.heat; if (!Hd) return null;
    const scope = densityView.scope, key = `${state.heatRev}|${scope}|${densityView.sigma}`; if (heatCache.key === key) return heatCache;
    const idx = scope === 'all' ? Hd.safe.map((_, i) => i) : [state.aircraft.findIndex(a => a.id === scope)].filter(i => i >= 0), n = Hd.cols * Hd.rows;
    let s = new Float32Array(n), u = new Float32Array(n);
    idx.forEach(i => { for (let k = 0; k < n; k++) { s[k] += Hd.safe[i][k]; u[k] += Hd.unsafe[i][k]; } });
    const kernelX = FlightDensity.gaussianKernel(densityView.sigma / (Hd.width / Hd.cols));
    const kernelY = FlightDensity.gaussianKernel(densityView.sigma / (Hd.height / Hd.rows));
    s = FlightDensity.convolve(s, Hd.cols, Hd.rows, kernelX, kernelY);
    u = FlightDensity.convolve(u, Hd.cols, Hd.rows, kernelX, kernelY);
    let ms = 0, mu = 0; for (let k = 0; k < n; k++) { s[k] = Math.log1p(s[k]); u[k] = Math.log1p(u[k]); ms = Math.max(ms, s[k]); mu = Math.max(mu, u[k]); }
    const pixels = new Uint8ClampedArray(n * 4), signedNorm = new Float64Array(n);
    for (let k = 0; k < n; k++) {
      const a = ms ? s[k] / ms : 0, b = mu ? u[k] / mu : 0;
      if (a <= 0 && b <= 0) { signedNorm[k] = NaN; continue; }
      const w = a + b; pixels[k * 4] = (214 * b + 44 * a) / w; pixels[k * 4 + 1] = (39 * b + 160 * a) / w; pixels[k * 4 + 2] = (40 * b + 44 * a) / w; pixels[k * 4 + 3] = 255 * (0.2 + 0.7 * Math.max(a, b)) * 0.85; signedNorm[k] = a - b;
    }
    heatCache = {key, cols: Hd.cols, rows: Hd.rows, pixels, signedNorm, signed: signedNorm}; return heatCache;
  }
  const densityNorm = new WeakMap();
  function bg3d() {
    if (state.background === 'heat') return heatPixels();
    if (state.background !== 'density' || !densityView.result || !densityView.pixels) return null;
    const r = densityView.result; let sn = densityNorm.get(r);
    if (!sn) { let mp = 0, mn = 0; for (let i = 0; i < r.positive.length; i++) { mp = Math.max(mp, r.positive[i]); mn = Math.max(mn, r.negative[i]); }
      sn = new Float64Array(r.positive.length); for (let i = 0; i < sn.length; i++) sn[i] = r.negative[i] > 0 ? -r.negative[i] / mn : (r.positive[i] > 0 ? r.positive[i] / mp : NaN); densityNorm.set(r, sn); }
    return {cols: r.cols, rows: r.rows, pixels: densityView.pixels, signed: r.signed, signedNorm: sn};
  }

  // ------------------------------------------------------------------ 3D rendering with the same layers
  function ensureView3d() {
    if (view3d) return view3d;
    view3d = new View3D($('view3d'), {
      onPlace: p => { if (p.x < 0 || p.x > 120 || p.y < 0 || p.y > 90) return; placeAircraft(p.x, p.y); },
      onDragStart: (hit, w) => startDrag(hit.id, hit.kind, w), onDragMove: (hit, w) => moveDrag(w)});
    View3D.attach(view3d); return view3d;
  }
  function draw3d(aircraft) {
    const v = ensureView3d(), routes = getRoutes(), genes = shownGenes(), win = simDuration() * 60;
    const base = windowSamples(() => [0, 0, 0, 0]), sol = state.layers.solution && state.source !== 'none' ? windowSamples(i => genes[i]) : [];
    const zs = [...base, ...sol].flatMap(s => (s ? s.z : [])).concat(aircraft.flatMap(a => [a.z, a.z + a.vz * 3])), lo = Math.min(...zs, 36000), hi = Math.max(...zs, 36000);
    const altMin = Math.floor((lo - 2500) / 1000) * 1000, altMax = Math.max(altMin + 6000, Math.ceil((hi + 2500) / 1000) * 1000);
    const safety = M.separationZones(aircraft, state.separation, state.sepV);
    v.setData({axis: state.axis, time: state.time, tmax: Math.max(win, state.time * 60 + 180), altMin, altMax, sep: state.separation, sepV: state.sepV,
      aircraft: aircraft.map((a,i) => ({...a, zone: safety.zones[i], selected: a.id === state.selected})), routes: base, solution: sol, ids: state.aircraft.map(a => a.id), colors: COLORS,
      layers: state.layers, bg: bg3d(), placing: state.placing,
      encounters: (state.source === 'none' ? results : results.filter(e => `${e.a}-${e.b}` === state.focus)).filter(e => e.risk).slice(0, 12).map(e => { const A = aircraft.find(a => a.id === e.a), B = aircraft.find(a => a.id === e.b); return {...e, za: A.z + A.vz * e.t, zb: B.z + B.vz * e.t}; })});
  }
  densityView.onReady = () => { if (state.view === '3d') draw3d(current()); };

  // ------------------------------------------------------------------ Safe headings in the sidebar and radar sectors
  function drawSolutions(aircraft) {
    const layer = $('solution-overlay'); layer.replaceChildren();
    $('solution-details').hidden = !state.showSolutions; if (!state.showSolutions) return;
    const own = aircraft.find(a => a.id === state.selected), space = M.headingSpace(aircraft, state.selected, state.horizon, state.separation, state.sepV);
    const key = JSON.stringify([space, own?.id, own?.speed, state.horizon, state.separation, state.sepV]);
    if (key !== solutionPanelKey) {
      solutionPanelKey = key;
      $('solution-coverage').textContent = `${(space.safeDegrees / 3.6).toFixed(1)} % safe`;
      $('solution-status').textContent = !own ? 'Select or place an aircraft.' : space.alreadyInside ? 'Already within the separation limit. No heading is safe over the entire window.' : !space.safe.length ? 'No safe heading at this speed. Try changing speed or position.' : space.currentSafe ? 'The current heading is safe.' : 'The current heading leads to a predicted conflict.';
      $('solution-status').classList.toggle('has-conflict', !!own && !space.currentSafe);
      $('solution-assumptions').textContent = own ? `${own.id} at ${Math.round(own.speed)} kt · ${state.horizon} minutes ahead · minimum ${state.separation} NM${state.sepV ? ` and ${state.sepV} ft` : ''}. Other aircraft keep their current vectors. Turns are instantaneous.` : '';
      $('heading-space').replaceChildren(); $('safe-ranges').replaceChildren();
      space.safe.forEach(([from, to]) => {
        const middle = (from + to) / 2, label = from === 0 && to === 360 ? 'All directions' : `${from.toFixed(1)}°–${to.toFixed(1)}°`;
        const bar = document.createElement('button'); bar.className = 'safe-heading-segment'; bar.style.left = `${from / 3.6}%`; bar.style.width = `${(to - from) / 3.6}%`; bar.dataset.heading = middle; bar.title = `${label} : apply heading ${middle.toFixed(1)}°`; $('heading-space').appendChild(bar);
        const button = document.createElement('button'); button.className = 'safe-range'; button.textContent = label; button.dataset.heading = middle; button.title = bar.title; $('safe-ranges').appendChild(button);
      });
    }
    $('solution-help').textContent = state.background === 'density' ? 'Use the interval buttons to apply a safe heading. Choose another background for clickable radar sectors.' : 'Click a green radar sector to apply a heading. Interval buttons select their midpoint.';
    if (!own || state.background === 'density' || state.view === '3d') return;
    const cx = own.x * 10, cy = own.y * 10, outer = 140, inner = 35, polar = (r, an) => { const rad = an * Math.PI / 180; return [cx + Math.sin(rad) * r, cy - Math.cos(rad) * r]; };
    const arc = (r, from, to) => { let path = ''; const steps = Math.ceil(Math.abs(to - from) / 90); for (let i = 1; i <= steps; i++) { const p = polar(r, from + (to - from) * i / steps); path += ` A ${r} ${r} 0 0 ${to >= from ? 1 : 0} ${p[0]} ${p[1]}`; } return path; };
    el('circle', {cx, cy, r: (outer + inner) / 2, fill: 'none', stroke: '#ff8c83', 'stroke-width': outer - inner, 'stroke-opacity': '.09', 'pointer-events': 'none'}, layer);
    space.safe.forEach(([from, to]) => { const p = polar(outer, from), q = polar(inner, to);
      const wedge = el('path', {d: `M ${p[0]} ${p[1]}${arc(outer, from, to)} L ${q[0]} ${q[1]}${arc(inner, to, from)} Z`, class: 'safe-sector', 'data-safe-sector': 'true'}, layer);
      el('title', {}, wedge).textContent = `Safe: ${from.toFixed(1)}°–${to.toFixed(1)}°. Click to apply this heading.`; });
    el('circle', {cx, cy, r: outer, fill: 'none', stroke: '#91aaa9', 'stroke-opacity': '.35', 'pointer-events': 'none'}, layer);
  }
  function applySafeHeading(heading) {
    const aircraft = current(), own = aircraft.find(a => a.id === state.selected); if (!own || !Number.isFinite(heading)) return;
    if (aircraft.some(o => o.id !== own.id && M.encounter({...own, heading}, o, state.horizon, state.separation, state.sepV).risk)) { notify('This heading is no longer safe. Choose a green sector.'); return; }
    edit(() => { selected().heading = heading; }); state.focus = null; render(); notify(`Safe heading ${heading.toFixed(1)}° applied to ${own.id}.`);
  }

  // ------------------------------------------------------------------ rencontres
  function renderAnalysis() {
    results = M.analyze(current(), state.horizon, state.separation, state.sepV);
    $('encounter-count').textContent = results.length; $('risk-count').textContent = results.filter(e => e.risk).length; $('prediction-label').textContent = `${state.horizon}-minute window`;
    const box = $('encounters'); box.replaceChildren();
    if (!results.length) { box.innerHTML = '<div class="empty"><strong>No encounters in this window</strong>Move aircraft or extend the horizon to explore crossings.</div>'; return; }
    results.slice(0, 100).forEach(e => {
      const b = document.createElement('button'), key = `${e.a}-${e.b}`;
      b.className = 'encounter' + (e.risk ? ' risk' : '') + (e.separatedVertically ? ' separated' : '') + (state.focus === key ? ' focused' : '');
      const tag = e.risk ? 'LOSS OF SEPARATION' : e.separatedVertically ? 'VERTICALLY SEPARATED' : 'ROUTE CROSSING';
      b.innerHTML = `<div class="encounter-head"><strong>${e.a} <span style="color:#607c90">×</span> ${e.b}</strong><span class="encounter-tag">${tag}</span></div><div class="encounter-details"><span>Closest approach <b>${fmt(e.distance)} NM</b></span><span>Altitude difference <b>${Math.round(e.vsep)} ft</b></span><span>In <b>${clock(e.t)}</b></span></div><div class="encounter-note">${e.crossing ? `Crossing arrivals: ${clock(e.crossing.ta)} / ${clock(e.crossing.tb)} · gap ${clock(e.crossing.gap)}` : 'Routes overlap or converge within the separation threshold.'}</div>`;
      b.onclick = () => { state.focus = state.focus === key ? null : key; renderAnalysis(); draw(); }; box.appendChild(b);
    });
    if (results.length > 100) { const p = document.createElement('p'); p.className = 'empty'; p.textContent = `Showing the first 100 of ${results.length} encounters, predicted conflicts first.`; box.appendChild(p); }
  }

  // ------------------------------------------------------------------ solution, manual maneuvers, charts
  function renderSolutionPanel() {
    const routes = getRoutes(), genes = shownGenes(), ev = CM.evaluate(routes, genes, evalOpts()), body = $('solution-body'), names = {none: "original routes", ga: 'genetic algorithm', manual: 'my solution', enac: "ENAC algorithm"};
    const ids = state.aircraft.map(a => a.id), ok = ev.conflict === 0 && ev.dmin >= state.separation - 1e-9;
    $('planned-status').textContent = `DISPLAYED ROUTES: ${ok ? 'conflict-free' : 'loss of separation'}`;
    $('planned-status').className = ok ? 'good' : 'bad';
    $('solution-summary-line').textContent = `${names[state.source]} : ${ok ? 'conflict-free' : `${ev.conflict.toFixed(0)} s in conflict`} · min. separation ${Number.isFinite(ev.dmin) ? ev.dmin.toFixed(1) : '—'} NM`;
    const g = state.ga, extra = g ? `<div><span>Explored candidates</span><b>${g.genes.length.toLocaleString('en-GB')}</b></div><div><span>Safe candidate share</span><b>${(100 * g.dmin.filter(d => d >= state.separation).length / g.dmin.length).toFixed(0)} %</b></div>` : '';
    body.innerHTML = `<div class="metrics"><div><span>Minimum equivalent separation</span><b class="${ok ? 'good' : 'bad'}">${Number.isFinite(ev.dmin) ? ev.dmin.toFixed(1) : '—'} NM</b></div><div><span>Time in conflict</span><b class="${ev.conflict ? 'bad' : 'good'}">${ev.conflict.toFixed(0)} s</b></div><div><span>Added distance</span><b>${ev.extra.toFixed(1)} NM</b></div><div><span>Maneuvering aircraft</span><b>${ev.nMan}</b></div><div><span>Local fitness</span><b>${ev.fitness.toFixed(3)}</b></div>${extra}</div>
      <h3>Controller instructions</h3><ul class="instructions">${CM.instructions(routes, ids, genes).map(t => `<li>${t}</li>`).join('')}</ul>
      ${g ? '<p class="note">The heatmap shows explored trajectories, not every possibility. A green trajectory is safe with the other maneuvers in the same candidate; combining green trajectories does not guarantee a conflict-free solution. Gaussian width controls display smoothing only; colored boundaries are not safety limits.</p>' : ''}
      <p class="note">Level changes: 1,500 ft/min, followed by a return to the original route altitude. Turns use 5° increments; positive angles turn left.</p>`;
  }
  function buildManualPanel() {
    const body = $('manual-body'); body.replaceChildren(); manualDirty = false;
    const routes = getRoutes(), cur = shownGenes();
    const row = document.createElement('div'); row.className = 'manual-grid';
    state.aircraft.forEach((a, i) => {
      const r = routes[i], start = Math.ceil(CM.commandStart(r) / 5) * 5, end = Math.round(r.t[r.t.length - 1]), idle = cur[i][2] === 0 && cur[i][3] === 0, g = idle ? [Math.max(30, start), Math.max(30, start) + 300, 0, 0] : cur[i], box = document.createElement('div'); box.className = 'manual-ac';
      box.innerHTML = `<strong>${a.id}</strong>
        <label>Angle <b data-v="a">${Math.round(g[2])}°</b><input type="range" min="-40" max="40" step="5" value="${clamp(Math.round(g[2] / 5) * 5, -40, 40)}" data-k="2"></label>
        <label>Level <b data-v="z">${g[3] >= 0 ? '+' : ''}${Math.round(g[3])} ft</b><input type="range" min="-2000" max="2000" step="1000" value="${clamp(Math.round(g[3] / 1000) * 1000, -2000, 2000)}" data-k="3"></label>
        <label>Start <b data-v="t1">${Math.round(g[0])} s</b><input type="range" min="${start}" max="${end}" step="5" value="${clamp(Math.round(g[0]), start, end)}" data-k="0"></label>
        <label>Duration <b data-v="d">${Math.round(g[1] - g[0])} s</b><input type="range" min="5" max="450" step="5" value="${clamp(Math.round(g[1] - g[0]) || 5, 5, 450)}" data-k="1"></label>`;
      box.querySelectorAll('input').forEach(inp => inp.oninput = () => {
        const base = state.solutions.manual || shownGenes().map(x => x.slice()); state.solutions.manual = base; state.source = 'manual'; refreshSolutionSelect();
        const gg = base[i], k = Number(inp.dataset.k), v = Number(inp.value), dur = Number(box.querySelector('[data-k="1"]').value), t1 = Number(box.querySelector('[data-k="0"]').value);
        if (k === 2) gg[2] = v; if (k === 3) gg[3] = v; gg[0] = t1; gg[1] = t1 + dur;
        box.querySelector('[data-v="a"]').textContent = `${gg[2]}°`; box.querySelector('[data-v="z"]').textContent = `${gg[3] >= 0 ? '+' : ''}${gg[3]} ft`; box.querySelector('[data-v="t1"]').textContent = `${t1} s`; box.querySelector('[data-v="d"]').textContent = `${dur} s`;
        state.heatRev += 0; renderAnalysis(); draw(); renderSolutionPanel(); drawCharts();
      });
      row.appendChild(box);
    });
    body.appendChild(row);
  }
  function drawCharts() {
    if (!$('panel-charts').open) return;
    const g = state.ga, sep = state.separation;
    if (g) {
      const gens = [...new Set(g.gen)], best = gens.map(k => Math.max(...g.fit.filter((_, i) => g.gen[i] === k))), mean = gens.map(k => { const f = g.fit.filter((_, i) => g.gen[i] === k); return f.reduce((s, v) => s + v, 0) / f.length; });
      // Retained elites have no new records; carry forward the best score found so far.
      for (let i = 1; i < best.length; i++) best[i] = Math.max(best[i], best[i - 1]);
      const safe = gens.map(k => { const d = g.dmin.filter((_, i) => g.gen[i] === k); return d.filter(v => v >= sep).length / d.length; });
      Charts.lineChart($('chart-ga'), [{label: 'best fitness', color: '#64dfcb', xs: gens, ys: best}, {label: 'mean', color: '#ffcb78', xs: gens, ys: mean}, {label: 'safe share', color: '#b39dff', xs: gens, ys: safe}], {ymin: 0, ymax: 1, xlabel: 'generation'});
    } else Charts.lineChart($('chart-ga'), [], {});
    const routes = getRoutes(), genes = shownGenes(), win = simDuration() * 60, ts = [], steps = 200; for (let k = 0; k <= steps; k++) ts.push(win * k / steps);
    const pairs = []; for (let i = 0; i < routes.length; i++) for (let j = i + 1; j < routes.length; j++) pairs.push([i, j]);
    const curves = pairs.map(([i, j]) => { const dh = [], dv = []; for (const t of ts) { const a = CM.stateAt(routes[i], genes[i], t), b = CM.stateAt(routes[j], genes[j], t); if (a && b) { dh.push(Math.hypot(a.x - b.x, a.y - b.y)); dv.push(Math.abs(a.z - b.z)); } else { dh.push(NaN); dv.push(NaN); } } return {i, j, dh, dv, m: Math.min(...dh.filter(Number.isFinite))}; });
    curves.sort((p, q) => p.m - q.m); const top = curves.slice(0, 6);
    const ser = key => top.map((c, k) => ({label: `${state.aircraft[c.i].id}–${state.aircraft[c.j].id}`, color: COLORS[k % COLORS.length], xs: ts, ys: c[key]}));
    Charts.lineChart($('chart-h'), ser('dh'), {hlines: [{y: sep, color: '#ff8c83'}], ymin: 0}); Charts.lineChart($('chart-v'), ser('dv'), {hlines: state.sepV ? [{y: state.sepV, color: '#ff8c83'}] : [], ymin: 0});
  }

  // ------------------------------------------------------------------ genetic algorithm
  function runGA() {
    if (state.gaRunning) { state.rev++; state.gaRunning = false; $('run-ga').textContent = '▶ Run solver'; $('ga-status').textContent = 'Stopped.'; $('ga-progress').hidden = true; return; }
    const routes = getRoutes(); if (routes.length < 2) { notify('At least two aircraft are required.'); return; }
    setPlaying(false);
    const cfg = {pop: Math.round(clamp(Number($('ga-pop').value) || 100, 20, 300)), generations: Math.round(clamp(Number($('ga-gens').value) || 100, 10, 300)), seed: Number($('ga-seed').value) || 0,
      weights: {...state.weights}, vertical: $('ga-vertical').checked, sep: state.separation, sepV: state.sepV, window: Infinity};
    const rev = state.rev, it = GA.run(routes, cfg);
    state.gaRunning = true; $('run-ga').textContent = '■ Stop'; $('ga-progress').hidden = false;
    const step = () => {
      if (rev !== state.rev) return;
      if (!state.gaRunning) { state.gaRunning = false; $('run-ga').textContent = '▶ Run solver'; $('ga-progress').hidden = true; return; }
      const t0 = performance.now(); let s;
      do { s = it.next(); } while (!s.done && performance.now() - t0 < 25);
      if (!s.done) { $('ga-progress').firstElementChild.style.width = `${100 * s.value.gen / cfg.generations}%`; $('ga-status').textContent = `Generation ${s.value.gen}/${cfg.generations} · best fitness ${s.value.best.toFixed(3)}`; setTimeout(step, 0); return; }
      const result = s.value; state.gaRunning = false; $('run-ga').textContent = '▶ Run solver'; $('ga-progress').hidden = true;
      state.ga = result; state.solutions.ga = result.best; state.source = 'ga'; state.heat = GA.heatLayers(routes, result, {sep: state.separation}); state.heatRev++; manualDirty = true;
      state.background = 'heat'; $('background').value = 'heat'; applyBackground(); refreshSolutionSelect();
      const e = CM.evaluate(routes, result.best, evalOpts());
      $('ga-status').textContent = `${result.genes.length.toLocaleString('en-GB')} explored candidates · ${e.conflict === 0 && e.dmin >= state.separation - 1e-9 ? 'conflict-free solution' : 'remaining conflict'} (min. separation ${e.dmin.toFixed(1)} NM).`;
      render(); notify('Solver finished: solution displayed.');
    };
    step();
  }
  function applyBackground() {
    const bg = state.background; densityView.setEnabled(bg === 'density' || bg === 'heat');
    const box = $('density-controls'); box.hidden = bg === 'none';
    box.querySelectorAll('label').forEach(l => { l.hidden = bg === 'heat' && !l.querySelector('#density-scope, #density-kernel'); });
    if (bg !== 'density') { densityView.cancel(); densityView.result = null; densityView.clear(); }
    densityView.enabled = bg === 'density'; if (bg === 'density') densityView.onChange();
    if (bg !== 'heat') $('heat-image').removeAttribute('href'), $('heat-image').removeAttribute('data-key');
    if (bg === 'heat' && !state.heat) notify('Run the genetic solver to generate a heatmap.');
  }

  function changeWeights(weights) {
    state.weights = CM.fitnessWeights(weights);
    // Keep the displayed trajectories for comparison, but discard scores from the old objective.
    state.rev++; state.gaRunning = false; state.ga = null; state.heat = null; state.heatRev++;
    $('run-ga').textContent = '▶ Run solver'; $('ga-progress').hidden = true;
    $('ga-status').textContent = 'Weights changed. Displayed solution re-scored; run the solver again to optimize.';
    render();
  }
  Object.keys(CM.DEFAULT_WEIGHTS).forEach(key => {
    const input = $('weight-' + key);
    input.onchange = () => {
      const value = Number(input.value);
      if (input.value.trim() === '' || !Number.isFinite(value) || value < 0 || value > 1000000) {
        input.value = state.weights[key]; notify('Choose a fitness weight between 0 and 1,000,000.'); return;
      }
      changeWeights({...state.weights, [key]: value});
    };
  });
  $('reset-weights').onclick = () => {
    Object.entries(CM.DEFAULT_WEIGHTS).forEach(([key, value]) => { $('weight-' + key).value = value; });
    changeWeights({...CM.DEFAULT_WEIGHTS});
  };

  // ------------------------------------------------------------------ interactions
  function point(event) { const p = new DOMPoint(event.clientX, event.clientY).matrixTransform(svg.getScreenCTM().inverse()); return {x: p.x / 10, y: p.y / 10}; }
  function placeAircraft(x, y) {
    if (state.aircraft.length >= 100) { notify('The workspace supports up to 100 aircraft.'); return; }
    edit(() => newAircraft(x, y)); setPlacing(false); state.focus = null; render();
  }
  function startDrag(id, kind, p) { commitTime(); state.selected = id; state.focus = null; const a = selected(); drag = {kind, offsetX: p.x - a.x, offsetY: p.y - a.y}; render(); }
  function moveDrag(p) {
    const a = selected(); if (!a || !drag) return;
    if (drag.kind === 'position') { a.x = clamp(p.x - drag.offsetX, 1, 119); a.y = clamp(p.y - drag.offsetY, 1, 89); }
    else { const dx = p.x - a.x, dy = p.y - a.y; a.speed = clamp(Math.hypot(dx, dy) * 20, 60, 900); a.heading = (Math.atan2(dx, -dy) * 180 / Math.PI + 360) % 360; }
    state.routes = null; touch(); render();
  }
  svg.addEventListener('pointerdown', event => {
    if (event.button !== 0) return; const p = point(event);
    const sector = event.target.closest('[data-safe-sector]');
    if (sector && !state.placing) { const own = current().find(a => a.id === state.selected); if (!own) return; event.preventDefault(); event.stopImmediatePropagation(); applySafeHeading((Math.atan2(p.x - own.x, -(p.y - own.y)) * 180 / Math.PI + 360) % 360); return; }
    if (state.placing) { if (p.x < 0 || p.x > 120 || p.y < 0 || p.y > 90) return; placeAircraft(p.x, p.y); return; }
    const target = event.target.closest('[data-drag]'); if (!target) return;
    event.preventDefault(); drag = null; svg.setPointerCapture(event.pointerId); drag = {pointer: event.pointerId}; startDrag(target.dataset.id, target.dataset.drag, p); drag.pointer = event.pointerId;
  }, true);
  svg.addEventListener('pointermove', event => { if (!drag || event.pointerId !== drag.pointer) return; moveDrag(point(event)); });
  const endDrag = () => { drag = null; view3d?.endDrag(); }; ['pointerup', 'pointercancel', 'lostpointercapture'].forEach(n => svg.addEventListener(n, endDrag));
  svg.addEventListener('click', event => { const p = event.target.closest('[data-pair]'); if (p) { state.focus = p.dataset.pair; renderAnalysis(); draw(); } });
  svg.addEventListener('keydown', event => {
    const target = event.target.closest('[data-id]');
    if (!target) { const p = event.target.closest('[data-pair]'); if (p && ['Enter', ' '].includes(event.key)) { event.preventDefault(); state.focus = p.dataset.pair; renderAnalysis(); draw(); } return; }
    if (['Enter', ' '].includes(event.key)) { event.preventDefault(); state.selected = target.dataset.id; render(); $('speed').focus(); return; }
    const steps = {ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0]}; if (!steps[event.key]) return;
    event.preventDefault(); const id = target.dataset.id, s = event.shiftKey ? 5 : 1;
    edit(() => { state.selected = id; const a = selected(); a.x = clamp(a.x + steps[event.key][0] * s, 1, 119); a.y = clamp(a.y + steps[event.key][1] * s, 1, 89); }); render();
    svg.querySelector(`[data-id="${id}"][data-drag="position"]`)?.focus();
  });
  function updateVector(field, value) {
    if (!selected()) return; const n = Number(value);
    const limits = {speed: [60, 900, 'Speed must be between 60 and 900 knots.'], heading: [0, 359, 'Heading must be between 0 and 359 degrees.'], level: [0, 500, 'Level must be between FL0 and FL500.'], vz: [-6000, 6000, 'Vertical rate must be between −6,000 and 6,000 ft/min.']}[field];
    if (value === '' || !Number.isFinite(n) || n < limits[0] || n > limits[1]) { notify(limits[2]); renderFleet(); return; }
    edit(() => { const a = selected(); if (field === 'level') a.z = n * 100; else a[field] = n; }); state.focus = null; render();
  }
  $('speed').addEventListener('change', e => updateVector('speed', e.target.value)); $('heading').addEventListener('change', e => updateVector('heading', e.target.value));
  $('level').addEventListener('change', e => updateVector('level', e.target.value)); $('vz').addEventListener('change', e => updateVector('vz', e.target.value)); $('speed-range').addEventListener('input', e => updateVector('speed', e.target.value));
  $('generate').onclick = generate; $('run-ga').onclick = runGA;
  $('add').onclick = () => { if (state.aircraft.length >= 100) { notify('The workspace supports up to 100 aircraft.'); return; } setPlaying(false); setPlacing(!state.placing); if (state.placing) { notify('Click anywhere in the view to place an aircraft.'); $('radar-wrap').scrollIntoView({block: 'center', behavior: 'smooth'}); } };
  $('remove').onclick = () => { edit(() => { state.aircraft = state.aircraft.filter(a => a.id !== state.selected); state.selected = state.aircraft[0]?.id || null; }); state.focus = null; render(); };
  $('horizon').onchange = e => { state.horizon = Number(e.target.value); state.solutions = {...state.solutions}; render(); };
  $('separation').onchange = e => { state.separation = Number(e.target.value); render(); };
  $('sepv').onchange = e => { state.sepV = Number(e.target.value); render(); };
  $('view').onchange = e => { state.view = e.target.value; setPlacing(state.placing); render(); };
  $('axis').onchange = e => { state.axis = e.target.value; draw(); };
  $('background').onchange = e => { state.background = e.target.value; applyBackground(); draw(); };
  $('solution-source').onchange = e => { state.source = e.target.value; state.time = Math.min(state.time, simDuration()); manualDirty = true; render(); };
  $('scenario').onchange = e => loadScenario(e.target.value);
  document.querySelectorAll('[data-layer]').forEach(box => box.onchange = () => { state.layers[box.dataset.layer] = box.checked; draw(); });
  $('show-solutions').onchange = event => { state.showSolutions = event.target.checked; solutionPanelKey = ''; draw(); };
  for (const id of ['heading-space', 'safe-ranges']) { $(id).addEventListener('pointerdown', () => setPlaying(false)); $(id).addEventListener('click', event => { const b = event.target.closest('[data-heading]'); if (b) applySafeHeading(Number(b.dataset.heading)); }); }
  $('play').onclick = () => { if (!state.aircraft.length) { notify('Place an aircraft to start the simulation.'); return; } setPlacing(false); if (state.time >= simDuration()) state.time = 0; setPlaying(!state.playing); render(); };
  $('reset').onclick = () => { setPlaying(false); state.time = 0; render(); };
  $('timeline').oninput = e => { setPlaying(false); state.time = Number(e.target.value); render(); };
  ['panel-charts', 'panel-manual'].forEach(id => $(id).addEventListener('toggle', () => { if (id === 'panel-manual' && $(id).open && manualDirty) buildManualPanel(); drawCharts(); }));
  document.addEventListener('keydown', event => { if (event.key === 'Escape') { setPlacing(false); state.focus = null; render(); } if (event.code === 'Space' && !event.target.closest('input,select,button,[tabindex],summary')) { event.preventDefault(); $('play').click(); } });
  function tick(now) {
    const delta = lastFrame ? Math.min((now - lastFrame) / 1000, .1) : 0; lastFrame = now;
    if (state.playing) { const dur = simDuration(); state.time = Math.min(dur, state.time + delta * Number($('rate').value) / 60); if (now - lastAnalysis > 200) { renderAnalysis(); lastAnalysis = now; } draw(); if (state.time >= dur) { setPlaying(false); render(); } }
    requestAnimationFrame(tick);
  }
  if (document.modelContext?.registerTool) { try { Promise.resolve(document.modelContext.registerTool({name: 'read_aircraft_scenario', description: 'Read aircraft positions, speeds, levels and predicted encounters.', inputSchema: {type: 'object', properties: {}, additionalProperties: false}, annotations: {readOnlyHint: true}, execute: () => ({aircraft: current(), timeMinutes: state.time, horizonMinutes: state.horizon, separationNM: state.separation, verticalSeparationFt: state.sepV, encounters: M.analyze(current(), state.horizon, state.separation, state.sepV)})})).catch(() => {}); } catch {} }
  const updateScale = () => { const m = svg.getScreenCTM(); if (m && svg.style.display !== 'none') { const sc = document.querySelector('.scale'); sc.style.minWidth = '0'; sc.style.width = `${100 * m.a}px`; } };
  new ResizeObserver(() => { updateScale(); view3d?.render(); }).observe($('radar-wrap'));
  function render() { renderFleet(); renderAnalysis(); draw(); renderSolutionPanel(); if (manualDirty && $('panel-manual').open) buildManualPanel(); drawCharts(); }

  // ------------------------------------------------------------------ Startup
  const sel = $('scenario'); sel.add(new Option("Demo scenario", 'demo')); sel.add(new Option('Custom scenario', 'custom'));
  DATA.scenarios.forEach(s => sel.add(new Option(s.label, s.key)));
  window.VectorPlus = {state, loadScenario, runGA, render, current, evaluate: () => CM.evaluate(getRoutes(), shownGenes(), evalOpts()), getRoutes, shownGenes, view3d: () => view3d};
  demo(); applyBackground(); updateScale(); requestAnimationFrame(tick);
  const q = new URLSearchParams(location.search);
  if (q.get('scenario')) loadScenario(q.get('scenario'));
})();
