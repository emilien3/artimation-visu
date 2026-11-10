// Small canvas charts without dependencies.
(function (root) {
  'use strict';
  function lineChart(canvas, series, opt) {
    const o = Object.assign({xlabel: '', hlines: [], ymin: null, ymax: null}, opt), r = canvas.getBoundingClientRect(), d = window.devicePixelRatio || 1;
    const w = Math.max(200, r.width), h = canvas.height / (canvas._d || 1) || 220;
    canvas._d = d; canvas.width = Math.round(w * d); canvas.height = Math.round(220 * d); canvas.style.height = '220px';
    const c = canvas.getContext('2d'); c.setTransform(d, 0, 0, d, 0, 0); c.clearRect(0, 0, w, 220);
    const pad = {l: 44, r: 10, t: 10, b: 26}, W = w - pad.l - pad.r, H = 220 - pad.t - pad.b;
    const pts = series.flatMap(s => s.ys.map((y, i) => [s.xs[i], y])).filter(p => Number.isFinite(p[1]));
    if (!pts.length) { c.fillStyle = '#879aaa'; c.font = '12px Inter,Arial'; c.fillText('No data', pad.l + 10, 60); return; }
    const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]).concat(o.hlines.map(l => l.y));
    const x0 = Math.min(...xs), x1 = Math.max(...xs) || 1, y0 = o.ymin ?? Math.min(...ys, 0), y1 = (o.ymax ?? Math.max(...ys) * 1.05) || 1;
    const X = x => pad.l + (x - x0) / ((x1 - x0) || 1) * W, Y = y => pad.t + H - (y - y0) / ((y1 - y0) || 1) * H;
    c.strokeStyle = '#253542'; c.fillStyle = '#879aaa'; c.font = '11px Inter,Arial'; c.lineWidth = 1;
    for (let k = 0; k <= 4; k++) { const y = y0 + (y1 - y0) * k / 4; c.beginPath(); c.moveTo(pad.l, Y(y)); c.lineTo(pad.l + W, Y(y)); c.stroke(); c.textAlign = 'right'; c.fillText((y1 - y0) >= 8 ? Math.round(y) : y.toFixed(2).replace(/\.?0+$/, ''), pad.l - 5, Y(y) + 4); }
    c.textAlign = 'center'; for (let k = 0; k <= 4; k++) { const x = x0 + (x1 - x0) * k / 4; c.fillText(Math.round(x), X(x), 220 - 8); }
    for (const l of o.hlines) { c.strokeStyle = l.color || '#ff8c83'; c.setLineDash([5, 4]); c.beginPath(); c.moveTo(pad.l, Y(l.y)); c.lineTo(pad.l + W, Y(l.y)); c.stroke(); c.setLineDash([]); }
    series.forEach(s => { c.strokeStyle = s.color; c.lineWidth = 2; c.beginPath(); let on = false; s.ys.forEach((y, i) => { if (!Number.isFinite(y)) { on = false; return; } on ? c.lineTo(X(s.xs[i]), Y(y)) : c.moveTo(X(s.xs[i]), Y(y)); on = true; }); c.stroke(); });
    c.textAlign = 'left'; series.forEach((s, i) => { c.fillStyle = s.color; c.fillText(s.label, pad.l + 8 + i * 110, pad.t + 12); });
  }
  root.Charts = {lineChart};
})(typeof globalThis !== 'undefined' ? globalThis : this);
