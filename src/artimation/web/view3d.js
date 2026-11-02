// Vue 3D : projection orthographique sur <canvas>, avec orbite (glisser), zoom (molette) et sélection/déplacement des avions dans un plan horizontal.
// Mêmes couches que la vue 2D : seule la projection change. Axe vertical : altitude, temps ou relief de densité.
(function (root) {
  'use strict';
  const NMW = 120, NMH = 90, ZH = 55;            // zone de l'outil (NM) et hauteur visuelle de la boîte 3D
  const COLORS = ['#64dfcb', '#ffb86b', '#b39dff', '#5ec8ff', '#e6e36a', '#ff8fb5', '#9aa9b5', '#c49a6c'];
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  class View3D {
    constructor(canvas, hooks) {
      this.cv = canvas; this.ctx = canvas.getContext('2d'); this.hooks = hooks || {};
      this.az = -0.55; this.el = 0.62; this.zoom = 1; this.data = null; this.hits = []; this.orbit = null;
      canvas.addEventListener('pointerdown', e => this.down(e)); canvas.addEventListener('pointermove', e => this.move(e));
      const up = () => { this.orbit = null; }; canvas.addEventListener('pointerup', up); canvas.addEventListener('pointercancel', up);
      canvas.addEventListener('wheel', e => { e.preventDefault(); this.zoom = clamp(this.zoom * Math.exp(-e.deltaY * 0.001), 0.4, 4); this.render(); }, {passive: false});
    }
    // ---- caméra
    size() {
      const r = this.cv.getBoundingClientRect(), d = window.devicePixelRatio || 1;
      if (this.cv.width !== Math.round(r.width * d) || this.cv.height !== Math.round(r.height * d)) { this.cv.width = Math.round(r.width * d); this.cv.height = Math.round(r.height * d); }
      this.w = r.width; this.h = r.height; this.dpr = d;
      this.scale = Math.min(this.w / 235, this.h / 165) * this.zoom;
    }
    // monde (x, y vers le bas, zv visuel) -> écran + profondeur
    proj(x, y, zv) {
      const X = x - NMW / 2, Y = -(y - NMH / 2), Z = zv - ZH / 2, ca = Math.cos(this.az), sa = Math.sin(this.az), ce = Math.cos(this.el), se = Math.sin(this.el);
      const x1 = X * ca - Y * sa, y1 = X * sa + Y * ca;
      return [this.w / 2 + x1 * this.scale, this.h / 2 - (y1 * se + Z * ce) * this.scale, y1 * ce - Z * se];
    }
    // écran -> point (x, y) du plan horizontal de hauteur visuelle zv
    unproject(px, py, zv) {
      const Z = zv - ZH / 2, ca = Math.cos(this.az), sa = Math.sin(this.az), ce = Math.cos(this.el), se = Math.sin(this.el);
      const x1 = (px - this.w / 2) / this.scale, y1 = ((this.h / 2 - py) / this.scale - Z * ce) / se;
      return {x: x1 * ca + y1 * sa + NMW / 2, y: -(-x1 * sa + y1 * ca) + NMH / 2};
    }
    local(e) { const r = this.cv.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; }

    // ---- mise à l'échelle verticale
    scaleZ() {
      const d = this.data, ax = d.axis;
      if (ax === 'time') { const tm = d.tmax; return {zv: (t, ft) => t / tm * ZH, label: 'temps (s)', ticks: [0, 0.25, 0.5, 0.75, 1].map(f => [f * tm, Math.round(f * tm) + ' s']), floor: 0, tmax: tm}; }
      if (ax === 'relief') return {zv: () => ZH * 0.55, label: 'densité (relief)', ticks: [], floor: ZH * 0.45};
      const lo = d.altMin, hi = d.altMax, step = hi - lo <= 8000 ? 1000 : 2000, ticks = [];
      for (let v = Math.ceil(lo / step) * step; v <= hi; v += step) ticks.push([v, 'FL' + Math.round(v / 100)]);
      return {zv: (t, ft) => (ft - lo) / (hi - lo) * ZH, label: 'altitude', ticks, floor: 0, lo, hi};
    }
    markerZ(a, sz) { const d = this.data; return d.axis === 'time' ? sz.zv(d.time * 60, a.z) : d.axis === 'relief' ? ZH * 0.55 : sz.zv(0, a.z); }

    // ---- dessin
    setData(d) { this.data = d; this.render(); }
    render() {
      if (!this.data) return;
      this.size(); const c = this.ctx, d = this.data, sz = this.scaleZ(); this.sz = sz;
      c.setTransform(this.dpr, 0, 0, this.dpr, 0, 0); c.clearRect(0, 0, this.w, this.h);
      this.hits = [];
      this.drawBox(c, sz);
      this.drawFloor(c, d, sz);
      this.drawLayers(c, d, sz);
      this.drawLegend(c, d);
    }
    line(c, pts, color, width, dash) {
      c.beginPath(); pts.forEach((p, i) => (i ? c.lineTo(p[0], p[1]) : c.moveTo(p[0], p[1])));
      c.strokeStyle = color; c.lineWidth = width; c.setLineDash(dash || []); c.stroke(); c.setLineDash([]);
    }
    drawBox(c, sz) {
      const fl = sz.floor, corners = [[0, 0], [NMW, 0], [NMW, NMH], [0, NMH]];
      for (let k = 0; k <= 12; k++) { // grille du plancher tous les 10 NM
        this.line(c, [this.proj(k * 10, 0, fl), this.proj(k * 10, NMH, fl)], 'rgba(120,160,180,.14)', 1);
        if (k <= 9) this.line(c, [this.proj(0, k * 10, fl), this.proj(NMW, k * 10, fl)], 'rgba(120,160,180,.14)', 1);
      }
      this.line(c, [...corners, corners[0]].map(p => this.proj(p[0], p[1], fl)), 'rgba(150,190,210,.55)', 1.5);
      if (this.data.axis !== 'relief') {
        for (const p of [[0, 0], [NMW, 0], [NMW, NMH], [0, NMH]]) this.line(c, [this.proj(p[0], p[1], fl), this.proj(p[0], p[1], ZH)], 'rgba(150,190,210,.18)', 1);
        this.line(c, [...corners, corners[0]].map(p => this.proj(p[0], p[1], ZH)), 'rgba(150,190,210,.18)', 1);
      }
      c.fillStyle = '#879aaa'; c.font = '11px Inter,Arial,sans-serif'; c.textAlign = 'left';
      // graduations verticales sur l'arête avant-gauche (la plus proche en x/y écran minimal)
      const edge = [[0, 0], [NMW, 0], [NMW, NMH], [0, NMH]].map(p => ({p, s: this.proj(p[0], p[1], fl)})).sort((a, b) => a.s[0] - b.s[0])[0].p;
      for (const [val, text] of sz.ticks) { const zv = this.data.axis === 'time' ? val / sz.tmax * ZH : (val - sz.lo) / (sz.hi - sz.lo) * ZH, q = this.proj(edge[0], edge[1], zv); c.fillText(text, q[0] - 44, q[1] + 4); this.line(c, [[q[0] - 6, q[1]], [q[0], q[1]]], '#879aaa', 1); }
      const n = this.proj(NMW / 2, 0, fl); c.fillStyle = '#9bb'; c.textAlign = 'center'; c.fillText('N ↑', n[0], n[1] - 8);
    }
    drawFloor(c, d, sz) {
      const bg = d.bg; if (!bg) return;
      const sx = Math.max(1, Math.round(bg.cols / 80)), sy = Math.max(1, Math.round(bg.rows / 60)), relief = d.axis === 'relief';
      const nc = Math.floor(bg.cols / sx), nr = Math.floor(bg.rows / sy), dx = NMW / nc, dy = NMH / nr, quads = [];
      const cell = (i, j) => { const ci = Math.min(bg.cols - 1, i * sx + (sx >> 1)), cj = Math.min(bg.rows - 1, j * sy + (sy >> 1)); return cj * bg.cols + ci; };
      const height = idx => (relief && bg.signed ? (Number.isFinite(bg.signedNorm[idx]) ? bg.signedNorm[idx] : 0) * ZH * 0.42 + ZH * 0.45 : sz.floor);
      for (let j = 0; j < nr; j++) for (let i = 0; i < nc; i++) {
        const idx = cell(i, j), a = bg.pixels[idx * 4 + 3];
        if (!a) continue;
        const zz = height(idx), pts = [[i * dx, j * dy], [(i + 1) * dx, j * dy], [(i + 1) * dx, (j + 1) * dy], [i * dx, (j + 1) * dy]].map(p => this.proj(p[0], p[1], zz));
        quads.push({pts, depth: (pts[0][2] + pts[2][2]) / 2, rgba: [bg.pixels[idx * 4], bg.pixels[idx * 4 + 1], bg.pixels[idx * 4 + 2], relief ? 1 : 0.62]});
      }
      quads.sort((p, q) => q.depth - p.depth);
      for (const q of quads) { c.beginPath(); q.pts.forEach((p, k) => (k ? c.lineTo(p[0], p[1]) : c.moveTo(p[0], p[1]))); c.closePath(); c.fillStyle = `rgba(${q.rgba[0]},${q.rgba[1]},${q.rgba[2]},${q.rgba[3]})`; c.fill(); }
    }
    drawPath(c, s, color, width, dash, sz) {
      const d = this.data, relief = d.axis === 'relief', pts = [];
      for (let k = 0; k < s.t.length; k++) pts.push(this.proj(s.x[k], s.y[k], relief ? ZH * 0.55 + 2 : sz.zv(s.t[k], s.z[k])));
      this.line(c, pts, color, width, dash);
    }
    circle(c, cx, cy, r, zv, color, width) { const pts = []; for (let k = 0; k <= 40; k++) { const a = k / 40 * 2 * Math.PI; pts.push(this.proj(cx + r * Math.cos(a), cy + r * Math.sin(a), zv)); } this.line(c, pts, color, width, [4, 4]); }
    drawLayers(c, d, sz) {
      const L = d.layers, relief = d.axis === 'relief';
      d.routes.forEach((s, i) => L.routes && s && this.drawPath(c, s, 'rgba(160,175,185,.55)', 1.5, [3, 5], sz));
      d.solution.forEach((s, i) => L.solution && s && this.drawPath(c, s, d.colors[i % d.colors.length], 3.2, null, sz));
      // aperçu de projection des avions (vecteur vitesse extrapolé sur l'horizon), comme dans la vue 2D
      const items = d.aircraft.map(a => ({a, p: this.proj(a.x, a.y, this.markerZ(a, sz)), z: this.markerZ(a, sz)}));
      items.sort((p, q) => q.p[2] - p.p[2]);
      for (const {a, p, z} of items) {
        const col = a.selected ? '#ffcb78' : d.colors[d.ids.indexOf(a.id) % d.colors.length] || '#64dfcb';
        if (L.zones) {
          if (d.axis === 'alt' && d.sepV > 0) {
            const zl = sz.zv(0, a.z - d.sepV), zu = sz.zv(0, a.z + d.sepV);
            this.circle(c, a.x, a.y, d.sep, zl, col, 1); this.circle(c, a.x, a.y, d.sep, zu, col, 1);
            for (let k = 0; k < 4; k++) { const an = k * Math.PI / 2; this.line(c, [this.proj(a.x + d.sep * Math.cos(an), a.y + d.sep * Math.sin(an), zl), this.proj(a.x + d.sep * Math.cos(an), a.y + d.sep * Math.sin(an), zu)], col, 1); }
          } else this.circle(c, a.x, a.y, d.sep, z, col, 1);
        }
        if (L.aircraft) {
          const h = a.heading * Math.PI / 180, len = a.speed / 60 * 3, ex = a.x + Math.sin(h) * len, ey = a.y - Math.cos(h) * len;
          const ez = d.axis === 'alt' ? sz.zv(0, a.z + a.vz * 3) : d.axis === 'time' ? sz.zv((d.time + 3) * 60, a.z) : z, tip = this.proj(ex, ey, ez);
          this.line(c, [p, tip], col, 2.5);
          c.beginPath(); c.arc(tip[0], tip[1], 5, 0, 7); c.fillStyle = '#0b121b'; c.fill(); c.strokeStyle = col; c.lineWidth = 2; c.stroke();
          const floorP = this.proj(a.x, a.y, sz.floor); if (d.axis !== 'relief') this.line(c, [floorP, p], 'rgba(255,203,120,.3)', 1, [2, 4]);
          this.symbol(c, p, Math.atan2(tip[0] - p[0], -(tip[1] - p[1])) * 180 / Math.PI, col, a.selected);
          c.fillStyle = col; c.font = '12px Inter,Arial,sans-serif'; c.textAlign = 'left'; c.fillText(a.id, p[0] + 14, p[1] - 8);
          c.fillStyle = '#879aaa'; c.font = '10.5px Inter,Arial,sans-serif'; c.fillText(`FL${Math.round(a.z / 100)} · ${Math.round(a.speed)} kt`, p[0] + 14, p[1] + 5);
          this.hits.push({id: a.id, kind: 'velocity', x: tip[0], y: tip[1], r: 14, zv: ez}, {id: a.id, kind: 'position', x: p[0], y: p[1], r: 17, zv: z});
        }
      }
      (d.encounters || []).forEach(e => { // rapprochements (croisement des routes et approches minimales)
        if (!e.risk) return; const za = d.axis === 'alt' ? sz.zv(0, e.za) : d.axis === 'time' ? sz.zv((d.time + e.t) * 60, 0) : ZH * 0.55;
        this.line(c, [this.proj(e.pa.x, e.pa.y, d.axis === 'alt' ? sz.zv(0, e.za) : za), this.proj(e.pb.x, e.pb.y, d.axis === 'alt' ? sz.zv(0, e.zb) : za)], '#ff8c83', 2, [3, 4]);
      });
    }
    symbol(c, p, heading, color, selected) {
      c.save(); c.translate(p[0], p[1]); c.rotate(heading * Math.PI / 180);
      c.beginPath(); c.moveTo(0, -11); c.lineTo(3, -3); c.lineTo(11, 3); c.lineTo(11, 6); c.lineTo(3, 3); c.lineTo(3, 9); c.lineTo(6, 12); c.lineTo(0, 10); c.lineTo(-6, 12); c.lineTo(-3, 9); c.lineTo(-3, 3); c.lineTo(-11, 6); c.lineTo(-11, 3); c.lineTo(-3, -3); c.closePath();
      c.fillStyle = color; c.fill(); if (selected) { c.strokeStyle = '#ffcb78'; c.lineWidth = 1.5; c.beginPath(); c.arc(0, 0, 17, 0, 7); c.stroke(); } c.restore();
    }
    drawLegend(c, d) {
      c.fillStyle = '#879aaa'; c.font = '11px Inter,Arial,sans-serif'; c.textAlign = 'left';
      c.fillText('Glisser : tourner · Molette : zoom · Glisser un avion : le déplacer (plan horizontal)', 12, this.h - 10);
      c.textAlign = 'right'; c.fillText(`axe vertical : ${d.axis === 'alt' ? 'altitude' : d.axis === 'time' ? 'temps' : 'relief de densité'}`, this.w - 12, this.h - 10);
    }
    // ---- interaction
    hit(px, py) { let best = null, bd = 1e9; for (const h of this.hits) { const dd = Math.hypot(px - h.x, py - h.y); if (dd <= h.r && dd < bd) { best = h; bd = dd; } } return best; }
    down(e) {
      if (e.button !== 0 || !this.data) return;
      const [px, py] = this.local(e), h = this.hooks;
      if (this.data.placing) { const p = this.unproject(px, py, this.sz.zv(0, 36000)); h.onPlace && h.onPlace(p); return; }
      const t = this.hit(px, py);
      if (t && h.onDragStart) { e.preventDefault(); this.cv.setPointerCapture(e.pointerId); const w = this.unproject(px, py, t.zv); h.onDragStart(t, w); this.drag = {id: e.pointerId, hit: t}; return; }
      this.cv.setPointerCapture(e.pointerId); this.orbit = {x: e.clientX, y: e.clientY, az: this.az, el: this.el, id: e.pointerId};
    }
    move(e) {
      if (this.drag && e.pointerId === this.drag.id) { const [px, py] = this.local(e); this.hooks.onDragMove(this.drag.hit, this.unproject(px, py, this.drag.hit.zv)); return; }
      if (this.orbit && e.pointerId === this.orbit.id) {
        this.az = this.orbit.az + (e.clientX - this.orbit.x) * 0.008; this.el = clamp(this.orbit.el + (e.clientY - this.orbit.y) * 0.006, 0.12, 1.5); this.render();
      }
    }
    endDrag() { this.drag = null; }
  }
  const endAll = (v) => { v.cv.addEventListener('pointerup', () => v.endDrag()); v.cv.addEventListener('pointercancel', () => v.endDrag()); };
  root.View3D = View3D; root.View3D.attach = endAll; root.View3D.COLORS = COLORS;
})(typeof globalThis !== 'undefined' ? globalThis : this);
