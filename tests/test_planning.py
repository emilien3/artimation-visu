"""Independent physics and dataset checks for the three planning methods."""
import csv
import io
import json
import shutil
import subprocess
from itertools import combinations
from pathlib import Path

import numpy as np
import pytest

from artimation.conflict import _pair_stats

ROOT = Path(__file__).resolve().parents[1]
pytestmark = pytest.mark.skipif(not shutil.which("node"), reason="Node.js is unavailable")
METHODS = ("orca", "mpc", "milp")
SCENARIOS = ("crossing-2", "convergence-4")


def node_json(code, *args):
    result = subprocess.run(["node", "-e", code, *args], cwd=ROOT, capture_output=True, text=True, check=True)
    return json.loads(result.stdout)


@pytest.mark.parametrize("method", METHODS)
def test_planning_method_invariants(method):
    subprocess.run(["node", str(Path(__file__).with_name(f"{method}_invariants.cjs"))], cwd=ROOT, check=True)


@pytest.fixture(scope="module", params=[(m, s) for m in METHODS for s in SCENARIOS], ids=lambda p: "-".join(p))
def default_execution(request):
    return node_json("""
const E=require('./src/artimation/web/exploration.js');
const solver=require('./src/artimation/web/'+process.argv[1]+'.js');
const scenario=E.scenario(process.argv[2]), result=solver.runSync(scenario.routes), data=E.dataset(scenario,result);
const ids=[...new Set([0,result.bestIdx,result.finalIdx,Math.floor(data.candidate_count/2)])];
process.stdout.write(JSON.stringify({data:{...data,candidates:data.candidates.filter(c=>ids.includes(c.candidate_id))},
  result:{bestIdx:result.bestIdx,finalIdx:result.finalIdx,termination:result.termination??result.diagnostics?.termination,
    completed:result.completed??result.diagnostics?.completed??result.certificate?.provenOptimal}}));
""", *request.param)


def independent_metrics(data, candidate):
    paths = []
    extra = 0.0
    maneuvering = 0
    for original, trajectory in zip(data["routes"], candidate["trajectories"]):
        points = np.asarray([[p["t_s"], p["x_nm"], p["y_nm"], p["z_ft"]] for p in trajectory["knots"]], float)
        time, xy, altitude = points[:, 0], points[:, 1:3] * [1, -1], points[:, 3]
        paths.append((xy, time, time, altitude))
        baseline = np.asarray(original["xy_nm"], float) * [1, -1]
        extra += max(0.0, float(np.linalg.norm(np.diff(xy, axis=0), axis=1).sum() - np.linalg.norm(np.diff(baseline, axis=0), axis=1).sum()))
        baseline_xy = np.column_stack([np.interp(time, original["t_s"], baseline[:, axis]) for axis in range(2)])
        maneuvering += int(np.any(np.linalg.norm(xy - baseline_xy, axis=1) > 1e-7))
    pair_results = [_pair_stats(paths[a], paths[b], data["config"]["sep"], data["config"]["sepV"]) for a, b in combinations(range(len(paths)), 2)]
    minimum = min(p[0] for p in pair_results)
    conflict = sum(p[1] for p in pair_results)
    weights = data["config"]["weights"]
    penalty = (weights["conflict"] * conflict + weights["shortfall"] * max(0.0, data["config"]["sep"] - minimum)
               + weights["length"] * extra + weights["maneuver"] * maneuvering)
    safe = conflict == 0 and minimum >= data["config"]["sep"]
    fitness = (0.5 if safe else 0) + 0.5 / (1 + penalty)
    return minimum, conflict, extra, maneuvering, fitness, pair_results


