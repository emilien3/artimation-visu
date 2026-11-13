"""Headless Firefox UI tests: workspace tabs, five methods, exports, editing and 3D.

Missing optional dependencies skip tests; a broken installed browser fails setup.
"""
import csv
import io
import json
import shutil
import threading
import time
from pathlib import Path

import pytest

selenium = pytest.importorskip("selenium")
from selenium import webdriver  # noqa: E402
from selenium.webdriver.common.action_chains import ActionChains  # noqa: E402
from selenium.webdriver.common.by import By  # noqa: E402
from selenium.webdriver.common.keys import Keys  # noqa: E402
from selenium.webdriver.common.actions.wheel_input import ScrollOrigin  # noqa: E402
from selenium.webdriver.firefox.options import Options  # noqa: E402
from selenium.webdriver.support.ui import Select  # noqa: E402

from artimation.server import make_server  # noqa: E402

FIREFOX = shutil.which("firefox") or "/Applications/Firefox.app/Contents/MacOS/firefox"
pytestmark = pytest.mark.skipif(not Path(FIREFOX).exists(), reason="Firefox absent")
V = "window.VectorPlus"


@pytest.fixture(scope="module")
def driver():
    server = make_server(host="127.0.0.1", port=0)
    worker = threading.Thread(target=server.serve_forever, daemon=True)
    worker.start()
    o = Options()
    o.add_argument("-headless")
    o.binary_location = FIREFOX
    try:
        d = webdriver.Firefox(options=o)
        d.set_window_size(1500, 1350)
        d.page = f"http://127.0.0.1:{server.server_address[1]}/"
        try:
            yield d
        finally:
            d.quit()
    finally:
        server.shutdown()
        server.server_close()
        worker.join(timeout=5)


@pytest.fixture
def app(driver):
    driver.get(driver.page)
    driver.execute_script("window.__errs=[];window.addEventListener('error',e=>window.__errs.push(e.message+' @'+(e.filename||'').split('/').pop()+':'+e.lineno))")
    time.sleep(1.2)
    yield driver
    assert driver.execute_script("return window.__errs") == [], "JavaScript errors"


def js(d, script, *a):
    return d.execute_script(script, *a)


def wait(d, cond, timeout=60):
    t = time.time()
    while time.time() - t < timeout:
        if js(d, cond):
            return True
        time.sleep(0.2)
    return False


def set_field(d, element_id, value):
    """Reveal the field, then commit its value through the same change event as user input."""
    reveal(d, d.find_element(By.ID, element_id))
    d.execute_script("const e=document.getElementById(arguments[0]); e.value=arguments[1]; e.dispatchEvent(new Event('change'))", element_id, str(value))
    time.sleep(0.25)


def pick(d, element_id, value):
    element = d.find_element(By.ID, element_id)
    reveal(d, element)
    Select(element).select_by_value(value)
    time.sleep(0.3)
    if js(d, "return !!arguments[0].closest('#display-settings')", element):
        set_details(d.find_element(By.ID, "display-settings"), False)


def set_details(element, opened=True):
    if element.get_property("open") != opened:
        element.find_element(By.XPATH, "./summary").click()


def reveal(d, element):
    ancestors = js(d, "const a=[];for(let p=arguments[0].parentElement;p;p=p.parentElement)if(p.tagName==='DETAILS')a.unshift(p);return a", element)
    for details in ancestors:
        set_details(details)


def capture_downloads(d):
    js(d, """window.__labBlobs=[];const original=URL.createObjectURL;
      URL.createObjectURL=b=>{window.__labBlobs.push(b);return original(b)};
      document.addEventListener('click',e=>{if(e.target.closest('a[download]'))e.preventDefault()});""")


def latest_download(d):
    return d.execute_async_script("const done=arguments[0];window.__labBlobs.at(-1).text().then(done)")


def test_direct_page_brand_does_not_navigate_reload_or_embed(app):
    brand = app.find_element(By.CSS_SELECTOR, ".workspace-brand")
    assert brand.text == "Artimation Visu"
    assert not brand.get_attribute("href")
    assert app.title == "Artimation Visu"
    assert not app.find_elements(By.TAG_NAME, "iframe")
    assert not app.find_elements(By.TAG_NAME, "frame")
    assert "Prototype inspired by" not in app.find_element(By.TAG_NAME, "body").text
    assert "Vector+" not in app.find_element(By.TAG_NAME, "body").text
    url = app.current_url
    js(app, "window.__navigationSentinel={};window.__originalSentinel=window.__navigationSentinel")
    original = js(app, f"return JSON.stringify({V}.state.aircraft)")
    for _ in range(3):
        brand.click()
        assert app.current_url == url
        assert js(app, "return !!window.__navigationSentinel && window.__navigationSentinel===window.__originalSentinel")
        assert js(app, f"return JSON.stringify({V}.state.aircraft)") == original
        assert not app.find_elements(By.TAG_NAME, "iframe")
    app.find_element(By.ID, "open-exploration").click()
    brand.click()
    assert app.find_element(By.ID, "exploration-lab").is_displayed()
    assert not app.find_elements(By.TAG_NAME, "iframe")
    assert app.current_url == url


