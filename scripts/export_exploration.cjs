#!/usr/bin/env node
// Reproduce the presentation datasets without a browser or an external service.
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const E = require('../src/artimation/web/exploration.js');
const GA = require('../src/artimation/web/ga.js');
const SA = require('../src/artimation/web/annealing.js');
const solvers = {genetic: GA, 'simulated-annealing': SA, orca: require('../src/artimation/web/orca.js'),
  mpc: require('../src/artimation/web/mpc.js'), milp: require('../src/artimation/web/milp.js')};

function main(args) {
  if (args.includes('--help')) {
    console.log('Usage: node scripts/export_exploration.cjs [--out DIRECTORY] [--seed INTEGER] [--methods all|METHOD,METHOD]'); return;
  }
  const options = {out: path.resolve(__dirname, '../artifacts/exploration'), seed: 0, methods: 'genetic,simulated-annealing'};
  for (let i = 0; i < args.length; i += 2) {
    if (!['--out', '--seed', '--methods'].includes(args[i]) || !args[i + 1]) throw new Error('Expected --out DIRECTORY, --seed INTEGER or --methods METHOD,METHOD');
    options[args[i].slice(2)] = args[i + 1];
  }
  options.seed = Number(options.seed);
  if (!Number.isInteger(options.seed) || options.seed < 0 || options.seed > 9999) throw new Error('Seed must be an integer between 0 and 9999');
  const methods = options.methods === 'all' ? Object.keys(solvers) : options.methods.split(',');
  if (!methods.length || methods.some(m => !Object.hasOwn(solvers, m)) || new Set(methods).size !== methods.length) throw new Error('Choose distinct supported methods: ' + Object.keys(solvers).join(', '));
  fs.mkdirSync(options.out, {recursive: true});
  const summary = [];
  for (const key of ['crossing-2', 'convergence-4']) for (const algorithm of methods) {
    const scn = E.scenario(key), solver = solvers[algorithm];
    const cfg = {...(algorithm === 'genetic' ? E.DEFAULTS : solver.DEFAULTS), seed: options.seed};
    const result = solver.runSync(scn.routes, cfg), data = E.dataset(scn, result);
    const name = data.run_id;
    fs.writeFileSync(path.join(options.out, `${name}.json`), JSON.stringify(data) + '\n', {flag: 'wx'});
    for (const label of ['safe', 'unsafe']) fs.writeFileSync(path.join(options.out, `${name}-${label}.csv`), E.csv(data, label), {flag: 'wx'});
    summary.push({scenario: key, algorithm, seed: options.seed, candidates: data.candidate_count, distinct: data.unique_candidate_count,
      safe: data.candidates.filter(c => c.label === 'safe').length, unsafe: data.candidates.filter(c => c.label === 'unsafe').length,
      best_min_separation_nm: data.candidates[data.best_candidate_id].min_equivalent_separation_nm,
      best_conflict_s: data.candidates[data.best_candidate_id].conflict_s,
      ...(data.schema_version >= 2 ? {solution_candidate_id: data.solution_candidate_id, solver_status: data.solver_status,
        result_min_separation_nm: data.solution_candidate_id == null ? null : data.candidates[data.solution_candidate_id].min_equivalent_separation_nm} : {}),
      json: `${name}.json`, safe_csv: `${name}-safe.csv`, unsafe_csv: `${name}-unsafe.csv`});
  }
  fs.writeFileSync(path.join(options.out, `summary-seed-${options.seed}.json`), JSON.stringify(summary, null, 2) + '\n', {flag: 'wx'});
  console.log(JSON.stringify({directory: path.resolve(options.out), runs: summary}, null, 2));
}
try { main(process.argv.slice(2)); } catch (error) { console.error(error.message); process.exitCode = 1; }