def test_default_executed_paths_match_independent_python(default_execution):
    data, result = default_execution["data"], default_execution["result"]
    assert result["completed"] is True
    assert data["solution_candidate_id"] == result["finalIdx"]
    selected = {c["candidate_id"]: c for c in data["candidates"]}
    final = selected[data["solution_candidate_id"]]
    assert final["label"] == "safe"
    if data["algorithm"] in ("orca", "mpc"):
        assert final["method"]["kind"] == "executed"
        assert data["best_candidate_id"] != data["solution_candidate_id"], "A historical forecast must not replace actual execution"
    else:
        assert final["method"]["kind"] == "complete-assignment"
        assert final["method"]["provenOptimal"] is True
    for candidate in data["candidates"]:
        minimum, conflict, extra, maneuvering, fitness, pairs = independent_metrics(data, candidate)
        assert candidate["min_equivalent_separation_nm"] == pytest.approx(minimum, abs=1e-7)
        assert candidate["conflict_s"] == pytest.approx(conflict, abs=1e-6)
        assert candidate["added_distance_nm"] == pytest.approx(extra, abs=1e-9)
        assert candidate["maneuvering_aircraft"] == maneuvering
        assert candidate["fitness"] == pytest.approx(fitness, abs=1e-9)
        for pair, (distance, duration) in zip(candidate["pairs"], pairs):
            assert pair["min_equivalent_separation_nm"] == pytest.approx(distance, abs=1e-7)
            assert pair["conflict_s"] == pytest.approx(duration, abs=1e-6)
        for original, trajectory in zip(data["routes"], candidate["trajectories"]):
            points = np.asarray([[p["t_s"], p["x_nm"], p["y_nm"], p["z_ft"]] for p in trajectory["knots"]], float)
            assert np.isfinite(points).all()
            assert points[0, 0] == 0
            assert np.all(np.diff(points[:, 0]) > 0)
            np.testing.assert_allclose(points[0, 1:3], original["xy_nm"][0], atol=1e-8)
            np.testing.assert_allclose(points[-1, 1:3], original["xy_nm"][-1], atol=1e-8)
            assert np.all(points[:, 3] == 36000)
            speed = np.linalg.norm(np.diff(points[:, 1:3], axis=0), axis=1) / np.diff(points[:, 0]) * 3600
            if data["algorithm"] == "orca":
                assert np.all(speed >= 0) and np.all(speed <= 360 + 1e-6)
            else:
                np.testing.assert_allclose(speed, 360, atol=1e-6)


