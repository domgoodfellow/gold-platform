"""The one file that knows what Cloudflare's DNS API looks like (I15).

Three calls: list a zone's records matching a name and type, create one, update one by id.
Cloudflare's JSON travels no further than the three functions below -- `app.services.dns.operations`
asks in GildOps' own vocabulary and hears GildOps' own vocabulary back, the same shape
`app.providers.vercel.domains` holds for the hosting side of this same bridge.
"""

from __future__ import annotations

import httpx

from app.providers.providers import MalformedAnswer, UpstreamRefused

API = "https://api.cloudflare.com/client/v4"


def _headers(access_token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {access_token}"}


def _send(method: str, url: str, access_token: str, *, params: dict | None = None, json: dict | None = None) -> httpx.Response:
    try:
        return httpx.request(method, url, headers=_headers(access_token), params=params, json=json, timeout=15.0)
    except httpx.HTTPError as failure:
        raise UpstreamRefused(f"Cloudflare could not be reached: {type(failure).__name__}") from failure


def _body(response: httpx.Response) -> dict:
    try:
        body = response.json()
    except ValueError as failure:
        raise MalformedAnswer("Cloudflare answered with something that is not JSON.") from failure
    if not isinstance(body, dict):
        raise MalformedAnswer("Cloudflare answered with an unexpected shape.")
    return body


def _message(body: dict, response: httpx.Response) -> str:
    errors = body.get("errors")
    if isinstance(errors, list) and errors and isinstance(errors[0], dict):
        return str(errors[0].get("message") or f"status {response.status_code}")[:300]
    return f"status {response.status_code}"


def _ok(method: str, url: str, access_token: str, *, params: dict | None = None, json: dict | None = None) -> dict:
    response = _send(method, url, access_token, params=params, json=json)
    body = _body(response)
    if response.status_code >= 400 or body.get("success") is not True:
        raise UpstreamRefused(f"Cloudflare refused the request: {_message(body, response)}")
    return body


def list_records(access_token: str, zone_id: str, *, name: str, record_type: str) -> list[dict]:
    """Every record of this type named exactly this, in this zone. Cloudflare's own shape."""
    body = _ok(
        "GET",
        f"{API}/zones/{zone_id}/dns_records",
        access_token,
        params={"name": name, "type": record_type, "per_page": "50"},
    )
    result = body.get("result")
    return [r for r in result if isinstance(r, dict)] if isinstance(result, list) else []


def create_record(access_token: str, zone_id: str, *, record_type: str, name: str, value: str) -> dict:
    body = _ok(
        "POST",
        f"{API}/zones/{zone_id}/dns_records",
        access_token,
        json={"type": record_type, "name": name, "content": value, "ttl": 1},
    )
    result = body.get("result")
    if not isinstance(result, dict) or not result.get("id"):
        raise MalformedAnswer("Cloudflare's answer named no record id.")
    return result


def update_record(access_token: str, zone_id: str, record_id: str, *, record_type: str, name: str, value: str) -> dict:
    body = _ok(
        "PUT",
        f"{API}/zones/{zone_id}/dns_records/{record_id}",
        access_token,
        json={"type": record_type, "name": name, "content": value, "ttl": 1},
    )
    result = body.get("result")
    if not isinstance(result, dict) or not result.get("id"):
        raise MalformedAnswer("Cloudflare's answer named no record id.")
    return result
