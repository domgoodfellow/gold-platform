"""Which provider actually answers a capability, once GOLD has assigned one.

**Explicit beats implicit, and never fails over.** A capability with an assignment is answered by
exactly that provider, account and model -- if the credential is missing or the adapter fails,
that is a failed run, not a silent slide onto Anthropic, a local model, or whatever
`app.ai.registry` would otherwise have chosen. Failing over would hide an infrastructure outage
behind a vendor swap nobody asked for, and would send a question to a different vendor, at a
different cost, under a different data-handling promise than the one somebody configured.

**A capability with no assignment keeps working exactly as before.** `app.ai.registry`'s
environment-driven default is still what answers -- this is the deployment compatibility this
runtime already offers, not something narrowed by this feature's arrival.
"""

from __future__ import annotations

from app.ai import AnsweringProvider
from app.ai.adapters import adapter_for
from app.ai.registry import answering_provider
from app.core.config import ProviderOperationsSettings
from app.core.db import read_provider_account_credential, resolve_ai_runtime_assignment


# The capabilities a runtime may be assigned to. The database's `app.ai_capabilities()` is the
# list these must equal; `test_ai_runtime.py` and `ai-runtime-assignments.test.ts` hold both ends.
OPERATOR_ASSISTANT = "operator_assistant"
PUBLIC_ASSISTANT = "public_assistant"
CONFIGURATION_DRAFTING = "configuration_drafting"
VOICE_RECEPTIONIST = "voice_receptionist"
CAPABILITIES = (OPERATOR_ASSISTANT, PUBLIC_ASSISTANT, CONFIGURATION_DRAFTING, VOICE_RECEPTIONIST)


def resolve_provider(
    settings: ProviderOperationsSettings | None, *, capability: str
) -> AnsweringProvider | None:
    """The provider for `capability`: an explicit assignment if one exists, else the legacy default.

    `settings` is `None` for a deployment that has not configured `SUPABASE_JWT_SECRET` for this
    path -- indistinguishable, on purpose, from a deployment with no assignment: there is nothing
    to resolve either way, and the fallback is the same.
    """
    if capability == VOICE_RECEPTIONIST:
        raise RuntimeError('Voice sessions use the dedicated voice adapter')
    assignment = resolve_ai_runtime_assignment(settings, capability=capability) if settings else None
    if assignment is None:
        return answering_provider()

    credential = read_provider_account_credential(
        settings, account_id=assignment["provider_account_id"]
    )
    if credential is None:
        raise RuntimeError(f"{capability} is assigned to a provider account with no usable credential")

    factory = adapter_for(assignment["provider_key"], assignment["provider_service_key"])
    if factory is None:
        raise RuntimeError(
            f"{capability} is assigned to {assignment['provider_key']}/"
            f"{assignment['provider_service_key']}, which has no runtime implementation"
        )

    return factory(api_key=credential["secret"], model=assignment["model"])
