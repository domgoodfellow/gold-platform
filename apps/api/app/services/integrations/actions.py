"""Running what automations have queued, and keeping the execution record tidy.

An automation rule that carries a `run_tool` action does not call anything itself: the database queues
the call (`integration_action_queue`) and this runs it, through the same executor an agent's tool calls
use, under the rule's own identity. So the rule meets exactly the policy an agent does -- its grant, the
connection's state, the rule being on -- and a refusal is a refusal, not a retry.

**Outcomes are kept apart.** A call that worked, a call that was refused, and a call that failed because
the app could not be reached are three different things: only the last is tried again, and only while
attempts remain. Every attempt is its own execution record; the rule's history gets one row per final
outcome. What came back is not kept: nothing downstream in an automation reads it yet.
"""

from __future__ import annotations

from dataclasses import dataclass

from app.core import db
from app.core.config import IntegrationSettings
from app.services.integrations.executor import ExecutionContext, execute_granted_tool

# Only a failure that says nothing about the request itself is worth another try.
_RETRYABLE = {"unreachable", "timeout"}


@dataclass(frozen=True)
class QueueRun:
    ran: int
    failed: int
    retried: int


def run_queued_actions(settings: IntegrationSettings, *, limit: int = 20) -> QueueRun:
    ran = failed = retried = 0
    for queued in db.claim_integration_actions(settings, limit=limit):
        outcome = execute_granted_tool(
            settings,
            ExecutionContext.for_automation(rule_id=str(queued["rule_id"])),
            grant_id=str(queued["grant_id"]),
            arguments=queued.get("arguments") or {},
        )

        if outcome.status == "succeeded":
            db.finish_integration_action(settings, queue_id=str(queued["id"]), outcome="done")
            ran += 1
        elif outcome.status == "failed" and outcome.reason in _RETRYABLE:
            db.finish_integration_action(
                settings, queue_id=str(queued["id"]), outcome="failed", detail=outcome.message, retry=True
            )
            retried += 1
        else:
            # A refusal, an invalid request or a failure the app itself reported: recorded, not repeated.
            db.finish_integration_action(
                settings,
                queue_id=str(queued["id"]),
                outcome="failed",
                detail=outcome.message or "The connected tool could not be used.",
            )
            failed += 1
    return QueueRun(ran=ran, failed=failed, retried=retried)


def tidy(settings: IntegrationSettings) -> int:
    """Fail what never reported back, expire what nobody decided, and delete what is past retention."""
    return db.purge_integration_executions(settings)
