"""Run Artimation Visu as a direct local web page: python app.py."""
import argparse
import errno
from http.client import HTTPConnection, HTTPException
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent / "src"))
from artimation.server import make_server  # noqa: E402


def _already_running(port):
    connection = HTTPConnection("127.0.0.1", port, timeout=2)
    try:
        connection.request("GET", "/")
        response = connection.getresponse()
        page = response.read(1_000_000).decode("utf-8", errors="replace")
        return response.status == 200 and all(marker in page for marker in (
            "<title>Artimation Visu</title>", 'id="studio"', 'id="exploration-lab"'))
    except (OSError, HTTPException):
        return False
    finally:
        connection.close()


def main():
    parser = argparse.ArgumentParser(description="Run Artimation Visu locally")
    parser.add_argument("--port", type=int, default=8501)
    args = parser.parse_args()
    try:
        server = make_server(port=args.port)
    except OSError as error:
        if error.errno != errno.EADDRINUSE:
            raise
        if _already_running(args.port):
            print(f"Artimation Visu is already running at http://localhost:{args.port}", flush=True)
            return 0
        alternate = args.port + 1 if args.port < 65535 else 8501
        parser.exit(1, f"Port {args.port} is already in use by another application. Run with --port {alternate} to choose another port.\n")
    with server:
        print(f"Artimation Visu: http://localhost:{server.server_port}", flush=True)
        try:
            server.serve_forever()
        except KeyboardInterrupt:
            pass


if __name__ == "__main__":
    sys.exit(main())
