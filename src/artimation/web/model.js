// Moteur de conflit côté navigateur : portage fidèle de src/artimation/conflict.py, dans le repère de l'outil Vector
// (x vers la droite, y vers le BAS, cap en degrés horaire depuis le nord, NM, secondes, ft).
// Une route = waypoints (xy, t, z). Une manœuvre = gène [t1, t2, alpha, dz] : à t1 virage de alpha° (positif = à gauche), vol droit jusqu'à t2,
// retour direct au dernier waypoint ; en parallèle changement de niveau de dz ft (1 500 ft/min) puis retour au niveau initial.
// Séparation = cylindre sep NM × sepV ft ; distance « équivalente » = max(horizontale, verticale × sep/sepV).
(function (root) {
  'use strict';
  const FT_PER_S = 25, W_CONFLICT = 1, W_LENGTH = 0.02, W_MANEUVER = 0.05, W_ALT = 0.04;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const searchRight = (arr, x) => { let lo = 0, hi = arr.length; while (lo < hi) { const m = (lo + hi) >> 1; if (arr[m] <= x) lo = m + 1; else hi = m; } return lo; };
  function interp(xs, ys, x) { // np.interp : plateaux aux extrémités
    const n = xs.length;
    if (x <= xs[0]) return ys[0];
    if (x >= xs[n - 1]) return ys[n - 1];
    const k = searchRight(xs, x) - 1, d = xs[k + 1] - xs[k];
    return d > 0 ? ys[k] + (ys[k + 1] - ys[k]) * (x - xs[k]) / d : ys[k + 1];
  }
  const interpOutside0 = (xs, ys, x) => (x < xs[0] || x > xs[xs.length - 1]) ? 0 : interp(xs, ys, x);
  const uniqueSorted = arr => { const s = Float64Array.from(arr).sort(); const out = []; for (const v of s) if (!out.length || v !== out[out.length - 1]) out.push(v); return out; };

  function makeRoute(xy, t, z) {
    return {xy, t, z, x: xy.map(p => p[0]), y: xy.map(p => p[1])};
  }
  // Avion en route directe (repère Vector : vitesse en NM/min = speed/60 ; cap horaire depuis le nord, y vers le bas)
  function routeFromAircraft(a, T = 3600) {
    const h = a.heading * Math.PI / 180, v = a.speed / 3600; // NM/s
    const z0 = a.z ?? 36000, vz = a.vz || 0;
    return makeRoute([[a.x, a.y], [a.x + Math.sin(h) * v * T, a.y - Math.cos(h) * v * T]], [0, T], [z0, z0 + vz * T / 60]);
  }
  const routeLength = r => { let s = 0; for (let i = 1; i < r.xy.length; i++) s += Math.hypot(r.x[i] - r.x[i - 1], r.y[i] - r.y[i - 1]); return s; };
  const legAt = (r, t) => clamp(searchRight(r.t, t) - 1, 0, r.t.length - 2);
  const posAt = (r, t) => [interp(r.t, r.x, t), interp(r.t, r.y, t)];

  const gene4 = g => [g[0] || 0, g[1] || 0, g[2] || 0, g[3] || 0];
  const hActive = (r, g) => { const [t1, t2, a] = gene4(g); return !(a === 0 || t2 <= t1 || t1 < r.t[0] || t1 >= r.t[r.t.length - 1]); };
  const vActive = (r, g) => { const [t1, t2, , dz] = gene4(g); return !(dz === 0 || t2 <= t1 || t1 < r.t[0] || t1 >= r.t[r.t.length - 1]); };

  function maneuverPath(r, g) {
    if (!hActive(r, g)) return {x: r.x, y: r.y, t: r.t};
    const [t1, t2, alpha] = gene4(g), k = legAt(r, t1);
    const dx = r.x[k + 1] - r.x[k], dy = r.y[k + 1] - r.y[k], speed = Math.hypot(dx, dy) / (r.t[k + 1] - r.t[k]);
    const h = Math.atan2(dx, -dy) - alpha * Math.PI / 180; // virage à gauche = cap qui diminue
    const [px, py] = posAt(r, t1), qx = px + speed * (t2 - t1) * Math.sin(h), qy = py - speed * (t2 - t1) * Math.cos(h);
    const n = r.t.length - 1, fx = r.x[n], fy = r.y[n], x = [], y = [], t = [];
    for (let i = 0; i <= n; i++) if (r.t[i] < t1) { x.push(r.x[i]); y.push(r.y[i]); t.push(r.t[i]); }
    x.push(px, qx, fx); y.push(py, qy, fy); t.push(t1, t2, t2 + Math.hypot(fx - qx, fy - qy) / speed);
    return {x, y, t};
  }
  function verticalProfile(r, g) {
    if (!vActive(r, g)) return {tz: r.t, z: r.z};
    const [t1, t2, , dz] = gene4(g), ramp = Math.abs(dz) / FT_PER_S, tb = t1 + ramp, tc = Math.max(t2, tb);
    const knots = [t1, tb, tc, tc + ramp], vals = [0, dz, dz, 0], times = uniqueSorted([...r.t, ...knots]);
    return {tz: times, z: times.map(t => interp(r.t, r.z, t) + interpOutside0(knots, vals, t))};
  }
  function fullPath(r, g) { const h = maneuverPath(r, g), v = verticalProfile(r, g); return {x: h.x, y: h.y, t: h.t, tz: v.tz, z: v.z}; }
  // Points (x, y, z, t) à chaque instant où la trajectoire change de direction ou de pente verticale
  function pathSamples(r, g) {
    const p = fullPath(r, g), end = p.t[p.t.length - 1], ts = uniqueSorted([...p.t, ...p.tz.filter(v => v <= end)]);
    return {t: ts, x: ts.map(t => interp(p.t, p.x, t)), y: ts.map(t => interp(p.t, p.y, t)), z: ts.map(t => interp(p.tz, p.z, t))};
  }
  // État d'un avion à l'instant t (s) sous le gène g, ou null s'il n'est pas en vol
  function stateAt(r, g, t) {
    const p = fullPath(r, g);
    if (!(p.t[0] <= t && t <= p.t[p.t.length - 1])) return null;
    const k = clamp(searchRight(p.t, t) - 1, 0, p.t.length - 2), dx = p.x[k + 1] - p.x[k], dy = p.y[k + 1] - p.y[k];
    const kz = clamp(searchRight(p.tz, t) - 1, 0, Math.max(p.tz.length - 2, 0));
    const vz = p.tz.length > 1 && t < p.tz[p.tz.length - 1] ? (p.z[kz + 1] - p.z[kz]) / (p.tz[kz + 1] - p.tz[kz]) * 60 : 0;
    return {x: interp(p.t, p.x, t), y: interp(p.t, p.y, t), z: interp(p.tz, p.z, t), speed: Math.hypot(dx, dy) / (p.t[k + 1] - p.t[k]) * 3600,
            heading: ((Math.atan2(dx, -dy) * 180 / Math.PI) % 360 + 360) % 360, vz};
  }

  // Distance équivalente minimale (NM) et secondes de conflit entre deux trajectoires complètes (exact : mouvement relatif linéaire par morceaux)
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

  // Évalue une solution (un gène par avion). fitness ∈ (0, 1], à maximiser. opts : {sep, sepV, tmax}
  function evaluate(routes, genes, opts) {
    const {sep = 7, sepV = 1000, tmax = Infinity} = opts || {}, n = routes.length;
    const paths = routes.map((r, i) => fullPath(r, genes[i]));
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
      const h = hActive(r, genes[i]), v = vActive(r, genes[i]);
      if (h || v) nMan++;
      if (v) alt += Math.abs(gene4(genes[i])[3]);
    });
    const shortfall = Number.isFinite(minPair) ? Math.max(0, sep - minPair) : 0;
    const penalty = W_CONFLICT * (conflict + 10 * shortfall) + W_LENGTH * extra + W_MANEUVER * nMan + W_ALT * alt / 1000;
    const perAircraft = pair.map((row, i) => Math.min(...row.filter((_, j) => j !== i)));
    return {pair, perAircraft, dmin: minPair, conflict, extra, nMan, alt, fitness: 1 / (1 + penalty)};
  }

  // Consignes (français) pour chaque avion
  function instructions(routes, ids, genes) {
    return routes.map((r, i) => {
      const [t1, t2, a, dz] = gene4(genes[i]), h = hActive(r, genes[i]), v = vActive(r, genes[i]), parts = [];
      if (!h && !v) return `${ids[i]} : route inchangée.`;
      if (h) parts.push(`virer de ${Math.abs(a).toFixed(0)}° à ${a > 0 ? 'gauche' : 'droite'} à t+${t1.toFixed(0)} s, puis rejoindre directement le dernier point de la route à t+${t2.toFixed(0)} s`);
      if (v) parts.push(`${dz > 0 ? 'monter' : 'descendre'} de ${Math.abs(dz).toFixed(0)} ft à t+${t1.toFixed(0)} s, puis revenir au niveau initial à t+${t2.toFixed(0)} s`);
      return `${ids[i]} : ${parts.join(' ; ')}.`;
    });
  }

  root.ConflictModel = {FT_PER_S, makeRoute, routeFromAircraft, routeLength, maneuverPath, verticalProfile, fullPath, pathSamples, stateAt, pairStats, evaluate, instructions, interp, hActive, vActive, clamp};
  if (typeof module !== 'undefined' && module.exports) module.exports = root.ConflictModel;
})(typeof globalThis !== 'undefined' ? globalThis : this);
