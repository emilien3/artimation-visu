// Exécute model.js + ga.js (JS de l'app) dans un contexte vm isolé. Entrée JSON sur stdin :
//   {routes:[{xy,t,z}], genes:[[[t1,t2,alpha,dz]...]...], opts:{sep,sepV,tmax}}  -> évaluations
//   {routes, ga:{...options}}                                                    -> résultat du GA (meilleure solution)
const fs = require('fs'), vm = require('vm'), path = require('path');
const dir = process.argv[2] || path.join(__dirname, '..', 'src', 'artimation', 'web');
const ctx = vm.createContext({console, Math, Float64Array, Float32Array, Object, Number, JSON, Infinity});
ctx.globalThis = ctx;
for (const f of ['model.js', 'ga.js']) vm.runInContext(fs.readFileSync(path.join(dir, f), 'utf8'), ctx, {filename: f});
const input = JSON.parse(fs.readFileSync(0, 'utf8'));
const CM = ctx.ConflictModel, GA = ctx.GeneticSolver;
const routes = input.routes.map(r => CM.makeRoute(r.xy, r.t, r.z));
const out = {};
if (input.genes) out.evals = input.genes.map(g => { const e = CM.evaluate(routes, g, input.opts); return {pair: e.pair.map(r => r.map(v => Number.isFinite(v) ? v : null)), conflict: e.conflict, extra: e.extra, nMan: e.nMan, fitness: e.fitness, dmin: e.dmin}; });
if (input.ga) {
  const r = GA.runSync(routes, input.ga), e = CM.evaluate(routes, r.best, {sep: input.ga.sep ?? 7, sepV: input.ga.sepV ?? 1000, tmax: input.ga.window ?? 600});
  out.ga = {best: r.best, n: r.genes.length, fitness: e.fitness, dmin: e.dmin, conflict: e.conflict, extra: e.extra, nMan: e.nMan, safeShare: r.dmin.filter(d => d >= (input.ga.sep ?? 7)).length / r.dmin.length};
}
process.stdout.write(JSON.stringify(out));
