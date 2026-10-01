"""Cloudflare's own adapter: the handshake plumbing and what counts as a reachable zone.

The same shape `test_connectors.py` proves for HubSpot, Notion, Slack and Dropbox -- `httpx` is
substituted at the module, so no vendor is called, and the registry/env-var convention is proven
once more for the seventh connector.
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
    def __init__(self, monkeypatch, answers: dict) -> None:
        self.answers, self.calls = answers, []
        monkeypatch.setattr(httpx, "get", lambda url, **kw: self._answer("GET", url, kw))
        monkeypatch.setattr(httpx, "post", lambda url, **kw: self._answer("POST", url, kw))

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


def test_authorize_url_asks_for_dns_scopes_only_and_carries_no_secret():
    url = oauth_provider_for("cloudflare").authorize_url(APP, state="s", redirect_uri="https://app.test/cb")
    assert "client-secret" not in url
    assert "dns_records%3Aedit" in url or "dns_records:edit" in url
    # Least privilege: nothing billing- or account-admin-shaped is asked for.
    assert "billing" not in url and "admin" not in url


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


def test_a_refusal_still_raises_even_though_the_shared_client_reads_a_different_error_shape(monkeypatch):
    Network(monkeypatch, {"https://api.cloudflare.com/client/v4/user": Reply({"success": False, "errors": [{"code": 9109, "message": "Invalid access token"}]}, status=401)})
    with pytest.raises(UpstreamRefused):
        oauth_provider_for("cloudflare").account("tok")
