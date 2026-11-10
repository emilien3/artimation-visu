"""Audit both browser searches on the toy scenarios, with Python cross-checks.

Run: .venv/bin/python scripts/audit_searches.py > docs/output/artifacts/search-audit.json
Seeds 0..29, two scenarios and two altitude modes: 240 search runs.
The audit checks sampled proposals and every returned best candidate independently.
"""
import argparse
import hashlib
import json
import platform
import subprocess
import sys
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))
from artimation.conflict import Route, Scenario, evaluate, path_samples

NODE = r"""
const assert=require('node:assert/strict');
const path=require('node:path');
const root=process.argv[1], seeds=Number(process.argv[2]);
const CM=require(path.join(root,'src/artimation/web/model.js'));
const GA=require(path.join(root,'src/artimation/web/ga.js'));
const SA=require(path.join(root,'src/artimation/web/annealing.js'));
const E=require(path.join(root,'src/artimation/web/exploration.js'));
const out=[];
for(const key of ['crossing-2','convergence-4'])for(const vertical of [false,true])for(const algorithm of ['genetic','simulated-annealing'])for(let seed=0;seed<seeds;seed++){
  const scn=E.scenario(key), solver=algorithm==='genetic'?GA:SA;
  const cfg=algorithm==='genetic'?{...E.DEFAULTS,seed,vertical}:{...SA.DEFAULTS,seed,vertical};
  assert(CM.evaluate(scn.routes,scn.routes.map(()=>[0,0,0,0])).conflict>0);
  const original=CM.evaluate;let calls=0;
  CM.evaluate=(...args)=>{calls++;return original(...args)};
  const start=performance.now(),it=solver.run(scn.routes,cfg);let step,last=-Infinity;
  do{step=it.next();if(!step.done){assert(step.value.best>=last);last=step.value.best;}}while(!step.done);
  const seconds=(performance.now()-start)/1000,r=step.value;CM.evaluate=original;
  const distinct=new Set(r.genes.map(g=>JSON.stringify(g))).size;
  assert.equal(calls,distinct);assert.equal(r.genes.length,2380);
  assert.equal(r.fit[r.bestIdx],Math.max(...r.fit));
  assert(r.fit.every(f=>Number.isFinite(f)&&f>0&&f<=1));
  assert(r.conflict.every(c=>Number.isFinite(c)&&c>=0));
  for(const genes of r.genes)for(const g of genes){
    assert(g.length===4&&g.every(Number.isFinite));
    assert(g[0]>=0&&g[0]<600&&g[1]>=g[0]);
    assert(Math.abs(g[2])<=40&&g[2]%5===0);
    assert((vertical?[-2000,-1000,0,1000,2000]:[0]).includes(g[3]));
  }
  if(algorithm==='simulated-annealing'){
    let current=0;
    for(let i=1;i<r.genes.length;i++){
      assert.equal(r.parent[i],current);
      assert(r.temperature[i]>0&&r.temperature[i]<=r.temperature[i-1]);
      assert(r.genes[i].filter((g,a)=>JSON.stringify(g)!==JSON.stringify(r.genes[current][a])).length<=1);
      if(r.fit[i]>=r.fit[current])assert(r.accepted[i]);
      if(r.accepted[i])current=i;
    }
    assert.equal(current,r.currentIdx);assert(r.accepted[r.bestIdx]);
  }else{
    for(let i=0;i<r.origin.length;i++)if(!['B','G'].includes(r.origin[i])){
      const parents=r.origin[i].split('_').slice(1).map(Number);
      assert(parents.every(p=>p<i&&r.gen[p]<r.gen[i]));
    }
  }
  const reproduced=seed===0||seed===seeds-1;
  if(reproduced)assert.deepEqual(solver.runSync(scn.routes,cfg),r);
  const indices=[...new Set([0,r.bestIdx,...Array.from({length:10},(_,i)=>Math.round(i*(r.genes.length-1)/9))])];
  const samples=indices.map(i=>{
    const e=CM.evaluate(scn.routes,r.genes[i],cfg);
    assert.equal(e.fitness,r.fit[i]);assert.equal(e.conflict,r.conflict[i]);assert.equal(e.dmin,r.dmin[i]);
    return {id:i,genes:r.genes[i],fitness:e.fitness,conflict_s:e.conflict,dmin:e.dmin,extra:e.extra,
      pair:e.pair.map(row=>row.map(v=>Number.isFinite(v)?v:null)),paths:scn.routes.map((route,a)=>CM.pathSamples(route,r.genes[i][a]))};
  });
  out.push({scenario:key,algorithm,vertical,seed,config:r.cfg,seconds,recorded:r.genes.length,distinct,evaluator_calls:calls,
    reproducibility_checked:reproduced,best_id:r.bestIdx,baseline_fitness:r.fit[0],best_genes:r.best,best:samples.find(s=>s.id===r.bestIdx),
    routes:scn.routes.map(r=>({xy:r.xy,t:r.t,z:r.z})),samples,
    accepted:algorithm==='simulated-annealing'?r.accepted.filter(Boolean).length:null});
}
process.stdout.write(JSON.stringify(out));
"""