def test_document_owns_scrolling_over_radar_and_sidebar(app):
    app.set_window_size(1500, 900)
    try:
        for panel in ("panel-encounters", "panel-manual", "panel-charts"):
            set_details(app.find_element(By.ID, panel))
        assert js(app, "return document.scrollingElement.scrollHeight > innerHeight + 500")
        assert js(app, """return ['.workspace','.main-panel','.sidebar'].every(selector=>{
          const element=document.querySelector(selector);
          return !['auto','scroll'].includes(getComputedStyle(element).overflowY);
        })""")
        js(app, "window.scrollTo(0,0)")
        radar = app.find_element(By.ID, "radar")
        point = js(app, "const r=arguments[0].getBoundingClientRect();return [Math.round(r.left+r.width/2),Math.round(Math.min(innerHeight-40,r.top+r.height/2))]", radar)
        ActionChains(app).scroll_from_origin(ScrollOrigin.from_viewport(*point), 0, 600).perform()
        assert wait(app, "return scrollY > 250", timeout=5)
        assert js(app, "return document.querySelector('.main-panel').scrollTop") == 0
        js(app, "window.scrollTo(0,0)")
        ActionChains(app).scroll_from_origin(ScrollOrigin.from_viewport(20, 120), 0, 600).perform()
        assert wait(app, "return scrollY > 250", timeout=5)
        assert js(app, "return document.querySelector('.sidebar').scrollTop") == 0
        ActionChains(app).scroll_by_amount(0, 10000).perform()
        assert wait(app, "const r=document.getElementById('panel-charts').getBoundingClientRect();return r.top<innerHeight && r.bottom>0", timeout=5)
    finally:
        app.set_window_size(1500, 1350)


def test_presentation_ga_exposes_every_candidate_and_preserves_studio(app):
    original = js(app, f"return JSON.stringify({V}.state.aircraft)")
    app.find_element(By.ID, "open-exploration").click()
    assert app.find_element(By.ID, "exploration-lab").is_displayed()
    assert not app.find_element(By.ID, "studio").is_displayed()
    app.find_element(By.ID, "lab-run").click()
    assert wait(app, "return !!window.TrajectoryExplorer.state.data && !window.TrajectoryExplorer.state.running")
    assert js(app, "return TrajectoryExplorer.state.data.candidate_count") == 2380
    assert len(app.find_elements(By.CSS_SELECTOR, "#lab-aircraft-plots canvas")) == 2
    set_field(app, "lab-candidate-id", 0)
    assert "Conflict" in app.find_element(By.ID, "lab-candidate-summary").text
    pick(app, "lab-candidate-filter", "safe")
    assert js(app, "return TrajectoryExplorer.state.ids.every(i=>TrajectoryExplorer.state.data.candidates[i].label==='safe')")
    app.find_element(By.ID, "lab-best").click()
    assert js(app, "return TrajectoryExplorer.state.ids[TrajectoryExplorer.state.cursor] === TrajectoryExplorer.state.data.best_candidate_id")
    js(app, "const e=document.getElementById('lab-time');e.value=300;e.dispatchEvent(new Event('input'))")
    assert "300 s" in app.find_element(By.ID, "lab-time-label").text
    app.find_element(By.ID, "close-exploration").click()
    assert app.find_element(By.ID, "studio").is_displayed()
    assert js(app, f"return JSON.stringify({V}.state.aircraft)") == original


