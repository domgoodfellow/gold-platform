"""Writing up how a call went -- Communications/Voice's first domain command.

**Traceability.** Catalogue Feature: Communications -> Voice -> `call_dispositions`. Web:
`apps/web/features/communications/voice/wrap-up-form.tsx`, composed by the Calls page. Provider:
none -- wrap-up is the tenant's own judgement, recorded after the network's part is already over,
never a Twilio concept. Persistence: `public.record_call_outcome`, added alongside this command.

**Why this replaced two round trips from `apps/web` with one function.** The previous path
(`recordCallOutcome` in `apps/web/lib/domain/reception/calls.ts`) wrote the `calls` row and the
`events` row as two separate requests to Postgres. Nothing between them could fail independently
in the deployments this platform has run so far, which is exactly the gap `CLAUDE.md`'s rule on
transactions warns is easy to miss until a caller one hop further away notices it: a Python
domain command, reaching Postgres over its own HTTP call, is that caller. `record_call_outcome`
performs both writes in one transaction, so this module has nothing left to coordinate itself --
it validates nothing the database's own check constraints do not already enforce (a negative
duration is still refused by `calls.duration_seconds`'s own check, translated by
`app.domains.errors` rather than re-checked here) and orchestrates nothing beyond calling the one
function and translating what it says.
"""

from __future__ import annotations

from dataclasses import dataclass

from app.core.caller import CommandFailed, call_command
from app.core.config import DomainSettings
from app.domains.errors import DomainError, from_command_failure


@dataclass(frozen=True)
class WrapUpCallCommand:
    organization_id: str
    call_id: str
    outcome_id: str | None
    note: str
    duration_seconds: int | None
    # `None` means "leave the network's own status as it is" -- a person writing up a call does
    # not usually know better than the carrier whether it completed, and `record_call_outcome`
    # defaults to `completed` only when nothing else is known (a call recorded by hand).
    status: str | None = None


@dataclass(frozen=True)
class WrapUpCallResult:
    call_id: str
    outcome_id: str | None
    status: str


def wrap_up_call(
    settings: DomainSettings,
    *,
    token: str,
    command: WrapUpCallCommand,
) -> WrapUpCallResult:
    """Record how a call went, and hand back the row as it now stands.

    Callable independently of any web request, on the same terms `change_customer_stage` is: an
    AI call-summary tool or a worker reaching this later reuses exactly this write rather than a
    second copy of it (D34's reasoning; `ai_call_summary` and `ai_receptionist` are catalogue
    Features this repository has not built yet, and this is the seam they would call through).
    """
    if not command.organization_id or not command.call_id:
        raise DomainError("An organization and a call are both required.")

    try:
        row = call_command(
            settings,
            token=token,
            function="record_call_outcome",
            arguments={
                "organization_id": command.organization_id,
                "call_id": command.call_id,
                "outcome_id": command.outcome_id,
                "note": command.note,
                "duration_seconds": command.duration_seconds,
                "status": command.status,
            },
        )
    except CommandFailed as failure:
        raise from_command_failure(str(failure), sqlstate=failure.sqlstate) from failure

    return WrapUpCallResult(
        call_id=row["id"],
        outcome_id=row["outcome_id"],
        status=row["status"],
    )
