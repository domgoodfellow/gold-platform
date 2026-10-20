"""Where Resend is reached.

Always `https://api.resend.com`, except that a local test run may point `RESEND_API_BASE` at a
fake provider on this machine. Anything that is not a loopback address is ignored, so a hosted
deployment cannot be redirected by this setting: real email traffic only ever goes to Resend.
"""

from __future__ import annotations

import os
from urllib.parse import urlparse

RESEND = "https://api.resend.com"


def api_base() -> str:
    override = os.environ.get("RESEND_API_BASE", "").strip().rstrip("/")
    if override and urlparse(override).hostname in ("127.0.0.1", "localhost"):
        return override
    return RESEND