def test_presentation_annealing_and_exports_include_rejected_candidates(app):
    app.find_element(By.ID, "open-exploration").click()
    pick(app, "lab-scenario", "convergence-4")
    pick(app, "lab-algorithm", "simulated-annealing")
    set_details(app.find_element(By.ID, "lab-settings"))
    assert app.find_element(By.ID, "lab-iterations").is_displayed()
    assert not app.find_element(By.ID, "lab-pop").is_displayed()
    app.find_element(By.ID, "lab-run").click()
    assert wait(app, "return !!TrajectoryExplorer.state.data && !TrajectoryExplorer.state.running")
    assert len(app.find_elements(By.CSS_SELECTOR, "#lab-aircraft-plots canvas")) == 4
    assert "Safe" in app.find_element(By.ID, "lab-candidate-summary").text
    pick(app, "lab-candidate-filter", "rejected")
    assert js(app, "return TrajectoryExplorer.state.ids.length>0 && TrajectoryExplorer.state.ids.every(i=>TrajectoryExplorer.state.data.candidates[i].accepted===false)")
    reveal(app, app.find_element(By.ID, "lab-selection"))
    assert "rejected" in app.find_element(By.ID, "lab-selection").text
    # Inspect the exact download payload while keeping browser downloads inside this test.
    capture_downloads(app)
    app.find_element(By.ID, "lab-export-json").click()
    exported = json.loads(latest_download(app))
    assert exported["candidate_count"] == 2380  # export ignores the rejected-candidate display filter
    assert exported["algorithm"] == "simulated-annealing"
    assert any(c["accepted"] for c in exported["candidates"])
    for element_id, label in [("lab-export-safe", "safe"), ("lab-export-unsafe", "unsafe")]:
        app.find_element(By.ID, element_id).click()
        content = latest_download(app)
        rows = list(csv.DictReader(io.StringIO(content)))
        assert rows and all(row["trajectory_label"] == label for row in rows)
    set_field(app, "lab-seed", 1)
    assert js(app, "return TrajectoryExplorer.state.data===null")
    assert not app.find_element(By.ID, "lab-results").is_displayed()


def test_presentation_validates_parameters_and_handles_empty_filter(app):
    app.find_element(By.ID, "open-exploration").click()
    set_field(app, "lab-pop", 2)
    set_field(app, "lab-generations", 0)
    app.find_element(By.ID, "lab-run").click()
    assert wait(app, "return !!TrajectoryExplorer.state.data")
    pick(app, "lab-candidate-filter", "safe")
    reveal(app, app.find_element(By.ID, "lab-selection"))
    assert "No matching record" in app.find_element(By.ID, "lab-selection").text
    assert not app.find_element(By.ID, "lab-next").is_enabled()
    pick(app, "lab-algorithm", "simulated-annealing")
    set_field(app, "lab-temperature-end", 1)
    app.find_element(By.ID, "lab-run").click()
    assert "Final temperature" in app.find_element(By.ID, "lab-status").text
    assert js(app, "return !TrajectoryExplorer.state.running && !TrajectoryExplorer.state.data")


@pytest.mark.parametrize("scenario,aircraft_count", [("crossing-2", 2), ("convergence-4", 4)])
@pytest.mark.parametrize("method", ["orca", "mpc", "milp"])
def test_planning_methods_result_filters_and_schema_two_downloads(app, scenario, aircraft_count, method):
    app.find_element(By.ID, "open-exploration").click()
    pick(app, "lab-scenario", scenario)
    pick(app, "lab-algorithm", method)
    assert not app.find_element(By.ID, "lab-pop").is_displayed()
    assert not app.find_element(By.ID, "lab-iterations").is_displayed()
    assert app.find_element(By.CSS_SELECTOR, '#lab-candidate-filter [value="accepted"]').get_attribute("disabled")
    assert app.find_element(By.CSS_SELECTOR, '#lab-candidate-filter [value="rejected"]').get_attribute("disabled")
    assert ("variable speed" in app.find_element(By.ID, "lab-model-scope").text) == (method == "orca")
    app.find_element(By.ID, "lab-run").click()
    assert wait(app, "return !TrajectoryExplorer.state.running && (!!TrajectoryExplorer.state.data || document.getElementById('lab-status').textContent.startsWith('Run failed'))")
    # Use JSON's representation, including omitted undefined fields and number encoding.
    data = json.loads(js(app, "return JSON.stringify(TrajectoryExplorer.state.data)"))
    assert data is not None, app.find_element(By.ID, "lab-status").text
    assert data["schema_version"] == 3 and data["algorithm"] == method
    assert data["scenario_id"] == scenario and len(data["aircraft_ids"]) == aircraft_count
    assert data["solver_status"] == {"orca": "reached_goals", "mpc": "completed", "milp": "optimal"}[method]
    assert len(app.find_elements(By.CSS_SELECTOR, "#lab-aircraft-plots canvas")) == aircraft_count
    solution_id = data["solution_candidate_id"]
    solution = data["candidates"][solution_id]
    assert solution["label"] == "safe" and solution["conflict_s"] == 0
    assert solution["min_equivalent_separation_nm"] >= 7
    assert js(app, "return TrajectoryExplorer.state.ids[TrajectoryExplorer.state.cursor]") == solution_id
    if method in ("orca", "mpc"):
        assert solution["method"]["kind"] == "executed"
        assert all(tr["gene"] is None for tr in solution["trajectories"])
        assert "Executed flight" in app.find_element(By.ID, "lab-candidate-summary").text
        assert any(c["method"]["kind"] == "forecast" for c in data["candidates"])
    else:
        assert solution["method"]["provenOptimal"]
        assert all(len(tr["gene"]) == 4 for tr in solution["trajectories"])
        assert "Catalogue optimum proven" in app.find_element(By.ID, "lab-status").text
    for label in ("safe", "unsafe"):
        pick(app, "lab-candidate-filter", label)
        assert js(app, "return TrajectoryExplorer.state.ids.length > 0 && TrajectoryExplorer.state.ids.every(i=>TrajectoryExplorer.state.data.candidates[i].label===arguments[0])", label)
    pick(app, "lab-path-filter", "unsafe")
    capture_downloads(app)
    app.find_element(By.ID, "lab-export-json").click()
    exported = json.loads(latest_download(app))
    assert exported == data, "Exports must include the full run despite the current record and trajectory filters"
    for element_id, label in [("lab-export-safe", "safe"), ("lab-export-unsafe", "unsafe")]:
        app.find_element(By.ID, element_id).click()
        rows = csv.DictReader(io.StringIO(latest_download(app)))
        expected = sum(len(tr["knots"]) for c in data["candidates"] for tr in c["trajectories"] if tr["label"] == label)
        count = 0
        for row in rows:
            count += 1
            assert None not in row and row["schema_version"] == "3" and row["trajectory_label"] == label
            assert row["record_type"]
            if row["knot_index"] == "0":
                commands = json.loads(row["commands_json"])
                aircraft_index = data["aircraft_ids"].index(row["aircraft_id"])
                expected_commands = [c for c in data["candidates"][int(row["candidate_id"])]["commands"] if c["aircraft_index"] == aircraft_index]
                assert commands == expected_commands
            else:
                assert row["commands_json"] == ""
            if method in ("orca", "mpc"):
                assert all(row[k] == "" for k in ("t1_s", "t2_s", "alpha_deg_left", "dz_ft"))
        assert count == expected and count > 0
    set_field(app, "lab-candidate-id", data["best_candidate_id"] if data["best_candidate_id"] != solution_id else 0)
    app.find_element(By.ID, "lab-best").click()
    assert js(app, "return TrajectoryExplorer.state.ids[TrajectoryExplorer.state.cursor]") == solution_id
    assert app.find_element(By.ID, "lab-candidate-filter").get_attribute("value") == "all"
    app.find_element(By.ID, "close-exploration").click()
    app.find_element(By.ID, "open-exploration").click()
    assert js(app, "return TrajectoryExplorer.state.data.run_id") == data["run_id"]
    assert js(app, "return TrajectoryExplorer.state.ids[TrajectoryExplorer.state.cursor]") == solution_id


