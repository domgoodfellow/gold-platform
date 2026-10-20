"""Proving a business's sending domain at GildOps' one Resend account, and asking how it stands.

**The only file in this repository that knows what Resend's Domains API looks like**.
Everything above it asks to *ensure a sending domain*, *check one* or *release one*, and hears back
in GildOps' own words: a state (`pending` | `active` | `failed`), the provider's own status word
kept beside it for the sentence a person reads, and the DNS records the provider says it wants. No
SDK, for the reason `app.providers.vercel.domains` gives: each step is one HTTPS call.

**A sending domain is not a mailbox** (work order 1, section 23). Every domain this creates asks
Resend for `sending` and explicitly refuses `receiving`, so the boundary is a fact at the provider
rather than a sentence in our copy: a verified domain means Resend will authorize mail *from*
addresses under it, and nothing here makes `support@` a place mail arrives.

**Where the account's facts live.** GildOps holds one Resend account as a
`platform_provider_accounts` row and `read_provider_account_credential` returns the API key
as `secret`. Resend has no subaccounts and no per-tenant parent, so unlike the Vercel adapter there
is no `external_account_id` to scope a request by -- a tenant's domain is scoped by being recorded
against that tenant's own `organization_provider_resources` row, which is `app.services`'s job and
not this file's.

**A failure is Resend's own words**, carried in the exception text and recorded on the row.
Resend's error bodies carry no credential.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass, field

import httpx

from app.providers.providers import (
    CredentialRejected,
    HostnameUnavailable,
    MalformedAnswer,
    UpstreamRefused,
)

from app.providers.resend.base import api_base

API = api_base()

# Resend's own status words, as GildOps' resource states. `partially_verified` is `active` because
# Resend's own documentation says a domain in that state sends normally -- one of two sending
# servers is verified and the other is still pending, so there is no fallback, which is worth
# saying and is not worth refusing to send over. Everything this table does not name is `pending`:
# a status word Resend adds later is not an unreadable answer, and the provider's own word travels
# beside the state so a person still sees exactly what Resend said.
_STATE = {
    "verified": "active",
    "partially_verified": "active",
    "failed": "failed",
}

_RECORD_STATE = {"verified": "verified", "failed": "failed"}

# The record types a business can actually be asked to publish here, and the only three
# `app.valid_email_dns_records` will store. A fourth would be a record nobody could publish through
# the DNS capability and nobody could copy from a table that has no column for it, so it is refused
# loudly rather than dropped quietly -- a dropped record is a domain that never verifies and never
# says why.
_TYPES = {"MX", "TXT", "CNAME"}

# What `organization_provider_resources.resource_type` calls a sending domain beneath this
# provider's binding. Declared here because this is the module that owns the vendor's vocabulary
# (the no-vendor-SDK-in-domain rule, the same reason `TELEPHONY_RESOURCE_TYPES` lives in the telephony registry); the service
# layer resolves it through `email_domains_for` rather than spelling it.
RESOURCE_TYPE = "resend_domain"


@dataclass(frozen=True)
class RequiredRecord:
    """One record the provider wants published, in GildOps' vocabulary. `name` is absolute."""

    type: str
    name: str
    value: str
    # What the record is for, in the provider's own word (DKIM, SPF, Tracking). Shown so a person
    # reading three near-identical TXT rows can tell which is which; never branched on.
    purpose: str
    # pending | verified | failed -- the provider's view of this one record, which is what makes
    # "3 required, 1 verified" an honest sentence rather than a guess.
    status: str
    priority: int | None = None


@dataclass(frozen=True)
class EmailDomainStatus:
    """How a sending domain stands. What the service layer records."""

    external_id: str
    domain: str
    # GildOps' own resource state: pending | active | failed.
    state: str
    # Resend's own word for the same thing, unmapped.
    provider_status: str
    records: list[RequiredRecord] = field(default_factory=list)


def record_views(status: EmailDomainStatus) -> list[dict]:
    """The records as plain dictionaries, with `priority` dropped where there is none -- the shape
    `app.valid_email_dns_records` validates and `app.services.dns` ensures."""
    views = []
    for record in status.records:
        view = asdict(record)
        if view["priority"] is None:
            del view["priority"]
        views.append(view)
    return views


def _key(credential: dict) -> str:
    if credential.get("credential_kind") not in (None, "api_key", "api_token"):
        raise UpstreamRefused(f"Unsupported credential kind: {credential.get('credential_kind')}")
    secret = credential.get("secret")
    if not secret:
        raise UpstreamRefused("This account has no credential stored.")
    return str(secret)


def _send(method: str, path: str, credential: dict, *, json: dict | None = None) -> httpx.Response:
    try:
        return httpx.request(
            method,
            f"{API}{path}",
            headers={"Authorization": f"Bearer {_key(credential)}", "Content-Type": "application/json"},
            json=json,
            timeout=15.0,
        )
    except httpx.HTTPError as failure:
        raise UpstreamRefused(f"Resend could not be reached: {type(failure).__name__}") from failure