@pytest.mark.parametrize("method", METHODS)
@pytest.mark.parametrize("scenario", SCENARIOS)
def test_planning_dataset_and_csv_preserve_record_semantics(method, scenario):
    payload = node_json("""
const E=require('./src/artimation/web/exploration.js');
const solver=require('./src/artimation/web/'+process.argv[1]+'.js'), scenario=E.scenario(process.argv[2]);
const cfg=process.argv[1]==='milp'?{starts:[0],holds:[300],angles:[-30,-10,10,30]}:{};
const result=solver.runSync(scenario.routes,cfg), data=E.dataset(scenario,result);
process.stdout.write(JSON.stringify({data,meta:result.meta,commands:result.controls,fit:result.fit,
  bestIdx:result.bestIdx,finalIdx:result.finalIdx,safe:E.csv(data,'safe'),unsafe:E.csv(data,'unsafe')}));
""", method, scenario)
    data = payload["data"]
    assert data["schema_version"] == 2
    assert data["algorithm"] == method
    assert data["best_candidate_id"] == payload["bestIdx"]
    assert data["solution_candidate_id"] == payload["finalIdx"]
    assert data["candidate_count"] == len(data["candidates"])
    assert data["candidates"][0]["method"]["kind"] == "baseline"
    assert data["candidates"][0]["label"] == "unsafe"
    assert data["candidates"][data["solution_candidate_id"]]["label"] == "safe"
    for index, candidate in enumerate(data["candidates"]):
        assert candidate["candidate_id"] == index
        assert candidate["method"] == payload["meta"][index]
        assert candidate["commands"] == payload["commands"][index]
        assert candidate["fitness"] == payload["fit"][index]
        assert candidate["generation"] is None
        assert candidate["accepted"] is None
        assert candidate["label"] == ("safe" if all(p["label"] == "safe" for p in candidate["pairs"]) else "unsafe")
        if method == "orca" and candidate["commands"]:
            local_costs = []
            for command in candidate["commands"]:
                local_cost = ((command["vx_nm_s"] - command["preferred_vx_nm_s"]) ** 2
                              + (command["vy_nm_s"] - command["preferred_vy_nm_s"]) ** 2)
                assert command["local_objective"] == pytest.approx(local_cost, abs=1e-14)
                local_costs.append(local_cost)
            assert candidate["method"]["objective"] == pytest.approx(sum(local_costs), abs=1e-12)
            expected_scope = "sum of applied local velocity objectives" if candidate["method"]["kind"] == "executed" else "sum of next-command velocity objectives"
            assert candidate["method"]["objective_scope"] == expected_scope
        for trajectory in candidate["trajectories"]:
            assert (trajectory["gene"] is None) == (method in ("orca", "mpc"))
            assert trajectory["label"] == ("unsafe" if trajectory["conflicting_aircraft"] else "safe")
        if method == "milp" and index:
            assert candidate["method"]["kind"] == "complete-assignment"
    reconstructed_commands = {}
    for label in ("safe", "unsafe"):
        reader = csv.DictReader(io.StringIO(payload[label]))
        assert len(reader.fieldnames) == 37
        rows = list(reader)
        expected = sum(len(tr["knots"]) for c in data["candidates"] for tr in c["trajectories"] if tr["label"] == label)
        assert len(rows) == expected
        seen = set()
        for row in rows:
            assert None not in row
            assert row["trajectory_label"] == label
            candidate = data["candidates"][int(row["candidate_id"])]
            trajectory = next(t for t in candidate["trajectories"] if t["aircraft_id"] == row["aircraft_id"])
            knot = trajectory["knots"][int(row["knot_index"])]
            assert row["joint_label"] == candidate["label"]
            assert row["record_type"] == candidate["method"]["kind"]
            key = (row["candidate_id"], row["aircraft_id"], row["knot_index"])
            assert key not in seen
            seen.add(key)
            for field in ("t_s", "x_nm", "y_nm", "z_ft"):
                assert float(row[field]) == pytest.approx(knot[field], abs=1e-9)
            gene_fields = ("t1_s", "t2_s", "alpha_deg_left", "dz_ft")
            if trajectory["gene"] is None:
                assert all(row[field] == "" for field in gene_fields)
            else:
                np.testing.assert_allclose([float(row[field]) for field in gene_fields], trajectory["gene"])
            command_key = (candidate["candidate_id"], row["aircraft_id"])
            if int(row["knot_index"]) == 0:
                assert command_key not in reconstructed_commands
                commands = json.loads(row["commands_json"])
                aircraft_index = data["aircraft_ids"].index(row["aircraft_id"])
                assert all(command["aircraft_index"] == aircraft_index for command in commands)
                reconstructed_commands[command_key] = commands
            else:
                assert row["commands_json"] == "", "Commands belong only to this trajectory's first CSV point"
    for candidate in data["candidates"]:
        restored = []
        for aircraft_index, aircraft_id in enumerate(data["aircraft_ids"]):
            commands = reconstructed_commands[(candidate["candidate_id"], aircraft_id)]
            expected = [command for command in candidate["commands"] if command["aircraft_index"] == aircraft_index]
            assert commands == expected
            restored.extend(commands)
        assert sorted(json.dumps(command, sort_keys=True) for command in restored) == sorted(
            json.dumps(command, sort_keys=True) for command in candidate["commands"])