def test_workspace_tabs_keyboard_accessibility_and_preserved_playback(app):
    studio = app.find_element(By.ID, "close-exploration")
    explorer = app.find_element(By.ID, "open-exploration")
    assert studio.is_displayed() and explorer.is_displayed()
    assert studio.get_attribute("role") == explorer.get_attribute("role") == "tab"
    assert studio.get_attribute("aria-selected") == "true" and explorer.get_attribute("aria-selected") == "false"
    assert studio.get_property("tabIndex") == 0 and explorer.get_property("tabIndex") == -1
    for tab, panel in [(studio, "studio"), (explorer, "exploration-lab")]:
        assert tab.get_attribute("aria-controls") == panel
        assert app.find_element(By.ID, panel).get_attribute("role") == "tabpanel"
        assert app.find_element(By.ID, panel).get_attribute("aria-labelledby") == tab.get_attribute("id")
    for element_id in ("aircraft-settings", "ga-settings", "heading-settings", "display-settings", "lab-settings"):
        assert not app.find_element(By.ID, element_id).get_property("open")
    app.find_element(By.CSS_SELECTOR, "#fleet > :nth-child(2)").click()
    assert app.find_element(By.ID, "aircraft-settings").get_property("open")
    assert js(app, f"return {V}.state.selected") == "AC002"
    original = js(app, f"return JSON.stringify({V}.state.aircraft)")
    app.find_element(By.ID, "play").click()
    assert wait(app, f"return {V}.state.time > .1")
    studio.send_keys(Keys.ARROW_RIGHT)
    assert explorer.get_attribute("aria-selected") == "true" and studio.get_attribute("aria-selected") == "false"
    assert app.switch_to.active_element.get_attribute("id") == "open-exploration"
    assert explorer.get_property("tabIndex") == 0 and studio.get_property("tabIndex") == -1
    assert app.find_element(By.ID, "exploration-lab").is_displayed() and not app.find_element(By.ID, "studio").is_displayed()
    assert not js(app, f"return {V}.state.playing")
    paused = js(app, f"return {V}.state.time")
    time.sleep(.3)
    assert js(app, f"return {V}.state.time") == paused
    pick(app, "lab-scenario", "convergence-4")
    pick(app, "lab-algorithm", "mpc")
    explorer.send_keys(Keys.HOME)
    assert studio.get_attribute("aria-selected") == "true"
    assert app.switch_to.active_element.get_attribute("id") == "close-exploration"
    assert js(app, f"return {V}.state.playing")
    assert js(app, f"return JSON.stringify({V}.state.aircraft)") == original
    assert wait(app, f"return {V}.state.time > {paused}")
    app.find_element(By.ID, "play").click()
    studio.send_keys(Keys.ARROW_RIGHT)
    assert explorer.get_attribute("aria-selected") == "true"
    assert app.find_element(By.ID, "lab-scenario").get_attribute("value") == "convergence-4"
    assert app.find_element(By.ID, "lab-algorithm").get_attribute("value") == "mpc"
    kwa = app.find_element(By.ID, "open-kwa")
    explorer.send_keys(Keys.ARROW_RIGHT)
    assert kwa.get_attribute("aria-selected") == "true"
    kwa.send_keys(Keys.ARROW_RIGHT)
    assert studio.get_attribute("aria-selected") == "true"
    studio.send_keys(Keys.ARROW_LEFT)
    assert kwa.get_attribute("aria-selected") == "true"


