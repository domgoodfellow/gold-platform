"""Forecast conditions, behind the capability its Protocol names.

**One of two modules in this repository that knows this provider exists**, the other being the
registry that chooses it. No SDK, for the reason every other adapter here gives: one HTTPS call
and a JSON body.

**The units come from the provider and are passed through untouched.** Nothing here converts,
rounds or normalises — a rule compares a reading in the unit it arrived in, and refuses to
compare across units at all. Converting silently is how a business ends up with a rule about
kilometres per hour firing on miles.
"""

from __future__ import annotations

from datetime import datetime

import httpx

from app.conditions import ConditionsProvider, Reading

API = "https://api.open-meteo.com/v1/forecast"

# This platform's metric names on the left, the provider's on the right. **The only place the
# two vocabularies meet**, which is the whole point of the adapter: everything above names a
# metric this platform declares, and nothing above knows what anybody else calls it.
FIELDS = {
    "temperature": "temperature_2m",
    "wind_speed": "wind_speed_10m",
    "precipitation": "precipitation",
}


def open_meteo_provider() -> ConditionsProvider:
    class _Provider:
        def readings(
            self, *, latitude: float, longitude: float, metrics: tuple[str, ...]
        ) -> list[Reading]:
            wanted = [FIELDS[metric] for metric in metrics if metric in FIELDS]
            if not wanted:
                return []

            response = httpx.get(
                API,
                params={
                    "latitude": latitude,
                    "longitude": longitude,
                    "hourly": ",".join(wanted),
                    "forecast_days": 7,
                    "timezone": "UTC",
                },
                timeout=20.0,
            )

            if response.status_code >= 400:
                raise RuntimeError(f"the conditions provider answered {response.status_code}")

            body = response.json()
            hourly = body.get("hourly") or {}
            units = body.get("hourly_units") or {}
            times = hourly.get("time") or []

            out: list[Reading] = []
            for metric in metrics:
                field = FIELDS.get(metric)
                if not field or field not in hourly:
                    continue

                unit = units.get(field)
                if not unit:
                    # A value with no unit is a number this platform cannot compare against a
                    # threshold somebody typed, so it is dropped rather than guessed at.
                    continue

                for when, value in zip(times, hourly[field]):
                    if value is None:
                        continue
                    out.append(
                        Reading(
                            metric=metric,
                            value=float(value),
                            unit=str(unit),
                            applies_at=datetime.fromisoformat(when).replace(tzinfo=None),
                        )
                    )

            return out

    return _Provider()
