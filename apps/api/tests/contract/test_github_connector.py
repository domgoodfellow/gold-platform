"""GitHub's own adapter: installing the App, proving who installed it, minting a token, listing repositories.

No GitHub is called -- `httpx` is substituted at the module, as for every other connector -- so this
proves the contract GildOps depends on, not that a particular GitHub App is registered and
working. That second thing is a live check, and nothing in this file claims it.

What matters here beyond the happy path: **the installation id in the redirect is a value a person's
browser carries, so it is never trusted on its own.** An id that is not among the installations the
signing-in *user* can reach must be refused before any token is minted.
"""

from __future__ import annotations

import json
import time

import httpx
import jwt
import pytest
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa

from app.auth import CallerContext
from app.connectors import oauth_app_for, oauth_provider_for, readiness_of
from app.connectors.base import OAuthApp
from app.core.config import IntegrationSettings
from app.providers.providers import MalformedAnswer, UpstreamRefused
from app.services.integrations import operations as ops
from app.services.integrations.operations import ProviderRefusedError, operate

_KEY = rsa.generate_private_key(public_exponent=65537, key_size=2048)
PRIVATE_PEM = _KEY.private_bytes(
    serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption()
).decode()
PUBLIC_PEM = _KEY.public_key().public_bytes(
    serialization.Encoding.PEM, serialization.PublicFormat.SubjectPublicKeyInfo
).decode()

APP = OAuthApp(
    client_id="Iv1.client-id",
    client_secret="the-client-secret",
    extra={"GITHUB_APP_ID": "123456", "GITHUB_APP_SLUG": "gildops-test", "GITHUB_APP_PRIVATE_KEY": PRIVATE_PEM},
)
INSTALLATION = "987654"
USER_TOKEN = "ghu_the-users-own-token"
INSTALL_TOKEN = "ghs_the-installation-token"
SECRET_WORDS = ("the-client-secret", "BEGIN PRIVATE KEY", USER_TOKEN)


class Reply:
    def __init__(self, body, status: int = 200, headers: dict | None = None) -> None:
        self._body, self.status_code, self.headers = body, status, headers or {}

    def json(self):
        if isinstance(self._body, Exception):
            raise self._body
        return self._body


class GitHubWorld:
    """Answers each call from what a test arranged, and records every call made."""

    def __init__(self, monkeypatch) -> None:
        self.calls: list[tuple[str, str, dict]] = []
        self.code_reply: Reply = Reply({"access_token": USER_TOKEN, "token_type": "bearer"})
        self.user_installations: list[list[int]] = [[int(INSTALLATION)]]
        self.mint_reply: Reply = Reply(
            {"token": INSTALL_TOKEN, "expires_at": "2099-01-01T00:00:00Z", "permissions": {"metadata": "read", "contents": "read"}}
        )
        self.repository_pages: list[Reply] = [Reply({"total_count": 0, "repositories": []})]
        monkeypatch.setattr(httpx, "post", self._post)
        monkeypatch.setattr(httpx, "request", self._request)

    def _post(self, url, **kwargs):
        self.calls.append(("POST", url, kwargs))
        assert url == "https://github.com/login/oauth/access_token"
        return self.code_reply

    def _request(self, method, url, **kwargs):
        self.calls.append((method, url, kwargs))
        params = kwargs.get("params") or {}
        if url.endswith("/user/installations"):
            page = int(params.get("page", "1")) - 1
            ids = self.user_installations[page] if page < len(self.user_installations) else []
            return Reply({"total_count": sum(map(len, self.user_installations)), "installations": [{"id": i} for i in ids]})
        if "/app/installations/" in url and url.endswith("/access_tokens"):
            return self.mint_reply
        if url.endswith("/installation/repositories"):
            page = int(params.get("page", "1")) - 1
            return self.repository_pages[min(page, len(self.repository_pages) - 1)]
        raise AssertionError(f"unexpected GitHub call {method} {url}")

    def urls(self) -> list[str]:
        return [url for _, url, _ in self.calls]


@pytest.fixture
def github(monkeypatch) -> GitHubWorld:
    return GitHubWorld(monkeypatch)


def provider():
    return oauth_provider_for("github")


def exchange(extra: dict | None = None, code: str = "the-code"):
    return provider().exchange(APP, code=code, redirect_uri="https://app.test/cb", extra={"installation_id": INSTALLATION, **(extra or {})})


def never_leaks(value) -> None:
    for secret in SECRET_WORDS:
        assert secret not in str(value)


