(() => {
  'use strict';
  const $=id=>document.getElementById(id), M=FlightMath, svg=$('radar'), NS='http://www.w3.org/2000/svg';
  const state={aircraft:[],selected:null,time:0,horizon:10,separation:5,playing:false,placing:false,focus:null,nextId:1};
  let drag=null,lastFrame=0,lastAnalysis=0,noticeTimer,results=[];
  state.showSolutions=false;
  let solutionPanelKey='';
  const clamp=(n,min,max)=>Math.max(min,Math.min(max,n));
  const clock=n=>{const s=Math.round(n*60);return `${String(Math.floor(s/60)).padStart(2,'0')}:${String(s%60).padStart(2,'0')}`;};
  const fmt=n=>Number(n).toFixed(1);
  const selected=()=>state.aircraft.find(a=>a.id===state.selected);
  const current=()=>state.aircraft.map(a=>M.position(a,state.time));
  const densityView=new DensityView(()=>draw());
  const el=(tag,attrs,parent)=>{const node=document.createElementNS(NS,tag);for(const [k,v]of Object.entries(attrs))node.setAttribute(k,v);parent?.appendChild(node);return node;};
  function notify(text){$('notice').textContent=text;$('notice').classList.add('visible');clearTimeout(noticeTimer);noticeTimer=setTimeout(()=>$('notice').classList.remove('visible'),3500);}
  function setPlaying(value){state.playing=value;$('play').innerHTML=value?'Ⅱ <span>Pause</span>':'▶ <span>Play</span>';$('run-status').textContent=value?'RUNNING':'PAUSED';$('run-status').classList.toggle('running',value);}
  function setPlacing(value){state.placing=value;$('add').classList.toggle('active',value);$('add').textContent=value?'× Cancel placement':'＋ Place an aircraft';$('radar-mode').textContent=value?'CLICK TO PLACE':'DRAG TO EDIT';svg.style.cursor=value?'crosshair':'';}
  function commitTime(){if(state.time){state.aircraft=current();state.time=0;}setPlaying(false);}
  function newAircraft(x,y,speed=300,heading=90){const a={id:`AC${String(state.nextId++).padStart(3,'0')}`,x,y,speed,heading};state.aircraft.push(a);state.selected=a.id;return a;}
  function demo(){setPlaying(false);setPlacing(false);state.aircraft=[];state.nextId=1;state.time=0;state.focus=null;[[20,30,360,90],[50,60,360,0],[90,20,300,225],[30,75,240,45],[100,65,300,270]].forEach(args=>newAircraft(...args));state.selected='AC001';$('count').value=5;render();}
  function generate(){const n=Number($('count').value);if(!Number.isInteger(n)||n<1||n>100){notify('Choose a whole number from 1 to 100.');return;}setPlaying(false);setPlacing(false);state.aircraft=[];state.nextId=1;state.time=0;state.focus=null;for(let i=0;i<n;i++){const angle=2*Math.PI*i/n+Math.random()*.2;const x=60+43*Math.cos(angle),y=45+31*Math.sin(angle);const heading=(Math.atan2(60-x, -(45-y))*180/Math.PI+360+Math.random()*60-30)%360;newAircraft(x,y,Math.round((220+Math.random()*240)/10)*10,Math.round(heading)%360);}state.selected=state.aircraft[0].id;render();notify(`${n} aircraft ready. Drag any aircraft or vector to adjust.`);}
  function renderFleet(){const fleet=$('fleet');fleet.replaceChildren();state.aircraft.forEach(a=>{const b=document.createElement('button');b.className='fleet-item'+(a.id===state.selected?' selected':'');b.setAttribute('aria-pressed',a.id===state.selected);b.innerHTML=`<span class="callsign"><i></i>${a.id}</span><span class="fleet-meta">${Math.round(a.speed)} kt / ${String(Math.round(a.heading)%360).padStart(3,'0')}°</span>`;b.onclick=()=>{state.selected=a.id;state.focus=null;render();};fleet.appendChild(b);});$('fleet-count').textContent=String(state.aircraft.length).padStart(2,'0');const a=selected();$('selected-name').textContent=a?.id||'No aircraft';['speed','heading','speed-range','remove'].forEach(id=>$(id).disabled=!a);if(a){$('speed').value=Math.round(a.speed);$('heading').value=Math.round(a.heading)%360;$('speed-range').value=a.speed;$('speed-label').textContent=`${Math.round(a.speed)} kt`;}else{$('speed').value='';$('heading').value='';$('speed-label').textContent='';}}
  function draw(){const aircraft=current();$('paths').replaceChildren();$('crossings').replaceChildren();$('aircraft').replaceChildren();const focused=results.find(e=>`${e.a}-${e.b}`===state.focus);aircraft.forEach(a=>{const v=M.velocity(a),isSelected=a.id===state.selected,color=isSelected?'#ffcb78':'#64dfcb';const end=M.position(a,state.horizon);el('line',{x1:a.x*10,y1:a.y*10,x2:end.x*10,y2:end.y*10,stroke:color,class:'trajectory'},$('paths'));if(isSelected)el('circle',{cx:a.x*10,cy:a.y*10,r:state.separation*10,fill:color,'fill-opacity':'.035',stroke:color,'stroke-opacity':'.22','stroke-dasharray':'4 7'},$('paths'));const vx=(a.x+v.x*3)*10,vy=(a.y+v.y*3)*10;el('line',{x1:a.x*10,y1:a.y*10,x2:vx,y2:vy,stroke:color,class:'vector-line','marker-end':'url(#arrow)'},$('aircraft'));const handle=el('g',{'data-id':a.id,'data-drag':'velocity',tabindex:0,role:'button','aria-label':`${a.id} velocity handle. Use the speed and heading fields to edit precisely.`},$('aircraft'));el('circle',{cx:vx,cy:vy,r:17,fill:'transparent'},handle);el('circle',{cx:vx,cy:vy,r:isSelected?6:4,stroke:color,class:'velocity-handle'},handle);const g=el('g',{'data-id':a.id,'data-drag':'position',class:'aircraft-symbol',tabindex:0,role:'button','aria-label':`${a.id}, ${Math.round(a.speed)} knots, heading ${Math.round(a.heading)} degrees. Arrow keys move; Shift moves faster.`},$('aircraft'));el('circle',{cx:a.x*10,cy:a.y*10,r:24,class:'plane-hit'},g);if(isSelected)el('circle',{cx:a.x*10,cy:a.y*10,r:21,fill:'none',stroke:color,'stroke-opacity':'.5'},g);el('path',{d:'M0 -17 L4 -4 L15 4 L15 8 L4 4 L4 12 L8 16 L8 19 L0 15 L-8 19 L-8 16 L-4 12 L-4 4 L-15 8 L-15 4 L-4 -4Z',transform:`translate(${a.x*10} ${a.y*10}) rotate(${a.heading})`,fill:color},g);const right=a.x>100?-85:28;const label=el('text',{x:a.x*10+right,y:a.y*10-3,class:'plane-label'},g);label.textContent=a.id;const meta=el('text',{x:a.x*10+right,y:a.y*10+16,class:'plane-label plane-meta'},g);meta.textContent=`${Math.round(a.speed)} kt`;});
    results.forEach(e=>{if(!e.crossing)return;const p=e.crossing;const g=el('g',{class:'cross-marker',tabindex:0,role:'button','data-pair':`${e.a}-${e.b}`,'aria-label':`${e.a} and ${e.b}, crossing with ${fmt(p.gap)} minutes between arrivals`},$('crossings'));el('circle',{cx:p.x*10,cy:p.y*10,r:20,fill:'transparent'},g);el('path',{d:`M${p.x*10} ${p.y*10-8}l8 8-8 8-8-8Z`,fill:'#12222e',stroke:e.risk?'#ff8c83':'#8ab6c9','stroke-width':2},g);const title=el('title',{},g);title.textContent=`${e.a} × ${e.b} · arrival gap ${fmt(p.gap)} min`;});
    const risks=focused?[focused]:results.filter(e=>e.risk).slice(0,12);risks.forEach(e=>{if(!e.risk&&e!==focused)return;const color=e.risk?'#ff8c83':'#8ab6c9';el('line',{x1:e.pa.x*10,y1:e.pa.y*10,x2:e.pb.x*10,y2:e.pb.y*10,stroke:color,'stroke-dasharray':'3 4'},$('crossings'));[e.pa,e.pb].forEach(p=>el('circle',{cx:p.x*10,cy:p.y*10,r:Math.max(10,state.separation*5),fill:color,'fill-opacity':'.06',stroke:color,'stroke-opacity':'.65'},$('crossings')));});
    densityView.request(aircraft,state.horizon,state.separation,state.time,state.playing);
    drawSolutions(aircraft);
    $('elapsed').textContent=clock(state.time);$('timeline').value=state.time;$('timeline').max=state.horizon;$('duration').textContent=clock(state.horizon);
  }
  function drawSolutions(aircraft) {
    const layer=$('solution-overlay');layer.replaceChildren();
    $('solution-details').hidden=!state.showSolutions;
    if(!state.showSolutions)return;
    const own=aircraft.find(a=>a.id===state.selected);
    const space=M.headingSpace(aircraft,state.selected,state.horizon,state.separation);
    const key=JSON.stringify([space,own?.id,own?.speed,state.horizon,state.separation]);
    if(key!==solutionPanelKey){
      solutionPanelKey=key;
      $('solution-coverage').textContent=`${(space.safeDegrees/3.6).toFixed(1)}% safe`;
      $('solution-status').textContent=!own?'Select or place an aircraft.':space.alreadyInside?'Already inside the separation limit. No heading is clear for the entire window.':!space.safe.length?'No safe heading at this speed. Try changing the speed or position.':space.currentSafe?'Current heading is clear.':'Current heading has a predicted conflict.';
      $('solution-status').classList.toggle('has-conflict',!!own&&!space.currentSafe);
      $('solution-assumptions').textContent=own?`${own.id} at ${Math.round(own.speed)} kt · next ${state.horizon} min · minimum ${state.separation} NM. Other aircraft keep their velocity. Instant heading change assumed.`:'';
      $('heading-space').replaceChildren();$('safe-ranges').replaceChildren();
      space.safe.forEach(([from,to])=>{
        const middle=(from+to)/2;
        const label=from===0&&to===360?'All directions':`${from.toFixed(1)}°–${to.toFixed(1)}°`;
        const bar=document.createElement('button');bar.className='safe-heading-segment';bar.style.left=`${from/3.6}%`;bar.style.width=`${(to-from)/3.6}%`;bar.dataset.heading=middle;bar.setAttribute('aria-label',`${label}: set heading to ${middle.toFixed(1)} degrees`);bar.title=bar.getAttribute('aria-label');$('heading-space').appendChild(bar);
        const button=document.createElement('button');button.className='safe-range';button.textContent=label;button.dataset.heading=middle;button.setAttribute('aria-label',bar.getAttribute('aria-label'));$('safe-ranges').appendChild(button);
      });
    }
    $('solution-help').textContent=densityView.enabled?'Use range buttons to apply a safe heading. Turn off all-aircraft density to use the selected aircraft’s clickable sectors.':'Click a green radar sector to set a heading. Range buttons choose their midpoint.';
    // Never paint the selected aircraft's green sectors over an aggregate red cell.
    if(!own||densityView.enabled)return;
    const cx=own.x*10,cy=own.y*10,outer=140,inner=35;
    const polar=(radius,angle)=>{const rad=angle*Math.PI/180;return [cx+Math.sin(rad)*radius,cy-Math.cos(rad)*radius];};
    const arc=(radius,from,to)=>{let path='';const steps=Math.ceil(Math.abs(to-from)/90);for(let i=1;i<=steps;i++){const p=polar(radius,from+(to-from)*i/steps);path+=` A ${radius} ${radius} 0 0 ${to>=from?1:0} ${p[0]} ${p[1]}`;}return path;};
    el('circle',{cx,cy,r:(outer+inner)/2,fill:'none',stroke:'#ff8c83','stroke-width':outer-inner,'stroke-opacity':'.09','pointer-events':'none'},layer);
    space.safe.forEach(([from,to])=>{
      const p=polar(outer,from),q=polar(inner,to);
      const path=`M ${p[0]} ${p[1]}${arc(outer,from,to)} L ${q[0]} ${q[1]}${arc(inner,to,from)} Z`;
      const wedge=el('path',{d:path,class:'safe-sector','data-safe-sector':'true'},layer);
      const title=el('title',{},wedge);title.textContent=`Safe: ${from.toFixed(1)}°–${to.toFixed(1)}°. Click to set direction.`;
    });
    el('circle',{cx,cy,r:outer,fill:'none',stroke:'#91aaa9','stroke-opacity':'.35','pointer-events':'none'},layer);
    [0,90,180,270].forEach(angle=>{const p=polar(outer-5,angle),q=polar(outer+5,angle);el('line',{x1:p[0],y1:p[1],x2:q[0],y2:q[1],stroke:'#91aaa9','pointer-events':'none'},layer);});
  }
  function applySafeHeading(heading) {
    const aircraft=current(),own=aircraft.find(a=>a.id===state.selected);
    if(!own||!Number.isFinite(heading))return;
    // Revalidate the exact clicked direction; rounded range labels are only display text.
    const candidate={...own,heading};
    if(aircraft.some(other=>other.id!==own.id&&M.encounter(candidate,other,state.horizon,state.separation).risk)){
      notify('This direction is no longer clear. Choose inside a green sector.');return;
    }
    commitTime();selected().heading=heading;state.focus=null;render();
    notify(`Safe heading ${heading.toFixed(1)}° applied to ${own.id}.`);
  }
  $('show-solutions').onchange=event=>{state.showSolutions=event.target.checked;solutionPanelKey='';draw();};
  for(const id of ['heading-space','safe-ranges']){
    $(id).addEventListener('pointerdown',()=>setPlaying(false));
    $(id).addEventListener('click',event=>{const button=event.target.closest('[data-heading]');if(button)applySafeHeading(Number(button.dataset.heading));});
  }
  svg.addEventListener('pointerdown',event=>{
    if(event.button!==0||state.placing||!event.target.closest('[data-safe-sector]'))return;
    const own=current().find(a=>a.id===state.selected);if(!own)return;
    event.preventDefault();event.stopImmediatePropagation();const p=point(event);
    applySafeHeading((Math.atan2(p.x-own.x,-(p.y-own.y))*180/Math.PI+360)%360);
  },true);
  function renderAnalysis(){results=M.analyze(current(),state.horizon,state.separation);$('encounter-count').textContent=results.length;$('risk-count').textContent=results.filter(e=>e.risk).length;$('prediction-label').textContent=`${state.horizon}-minute window`;$('encounters').replaceChildren();if(!results.length){$('encounters').innerHTML='<div class="empty"><strong>No encounters in this window</strong>Move aircraft or extend the look-ahead window to explore crossings.</div>';return;}results.slice(0,100).forEach(e=>{const b=document.createElement('button');const key=`${e.a}-${e.b}`;b.className='encounter'+(e.risk?' risk':'')+(state.focus===key?' focused':'');b.innerHTML=`<div class="encounter-head"><strong>${e.a} <span style="color:#607c90">×</span> ${e.b}</strong><span class="encounter-tag">${e.risk?'CLOSE APPROACH':'PATH CROSSING'}</span></div><div class="encounter-details"><span>Closest <b>${fmt(e.distance)} NM</b></span><span>In <b>${clock(e.t)}</b></span></div><div class="encounter-note">${e.crossing?`Crossing arrivals: ${clock(e.crossing.ta)} / ${clock(e.crossing.tb)} · gap ${clock(e.crossing.gap)}`:'Paths overlap or converge within the separation threshold.'}</div>`;b.onclick=()=>{state.focus=state.focus===key?null:key;renderAnalysis();draw();};$('encounters').appendChild(b);});if(results.length>100){const p=document.createElement('p');p.className='empty';p.textContent=`Showing the first 100 of ${results.length} encounters, with close approaches first.`;$('encounters').appendChild(p);}}
  function render(){renderFleet();renderAnalysis();draw();}
  function point(event){const p=new DOMPoint(event.clientX,event.clientY).matrixTransform(svg.getScreenCTM().inverse());return{x:p.x/10,y:p.y/10};}
  svg.addEventListener('pointerdown',event=>{if(event.button!==0)return;const p=point(event);if(state.placing){if(p.x<0||p.x>120||p.y<0||p.y>90)return;if(state.aircraft.length>=100){notify('The workspace supports up to 100 aircraft.');return;}commitTime();newAircraft(p.x,p.y);setPlacing(false);state.focus=null;render();return;}const target=event.target.closest('[data-drag]');if(!target)return;event.preventDefault();commitTime();state.selected=target.dataset.id;state.focus=null;const a=selected();drag={id:event.pointerId,kind:target.dataset.drag,offsetX:p.x-a.x,offsetY:p.y-a.y};svg.setPointerCapture(event.pointerId);render();});
  svg.addEventListener('pointermove',event=>{if(!drag||event.pointerId!==drag.id)return;const p=point(event),a=selected();if(drag.kind==='position'){a.x=clamp(p.x-drag.offsetX,1,119);a.y=clamp(p.y-drag.offsetY,1,89);}else{const dx=p.x-a.x,dy=p.y-a.y;a.speed=clamp(Math.hypot(dx,dy)*20,60,900);a.heading=(Math.atan2(dx,-dy)*180/Math.PI+360)%360;}render();});
  const endDrag=()=>{drag=null;};svg.addEventListener('pointerup',endDrag);svg.addEventListener('pointercancel',endDrag);svg.addEventListener('lostpointercapture',endDrag);
  svg.addEventListener('click',event=>{const p=event.target.closest('[data-pair]');if(p){state.focus=p.dataset.pair;renderAnalysis();draw();}});
  svg.addEventListener('keydown',event=>{const target=event.target.closest('[data-id]');if(!target){const p=event.target.closest('[data-pair]');if(p&&['Enter',' '].includes(event.key)){event.preventDefault();state.focus=p.dataset.pair;renderAnalysis();draw();}return;}if(['Enter',' '].includes(event.key)){event.preventDefault();state.selected=target.dataset.id;render();$('speed').focus();return;}const steps={ArrowUp:[0,-1],ArrowDown:[0,1],ArrowLeft:[-1,0],ArrowRight:[1,0]};if(!steps[event.key])return;event.preventDefault();commitTime();state.selected=target.dataset.id;const a=selected(),s=event.shiftKey?5:1;a.x=clamp(a.x+steps[event.key][0]*s,1,119);a.y=clamp(a.y+steps[event.key][1]*s,1,89);render();svg.querySelector(`[data-id="${a.id}"][data-drag="position"]`).focus();});
  function updateVector(field,value){if(!selected())return;const n=Number(value);if(value===''||!Number.isFinite(n)||(field==='speed'&&(n<60||n>900))||(field==='heading'&&(n<0||n>359))){notify(field==='speed'?'Speed must be between 60 and 900 knots.':'Heading must be between 0 and 359 degrees.');renderFleet();return;}commitTime();selected()[field]=n;state.focus=null;render();}
  $('speed').addEventListener('change',e=>updateVector('speed',e.target.value));$('heading').addEventListener('change',e=>updateVector('heading',e.target.value));$('speed-range').addEventListener('input',e=>updateVector('speed',e.target.value));$('generate').onclick=generate;
  $('add').onclick=()=>{if(state.aircraft.length>=100){notify('The workspace supports up to 100 aircraft.');return;}setPlaying(false);setPlacing(!state.placing);if(state.placing){notify('Click anywhere on the radar to place your aircraft.');$('radar-wrap').scrollIntoView({block:'center',behavior:'smooth'});}};
  $('remove').onclick=()=>{commitTime();state.aircraft=state.aircraft.filter(a=>a.id!==state.selected);state.selected=state.aircraft[0]?.id||null;state.focus=null;render();};
  $('horizon').onchange=e=>{state.horizon=Number(e.target.value);state.time=Math.min(state.time,state.horizon);render();};$('separation').onchange=e=>{state.separation=Number(e.target.value);render();};$('play').onclick=()=>{if(!state.aircraft.length){notify('Place an aircraft to start the simulation.');return;}setPlacing(false);if(state.time>=state.horizon)state.time=0;setPlaying(!state.playing);render();};$('reset').onclick=()=>{setPlaying(false);state.time=0;render();};$('timeline').oninput=e=>{setPlaying(false);state.time=Number(e.target.value);render();};
  document.addEventListener('keydown',event=>{if(event.key==='Escape'){setPlacing(false);state.focus=null;render();}if(event.code==='Space'&&!event.target.closest('input,select,button,[tabindex]')){event.preventDefault();$('play').click();}});
  function tick(now){const delta=lastFrame?Math.min((now-lastFrame)/1000,.1):0;lastFrame=now;if(state.playing){state.time=Math.min(state.horizon,state.time+delta*Number($('rate').value)/60);if(now-lastAnalysis>200){renderAnalysis();lastAnalysis=now;}draw();if(state.time>=state.horizon){setPlaying(false);render();}}requestAnimationFrame(tick);}
  if(document.modelContext?.registerTool){try{Promise.resolve(document.modelContext.registerTool({name:'read_aircraft_scenario',description:'Read current aircraft positions, velocities, and predicted encounters.',inputSchema:{type:'object',properties:{},additionalProperties:false},annotations:{readOnlyHint:true},execute:()=>({aircraft:current(),timeMinutes:state.time,horizonMinutes:state.horizon,separationNM:state.separation,encounters:M.analyze(current(),state.horizon,state.separation)})})).catch(()=>{});}catch{}}
  const updateScale=()=>{const matrix=svg.getScreenCTM();if(matrix){const scale=document.querySelector('.scale');scale.style.minWidth='0';scale.style.width=`${100*matrix.a}px`;}};
  new ResizeObserver(updateScale).observe(svg);
  demo();updateScale();requestAnimationFrame(tick);
})();
