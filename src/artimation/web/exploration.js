// Toy scenarios and contextual exports of search proposals and controller predictions.
(function (root) {
  'use strict';
  const CM = root.ConflictModel || require('./model.js');
  const DEFAULTS = Object.freeze({pop: 60, generations: 40, seed: 0, vertical: false, sep: 7, sepV: 1000});
  function scenario(key) {
    if (!['crossing-2', 'convergence-4'].includes(key)) throw new Error('Unknown toy scenario');
    const n = key === 'crossing-2' ? 2 : 4;
    const endpoints = [[[30, 45], [90, 45]], [[60, 75], [60, 15]], [[90, 45], [30, 45]], [[60, 15], [60, 75]]];
    return {key, title: n === 2 ? 'Crossing · 2 aircraft' : 'Convergence · 4 aircraft',
      ids: endpoints.slice(0, n).map((_, i) => `AC00${i + 1}`),
      routes: endpoints.slice(0, n).map(xy => CM.makeRoute(xy, [0, 600], [36000, 36000]))};
  }
  const finite = v => Number.isFinite(v) ? v : null;
  const safe = (dmin, conflict, sep) => dmin >= sep && conflict === 0;

  function dataset(scn, result) {
    const count = result.paths?.length ?? result.genes?.length;
    if (!count || (result.paths ?? result.genes).some(g => g.length !== scn.routes.length)) throw new Error('Invalid exploration trace');
    const cfg = result.cfg, algorithm = result.algorithm || 'genetic', annealing = algorithm === 'simulated-annealing';
    const modern = !['genetic', 'simulated-annealing'].includes(algorithm);
    const opts = {sep: cfg.sep, sepV: cfg.sepV, tmax: cfg.tmax ?? cfg.window ?? Infinity, weights: cfg.weights};
    // Include every configuration value and the routes in the file identity.
    let fingerprint = 2166136261;
    for (const ch of JSON.stringify([scn.routes, cfg])) fingerprint = Math.imul(fingerprint ^ ch.charCodeAt(0), 16777619) >>> 0;
    const seen = new Map();
    const candidates = Array.from({length: count}, (_, candidateId) => {
      const genes = result.genes?.[candidateId], paths = result.paths?.[candidateId] ?? scn.routes.map((r, a) => CM.fullPath(r, genes[a]));
      const key = JSON.stringify(result.paths ? paths : genes);
      if (!seen.has(key)) seen.set(key, candidateId);
      const ev = result.paths ? CM.evaluatePaths(scn.routes, paths, opts) : CM.evaluate(scn.routes, genes, opts);
      const pairs = [];
      for (let a = 0; a < scn.routes.length; a++) for (let b = a + 1; b < scn.routes.length; b++) {
        const stats = CM.pairStats(paths[a], paths[b], cfg.sep, cfg.sepV, opts.tmax);
        pairs.push({aircraft_a: scn.ids[a], aircraft_b: scn.ids[b], min_equivalent_separation_nm: finite(stats.dmin),
          conflict_s: stats.conflict, label: safe(stats.dmin, stats.conflict, cfg.sep) ? 'safe' : 'unsafe'});
      }
      return {candidate_id: candidateId, first_seen_candidate_id: seen.get(key), step: result.gen[candidateId],
        generation: algorithm === 'genetic' ? result.gen[candidateId] : null, origin: result.origin[candidateId],
        accepted: annealing ? result.accepted[candidateId] : null, temperature: annealing ? result.temperature[candidateId] : null,
        parent_candidate_id: annealing ? result.parent[candidateId] : null, label: safe(ev.dmin, ev.conflict, cfg.sep) ? 'safe' : 'unsafe',
        energy: annealing ? 1 - ev.fitness : null,
        acceptance_probability: annealing ? (candidateId === 0 ? 1 : Math.min(1, Math.exp((ev.fitness - result.fit[result.parent[candidateId]]) / result.temperature[candidateId]))) : null,
        fitness: ev.fitness, min_equivalent_separation_nm: finite(ev.dmin), conflict_s: ev.conflict, added_distance_nm: ev.extra,
        maneuvering_aircraft: ev.nMan, altitude_change_ft: ev.alt, pairs,
        ...(modern ? {method: result.meta?.[candidateId] ?? null, commands: result.controls?.[candidateId] ?? []} : {}),
        trajectories: scn.routes.map((route, a) => {
          let p;
          if (result.paths) {
            const path = paths[a], times = [...new Set([...path.t, ...path.tz.filter(t => t >= path.t[0] && t <= path.t.at(-1))])].sort((a, b) => a - b);
            p = {t: times, x: times.map(t => CM.interp(path.t, path.x, t)), y: times.map(t => CM.interp(path.t, path.y, t)), z: times.map(t => CM.interp(path.tz, path.z, t))};
          } else p = CM.pathSamples(route, genes[a]);
          const conflicts = pairs.filter(pair => (pair.aircraft_a === scn.ids[a] || pair.aircraft_b === scn.ids[a]) && pair.label === 'unsafe');
          return {aircraft_id: scn.ids[a], gene: genes?.[a]?.slice() ?? null, label: conflicts.length ? 'unsafe' : 'safe',
            min_equivalent_separation_nm: finite(ev.perAircraft[a]), conflicting_aircraft: conflicts.map(pair => pair.aircraft_a === scn.ids[a] ? pair.aircraft_b : pair.aircraft_a),
            knots: p.t.map((t, i) => ({t_s: t, x_nm: p.x[i], y_nm: p.y[i], z_ft: p.z[i]}))};
        })};
    });
    const tag = {genetic: 'ga', 'simulated-annealing': 'sa', orca: 'orca', mpc: 'mpc', milp: 'milp'}[algorithm];
    if (!tag) throw new Error('Unknown exploration algorithm');
    let solution = Object.hasOwn(result, 'finalIdx') ? result.finalIdx : result.bestIdx;
    if (algorithm === 'milp' && !result.certificate?.choice) solution = null;
    return {schema_version: modern ? 2 : 1, algorithm, scenario_id: scn.key,
      run_id: `${scn.key}-${tag}-${cfg.seed ?? 0}-${modern ? 'plans' : annealing ? cfg.iterations : `${cfg.pop}x${cfg.generations}`}-${cfg.vertical ? '3d' : '2d'}-${fingerprint.toString(16).padStart(8, '0')}`,
      model: {name: 'Artimation Visu toy', coordinates: 'x east, y south', units: {position: 'NM', time: 's', altitude: 'ft', angle: 'deg'},
        gene_fields: ['t1_s', 't2_s', 'alpha_deg_left', 'dz_ft'], vertical_rate_ft_min: 1500,
        turns: 'instantaneous', speed: algorithm === 'orca' ? 'variable, bounded by the original route speed' : 'constant per route segment', evaluation_horizon_s: finite(opts.tmax),
        separation_horizontal_nm: cfg.sep, separation_vertical_ft: cfg.sepV,
        label_scope: 'Each trajectory is labeled against all other trajectories IN THE SAME candidate, over their common flight times.',
        null_separation: 'No common flight interval; infinity in the evaluator.',
        sampling: 'Exact piecewise-linear knots, including vertical slope changes; interpolate linearly. No time-grid approximation.',
        trace: modern ? 'Complete stored plans only. Controller forecasts and actual execution have distinct method.kind values. Partial MILP tree nodes are not trajectory records.' : 'All recorded proposals, including duplicates and rejected annealing proposals. Retained GA elites and cached evaluations are not new distinct evaluations.',
        annealing_energy: annealing ? '1 - fitness; not a QUBO. Metropolis acceptance with geometric cooling.' : null},
      config: {...cfg, window: finite(opts.tmax), weights: CM.fitnessWeights(cfg.weights)},
      ...(modern ? {solution_candidate_id: solution, solver_status: result.termination ?? result.diagnostics?.termination ?? null,
        diagnostics: result.diagnostics ?? result.certificate ?? null} : {}),
      aircraft_ids: scn.ids.slice(), routes: scn.routes.map((r, a) => ({aircraft_id: scn.ids[a], xy_nm: r.xy, t_s: r.t, z_ft: r.z, enac_start_nm: r.enacStart})),
      best_candidate_id: result.bestIdx, candidate_count: candidates.length, unique_candidate_count: seen.size, candidates};
  }

  function csv(data, label = 'all') {
    if (!['all', 'safe', 'unsafe'].includes(label)) throw new Error('Unknown trajectory label');
    const header = ['schema_version', 'run_id', 'scenario_id', 'algorithm', 'seed', 'candidate_id', 'first_seen_candidate_id', 'step', 'generation', 'origin', 'accepted', 'temperature', 'parent_candidate_id', 'energy', 'acceptance_probability',
      'joint_label', 'aircraft_id', 'trajectory_label', 'conflicting_aircraft', 't1_s', 't2_s', 'alpha_deg_left', 'dz_ft',
      'fitness', 'joint_conflict_s', 'joint_min_equivalent_separation_nm', 'trajectory_min_equivalent_separation_nm',
      'knot_index', 't_s', 'x_nm', 'y_nm', 'z_ft'];
    if (data.schema_version >= 2) header.push('record_type', 'controller_time_s', 'method_objective', 'method_status', 'commands_json');
    const quote = v => v == null ? '' : `"${String(v).replaceAll('"', '""')}"`;
    const rows = [header.join(',')];
    for (const c of data.candidates) for (const tr of c.trajectories) {
      if (label !== 'all' && tr.label !== label) continue;
      tr.knots.forEach((p, i) => {
        const row = [data.schema_version, data.run_id, data.scenario_id, data.algorithm, data.config.seed, c.candidate_id,
        c.first_seen_candidate_id, c.step, c.generation, c.origin, c.accepted, c.temperature, c.parent_candidate_id, c.energy, c.acceptance_probability, c.label, tr.aircraft_id, tr.label, tr.conflicting_aircraft.join('|'), ...(tr.gene ?? [null, null, null, null]),
        c.fitness, c.conflict_s, c.min_equivalent_separation_nm, tr.min_equivalent_separation_nm, i, p.t_s, p.x_nm, p.y_nm, p.z_ft];
        if (data.schema_version >= 2) {
          const aircraft = data.aircraft_ids.indexOf(tr.aircraft_id);
          row.push(c.method?.kind, c.method?.time_s, c.method?.objective, c.method?.termination,
            i === 0 ? JSON.stringify(c.commands.filter(command => command.aircraft_index === aircraft)) : null);
        }
        rows.push(row.map(quote).join(','));
      });
    }
    return rows.join('\r\n') + '\r\n';
  }

  root.TrajectoryExploration = {DEFAULTS, scenario, dataset, csv};
  if (typeof module !== 'undefined' && module.exports) module.exports = root.TrajectoryExploration;
})(typeof globalThis !== 'undefined' ? globalThis : this);
