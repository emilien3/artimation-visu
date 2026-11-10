// Presentation view; independent of the editable studio's scenario and solver state.
(() => {
  'use strict';
  const $ = id => document.getElementById(id), E = TrajectoryExploration, CM = ConflictModel;
  const COLORS = ['#ffcb78', '#94bcff', '#d3a5ff', '#6be6e0'], SAFE = '#64dfcb', UNSAFE = '#ff8c83';
  const state = {data: null, running: false, revision: 0, ids: [], cursor: 0, bounds: null, time: 0};
  let playingSearch = false;
  const fmt = (n, digits = 2) => n == null ? '—' : n.toFixed(digits);
  const label = v => v === 'safe' ? 'safe' : 'conflict';
  const selected = () => state.data?.candidates[state.ids[state.cursor]];
  const isSA = () => $('lab-algorithm').value === 'simulated-annealing';
  const names = {genetic: 'Genetic algorithm', 'simulated-annealing': 'Simulated annealing', orca: 'ORCA', mpc: 'MPC', milp: 'MILP'};
  const solutionId = () => Object.hasOwn(state.data, 'solution_candidate_id') ? state.data.solution_candidate_id : state.data.best_candidate_id;
  function runLabel() { $('lab-run').textContent = state.running ? 'Stop' : 'Run'; }

  function invalidate() {
    state.revision++; state.running = false; state.data = null; state.ids = [];
    $('lab-results').hidden = true; $('lab-metrics').replaceChildren(); runLabel();
    $('lab-status').textContent = 'Ready to run.';
  }
  function algorithmControls() {
    const method = $('lab-algorithm').value, seeded = ['genetic', 'simulated-annealing'].includes(method);
    document.querySelectorAll('[data-lab-ga]').forEach(el => el.hidden = method !== 'genetic');
    document.querySelectorAll('[data-lab-sa]').forEach(el => el.hidden = !isSA());
    document.querySelectorAll('[data-lab-seeded]').forEach(el => el.hidden = !seeded);
    $('lab-vertical').disabled = !seeded;
    $('lab-model-scope').textContent = method === 'orca' ? 'FL360 · variable speed up to 360 kt · 7 NM separation' : `${seeded && $('lab-vertical').checked ? 'Altitude changes enabled' : 'FL360'} · 360 kt · 7 NM separation`;
    $('lab-method-settings').textContent = ({orca: '10 s updates. 400 s lookahead. Variable speed.', mpc: '20 s updates. 400 s lookahead. Fixed speed.', milp: '49 trajectories per aircraft. Exact catalogue selection.'})[method] ?? '';
    for (const value of ['accepted', 'rejected']) $('lab-candidate-filter').querySelector(`[value="${value}"]`).disabled = !isSA();
    $('lab-candidate-filter').value = 'all'; runLabel();
  }
  function readNumber(id, lo, hi, integer = true) {
    const input = $(id), v = Number(input.value);
    if (!input.value.trim() || !Number.isFinite(v) || v < lo || v > hi || (integer && !Number.isInteger(v))) {
      $('lab-settings').open = true; input.focus(); throw new Error(`${input.parentElement.textContent.trim()}: choose ${integer ? 'an integer' : 'a number'} between ${lo} and ${hi}.`);
    }
    return v;
  }
  function run() {
    if (state.running) { invalidate(); $('lab-status').textContent = 'Stopped.'; return; }
    let cfg, scn;
    try {
      scn = E.scenario($('lab-scenario').value);
      const method = $('lab-algorithm').value, seeded = ['genetic', 'simulated-annealing'].includes(method);
      cfg = {...E.DEFAULTS, seed: seeded ? readNumber('lab-seed', 0, 9999) : 0, vertical: seeded && $('lab-vertical').checked};
      if (isSA()) {
        cfg = {seed: cfg.seed, vertical: cfg.vertical, sep: cfg.sep, sepV: cfg.sepV,
          iterations: readNumber('lab-iterations', 1, 25000), temperatureStart: readNumber('lab-temperature-start', 0.000001, 10, false),
          temperatureEnd: readNumber('lab-temperature-end', 0.000001, 10, false)};
        if (cfg.temperatureEnd > cfg.temperatureStart) throw new Error('Final temperature must not exceed initial temperature.');
      } else if (method === 'genetic') { cfg.pop = readNumber('lab-pop', 2, 150); cfg.generations = readNumber('lab-generations', 0, 150); }
      else cfg = {seed: 0, vertical: false, sep: cfg.sep, sepV: cfg.sepV};
    } catch (error) { $('lab-status').textContent = error.message; return; }
    invalidate(); state.running = true; state.time = 0; runLabel();
    const revision = state.revision, method = $('lab-algorithm').value;
    const solver = {genetic: GeneticSolver, 'simulated-annealing': AnnealingSolver, orca: OrcaSolver, mpc: MPCSolver, milp: MILPSolver}[method];
    const iterator = solver.run(scn.routes, cfg), started = performance.now();
    $('lab-status').textContent = 'Running…';
    const advance = () => {
      if (revision !== state.revision) return;
      try {
        const start = performance.now(); let s;
        do { s = iterator.next(); } while (!s.done && performance.now() - start < 20);
        if (!s.done) {
          $('lab-status').textContent = `Running · ${s.value.evaluated.toLocaleString('en-US')} recorded plans`;
          setTimeout(advance, 0); return;
        }
        const searchTime = performance.now() - started;
        state.data = E.dataset(scn, s.value); state.running = false; runLabel();
        buildPlots(); renderMetrics();
        state.data.search_wall_time_ms = searchTime;
        $('lab-candidate-filter').value = 'all'; filterCandidates(solutionId() ?? state.data.best_candidate_id);
        $('lab-best').disabled = solutionId() == null;
        $('lab-results').hidden = false;
        const termination = s.value.termination ?? s.value.diagnostics?.termination;
        const completed = s.value.completed !== false && !['infeasible', 'node-limit', 'max-time', 'unsafe-control-interval'].includes(termination);
        const outcome = solutionId() == null ? 'No solution' : s.value.completed === false ? 'Incomplete flight' : selected().label === 'safe' ? 'Safe result' : 'Conflict remains';
        $('lab-status').textContent = `${names[method]} · ${completed ? 'Complete' : termination} · ${outcome}${method === 'milp' && termination === 'optimal' ? ' · Catalogue optimum proven' : ''}`;
      } catch (error) { state.running = false; runLabel(); $('lab-status').textContent = `Run failed: ${error.message}`; }
    };
    setTimeout(advance, 0);
  }

  function renderMetrics() {
    const d = state.data, safe = d.candidates.filter(c => c.label === 'safe').length;
    const items = [[d.candidate_count, 'Recorded plans'], [d.unique_candidate_count, 'Distinct plans'],
      [safe, 'Safe plans'], [d.candidate_count - safe, 'Conflicting plans']];
    $('lab-metrics').replaceChildren();
    for (const [value, text] of items) {
      const box = document.createElement('div'), title = document.createElement('span'), count = document.createElement('b');
      title.textContent = text; count.textContent = value.toLocaleString('en-US'); box.append(title, count); $('lab-metrics').append(box);
    }
  }
  function filterCandidates(preferredId) {
    if (!state.data) return;
    const filter = $('lab-candidate-filter').value;
    state.ids = state.data.candidates.filter(c => filter === 'all' || c.label === filter || (filter === 'accepted' && c.accepted === true) || (filter === 'rejected' && c.accepted === false)).map(c => c.candidate_id);
    state.cursor = Math.max(0, state.ids.indexOf(preferredId ?? selected()?.candidate_id));
    $('lab-cursor').max = Math.max(0, state.ids.length - 1); $('lab-cursor').disabled = !state.ids.length;
    renderSelection();
  }
  function renderSelection() {
    const c = selected();
    $('lab-cursor').value = state.cursor;
    $('lab-prev').disabled = !state.ids.length || state.cursor === 0;
    $('lab-next').disabled = !state.ids.length || state.cursor >= state.ids.length - 1;
    $('lab-candidate-id').disabled = !c;
    if (!c) {
      $('lab-selection').textContent = 'No matching record.';
      $('lab-candidate-summary').textContent = 'Choose another filter.';
      $('lab-pairs').replaceChildren(); $('lab-time').disabled = true;
      drawJoint(); drawAircraft(); return;
    }
    $('lab-time').disabled = false;
    $('lab-candidate-id').max = state.data.candidate_count - 1; $('lab-candidate-id').value = c.candidate_id;
    const duplicate = c.first_seen_candidate_id !== c.candidate_id ? ` · duplicate of #${c.first_seen_candidate_id}` : '';
    const acceptance = c.accepted == null ? '' : ` · ${c.accepted ? 'accepted' : 'rejected'} · T = ${c.temperature.toPrecision(3)}`;
    $('lab-selection').textContent = `${state.cursor + 1} / ${state.ids.length} in filter · #${c.candidate_id} · ${c.generation == null ? 'step' : 'generation'} ${c.step} · origin ${c.origin}${duplicate}${acceptance}`;
    const kind = c.method?.kind === 'executed' ? 'Executed flight' : c.method?.kind === 'forecast' ? 'Forecast' : 'Plan';
    const separation = state.data.config.vertical ? 'equivalent' : 'horizontal';
    $('lab-candidate-summary').textContent = `${kind} · ${c.label === 'safe' ? 'Safe' : 'Conflict'} · min. ${separation} separation ${fmt(c.min_equivalent_separation_nm, 3)} NM · detour ${fmt(c.added_distance_nm)} NM`;
    $('lab-candidate-summary').className = c.label === 'safe' ? 'lab-safe' : 'lab-unsafe';
    $('lab-pairs').replaceChildren();
    c.pairs.forEach(pair => {
      const p = document.createElement('p'); p.className = pair.label === 'safe' ? 'lab-safe' : 'lab-unsafe';
      p.textContent = `${pair.aircraft_a} / ${pair.aircraft_b} : ${pair.label === 'safe' ? 'separated' : 'conflict'} · ${fmt(pair.min_equivalent_separation_nm)} NM · ${fmt(pair.conflict_s, 1)} s`;
      $('lab-pairs').append(p);
    });
    const end = Math.max(...c.trajectories.map(tr => tr.knots.at(-1).t_s));
    $('lab-time').max = Math.ceil(end); state.time = Math.min(state.time, end); $('lab-time').value = state.time;
    drawJoint(); drawAircraft();
  }

  function buildPlots() {
    const d = state.data, all = d.candidates.flatMap(c => c.trajectories.flatMap(tr => tr.knots));
    let xmin = 0, xmax = 120, ymin = 0, ymax = 90;
    for (const p of all) { xmin = Math.min(xmin, p.x_nm); xmax = Math.max(xmax, p.x_nm); ymin = Math.min(ymin, p.y_nm); ymax = Math.max(ymax, p.y_nm); }
    let width = xmax - xmin + 10, height = ymax - ymin + 10;
    if (width / height < 4 / 3) width = height * 4 / 3; else height = width * 3 / 4;
    state.bounds = {x: (xmin + xmax - width) / 2, y: (ymin + ymax - height) / 2, width, height};
    const box = $('lab-aircraft-plots'); box.replaceChildren();
    d.aircraft_ids.forEach((id, a) => {
      const card = document.createElement('article'), h = document.createElement('h3'), p = document.createElement('p'), canvas = document.createElement('canvas');
      h.textContent = id; h.style.color = COLORS[a % COLORS.length]; p.id = `lab-aircraft-status-${a}`;
      canvas.id = `lab-aircraft-canvas-${a}`; canvas.width = 720; canvas.height = 540;
      canvas.setAttribute('role', 'img'); canvas.setAttribute('aria-label', `All recorded trajectories for ${id}`);
      card.append(h, p, canvas); box.append(card);
    });
  }
  function setup(canvas) {
    const ctx = canvas.getContext('2d'), b = state.bounds;
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.fillStyle = '#0c1925'; ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.setTransform(canvas.width / b.width, 0, 0, canvas.height / b.height, -b.x * canvas.width / b.width, -b.y * canvas.height / b.height);
    ctx.strokeStyle = '#243746'; ctx.lineWidth = 0.12; ctx.setLineDash([]); ctx.beginPath();
    for (let x = Math.ceil(b.x / 10) * 10; x < b.x + b.width; x += 10) { ctx.moveTo(x, b.y); ctx.lineTo(x, b.y + b.height); }
    for (let y = Math.ceil(b.y / 10) * 10; y < b.y + b.height; y += 10) { ctx.moveTo(b.x, y); ctx.lineTo(b.x + b.width, y); }
    ctx.stroke(); return ctx;
  }
  function path(ctx, knots) { knots.forEach((p, i) => { if (i) ctx.lineTo(p.x_nm, p.y_nm); else ctx.moveTo(p.x_nm, p.y_nm); }); }
  function originals(ctx) {
    ctx.globalAlpha = 0.7; ctx.strokeStyle = '#8fa0b0'; ctx.lineWidth = 0.22; ctx.setLineDash([1, 1]); ctx.beginPath();
    state.data.routes.forEach(r => path(ctx, r.xy_nm.map(p => ({x_nm: p[0], y_nm: p[1]})))); ctx.stroke(); ctx.globalAlpha = 1; ctx.setLineDash([]);
  }
  function drawJoint() {
    if (!state.bounds) return;
    const ctx = setup($('lab-joint-canvas')), c = selected(); originals(ctx); if (!c) return;
    const current = c.trajectories.map(tr => {
      const p = tr.knots, ts = p.map(p => p.t_s);
      if (state.time < ts[0] || state.time > ts.at(-1)) return null;
      return {x: CM.interp(ts, p.map(p => p.x_nm), state.time), y: CM.interp(ts, p.map(p => p.y_nm), state.time), z: CM.interp(ts, p.map(p => p.z_ft), state.time)};
    });
    c.trajectories.forEach((tr, a) => {
      ctx.strokeStyle = COLORS[a % COLORS.length]; ctx.lineWidth = 0.65; ctx.beginPath(); path(ctx, tr.knots); ctx.stroke();
      const now = current[a]; if (!now) return;
      const danger = current.some((other, b) => b !== a && other && Math.hypot(now.x - other.x, now.y - other.y) < state.data.config.sep && (state.data.config.sepV <= 0 || Math.abs(now.z - other.z) < state.data.config.sepV));
      ctx.strokeStyle = danger ? UNSAFE : COLORS[a % COLORS.length]; ctx.globalAlpha = 0.7; ctx.lineWidth = 0.3;
      ctx.beginPath(); ctx.arc(now.x, now.y, state.data.config.sep / 2, 0, Math.PI * 2); ctx.stroke(); ctx.globalAlpha = 1;
      ctx.fillStyle = COLORS[a % COLORS.length]; ctx.beginPath(); ctx.arc(now.x, now.y, 0.85, 0, Math.PI * 2); ctx.fill();
      ctx.font = '2.3px sans-serif'; ctx.fillText(`${tr.aircraft_id} · FL${Math.round(now.z / 100)}`, now.x + 1.5, now.y - 1.5);
    });
    $('lab-time-label').textContent = `${fmt(state.time, 0)} s`;
  }
  function drawAircraft() {
    if (!state.data) return;
    const filter = $('lab-path-filter').value, c = selected();
    state.data.aircraft_ids.forEach((id, a) => {
      const ctx = setup($(`lab-aircraft-canvas-${a}`)); originals(ctx);
      let safeCount = 0;
      for (const candidate of state.data.candidates) if (candidate.trajectories[a].label === 'safe') safeCount++;
      for (const value of ['unsafe', 'safe']) {
        if (filter !== 'all' && filter !== value) continue;
        ctx.strokeStyle = value === 'safe' ? SAFE : UNSAFE; ctx.globalAlpha = 0.11; ctx.lineWidth = 0.17;
        ctx.setLineDash(value === 'unsafe' ? [0.9, 0.6] : []); ctx.beginPath();
        for (const candidate of state.data.candidates) { const tr = candidate.trajectories[a]; if (tr.label === value) path(ctx, tr.knots); }
        ctx.stroke();
      }
      ctx.globalAlpha = 1; ctx.setLineDash([]);
      const tr = c?.trajectories[a], visible = tr && (filter === 'all' || tr.label === filter);
      if (visible) {
        ctx.strokeStyle = '#eef5ff'; ctx.lineWidth = 1.1; ctx.beginPath(); path(ctx, tr.knots); ctx.stroke();
        ctx.strokeStyle = tr.label === 'safe' ? SAFE : UNSAFE; ctx.lineWidth = 0.7; ctx.setLineDash(tr.label === 'unsafe' ? [1.4, 0.8] : []);
        ctx.beginPath(); path(ctx, tr.knots); ctx.stroke(); ctx.setLineDash([]);
      }
      const extra = tr ? ` · #${c.candidate_id} : ${label(tr.label)}${visible ? '' : ' (filtered out)'}${tr.conflicting_aircraft.length ? ` with ${tr.conflicting_aircraft.join(', ')}` : ''}` : '';
      $(`lab-aircraft-status-${a}`).textContent = `${safeCount} safe / ${state.data.candidate_count - safeCount} conflicting${extra}`;
    });
  }
  function download(kind) {
    if (!state.data) return;
    const json = kind === 'json', content = json ? JSON.stringify(state.data, null, 2) : E.csv(state.data, kind);
    const blob = new Blob([content], {type: json ? 'application/json' : 'text/csv;charset=utf-8'}), url = URL.createObjectURL(blob), a = document.createElement('a');
    a.href = url; a.download = `${state.data.run_id}-${json ? 'complete.json' : `${kind}.csv`}`; document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function selectTab(explorer, focus = false) {
    if (explorer && !$('studio').hidden) {
      playingSearch = VectorPlus.state.playing;
      if (playingSearch) $('play').click();
    }
    $('studio').hidden = explorer; $('exploration-lab').hidden = !explorer;
    for (const [id, active] of [['close-exploration', !explorer], ['open-exploration', explorer]]) {
      $(id).setAttribute('aria-selected', String(active)); $(id).tabIndex = active ? 0 : -1;
      if (active && focus) $(id).focus();
    }
    if (!explorer) {
      VectorPlus.render();
      if (playingSearch && !VectorPlus.state.playing) $('play').click();
      playingSearch = false;
    }
  }
  $('open-exploration').onclick = () => selectTab(true);
  $('close-exploration').onclick = () => selectTab(false);
  document.addEventListener('pointerdown', event => {
    for (const id of ['display-settings', 'lab-settings']) {
      const details = $(id);
      if (details.open && !details.contains(event.target)) details.open = false;
    }
  });
  document.querySelector('[role="tablist"]').onkeydown = event => {
    if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) {
      event.preventDefault();
      selectTab(event.key === 'End' || (event.key !== 'Home' && $('exploration-lab').hidden), true);
    }
  };
  $('lab-run').onclick = run;
  document.querySelectorAll('.lab-controls input, .lab-controls select').forEach(input => input.onchange = () => { invalidate(); algorithmControls(); });
  $('lab-candidate-filter').onchange = () => filterCandidates(selected()?.candidate_id);
  $('lab-cursor').oninput = () => { state.cursor = Number($('lab-cursor').value); renderSelection(); };
  $('lab-prev').onclick = () => { state.cursor = Math.max(0, state.cursor - 1); renderSelection(); };
  $('lab-next').onclick = () => { state.cursor = Math.min(state.ids.length - 1, state.cursor + 1); renderSelection(); };
  $('lab-best').onclick = () => { $('lab-candidate-filter').value = 'all'; filterCandidates(solutionId()); };
  $('lab-candidate-id').onchange = () => {
    const id = Number($('lab-candidate-id').value);
    if (!Number.isInteger(id) || id < 0 || id >= state.data.candidate_count) { renderSelection(); return; }
    $('lab-candidate-filter').value = 'all'; filterCandidates(id);
  };
  $('lab-path-filter').onchange = drawAircraft;
  $('lab-time').oninput = () => { state.time = Number($('lab-time').value); drawJoint(); };
  $('lab-export-json').onclick = () => download('json');
  $('lab-export-safe').onclick = () => download('safe');
  $('lab-export-unsafe').onclick = () => download('unsafe');
  algorithmControls();
  window.TrajectoryExplorer = {state};
})();
