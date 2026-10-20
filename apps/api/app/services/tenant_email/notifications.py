"""Bounded customer notification jobs using the tenant email provider and canonical messages."""
from __future__ import annotations

import time
from email.utils import formataddr

from app.core import db
from app.core.postgrest import caller_rest
from app.providers.providers import tenant_email_for

ROLE = "customer_notification_worker"
ACTOR = "00000000-0000-4000-8000-0000000000b1"

# Wall-clock budget. Every call has its own bound, and a job is claimed only when the whole of it
# fits: claim, credential read, send authorization, the provider request and completion. The
# database refuses to authorize a send with less than 60 seconds of lease left, which is more than
# the provider request and completion together, so a job that starts can always be finished.
DB_TIMEOUT = 6.0
PROVIDER_TIMEOUT = 20.0
MARGIN = 5.0
FINISH_RESERVE = DB_TIMEOUT + MARGIN
JOB_BUDGET = 3 * DB_TIMEOUT + PROVIDER_TIMEOUT + FINISH_RESERVE
# Inside the 300-second function limit (`apps/api/vercel.json`), with a job's worth to spare.
INVOCATION_BUDGET = 240.0


def _rpc(settings, *, function: str, payload: dict, timeout: float):
    token = db.machine_token(settings.supabase_jwt_secret, role=ROLE, sub=ACTOR)
    return caller_rest(settings.supabase_url, settings.supabase_publishable_key, token,
                       "POST", f"rpc/{function}", json=payload, timeout=timeout).json()


def drain_notifications(settings, *, limit: int = 20, budget_seconds: float = INVOCATION_BUDGET, clock=time.monotonic) -> dict:
    deadline = clock() + budget_seconds

    def remaining() -> float:
        return deadline - clock()

    def bounded(default: float) -> float:
        return max(0.5, min(default, remaining()))

    counts = {"accepted": 0, "retry": 0, "failed": 0, "held": 0, "reconciled": 0, "deferred": 0, "unfinished": 0}
    for _ in range(min(max(limit, 0), 20)):
        if remaining() < JOB_BUDGET:
            counts["deferred"] = 1
            break
        job = _rpc(settings, function="claim_customer_notification", payload={}, timeout=bounded(DB_TIMEOUT))
        if job is None:
            break
        if job.get("held"):
            counts["reconciled" if job.get("reconciled") else "held"] += 1
            continue
        outcome, external_id = "retry", None
        try:
            provider = tenant_email_for(job.get("provider_key")) if job.get("provider_key") else None
            # The account the job is pinned to, never one resolved afresh: its current credential
            # is read each time, so a rotated key is used, but a rebound account never is. No
            # platform invitation identity or deployment-wide API key may substitute for it.
            credential = db.read_provider_account_credential(
                settings, account_id=job["provider_account_id"], timeout=bounded(DB_TIMEOUT),
            ) if provider and job.get("provider_account_id") else None
            # Authorizing marks the job as possibly sent, so it happens only when the send and its
            # completion still fit; otherwise the lease is returned untouched for a later attempt.
            if credential and credential.get("secret") and remaining() >= DB_TIMEOUT + PROVIDER_TIMEOUT + FINISH_RESERVE:
                if not _rpc(settings, function="authorize_customer_notification_send",
                            payload={"p_job_id": job["job_id"], "p_lease_id": job["lease_id"]}, timeout=bounded(DB_TIMEOUT)):
                    counts["held"] += 1
                    continue
                result = provider.send_tenant_email(
                    api_key=credential["secret"], idempotency_key=job["message_id"],
                    sender=formataddr((job.get("from_name") or "", job["from_address"])),
                    to=job["to"], subject=job["subject"], text=job["text"], html=None,
                    in_reply_to=None, references=[], attachments=[],
                    timeout=max(1.0, min(PROVIDER_TIMEOUT, remaining() - FINISH_RESERVE)),
                    reply_to=job.get("reply_to"),
                )
                outcome = "accepted" if result["ok"] else "retry" if result.get("retryable") else "rejected"
                external_id = result.get("external_id")
        except Exception:
            # A lost provider response retries the same message under the same account within the
            # bounded idempotency window. Never log a verification code, address, credential or
            # provider response.
            outcome = "retry"
        try:
            saved = _rpc(settings, function="finish_customer_notification", payload={
                "p_job_id": job["job_id"], "p_lease_id": job["lease_id"],
                "p_outcome": outcome, "p_external_id": external_id,
            }, timeout=bounded(DB_TIMEOUT))
        except Exception:
            # The send's outcome is now uncertain to this invocation. Its lease fences any late
            # completion and the next claim settles or retries it, so stop rather than claim more.
            counts["unfinished"] += 1
            break
        if saved:
            counts[outcome if outcome in counts else "failed"] += 1
    return counts
