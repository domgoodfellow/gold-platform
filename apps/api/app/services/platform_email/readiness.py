"""Whether GildOps' own invitation email can be sent, judged where it is sent: in this runtime.

**Staff only, and read only.** The caller's own token proves platform staff
(`platform_email_readiness_facts` refuses anyone else), and the only provider call is Resend's
read-only list of the account's domains. Nothing is sent and nothing is written.

**No secret leaves.** The answer names which settings are missing, never their values; it gives
the From address's domain, never a key; it says which kind of credential would be used, never the
credential.

States, worst first: `not_configured` (a required setting or credential is missing),
`misconfigured` (present but wrong: the key is refused, or the From domain is not in the account),
`provider_unavailable` (Resend could not answer), `configured_unverified` (the From domain is
still being verified), `ready_for_test` (everything checks out; no delivery has been observed yet),
`live_verified` (a provider-confirmed delivery of an invitation was recorded in the last 30 days).
"""

from __future__ import annotations

import os
from datetime import datetime, timedelta, timezone

import httpx

from app.core import db
from app.core.config import ProviderOperationsSettings
from app.errors import DomainError
from app.providers.resend.accounts import sending_domains


class ReadinessForbidden(DomainError):
    status = 403
    code = "forbidden"


def _facts(settings: ProviderOperationsSettings, token: str) -> dict:
    response = httpx.post(
        f"{settings.supabase_url}/rest/v1/rpc/platform_email_readiness_facts",
        headers={"apikey": settings.supabase_publishable_key, "Authorization": f"Bearer {token}", "Content-Type": "application/json"},
        json={},
        timeout=10.0,
    )
    if response.status_code >= 400:
        raise ReadinessForbidden("Only GildOps platform staff can read email readiness.")
    rows = response.json()
    return rows[0] if rows else {}


def _recent(value: str | None, days: int = 30) -> bool:
    if not value:
        return False
    try:
        moment = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return False
    return moment >= datetime.now(timezone.utc) - timedelta(days=days)


def platform_email_readiness(settings: ProviderOperationsSettings, *, token: str) -> dict:
    facts = _facts(settings, token)
    sender = (os.environ.get("PLATFORM_EMAIL_FROM_ADDRESS") or "").strip()
    domain = sender.rsplit("@", 1)[1].lower() if sender.count("@") == 1 and sender.rsplit("@", 1)[1] else None

    account_ready = bool(facts.get("account_id")) and facts.get("account_status") == "active" and bool(facts.get("credential_set"))
    credential = db.read_provider_account_credential(settings, account_id=facts["account_id"]) if account_ready else None
    secret = credential.get("secret") if credential else None
    source = "platform_account" if secret else None
    if not secret and os.environ.get("RESEND_API_KEY"):
        secret, source = os.environ["RESEND_API_KEY"], "environment"

    checks = [
        {"key": "credential", "label": "Resend account for GildOps' own email", "state": "ok" if secret else "missing",
         "detail": {"platform_account": "The default Resend platform account holds a key.", "environment": "Using the RESEND_API_KEY bootstrap setting; no default Resend platform account holds a key."}.get(source or "", "No default Resend platform account with a key, and no RESEND_API_KEY setting.")},
        {"key": "from_address", "label": "Invitation From address (PLATFORM_EMAIL_FROM_ADDRESS)", "state": "ok" if domain else ("problem" if sender else "missing"),
         "detail": f"Sends from an address at {domain}." if domain else ("The setting is not a single email address." if sender else "The setting is not present in the API project.")},
        {"key": "invitation_webhook", "label": "Invitation delivery reports (RESEND_WEBHOOK_SECRET)", "state": "ok" if os.environ.get("RESEND_WEBHOOK_SECRET") else "missing",
         "detail": "Signing secret present. Whether Resend sends reports is shown by recorded deliveries below." if os.environ.get("RESEND_WEBHOOK_SECRET") else "Without it, delivery to the recipient is never recorded."},
        {"key": "business_webhook", "label": "Business email delivery reports and received mail (TENANT_EMAIL_WEBHOOK_SECRET)", "state": "ok" if os.environ.get("TENANT_EMAIL_WEBHOOK_SECRET") else "missing",
         "detail": "Signing secret present." if os.environ.get("TENANT_EMAIL_WEBHOOK_SECRET") else "Without it, business email delivery reports and received mail are not recorded."},
        {"key": "auth_smtp", "label": "Sign-up verification email (Supabase Auth SMTP)", "state": "unknown",
         "detail": "Not visible to GildOps. Confirm custom SMTP, templates and redirect URLs in the Supabase dashboard."},
    ]
    evidence = {key: facts.get(key) for key in ("last_delivered_at", "last_accepted_at", "last_failed_at", "last_failure")}

    def answer(state: str, detail: str, domain_status: str | None = None) -> dict:
        return {"state": state, "detail": detail, "from_domain": domain, "domain_status": domain_status, "credential_source": source, "checks": checks, "evidence": evidence}

    if not secret or not domain:
        return answer("not_configured", "GildOps' invitation email is missing a required setting.")

    listed = sending_domains(secret)
    if not listed["ok"]:
        if listed["kind"] == "rejected":
            checks[0]["state"] = "problem"
            return answer("misconfigured", listed["error"])
        return answer("provider_unavailable", listed["error"])

    match = next((row for row in listed["domains"] if row["name"] == domain), None)
    if match is None:
        return answer("misconfigured", f"{domain} is not a domain in this Resend account, so invitations from it would be refused.")
    status = match["status"]
    if status == "failed":
        return answer("misconfigured", f"Resend reports verification of {domain} failed.", status)
    if status != "verified":
        return answer("configured_unverified", f"Resend is still verifying {domain} ({status or 'no status'}).", status)
    if _recent(evidence.get("last_delivered_at")):
        return answer("live_verified", "A provider-confirmed invitation delivery was recorded in the last 30 days.", status)
    return answer("ready_for_test", "Everything checks out. No delivered invitation has been recorded yet: send one controlled test.", status)