def test_loads_with_demo_and_all_scenarios(app):
    assert js(app, f"return {V}.state.aircraft.length") == 5
    assert len(app.find_elements(By.CSS_SELECTOR, "#scenario option")) == 12  # demo + custom + 10 real scenarios


def test_play_advances_time_and_moves_aircraft(app):
    x0 = js(app, f"return {V}.current()[0].x")
    app.find_element(By.ID, "play").click()
    time.sleep(1.5)
    assert js(app, f"return {V}.state.time") > 0.3 and js(app, f"return {V}.current()[0].x") > x0 + 1
    assert app.find_element(By.ID, "run-status").text == "RUNNING"
    app.find_element(By.ID, "play").click()
    app.find_element(By.ID, "reset").click()
    assert js(app, f"return {V}.state.time") == 0


def test_place_aircraft_by_click_in_2d(app):
    app.find_element(By.ID, "add").click()
    svg = app.find_element(By.ID, "radar")
    ActionChains(app).move_to_element(svg).move_by_offset(-svg.size["width"] * 0.25, svg.size["height"] * 0.2).click().perform()
    time.sleep(0.3)
    assert js(app, f"return {V}.state.aircraft.length") == 6 and js(app, f"return {V}.state.aircraft[5].id") == "AC006"


def test_drag_aircraft_and_steer_vector_in_2d(app):
    hit = app.find_element(By.CSS_SELECTOR, '[data-id="AC002"] .plane-hit')
    x0 = js(app, f"return {V}.state.aircraft[1].x")
    ActionChains(app).click_and_hold(hit).move_by_offset(100, -50).release().perform()
    time.sleep(0.3)
    assert js(app, f"return {V}.state.aircraft[1].x") > x0 + 5
    handle = app.find_element(By.CSS_SELECTOR, '[data-drag="velocity"][data-id="AC002"]')
    h0 = js(app, f"return {V}.state.aircraft[1].heading")
    ActionChains(app).click_and_hold(handle).move_by_offset(60, 60).release().perform()
    time.sleep(0.3)
    assert abs(js(app, f"return {V}.state.aircraft[1].heading") - h0) > 5


def test_editing_a_field_at_time_zero_and_keyboard(app):
    set_field(app, "level", 370)
    assert js(app, f"return {V}.state.aircraft[0].z") == 37000
    set_field(app, "heading", 45)
    assert js(app, f"return {V}.state.aircraft[0].heading") == 45
    set_field(app, "speed", 5000)  # Out-of-range input is rejected and the previous value remains.
    assert js(app, f"return {V}.state.aircraft[0].speed") == 360
    position = '[data-id="AC001"][data-drag="position"]'
    x0, y0 = js(app, f"return [{V}.state.aircraft[0].x, {V}.state.aircraft[0].y]")
    app.find_element(By.CSS_SELECTOR, position).send_keys(Keys.ARROW_RIGHT)
    assert js(app, f"return {V}.state.aircraft[0].x") == pytest.approx(x0 + 1)
    # Rendering replaces SVG elements; keyboard focus must stay on the aircraft.
    assert app.switch_to.active_element.get_attribute('data-id') == 'AC001'
    ActionChains(app).key_down(Keys.SHIFT).send_keys(Keys.ARROW_UP).key_up(Keys.SHIFT).perform()
    assert js(app, f"return {V}.state.aircraft[0].y") == pytest.approx(y0 - 5)


def test_real_scenario_has_the_conflict_of_the_python_model(app):
    pick(app, "scenario", "Scenario2")
    assert js(app, f"return {V}.state.aircraft.map(a=>a.id)") == ["AC001", "AC002", "AC003"]
    assert 130 < js(app, f"return {V}.evaluate().conflict") < 150  # 140.4 s in conflict.py


