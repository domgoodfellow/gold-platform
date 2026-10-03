"""Requesting, checking, publishing DNS for and releasing a business's own sending domain.

**Authorization is proved before the credential is read, and RLS proves it.** The caller's own
token asks `can_manage_email_domains` (membership and `organization.manage`) and selects the
resource row (a business sees its own and nobody else's, so an empty answer means *not yours, or no
such domain* -- I18's ambiguous refusal). Only then does this mint the machine token that may learn
which GildOps account answers, read that account's credential, and record what the provider said.

**Every outcome is recorded before it is returned.** A provider account nobody has configured, a
domain the provider will not take, a provider that refused or answered nonsense: each is written
onto the resource's own row by the same machine role that asked, so the Email page can say what
happened after the dialog is closed (D44: a failure is a row, not a toast).

**`active` means the provider says the domain is usable -- never that a form was submitted, and
never that DNS was written.** Publishing a record and the provider accepting it are two facts
(work order 1, section 17): `apply_dns` ensures the records and then asks the provider again, and
it is only that second answer that is recorded as state.

**Nothing here names a vendor.** `app.providers.email_domains_for` turns the binding's own provider
key into a module; this file sequences it and speaks GildOps' vocabulary only.
"""

from __future__ import annotations

import httpx

from app.core import db
from app.core.config import IntegrationSettings, ProviderOperationsSettings
from app.core.postgrest import caller_rest
from app.errors import DomainError, NotFoundError, ValidationError
from app.providers.providers import (
    CredentialRejected,
    HostnameUnavailable,
    MalformedAnswer,
    UpstreamRefused,
    email_domains_for,
)
from app.services.dns.operations import ensure_required_records, ensure_result_view, preview_automation

PROVIDER_UNAVAILABLE_MESSAGE = (
    "Custom sending domains are not available on this deployment yet: GildOps has no email account configured."
)


class ProviderUnavailableError(DomainError):
    """No GildOps email account can answer -- a platform fact, never a problem with the domain."""

    status = 503
    code = "provider_unavailable"


class ProviderRefusedError(DomainError):
    """The provider refused, could not be reached, or answered in a shape nobody can read."""

    status = 502
    code = "provider_refused"


class DomainRejectedError(DomainError):
    """The provider will not take this domain at all. A fact about the name, so a retry will not
    help; the row is failed rather than left waiting."""

    status = 409
    code = "domain_rejected"


def _rest(settings: ProviderOperationsSettings, token: str, method: str, path: str, **kwargs) -> httpx.Response:
    """A call to PostgREST under the caller's own token -- RLS answers, not this runtime."""
    return caller_rest(settings.supabase_url, settings.supabase_publishable_key, token, method, path, **kwargs)


def _resource(settings: ProviderOperationsSettings, token: str, organization_id: str, resource_id: str) -> tuple[dict, object]:
    """This business's sending-domain resource and the provider module that answers for it.

    Four refusals, all the same shape to the caller: no arguments, no permission, no such row, and
    a row that is not a sending domain (a phone number's id passed to this command must not become
    a command about a phone number).
    """
    if not organization_id or not resource_id:
        raise ValidationError("A business and a sending domain are both required.")

    allowed = _rest(
        settings, token, "POST", "rpc/can_manage_email_domains", json={"p_organization_id": organization_id}
    ).json()
    if allowed is not True:
        raise NotFoundError("No such sending domain.")

    rows = _rest(
        settings,
        token,
        "GET",
        "organization_provider_resources",
        params={
            "id": f"eq.{resource_id}",
            "organization_id": f"eq.{organization_id}",
            "select": "id,binding_id,resource_type,external_id,status,config",
        },
    ).json()
    if not rows:
        raise NotFoundError("No such sending domain.")
    row = rows[0]

    bindings = _rest(
        settings,
        token,
        "GET",
        "organization_provider_bindings",
        params={
            "id": f"eq.{row['binding_id']}",
            "organization_id": f"eq.{organization_id}",
            "select": "provider_key",
        },
    ).json()
    provider_key = str(bindings[0]["provider_key"]) if bindings else ""

    provider = email_domains_for(provider_key)
    if provider is None or row.get("resource_type") != provider.RESOURCE_TYPE:
        raise NotFoundError("No such sending domain.")
    return row, provider