def _body(response: httpx.Response) -> dict:
    try:
        body = response.json()
    except ValueError as failure:
        raise MalformedAnswer("Resend answered with something that is not JSON.") from failure
    if not isinstance(body, dict):
        raise MalformedAnswer("Resend answered with an unexpected shape.")
    return body


def _error(response: httpx.Response) -> tuple[str | None, str]:
    """Resend's `{name, message, statusCode}`, or its raw text when it is not JSON."""
    try:
        body = response.json()
    except ValueError:
        return None, response.text[:300]
    if not isinstance(body, dict):
        return None, response.text[:300]
    name = body.get("name") if isinstance(body.get("name"), str) else None
    message = body.get("message") or body.get("error")
    return name, str(message)[:300] if message else response.text[:300]


def _refused(response: httpx.Response) -> UpstreamRefused:
    """Resend's refusal, as the narrowest thing it can be shown to mean.

    A credential problem is GildOps' own and must never read to a business as a problem with its
    domain -- so it is a different exception, and the service turns it into *the provider is
    unavailable* rather than *your domain was rejected*.

    **Resend does not answer a bad key the way its own documented error names suggest.** Its
    `missing_api_key`/`restricted_api_key`/`suspended_api_key` names do arrive at 401/403 as
    documented, but an invalid key -- the ordinary case of a revoked or mistyped one -- answers
    `400 validation_error` with the message *"API key is invalid"*: the identical shape a rejected
    *domain name* uses elsewhere in this same status/name pair (confirmed against the live API,
    work order 1 section 33). The two are told apart by the message rather than the status, because
    the status does not: this platform's own credential can be told apart from a customer's domain
    name because nothing about a domain name's rejection ever mentions a key.
    """
    name, message = _error(response)
    if response.status_code in (401, 403) and name in {
        "missing_api_key",
        "invalid_api_key",
        "restricted_api_key",
        "suspended_api_key",
    }:
        return CredentialRejected(f"Resend refused GildOps' credential ({response.status_code}): {message}")
    if response.status_code == 400 and name == "validation_error" and "api key" in message.lower():
        return CredentialRejected(f"Resend refused GildOps' credential ({response.status_code}): {message}")
    return UpstreamRefused(f"Resend refused the request ({response.status_code}): {message}")


