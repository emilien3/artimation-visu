(function(root){
  'use strict';
  class DensityView {
    constructor(onChange){
      this.$=id=>document.getElementById(id);this.onChange=onChange;
      this.enabled=true;this.channel='blend';this.scope='all';this.colorScale='log';this.palette='classic';this.luminosity=.8;this.relief=4;this.specular=.8;this.sigma=1.5;this.cols=160;this.rows=120;
      this.token=0;this.timer=null;this.busy=false;this.latest=null;this.result=null;this.resultSnapshot=null;this.roster='';
      this.canvas=document.createElement('canvas');this.context=this.canvas.getContext('2d');
      this.worker=null;this.workerURL=null;
      try{
        if(typeof Worker==='function'){
          this.workerURL=URL.createObjectURL(new Blob([FlightDensity.workerSource()],{type:'text/javascript'}));
          this.worker=new Worker(this.workerURL);
          this.worker.onmessage=event=>{if(event.data.type==='ready')this.releaseWorkerURL();};
          this.worker.onerror=()=>{this.worker?.terminate();this.worker=null;this.releaseWorkerURL();};
        }
      }catch{this.worker=null;this.releaseWorkerURL();}
      this.$('density-channel').onchange=event=>{this.channel=event.target.value;this.paint();};
      this.$('density-scale').onchange=event=>{this.colorScale=event.target.value;this.paint();};
      this.$('density-palette').onchange=event=>{this.palette=event.target.value;this.paint();};
      this.$('density-luminosity').onchange=event=>{this.luminosity=Number(event.target.value);this.paint();};
      this.$('density-relief').onchange=event=>{
        this.relief=Number(event.target.value);
        if(this.relief>0&&this.luminosity===0){this.luminosity=.8;this.$('density-luminosity').value='0.8';}
        this.paint();
      };
      this.$('density-specular').onchange=event=>{
        this.specular=Number(event.target.value);
        if(this.specular>0){
          if(this.luminosity===0){this.luminosity=.8;this.$('density-luminosity').value='0.8';}
          if(this.relief===0){this.relief=4;this.$('density-relief').value='4';}
        }
        this.paint();
      };
      const rebuild=()=>{this.cancel();this.result=null;this.resultSnapshot=null;this.clear();this.onChange();};
      this.$('density-scope').onchange=event=>{this.scope=event.target.value;rebuild();};
      this.$('density-kernel').onchange=event=>{this.sigma=Number(event.target.value);rebuild();};
      this.$('density-grid').onchange=event=>{
        [this.cols,this.rows]=event.target.value.split('x').map(Number);rebuild();
      };
    }
    setEnabled(value){
      this.enabled=value;this.$('density-controls').hidden=!value;
      this.cancel();this.result=null;this.resultSnapshot=null;this.pixels=null;this.clear();
      this.onChange();
    }
    clear(){this.$('density-image').removeAttribute('href');this.pixels=null;this.status();}
    releaseWorkerURL(){if(this.workerURL){URL.revokeObjectURL(this.workerURL);this.workerURL=null;}}
    cancel(){this.token++;clearTimeout(this.timer);this.timer=null;this.busy=false;this.jobKey=null;this.worker?.postMessage({type:'cancel'});}
    request(aircraft,horizon,separation,sepV,time,playing){
      const roster=aircraft.map(a=>a.id).join(',');
      if(roster!==this.roster){
        this.roster=roster;const select=this.$('density-scope');select.replaceChildren(new Option('Tous','all'));
        aircraft.forEach(a=>select.add(new Option(a.id,a.id)));
        if(!aircraft.some(a=>a.id===this.scope))this.scope='all';select.value=this.scope;
      }
      if(!this.enabled)return;
      const settings={cols:this.cols,rows:this.rows,horizon,separation,sepV,sigma:this.sigma,retainMaps:false,mapIds:this.scope==='all'?null:[this.scope]};
      const key=JSON.stringify([aircraft,settings]);
      const latest={aircraft,settings,time,playing,key};
      const previous=this.latest;this.latest=latest;
      if(previous&&JSON.stringify(previous.settings)!==JSON.stringify(settings)){
        this.cancel();this.result=null;this.resultSnapshot=null;this.clear();
      }
      if(this.result&&this.resultSnapshot?.key===key){
        if(!playing&&(this.busy||this.timer)){this.cancel();this.paint();}
        this.status();return;
      }
      if(!playing){
        if(previous?.key===key&&(this.busy||this.timer))return;
        this.cancel();this.result=null;this.resultSnapshot=null;this.clear();
        this.timer=setTimeout(()=>{this.timer=null;this.start(this.latest);},80);
      }else if(!this.busy&&!this.timer){
        this.start(latest);
      }
    }
    start(snapshot){
      if(!this.enabled)return;
      const token=++this.token;this.busy=true;this.jobKey=snapshot.key;this.progress=0;this.phase='Sampling';this.progressTotal=snapshot.settings.mapIds?.length??snapshot.aircraft.length;
      const startedAt=performance.now();
      const complete=result=>{
        if(token!==this.token||!this.enabled)return;
        this.busy=false;this.elapsedMs=Math.round(performance.now()-startedAt);this.result=result;this.resultSnapshot=snapshot;this.paint();if(this.onReady)this.onReady();
        if(this.latest?.key!==snapshot.key)this.timer=setTimeout(()=>{this.timer=null;this.start(this.latest);},40);
      };
      if(this.worker){
        const fallback=()=>{
          if(token!==this.token)return;
          this.worker?.terminate();this.worker=null;this.releaseWorkerURL();this.cancel();this.start(this.latest??snapshot);
        };
        this.worker.onmessage=({data})=>{
          if(data.type==='ready'){this.releaseWorkerURL();return;}
          if(data.id!==token||token!==this.token)return;
          if(data.type==='complete')complete(data.result);
          else if(data.type==='progress'){this.progress=data.completed;this.phase=data.phase??'Sampling';this.status(snapshot);}
          else if(data.type==='error')fallback();
        };
        this.worker.onerror=fallback;
        try{this.worker.postMessage({type:'compute',id:token,aircraft:snapshot.aircraft,settings:snapshot.settings});}catch{fallback();}
        return;
      }
      const iterator=FlightDensity.buildMaps(snapshot.aircraft,snapshot.settings);
      const step=()=>{
        if(token!==this.token||!this.enabled)return;
        try{
          const started=performance.now();let next;
          do{next=iterator.next();if(!next.done){this.progress=next.value.completed;this.phase=next.value.phase??'Sampling';}}while(!next.done&&performance.now()-started<8);
          if(!next.done){this.progress=next.value.completed;this.status(snapshot);requestAnimationFrame(step);return;}
          complete(next.value);
          // Playback uses labelled snapshots; finish a complete map before starting
          // a newer one, so large fleets cannot starve the renderer indefinitely.
        }catch(error){
          this.busy=false;this.clear();this.result=null;
          this.$('density-status').textContent='Density could not be calculated. Try a smaller grid.';
          this.$('density-status').hidden=false;
          console.error('Density calculation failed',error);
        }
      };
      requestAnimationFrame(step);
    }
    status(){
      this.$('density-status').hidden=true;
      this.$('density-status').textContent='';
      
    }
    paint(){
      if(!this.enabled||!this.result)return;
      const map=this.result;
      if(!map){this.clear();return;}
      const {cols,rows}=this.result;this.canvas.width=cols;this.canvas.height=rows;
      this.pixels=FlightDensity.colorize(map,this.channel,.65,this.colorScale,this.palette,this.luminosity,this.relief,this.specular);
      this.context.putImageData(new ImageData(this.pixels,cols,rows),0,0);
      this.$('density-image').setAttribute('href',this.canvas.toDataURL('image/png'));
      this.status();
    }
  }
  root.DensityView=DensityView;
})(globalThis);