def _credential(settings: ProviderOperationsSettings, organization_id: str) -> dict | None:
    account_id = db.email_domain_provider_account(settings, organization_id=organization_id)
    if not account_id:
        return None
    credential = db.read_provider_account_credential(settings, account_id=account_id)
    if credential is None or not credential.get("secret"):
        return None
    return credential


def _record(
    settings: ProviderOperationsSettings,
    *,
    organization_id: str,
    resource_id: str,
    status: str,
    provider_domain_id: str | None = None,
    provider_status: str | None = None,
    dns_records: list[dict] | None = None,
    error_code: str | None = None,
    error_message: str | None = None,
) -> None:
    db.record_email_domain_provisioning(
        settings,
        organization_id=organization_id,
        resource_id=resource_id,
        status=status,
        provider_domain_id=provider_domain_id,
        provider_status=provider_status,
        dns_records=dns_records,
        error_code=error_code,
        error_message=error_message,
    )


def _unavailable(settings: ProviderOperationsSettings, organization_id: str, row: dict) -> ProviderUnavailableError:
    """No account, or one whose credential the provider itself rejected. Recorded on the row
    without failing the domain: nothing about the business's own name has gone wrong."""
    _record(
        settings,
        organization_id=organization_id,
        resource_id=row["id"],
        status="pending",
        error_code="provider_unavailable",
        error_message=PROVIDER_UNAVAILABLE_MESSAGE,
    )
    return ProviderUnavailableError(PROVIDER_UNAVAILABLE_MESSAGE)


def _view(
    row: dict,
    status,
    provider,
    *,
    dns_settings: IntegrationSettings | None = None,
    token: str | None = None,
    organization_id: str | None = None,
    dns_outcome: dict | None = None,
) -> dict:
    """GildOps' own vocabulary for where a sending domain stands, plus -- only while records are
    still outstanding -- whether a connected DNS zone *could* publish them. Read-only: asking
    never writes a record, which is what lets a caller offer a review step before the first
    consequential mutation."""
    outstanding = [record for record in status.records if record.status != "verified"]
    view = {
        "resource_id": row["id"],
        "domain": status.domain,
        "state": status.state,
        "provider_status": status.provider_status,
        "records": provider.record_views(status),
        "records_verified": len(status.records) - len(outstanding),
        "dns_outcome": dns_outcome,
    }
    if outstanding and dns_settings is not None:
        preview = preview_automation(dns_settings, token=token, organization_id=organization_id, hostname=status.domain)
        view["dns_automation"] = {"available": preview.available, "connectionId": preview.connection_id, "zoneName": preview.zone_name}
    else:
        view["dns_automation"] = {"available": False, "connectionId": None, "zoneName": None}
    return view


def _ask(
    settings: ProviderOperationsSettings,
    organization_id: str,
    row: dict,
    provider,
    ask,
):
    """Run one provider call, recording every way it can fail before re-raising it.

    The three outcomes are deliberately different rows. A rejected domain *fails* -- the provider
    will not take that name and no retry changes it. A refused or unreadable answer leaves the
    domain exactly where it was and records only why the latest attempt did not answer. A rejected
    credential is GildOps' own account being unusable and must never read to a business as a
    problem with its domain, so it lands as `provider_unavailable` like having no account at all.
    """
    try:
        return ask()
    except HostnameUnavailable as refusal:
        _record(
            settings,
            organization_id=organization_id,
            resource_id=row["id"],
            status="failed",
            error_code="domain_rejected",
            error_message=str(refusal),
        )
        raise DomainRejectedError(str(refusal)) from refusal
    except CredentialRejected as refusal:
        _record(
            settings,
            organization_id=organization_id,
            resource_id=row["id"],
            status=row["status"],
            error_code="provider_unavailable",
            error_message=str(refusal),
        )
        raise ProviderUnavailableError(PROVIDER_UNAVAILABLE_MESSAGE) from refusal
    except MalformedAnswer as refusal:
        _record(
            settings,
            organization_id=organization_id,
            resource_id=row["id"],
            status=row["status"],
            error_code="malformed_response",
            error_message=str(refusal),
        )
        raise ProviderRefusedError(str(refusal)) from refusal
    except UpstreamRefused as refusal:
        _record(
            settings,
            organization_id=organization_id,
            resource_id=row["id"],
            status=row["status"],
            error_code="provider_refused",
            error_message=str(refusal),
        )
        raise ProviderRefusedError(str(refusal)) from refusal