def audit(seeds):
    result = subprocess.run(["node", "-e", NODE, str(ROOT), str(seeds)], check=True, capture_output=True, text=True)
    records = json.loads(result.stdout)
    errors = dict(fitness=0.0, separation_nm=0.0, conflict_s=0.0, path_coordinate=0.0)
    sample_count = dense_pairs = disagreement_count = 0
    for run in records:
        scn = Scenario(run["scenario"], [Route(np.array(r["xy"]) * [1, -1], np.array(r["t"]), np.array(r["z"])) for r in run["routes"]])
        for sample in run["samples"]:
            ev = evaluate(scn, sample["genes"])
            differences = dict(fitness=abs(ev.fitness-sample["fitness"]), separation_nm=abs(ev.dmin-sample["dmin"]), conflict_s=abs(ev.conflict_s-sample["conflict_s"]))
            for key, value in differences.items():
                errors[key] = max(errors[key], value)
                assert value <= (1e-9 if key == "fitness" else 1e-6), (run, key, value)
            js_safe = sample["conflict_s"] == 0 and sample["dmin"] >= 7
            py_safe = ev.conflict_s == 0 and ev.dmin >= 7
            disagreement_count += js_safe != py_safe
            assert js_safe == py_safe, (run["scenario"],run["algorithm"],run["seed"],sample["id"])
            pair = np.array([[np.inf if v is None else v for v in row] for row in sample["pair"]])
            np.testing.assert_allclose(ev.pair_dmin, pair, atol=1e-6, rtol=0)
            for route, gene, p in zip(scn.routes, sample["genes"], sample["paths"]):
                x, y, z, t = path_samples(route, gene)
                py = np.column_stack([t, x, -y, z])
                js = np.column_stack([p["t"], p["x"], p["y"], p["z"]])
                np.testing.assert_allclose(py, js, atol=1e-7, rtol=0)
                errors["path_coordinate"] = max(errors["path_coordinate"], float(np.abs(py-js).max()))
            sample_count += 1
        best = run["best"]
        run["safe"] = best["conflict_s"] == 0 and best["dmin"] >= 7
        assert best["fitness"] >= run["baseline_fitness"]
        # A separate time-grid check complements, but does not replace, continuous evaluation.
        for i, pa in enumerate(best["paths"]):
            for pb in best["paths"][i+1:]:
                lo, hi = max(pa["t"][0],pb["t"][0]), min(pa["t"][-1],pb["t"][-1])
                ts = np.linspace(lo,hi,int(np.ceil((hi-lo)/.25))+1)
                dh = np.hypot(np.interp(ts,pa["t"],pa["x"])-np.interp(ts,pb["t"],pb["x"]), np.interp(ts,pa["t"],pa["y"])-np.interp(ts,pb["t"],pb["y"]))
                dz = np.abs(np.interp(ts,pa["t"],pa["z"])-np.interp(ts,pb["t"],pb["z"]))
                if run["safe"]:
                    assert not np.any((dh < 7-1e-8) & (dz < 1000-1e-8))
                dense_pairs += 1
        run["best"] = {k:v for k,v in best.items() if k not in ("paths","pair","genes")}
        del run["routes"], run["samples"]
    groups = []
    for scenario in ("crossing-2","convergence-4"):
        for vertical in (False,True):
            for algorithm in ("genetic","simulated-annealing"):
                subset = [r for r in records if r["scenario"]==scenario and r["vertical"]==vertical and r["algorithm"]==algorithm]
                failures = [r["seed"] for r in subset if not r["safe"]]
                groups.append(dict(scenario=scenario,vertical=vertical,algorithm=algorithm,runs=len(subset),safe=sum(r["safe"] for r in subset),failed_seeds=failures))
    fingerprints = {name:hashlib.sha256((ROOT/name).read_bytes()).hexdigest() for name in ("src/artimation/web/ga.js","src/artimation/web/annealing.js","src/artimation/web/model.js","src/artimation/conflict.py")}
    return dict(python=platform.python_version(),node=subprocess.check_output(["node","--version"],text=True).strip(),
                source_sha256=fingerprints,seeds=list(range(seeds)),runs=len(records),sampled_candidates_checked=sample_count,
                classification_disagreements=disagreement_count,max_python_js_errors=errors,
                best_candidate_pair_checks_on_025s_grid=dense_pairs,
                reproducibility_runs=sum(r["reproducibility_checked"] for r in records),summary=groups,records=records,
                limits="Observed resolution rates on these toy scenarios at the default budget. No optimality or universal success guarantee. The 0.25 s check cannot certify continuous safety on its own.")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--seeds", type=int, default=30)
    args = parser.parse_args()
    if args.seeds < 1:
        parser.error("--seeds must be positive")
    print(json.dumps(audit(args.seeds),indent=2,allow_nan=False))
