"""Reaching a person, named as a capability rather than as a provider.

The Python side of the no-vendor-SDK-in-domain rule. `apps/web/lib/adapters/` holds the same boundary in TypeScript, and the
reasoning does not change with the language: everything above this file asks to *send a message
to somebody*, and exactly one module per channel knows how.

**What a capability may not leak.** Nothing here carries a provider's identifier, a template id
of theirs, or any of their vocabulary. A recipient, a subject line and a body go in; whether it
was sent comes back. The body is the business's own finished words — resolved in Postgres when
the message was queued — and nothing in this package may add to it, wrap it, or sign it.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Protocol


@dataclass(frozen=True)
class Message:
    """One message, already finished.

    `body` is exactly what the business wrote with its own values substituted. There is no
    template here and no formatting: a sender that could reformat could change what somebody
    said.
    """

    recipient: str
    subject_line: str
    body: str


@dataclass(frozen=True)
class Sent:
    """What happened. `detail` is the provider's own words on a failure, never ours."""

    ok: bool
    detail: str = ""


class Sender(Protocol):
    """One channel's implementation."""

    def send(self, message: Message) -> Sent:
        """Deliver it, or say why not.

        Never raises for an ordinary refusal — a bad address is a failed delivery a business
        can see and fix, not an outage. It may raise for a provider that is unreachable, which
        the caller treats as *try again next tick* rather than as a failure to record.
        """
        ...
