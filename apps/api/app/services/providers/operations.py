"""Running one operation against a GOLD provider account.

**Authorization is proved before the credential is read, and it is RLS that proves it.** The
caller's own token selects the account row; `platform_provider_accounts` admits platform staff
and nobody else, so an empty answer means *not staff, or no such account* -- the same ambiguous
refusal the rest of this runtime gives (I18). Only then does this mint the one machine token
that may read the credential.

**Nothing here decides what the operation means.** Which operations exist, and how a provider
spells them, is `app.providers`' subject; this module dispatches by name and returns the
result. What is returned is never the credential -- a provisioned API key's secret is the one
value a result may carry, because that key belongs to a tenant's subaccount, is created by this
call, and is stored by the caller in the same act (D44).
"""

from __future__ import annotations

from dataclasses import dataclass

import httpx

from app.core.config import ProviderOperationsSettings
from app.core.db import read_provider_account_credential, record_provider_account_verification
from app.errors import DomainError, NotFoundError, ValidationError
from app.providers.providers import UpstreamRefused, operations_for


class ProviderRefusedError(DomainError):
    """The upstream provider refused, or could not be reached."""

    status = 502
    code = "provider_refused"


@dataclass(frozen=True)
class OperateCommand:
    account_id: str
    operation: str
    arguments: dict


def _caller_is_staff_for(settings: ProviderOperationsSettings, *, token: str, account_id: str) -> bool:
    response = httpx.get(
        f"{settings.supabase_url}/rest/v1/platform_provider_accounts",
        headers={"apikey": settings.supabase_publishable_key, "Authorization": f"Bearer {token}"},
        params={"id": f"eq.{account_id}", "select": "id"},
        timeout=10.0,
    )
    if response.status_code >= 400:
        raise DomainError("That could not be completed.")
    return bool(response.json())


def operate(settings: ProviderOperationsSettings, *, token: str, command: OperateCommand) -> dict:
    if not command.account_id or not command.operation:
        raise ValidationError("An account and an operation are both required.")

    if not _caller_is_staff_for(settings, token=token, account_id=command.account_id):
        raise NotFoundError("No such provider account.")

    credential = read_provider_account_credential(settings, account_id=command.account_id)
    if credential is None:
        raise ValidationError("That account is disabled or has no credential stored.")

    operations = operations_for(credential["provider_key"])
    if operations is None or command.operation not in operations:
        raise ValidationError("That operation is not available for this provider.")

    try:
        result = operations[command.operation](credential, command.arguments)
    except KeyError as missing:
        raise ValidationError(f"Missing argument: {missing.args[0]}") from missing
    except UpstreamRefused as failure:
        raise ProviderRefusedError(str(failure)) from failure

    if command.operation == "verify":
        record_provider_account_verification(
            settings,
            account_id=command.account_id,
            ok=bool(result["ok"]),
            error=result.get("error"),
            metadata=result.get("metadata") or {},
        )

    return result
