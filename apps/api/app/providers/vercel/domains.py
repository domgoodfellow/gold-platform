"""Attaching a business's hostname to GildOps' one Vercel project, and asking how it stands.

**The only file in this repository that knows what Vercel's Domains API looks like** (I15).
Everything above it asks to *connect a hostname*, *check it* or *remove it*, and hears back in
GildOps' own words: a configuration state (`dns_required` | `satisfied`), a verification state
(`pending` | `verifying` | `verified` | `failed`), a certificate state, and the DNS records a
person has to publish. Vercel's JSON never travels further than `normalize` below. No SDK, for the
reason `app.providers.twilio.accounts` gives: each step is one HTTPS call.

**Where the account's facts live.** GildOps holds one Vercel account as a
`platform_provider_accounts` row (D62), and `read_provider_account_credential` returns exactly
five things, which this module reads as:

- `secret` -- the Vercel access token, stored in Vault, used as a bearer token.
- `credential_kind` -- `api_token`, the only mechanism Vercel offers for this API.
- `external_account_id` -- the **project** id (`prj_...`). It is the upstream parent every tenant
  hostname is attached beneath, the same position a Twilio parent Account SID holds over its
  subaccounts, and `platform_provider_accounts_external_unique` then means one GildOps row per
  project.
- `credential_identifier` -- the **team** id (`team_...`), or null for a token on a personal
  account. It is the public half that travels beside the token on every request (`?teamId=`),
  which is exactly what that column is for; `metadata` was not used because verification
  overwrites it and the credential reader does not return it.

**A failure is Vercel's own words** (D56), carried in the exception text and recorded on the row.
Vercel's error bodies carry no credential.
"""

from __future__ import annotations

from dataclasses import dataclass, field

import httpx

from app.providers.providers import HostnameUnavailable, MalformedAnswer, UpstreamRefused

API = "https://api.vercel.com"

# Vercel's documented targets, used only when a configuration answer carries no recommendation of
# its own. Named here because this is the one file allowed to know them.
_DEFAULT_APEX_ADDRESS = "76.76.21.21"
_DEFAULT_CNAME_TARGET = "cname.vercel-dns.com"


@dataclass(frozen=True)
class DomainStatus:
    """How a hostname stands, in GildOps' vocabulary. What the command layer records."""

    configuration_state: str
    verification_state: str
    ssl_state: str
    dns_records: list[dict] = field(default_factory=list)


def _scope(credential: dict) -> tuple[dict, str, dict]:
    if credential.get("credential_kind") != "api_token":
        raise UpstreamRefused(f"Unsupported credential kind: {credential.get('credential_kind')}")
    secret = credential.get("secret")
    if not secret:
        raise UpstreamRefused("This account has no credential stored.")
    project = credential.get("external_account_id")
    if not project:
        raise UpstreamRefused("This account names no project to attach domains to.")
    team = credential.get("credential_identifier")
    return {"Authorization": f"Bearer {secret}"}, project, ({"teamId": team} if team else {})


def _send(method: str, url: str, credential: dict, *, json: dict | None = None) -> httpx.Response:
    headers, _, params = _scope(credential)
    try:
        return httpx.request(method, url, headers=headers, params=params, json=json, timeout=15.0)
    except httpx.HTTPError as failure:
        raise UpstreamRefused(f"Vercel could not be reached: {type(failure).__name__}") from failure


def _body(response: httpx.Response) -> dict:
    try:
        body = response.json()
    except ValueError as failure:
        raise MalformedAnswer("Vercel answered with something that is not JSON.") from failure
    if not isinstance(body, dict):
        raise MalformedAnswer("Vercel answered with an unexpected shape.")
    return body


def _error(response: httpx.Response) -> tuple[str | None, str]:
    try:
        body = response.json()
    except ValueError:
        return None, response.text[:300]
    error = body.get("error") if isinstance(body, dict) else None
    if isinstance(error, dict):
        return error.get("code"), str(error.get("message") or response.text[:300])
    return None, response.text[:300]


def _refused(response: httpx.Response) -> UpstreamRefused:
    _, message = _error(response)
    return UpstreamRefused(f"Vercel refused the request ({response.status_code}): {message}")


def _project_path(credential: dict) -> str:
    _, project, _ = _scope(credential)
    return f"{API}/v9/projects/{project}"


def project_domain(credential: dict, hostname: str) -> dict | None:
    """The project's own record of this hostname, or `None` when it is not attached."""
    response = _send("GET", f"{_project_path(credential)}/domains/{hostname}", credential)
    if response.status_code == 404:
        return None
    if response.status_code >= 400:
        raise _refused(response)
    return _body(response)


def register(credential: dict, hostname: str) -> dict:
    """Attach the hostname to the project. Idempotent: one already attached here is fine."""
    _, project, _ = _scope(credential)
    response = _send("POST", f"{API}/v10/projects/{project}/domains", credential, json={"name": hostname})
    if response.status_code < 400:
        return _body(response)

    code, message = _error(response)
    if response.status_code == 409:
        # Already ours (a retry after a lost answer) reads back; anybody else's is theirs, and
        # Vercel's words say so without GildOps learning or repeating whose.
        existing = project_domain(credential, hostname)
        if existing is not None:
            return existing
        raise HostnameUnavailable(f"Vercel will not attach this hostname: {message}")
    if response.status_code == 400 and code in {"invalid_domain", "invalid_name", "forbidden_domain", "domain_not_allowed"}:
        raise HostnameUnavailable(f"Vercel will not attach this hostname: {message}")
    raise _refused(response)


def configuration(credential: dict, hostname: str) -> dict:
    """Whether DNS for the hostname points at Vercel, and what it should point at if not."""
    response = _send("GET", f"{API}/v6/domains/{hostname}/config", credential)
    if response.status_code >= 400:
        raise _refused(response)
    return _body(response)


