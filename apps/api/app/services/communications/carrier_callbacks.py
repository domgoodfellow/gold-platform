"""Whether a request really is the carrier, speaking for a calling account GildOps created.

**One check, shared by every carrier callback**, because the six endpoints that hear from the
carrier must not each decide this differently. The carrier signs a report with the signing secret
of the account the report is about. A business's calls happen in that business's own calling
account, so the secret is found from the account the request names -- never from one
deployment-wide value, which could only ever verify a single account.

**An account GildOps did not create has no secret here, and so can verify nothing.** That is the
whole of the "is this one of ours" test; there is no separate allow-list to keep in step.
"""

from __future__ import annotations

import logging
import os
import re

from app.core.db import carrier_signing_secret
from app.providers.twilio.voice import verify_signature

logger = logging.getLogger(__name__)

# The carrier's own shape for an account identifier. Checked before the database is asked, so a
# stranger posting junk costs a string comparison and not a query.
_ACCOUNT = re.compile(r"^AC[0-9a-fA-F]{32}$")

ACCEPTED = None


def callback_refusal(
    settings,
    *,
    url: str,
    params: dict[str, str],
    signature: str | None,
    allow_deployment_account: bool = False,
) -> int | None:
    """`None` when the request is the carrier's; otherwise the HTTP status to refuse it with.

    403 for anything that is not verifiably the carrier's. 503 when the secret could not be read:
    the carrier retries a 503, and answering 403 to a real report because the database blinked
    would discard it for good.

    `allow_deployment_account` is for text messages only. Text is still sent from the one account
    named in this deployment's environment until messaging moves to each business's own calling
    account; its reports are signed by that account. Voice never passes it.
    """
    account = (params.get("AccountSid") or "").strip()
    if not signature or not _ACCOUNT.match(account):
        return 403

    if allow_deployment_account and account == os.environ.get("TWILIO_ACCOUNT_SID"):
        secret = os.environ.get("TWILIO_AUTH_TOKEN")
    else:
        try:
            secret = carrier_signing_secret(settings, account_sid=account)
        except Exception:  # noqa: BLE001 - any failure to read is "cannot tell", never "accept"
            logger.exception("could not read a calling account's signing secret")
            return 503

    if not secret or not verify_signature(url=url, params=params, signature=signature, auth_token=secret):
        return 403
    return ACCEPTED