# ---------------------------------------------------------------------------------------
# Registration and the installation page
# ---------------------------------------------------------------------------------------


def test_the_app_needs_its_whole_registration_before_a_business_is_offered_it(monkeypatch):
    for name in ("GITHUB_APP_CLIENT_ID", "GITHUB_APP_CLIENT_SECRET", "GITHUB_APP_ID", "GITHUB_APP_SLUG", "GITHUB_APP_PRIVATE_KEY"):
        monkeypatch.delenv(name, raising=False)
    assert oauth_app_for("github") is None
    assert readiness_of("github").reason == "oauth_client_missing"

    for name in ("GITHUB_APP_CLIENT_ID", "GITHUB_APP_CLIENT_SECRET", "GITHUB_APP_ID", "GITHUB_APP_SLUG"):
        monkeypatch.setenv(name, "x")
    assert oauth_app_for("github") is None  # a signing key is still missing

    monkeypatch.setenv("GITHUB_APP_PRIVATE_KEY", PRIVATE_PEM)
    registered = oauth_app_for("github")
    assert registered is not None and registered.extra["GITHUB_APP_ID"] == "x"
    assert readiness_of("github").operational


def test_the_install_url_names_the_app_carries_the_state_and_no_secret():
    url = provider().authorize_url(APP, state="signed.state", redirect_uri="https://app.test/cb")
    assert url == "https://github.com/apps/gildops-test/installations/new?state=signed.state"
    never_leaks(url)


def test_a_slug_cannot_redirect_the_install_page_elsewhere():
    hostile = OAuthApp("i", "s", {**APP.extra, "GITHUB_APP_SLUG": "../../evil.test/x?"})
    url = provider().authorize_url(hostile, state="s", redirect_uri="x")
    assert url.startswith("https://github.com/apps/") and "evil.test/x?" not in url.split("?")[0].replace("%2F", "/")
    assert "/evil.test" not in url


# ---------------------------------------------------------------------------------------
# Proving who installed it, then minting
# ---------------------------------------------------------------------------------------


def test_exchange_proves_the_installation_is_the_users_then_mints_a_scoped_token(github):
    tokens = exchange()

    assert tokens.access_token == INSTALL_TOKEN
    assert tokens.refresh_token == INSTALLATION  # the durable handle is the installation, never a credential
    assert tokens.scopes == ["contents:read", "metadata:read"]
    assert tokens.expires_at > time.time() + 3600 * 24 * 365

    # The code was traded with the App's own client credentials and asked for JSON.
    post = next(call for call in github.calls if call[0] == "POST" and "login/oauth" in call[1])
    assert post[2]["data"]["code"] == "the-code" and post[2]["headers"]["Accept"] == "application/json"

    # The user's token asked only which installations the user can reach; the installation token never saw it.
    asked = next(call for call in github.calls if call[1].endswith("/user/installations"))
    assert asked[2]["headers"]["Authorization"] == f"Bearer {USER_TOKEN}"
    never_leaks(tokens)


def test_the_app_jwt_that_mints_is_rs256_issued_by_the_app_and_short_lived(github):
    exchange()
    mint = next(call for call in github.calls if call[1].endswith("/access_tokens"))
    assert mint[0] == "POST" and f"/app/installations/{INSTALLATION}/" in mint[1]

    claims = jwt.decode(mint[2]["headers"]["Authorization"].removeprefix("Bearer "), PUBLIC_PEM, algorithms=["RS256"])
    assert claims["iss"] == "123456"
    assert 0 < claims["exp"] - claims["iat"] <= 600  # GitHub's own ten-minute ceiling
    assert abs(claims["iat"] - (time.time() - 60)) < 30


def test_an_installation_that_is_not_the_users_is_refused_before_anything_is_minted(github):
    github.user_installations = [[111, 222]]  # not 987654: someone pasted another account's id
    with pytest.raises(UpstreamRefused, match="does not belong to the account that signed in"):
        exchange()
    assert not any(url.endswith("/access_tokens") for url in github.urls())


def test_the_users_installations_are_searched_across_pages(github):
    github.user_installations = [list(range(1, 101)), [int(INSTALLATION)]]
    assert exchange().refresh_token == INSTALLATION
    assert sum(url.endswith("/user/installations") for url in github.urls()) == 2


def test_an_org_that_needs_an_owner_to_approve_says_so_and_calls_nothing(github):
    with pytest.raises(UpstreamRefused, match="owner to approve"):
        exchange({"setup_action": "request"})
    assert github.calls == []