def _recorded_domain_id(row: dict) -> str | None:
    config = row.get("config")
    if not isinstance(config, dict):
        return None
    value = config.get("provider_domain_id")
    return str(value) if value else None


def provision_domain(
    settings: ProviderOperationsSettings,
    *,
    token: str,
    organization_id: str,
    resource_id: str,
    dns_settings: IntegrationSettings | None = None,
) -> dict:
    """Create the domain at the provider, or resume one a previous attempt already created, and
    record the requirements it came back with. Safe to press twice: the provider adapter's `ensure`
    resolves all three ways a retry can arrive, and the resource row is keyed by the domain name
    so a second attempt updates one row rather than writing another."""
    row, provider = _resource(settings, token, organization_id, resource_id)

    credential = _credential(settings, organization_id)
    if credential is None:
        raise _unavailable(settings, organization_id, row)

    status = _ask(
        settings,
        organization_id,
        row,
        provider,
        lambda: provider.ensure(credential, row["external_id"], external_id=_recorded_domain_id(row)),
    )

    _record(
        settings,
        organization_id=organization_id,
        resource_id=row["id"],
        status=status.state,
        provider_domain_id=status.external_id,
        provider_status=status.provider_status,
        dns_records=provider.record_views(status),
    )
    return _view(row, status, provider, dns_settings=dns_settings, token=token, organization_id=organization_id)


def check_domain(
    settings: ProviderOperationsSettings,
    *,
    token: str,
    organization_id: str,
    resource_id: str,
    dns_settings: IntegrationSettings | None = None,
) -> dict:
    """Ask the provider again -- the button a person presses once they have published DNS.

    A domain the provider has never been asked about is provisioned instead: a recheck after a
    failed first attempt is what a person means by pressing it. A domain already verified is read
    rather than re-verified, because asking a provider to check a verified domain moves it back to
    *checking* for no reason.
    """
    row, provider = _resource(settings, token, organization_id, resource_id)
    external_id = _recorded_domain_id(row)
    if not external_id:
        return provision_domain(
            settings, token=token, organization_id=organization_id, resource_id=resource_id, dns_settings=dns_settings
        )

    credential = _credential(settings, organization_id)
    if credential is None:
        raise _unavailable(settings, organization_id, row)

    def ask():
        current = provider.get(credential, external_id)
        if current is None:
            # Deleted at the provider's own dashboard. The row still says the business wants it,
            # so it is created again rather than reported as lost.
            return provider.ensure(credential, row["external_id"])
        if current.state == "active":
            return current
        provider.verify(credential, current.external_id)
        return provider.get(credential, current.external_id) or current

    status = _ask(settings, organization_id, row, provider, ask)

    _record(
        settings,
        organization_id=organization_id,
        resource_id=row["id"],
        status=status.state,
        provider_domain_id=status.external_id,
        provider_status=status.provider_status,
        dns_records=provider.record_views(status),
    )
    return _view(row, status, provider, dns_settings=dns_settings, token=token, organization_id=organization_id)


