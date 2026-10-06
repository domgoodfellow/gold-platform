"""Whether this deployment can connect each app -- the API's own answer, and the only one.

The web keeps no list of implemented connectors: it asks. So what the answer may carry is the
contract here: a yes or a coarse reason for anyone signed in, the names of the missing inputs for
platform staff alone, and never the value of a credential to anybody.
"""

from __future__ import annotations

import json

import httpx
import pytest

from app.auth import CallerContext
from app.connectors import readiness_of, registered_connector_keys
from app.core.config import IntegrationSettings
from app.errors import NotFoundError
from app.services.integrations.operations import operate

SETTINGS = IntegrationSettings(
    supabase_url="http://db.test",
    supabase_publishable_key="anon",
    supabase_jwt_secret="signing",
    state_secret="state-secret",
    redirect_uri="https://app.test/connect/oauth/callback",
)
CALLER = CallerContext.build(
    user_id="33333333-3333-4333-8333-333333333333",
    token="caller-token",
    claims={"role": "authenticated"},
    verification_mechanism="jwks",
)
PREFIXES = {
    "google_workspace": "GOOGLE_OAUTH",
    "microsoft_365": "MICROSOFT_OAUTH",
    "hubspot": "HUBSPOT_OAUTH",
    "notion": "NOTION_OAUTH",
    "slack": "SLACK_OAUTH",
    "dropbox": "DROPBOX_OAUTH",
    "cloudflare": "CLOUDFLARE_OAUTH",
    "github": "GITHUB_APP",
}
# A vendor whose registration is more than a client id and secret. All of it, or the connector is not offered.
FURTHER = {"github": ("GITHUB_APP_ID", "GITHUB_APP_SLUG", "GITHUB_APP_PRIVATE_KEY")}


class Response:
    def __init__(self, status: int, body) -> None:
        self.status_code, self._body = status, body
        self.text = json.dumps(body)

    def json(self):
        return self._body


@pytest.fixture(autouse=True)
def clean_environment(monkeypatch):
    for prefix in PREFIXES.values():
        monkeypatch.delenv(f"{prefix}_CLIENT_ID", raising=False)
        monkeypatch.delenv(f"{prefix}_CLIENT_SECRET", raising=False)
    for names in FURTHER.values():
        for name in names:
            monkeypatch.delenv(name, raising=False)


def staff(monkeypatch, *, is_staff: bool) -> None:
    def request(method, url, **kwargs):
        assert url == "http://db.test/rest/v1/rpc/platform_connector_usage"
        return Response(200, []) if is_staff else Response(403, {"code": "42501"})

    monkeypatch.setattr(httpx, "request", request)


def test_the_registry_and_this_test_name_the_same_connectors():
    assert registered_connector_keys() == sorted(PREFIXES)


@pytest.mark.parametrize("key", sorted(PREFIXES))
def test_a_registered_connector_is_unconfigured_until_both_halves_of_its_registration_exist(monkeypatch, key):
    prefix = PREFIXES[key]

    found = readiness_of(key)
    assert (found.implemented, found.configured, found.reason) == (True, False, "oauth_client_missing")
    assert not found.operational

    monkeypatch.setenv(f"{prefix}_CLIENT_ID", "id")
    assert readiness_of(key).reason == "oauth_client_missing"  # an id with no secret is not a registration

    monkeypatch.setenv(f"{prefix}_CLIENT_SECRET", "secret")
    for name in FURTHER.get(key, ()):
        # Half a registration is not one: the connector stays unoffered until every input is present.
        assert readiness_of(key).reason == "oauth_client_missing"
        monkeypatch.setenv(name, "value")
    found = readiness_of(key)
    assert (found.implemented, found.configured, found.reason) == (True, True, None)
    assert found.operational


def test_a_connector_with_no_adapter_is_not_implemented_whatever_the_environment_holds(monkeypatch):
    monkeypatch.setenv("SALESFORCE_OAUTH_CLIENT_ID", "id")
    monkeypatch.setenv("SALESFORCE_OAUTH_CLIENT_SECRET", "secret")
    found = readiness_of("salesforce")
    assert (found.implemented, found.configured, found.reason) == (False, False, "adapter_missing")


def test_any_signed_in_caller_gets_a_yes_or_a_reason_and_no_input_names_and_no_values(monkeypatch):
    monkeypatch.setenv("SLACK_OAUTH_CLIENT_ID", "slack-client-id-value")
    monkeypatch.setenv("SLACK_OAUTH_CLIENT_SECRET", "slack-client-secret-value")

    answer = operate(SETTINGS, CALLER, operation="readiness", arguments={"connector_keys": ["slack", "hubspot", "salesforce"]})

    assert answer["connectors"] == [
        {"connector_key": "slack", "implemented": True, "configured": True, "reason": None},
        {"connector_key": "hubspot", "implemented": True, "configured": False, "reason": "oauth_client_missing"},
        {"connector_key": "salesforce", "implemented": False, "configured": False, "reason": "adapter_missing"},
    ]
    rendered = json.dumps(answer)
    assert "slack-client" not in rendered and "SLACK_OAUTH" not in rendered and "app.test" not in rendered


def test_with_no_keys_asked_it_answers_for_every_registered_connector():
    answer = operate(SETTINGS, CALLER, operation="readiness", arguments={})
    assert sorted(item["connector_key"] for item in answer["connectors"]) == sorted(PREFIXES)


def test_platform_staff_alone_learns_what_is_missing_and_never_a_value(monkeypatch):
    staff(monkeypatch, is_staff=True)
    monkeypatch.setenv("GOOGLE_OAUTH_CLIENT_ID", "the-client-id-value")
    monkeypatch.setenv("GOOGLE_OAUTH_CLIENT_SECRET", "the-client-secret-value")

    answer = operate(SETTINGS, CALLER, operation="readiness_detail", arguments={"connector_keys": ["google_workspace", "notion"]})

    google, notion = answer["connectors"]
    assert google["configured"] is True and notion["reason"] == "oauth_client_missing"
    assert notion["required_configuration"] == ["NOTION_OAUTH_CLIENT_ID", "NOTION_OAUTH_CLIENT_SECRET"]
    github = operate(SETTINGS, CALLER, operation="readiness_detail", arguments={"connector_keys": ["github"]})["connectors"][0]
    assert github["required_configuration"] == [
        "GITHUB_APP_CLIENT_ID", "GITHUB_APP_CLIENT_SECRET", "GITHUB_APP_ID", "GITHUB_APP_SLUG", "GITHUB_APP_PRIVATE_KEY",
    ]
    assert answer["redirect_uri"] == SETTINGS.redirect_uri
    assert "value" not in json.dumps(answer)


def test_someone_who_is_not_staff_is_told_there_is_no_such_operation(monkeypatch):
    staff(monkeypatch, is_staff=False)
    with pytest.raises(NotFoundError):
        operate(SETTINGS, CALLER, operation="readiness_detail", arguments={})
