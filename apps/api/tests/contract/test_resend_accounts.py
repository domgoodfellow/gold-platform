"""GOLD's own Resend account: whether the stored credential works. The same shape
`test_connectors.py` and `test_cloudflare_connector.py` hold for a vendor's handshake --
`httpx` is substituted at the module, so no vendor is called.
"""

from __future__ import annotations

import httpx

from app.providers.resend.accounts import OPERATIONS, verify


class Reply:
    def __init__(self, body, status: int = 200) -> None:
        self._body, self.status_code, self.text = body, status, str(body)

    def json(self):
        return self._body


def test_no_credential_is_a_plain_refusal_not_a_network_call(monkeypatch) -> None:
    called = []
    monkeypatch.setattr(httpx, "get", lambda *a, **kw: called.append(1))
    assert verify({}) == {"ok": False, "error": "This account has no credential stored.", "metadata": {}}
    assert called == []


def test_a_working_key_reports_how_many_domains_are_visible(monkeypatch) -> None:
    calls = []
    monkeypatch.setattr(httpx, "get", lambda url, **kw: calls.append((url, kw)) or Reply({"data": [{"id": "d1"}, {"id": "d2"}]}))

    result = verify({"secret": "re_test_key"})

    assert result == {"ok": True, "error": None, "metadata": {"domains_visible": 2}}
    (url, kw), = calls
    assert url == "https://api.resend.com/domains"
    assert kw["headers"]["Authorization"] == "Bearer re_test_key"


def test_a_refusal_carries_resends_own_words(monkeypatch) -> None:
    monkeypatch.setattr(httpx, "get", lambda *a, **kw: Reply("invalid API key", status=401))
    result = verify({"secret": "bad"})
    assert result["ok"] is False
    assert "401" in result["error"] and "invalid API key" in result["error"]


def test_unreachable_is_a_refusal_not_an_exception(monkeypatch) -> None:
    def raise_it(*a, **kw):
        raise httpx.ConnectError("boom")

    monkeypatch.setattr(httpx, "get", raise_it)
    result = verify({"secret": "k"})
    assert result["ok"] is False and "could not be reached" in result["error"]


def test_the_operations_registry_only_offers_verify() -> None:
    assert set(OPERATIONS) == {"verify"}
