"""Tests d'interface de l'application web (Selenium + Firefox sans interface) : Play, placer/glisser/orienter, GA, altitude, 2D/3D, panneaux.
Ignorés si Selenium ou Firefox sont absents."""
import shutil
import time
from pathlib import Path

import pytest

selenium = pytest.importorskip("selenium")
from selenium import webdriver  # noqa: E402
from selenium.webdriver.common.action_chains import ActionChains  # noqa: E402
from selenium.webdriver.common.by import By  # noqa: E402
from selenium.webdriver.firefox.options import Options  # noqa: E402
from selenium.webdriver.support.ui import Select  # noqa: E402

from artimation.webapp import build_html  # noqa: E402

FIREFOX = shutil.which("firefox") or "/Applications/Firefox.app/Contents/MacOS/firefox"
pytestmark = pytest.mark.skipif(not Path(FIREFOX).exists(), reason="Firefox absent")
V = "window.VectorPlus"


@pytest.fixture(scope="module")
def driver(tmp_path_factory):
    page = tmp_path_factory.mktemp("web") / "app.html"
    page.write_text(build_html(), encoding="utf-8")
    o = Options()
    o.add_argument("-headless")
    o.binary_location = FIREFOX
    try:
        d = webdriver.Firefox(options=o)
    except Exception as e:  # geckodriver indisponible hors ligne, etc.
        pytest.skip(f"Firefox pilotable indisponible : {e}")
    d.set_window_size(1500, 1350)
    d.page = page.as_uri()
    yield d
    d.quit()


@pytest.fixture
def app(driver):
    driver.get(driver.page)
    driver.execute_script("window.__errs=[];window.addEventListener('error',e=>window.__errs.push(e.message+' @'+(e.filename||'').split('/').pop()+':'+e.lineno))")
    time.sleep(1.2)
    yield driver
    assert driver.execute_script("return window.__errs") == [], "erreurs JavaScript"


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
    """Saisie d'un champ comme le ferait l'utilisateur : valeur puis validation (événement « change »)."""
    d.execute_script("const e=document.getElementById(arguments[0]); e.value=arguments[1]; e.dispatchEvent(new Event('change'))", element_id, str(value))
    time.sleep(0.25)


def pick(d, element_id, value):
    Select(d.find_element(By.ID, element_id)).select_by_value(value)
    time.sleep(0.3)


def test_loads_with_demo_and_all_scenarios(app):
    assert js(app, f"return {V}.state.aircraft.length") == 5
    assert len(app.find_elements(By.CSS_SELECTOR, "#scenario option")) == 12  # exemple + personnalisée + 10 scénarios réels


def test_play_advances_time_and_moves_aircraft(app):
    x0 = js(app, f"return {V}.current()[0].x")
    app.find_element(By.ID, "play").click()
    time.sleep(1.5)
    assert js(app, f"return {V}.state.time") > 0.3 and js(app, f"return {V}.current()[0].x") > x0 + 1
    assert app.find_element(By.ID, "run-status").text == "EN COURS"
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
    set_field(app, "speed", 5000)  # hors limites : refusé, la valeur précédente est conservée
    assert js(app, f"return {V}.state.aircraft[0].speed") == 360


def test_real_scenario_has_the_conflict_of_the_python_model(app):
    pick(app, "scenario", "Scenario2")
    assert js(app, f"return {V}.state.aircraft.map(a=>a.id)") == ["AC001", "AC002", "AC003"]
    assert 130 < js(app, f"return {V}.evaluate().conflict") < 150  # 140,4 s avec conflict.py


def test_genetic_algorithm_resolves_the_conflict_and_shows_heatmap(app):
    pick(app, "scenario", "Scenario4")
    app.find_element(By.ID, "run-ga").click()
    assert wait(app, f"return !{V}.state.gaRunning && {V}.state.ga!==null", 90)
    ev = js(app, f"return {V}.evaluate()")
    assert ev["conflict"] == 0 and ev["dmin"] >= 7 - 1e-9 and js(app, f"return {V}.state.source") == "ga"
    assert js(app, f"return {V}.state.background") == "heat" and js(app, f"return {V}.state.heat!==null")
    assert len(app.find_elements(By.CSS_SELECTOR, ".instructions li")) == 3


def test_vertical_separation_resolves_a_same_level_conflict(app):
    pick(app, "scenario", "Scenario2")
    before = js(app, f"return {V}.evaluate().conflict")
    for i, fl in ((1, "380"), (2, "400")):  # 2 000 ft entre les avions
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
        for layer in ("routes", "solution", "aircraft", "zones"):
            app.find_element(By.CSS_SELECTOR, f'[data-layer="{layer}"]').click()
        for layer in ("routes", "solution", "aircraft", "zones"):
            app.find_element(By.CSS_SELECTOR, f'[data-layer="{layer}"]').click()


def test_manual_maneuvers_and_safe_headings_panel(app):
    pick(app, "scenario", "Scenario2")
    app.execute_script("document.getElementById('panel-manual').open=true; document.getElementById('panel-manual').dispatchEvent(new Event('toggle'))")
    time.sleep(0.5)
    slider = app.find_elements(By.CSS_SELECTOR, ".manual-ac")[1].find_element(By.CSS_SELECTOR, 'input[data-k="3"]')
    js(app, "arguments[0].value=1000; arguments[0].dispatchEvent(new Event('input'))", slider)
    time.sleep(0.4)
    assert js(app, f"return {V}.state.source") == "manual" and js(app, f"return {V}.state.solutions.manual[1][3]") == 1000
    app.find_element(By.CSS_SELECTOR, 'label[for="show-solutions"]').click()
    time.sleep(0.4)
    assert "% sûr" in app.find_element(By.ID, "solution-coverage").text