def apply_dns(
    settings: ProviderOperationsSettings,
    *,
    token: str,
    organization_id: str,
    resource_id: str,
    dns_settings: IntegrationSettings | None = None,
) -> dict:
    """The one consequential DNS mutation, performed only when a person presses "Apply and verify"
    after reviewing exactly what will change -- never automatically inside `provision`/`check`.

    Re-asks the provider fresh rather than trusting records a client may have been shown a while
    ago, ensures them through this business's own connected zone, and then asks the provider again:
    publishing a record is not the provider accepting it, and only the second answer is recorded as
    state. The per-record outcomes travel back in `dns_outcome` so a conflict the DNS capability
    refused to overwrite is something a person is told about rather than something that silently
    leaves the domain unverified.
    """
    row, provider = _resource(settings, token, organization_id, resource_id)
    external_id = _recorded_domain_id(row)
    if not external_id:
        raise ValidationError("This domain has not been created with the email provider yet.")

    credential = _credential(settings, organization_id)
    if credential is None:
        raise _unavailable(settings, organization_id, row)

    status = _ask(
        settings,
        organization_id,
        row,
        provider,
        lambda: provider.get(credential, external_id) or provider.ensure(credential, row["external_id"]),
    )

    outstanding = [record for record in provider.record_views(status) if record.get("status") != "verified"]
    outcome = None
    if outstanding:
        ensured = ensure_required_records(
            dns_settings, token=token, organization_id=organization_id, hostname=status.domain, records=outstanding
        )
        outcome = ensure_result_view(ensured)
        if ensured.applied:
            def recheck():
                provider.verify(credential, status.external_id)
                return provider.get(credential, status.external_id) or status

            status = _ask(settings, organization_id, row, provider, recheck)

    _record(
        settings,
        organization_id=organization_id,
        resource_id=row["id"],
        status=status.state,
        provider_domain_id=status.external_id,
        provider_status=status.provider_status,
        dns_records=provider.record_views(status),
    )
    return _view(
        row, status, provider, dns_settings=dns_settings, token=token, organization_id=organization_id, dns_outcome=outcome
    )


def release_domain(
    settings: ProviderOperationsSettings,
    *,
    token: str,
    organization_id: str,
    resource_id: str,
) -> dict:
    """Delete it at the provider, then release the row under the caller's own token -- so the
    release is attributed to the person, and refused by the database if they may not.

    A domain the provider never had has nothing upstream and is released here through the same
    door. A provider that refuses the delete stops this: releasing the row anyway would leave the
    domain live at the provider with nothing here to say so, which is how a name nobody can reclaim
    comes about.
    """
    row, provider = _resource(settings, token, organization_id, resource_id)
    external_id = _recorded_domain_id(row)

    if external_id:
        credential = _credential(settings, organization_id)
        if credential is None:
            raise ProviderUnavailableError(PROVIDER_UNAVAILABLE_MESSAGE)
        try:
            provider.remove(credential, external_id)
        except CredentialRejected as refusal:
            raise ProviderUnavailableError(PROVIDER_UNAVAILABLE_MESSAGE) from refusal
        except UpstreamRefused as refusal:
            raise ProviderRefusedError(str(refusal)) from refusal

    _rest(
        settings,
        token,
        "POST",
        "rpc/release_organization_email_domain",
        json={"p_organization_id": organization_id, "p_resource_id": row["id"]},
    )
    return {"resource_id": row["id"], "domain": row["external_id"], "released": True}


COMMANDS = {
    "provision": provision_domain,
    "check": check_domain,
    "apply_dns": apply_dns,
    "release": release_domain,
}


def run_email_domain_command(
    settings: ProviderOperationsSettings,
    *,
    token: str,
    command: str,
    organization_id: str,
    resource_id: str,
    dns_settings: IntegrationSettings | None = None,
) -> dict:
    """Dispatch by name. Anything but the four is refused before anything is read."""
    run = COMMANDS.get(command)
    if run is None:
        raise ValidationError("Unknown command.")
    if run is release_domain:
        return run(settings, token=token, organization_id=organization_id, resource_id=resource_id)
    return run(settings, token=token, organization_id=organization_id, resource_id=resource_id, dns_settings=dns_settings)
