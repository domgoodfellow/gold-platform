"""Connecting, checking and removing a business's custom domain.

**Authorization is proved before the credential is read, and RLS proves it.** The caller's own
token asks `can_manage_custom_domains` (membership and `organization.manage`) and selects the
domain row (a business sees its own and nobody else's, so an empty answer means *not yours, or no
such domain* -- I18's ambiguous refusal). Only then does this mint the machine token that may learn
which GildOps account answers, read that account's credential, and record what the provider said.

**Every outcome is recorded before it is returned.** A hosting account nobody has configured, a
hostname the provider will not take, a provider that refused or answered nonsense: each is written
onto the row (`error_code`, `error_message`) by the same machine role that asked, so the Domains
page can say what happened after the dialog is closed (D44: a failure is a row, not a toast).

**Nothing here names a vendor.** `app.providers.domain_hosting_for` turns the row's own provider
key into a module; this file sequences it and speaks GildOps' vocabulary only.
"""

from __future__ import annotations

from dataclasses import asdict

import httpx

from app.core import db
from app.core.config import IntegrationSettings, ProviderOperationsSettings
from app.core.postgrest import caller_rest
from app.errors import DomainError, NotFoundError, ValidationError
from app.providers.providers import HostnameUnavailable, MalformedAnswer, UpstreamRefused, domain_hosting_for
from app.services.dns.operations import ensure_required_records, preview_automation

PROVIDER_UNAVAILABLE_MESSAGE = (
    "Custom domains are not available on this deployment yet: GildOps has no hosting account configured."
)


class ProviderUnavailableError(DomainError):
    """No GildOps hosting account can answer -- a platform fact, never a DNS problem."""

    status = 503
    code = "provider_unavailable"


class ProviderRefusedError(DomainError):
    """The provider refused, could not be reached, or answered in a shape nobody can read."""

    status = 502
    code = "provider_refused"


class HostnameUnavailableError(DomainError):
    """The provider will not take this hostname. Says nothing about who has it."""

    status = 409
    code = "hostname_unavailable"


def _rest(settings: ProviderOperationsSettings, token: str, method: str, path: str, **kwargs) -> httpx.Response:
    """A call to PostgREST under the caller's own token -- RLS answers, not this runtime."""
    return caller_rest(settings.supabase_url, settings.supabase_publishable_key, token, method, path, **kwargs)


def _domain(settings: ProviderOperationsSettings, token: str, organization_id: str, domain_id: str) -> dict:
    if not organization_id or not domain_id:
        raise ValidationError("A business and a domain are both required.")

    allowed = _rest(
        settings, token, "POST", "rpc/can_manage_custom_domains", json={"p_organization_id": organization_id}
    ).json()
    if allowed is not True:
        raise NotFoundError("No such domain.")

    rows = _rest(
        settings,
        token,
        "GET",
        "organization_domains",
        params={
            "id": f"eq.{domain_id}",
            "organization_id": f"eq.{organization_id}",
            "released_at": "is.null",
            "select": "id,hostname,provider_key,provider_resource_id,verification_state",
        },
    ).json()
    if not rows:
        raise NotFoundError("No such domain.")
    return rows[0]


def _credential(settings: ProviderOperationsSettings, organization_id: str, row: dict) -> dict | None:
    account_id = db.custom_domain_provider_account(settings, organization_id=organization_id, domain_id=row["id"])
    if not account_id:
        return None
    credential = db.read_provider_account_credential(settings, account_id=account_id)
    if credential is None or credential.get("provider_key") != row["provider_key"]:
        return None
    return credential


def _view(row: dict, status, *, dns_settings: IntegrationSettings | None = None, token: str | None = None, organization_id: str | None = None) -> dict:
    """GildOps' own vocabulary for a domain's standing, plus -- only when DNS is still needed --
    whether a connected Cloudflare zone *could* answer for it. Read-only: this never writes a
    record. A caller offers the review step on `dns_automation.available`; nothing here applies
    anything (work order 1 closeout, section 3)."""
    view = {"domain_id": row["id"], "hostname": row["hostname"], **asdict(status)}
    if status.configuration_state == "dns_required" and status.dns_records and dns_settings is not None:
        preview = preview_automation(dns_settings, token=token, organization_id=organization_id, hostname=row["hostname"])
        view["dns_automation"] = {"available": preview.available, "connectionId": preview.connection_id, "zoneName": preview.zone_name}
    else:
        view["dns_automation"] = {"available": False, "connectionId": None, "zoneName": None}
    return view


def _hosting(row: dict):
    hosting = domain_hosting_for(row["provider_key"])
    if hosting is None:
        raise ProviderUnavailableError(PROVIDER_UNAVAILABLE_MESSAGE)
    return hosting