def test_shared_path_evaluator_preserves_legacy_search_scores():
    result = node_json("""
const assert=require('node:assert/strict'), CM=require('./src/artimation/web/model.js'),E=require('./src/artimation/web/exploration.js');
const GA=require('./src/artimation/web/ga.js'),SA=require('./src/artimation/web/annealing.js');
let checked=0;
for(const key of ['crossing-2','convergence-4']) for(const solver of [GA,SA]) for(const vertical of [false,true]) {
 const routes=E.scenario(key).routes,result=solver.runSync(routes,{pop:12,generations:3,iterations:40,seed:3,vertical});
 for(const genes of result.genes) for(const opts of [{},{tmax:100},{weights:{length:0,maneuver:0,altitude:0}}]) {
  const legacy=CM.evaluate(routes,genes,opts), paths=CM.evaluatePaths(routes,routes.map((r,a)=>CM.fullPath(r,genes[a])),opts);
  assert.deepEqual(paths,legacy);checked++;
 }
}
const routes=E.scenario('crossing-2').routes;
for(const genes of [[[0,10,0,2000],[0,300,-20,0]],[[50,300,25,-1000],[0,0,0,0]],[[0,0,20,0],[0,0,0,0]]]) {
 assert.deepEqual(CM.evaluatePaths(routes,routes.map((r,a)=>CM.fullPath(r,genes[a]))),CM.evaluate(routes,genes)); checked++;
}
process.stdout.write(JSON.stringify({checked}));
""")
    assert result["checked"] > 900


def test_existing_search_traces_keep_their_recorded_numeric_fingerprints():
    # Captured from the four original seed-0 demo datasets before adding planning methods.
    expected = {
        "crossing-2-ga-0-60x40-2d-3b39c926": "ed880bf7a0d4013dd114187f27d44d04c550dd0f9b5af773ff520c708a37774d",
        "crossing-2-sa-0-2379-2d-0d2da4fb": "54c9cf53fd27262a4dd5edfebaaa0622e781c7bc85f521bf9e03600832798d3c",
        "convergence-4-ga-0-60x40-2d-7d325442": "06b4d2dfc8388bed0c43cf99b5b81f28c438e26ebda3606ad91f8a4215a4b150",
        "convergence-4-sa-0-2379-2d-2d07afef": "4c2e6378b9586d8ec934e817b0d22e579b89e6a7de1d4a13bcc161b6b802207e",
    }
    actual = node_json("""
const E=require('./src/artimation/web/exploration.js'),GA=require('./src/artimation/web/ga.js'),SA=require('./src/artimation/web/annealing.js'),crypto=require('node:crypto');
const fingerprints={};
for(const key of ['crossing-2','convergence-4']) for(const solver of [GA,SA]) {
 const scenario=E.scenario(key),cfg=solver===GA?E.DEFAULTS:SA.DEFAULTS,data=E.dataset(scenario,solver.runSync(scenario.routes,cfg));
 if(data.candidate_count!==2380) throw new Error('The recorded proposal budget changed');
 const values=data.candidates.map(c=>[c.trajectories.map(t=>t.gene),c.fitness,c.min_equivalent_separation_nm,c.conflict_s,c.added_distance_nm,c.maneuvering_aircraft,c.label]);
 fingerprints[data.run_id]=crypto.createHash('sha256').update(JSON.stringify(values)).digest('hex');
}
process.stdout.write(JSON.stringify(fingerprints));
""")
    assert actual == expected


@pytest.mark.parametrize("method", ("mpc", "milp"))
def test_search_without_feasible_incumbent_has_no_solution_candidate(method):
    payload = node_json("""
const E=require('./src/artimation/web/exploration.js'),solver=require('./src/artimation/web/'+process.argv[1]+'.js');
const scenario=E.scenario('crossing-2'),result=solver.runSync(scenario.routes,{nodeLimit:1}),data=E.dataset(scenario,result);
process.stdout.write(JSON.stringify({status:data.solver_status,solution:data.solution_candidate_id,candidates:data.candidates}));
""", method)
    assert payload["status"] == "node-limit"
    assert payload["solution"] is None
    assert len(payload["candidates"]) == 1
    assert payload["candidates"][0]["method"]["kind"] == "baseline"