@pytest.mark.parametrize("bad", ["", "abc", "123; drop", "-1", "1" * 30])
def test_an_unusable_installation_id_is_refused_without_calling_github(github, bad):
    with pytest.raises(UpstreamRefused, match="did not say which installation"):
        exchange({"installation_id": bad})
    assert github.calls == []


def test_a_bad_code_is_refused_in_githubs_own_words_though_it_answers_200(github):
    github.code_reply = Reply({"error": "bad_verification_code", "error_description": "The code passed is incorrect or expired."})
    with pytest.raises(UpstreamRefused, match="incorrect or expired") as refusal:
        exchange()
    never_leaks(refusal.value)
    assert not any("/installations" in url for url in github.urls())


def test_refresh_mints_a_new_token_from_the_stored_installation_handle(github):
    renewed = provider().refresh(APP, refresh_token=INSTALLATION)
    assert renewed.access_token == INSTALL_TOKEN and renewed.refresh_token == INSTALLATION
    assert github.urls() == [f"https://api.github.com/app/installations/{INSTALLATION}/access_tokens"]


def test_a_corrupt_stored_handle_is_not_sent_to_github(github):
    with pytest.raises(UpstreamRefused, match="Reconnect"):
        provider().refresh(APP, refresh_token="not-an-id")
    assert github.calls == []


@pytest.mark.parametrize("status", [401, 404])
def test_a_removed_installation_reads_as_one_to_reconnect(github, status):
    github.mint_reply = Reply({"message": "Not Found"}, status=status)
    with pytest.raises(UpstreamRefused, match="no longer recognizes this installation"):
        provider().refresh(APP, refresh_token=INSTALLATION)


def test_a_key_that_cannot_sign_fails_without_naming_it(github):
    broken = OAuthApp("i", "s", {**APP.extra, "GITHUB_APP_PRIVATE_KEY": "-----BEGIN PRIVATE KEY-----\nnot a key\n-----END PRIVATE KEY-----"})
    with pytest.raises(UpstreamRefused, match="key is not usable") as refusal:
        provider().refresh(broken, refresh_token=INSTALLATION)
    assert "not a key" not in str(refusal.value) and "BEGIN" not in str(refusal.value)
    assert github.calls == []


def test_an_escaped_newline_key_from_an_environment_variable_still_signs(github):
    one_line = OAuthApp("i", "s", {**APP.extra, "GITHUB_APP_PRIVATE_KEY": PRIVATE_PEM.replace("\n", "\\n")})
    assert provider().refresh(one_line, refresh_token=INSTALLATION).access_token == INSTALL_TOKEN


# ---------------------------------------------------------------------------------------
# What the installation reaches
# ---------------------------------------------------------------------------------------


def repo(i: int, **over) -> dict:
    return {
        "id": i, "name": f"repo-{i}", "full_name": f"acme/repo-{i}", "private": True, "archived": False,
        "default_branch": "main", "html_url": f"https://github.com/acme/repo-{i}", "owner": {"login": "acme"}, **over,
    }


def test_repositories_become_resources_with_the_facts_a_deployment_needs(github):
    github.repository_pages = [Reply({"total_count": 2, "repositories": [repo(1), repo(2, private=False, archived=True, default_branch="trunk", visibility="public")]})]
    found = provider().resources(INSTALL_TOKEN)
    assert found[0] == {
        "resource_type": "github_repository", "external_id": "1", "display_name": "acme/repo-1",
        "metadata": {"owner": "acme", "name": "repo-1", "default_branch": "main", "visibility": "private", "archived": False, "url": "https://github.com/acme/repo-1"},
    }
    assert found[1]["metadata"] | {} == {"owner": "acme", "name": "repo-2", "default_branch": "trunk", "visibility": "public", "archived": True, "url": "https://github.com/acme/repo-2"}


def test_every_page_of_repositories_is_read(github):
    github.repository_pages = [
        Reply({"repositories": [repo(i) for i in range(1, 101)]}),
        Reply({"repositories": [repo(i) for i in range(101, 104)]}),
    ]
    found = provider().resources(INSTALL_TOKEN)
    assert len(found) == 103 and found[-1]["external_id"] == "103"
    assert sum(url.endswith("/installation/repositories") for url in github.urls()) == 2


def test_a_row_with_no_id_or_name_is_skipped_not_invented(github):
    github.repository_pages = [Reply({"repositories": [repo(1), {"name": "no-id"}, {"id": 9}, "nonsense", repo(2)]})]
    assert [r["external_id"] for r in provider().resources(INSTALL_TOKEN)] == ["1", "2"]


