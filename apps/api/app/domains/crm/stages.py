"""Moving a customer along the pipeline it belongs to -- CRM/Sales's first domain command.

**Traceability.** Catalogue Feature: CRM -> Sales -> `pipeline` / `configurable_stages`. Web:
`apps/web/features/crm/sales/pipeline-board.tsx` and `stage-control.tsx`, composed by
`apps/web/app/organizations/[organizationId]/customers/pipeline/page.tsx`. Persistence:
`public.change_customer_stage`, added alongside this command (see the migration named for both).
No provider is involved.

**Why this is a command of its own, and not a reuse of `update_customer`.** That function moves a
stage only as one field among several, in one act a person performs while looking at a single
customer's own detail screen (`EditCustomerForm`'s own documented reason for keeping it there,
and it remains the right answer for that screen). Moving a card between pipeline columns is a
different act with a different shape -- exactly one thing changes, and a board showing many
customers at once needs a single-purpose write it can call per card without also supplying a
name, an email and a phone number it does not have open. Two callers for the same underlying
column would be two answers to *how does a customer's stage change*; this file and the pipeline
board are the one for this act, `updateCustomer` (TypeScript, unchanged) remains the one for the
edit screen's, and neither could stand in for the other without also taking on data it does not
have.

**What this module decides, and what it does not.** Nothing here checks a role or a capability --
`change_customer_stage` is `security invoker`, so `customers_update` (capability
`customer.update`) is what actually authorizes the write, under the caller's own forwarded token
through the same RLS/domain boundary used by every caller. A caller this function could not
authorize gets the database's own ambiguous refusal, translated by `app.domains.errors`, not a
second and weaker check performed here.
"""

from __future__ import annotations

from dataclasses import dataclass

from app.core.caller import CommandFailed, call_command
from app.core.config import DomainSettings
from app.errors import DomainError, from_command_failure


@dataclass(frozen=True)
class ChangeCustomerStageCommand:
    organization_id: str
    customer_id: str
    # `None` is a real answer -- "no stage" -- not an omission (`customers.stage_id` is
    # permanently nullable; see the migration that added it).
    stage_id: str | None


@dataclass(frozen=True)
class ChangeCustomerStageResult:
    customer_id: str
    stage_id: str | None


def change_customer_stage(
    settings: DomainSettings,
    *,
    token: str,
    command: ChangeCustomerStageCommand,
) -> ChangeCustomerStageResult:
    """Move a customer to a stage, and hand back where it ended up.

    Callable independently of any web request -- an AI tool or a worker reaches the same pipeline
    move this function performs, under whichever token it is holding, with no React or HTTP
    concept anywhere in the call.
    """
    if not command.organization_id or not command.customer_id:
        raise DomainError("An organization and a customer are both required.")

    try:
        row = call_command(
            settings,
            token=token,
            function="change_customer_stage",
            arguments={
                "organization_id": command.organization_id,
                "customer_id": command.customer_id,
                "stage_id": command.stage_id,
            },
        )
    except CommandFailed as failure:
        raise from_command_failure(str(failure), sqlstate=failure.sqlstate) from failure

    return ChangeCustomerStageResult(customer_id=row["id"], stage_id=row["stage_id"])
