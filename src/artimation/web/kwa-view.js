// Papers tab shell: paper switch, step navigation, one shared canvas and its pointer and animation loop.
(function () {
  'use strict';
  const $ = id => document.getElementById(id), W = 1100, H = 620, canvas = $('kwa-canvas'), ctx = canvas.getContext('2d');
  const state = {paper: 'arrivals', step: {arrivals: 0, drones: 0, stollenwerk: 0}};
  canvas.width = W * 2; canvas.height = H * 2;
  const paper = () => KwaPapers[state.paper], step = () => state.step[state.paper];

  function render() {
    ctx.setTransform(2, 0, 0, 2, 0, 0); ctx.clearRect(0, 0, W, H);
    paper().draw(step(), ctx);
    KwaUI.stats($('kwa-stats'), paper().stats(step()));
  }
  function controls() { paper().controls(step(), KwaUI.controls($('kwa-controls'), rebuild => { if (rebuild) controls(); render(); })); }
  function select(key, index) {
    state.paper = key; state.step[key] = Math.min(paper().steps.length - 1, Math.max(0, index));
    for (const k of Object.keys(KwaPapers)) $(`kwa-paper-${k}`).setAttribute('aria-pressed', String(k === key));
    $('kwa-steps').replaceChildren(...paper().steps.map((s, i) => {
      const li = document.createElement('li'), b = document.createElement('button');
      b.textContent = `${i + 1}  ${s.title}`; b.onclick = () => select(key, i);
      if (i === step()) b.setAttribute('aria-current', 'step');
      li.append(b); return li;
    }));
    $('kwa-caption').textContent = paper().steps[step()].caption;
    $('kwa-source').textContent = paper().source;
    $('kwa-prev').disabled = step() === 0; $('kwa-next').disabled = step() === paper().steps.length - 1;
    paper().enter(step()); controls(); render();
  }
  function pointer(type, event) {
    const r = canvas.getBoundingClientRect(), result = paper().pointer(step(), type, (event.clientX - r.left) * W / r.width, (event.clientY - r.top) * H / r.height);
    if (result === 'controls') controls();
    if (result) render();
  }
  canvas.onpointerdown = e => { canvas.setPointerCapture(e.pointerId); pointer('down', e); };
  canvas.onpointermove = e => pointer('move', e);
  canvas.onpointerup = canvas.onpointercancel = e => pointer('up', e);
  for (const k of Object.keys(KwaPapers)) { $(`kwa-paper-${k}`).textContent = KwaPapers[k].label; $(`kwa-paper-${k}`).onclick = () => select(k, state.step[k]); }
  $('kwa-prev').onclick = () => select(state.paper, step() - 1);
  $('kwa-next').onclick = () => select(state.paper, step() + 1);

  let last = performance.now();
  function frame(now) {
    const dt = Math.min(0.1, (now - last) / 1000); last = now;
    if (!$('kwa-lab').hidden && paper().tick?.(step(), dt)) render();
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
  select('arrivals', 0);
  window.KwaView = {state, select, render};
})();
