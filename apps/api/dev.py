"""Serve the handlers locally, so there is somewhere to send a request that production receives.

Development only. In production Vercel invokes each file under `api/` directly and this
file is not deployed — `.vercelignore` excludes it. It exists because a Vercel function has no
server of its own, and an endpoint you cannot reach locally is an endpoint you debug in
production.

    python apps/api/dev.py
    stripe listen --forward-to http://127.0.0.1:8787/webhooks/stripe
    curl -H "Authorization: Bearer $CRON_SECRET" http://127.0.0.1:8787/tasks/automation-tick

**The routes are read out of `vercel.json` rather than written twice**, which is what the
previous version of this file said should happen when a third one landed. It landed: M6 added
the automation tick, and two lists that must agree had already been called a smell here in
writing. One list now.
"""

from __future__ import annotations

import importlib
import json
import os
import sys
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT))


def _load_env() -> None:
    """Read `.env` into the process.

    Deliberately not `python-dotenv`: this is a development entrypoint and a dependency added
    for it would ship in `requirements.txt` and reach production, where Vercel sets the
    environment itself.
    """
    env = ROOT / ".env"
    if not env.exists():
        print(f"no {env} — copy .env.example and fill it in", file=sys.stderr)
        return

    for line in env.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        os.environ.setdefault(key.strip(), value.strip())


_load_env()


def _routes() -> dict[str, type[BaseHTTPRequestHandler]]:
    """Path to handler, taken from what production is configured with.

    A rewrite's destination is a file path (`/api/automation_tick`); the handler is the
    class named `handler` inside it, which is the name Vercel requires. Reading it this way
    means a route that works here is a route that exists there.
    """
    config = json.loads((ROOT / "vercel.json").read_text(encoding="utf-8"))

    found: dict[str, type[BaseHTTPRequestHandler]] = {}
    for rewrite in config.get("rewrites", []):
        module = rewrite["destination"].strip("/").replace("/", ".")
        if (ROOT / (module.replace('.', '/') + '.mjs')).exists():
            continue
        found[rewrite["source"]] = importlib.import_module(module).handler

    return found


ROUTES = _routes()


class Router(BaseHTTPRequestHandler):
    """Dispatch by path, then run the real handler's own method.

    The handler is instantiated the way `BaseHTTPRequestHandler` expects but with the request
    already parsed, so what runs below is the deployed class rather than a copy of it — reached
    through the path check Vercel performs in production.
    """

    def do_GET(self) -> None:  # noqa: N802
        self._dispatch("do_GET")

    def do_POST(self) -> None:  # noqa: N802
        self._dispatch("do_POST")

    def _dispatch(self, method: str) -> None:
        handler = ROUTES.get(self.path.split("?", 1)[0])
        if handler is None or not hasattr(handler, method):
            self.send_response(404)
            self.send_header("content-length", "0")
            self.end_headers()
            return

        # Borrow this connection: the real handler reads `self.headers`, `self.rfile` and writes
        # to `self.wfile`, all of which are already set up here.
        proxy = handler.__new__(handler)
        proxy.headers = self.headers
        proxy.rfile = self.rfile
        proxy.wfile = self.wfile
        proxy.path = self.path
        proxy.request_version = self.request_version
        proxy.command = self.command
        proxy.send_response = self.send_response  # type: ignore[method-assign]
        proxy.send_header = self.send_header  # type: ignore[method-assign]
        proxy.end_headers = self.end_headers  # type: ignore[method-assign]
        getattr(proxy, method)()


def main() -> None:
    from app.core.config import environment_warnings

    port = int(os.environ.get("PORT", "8787"))
    print(f"apps/api on http://127.0.0.1:{port}")
    for route in ROUTES:
        print(f"  {route}")
    print(
        "\nAn endpoint whose settings are unset answers 404 rather than refusing to start —\n"
        "that path is worth being able to exercise too."
    )
    for warning in environment_warnings():
        print(f"\nwarning: {warning}")
    HTTPServer(("127.0.0.1", port), Router).serve_forever()


if __name__ == "__main__":
    main()