def test_genetic_algorithm_resolves_the_conflict_and_shows_heatmap(app):
    pick(app, "scenario", "Scenario4")
    app.find_element(By.ID, "run-ga").click()
    assert wait(app, f"return !{V}.state.gaRunning && {V}.state.ga!==null", 90)
    ev = js(app, f"return {V}.evaluate()")
    assert ev["conflict"] == 0 and ev["dmin"] >= 7 - 1e-9 and js(app, f"return {V}.state.source") == "ga"
    assert js(app, f"return {V}.state.background") == "heat" and js(app, f"return {V}.state.heat!==null")
    set_details(app.find_element(By.ID, "display-settings"))
    assert app.find_element(By.ID, 'density-kernel').is_displayed()
    assert app.find_element(By.ID, 'density-scope').is_displayed()
    set_details(app.find_element(By.ID, "display-settings"), False)
    assert len(app.find_elements(By.CSS_SELECTOR, ".instructions li")) == 3
    assert app.find_element(By.ID, 'planned-status').text == 'DISPLAYED ROUTES: conflict-free'
    assert 'Current-heading forecast' not in app.find_element(By.ID, 'crossings').text


def test_vertical_separation_resolves_a_same_level_conflict(app):
    pick(app, "scenario", "Scenario2")
    before = js(app, f"return {V}.evaluate().conflict")
    for i, fl in ((1, "380"), (2, "400")):  # 2,000 ft between aircraft
        js(app, f"document.getElementById('fleet').children[{i}].click()")
        set_field(app, "level", fl)
    assert before > 100 and js(app, f"return {V}.evaluate().conflict") == 0
    assert js(app, "return document.getElementById('risk-count').textContent") == "0"


@pytest.mark.parametrize("axis", ["alt", "time", "relief"])
def test_3d_view_drag_orbit_place_play(app, axis):
    pick(app, "view", "3d")
    pick(app, "axis", axis)
    cv = app.find_element(By.ID, "view3d")
    r = cv.rect
    hits = js(app, f"return {V}.view3d().hits.filter(h=>h.kind==='position').map(h=>[h.id,h.x,h.y])")
    assert len(hits) == 5
    hid, hx, hy = hits[1]
    a0 = js(app, f"const a={V}.state.aircraft.find(a=>a.id==='{hid}'); return [a.x,a.y]")
    ActionChains(app).move_to_element_with_offset(cv, hx - r["width"] / 2, hy - r["height"] / 2).click_and_hold().move_by_offset(80, 30).release().perform()
    time.sleep(0.3)
    a1 = js(app, f"const a={V}.state.aircraft.find(a=>a.id==='{hid}'); return [a.x,a.y]")
    assert abs(a1[0] - a0[0]) + abs(a1[1] - a0[1]) > 3
    az0 = js(app, f"return {V}.view3d().az")
    ActionChains(app).move_to_element_with_offset(cv, -r["width"] * 0.4, -r["height"] * 0.4).click_and_hold().move_by_offset(100, 20).release().perform()
    assert abs(js(app, f"return {V}.view3d().az") - az0) > 0.2
    app.find_element(By.ID, "add").click()
    ActionChains(app).move_to_element_with_offset(cv, 0, 40).click().perform()
    time.sleep(0.3)
    assert js(app, f"return {V}.state.aircraft.length") == 6
    t0 = js(app, f"return {V}.state.time")
    app.find_element(By.ID, "play").click(); time.sleep(1); app.find_element(By.ID, "play").click()
    assert js(app, f"return {V}.state.time") > t0 + 0.2


def test_same_layers_2d_and_3d_and_backgrounds(app):
    pick(app, "scenario", "Scenario2")
    app.find_element(By.ID, "run-ga").click()
    assert wait(app, f"return !{V}.state.gaRunning && {V}.state.ga!==null", 90)
    for view in ("2d", "3d"):
        pick(app, "view", view)
        for bg in ("heat", "density", "none"):
            pick(app, "background", bg)
            time.sleep(0.5 if bg == "density" else 0.2)
        set_details(app.find_element(By.ID, "display-settings"))
        for layer in ("routes", "solution", "aircraft", "zones"):
            app.find_element(By.CSS_SELECTOR, f'[data-layer="{layer}"]').click()
        for layer in ("routes", "solution", "aircraft", "zones"):
            app.find_element(By.CSS_SELECTOR, f'[data-layer="{layer}"]').click()
        set_details(app.find_element(By.ID, "display-settings"), False)


