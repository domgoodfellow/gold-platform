"""Whether a business holds the module an AI request would spend on, asked before it is spent.

**Entitlement is not permission, and this answers only the first.** `assistant.ask` says a *role*
may use the Agent; whether the *business* holds it at all is a commercial fact (D25), and an
endpoint that checked only the role would let any business consume what it has not bought. Both
are required and neither stands in for the other.

**Asked of the database, as the caller.** The operator's own token is forwarded to
`organization_module_entitled`, which answers *no* for a business the caller is not in -- so there
is no organization id here a caller could choose to learn something about somebody else's.

**An answer this runtime could not get is not a *no*.** A database that is unreachable is a
refusal to proceed, not a statement that the business lacks the module; the two reach a person
as different words (`EntitlementUnavailable`).
"""

from __future__ import annotations

import httpx

from app.core.caller import CommandFailed, SupabaseCallerSettings, call_command

# The legacy module keys the Agent and guided setup are sold as. Not a new vocabulary: they are
# `MODULES` in `apps/web/lib/navigation.ts` and `platform_catalog_runtime_mappings.mapping_value`.
ASSISTANT_MODULE = "assistant"
DRAFTING_MODULE = "drafting"


class EntitlementUnavailable(RuntimeError):
    """The database could not say whether the business holds the module."""


def holds_module(
    settings: SupabaseCallerSettings, *, token: str, organization_id: str, module_key: str
) -> bool:
    try:
        answered = call_command(
            settings,
            token=token,
            function="organization_module_entitled",
            arguments={"organization_id": organization_id, "module_key": module_key},
        )
    except (CommandFailed, httpx.HTTPError) as failure:
        raise EntitlementUnavailable(str(failure)) from failure
    return answered is True