def _unavailable(settings: ProviderOperationsSettings, organization_id: str, row: dict) -> ProviderUnavailableError:
    db.record_custom_domain_registration(
        settings,
        organization_id=organization_id,
        domain_id=row["id"],
        configuration_state="dns_required",
        dns_records=[],
        error_code="provider_unavailable",
        error_message=PROVIDER_UNAVAILABLE_MESSAGE,
    )
    return ProviderUnavailableError(PROVIDER_UNAVAILABLE_MESSAGE)


def connect_domain(
    settings: ProviderOperationsSettings,
    *,
    token: str,
    organization_id: str,
    domain_id: str,
    hostname: str | None = None,
    dns_settings: IntegrationSettings | None = None,
) -> dict:
    """Attach a pending domain at the provider and record where it stands."""
    row = _domain(settings, token, organization_id, domain_id)
    if hostname is not None and hostname.strip().lower().rstrip(".") != row["hostname"]:
        raise ValidationError("That hostname is not the one this domain names.")

    credential = _credential(settings, organization_id, row)
    if credential is None:
        raise _unavailable(settings, organization_id, row)
    hosting = _hosting(row)

    def failed(code: str, message: str) -> None:
        db.record_custom_domain_registration(
            settings,
            organization_id=organization_id,
            domain_id=row["id"],
            configuration_state="dns_required",
            dns_records=[],
            error_code=code,
            error_message=message,
        )

    try:
        status = hosting.connect(credential, row["hostname"])
    except HostnameUnavailable as refusal:
        # A fact about the name rather than the attempt, so the domain itself is failed.
        db.set_custom_domain_verification(
            settings,
            organization_id=organization_id,
            domain_id=row["id"],
            verification_state="failed",
            configuration_state=None,
            ssl_state=None,
            dns_records=None,
            error_code="hostname_unavailable",
            error_message=str(refusal),
        )
        raise HostnameUnavailableError(str(refusal)) from refusal
    except MalformedAnswer as refusal:
        failed("malformed_response", str(refusal))
        raise ProviderRefusedError(str(refusal)) from refusal
    except UpstreamRefused as refusal:
        failed("provider_refused", str(refusal))
        raise ProviderRefusedError(str(refusal)) from refusal

    db.record_custom_domain_registration(
        settings,
        organization_id=organization_id,
        domain_id=row["id"],
        configuration_state=status.configuration_state,
        dns_records=status.dns_records,
    )
    if status.verification_state == "verified":
        db.set_custom_domain_verification(
            settings,
            organization_id=organization_id,
            domain_id=row["id"],
            verification_state=status.verification_state,
            configuration_state=status.configuration_state,
            ssl_state=status.ssl_state,
            dns_records=status.dns_records,
        )
    return _view(row, status, dns_settings=dns_settings, token=token, organization_id=organization_id)


def check_domain(
    settings: ProviderOperationsSettings,
    *,
    token: str,
    organization_id: str,
    domain_id: str,
    dns_settings: IntegrationSettings | None = None,
) -> dict:
    """Ask the provider again. A domain that was never registered is registered instead: a
    recheck after a failed first attempt is what a person means by pressing it."""
    row = _domain(settings, token, organization_id, domain_id)
    if not row.get("provider_resource_id"):
        return connect_domain(settings, token=token, organization_id=organization_id, domain_id=domain_id, dns_settings=dns_settings)

    credential = _credential(settings, organization_id, row)
    if credential is None:
        db.set_custom_domain_verification(
            settings,
            organization_id=organization_id,
            domain_id=row["id"],
            verification_state=row["verification_state"],
            configuration_state=None,
            ssl_state=None,
            dns_records=None,
            error_code="provider_unavailable",
            error_message=PROVIDER_UNAVAILABLE_MESSAGE,
        )
        raise ProviderUnavailableError(PROVIDER_UNAVAILABLE_MESSAGE)
    hosting = _hosting(row)

    def keep(code: str, message: str) -> None:
        # A refused recheck changes nothing the provider last established; it only says why the
        # latest attempt did not answer.
        db.set_custom_domain_verification(
            settings,
            organization_id=organization_id,
            domain_id=row["id"],
            verification_state=row["verification_state"],
            configuration_state=None,
            ssl_state=None,
            dns_records=None,
            error_code=code,
            error_message=message,
        )

    try:
        status = hosting.check(credential, row["hostname"])
    except HostnameUnavailable as refusal:
        db.set_custom_domain_verification(
            settings,
            organization_id=organization_id,
            domain_id=row["id"],
            verification_state="failed",
            configuration_state=None,
            ssl_state=None,
            dns_records=None,
            error_code="hostname_unavailable",
            error_message=str(refusal),
        )
        raise HostnameUnavailableError(str(refusal)) from refusal
    except MalformedAnswer as refusal:
        keep("malformed_response", str(refusal))
        raise ProviderRefusedError(str(refusal)) from refusal
    except UpstreamRefused as refusal:
        keep("provider_refused", str(refusal))
        raise ProviderRefusedError(str(refusal)) from refusal

    db.set_custom_domain_verification(
        settings,
        organization_id=organization_id,
        domain_id=row["id"],
        verification_state=status.verification_state,
        configuration_state=status.configuration_state,
        ssl_state=status.ssl_state,
        dns_records=status.dns_records,
    )
    return _view(row, status, dns_settings=dns_settings, token=token, organization_id=organization_id)