def _text(value: object, what: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise MalformedAnswer(f"Resend's answer has no usable {what}.")
    return value.strip()


def _absolute(name: str, domain: str) -> str:
    """Resend names a record relative to the domain (`send`, `resend._domainkey`) for some records
    and absolutely (`links.example.com`) for others. A DNS host is told the whole name, so both
    arrive here as the whole name."""
    host = name.strip().lower().rstrip(".")
    root = domain.strip().lower().rstrip(".")
    if host in ("", "@"):
        return root
    if host == root or host.endswith("." + root):
        return host
    return f"{host}.{root}"


def _unquoted(value: str, record_type: str) -> str:
    """A TXT value with one layer of zone-file quoting removed.

    Resend returns its SPF value wrapped in double quotes (`"v=spf1 ..."`) and its DKIM value
    without them, because quoting is zone-file *syntax* rather than part of the value. Every DNS
    host this platform can write to or tell a person about wants the value itself, so the quotes
    come off once, here -- which also keeps the records a person copies identical to the ones the
    DNS capability publishes, rather than two spellings of the same record.
    """
    if record_type != "TXT" or len(value) < 2 or not (value.startswith('"') and value.endswith('"')):
        return value
    return value[1:-1]


def _record(raw: object, domain: str) -> RequiredRecord:
    if not isinstance(raw, dict):
        raise MalformedAnswer("Resend's answer has an unreadable DNS record.")

    record_type = _text(raw.get("type"), "record type").upper()
    if record_type not in _TYPES:
        raise MalformedAnswer(f"Resend asked for a {record_type} record, which GildOps cannot publish or display.")

    priority = raw.get("priority")
    if priority is not None and not isinstance(priority, int):
        raise MalformedAnswer("Resend's answer has an unreadable MX priority.")

    return RequiredRecord(
        type=record_type,
        name=_absolute(_text(raw.get("name"), "record name"), domain),
        value=_unquoted(_text(raw.get("value"), "record value"), record_type),
        purpose=str(raw.get("record") or "").strip()[:40],
        status=_RECORD_STATE.get(str(raw.get("status") or "").strip().lower(), "pending"),
        priority=priority if record_type == "MX" else None,
    )


def normalize(body: dict) -> EmailDomainStatus:
    """Resend's answer about one domain, as GildOps' state and the records to publish.

    Only `records` is optional: `POST /domains`, `GET /domains/{id}` and the list entries all carry
    an id, a name and a status, and a list entry carries no records at all -- which reads here as
    *no records known yet*, never as *nothing to publish*. A caller that needs the records asks for
    the domain itself.
    """
    external_id = _text(body.get("id"), "domain id")
    domain = _text(body.get("name"), "domain name")
    provider_status = _text(body.get("status"), "domain status").lower()

    raw_records = body.get("records")
    if raw_records is None:
        records: list[RequiredRecord] = []
    elif isinstance(raw_records, list):
        records = [_record(raw, domain) for raw in raw_records]
    else:
        raise MalformedAnswer("Resend's answer has an unreadable record list.")

    return EmailDomainStatus(
        external_id=external_id,
        domain=domain,
        state=_STATE.get(provider_status, "pending"),
        provider_status=provider_status,
        records=records,
    )


def create(credential: dict, domain: str) -> EmailDomainStatus:
    """Create the sending domain. Sending is asked for; receiving is refused, explicitly."""
    response = _send(
        "POST",
        "/domains",
        credential,
        json={"name": domain, "capabilities": {"sending": "enabled", "receiving": "disabled"}},
    )
    if response.status_code >= 400:
        # `_refused` first: a bad credential answers the identical `400 validation_error` shape a
        # rejected domain name does (its own docstring explains why), and asking it before
        # assuming the status/name pair means *this name* is what keeps GildOps' own key trouble
        # from being reported to a business as its domain being rejected.
        refusal = _refused(response)
        if isinstance(refusal, CredentialRejected):
            raise refusal
        name, message = _error(response)
        if response.status_code in (400, 403, 422) and name == "validation_error":
            # A fact about the name rather than about the attempt, so retrying will not help and
            # the caller fails the domain instead of leaving it waiting. "Already registered" is
            # the one case `ensure` below resolves first, by looking rather than by retrying.
            raise HostnameUnavailable(f"Resend will not take this domain: {message}")
        raise refusal
    return normalize(_body(response))


def get(credential: dict, external_id: str) -> EmailDomainStatus | None:
    """One domain and its records, or `None` when Resend no longer has it."""
    response = _send("GET", f"/domains/{external_id}", credential)
    if response.status_code == 404:
        return None
    if response.status_code >= 400:
        raise _refused(response)
    return normalize(_body(response))


def find(credential: dict, domain: str) -> str | None:
    """This account's own id for a domain by name, or `None`. What makes a retry safe: a `create`
    whose answer was lost is found here rather than attempted again."""
    response = _send("GET", "/domains", credential)
    if response.status_code >= 400:
        raise _refused(response)

    data = _body(response).get("data")
    if not isinstance(data, list):
        raise MalformedAnswer("Resend's domain list has an unexpected shape.")

    wanted = domain.strip().lower().rstrip(".")
    for entry in data:
        if isinstance(entry, dict) and str(entry.get("name") or "").strip().lower() == wanted and entry.get("id"):
            return str(entry["id"])
    return None


def verify(credential: dict, external_id: str) -> None:
    """Ask Resend to check the DNS records now.

    **Asking is not an answer.** Resend's own documentation calls this asynchronous and says it
    moves the domain to `pending` while it looks, and the body it returns carries only an id -- so
    this returns nothing, and the caller reads `get` for where the domain actually stands. A
    runtime that treated this call's 200 as verification would be recording that DNS was published,
    which is a different fact (work order 1, section 17).
    """
    response = _send("POST", f"/domains/{external_id}/verify", credential)
    if response.status_code == 404:
        raise HostnameUnavailable("Resend no longer has this domain.")
    if response.status_code >= 400:
        raise _refused(response)


def remove(credential: dict, external_id: str) -> None:
    """Delete the domain at Resend. Already gone is gone."""
    response = _send("DELETE", f"/domains/{external_id}", credential)
    if response.status_code == 404 or response.status_code < 400:
        return
    raise _refused(response)


def ensure(credential: dict, domain: str, *, external_id: str | None = None) -> EmailDomainStatus:
    """The domain at Resend, created if this account has never had it -- idempotent in all three
    ways a retry can arrive (work order 1, section 11).

    - An id already recorded reads back, and falls through to creation only if Resend has lost it.
    - No id recorded looks the domain up by name first, so a `create` whose answer never reached
      this platform is resumed rather than attempted twice.
    - A `create` that races another and is told the domain is registered already looks once more
      before deciding the name is unavailable: found means ours, and not found means Resend is
      refusing it for a reason no retry will change.
    """
    if external_id:
        existing = get(credential, external_id)
        if existing is not None:
            return existing

    found = find(credential, domain)
    if found is not None:
        existing = get(credential, found)
        if existing is not None:
            return existing

    try:
        return create(credential, domain)
    except HostnameUnavailable:
        raced = find(credential, domain)
        if raced is None:
            raise
        existing = get(credential, raced)
        if existing is None:
            raise
        return existing
