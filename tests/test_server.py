"""The normal entrypoint serves the visualization as the top-level document."""
import errno
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import importlib
from pathlib import Path
import subprocess
import sys
import threading
from urllib.error import HTTPError
from urllib.request import urlopen

import pytest

from artimation.server import make_server

ROOT = Path(__file__).resolve().parents[1]


@pytest.fixture
def server_url():
    server = make_server(host="127.0.0.1", port=0)
    worker = threading.Thread(target=server.serve_forever, daemon=True)
    worker.start()
    try:
        yield f"http://127.0.0.1:{server.server_address[1]}"
    finally:
        server.shutdown()
        server.server_close()
        worker.join(timeout=5)


@pytest.mark.parametrize("path", ["/", "/index.html", "/?scenario=Scenario2"])
def test_http_entrypoint_is_the_actual_visualization(server_url, path):
    with urlopen(server_url + path, timeout=10) as response:
        assert response.status == 200
        assert response.headers.get_content_type() == "text/html"
        assert response.headers.get_content_charset().lower() == "utf-8"
        assert response.headers["X-Frame-Options"] == "DENY"
        html = response.read().decode("utf-8")
    assert "<title>Artimation Visu</title>" in html
    assert 'id="studio"' in html and 'id="exploration-lab"' in html
    assert "OrcaSolver" in html and "MPCSolver" in html and "MILPSolver" in html
    assert "<iframe" not in html.lower()
    assert "Prototype inspired by" not in html
    assert 'href="#studio"' not in html


def test_standalone_download_contains_the_same_application(server_url):
    with urlopen(server_url + "/download", timeout=10) as response:
        assert response.status == 200
        assert response.headers.get_content_type() == "text/html"
        assert "attachment" in response.headers["Content-Disposition"]
        assert "artimation-visu.html" in response.headers["Content-Disposition"]
        download = response.read()
    with urlopen(server_url + "/", timeout=10) as response:
        assert download == response.read()


@pytest.mark.parametrize("path", ["/missing", "/README.md", "/../app.py"])
def test_http_server_does_not_expose_workspace_files(server_url, path):
    with pytest.raises(HTTPError) as error:
        urlopen(server_url + path, timeout=10)
    assert error.value.code == 404


def test_launching_an_already_running_app_exits_cleanly(server_url):
    port = server_url.rsplit(":", 1)[1]
    result = subprocess.run([sys.executable, "app.py", "--port", port], cwd=ROOT,
                            capture_output=True, text=True, timeout=10)
    assert result.returncode == 0
    assert result.stdout.strip() == f"Artimation Visu is already running at http://localhost:{port}"
    assert result.stderr == ""
    with urlopen(server_url, timeout=10) as response:
        assert response.status == 200


def test_launching_on_another_app_port_reports_a_clear_conflict():
    class ForeignApp(BaseHTTPRequestHandler):
        def do_GET(self):
            page = b"<title>Another app</title><p>Still running</p>"
            self.send_response(200)
            self.send_header("Content-Length", str(len(page)))
            self.end_headers()
            self.wfile.write(page)

        def log_message(self, *args):
            pass

    with ThreadingHTTPServer(("127.0.0.1", 0), ForeignApp) as server:
        worker = threading.Thread(target=server.serve_forever, daemon=True)
        worker.start()
        try:
            port = server.server_port
            result = subprocess.run([sys.executable, "app.py", "--port", str(port)], cwd=ROOT,
                                    capture_output=True, text=True, timeout=10)
            assert result.returncode != 0 and result.stdout == ""
            assert f"Port {port} is already in use by another application" in result.stderr
            assert "--port" in result.stderr and "Traceback" not in result.stderr
            with urlopen(f"http://127.0.0.1:{port}/", timeout=10) as response:
                assert b"Still running" in response.read()
        finally:
            server.shutdown()
            worker.join(timeout=5)


def test_unrelated_server_errors_are_not_swallowed(monkeypatch):
    app = importlib.import_module("app")
    error = OSError(errno.EACCES, "Permission denied")

    def fail(**kwargs):
        raise error

    monkeypatch.setattr(app, "make_server", fail)
    monkeypatch.setattr(sys, "argv", ["app.py"])
    with pytest.raises(OSError) as result:
        app.main()
    assert result.value is error
