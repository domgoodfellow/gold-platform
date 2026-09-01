"""Which implementation this deployment uses for conditions at a place.

The only module outside an implementation that names the provider, which is the split every
adapter in this repository makes. `None` when nothing is configured, rather than a throw: a
deployment with no conditions provider is a complete deployment, and a business that writes a
weather rule on it never has one fire — which the Automations screen shows as a rule that has
never run rather than as an error.
"""

from __future__ import annotations

import os

from app.conditions import ConditionsProvider


def conditions_provider() -> ConditionsProvider | None:
    # The provider below is free for non-commercial use and asks nothing in return, so there is
    # no key to check. What decides whether this deployment fetches is an explicit switch,
    # because reaching out to somebody else's service on a schedule is a decision an operator
    # makes rather than a default they discover.
    if os.environ.get("CONDITIONS_ENABLED", "").lower() not in ("1", "true", "yes"):
        return None

    from app.integrations.open_meteo.conditions import open_meteo_provider

    return open_meteo_provider()
