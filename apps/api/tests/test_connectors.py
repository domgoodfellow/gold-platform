"""The four connectors that differ from the two suites: HubSpot, Notion, Slack and Dropbox.

`test_integration_operations.py` proves the contract around a connector (who may act, what is
stored, what may leave). This file proves what each vendor's adapter itself does with the network:
how it asks for a token, how it names the account, what it reports as reachable, and that a
refusal reads as a refusal. `httpx` is substituted at the module, so no vendor is called.
"""

from __future__ import annotations

import base64
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import httpx  # noqa: E402
import pytest  # noqa: E402

from app.connectors import oauth_app_for, oauth_provider_for  # noqa: E402
from app.connectors.base import OAuthApp  # noqa: E402
from app.providers.providers import UpstreamRefused  # noqa: E402

APP = OAuthApp(client_id="client-id", client_secret="client-secret")


class Reply:
    def __init__(self, body, status: int = 200) -> None:
        self._body, self.status_code = body, status

    def json(self):
        return self._body


class Network:
    """Records each call and answers from a table keyed by URL."""

    def __init__(self, monkeypatch, answers: dict) -> None:
        self.answers, self.calls = answers, []
        monkeypatch.setattr(httpx, "get", lambda url, **kw: self._answer("GET", url, kw))
        monkeypatch.setattr(httpx, "post", lambda url, **kw: self._answer("POST", url, kw))

    def _answer(self, method, url, kwargs):
        self.calls.append((method, url, kwargs))
        return self.answers[url]


def test_each_new_connector_is_registered_and_needs_a_deployment_registration(monkeypatch):
    for key, prefix in [("hubspot", "HUBSPOT"), ("notion", "NOTION"), ("slack", "SLACK"), ("dropbox", "DROPBOX")]:
        assert oauth_provider_for(key).key == key
        monkeypatch.delenv(f"{prefix}_OAUTH_CLIENT_ID", raising=False)
        assert oauth_app_for(key) is None  # unregistered here: refused, never guessed at
        monkeypatch.setenv(f"{prefix}_OAUTH_CLIENT_ID", "id")
        monkeypatch.setenv(f"{prefix}_OAUTH_CLIENT_SECRET", "secret")
        assert oauth_app_for(key) == OAuthApp("id", "secret")


def test_authorize_urls_never_carry_the_client_secret_and_ask_for_read_access():
    for key in ("hubspot", "notion", "slack", "dropbox"):
        url = oauth_provider_for(key).authorize_url(APP, state="s", redirect_uri="https://app.test/cb")
        assert "client_id=client-id" in url and "client-secret" not in url and "state=s" in url
    assert "scope=" not in oauth_provider_for("notion").authorize_url(APP, state="s", redirect_uri="x")
    assert "token_access_type=offline" in oauth_provider_for("dropbox").authorize_url(APP, state="s", redirect_uri="x")


def test_hubspot_names_the_portal_and_lists_deal_pipelines(monkeypatch):
    net = Network(
        monkeypatch,
        {
            "https://api.hubapi.com/oauth/v1/access-tokens/tok": Reply({"hub_domain": "acme.example", "user": "a@b.test"}),
            "https://api.hubapi.com/crm/v3/pipelines/deals": Reply({"results": [{"id": "p1", "label": "Sales"}]}),
        },
    )
    hubspot = oauth_provider_for("hubspot")
    assert hubspot.account("tok").label == "acme.example"
    assert hubspot.resources("tok") == [{"resource_type": "hubspot_pipeline", "external_id": "p1", "display_name": "Sales", "metadata": {}}]
    assert all(kw["headers"]["Authorization"] == "Bearer tok" for _, _, kw in net.calls)


def test_notion_exchanges_a_code_with_basic_auth_and_a_json_body_and_never_expects_a_refresh(monkeypatch):
    net = Network(monkeypatch, {"https://api.notion.com/v1/oauth/token": Reply({"access_token": "ntn-1"})})
    tokens = oauth_provider_for("notion").exchange(APP, code="c", redirect_uri="https://app.test/cb")

    _, _, kwargs = net.calls[0]
    assert kwargs["json"] == {"grant_type": "authorization_code", "code": "c", "redirect_uri": "https://app.test/cb"}
    assert kwargs["headers"]["Authorization"] == "Basic " + base64.b64encode(b"client-id:client-secret").decode()
    assert "client-secret" not in str(kwargs["json"])
    assert tokens.refresh_token is None
    assert tokens.expires_at > time.time() + 5 * 365 * 24 * 3600  # not an hour: nothing will try to refresh it


def test_notion_lists_the_databases_that_were_shared_and_sends_its_version_header(monkeypatch):
    net = Network(
        monkeypatch,
        {
            "https://api.notion.com/v1/users/me": Reply({"bot": {"workspace_name": "Acme"}}),
            "https://api.notion.com/v1/search": Reply({"results": [{"id": "db1", "title": [{"plain_text": "Leads"}]}]}),
        },
    )
    notion = oauth_provider_for("notion")
    assert notion.account("tok").label == "Acme"
    assert notion.resources("tok")[0]["display_name"] == "Leads"
    assert all(kw["headers"]["Notion-Version"] for _, _, kw in net.calls)


def test_slack_reads_a_refusal_from_ok_false_not_from_the_status(monkeypatch):
    Network(monkeypatch, {"https://slack.com/api/auth.test": Reply({"ok": False, "error": "invalid_auth"})})
    with pytest.raises(UpstreamRefused, match="invalid_auth"):
        oauth_provider_for("slack").account("tok")


def test_slack_lists_public_channels_and_a_bot_token_is_not_refreshed(monkeypatch):
    Network(
        monkeypatch,
        {
            "https://slack.com/api/auth.test": Reply({"ok": True, "team": "Acme"}),
            "https://slack.com/api/conversations.list": Reply({"ok": True, "channels": [{"id": "C1", "name": "general"}]}),
            "https://slack.com/api/oauth.v2.access": Reply({"ok": True, "access_token": "xoxb-1", "scope": "channels:read"}),
        },
    )
    slack = oauth_provider_for("slack")
    assert slack.account("tok").label == "Acme"
    assert slack.resources("tok")[0]["display_name"] == "#general"
    assert slack.exchange(APP, code="c", redirect_uri="x").expires_at > time.time() + 5 * 365 * 24 * 3600


def test_dropbox_posts_for_account_and_lists_only_folders(monkeypatch):
    net = Network(
        monkeypatch,
        {
            "https://api.dropboxapi.com/2/users/get_current_account": Reply({"email": "o@example.test"}),
            "https://api.dropboxapi.com/2/files/list_folder": Reply(
                {"entries": [{".tag": "folder", "id": "id:1", "name": "Jobs"}, {".tag": "file", "id": "id:2", "name": "a.csv"}]}
            ),
        },
    )
    dropbox = oauth_provider_for("dropbox")
    assert dropbox.account("tok").label == "o@example.test"
    assert [r["display_name"] for r in dropbox.resources("tok")] == ["Jobs"]
    assert all(method == "POST" for method, _, _ in net.calls)


def test_a_vendor_refusal_carries_its_words_and_no_credential(monkeypatch):
    Network(monkeypatch, {"https://api.hubapi.com/oauth/v1/access-tokens/tok": Reply({"message": "token expired"}, status=401)})
    with pytest.raises(UpstreamRefused) as refusal:
        oauth_provider_for("hubspot").account("tok")
    assert "token expired" in str(refusal.value) and "tok" not in str(refusal.value).replace("token", "")