def test_manual_maneuvers_and_safe_headings_panel(app):
    pick(app, "scenario", "Scenario2")
    set_details(app.find_element(By.ID, "panel-manual"))
    time.sleep(0.5)
    slider = app.find_elements(By.CSS_SELECTOR, ".manual-ac")[1].find_element(By.CSS_SELECTOR, 'input[data-k="3"]')
    js(app, "arguments[0].value=1000; arguments[0].dispatchEvent(new Event('input'))", slider)
    time.sleep(0.4)
    assert js(app, f"return {V}.state.source") == "manual" and js(app, f"return {V}.state.solutions.manual[1][3]") == 1000
    set_details(app.find_element(By.ID, "heading-settings"))
    app.find_element(By.CSS_SELECTOR, 'label[for="show-solutions"]').click()
    time.sleep(0.4)
    assert "% safe" in app.find_element(By.ID, "solution-coverage").text


def test_fitness_controls_and_ga_kernel(app):
    pick(app, 'scenario', 'Scenario4')
    reveal(app, app.find_element(By.ID, 'weight-conflict'))
    before = js(app, f'return {V}.evaluate().fitness')
    set_field(app, 'weight-conflict', 0)
    set_field(app, 'weight-shortfall', 0)
    assert before < js(app, f'return {V}.evaluate().fitness') < .5
    set_field(app, 'weight-length', -1)
    assert js(app, f'return {V}.state.weights.length') == .02
    set_field(app, 'weight-length', .7)
    set_field(app, 'ga-pop', 30)
    set_field(app, 'ga-gens', 15)
    app.find_element(By.ID, 'run-ga').click()
    assert wait(app, f'return !{V}.state.gaRunning && {V}.state.ga !== null')
    assert js(app, f'return {V}.state.ga.cfg.weights.length') == .7
    assert js(app, f'return {V}.evaluate().fitness') == js(app, f'return {V}.state.ga.fit[{V}.state.ga.bestIdx]')
    genes = js(app, f'return {V}.shownGenes()')
    fitness = js(app, f'return {V}.evaluate().fitness')
    pick(app, 'density-kernel', '0')
    raw_image = js(app, "return document.getElementById('heat-image').getAttribute('href')")
    pick(app, 'density-kernel', '3')
    blurred_image = js(app, "return document.getElementById('heat-image').getAttribute('href')")
    assert raw_image and blurred_image and raw_image != blurred_image
    assert js(app, f'return {V}.shownGenes()') == genes
    assert js(app, f'return {V}.evaluate().fitness') == fitness
    # An impulse verifies that the rendered GA map spreads symmetrically.
    js(app, f"""const values = new Float32Array(81); values[40] = 1;
      {V}.state.heat = {{cols:9, rows:9, width:9, height:9, safe:[values], unsafe:[new Float32Array(81)]}};
      {V}.state.heatRev++; {V}.render();""")
    assert js(app, """return new Promise(resolve => {
      const im = new Image(); im.onload = () => {
        const c = document.createElement('canvas'); c.width = c.height = 9;
        const ctx = c.getContext('2d'); ctx.drawImage(im,0,0);
        const pixels = ctx.getImageData(0,0,9,9).data;
        resolve(pixels[(4*9+3)*4+3] > 0 && pixels[(4*9+3)*4+3] === pixels[(4*9+5)*4+3]);
      }; im.src = document.getElementById('heat-image').getAttribute('href');
    })""")
    app.find_element(By.ID, 'reset-weights').click()
    assert js(app, f'return {V}.state.weights.length') == .02
    assert js(app, f'return {V}.state.ga === null && {V}.state.heat === null')
    assert js(app, f'return {V}.shownGenes()') == genes
    assert 're-scored' in app.find_element(By.ID, 'ga-status').text
    # Changing weights during a run must cancel its callback, not overwrite the next run.
    js(app, f"""document.getElementById('ga-pop').value = 100;
      document.getElementById('ga-gens').value = 100;
      {V}.runGA();
      const input = document.getElementById('weight-length'); input.value = .9;
      input.dispatchEvent(new Event('change'));
      document.getElementById('ga-pop').value = 30;
      document.getElementById('ga-gens').value = 15;
      {V}.runGA();""")
    assert wait(app, f'return !{V}.state.gaRunning && {V}.state.ga !== null')
    assert js(app, f'return {V}.state.ga.cfg.weights.length') == .9
    assert js(app, f'return {V}.evaluate().fitness') == js(app, f'return {V}.state.ga.fit[{V}.state.ga.bestIdx]')


