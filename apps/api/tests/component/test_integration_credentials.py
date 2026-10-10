"""Renewing a token when several callers need it at once.

A vendor that rotates its refresh token refuses the old one as soon as the new one is issued, so two
requests that both find a token near expiry must not leave the older pair stored or treat the loser's
refusal as a dead sign-in. The atomic compare-and-swap itself is proven against real Postgres in
`integration-tool-grants.test.ts`; this is the decision this process makes around its answer.
"""

from __future__ import annotations

import json
import time

import pytest

from app.connectors.base import OAuthApp, OAuthProvider, Tokens
from app.core import db
from app.core.config import IntegrationSettings
from app.providers.providers import UpstreamRefused
from app.services.integrations import credentials

SETTINGS = IntegrationSettings("http://db.test", "anon", "signing", "state", "https://app.test/cb")
APP = OAuthApp("id", "secret")
CONNECTION = "33333333-3333-4333-8333-333333333333"


def pair(n: int, *, expires: int | None = None) -> dict:
    return {"access_token": f"access-{n}", "refresh_token": f"refresh-{n}", "expires_at": expires if expires is not None else int(time.time()) + 3600}


class Vendor(OAuthProvider):
    key = "fixture"

    def __init__(self, result: Tokens | Exception) -> None:
        self.result, self.refreshed_from = result, []

    def refresh(self, app, *, refresh_token):
        self.refreshed_from.append(refresh_token)
        if isinstance(self.result, Exception):
            raise self.result
        return self.result


def arrange(monkeypatch, *, swap: bool, stored: dict | None = None):
    swaps = []
    monkeypatch.setattr(db, "swap_integration_credential", lambda s, *, connection_id, expected_refresh_token, secret: swaps.append((expected_refresh_token, secret)) or swap)
    monkeypatch.setattr(db, "read_integration_credential", lambda s, *, connection_id: {"secret": json.dumps(stored)} if stored else None)
    return swaps


def renewed() -> Tokens:
    return Tokens("access-2", "refresh-2", int(time.time()) + 3600, ["a"])


def test_a_fresh_token_is_used_without_touching_the_vendor_or_the_store(monkeypatch):
    swaps = arrange(monkeypatch, swap=True)
    vendor = Vendor(renewed())
    token, scopes = credentials.usable_token(SETTINGS, vendor, APP, CONNECTION, pair(1))
    assert (token, scopes) == ("access-1", None) and vendor.refreshed_from == [] and swaps == []


def test_a_renewal_that_wins_is_the_one_stored(monkeypatch):
    swaps = arrange(monkeypatch, swap=True)
    token, scopes = credentials.usable_token(SETTINGS, Vendor(renewed()), APP, CONNECTION, pair(1, expires=1))
    assert (token, scopes) == ("access-2", ["a"])
    assert swaps[0][0] == "refresh-1" and json.loads(swaps[0][1])["refresh_token"] == "refresh-2"


def test_a_renewal_that_loses_uses_the_winners_newer_pair_and_does_not_overwrite_it(monkeypatch):
    arrange(monkeypatch, swap=False, stored=pair(3))
    token, _ = credentials.usable_token(SETTINGS, Vendor(renewed()), APP, CONNECTION, pair(1, expires=1))
    assert token == "access-3"


def test_a_refusal_after_someone_else_rotated_is_not_a_dead_sign_in(monkeypatch):
    arrange(monkeypatch, swap=True, stored=pair(3))
    token, _ = credentials.usable_token(SETTINGS, Vendor(UpstreamRefused("invalid_grant")), APP, CONNECTION, pair(1, expires=1))
    assert token == "access-3"


def test_a_refusal_with_nothing_newer_stored_is_a_dead_sign_in(monkeypatch):
    arrange(monkeypatch, swap=True, stored=pair(1, expires=1))
    with pytest.raises(UpstreamRefused):
        credentials.usable_token(SETTINGS, Vendor(UpstreamRefused("invalid_grant")), APP, CONNECTION, pair(1, expires=1))


def test_an_expired_token_with_no_refresh_token_cannot_be_renewed(monkeypatch):
    arrange(monkeypatch, swap=True)
    with pytest.raises(UpstreamRefused, match="cannot be renewed"):
        credentials.usable_token(SETTINGS, Vendor(renewed()), APP, CONNECTION, {"access_token": "old", "refresh_token": None, "expires_at": 1})
