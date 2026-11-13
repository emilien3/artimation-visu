// Shared drawing and control helpers for the Papers explainer tab.
(function (root) {
  'use strict';
  const C = {bg: '#0c1925', panel: '#111c28', surface: '#172431', line: '#2b3d49', text: '#e6edf3', muted: '#879aaa',
    mint: '#64dfcb', amber: '#ffcb78', red: '#ff8c83', blue: '#7fb7ff', violet: '#c59bff', slate: '#3b5063'};
  const AIRCRAFT = [C.amber, C.blue, C.violet];

  function text(ctx, s, x, y, {color = C.text, size = 13, align = 'left', bold = false, mono = false, base = 'alphabetic'} = {}) {
    ctx.font = `${bold ? '600 ' : ''}${size}px ${mono ? 'Consolas, Menlo, monospace' : 'Inter, "Segoe UI", Arial, sans-serif'}`;
    ctx.fillStyle = color; ctx.textAlign = align; ctx.textBaseline = base; ctx.fillText(s, x, y);
  }
  function box(ctx, x, y, w, h, {fill, stroke, radius = 6, width = 1, dash} = {}) {
    ctx.beginPath(); ctx.roundRect(x, y, w, h, radius);
    if (fill) { ctx.fillStyle = fill; ctx.fill(); }
    if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = width; ctx.setLineDash(dash || []); ctx.stroke(); ctx.setLineDash([]); }
  }
  function line(ctx, x1, y1, x2, y2, {color = C.line, width = 1, dash} = {}) {
    ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.strokeStyle = color; ctx.lineWidth = width;
    ctx.setLineDash(dash || []); ctx.stroke(); ctx.setLineDash([]);
  }
  // Low (dark blue) -> mint -> amber -> red, t in [0, 1].
  function ramp(t) {
    const stops = [[12, 25, 37], [26, 78, 92], [100, 223, 203], [255, 203, 120], [255, 110, 100]];
    const u = Math.min(0.9999, Math.max(0, t)) * (stops.length - 1), i = Math.floor(u), f = u - i;
    return stops[i].map((v, k) => Math.round(v + (stops[i + 1][k] - v) * f));
  }
  const rgb = c => `rgb(${c[0]},${c[1]},${c[2]})`;

  function number(v) {
    if (!Number.isFinite(v)) return '—';
    const a = Math.abs(v);
    if (a !== 0 && (a >= 1e5 || a < 1e-3)) return v.toExponential(1).replace('e+', 'e');
    return String(Math.round(v * 1000) / 1000);
  }
  const percent = v => v < 0.001 ? `${(v * 100).toFixed(3)} %` : `${(v * 100).toFixed(v < 0.1 ? 2 : 1)} %`;
  function duration(seconds) {
    if (seconds < 1) return '< 1 s';
    if (seconds < 90) return `${Math.round(seconds)} s`;
    if (seconds < 5400) return `${Math.round(seconds / 60)} min`;
    return `${(seconds / 3600).toFixed(seconds < 36000 ? 1 : 0)} h`;
  }

  // Control builders for the side panel. Every control calls `changed()` after its own handler.
  function controls(el, changed) {
    el.replaceChildren();
    const add = (label, node) => { const l = document.createElement('label'); l.append(label, node); el.append(l); return node; };
    return {
      choice(label, options, value, on) {
        const s = document.createElement('select');
        for (const [v, t] of options) s.add(new Option(t, v, false, String(v) === String(value)));
        s.onchange = () => { on(s.value); changed(); };
        return add(label, s);
      },
      slider(label, {min, max, step, value, format = String}, on) {
        const wrap = document.createElement('span'), i = document.createElement('input'), o = document.createElement('output');
        Object.assign(i, {type: 'range', min, max, step, value}); o.textContent = format(Number(value)); wrap.className = 'kwa-range'; wrap.append(i, o);
        i.oninput = () => { o.textContent = format(Number(i.value)); on(Number(i.value)); changed(); };
        add(label, wrap); return i;
      },
      toggle(label, value, on) {
        const l = document.createElement('label'), i = document.createElement('input');
        i.type = 'checkbox'; i.checked = value; l.className = 'kwa-check'; l.append(i, label); el.append(l);
        i.onchange = () => { on(i.checked); changed(); };
        return i;
      },
      button(label, on) {
        const b = document.createElement('button'); b.className = 'button'; b.textContent = label; el.append(b);
        b.onclick = () => { on(); changed(true); };
        return b;
      },
    };
  }
  // rows: [label, value, 'good' | 'bad' | undefined]
  function stats(el, rows) {
    el.replaceChildren(...rows.map(([label, value, tone]) => {
      const d = document.createElement('div'), s = document.createElement('span'), b = document.createElement('b');
      s.textContent = label; b.textContent = value; if (tone) b.className = tone; d.append(s, b); return d;
    }));
  }

  root.KwaUI = {C, AIRCRAFT, text, box, line, ramp, rgb, number, percent, duration, controls, stats};
  root.KwaPapers = {};
})(window);
