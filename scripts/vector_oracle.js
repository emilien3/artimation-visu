// Exécute le JS ORIGINAL de Vector (physics + density) dans un contexte vm isolé (aucun accès fichier/réseau)
// et imprime en JSON ses résultats. Usage : node scripts/vector_oracle.js <dossier_js> < entrée.json
const fs = require('fs'), vm = require('vm'), path = require('path');
const dir = process.argv[2];
const ctx = vm.createContext({console, Math, Float64Array, Float32Array, Uint8ClampedArray, Int8Array, Map, Object, Number, JSON});
ctx.globalThis = ctx;
for (const f of fs.readdirSync(dir).filter(n => /^(physics|density)_.*\.js$/.test(n) && !n.startsWith('density-view')).sort((a, b) => a.startsWith('physics') ? -1 : 1))
  vm.runInContext(fs.readFileSync(path.join(dir, f), 'utf8'), ctx, {filename: f});
const input = JSON.parse(fs.readFileSync(0, 'utf8'));
const M = ctx.FlightMath, D = ctx.FlightDensity;
const out = {
  analyze: M.analyze(input.aircraft, input.horizon, input.separation),
  headingSpace: Object.fromEntries(input.aircraft.map(a => [a.id, M.headingSpace(input.aircraft, a.id, input.horizon, input.separation)])),
};
if (input.density) {
  const it = D.buildMaps(input.aircraft, {...input.density, horizon: input.horizon, separation: input.separation, retainMaps: false});
  let item; do { item = it.next(); } while (!item.done);
  const r = item.value;
  out.density = {cols: r.cols, rows: r.rows, positive: Array.from(r.positive), negative: Array.from(r.negative), signed: Array.from(r.signed)};
}
process.stdout.write(JSON.stringify(out));