def apply_dns_automation(
    settings: ProviderOperationsSettings,
    *,
    token: str,
    organization_id: str,
    domain_id: str,
    dns_settings: IntegrationSettings | None = None,
) -> dict:
    """The one consequential DNS mutation, performed only when a person presses "Apply and
    verify" after reviewing exactly what will change -- never automatically inside `connect`/
    `check` (work order 1 closeout, section 3). Re-asks the hosting provider fresh rather than
    trusting records a client may have been shown a while ago, ensures them through the business's
    own connected zone, and rechecks once more before recording anything."""
    row = _domain(settings, token, organization_id, domain_id)
    if not row.get("provider_resource_id"):
        raise ValidationError("This domain has not been registered with the hosting provider yet.")

    credential = _credential(settings, organization_id, row)
    if credential is None:
        db.set_custom_domain_verification(
            settings,
            organization_id=organization_id,
            domain_id=row["id"],
            verification_state=row["verification_state"],
            configuration_state=None,
            ssl_state=None,
            dns_records=None,
            error_code="provider_unavailable",
            error_message=PROVIDER_UNAVAILABLE_MESSAGE,
        )
        raise ProviderUnavailableError(PROVIDER_UNAVAILABLE_MESSAGE)
    hosting = _hosting(row)

    try:
        status = hosting.check(credential, row["hostname"])
    except HostnameUnavailable as refusal:
        db.set_custom_domain_verification(
            settings, organization_id=organization_id, domain_id=row["id"], verification_state="failed",
            configuration_state=None, ssl_state=None, dns_records=None,
            error_code="hostname_unavailable", error_message=str(refusal),
        )
        raise HostnameUnavailableError(str(refusal)) from refusal
    except (MalformedAnswer, UpstreamRefused) as refusal:
        raise ProviderRefusedError(str(refusal)) from refusal

    if status.configuration_state == "dns_required" and status.dns_records:
        outcome = ensure_required_records(
            dns_settings, token=token, organization_id=organization_id, hostname=row["hostname"], records=status.dns_records
        )
        if outcome.applied:
            try:
                status = hosting.check(credential, row["hostname"])
            except (HostnameUnavailable, MalformedAnswer, UpstreamRefused):
                pass  # The provider's own recheck is the fact of record; keep what it last said.

    db.set_custom_domain_verification(
        settings,
        organization_id=organization_id,
        domain_id=row["id"],
        verification_state=status.verification_state,
        configuration_state=status.configuration_state,
        ssl_state=status.ssl_state,
        dns_records=status.dns_records,
    )
    return _view(row, status, dns_settings=dns_settings, token=token, organization_id=organization_id)


def remove_domain(
    settings: ProviderOperationsSettings,
    *,
    token: str,
    organization_id: str,
    domain_id: str,
) -> dict:
    """Detach at the provider, then release the row under the caller's own token -- so the
    release is attributed to the person, and refused by the database if they may not."""
    row = _domain(settings, token, organization_id, domain_id)

    if row.get("provider_resource_id"):
        credential = _credential(settings, organization_id, row)
        if credential is None:
            # Releasing here would leave the hostname attached upstream with no row to say so.
            raise ProviderUnavailableError(PROVIDER_UNAVAILABLE_MESSAGE)
        try:
            _hosting(row).remove(credential, row["hostname"])
        except UpstreamRefused as refusal:
            raise ProviderRefusedError(str(refusal)) from refusal

    _rest(
        settings,
        token,
        "POST",
        "rpc/release_custom_domain",
        json={"p_organization_id": organization_id, "p_domain_id": row["id"]},
    )
    return {"domain_id": row["id"], "hostname": row["hostname"], "released": True}


COMMANDS = {
    "connect": connect_domain,
    "check": check_domain,
    "remove": remove_domain,
    "apply_dns": apply_dns_automation,
}


def run_domain_command(
    settings: ProviderOperationsSettings,
    *,
    token: str,
    command: str,
    organization_id: str,
    domain_id: str,
    dns_settings: IntegrationSettings | None = None,
) -> dict:
    """Dispatch by name. Anything but the four is refused before anything is read."""
    run = COMMANDS.get(command)
    if run is None:
        raise ValidationError("Unknown command.")
    if run is remove_domain:
        return run(settings, token=token, organization_id=organization_id, domain_id=domain_id)
    return run(settings, token=token, organization_id=organization_id, domain_id=domain_id, dns_settings=dns_settings)
