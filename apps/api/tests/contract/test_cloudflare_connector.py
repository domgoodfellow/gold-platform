"""Cloudflare's own adapter: the handshake plumbing and what counts as a reachable zone.

The same shape `test_connectors.py` proves for HubSpot, Notion, Slack and Dropbox -- `httpx` is
substituted at the module, so no vendor is called, and the registry/env-var convention is proven
once more for the seventh connector.

Scopes are Cloudflare's own documented dotted permission-group names (`zone.read`, `dns.read`,
`dns.write`, `user-details.read`) -- confirmed from Cloudflare's OAuth client documentation and its
own blog examples (`user-details.read`, `zone.read`, `workers-scripts.write`), never the
colon-delimited strings an earlier draft of this connector guessed.
"""

from __future__ import annotations

import httpx
import pytest

from app.connectors import oauth_app_for, oauth_provider_for
from app.connectors.base import OAuthApp
from app.providers.providers import UpstreamRefused

APP = OAuthApp(client_id="client-id", client_secret="client-secret")


class Reply:
    def __init__(self, body, status: int = 200) -> None:
        self._body, self.status_code = body, status

    def json(self):
        return self._body


class Network:
    """Records each call and answers from a table keyed by URL. Cloudflare's own calls go through
    `httpx.request` (the connector's Cloudflare-error-aware `_call`), not `httpx.get`/`httpx.post`."""

    def __init__(self, monkeypatch, answers: dict) -> None:
        self.answers, self.calls = answers, []
        monkeypatch.setattr(httpx, "request", lambda method, url, **kw: self._answer(method, url, kw))

    def _answer(self, method, url, kwargs):
        self.calls.append((method, url, kwargs))
        return self.answers[url]


def test_cloudflare_is_registered_and_needs_a_deployment_registration(monkeypatch):
    assert oauth_provider_for("cloudflare").key == "cloudflare"
    monkeypatch.delenv("CLOUDFLARE_OAUTH_CLIENT_ID", raising=False)
    assert oauth_app_for("cloudflare") is None
    monkeypatch.setenv("CLOUDFLARE_OAUTH_CLIENT_ID", "id")
    monkeypatch.setenv("CLOUDFLARE_OAUTH_CLIENT_SECRET", "secret")
    assert oauth_app_for("cloudflare") == OAuthApp("id", "secret")


def test_authorize_url_asks_for_golds_documented_dns_scopes_only_and_carries_no_secret():
    url = oauth_provider_for("cloudflare").authorize_url(APP, state="s", redirect_uri="https://app.test/cb")
    assert "client-secret" not in url
    for scope in ("zone.read", "dns.read", "dns.write", "user-details.read"):
        assert scope in url
    # Least privilege: nothing billing- or account-admin-shaped is asked for, and no colon-delimited
    # guess from an earlier draft survives.
    assert "billing" not in url and "admin" not in url
    assert "account%3Aread" not in url and "account:read" not in url
    assert "dns_records" not in url  # the old, wrong permission-group spelling


def test_account_reads_the_signed_in_email(monkeypatch):
    Network(monkeypatch, {"https://api.cloudflare.com/client/v4/user": Reply({"result": {"email": "ops@example.test"}})})
    assert oauth_provider_for("cloudflare").account("tok").label == "ops@example.test"


def test_resources_lists_every_active_zone_across_pages(monkeypatch):
    Network(
        monkeypatch,
        {
            "https://api.cloudflare.com/client/v4/zones": Reply(
                {
                    "result": [{"id": "z1", "name": "example.com", "status": "active"}],
                    "result_info": {"total_pages": 1},
                }
            )
        },
    )
    resources = oauth_provider_for("cloudflare").resources("tok")
    assert resources == [
        {"resource_type": "cloudflare_zone", "external_id": "z1", "display_name": "example.com", "metadata": {"status": "active"}}
    ]


def test_a_refusal_carries_cloudflares_own_words_not_a_bare_status(monkeypatch):
    Network(
        monkeypatch,
        {
            "https://api.cloudflare.com/client/v4/user": Reply(
                {"success": False, "errors": [{"code": 9109, "message": "Invalid access token"}]}, status=401
            )
        },
    )
    with pytest.raises(UpstreamRefused, match="Invalid access token"):
        oauth_provider_for("cloudflare").account("tok")


def test_an_error_body_with_no_errors_array_falls_back_to_the_status(monkeypatch):
    Network(monkeypatch, {"https://api.cloudflare.com/client/v4/user": Reply({"success": False}, status=500)})
    with pytest.raises(UpstreamRefused, match="status 500"):
        oauth_provider_for("cloudflare").account("tok")
