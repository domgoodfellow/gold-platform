"""Which model this deployment answers with.

**The only module outside an implementation that names a provider**, which is the shape
`app.channels.registry` and `apps/web/lib/adapters/*/registry.ts` already have, for the reason
recorded there: a contract that names a vendor is a contract shaped by one.

`None` when nothing is configured, rather than a throw. A deployment with no model is a complete
deployment -- every screen in the platform works without one -- and what `None` obliges the
caller to do is say so out loud rather than render a box that cannot work (D31).

**Selection is by environment, and the order below is the decision.** A deployment that sets
`ASSISTANT_BASE_URL` is answering with something it runs or chose itself -- a local model, or
anything speaking the same dialect -- and that wins over the hosted default, because the reason
to configure it is usually that rows must not leave the building. Nothing further up knows or
can find out which case it is in.

**Not per tenant.** A business supplying its own endpoint and its own key is a business holding
an account with a vendor, which is D33's axis and is a different feature with a different record
-- a credential to store, a grant to refresh, a failure surface for the day it is revoked. This
is GOLD's own integration, like the other six.
"""

from __future__ import annotations

import os

from app.ai import AnsweringProvider


def answering_provider() -> AnsweringProvider | None:
    base_url = os.environ.get("ASSISTANT_BASE_URL")
    if base_url:
        from app.integrations.openai_dialect.answering import dialect_provider

        return dialect_provider(
            base_url=base_url,
            model=os.environ.get("ASSISTANT_MODEL", "llama3.1"),
            # Absent for a model on your own hardware, present for a hosted endpoint that
            # speaks the same dialect. Neither case is special: it is a header or it is not.
            api_key=os.environ.get("ASSISTANT_API_KEY"),
            name=os.environ.get("ASSISTANT_MODEL", "llama3.1"),
        )

    api_key = os.environ.get("ANTHROPIC_API_KEY")
    if api_key:
        from app.integrations.anthropic.answering import anthropic_provider

        return anthropic_provider(api_key=api_key)

    return None


def unconfigured_reason() -> str:
    """What to say when there is nobody to ask.

    A sentence for an operator, saying whose problem it is: not this business's, and not fixable
    from inside the application. The same answer `app.channels.registry` gives for a channel this
    deployment cannot send on.
    """
    return "this deployment has no model configured to answer questions"
