(function installDensity(root){
  'use strict';
  const M=typeof module!=='undefined'&&module.exports?require('./physics.js'):root.FlightMath;

  function gaussianKernel(sigmaCells){
    if(!Number.isFinite(sigmaCells)||sigmaCells<0)throw new RangeError('Kernel width must be non-negative.');
    if(sigmaCells===0)return new Float64Array([1]);
    const radius=Math.ceil(3*sigmaCells),kernel=new Float64Array(radius*2+1);
    let sum=0;
    for(let i=-radius;i<=radius;i++){kernel[i+radius]=Math.exp(-.5*(i/sigmaCells)**2);sum+=kernel[i+radius];}
    return kernel.map(value=>value/sum);
  }

  // Separable Gaussian convolution. Zero padding keeps empty exterior cells empty
  // before smoothing; the finite kernel can spread support up to three sigma.
  function* convolveSteps(map,cols,rows,kernel,kernelY=kernel){
    if(map.length!==cols*rows)throw new RangeError('Map dimensions do not match.');
    if(kernel.length===1&&kernelY.length===1)return map.slice();
    const radius=(kernel.length-1)/2,radiusY=(kernelY.length-1)/2,temp=new Float64Array(map.length),out=new Float64Array(map.length);
    if(!map.some(value=>value!==0))return out;
    // Contiguous inner loops, no boundary branches per multiply. Each output
    // still accumulates taps in ascending order, with the original exact kernel.
    for(let y=0;y<rows;y++){
      const row=y*cols;
      for(let k=-radius;k<=radius;k++){
        const weight=kernel[k+radius],end=row+Math.min(cols,cols-k);
        for(let i=row+Math.max(0,-k);i<end;i++)temp[i]+=map[i+k]*weight;
      }
      if(y%8===7)yield;
    }
    for(let y=0;y<rows;y++){
      const row=y*cols,end=row+cols;
      for(let k=Math.max(-radiusY,-y);k<=Math.min(radiusY,rows-1-y);k++){
        const offset=k*cols,weight=kernelY[k+radiusY];
        for(let i=row;i<end;i++)out[i]+=temp[i+offset]*weight;
      }
      if(y%8===7)yield;
    }
    return out;
  }
  function finish(iterator){let item;do{item=iterator.next();}while(!item.done);return item.value;}
  function convolve(map,cols,rows,kernel,kernelY=kernel){return finish(convolveSteps(map,cols,rows,kernel,kernelY));}

  // Each intruder contributes its unsafe angular intervals. The sweep gives the
  // exact conflict count between boundaries, avoiding N tests at every grid cell.
  function conflictProfile(own,aircraft,horizon,separation){
    const events=[{angle:0,delta:0},{angle:360,delta:0}];
    for(const other of aircraft)if(other.id!==own.id){
      for(const [start,end] of M.headingSpace([own,other],own.id,horizon,separation).unsafe){
        events.push({angle:start,delta:1},{angle:end,delta:-1});
      }
    }
    events.sort((a,b)=>a.angle-b.angle);
    const cuts=[],counts=[];let count=0;
    for(let i=0;i<events.length;){
      const angle=events[i].angle;
      while(i<events.length&&events[i].angle===angle)count+=events[i++].delta;
      cuts.push(angle);counts.push(count);
    }
    return {cuts,counts};
  }

  function conflictCount(profile,heading,exactBoundary){
    let lo=0,hi=profile.cuts.length;
    while(lo<hi){const mid=(lo+hi)>>1;if(profile.cuts[mid]<=heading)lo=mid+1;else hi=mid;}
    const i=Math.max(0,lo-1);
    if(exactBoundary&&(Math.abs(heading-profile.cuts[i])<1e-8||Math.abs(heading-(profile.cuts[i+1]??360))<1e-8))return exactBoundary();
    return profile.counts[i];
  }

  function* rasterSteps(own,aircraft,options,positive,negative,accumulate=false){
    const {cols,rows,width,height,horizon,separation}=options;
    const profile=conflictProfile(own,aircraft,horizon,separation),reach=own.speed/60*horizon;
    const dx=width/cols,dy=height/rows;
    const minY=Math.max(0,Math.floor((own.y-reach)/dy)),maxY=Math.min(rows-1,Math.floor((own.y+reach)/dy));
    const rays=profile.cuts.map(angle=>({angle,sin:Math.sin(angle*Math.PI/180),cos:Math.cos(angle*Math.PI/180)}));
    for(let y=minY;y<=maxY;y++){
      const ry=(y+.5)*dy-own.y;
      if(Math.abs(ry)>reach)continue;
      const extent=Math.sqrt(Math.max(0,reach*reach-ry*ry));
      let first=Math.max(0,Math.floor((own.x-extent)/dx-.5)-1),last=Math.min(cols-1,Math.ceil((own.x+extent)/dx-.5)+1);
      while(first<=last&&Math.hypot((first+.5)*dx-own.x,ry)>reach)first++;
      while(last>=first&&Math.hypot((last+.5)*dx-own.x,ry)>reach)last--;
      if(first>last)continue;
      const breaks=[first,last+1];
      const split=index=>{const floor=Math.floor(index);for(let k=-1;k<=2;k++){const x=floor+k;if(x>first&&x<=last)breaks.push(x);}};
      // Protect the origin and the heading wrap; classify boundary pixels exactly.
      split(own.x/dx-.5);
      for(const ray of rays){
        if(Math.abs(ray.cos)<1e-14||-ry/ray.cos<0)continue;
        split((own.x-ry*ray.sin/ray.cos)/dx-.5);
      }
      breaks.sort((a,b)=>a-b);
      const row=y*cols;
      for(let segment=1;segment<breaks.length;segment++){
        const start=breaks[segment-1],end=breaks[segment];if(start===end)continue;
        const x=Math.floor((start+end-1)/2),rx=(x+.5)*dx-own.x;
        if(Math.hypot(rx,ry)<1e-10)continue;
        const heading=(Math.atan2(rx,-ry)*180/Math.PI+360)%360;
        const conflicts=conflictCount(profile,heading,()=>{
          const candidate={...own,heading};let count=0;
          for(const other of aircraft)if(other.id!==own.id&&M.encounter(candidate,other,horizon,separation).risk)count++;
          return count;
        });
        const target=conflicts?negative:positive,value=conflicts||1;
        if(accumulate){for(let i=row+start;i<row+end;i++)target[i]+=value;}
        else target.fill(value,row+start,row+end);
      }
      if(y%8===7)yield;
    }
  }
  function* aircraftMapSteps(own,aircraft,options){
    const {cols,rows,kernel,kernelY=kernel}=options;
    const positive=new Float64Array(cols*rows),negative=new Float64Array(cols*rows);
    yield* rasterSteps(own,aircraft,options,positive,negative);
    return {id:own.id,rawPositive:positive,rawNegative:negative,
      positive:yield* convolveSteps(positive,cols,rows,kernel,kernelY),negative:yield* convolveSteps(negative,cols,rows,kernel,kernelY)};
  }
  function aircraftMap(own,aircraft,options){return finish(aircraftMapSteps(own,aircraft,options));}

  function blendMaps(maps,size){
    const positive=new Float64Array(size),negative=new Float64Array(size),signed=new Float64Array(size);
    for(const map of maps)for(let i=0;i<size;i++){positive[i]+=map.positive[i];negative[i]+=map.negative[i];}
    // Strict priority, NOT positive-minus-negative. Even a faint negative wins.
    for(let i=0;i<size;i++)signed[i]=negative[i]>0?-negative[i]:positive[i];
    return {positive,negative,signed};
  }

  function* buildMaps(aircraft,settings={}){
    const options={cols:160,rows:120,width:120,height:90,horizon:10,separation:5,sigma:1.5,...settings};
    const {cols,rows,width,height,sigma}=options;
    if(!Number.isInteger(cols)||!Number.isInteger(rows)||cols<1||rows<1||cols>800||rows>800||!Number.isFinite(width)||!Number.isFinite(height)||width<=0||height<=0)throw new RangeError('Density dimensions must be between 1 and 800.');
    options.kernel=gaussianKernel(sigma/(width/cols));
    options.kernelY=gaussianKernel(sigma/(height/rows));
    const maps=[],targets=options.mapIds?aircraft.filter(a=>options.mapIds.includes(a.id)):aircraft;
    const size=cols*rows,positive=new Float64Array(size),negative=new Float64Array(size),signed=new Float64Array(size);
    let completed=0;
    if(options.retainMaps===false){
      // K * sum(P_i) == sum(K * P_i), separately for the negative channel.
      // Conflict counts are integers here, so accumulation is exact. Never
      // subtract channels or truncate a faint negative contribution.
      for(const own of targets){
        const iterator=rasterSteps(own,aircraft,options,positive,negative,true);
        for(let item=iterator.next();!item.done;item=iterator.next())yield {completed,total:targets.length,phase:'Sampling'};
        completed++;yield {completed,total:targets.length,phase:'Sampling'};
      }
      const smooth=function*(map){
        const iterator=convolveSteps(map,cols,rows,options.kernel,options.kernelY);let item;
        do{item=iterator.next();if(!item.done)yield {completed,total:targets.length,phase:'Smoothing'};}while(!item.done);
        return item.value;
      };
      const smoothPositive=yield* smooth(positive),smoothNegative=yield* smooth(negative);
      for(let i=0;i<size;i++)signed[i]=smoothNegative[i]>0?-smoothNegative[i]:smoothPositive[i];
      return {maps,mapCount:completed,positive:smoothPositive,negative:smoothNegative,signed,cols,rows,sigma};
    }
    for(const own of targets){
      const iterator=aircraftMapSteps(own,aircraft,options);let item;
      do{item=iterator.next();if(!item.done)yield {completed,total:targets.length};}while(!item.done);
      const map=item.value;
      for(let y=0;y<rows;y++){
        for(let x=0;x<cols;x++){const i=y*cols+x;positive[i]+=map.positive[i];negative[i]+=map.negative[i];}
        if(y%8===7)yield {completed,total:targets.length};
      }
      if(options.retainMaps!==false)maps.push(map);
      completed++;yield {completed,total:targets.length};
    }
    for(let i=0;i<size;i++)signed[i]=negative[i]>0?-negative[i]:positive[i];
    return {maps,mapCount:completed,positive,negative,signed,cols,rows,sigma};
  }

  const palettes={
    classic:{name:'Mint / Coral',positive:[[47,146,120],[47,245,210]],negative:[[255,55,65],[255,166,129]]},
    blueAmber:{name:'Blue / Amber',positive:[[35,104,185],[56,165,231],[158,222,255]],negative:[[202,88,20],[242,157,35],[255,225,139]]},
    cyanMagenta:{name:'Cyan / Magenta',positive:[[12,127,147],[28,202,217],[161,249,250]],negative:[[162,39,146],[229,79,190],[255,180,226]]},
    limeViolet:{name:'Lime / Violet',positive:[[103,135,35],[165,210,59],[225,250,147]],negative:[[114,65,181],[163,108,231],[222,184,255]]},
    iceFire:{name:'Ice / Fire',positive:[[48,102,162],[110,180,221],[218,245,255]],negative:[[177,38,54],[243,92,38],[255,208,105]]}
  };
  const COLOR_STEPS=4096;
  const srgbToLinear=value=>{const c=value/255;return c<=.04045?c/12.92:((c+.055)/1.055)**2.4;};
  const linearToSrgb=new Uint8ClampedArray(COLOR_STEPS+1);
  for(let i=0;i<=COLOR_STEPS;i++){
    const c=i/COLOR_STEPS;
    linearToSrgb[i]=Math.round(255*(c<=.0031308?12.92*c:1.055*c**(1/2.4)-.055));
  }
  // Interpolate in linear-light RGB, with fine internal precision. Only the final
  // canvas pixel is quantized to 8-bit; this is not a claim of a 12-bit display.
  const paletteTables={};
  for(const [id,palette] of Object.entries(palettes)){
    paletteTables[id]={};
    for(const sign of ['positive','negative']){
      // Both halves of every diverging scale meet at the same neutral zero.
      const stops=[[54,54,54],...palette[sign]].map(stop=>stop.map(srgbToLinear)),table=new Float32Array((COLOR_STEPS+1)*3);
      for(let i=0;i<=COLOR_STEPS;i++){
        const position=i/COLOR_STEPS*(stops.length-1),from=Math.min(stops.length-2,Math.floor(position)),fraction=position-from;
        for(let channel=0;channel<3;channel++)table[i*3+channel]=stops[from][channel]+(stops[from+1][channel]-stops[from][channel])*fraction;
      }
      paletteTables[id][sign]=table;
    }
  }
  const luminosityTables=new Map();
  function modulatedRamps(palette,strength){
    const key=`${palette}:${strength}`;
    if(luminosityTables.has(key))return luminosityTables.get(key);
    const ramps={};
    for(const sign of ['positive','negative']){
      const source=paletteTables[palette][sign],target=new Float32Array(source.length);
      for(let i=0;i<=COLOR_STEPS;i++){
        const index=i*3,r=source[index],g=source[index+1],b=source[index+2],luma=.2126*r+.7152*g+.0722*b;
        const desired=luma*(1-strength)+strength*(.035+.72*(i/COLOR_STEPS)**1.15);
        const factor=desired<luma?desired/luma:(desired-luma)/(1-luma);
        for(let c=0;c<3;c++)target[index+c]=desired<luma?source[index+c]*factor:source[index+c]+(1-source[index+c])*factor;
      }
      ramps[sign]=target;
    }
    if(luminosityTables.size>=12)luminosityTables.clear();
    luminosityTables.set(key,ramps);return ramps;
  }
  // Screen axes: +x right, +y down, +z toward the viewer. The surface-to-light
  // vector points up and right, with elevation above the density height field.
  const lightLength=Math.sqrt(1+1+1.5*1.5);
  const surfaceLight={x:1/lightLength,y:-1/lightLength,z:1.5/lightLength};
  const ambientLight=.35,diffuseLight=.65,reliefHeight=6;
  const flatIllumination=ambientLight+diffuseLight*surfaceLight.z;
  // Blinn–Phong halfway vector for an orthographic viewer looking down +z.
  const halfLength=Math.hypot(surfaceLight.x,surfaceLight.y,surfaceLight.z+1);
  const halfway={x:surfaceLight.x/halfLength,y:surfaceLight.y/halfLength,z:(surfaceLight.z+1)/halfLength};
  function surfaceSpecular(gx,gy,strength=1,amplification=1){
    if(strength===0||amplification===0)return 0;
    const nx=-reliefHeight*amplification*gx,ny=-reliefHeight*amplification*gy;
    if(nx*surfaceLight.x+ny*surfaceLight.y+surfaceLight.z<=0)return 0;
    const dot=Math.max(0,Math.min(1,(nx*halfway.x+ny*halfway.y+halfway.z)/Math.sqrt(nx*nx+ny*ny+1)));
    return .65*strength*dot**32;
  }
  function surfaceIllumination(gx,gy,strength=1,amplification=1){
    if(amplification===0||strength===0)return 1;
    let nx=-reliefHeight*amplification*gx,ny=-reliefHeight*amplification*gy,nz=1;
    const inverseLength=1/Math.sqrt(nx*nx+ny*ny+nz*nz);
    nx*=inverseLength;ny*=inverseLength;nz*=inverseLength;
    const lambert=Math.max(0,nx*surfaceLight.x+ny*surfaceLight.y+nz*surfaceLight.z);
    // Ambient light keeps away-facing areas legible. Normalize against a flat
    // surface so a constant field retains its unshaded palette brightness.
    const illumination=(ambientLight+diffuseLight*lambert)/flatIllumination;
    // Exaggerate relief and contrast together: merely tilting the normals more
    // leaves the brightest face only slightly brighter under an elevated light.
    return Math.max(.2,Math.min(2.5,1+strength*Math.sqrt(amplification)*(illumination-1)));
  }
  function boundaryTransition(signs,cols,rows,dx,dy){
    // Two-pass chamfer distance in world units: O(cells), independent of band
    // width/resolution. Only occupied positive/negative interfaces are seeds.
    const distance=new Float32Array(signs.length);distance.fill(Infinity);
    const diagonal=Math.hypot(dx,dy),width=2;
    for(let y=0;y<rows;y++)for(let x=0;x<cols;x++){
      const i=y*cols+x,s=signs[i];if(!s)continue;
      if((x>0&&signs[i-1]===-s)||(x+1<cols&&signs[i+1]===-s)||
         (y>0&&signs[i-cols]===-s)||(y+1<rows&&signs[i+cols]===-s))distance[i]=0;
    }
    for(let y=0;y<rows;y++)for(let x=0;x<cols;x++){
      const i=y*cols+x,s=signs[i];if(!s)continue;
      let d=distance[i];
      if(x>0&&signs[i-1]===s)d=Math.min(d,distance[i-1]+dx);
      if(y>0){
        if(signs[i-cols]===s)d=Math.min(d,distance[i-cols]+dy);
        if(x>0&&signs[i-cols-1]===s)d=Math.min(d,distance[i-cols-1]+diagonal);
        if(x+1<cols&&signs[i-cols+1]===s)d=Math.min(d,distance[i-cols+1]+diagonal);
      }
      distance[i]=d;
    }
    for(let y=rows-1;y>=0;y--)for(let x=cols-1;x>=0;x--){
      const i=y*cols+x,s=signs[i];if(!s)continue;
      let d=distance[i];
      if(x+1<cols&&signs[i+1]===s)d=Math.min(d,distance[i+1]+dx);
      if(y+1<rows){
        if(signs[i+cols]===s)d=Math.min(d,distance[i+cols]+dy);
        if(x>0&&signs[i+cols-1]===s)d=Math.min(d,distance[i+cols-1]+diagonal);
        if(x+1<cols&&signs[i+cols+1]===s)d=Math.min(d,distance[i+cols+1]+diagonal);
      }
      distance[i]=d;
    }
    for(let i=0;i<distance.length;i++){const t=Math.min(1,distance[i]/width);distance[i]=t*t*(3-2*t);}
    return distance;
  }
  function colorize(map,channel='blend',opacity=.65,scale='log',palette='classic',luminosity=.8,amplification=1,specular=0){
    if(!['blend','positive','negative'].includes(channel))throw new RangeError('Unknown density channel.');
    if(!['log','linear'].includes(scale))throw new RangeError('Unknown color scale.');
    if(!Object.prototype.hasOwnProperty.call(paletteTables,palette))throw new RangeError('Unknown gradient.');
    if(!Number.isFinite(luminosity)||luminosity<0||luminosity>1)throw new RangeError('Luminosity must be between 0 and 1.');
    if(!Number.isFinite(amplification)||amplification<0||amplification>12)throw new RangeError('Relief amplification must be between 0 and 12.');
    if(!Number.isFinite(specular)||specular<0||specular>1)throw new RangeError('Specular strength must be between 0 and 1.');
    const ramps=modulatedRamps(palette,luminosity);
    const pixels=new Uint8ClampedArray(map.positive.length*4);
    let positiveMaximum=0,negativeMaximum=0;
    for(let i=0;i<map.positive.length;i++){
      const bad=channel!=='positive'&&map.negative[i]>0;
      if(bad)negativeMaximum=Math.max(negativeMaximum,map.negative[i]);
      else if(channel!=='negative')positiveMaximum=Math.max(positiveMaximum,map.positive[i]);
    }
    if(positiveMaximum===0&&negativeMaximum===0)return pixels;
    const positiveDenominator=scale==='log'?Math.log1p(positiveMaximum):positiveMaximum;
    const negativeDenominator=scale==='log'?Math.log1p(negativeMaximum):negativeMaximum;
    const normalized=new Float32Array(map.positive.length),signs=new Int8Array(map.positive.length);
    for(let i=0;i<map.positive.length;i++){
      const bad=channel!=='positive'&&map.negative[i]>0;
      const value=bad?map.negative[i]:channel==='negative'?0:map.positive[i];
      if(value<=0)continue;
      const denominator=bad?negativeDenominator:positiveDenominator;
      normalized[i]=Math.max(0,Math.min(1,(scale==='log'?Math.log1p(value):value)/denominator));signs[i]=bad?-1:1;
    }
    const cols=map.cols,rows=map.rows,hasGrid=Number.isInteger(cols)&&Number.isInteger(rows)&&cols*rows===normalized.length;
    const dx=(map.width??120)/(cols||1),dy=(map.height??90)/(rows||1);
    const transition=hasGrid&&channel==='blend'&&positiveMaximum>0&&negativeMaximum>0?boundaryTransition(signs,cols,rows,dx,dy):null;
    if(transition)for(let i=0;i<normalized.length;i++)normalized[i]*=transition[i];
    for(let i=0;i<normalized.length;i++){
      if(!signs[i])continue;
      const intensity=normalized[i],ramp=signs[i]<0?ramps.negative:ramps.positive,index=Math.round(intensity*COLOR_STEPS)*3;
      let r=ramp[index],g=ramp[index+1],b=ramp[index+2];
      if(hasGrid&&luminosity>0&&amplification>0){
        const x=i%cols,y=Math.floor(i/cols);
        // Differentiate only within the same sign. Never shade across a safe /
        // conflict boundary or borrow an opposing color. Distances are in NM.
        const neighbor=j=>signs[j]===signs[i]?normalized[j]:intensity;
        const gx=((x+1<cols?neighbor(i+1):intensity)-(x>0?neighbor(i-1):intensity))/(2*dx);
        const gy=((y+1<rows?neighbor(i+cols):intensity)-(y>0?neighbor(i-cols):intensity))/(2*dy);
        // Fade relief and gloss to their neutral baseline at the sign seam.
        const fade=transition?transition[i]:1;
        const illumination=1+fade*(surfaceIllumination(gx,gy,luminosity,amplification)-1);
        if(illumination!==1){
          const luma=.2126*r+.7152*g+.0722*b,target=Math.max(.02,Math.min(.9,luma*illumination));
          if(target<luma){const gain=target/luma;r*=gain;g*=gain;b*=gain;}
          else{const mix=(target-luma)/(1-luma);r+=(1-r)*mix;g+=(1-g)*mix;b+=(1-b)*mix;}
        }
        // Bounded white reflection in linear light retains each sign's hue;
        // highlights never affect alpha, coverage, or conflict precedence.
        if(specular>0){
          const shine=fade*surfaceSpecular(gx,gy,specular,amplification);
          r+=(1-r)*shine;g+=(1-g)*shine;b+=(1-b)*shine;
        }
      }
      const offset=i*4;
      pixels[offset]=linearToSrgb[Math.round(Math.max(0,Math.min(1,r))*COLOR_STEPS)];
      pixels[offset+1]=linearToSrgb[Math.round(Math.max(0,Math.min(1,g))*COLOR_STEPS)];
      pixels[offset+2]=linearToSrgb[Math.round(Math.max(0,Math.min(1,b))*COLOR_STEPS)];
      // Luminosity carries the detail instead of fading weak cells into the
      // background. Every nonzero negative still wins, with a visible floor.
      pixels[offset+3]=Math.round(255*opacity*(.7+.3*intensity));
    }
    return pixels;
  }
  function workerSource(){
    // A self-contained Blob worker works on file:// without imports or a server.
    // Serialize the same math functions used by the UI instead of maintaining a
    // second implementation. The main-thread path remains the compatibility fallback.
    return `'use strict';
      const velocity=${M.velocity.toString()};
      const position=${M.position.toString()};
      const cross=(a,b)=>a.x*b.y-a.y*b.x;
      const encounter=${M.encounter.toString()};
      const headingSpace=${M.headingSpace.toString()};
      self.FlightMath={velocity,position,encounter,headingSpace};
      (${installDensity.toString()})(self);
      let generation=0;
      self.onmessage=({data})=>{
        const epoch=++generation;
        if(data.type==='cancel')return;
        if(data.type!=='compute')return;
        const iterator=self.FlightDensity.buildMaps(data.aircraft,{...data.settings,retainMaps:false});
        let lastProgress=0;
        const step=()=>{
          if(epoch!==generation)return;
          try{
            const began=performance.now();let item;
            do{item=iterator.next();}while(!item.done&&performance.now()-began<12);
            if(item.done){const result=item.value;self.postMessage({type:'complete',id:data.id,result},[result.positive.buffer,result.negative.buffer,result.signed.buffer]);return;}
            if(performance.now()-lastProgress>60){self.postMessage({type:'progress',id:data.id,...item.value});lastProgress=performance.now();}
            setTimeout(step,0);
          }catch(error){self.postMessage({type:'error',id:data.id,message:error.message});}
        };
        step();
      };
      self.postMessage({type:'ready'});
    `;
  }
  const api={gaussianKernel,convolve,conflictProfile,conflictCount,aircraftMap,blendMaps,buildMaps,colorize,palettes,surfaceIllumination,surfaceSpecular,workerSource};
  root.FlightDensity=api;if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof globalThis!=='undefined'?globalThis:this);
