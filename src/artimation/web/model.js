// Browser conflict model: a faithful port of src/artimation/conflict.py in Vector coordinates
// (x east, y SOUTH, heading clockwise from north; NM, seconds and ft).
// A route contains waypoints (xy, t, z). A maneuver is a gene [t1, t2, alpha, dz]: turn by alpha degrees at t1
// (positive means left), fly straight until t2, then head directly to the final waypoint.
// In parallel, offset altitude by dz ft at 1,500 ft/min, then return to the original altitude.
// Separation uses a cylinder; equivalent distance = max(horizontal distance, vertical difference × sep/sepV).
(function (root) {
  'use strict';
  const FT_PER_S = 25;
  const DEFAULT_WEIGHTS = Object.freeze({conflict: 1, shortfall: 10, length: 0.02, maneuver: 0.05, altitude: 0.04});
  function fitnessWeights(weights = {}) {
    if (!weights || typeof weights !== 'object' || Array.isArray(weights) || Object.keys(weights).some(k => !Object.hasOwn(DEFAULT_WEIGHTS, k))) throw new Error('Invalid fitness weights');
    const w = {...DEFAULT_WEIGHTS, ...weights};
    if (!Object.values(w).every(v => Number.isFinite(v) && v >= 0)) throw new Error('Fitness weights must be finite and nonnegative');
    return w;
  }
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const searchRight = (arr, x) => { let lo = 0, hi = arr.length; while (lo < hi) { const m = (lo + hi) >> 1; if (arr[m] <= x) lo = m + 1; else hi = m; } return lo; };
  function interp(xs, ys, x) { // np.interp: hold the endpoint values outside the interval.
    const n = xs.length;
    if (x <= xs[0]) return ys[0];
    if (x >= xs[n - 1]) return ys[n - 1];
    const k = searchRight(xs, x) - 1, d = xs[k + 1] - xs[k];
    return d > 0 ? ys[k] + (ys[k + 1] - ys[k]) * (x - xs[k]) / d : ys[k + 1];
  }
  const interpOutside0 = (xs, ys, x) => (x < xs[0] || x > xs[xs.length - 1]) ? 0 : interp(xs, ys, x);
  const uniqueSorted = arr => { const s = Float64Array.from(arr).sort(); const out = []; for (const v of s) if (!out.length || v !== out[out.length - 1]) out.push(v); return out; };

  function makeRoute(xy, t, z, enacStart = null) {
    return {xy, t, z, enacStart, x: xy.map(p => p[0]), y: xy.map(p => p[1])};
  }
  // Straight aircraft route, clipped to the W×H boundary (heading clockwise from north, y south).
  function routeFromAircraft(a, W = 120, H = 90) {
    const h = a.heading * Math.PI / 180, v = a.speed / 3600, vx = Math.sin(h) * v, vy = -Math.cos(h) * v; // NM/s
    const tx = vx > 1e-12 ? (W - a.x) / vx : vx < -1e-12 ? -a.x / vx : Infinity;
    const ty = vy > 1e-12 ? (H - a.y) / vy : vy < -1e-12 ? -a.y / vy : Infinity;
    const T = Math.max(60, Math.min(tx > 0 ? tx : Infinity, ty > 0 ? ty : Infinity, 3600));
    const z0 = a.z ?? 36000, vz = a.vz || 0;
    return makeRoute([[a.x, a.y], [a.x + vx * T, a.y + vy * T]], [0, T], [z0, z0 + vz * T / 60]);
  }
  const routeLength = r => { if (r.enacStart) return Math.hypot(r.x[r.x.length - 1] - r.enacStart[0], r.y[r.y.length - 1] - r.enacStart[1]); let s = 0; for (let i = 1; i < r.xy.length; i++) s += Math.hypot(r.x[i] - r.x[i - 1], r.y[i] - r.y[i - 1]); return s; };
  const legAt = (r, t) => clamp(searchRight(r.t, t) - 1, 0, r.t.length - 2);
  const posAt = (r, t) => [interp(r.t, r.x, t), interp(r.t, r.y, t)];
  const playbackOffset = r => r.enacStart ? r.t[0] + Math.hypot(r.enacStart[0] - r.x[0], r.enacStart[1] - r.y[0]) * (r.t[1] - r.t[0]) / Math.hypot(r.x[1] - r.x[0], r.y[1] - r.y[0]) : 0;
  const commandStart = r => r.enacStart ? playbackOffset(r) : r.t[0];

  const gene4 = g => [g[0] || 0, g[1] || 0, g[2] || 0, g[3] || 0];
  const hActive = (r, g) => { const [t1, t2, a] = gene4(g); return !(a === 0 || t2 <= t1 || t1 + 1e-9 < commandStart(r) || t1 >= r.t[r.t.length - 1]); };
  const vActive = (r, g) => { const [t1, t2, , dz] = gene4(g); return !(dz === 0 || t2 <= t1 || t1 + 1e-9 < commandStart(r) || t1 >= r.t[r.t.length - 1]); };

  function maneuverPath(r, g) {
    if (r.enacStart) return enacPath(r, g);
    if (!hActive(r, g)) return {x: r.x, y: r.y, t: r.t};
    const [t1, t2, alpha] = gene4(g), k = legAt(r, t1);
    const dx = r.x[k + 1] - r.x[k], dy = r.y[k + 1] - r.y[k], speed = Math.hypot(dx, dy) / (r.t[k + 1] - r.t[k]);
    const h = Math.atan2(dx, -dy) - alpha * Math.PI / 180; // A left turn decreases heading.
    const [px, py] = posAt(r, t1), qx = px + speed * (t2 - t1) * Math.sin(h), qy = py - speed * (t2 - t1) * Math.cos(h);
    const n = r.t.length - 1, fx = r.x[n], fy = r.y[n], x = [], y = [], t = [];
    for (let i = 0; i <= n; i++) if (r.t[i] < t1) { x.push(r.x[i]); y.push(r.y[i]); t.push(r.t[i]); }
    x.push(px, qx, fx); y.push(py, qy, fy); t.push(t1, t2, t2 + Math.hypot(fx - qx, fy - qy) / speed);
    return {x, y, t};
  }
  function enacPath(r, g) {
    const speed = Math.hypot(r.x[1] - r.x[0], r.y[1] - r.y[0]) / (r.t[1] - r.t[0]);
    const points = [r.enacStart], final = r.xy[r.xy.length - 1];
    if (hActive(r, g)) {
      const [t1, t2, alpha] = gene4(g), k = legAt(r, t1 + 1e-9);
      const h = Math.atan2(r.x[k + 1] - r.x[k], -(r.y[k + 1] - r.y[k])) - alpha * Math.PI / 180;
      const p = Math.abs(t1 - commandStart(r)) < 1e-8 ? r.enacStart : posAt(r, t1), q = [p[0] + speed * (t2 - t1) * Math.sin(h), p[1] - speed * (t2 - t1) * Math.cos(h)];
      const angle = (a, b, c) => {
        const ux = b[0] - a[0], uy = b[1] - a[1], vx = c[0] - a[0], vy = c[1] - a[1];
        if (Math.hypot(ux, uy) < 1e-12 || Math.hypot(vx, vy) < 1e-12) return 0;
        return Math.atan2(Math.abs(ux * vy - uy * vx), ux * vx + uy * vy) * 180 / Math.PI;
      };
      // Inferred ENAC pruning compares rays from the last retained point.
      if (angle(points[points.length - 1], p, q) >= 2.5) points.push(p);
      if (angle(points[points.length - 1], q, final) >= 2.5) points.push(q);
    }
    points.push(final);
    const t = [0];
    for (let i = 1; i < points.length; i++) t.push(t[i - 1] + Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]) / speed);
    return {x: points.map(p => p[0]), y: points.map(p => p[1]), t};
  }
  function verticalProfile(r, g) {
    const offset = playbackOffset(r), baseT = offset ? r.t.map(t => t - offset) : r.t;
    if (!vActive(r, g)) return {tz: baseT, z: r.z};
    const [t1, t2, , dz] = gene4(g), start = r.enacStart ? Math.max(0, t1 - offset) : t1, end = t2 - offset, ramp = Math.abs(dz) / FT_PER_S, tb = start + ramp, tc = Math.max(end, tb);
    const knots = [start, tb, tc, tc + ramp], vals = [0, dz, dz, 0], times = uniqueSorted([...baseT, ...knots]);
    return {tz: times, z: times.map(t => interp(baseT, r.z, t) + interpOutside0(knots, vals, t))};
  }
  function fullPath(r, g) { const h = maneuverPath(r, g), v = verticalProfile(r, g); return {x: h.x, y: h.y, t: h.t, tz: v.tz, z: v.z}; }
  // Timed (x, y, z) points at every horizontal or vertical slope change.
  function pathSamples(r, g) {
    const p = fullPath(r, g), end = p.t[p.t.length - 1], ts = uniqueSorted([...p.t, ...p.tz.filter(v => v >= p.t[0] && v <= end)]);
    return {t: ts, x: ts.map(t => interp(p.t, p.x, t)), y: ts.map(t => interp(p.t, p.y, t)), z: ts.map(t => interp(p.tz, p.z, t))};
  }
  // Aircraft state at time t (s) under gene g, or null outside its flight interval.
  function stateAt(r, g, t) {
    const p = fullPath(r, g);
    if (!(p.t[0] <= t && t <= p.t[p.t.length - 1])) return null;
    const k = clamp(searchRight(p.t, t) - 1, 0, p.t.length - 2), dx = p.x[k + 1] - p.x[k], dy = p.y[k + 1] - p.y[k];
    const kz = clamp(searchRight(p.tz, t) - 1, 0, Math.max(p.tz.length - 2, 0));
    const vz = p.tz.length > 1 && t < p.tz[p.tz.length - 1] ? (p.z[kz + 1] - p.z[kz]) / (p.tz[kz + 1] - p.tz[kz]) * 60 : 0;
    return {x: interp(p.t, p.x, t), y: interp(p.t, p.y, t), z: interp(p.tz, p.z, t), speed: Math.hypot(dx, dy) / (p.t[k + 1] - p.t[k]) * 3600,
            heading: ((Math.atan2(dx, -dy) * 180 / Math.PI) % 360 + 360) % 360, vz};
  }

  // Minimum equivalent distance (NM) and conflict seconds, using exact piecewise-linear relative motion.
  function pairStats(A, B, sep, sepV, tmax = Infinity) {
    const lo = Math.max(A.t[0], B.t[0]), hi = Math.min(A.t[A.t.length - 1], B.t[B.t.length - 1], tmax);
    if (hi <= lo) return {dmin: Infinity, conflict: 0};
    const ts = uniqueSorted([...A.t, ...B.t, ...A.tz, ...B.tz, lo, hi]).filter(v => v >= lo && v <= hi);
    const useV = sepV > 0, c = useV ? sep / sepV : 0;
    const P = ts.map(t => [interp(A.t, A.x, t) - interp(B.t, B.x, t), interp(A.t, A.y, t) - interp(B.t, B.y, t), interp(A.tz, A.z, t) - interp(B.tz, B.z, t)]);
    let dmin = Infinity, conflict = 0;
    for (let i = 0; i < ts.length - 1; i++) {
      const dt = ts[i + 1] - ts[i];
      if (!(dt > 0)) continue;
      const [rx, ry, z0] = P[i], dvx = (P[i + 1][0] - rx) / dt, dvy = (P[i + 1][1] - ry) / dt, dzv = (P[i + 1][2] - z0) / dt;
      const aa = dvx * dvx + dvy * dvy, bb = rx * dvx + ry * dvy, r2 = rx * rx + ry * ry;
      const f = tau => Math.max(Math.hypot(rx + dvx * tau, ry + dvy * tau), c * Math.abs(z0 + dzv * tau));
      const cand = [0, dt, aa > 1e-12 ? clamp(-bb / aa, 0, dt) : 0];
      if (useV) {
        cand.push(Math.abs(dzv) > 1e-12 ? clamp(-z0 / dzv, 0, dt) : 0);
        const qa = aa - c * c * dzv * dzv, qb = bb - c * c * z0 * dzv, qc = r2 - c * c * z0 * z0, sq = Math.sqrt(Math.max(0, qb * qb - qa * qc));
        const lin = Math.abs(qb) > 1e-12 ? -qc / (2 * qb) : 0;
        for (const sg of [-1, 1]) cand.push(clamp(Math.abs(qa) > 1e-12 ? (-qb + sg * sq) / qa : lin, 0, dt));
      }
      for (const tau of cand) dmin = Math.min(dmin, f(tau));
      const b2 = 2 * bb, cc = r2 - sep * sep, disc = b2 * b2 - 4 * aa * cc;
      let hlo = 0, hhi = 0;
      if (aa > 1e-12) { if (disc > 0) { const sq = Math.sqrt(disc); hlo = clamp((-b2 - sq) / (2 * aa), 0, dt); hhi = clamp((-b2 + sq) / (2 * aa), 0, dt); } }
      else hhi = cc < 0 ? dt : 0;
      let vlo = 0, vhi = dt;
      if (useV) {
        if (Math.abs(dzv) > 1e-12) { const s1 = (-sepV - z0) / dzv, s2 = (sepV - z0) / dzv; vlo = clamp(Math.min(s1, s2), 0, dt); vhi = clamp(Math.max(s1, s2), 0, dt); }
        else { vlo = 0; vhi = Math.abs(z0) < sepV ? dt : 0; }
      }
      conflict += Math.max(0, Math.min(hhi, vhi) - Math.max(hlo, vlo));
    }
    return {dmin, conflict};
  }

  // Evaluate one gene per aircraft. Maximize fitness ∈ (0, 1]. Options: {sep, sepV, tmax}.
  function evaluate(routes, genes, opts) {
    const n = routes.length;
    if (!Array.isArray(genes) || genes.length !== n || genes.some(g => !Array.isArray(g) || ![3, 4].includes(g.length) || !g.every(Number.isFinite)))
      throw new Error('Each aircraft requires a finite gene with 3 or 4 components');
    const paths = routes.map((r, i) => fullPath(r, genes[i]));
    const maneuvers = routes.map((r, i) => ({active: (r.enacStart ? paths[i].x.length > 2 : hActive(r, genes[i])) || vActive(r, genes[i]),
      altitude: vActive(r, genes[i]) ? Math.abs(gene4(genes[i])[3]) : 0}));
    return scorePaths(routes, paths, opts, maneuvers);
  }

  // Controllers can execute several commands; evaluate their actual paths without inventing genes.
  function evaluatePaths(routes, paths, opts) {
    if (!Array.isArray(paths) || paths.length !== routes.length || !paths.length) throw new Error('Each aircraft requires a timed path');
    paths.forEach(p => {
      if (!p || !['x', 'y', 't', 'tz', 'z'].every(k => Array.isArray(p[k]) && p[k].length >= 2 && p[k].every(Number.isFinite)) ||
          p.x.length !== p.t.length || p.y.length !== p.t.length || p.z.length !== p.tz.length ||
          !p.t.every((t, i) => !i || t > p.t[i - 1]) || !p.tz.every((t, i) => !i || t > p.tz[i - 1]))
        throw new Error('Path coordinates must be finite with strictly increasing times');
    });
    const maneuvers = paths.map((p, i) => {
      const r = routes[i], altitude = Math.max(...p.tz.map((t, k) => Math.abs(p.z[k] - interp(r.t, r.z, t))));
      const changed = p.t.some((t, k) => Math.hypot(p.x[k] - interp(r.t, r.x, t), p.y[k] - interp(r.t, r.y, t)) > 1e-7);
      return {active: changed || altitude > 1e-7, altitude};
    });
    return scorePaths(routes, paths, opts, maneuvers);
  }

  function scorePaths(routes, paths, opts, maneuvers) {
    const {sep = 7, sepV = 1000, tmax = Infinity} = opts || {}, n = routes.length, w = fitnessWeights(opts?.weights);
    const pair = Array.from({length: n}, () => new Array(n).fill(Infinity));
    let conflict = 0, minPair = Infinity;
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
      const s = pairStats(paths[i], paths[j], sep, sepV, tmax);
      pair[i][j] = pair[j][i] = s.dmin; conflict += s.conflict; minPair = Math.min(minPair, s.dmin);
    }
    let extra = 0, nMan = 0, alt = 0;
    routes.forEach((r, i) => {
      const p = paths[i]; let len = 0; for (let k = 1; k < p.x.length; k++) len += Math.hypot(p.x[k] - p.x[k - 1], p.y[k] - p.y[k - 1]);
      extra += Math.max(0, len - routeLength(r));
      if (maneuvers[i].active) nMan++;
      alt += maneuvers[i].altitude;
    });
    const shortfall = Number.isFinite(minPair) ? Math.max(0, sep - minPair) : 0;
    const penalty = w.conflict * conflict + w.shortfall * shortfall + w.length * extra + w.maneuver * nMan + w.altitude * alt / 1000;
    const perAircraft = pair.map((row, i) => Math.min(...row.filter((_, j) => j !== i)));
    // Separate score ranges ensure that any safe solution outranks every conflicting solution.
    const safe = conflict === 0 && shortfall === 0, score = 0.5 / (1 + penalty);
    // Preserve strict safety ordering even with zero weights or floating-point saturation.
    const fitness = safe ? Math.max(0.5 + Number.EPSILON, 0.5 + score) : Math.min(0.5 - Number.EPSILON, score);
    return {pair, perAircraft, dmin: minPair, conflict, extra, nMan, alt, fitness};
  }

  // English instructions for each aircraft.
  function instructions(routes, ids, genes) {
    return routes.map((r, i) => {
      const [t1, t2, a, dz] = gene4(genes[i]), h = hActive(r, genes[i]), v = vActive(r, genes[i]), parts = [];
      if (!h && !v && !r.enacStart) return `${ids[i]}: route unchanged.`;
      if (r.enacStart) {
        const p = maneuverPath(r, genes[i]), turns = p.t.slice(1, -1);
        parts.push(turns.length ? `follow the reconstructed ENAC path; turn at ${turns.map(t => `t+${t.toFixed(1)} s`).join(' and ')}, then fly directly to the final waypoint` : 'fly directly to the final waypoint (ENAC path simplification)');
      } else if (h) parts.push(`turn ${Math.abs(a).toFixed(0)}° ${a > 0 ? 'left' : 'right'} at t+${t1.toFixed(0)} s, then head directly to the final waypoint at t+${t2.toFixed(0)} s`);
      if (v) parts.push(`${dz > 0 ? 'climb' : 'descend'} ${Math.abs(dz).toFixed(0)} ft at t+${(t1 - playbackOffset(r)).toFixed(0)} s, then start returning to the original route altitude at t+${(Math.max(t2, t1 + Math.abs(dz) / FT_PER_S) - playbackOffset(r)).toFixed(0)} s`);
      return `${ids[i]}: ${parts.join('; ')}.`;
    });
  }

  root.ConflictModel = {FT_PER_S, DEFAULT_WEIGHTS, fitnessWeights, makeRoute, routeFromAircraft, routeLength, maneuverPath, verticalProfile, fullPath, pathSamples, stateAt, pairStats, evaluate, evaluatePaths, instructions, interp, hActive, vActive, clamp, commandStart};
  if (typeof module !== 'undefined' && module.exports) module.exports = root.ConflictModel;
})(typeof globalThis !== 'undefined' ? globalThis : this);