def test_separation_zones_match_current_horizontal_and_vertical_conflicts(app, tmp_path):
    def scene(distance, altitude):
        js(app, f"""const s={V}.state; s.rev++; s.time=0; s.source='none';
          s.aircraft=[{{id:'A',x:40,y:40,z:36000,speed:360,heading:90,vz:0}},
                      {{id:'B',x:40+arguments[0],y:40,z:36000+arguments[1],speed:360,heading:90,vz:0}}];
          s.selected='A'; s.routes=s.aircraft.map(a=>ConflictModel.makeRoute([[a.x,a.y],[a.x+20,a.y]],[0,200],[a.z,a.z]));
          {V}.render();""", distance, altitude)

    scene(10, 0)
    circles = app.find_elements(By.CSS_SELECTOR, '[data-zone]')
    assert len(circles) == 2 and all(float(c.get_attribute('r')) == 35 for c in circles)
    assert all(c.get_attribute('data-conflict') == 'false' for c in circles)
    scene(6, 0)
    assert len(app.find_elements(By.CSS_SELECTOR, '[data-zone][data-conflict="true"]')) == 2
    assert 'loss-of-separation pair' in app.find_element(By.ID, 'separation-status').text
    scene(6, 1000)
    assert not app.find_elements(By.CSS_SELECTOR, '[data-zone][data-conflict="true"]')
    assert 'VERTICALLY SEPARATED' in app.find_element(By.CSS_SELECTOR, '[data-zone-pair]').text
    app.find_element(By.ID, 'radar-wrap').screenshot(str(tmp_path / 'vertically-separated-zones.png'))
    scene(7, 0)
    assert not app.find_elements(By.CSS_SELECTOR, '[data-zone-pair]')
    scene(6, 1000)
    pick(app, 'sepv', '0')
    assert len(app.find_elements(By.CSS_SELECTOR, '[data-zone][data-conflict="true"]')) == 2
    pick(app, 'sepv', '1000')
    # The selected aircraft obeys the same layer switch as every other aircraft.
    set_details(app.find_element(By.ID, "display-settings"))
    app.find_element(By.CSS_SELECTOR, '[data-layer="zones"]').click()
    assert not app.find_elements(By.CSS_SELECTOR, '[data-zone]')
    app.find_element(By.CSS_SELECTOR, '[data-layer="zones"]').click()
    set_details(app.find_element(By.ID, "display-settings"), False)
    pick(app, 'view', '3d')
    assert js(app, f'return {V}.view3d().data.aircraft.every(a=>a.zone.radius===3.5 && a.zone.halfHeight===500 && !a.zone.conflict)')
    app.find_element(By.ID, 'radar-wrap').screenshot(str(tmp_path / 'separation-cylinders-3d.png'))
    # Capture rendered cylinder radii, not only the view input.
    assert js(app, f"""const v={V}.view3d(), original=v.circle, radii=[];
      v.circle=function(c,x,y,r,...args){{radii.push(r);return original.call(this,c,x,y,r,...args)}};
      v.render(); v.circle=original; return radii.length===4 && radii.every(r=>r===3.5);""")
    pick(app, 'view', '2d')
    # Playback updates current separation using actual altitude, not the forecast.
    js(app, f"""{V}.state.routes[1].z=[36000,38000]; {V}.state.time=0; {V}.render();""")
    assert app.find_elements(By.CSS_SELECTOR, '[data-zone][data-conflict="true"]')
    js(app, f'{V}.state.time=2; {V}.render();')
    assert not app.find_elements(By.CSS_SELECTOR, '[data-zone][data-conflict="true"]')


def test_kwa_tab_steps_render_and_respond(app):
    kwa = app.find_element(By.ID, "open-kwa")
    app.find_element(By.ID, "close-exploration").send_keys(Keys.END)
    assert kwa.get_attribute("aria-selected") == "true" and app.find_element(By.ID, "kwa-lab").is_displayed()
    assert not app.find_element(By.ID, "studio").is_displayed()
    for paper, steps in (("arrivals", 7), ("drones", 6), ("stollenwerk", 6)):
        app.find_element(By.ID, f"kwa-paper-{paper}").click()
        assert len(app.find_elements(By.CSS_SELECTOR, "#kwa-steps button")) == steps
        for index in range(steps):
            js(app, f"KwaView.select('{paper}', {index})")
            assert app.find_element(By.CSS_SELECTOR, "#kwa-steps [aria-current=step]").text.startswith(str(index + 1))
            assert app.find_element(By.ID, "kwa-caption").text
            assert app.find_elements(By.CSS_SELECTOR, "#kwa-stats > div")
            painted = "const c=document.getElementById('kwa-canvas'),d=c.getContext('2d').getImageData(0,0,c.width,c.height).data;let n=0;for(let k=3;k<d.length;k+=4)if(d[k])n++;return n"
            assert js(app, painted) > 20000
    app.find_element(By.ID, "kwa-prev").click()
    assert js(app, "return KwaView.state.step.stollenwerk") == 4
    js(app, "KwaView.select('drones', 4)")
    js(app, "KwaPapers.drones.state.K = 1e8; KwaView.render()")
    assert "illegal command" in app.find_element(By.ID, "kwa-stats").text
