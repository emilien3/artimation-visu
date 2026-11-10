"""Serve the standalone visualization directly, without an embedded application."""
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlsplit

from .webapp import build_html


class _Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        path = urlsplit(self.path).path
        if path not in ("/", "/index.html", "/download"):
            self.send_error(404)
            return
        page = build_html().encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(page)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Frame-Options", "DENY")
        if path == "/download":
            self.send_header("Content-Disposition", 'attachment; filename="artimation-visu.html"')
        self.end_headers()
        self.wfile.write(page)


def make_server(host="127.0.0.1", port=8501):
    """Create a local HTTP server; port 0 selects an available test port."""
    return ThreadingHTTPServer((host, port), _Handler)