def verify_ownership(credential: dict, hostname: str) -> dict | None:
    """Ask Vercel to re-check the ownership record. `None` when it is not provable yet -- an
    answer about DNS the business has still to publish, not a failure of the request."""
    response = _send("POST", f"{_project_path(credential)}/domains/{hostname}/verify", credential)
    # 400: the record is not there yet. 404: the hostname is not attached (the caller re-reads).
    if response.status_code in (400, 404):
        return None
    if response.status_code >= 400:
        raise _refused(response)
    return _body(response)


def remove(credential: dict, hostname: str) -> None:
    """Detach the hostname from the project. Already gone is gone."""
    response = _send("DELETE", f"{_project_path(credential)}/domains/{hostname}", credential)
    if response.status_code == 404 or response.status_code < 400:
        return
    raise _refused(response)


def _text(value: object, what: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise MalformedAnswer(f"Vercel's answer has no usable {what}.")
    return value.strip()


def _first_recommendation(entries: object, *, many: bool) -> str | None:
    """`recommendedIPv4` is `[{rank, value: [ip, ...]}]`; `recommendedCNAME` is `[{rank, value}]`."""
    if not isinstance(entries, list):
        return None
    ranked = sorted((e for e in entries if isinstance(e, dict)), key=lambda e: e.get("rank", 0) if isinstance(e.get("rank"), int) else 0)
    for entry in ranked:
        value = entry.get("value")
        if many and isinstance(value, list) and value and isinstance(value[0], str):
            return value[0]
        if not many and isinstance(value, str) and value:
            return value.rstrip(".")
    return None


def normalize(hostname: str, domain: dict, config: dict) -> DomainStatus:
    """Vercel's two answers about a hostname, as GildOps' states and the records to publish.

    `domain.verified` is Vercel's ownership fact; `config.misconfigured` is its DNS fact. A
    hostname GildOps will serve needs both, so `verified` here means both, and anything less is
    `verifying`. The certificate is **inferred**, not queried: Vercel issues one automatically for
    a verified, correctly pointed hostname, and none of the four calls this module makes reports
    certificate state -- so it reads `issued` exactly when the hostname is verified, and `pending`
    otherwise.
    """
    if not isinstance(domain, dict) or not isinstance(config, dict):
        raise MalformedAnswer("Vercel answered with an unexpected shape.")
    if not isinstance(domain.get("verified"), bool):
        raise MalformedAnswer("Vercel's answer does not say whether the hostname is verified.")
    if not isinstance(config.get("misconfigured"), bool):
        raise MalformedAnswer("Vercel's answer does not say whether DNS is configured.")

    owned = domain["verified"]
    misconfigured = config["misconfigured"]
    records: list[dict] = []

    if not owned:
        challenges = domain.get("verification")
        if not isinstance(challenges, list) or not challenges:
            raise MalformedAnswer("Vercel's answer names no way to prove this hostname.")
        for challenge in challenges:
            if not isinstance(challenge, dict):
                raise MalformedAnswer("Vercel's answer has an unreadable verification record.")
            records.append(
                {
                    "type": _text(challenge.get("type"), "record type").upper(),
                    "name": _text(challenge.get("domain"), "record name"),
                    "value": _text(challenge.get("value"), "record value"),
                }
            )

    if misconfigured:
        apex = domain.get("apexName") if isinstance(domain.get("apexName"), str) else hostname
        if hostname == apex:
            address = _first_recommendation(config.get("recommendedIPv4"), many=True) or _DEFAULT_APEX_ADDRESS
            records.append({"type": "A", "name": hostname, "value": address})
        else:
            target = _first_recommendation(config.get("recommendedCNAME"), many=False) or _DEFAULT_CNAME_TARGET
            records.append({"type": "CNAME", "name": hostname, "value": target})

    verified = owned and not misconfigured
    return DomainStatus(
        configuration_state="dns_required" if misconfigured else "satisfied",
        verification_state="verified" if verified else "verifying",
        ssl_state="issued" if verified else "pending",
        dns_records=records[:10],
    )


def connect(credential: dict, hostname: str) -> DomainStatus:
    """Attach, then read where it stands."""
    domain = register(credential, hostname)
    return normalize(hostname, domain, configuration(credential, hostname))


def check(credential: dict, hostname: str) -> DomainStatus:
    """Re-prove ownership, then read where it stands. A hostname Vercel no longer has attached
    (removed in its dashboard, say) is attached again rather than reported as lost -- the row
    still says the business wants it."""
    domain = verify_ownership(credential, hostname) or project_domain(credential, hostname)
    if domain is None:
        domain = register(credential, hostname)
    return normalize(hostname, domain, configuration(credential, hostname))


def verify_account(credential: dict) -> dict:
    """Does this token reach the named project. `{"ok", "error", "metadata"}`, never a raise:
    a credential that does not work is an answer, and the caller records it."""
    try:
        response = _send("GET", _project_path(credential), credential)
    except UpstreamRefused as failure:
        return {"ok": False, "error": str(failure), "metadata": {}}
    if response.status_code >= 400:
        return {"ok": False, "error": str(_refused(response)), "metadata": {}}
    try:
        body = _body(response)
    except MalformedAnswer as failure:
        return {"ok": False, "error": str(failure), "metadata": {}}
    return {"ok": True, "error": None, "metadata": {"project_name": body.get("name")}}


# Platform staff's operations on the account itself (`/providers/operate`). Domain operations are
# a tenant's and go through `app.domains.web_delivery`, never this table.
OPERATIONS = {"verify": lambda credential, args: verify_account(credential)}
