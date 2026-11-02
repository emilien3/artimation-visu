(function (root) {
  'use strict';
  const velocity = a => ({x: Math.sin(a.heading * Math.PI / 180) * a.speed / 60, y: -Math.cos(a.heading * Math.PI / 180) * a.speed / 60});
  const position = (a, minutes = 0) => { const v = velocity(a); return {...a, x:a.x + v.x * minutes, y:a.y + v.y * minutes}; };
  const cross = (a,b) => a.x*b.y-a.y*b.x;
  // EXTENSION 3D (absente de l'outil d'origine) : instants [lo,hi] ⊂ [0,horizon] (min) où l'écart d'altitude est < sepV.
  // Les taux verticaux étant constants et indépendants du cap, cet intervalle ne dépend pas du cap choisi.
  // sepV falsy (0/undefined) = altitude ignorée : on retrouve exactement le modèle 2D d'origine.
  const verticalWindow = (own,other,horizon,sepV) => {
    if(!(sepV>0)) return [0,horizon];
    const dz0=(other.z??36000)-(own.z??36000), dvz=(other.vz||0)-(own.vz||0);
    if(Math.abs(dvz)<1e-9) return Math.abs(dz0)<sepV?[0,horizon]:null;
    let t1=(-sepV-dz0)/dvz, t2=(sepV-dz0)/dvz; if(t1>t2)[t1,t2]=[t2,t1];
    const lo=Math.max(0,t1), hi=Math.min(horizon,t2); return hi>lo?[lo,hi]:null;
  };
  function encounter(a,b,horizon,separation,sepV) {
    const va=velocity(a), vb=velocity(b), d={x:b.x-a.x,y:b.y-a.y}, rv={x:vb.x-va.x,y:vb.y-va.y};
    const vv=rv.x*rv.x+rv.y*rv.y;
    const win=verticalWindow(a,b,horizon,sepV), lo=win?win[0]:0, hi=win?win[1]:horizon;
    const t=vv>1e-12 ? Math.max(lo,Math.min(hi,-(d.x*rv.x+d.y*rv.y)/vv)) : lo;
    const pa=position(a,t), pb=position(b,t), distance=Math.hypot(pa.x-pb.x,pa.y-pb.y);
    const det=cross(va,vb); let crossing=null;
    if(Math.abs(det)>1e-9) {
      const ta=cross(d,vb)/det, tb=cross(d,va)/det;
      if(ta>=-1e-9 && tb>=-1e-9 && ta<=horizon && tb<=horizon) crossing={x:a.x+va.x*ta,y:a.y+va.y*ta,ta:Math.max(0,ta),tb:Math.max(0,tb),gap:Math.abs(ta-tb)};
    }
    const vsep=Math.abs(((b.z??36000)+(b.vz||0)*t)-((a.z??36000)+(a.vz||0)*t));
    return {a:a.id,b:b.id,t,distance,pa,pb,crossing,risk:!!win&&distance<separation,vsep,separatedVertically:!win&&distance<separation};
  }
  function analyze(aircraft,horizon,separation,sepV){const results=[];for(let i=0;i<aircraft.length;i++)for(let j=i+1;j<aircraft.length;j++){const e=encounter(aircraft[i],aircraft[j],horizon,separation,sepV);if(e.crossing||e.risk)results.push(e);}return results.sort((a,b)=>Number(b.risk)-Number(a.risk)||a.t-b.t);}
  // Partition the heading circle at every possible separation boundary: tangency
  // to an intruder's separation disk, or contact exactly at the horizon endpoint.
  // Test each resulting open interval, then union blocked intervals across traffic.
  function headingSpace(aircraft, selectedId, horizon, separation, sepV) {
    const own=aircraft.find(a=>a.id===selectedId);
    if(!own)return {safe:[],unsafe:[],safeDegrees:0,currentSafe:false,alreadyInside:false};
    const speed=own.speed/60, epsilon=1e-9, blocked=[];
    let alreadyInside=false;
    const normalize=angle=>(angle%360+360)%360;
    const heading=(x,y)=>normalize(Math.atan2(x,-y)*180/Math.PI);
    for(const other of aircraft) {
      if(other.id===selectedId)continue;
      const rx=other.x-own.x, ry=other.y-own.y, distance=Math.hypot(rx,ry), v=velocity(other);
      const win=verticalWindow(own,other,horizon,sepV);
      if(!win)continue; // séparés en altitude pendant tout l'horizon : cet intrus ne bloque aucun cap
      if(distance<separation){alreadyInside=true;blocked.push([0,360]);break;}
      if(horizon<=0)continue;
      const cuts=[0,360], partial=win[0]>0||win[1]<horizon;
      const riskAt=angle=>{
        const rad=angle*Math.PI/180, wx=Math.sin(rad)*speed-v.x, wy=-Math.cos(rad)*speed-v.y;
        const ww=wx*wx+wy*wy, t=ww>1e-12?Math.max(win[0],Math.min(win[1],(rx*wx+ry*wy)/ww)):win[0];
        return Math.hypot(rx-wx*t,ry-wy*t)<separation;
      };
      // fenêtre verticale partielle : les frontières exactes ne s'appliquent plus, on échantillonne les caps (0,05°)
      if(partial){for(let a=0.05;a<360;a+=0.05)cuts.push(a);}
      else if(distance>0 && speed>0) {
        const alpha=Math.asin(Math.min(1,separation/distance)), base=Math.atan2(ry,rx);
        for(const angle of [base-alpha,base+alpha]) {
          const ux=Math.cos(angle),uy=Math.sin(angle),dot=v.x*ux+v.y*uy;
          const discriminant=dot*dot+speed*speed-v.x*v.x-v.y*v.y;
          if(discriminant>=-epsilon)for(const k of [-dot-Math.sqrt(Math.max(0,discriminant)),-dot+Math.sqrt(Math.max(0,discriminant))]){
            if(k>=-epsilon)cuts.push(heading(v.x+k*ux,v.y+k*uy));
          }
        }
        const cx=v.x+rx/horizon, cy=v.y+ry/horizon, c=Math.hypot(cx,cy), radius=separation/horizon;
        if(c>epsilon){
          const cosine=(speed*speed+c*c-radius*radius)/(2*speed*c);
          if(cosine>=-1-epsilon && cosine<=1+epsilon){
            const offset=Math.acos(Math.max(-1,Math.min(1,cosine)))*180/Math.PI, center=heading(cx,cy);
            cuts.push(normalize(center-offset),normalize(center+offset));
          }
        }
      }
      cuts.sort((a,b)=>a-b);
      for(let i=1;i<cuts.length;i++)if(cuts[i]-cuts[i-1]>epsilon && riskAt((cuts[i]+cuts[i-1])/2))blocked.push([cuts[i-1],cuts[i]]);
    }
    blocked.sort((a,b)=>a[0]-b[0]);
    const unsafe=[];
    for(const range of blocked){const last=unsafe[unsafe.length-1];if(last && range[0]<=last[1]+epsilon)last[1]=Math.max(last[1],range[1]);else unsafe.push([...range]);}
    const safe=[];let start=0;
    for(const [from,to] of unsafe){if(from-start>epsilon)safe.push([start,from]);start=to;}
    if(360-start>epsilon)safe.push([start,360]);
    return {safe,unsafe,safeDegrees:safe.reduce((sum,[from,to])=>sum+to-from,0),alreadyInside,
      currentSafe:aircraft.every(other=>other.id===selectedId||!encounter(own,other,horizon,separation,sepV).risk)};
  }
  const api={velocity,position,verticalWindow,encounter,analyze,headingSpace};root.FlightMath=api;if(typeof module!=='undefined')module.exports=api;
})(typeof globalThis!=='undefined'?globalThis:this);
