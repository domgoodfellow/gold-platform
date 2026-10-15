"""Bounded customer notification jobs using the tenant email provider and canonical messages."""
from __future__ import annotations

from email.utils import formataddr

from app.core import db
from app.core.postgrest import caller_rest
from app.providers.providers import tenant_email_for

ROLE = "customer_notification_worker"
ACTOR = "00000000-0000-4000-8000-0000000000b1"


def _rpc(settings, *, function: str, payload: dict):
    token = db.machine_token(settings.supabase_jwt_secret, role=ROLE, sub=ACTOR)
    return caller_rest(settings.supabase_url, settings.supabase_publishable_key, token,
                       "POST", f"rpc/{function}", json=payload).json()


def drain_notifications(settings, *, limit: int = 20) -> dict:
    counts = {"accepted": 0, "retry": 0, "failed": 0, "held": 0}
    for _ in range(min(max(limit, 0), 20)):
        job = _rpc(settings, function="claim_customer_notification", payload={})
        if job is None:
            break
        if job.get("held"):
            counts["held"] += 1
            continue
        outcome, external_id = "retry", None
        try:
            provider = tenant_email_for(job.get("provider_key")) if job.get("provider_key") else None
            # Resolve the existing provider account beneath this sender; no platform invitation
            # identity or deployment-wide API-key fallback may substitute for it.
            credential = db.read_provider_account_credential(settings, account_id=job["provider_account_id"]) if provider and job.get("provider_account_id") else None
            if credential and credential.get("secret"):
                if not _rpc(settings, function="authorize_customer_notification_send", payload={"p_job_id": job["job_id"], "p_lease_id": job["lease_id"]}):
                    counts["held"] += 1
                    continue
                result = provider.send_tenant_email(
                    api_key=credential["secret"], idempotency_key=job["message_id"],
                    sender=formataddr((job.get("from_name") or "", job["from_address"])),
                    to=job["to"], subject=job["subject"], text=job["text"], html=None,
                    in_reply_to=None, references=[], attachments=[],
                )
                outcome = "accepted" if result["ok"] else "retry" if result.get("retryable") else "rejected"
                external_id = result.get("external_id")
        except Exception:
            # A lost provider response retries the same message within the bounded idempotency
            # window. Never log a verification code, address, credential or provider response.
            outcome = "retry"
        saved = _rpc(settings, function="finish_customer_notification", payload={
            "p_job_id": job["job_id"], "p_lease_id": job["lease_id"],
            "p_outcome": outcome, "p_external_id": external_id,
        })
        if saved:
            counts[outcome if outcome in counts else "failed"] += 1
    return counts
