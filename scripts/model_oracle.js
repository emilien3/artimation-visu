// Run model.js + ga.js (app JS) in an isolated VM context. JSON input on stdin:
//   {routes:[{xy,t,z}], genes:[[[t1,t2,alpha,dz]...]...], opts:{sep,sepV,tmax}}  -> evaluations
//   {routes, ga:{...options}}                                                    -> GA result (best solution)
const fs = require('fs'), vm = require('vm'), path = require('path');
const dir = process.argv[2] || path.join(__dirname, '..', 'src', 'artimation', 'web');
const ctx = vm.createContext({console, Math, Float64Array, Float32Array, Object, Number, JSON, Infinity});
ctx.globalThis = ctx;
for (const f of ['model.js', 'ga.js']) vm.runInContext(fs.readFileSync(path.join(dir, f), 'utf8'), ctx, {filename: f});
const input = JSON.parse(fs.readFileSync(0, 'utf8'));
const CM = ctx.ConflictModel, GA = ctx.GeneticSolver;
const routes = input.routes ? input.routes.map(r => CM.makeRoute(r.xy, r.t, r.z, r.enacStart)) : (input.aircraft || []).map(a => CM.routeFromAircraft(a));
const out = {routes: routes.map(r => ({xy: r.xy, t: r.t, z: r.z}))};
if (input.genes) out.evals = input.genes.map(g => { const e = CM.evaluate(routes, g, input.opts); return {pair: e.pair.map(r => r.map(v => Number.isFinite(v) ? v : null)), conflict: e.conflict, extra: e.extra, nMan: e.nMan, fitness: e.fitness, dmin: e.dmin}; });
if (input.paths) out.paths = input.genes.map(g => routes.map((r, i) => CM.fullPath(r, g[i])));
if (input.pathGroups) out.replay = input.pathGroups.map(group => {
  let dmin = Infinity;
  const perAircraftConflict = group.map(() => 0), pairs = [];
  for (let i = 0; i < group.length; i++) for (let j = i + 1; j < group.length; j++) {
    const s = CM.pairStats(group[i], group[j], 7, 0);
    dmin = Math.min(dmin, s.dmin); perAircraftConflict[i] += s.conflict; perAircraftConflict[j] += s.conflict;
    pairs.push({i, j, ...s});
  }
  return {dmin, perAircraftConflict, pairs};
});
if (input.ga) {
  const r = GA.runSync(routes, input.ga), e = CM.evaluate(routes, r.best, {sep: input.ga.sep ?? 7, sepV: input.ga.sepV ?? 1000, tmax: input.ga.window ?? Infinity, weights: input.ga.weights});
  out.ga = {best: r.best, n: r.genes.length, fitness: e.fitness, dmin: e.dmin, conflict: e.conflict, extra: e.extra, nMan: e.nMan, safeShare: r.dmin.filter(d => d >= (input.ga.sep ?? 7)).length / r.dmin.length};
}
process.stdout.write(JSON.stringify(out));