def test_an_answer_that_is_not_a_repository_list_is_malformed(github):
    github.repository_pages = [Reply({"repositories": "nope"})]
    with pytest.raises(MalformedAnswer):
        provider().resources(INSTALL_TOKEN)


def test_the_account_is_named_by_whoever_owns_what_the_installation_reaches(github):
    github.repository_pages = [Reply({"repositories": [repo(1, owner={"login": "acme-inc"})]})]
    assert provider().account(INSTALL_TOKEN).label == "acme-inc"
    github.repository_pages = [Reply({"repositories": []})]
    assert provider().account(INSTALL_TOKEN).label == "GitHub account"


@pytest.mark.parametrize(
    "reply",
    [Reply({"message": "API rate limit exceeded"}, 403, {"x-ratelimit-remaining": "0"}), Reply({"message": "slow down"}, 429), Reply({"message": "secondary"}, 403, {"retry-after": "60"})],
)
def test_rate_limiting_is_said_plainly_and_not_mistaken_for_a_removed_installation(github, reply):
    github.repository_pages = [reply]
    with pytest.raises(UpstreamRefused, match="limiting requests"):
        provider().resources(INSTALL_TOKEN)


def test_an_answer_that_is_not_json_or_not_an_object_is_malformed(github):
    github.repository_pages = [Reply(ValueError("not json"))]
    with pytest.raises(MalformedAnswer):
        provider().resources(INSTALL_TOKEN)
    github.repository_pages = [Reply(["a", "list"])]
    with pytest.raises(MalformedAnswer):
        provider().resources(INSTALL_TOKEN)


def test_a_network_failure_names_the_failure_and_nothing_of_the_request(monkeypatch):
    def down(*args, **kwargs):
        raise httpx.ConnectError("boom with ghs_secret")

    monkeypatch.setattr(httpx, "request", down)
    with pytest.raises(UpstreamRefused) as refusal:
        provider().resources(INSTALL_TOKEN)
    assert "ConnectError" in str(refusal.value) and "ghs_secret" not in str(refusal.value)


def test_revoking_asks_nothing_of_github(github):
    provider().revoke(APP, token=INSTALLATION)
    assert github.calls == []


# ---------------------------------------------------------------------------------------
# The same adapter through the API's operations: what is stored, and what a lost installation does
# ---------------------------------------------------------------------------------------

SETTINGS = IntegrationSettings(
    supabase_url="http://db.test", supabase_publishable_key="anon", supabase_jwt_secret="signing",
    state_secret="state-secret", redirect_uri="https://app.test/connect/oauth/callback",
)
ORG = "11111111-1111-4111-8111-111111111111"
CONNECTION = "22222222-2222-4222-8222-222222222222"
ALICE = "33333333-3333-4333-8333-333333333333"


def alice() -> CallerContext:
    return CallerContext.build(user_id=ALICE, token="caller-token", claims={"role": "authenticated"}, verification_mechanism="jwks")


class Stored:
    def __init__(self, monkeypatch) -> None:
        self.stored: list[str] = []
        self.health: list[dict] = []
        self.resources: list[dict] = []
        self.cleared = 0
        self.held: dict | None = None
        monkeypatch.setattr(ops.db, "store_integration_credential", lambda s, *, connection_id, secret: self.stored.append(secret))
        monkeypatch.setattr(ops.db, "record_integration_health", lambda s, **kw: self.health.append(kw))
        monkeypatch.setattr(ops.db, "replace_integration_resources", lambda s, *, connection_id, resources: self.resources.extend(resources))
        monkeypatch.setattr(ops.db, "clear_integration_credential", lambda s, *, connection_id: setattr(self, "cleared", self.cleared + 1))
        monkeypatch.setattr(
            ops.db, "read_integration_credential",
            lambda s, *, connection_id: {"secret": json.dumps(self.held)} if self.held else None,
        )


@pytest.fixture
def stored(monkeypatch) -> Stored:
    for name, value in {"GITHUB_APP_CLIENT_ID": "id", "GITHUB_APP_CLIENT_SECRET": "the-client-secret", **APP.extra}.items():
        monkeypatch.setenv(name, value)
    return Stored(monkeypatch)