def test_mpc_incomplete_execution_keeps_completion_status():
    payload = node_json("""
const E=require('./src/artimation/web/exploration.js'),M=require('./src/artimation/web/mpc.js');
const scenario=E.scenario('crossing-2'),result=M.runSync(scenario.routes,{maxTime:20}),data=E.dataset(scenario,result);
process.stdout.write(JSON.stringify({status:data.solver_status,final:data.candidates[data.solution_candidate_id]}));
""")
    assert payload["status"] == "max-time"
    assert payload["final"]["method"]["kind"] == "executed"
    assert payload["final"]["method"]["completed"] is False
    assert all(tr["knots"][-1]["t_s"] <= 20 for tr in payload["final"]["trajectories"])


@pytest.mark.parametrize("scenario", SCENARIOS)
def test_catalogue_certificate_matches_independent_highs_milp(scenario):
    from scipy.optimize import Bounds, LinearConstraint, milp
    from scipy.sparse import coo_matrix

    payload = node_json("""
const E=require('./src/artimation/web/exploration.js'),M=require('./src/artimation/web/milp.js');
const scenario=E.scenario(process.argv[1]),catalogues=M.makeCatalogue(scenario.routes),result=M.solveCatalogueSync(catalogues);
process.stdout.write(JSON.stringify({routes:scenario.routes,catalogues,result}));
""", scenario)
    catalogues = payload["catalogues"]
    offsets = np.cumsum([0] + [len(c) for c in catalogues])
    costs = []
    paths = []
    for original, catalogue in zip(payload["routes"], catalogues):
        baseline = np.asarray(original["xy"], float)
        length = np.linalg.norm(np.diff(baseline, axis=0), axis=1).sum()
        plane_paths = []
        for option in catalogue:
            p = option["path"]
            xy = np.column_stack([p["x"], -np.asarray(p["y"])])
            path = (xy, np.asarray(p["t"]), np.asarray(p["tz"]), np.asarray(p["z"]))
            plane_paths.append(path)
            extra = max(0.0, np.linalg.norm(np.diff(xy, axis=0), axis=1).sum() - length)
            maneuver = int(option["gene"][2] != 0 and option["gene"][1] > option["gene"][0])
            costs.append(.02 * extra + .05 * maneuver)
        paths.append(plane_paths)
    rows, columns, values = [], [], []
    lower, upper = [], []
    for i, catalogue in enumerate(catalogues):
        rows.extend([i] * len(catalogue))
        columns.extend(range(int(offsets[i]), int(offsets[i + 1])))
        values.extend([1.0] * len(catalogue))
        lower.append(1.0)
        upper.append(1.0)
    for a, b in combinations(range(len(catalogues)), 2):
        for i, pa in enumerate(paths[a]):
            for j, pb in enumerate(paths[b]):
                minimum, duration = _pair_stats(pa, pb, 7, 1000)
                if minimum >= 7 and duration == 0:
                    continue
                row = len(upper)
                rows.extend([row, row])
                columns.extend([int(offsets[a] + i), int(offsets[b] + j)])
                values.extend([1.0, 1.0])
                lower.append(-np.inf)
                upper.append(1.0)
    constraints = coo_matrix((values, (rows, columns)), shape=(len(upper), len(costs))).tocsc()
    reference = milp(np.asarray(costs), integrality=np.ones(len(costs)), bounds=Bounds(0, 1),
                     constraints=LinearConstraint(constraints, lower, upper), options={"time_limit": 20})
    assert reference.status == 0, reference.message
    assert payload["result"]["termination"] == "optimal"
    assert reference.fun == pytest.approx(payload["result"]["cost"], abs=1e-9)
    assert len(upper) - len(catalogues) == payload["result"]["incompatibilities"]
