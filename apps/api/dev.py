"""Serve the handlers locally, so `stripe listen` has somewhere to forward to.

Development only. In production Vercel invokes each file under `app/api/` directly and this
file is not deployed — `.vercelignore` excludes it. It exists because a Vercel function has no
server of its own, and a webhook you cannot receive locally is a webhook you debug in
production.

    python apps/api/dev.py
    stripe listen --forward-to http://127.0.0.1:8787/webhooks/stripe

The routes below mirror `vercel.json`. Two lists that must agree, which is a smell — if a third
route lands, generate one from the other rather than adding a line to both.
"""

from __future__ import annotations

import os
import sys
from http.server import HTTPServer
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

from app.api.stripe_webhook import handler as stripe_handler  # noqa: E402

ROUTES = {"/webhooks/stripe": stripe_handler}


class Router(stripe_handler):  # type: ignore[misc, valid-type]
    """Dispatch by path, then hand off to the real handler's own method.

    Subclassing rather than wrapping keeps the handler under test identical to the handler that
    runs: `do_POST` below is the deployed one, reached through the path check Vercel performs
    for us in production.
    """

    def do_POST(self) -> None:  # noqa: N802
        path = self.path.split("?", 1)[0]
        if path not in ROUTES:
            self._reply(404, "not found")
            return
        super().do_POST()


def main() -> None:
    missing = [
        name
        for name in (
            "SUPABASE_URL",
            "SUPABASE_ANON_KEY",
            "SUPABASE_JWT_SECRET",
            "STRIPE_WEBHOOK_SECRET",
        )
        if not os.environ.get(name)
    ]
    if missing:
        # Not fatal. The handler answers 404 when unconfigured and that path is worth being
        # able to exercise, so this warns and serves rather than refusing to start.
        print(f"warning: unset {', '.join(missing)} — the webhook will answer 404", file=sys.stderr)

    port = int(os.environ.get("PORT", "8787"))
    print(f"apps/api on http://127.0.0.1:{port}")
    for route in ROUTES:
        print(f"  POST {route}")
    HTTPServer(("127.0.0.1", port), Router).serve_forever()


if __name__ == "__main__":
    main()
