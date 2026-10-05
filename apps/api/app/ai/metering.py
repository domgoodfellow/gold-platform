"""Writing down what an answered request consumed.

**One call per request, with the request's total.** `app.ai.loop` sums every model call a request
made; this records that sum once, so the commercial usage is exactly what the providers reported
and nothing is counted both per call and per request.

**Outside the loop on purpose.** The loop knows no database and writes nothing; the handler that
owns the request knows the organization and which capability it was, and calls this after the
answer is known.

**A meter that fails does not take the answer with it, and is never silent.** The person asked a
question and the model answered it; losing that answer because a commercial record could not be
written would punish them for GildOps' own bookkeeping. The failure is logged at `error` with the
request's reference -- the one thing needed to write the row by hand -- and reported to the
caller, so it is something an operator can see rather than something that quietly under-bills.

**Three outcomes, and they are different facts:**

  * `recorded`      -- the provider reported consumption and it was written.
  * `none_reported` -- nothing to write: no call completed, or the provider(s) did not say.
  * `failed`        -- the provider reported it and it could not be written.
"""

from __future__ import annotations

import logging
import uuid

from app.ai.loop import Answer
from app.core.config import ProviderOperationsSettings
from app.core.db import record_ai_usage

log = logging.getLogger("gold.ai.metering")

RECORDED = "recorded"
NONE_REPORTED = "none_reported"
FAILED = "failed"


def meter(
    settings: ProviderOperationsSettings | None,
    *,
    organization_id: str,
    capability: str,
    provider_key: str,
    given: Answer,
) -> str:
    usage = given.usage
    if usage is None:
        # Not an error, and not a zero: a request whose provider reported nothing has nothing to
        # write. If calls ran without reporting, say so where an operator will look.
        if given.calls_without_usage:
            log.warning(
                "ai usage unavailable: capability=%s provider=%s calls=%d reported no usage",
                capability, provider_key, given.calls_without_usage,
            )
        return NONE_REPORTED

    reference = str(uuid.uuid4())
    if given.calls_without_usage:
        log.warning(
            "ai usage partial: capability=%s provider=%s reference=%s %d call(s) reported no usage",
            capability, provider_key, reference, given.calls_without_usage,
        )

    if settings is None:
        # A deployment without the machine role cannot write usage. Said, not swallowed.
        log.error(
            "ai usage not recorded: no provider-operations settings. capability=%s provider=%s "
            "organization=%s reference=%s input=%d output=%d",
            capability, provider_key, organization_id, reference, usage.input_tokens, usage.output_tokens,
        )
        return FAILED

    try:
        record_ai_usage(
            settings,
            organization_id=organization_id,
            capability=capability,
            provider_key=provider_key,
            input_tokens=usage.input_tokens,
            output_tokens=usage.output_tokens,
            reference=reference,
        )
    except Exception as failure:  # noqa: BLE001 - recorded with what is needed to write it by hand
        log.error(
            "ai usage not recorded: %s. capability=%s provider=%s organization=%s reference=%s "
            "input=%d output=%d",
            failure, capability, provider_key, organization_id, reference,
            usage.input_tokens, usage.output_tokens,
        )
        return FAILED
    return RECORDED
