// Run Vector JS (physics + density) in an isolated VM context (no file/network access) and print JSON results.
// Oracle for the app JS (src/artimation/web/).
// Usage: node scripts/vector_oracle.js <js_directory> < input.json    (input: aircraft, horizon, separation, sepV?, density?)
const fs = require('fs'), vm = require('vm'), path = require('path');
const dir = process.argv[2];
const ctx = vm.createContext({console, Math, Float64Array, Float32Array, Uint8ClampedArray, Int8Array, Map, Object, Number, JSON});
ctx.globalThis = ctx;
const files = fs.readdirSync(dir).filter(n => /^(physics|density)(_.*)?\.js$/.test(n)).sort((a, b) => a.startsWith('physics') ? -1 : 1);
for (const f of files) vm.runInContext(fs.readFileSync(path.join(dir, f), 'utf8'), ctx, {filename: f});
const input = JSON.parse(fs.readFileSync(0, 'utf8'));
const M = ctx.FlightMath, D = ctx.FlightDensity, sepV = input.sepV;
const out = {
  analyze: M.analyze(input.aircraft, input.horizon, input.separation, sepV),
  headingSpace: Object.fromEntries(input.aircraft.map(a => [a.id, M.headingSpace(input.aircraft, a.id, input.horizon, input.separation, sepV)])),
};
if (input.density) {
  const it = D.buildMaps(input.aircraft, {...input.density, horizon: input.horizon, separation: input.separation, sepV, retainMaps: false});
  let item; do { item = it.next(); } while (!item.done);
  const r = item.value;
  out.density = {cols: r.cols, rows: r.rows, positive: Array.from(r.positive), negative: Array.from(r.negative), signed: Array.from(r.signed)};
}
process.stdout.write(JSON.stringify(out));
