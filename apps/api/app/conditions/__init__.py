"""What the world is doing at a place, named as a capability rather than as a provider.

**the integrations-plus-rules principle as code.** Weather is an integration plus rules and nothing else: it owns no entity, and
this package owns no model of one. What it can be asked is *what is the reading for this metric
at this place over the next few days*, and the answer is numbers with units. A business decides
which number matters, in which unit, and what to do about it — none of which is here.

**The unit comes back with the value and is never assumed.** A rule written in one unit against
a reading taken in another is not a rule that half-works; it is a rule about something else, so
the comparison in Postgres refuses to make it. That is the same refusal `jobEconomics` makes
about currency, and for the same reason: converting has a date, and a date makes this a different
kind of software.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import Protocol

# The metrics this platform names. Each one exists because something can answer it — the same
# bar `roles_capabilities_known` sets for a capability.
METRICS = ("temperature", "wind_speed", "precipitation")


@dataclass(frozen=True)
class Reading:
    """One number, about one hour, in one unit."""

    metric: str
    value: float
    unit: str
    applies_at: datetime


class ConditionsProvider(Protocol):
    def readings(
        self, *, latitude: float, longitude: float, metrics: tuple[str, ...]
    ) -> list[Reading]:
        """Hourly readings for the next few days, or an empty list.

        Raises for a provider that is unreachable or refusing, which the caller treats as *try
        again next tick*. An empty list is a real answer and means nobody has anything to say
        about that place — a rule watching it simply does not fire.
        """
        ...