def route_rest(monkeypatch, github: GitHubWorld) -> None:
    """The caller-token PostgREST calls, layered over GitHub's own."""
    github_request = httpx.request

    def request(method, url, **kwargs):
        if url.startswith("http://db.test/rest/v1/"):
            path = url.removeprefix("http://db.test/rest/v1/")
            if path == "rpc/can_manage_integrations":
                return Reply(True)
            if path == "integration_connections":
                return Reply([{"id": CONNECTION, "organization_id": ORG, "connector_key": "github", "status": "active"}])
            if path == "platform_connectors":
                return Reply([{"status": "beta"}])
            if path == "rpc/record_integration_connection":
                return Reply(CONNECTION)
            if path == "rpc/disconnect_integration":
                return Reply(None)
            raise AssertionError(path)
        return github_request(method, url, **kwargs)

    monkeypatch.setattr(httpx, "request", request)


def test_completing_stores_the_installation_handle_only_and_lists_the_repositories(monkeypatch, github, stored):
    github.repository_pages = [Reply({"repositories": [repo(1, owner={"login": "acme"}), repo(2)]})]
    route_rest(monkeypatch, github)

    begun = operate(SETTINGS, alice(), operation="begin", arguments={"organization_id": ORG, "connector_key": "github"})
    assert begun["url"].startswith("https://github.com/apps/gildops-test/installations/new?state=")
    state = begun["url"].split("state=")[1]

    done = operate(
        SETTINGS, alice(), operation="complete",
        arguments={"code": "c", "state": state.replace("%2E", "."), "nonce": begun["nonce"], "extra": {"installation_id": INSTALLATION, "setup_action": "install"}},
    )
    assert done == {"organization_id": ORG, "connection_id": CONNECTION}

    saved = json.loads(stored.stored[0])
    assert saved["refresh_token"] == INSTALLATION and saved["access_token"] == INSTALL_TOKEN
    never_leaks(stored.stored)  # the user's token and the App's key were never kept
    assert stored.health[-1]["ok"] is True and stored.health[-1]["account_label"] == "acme"
    assert stored.health[-1]["scopes"] == ["contents:read", "metadata:read"]
    assert [r["display_name"] for r in stored.resources] == ["acme/repo-1", "acme/repo-2"]


def test_a_spoofed_installation_creates_no_connection_and_stores_nothing(monkeypatch, github, stored):
    github.user_installations = [[1]]
    route_rest(monkeypatch, github)
    begun = operate(SETTINGS, alice(), operation="begin", arguments={"organization_id": ORG, "connector_key": "github"})

    with pytest.raises(ProviderRefusedError, match="does not belong"):
        operate(
            SETTINGS, alice(), operation="complete",
            arguments={"code": "c", "state": begun["url"].split("state=")[1].replace("%2E", "."), "nonce": begun["nonce"], "extra": {"installation_id": "5555"}},
        )
    assert stored.stored == [] and stored.resources == []


def test_a_removed_installation_turns_the_connection_to_needs_attention_on_the_next_check(monkeypatch, github, stored):
    route_rest(monkeypatch, github)
    stored.held = {"access_token": "expired", "refresh_token": INSTALLATION, "expires_at": 1}  # the hour is up
    github.mint_reply = Reply({"message": "Not Found"}, status=404)  # and the person removed the App on GitHub

    with pytest.raises(ProviderRefusedError, match="no longer recognizes"):
        operate(SETTINGS, alice(), operation="sync", arguments={"connection_id": CONNECTION})

    assert stored.health[-1]["ok"] is False
    assert "no longer recognizes" in stored.health[-1]["error"]
    assert stored.stored == []  # nothing replaced a credential that could not be renewed


def test_a_live_installation_renews_its_token_and_refreshes_the_repository_list(monkeypatch, github, stored):
    route_rest(monkeypatch, github)
    stored.held = {"access_token": "expired", "refresh_token": INSTALLATION, "expires_at": 1}
    github.repository_pages = [Reply({"repositories": [repo(7)]})]

    assert operate(SETTINGS, alice(), operation="sync", arguments={"connection_id": CONNECTION}) == {"ok": True, "resources": 1}
    assert json.loads(stored.stored[0])["access_token"] == INSTALL_TOKEN
    assert stored.health[-1]["ok"] is True


def test_disconnecting_deletes_the_handle_and_leaves_the_installation_to_its_owner(monkeypatch, github, stored):
    route_rest(monkeypatch, github)
    stored.held = {"access_token": INSTALL_TOKEN, "refresh_token": INSTALLATION, "expires_at": 4_000_000_000}
    assert operate(SETTINGS, alice(), operation="disconnect", arguments={"connection_id": CONNECTION}) == {"ok": True}
    assert stored.cleared == 1
    assert github.calls == []  # nothing was uninstalled on GitHub's side
