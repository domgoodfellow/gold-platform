"""`send_platform_email`: the one function that knows Resend returns a message id.

`resend_sender` (the tenant channel path, `Sent(ok, detail)`, no id) is proven in its own
suite; this is the platform-email-specific counterpart that a webhook later correlates against.
"""

from __future__ import annotations

import httpx

from app.providers.resend.email import send_platform_email


class Reply:
    def __init__(self, body, status: int = 200) -> None:
        self._body, self.status_code = body, status
        self.text = str(body)

    def json(self):
        return self._body


def test_a_successful_send_returns_the_providers_own_message_id(monkeypatch) -> None:
    calls = []
    monkeypatch.setattr(httpx, "post", lambda url, **kw: calls.append((url, kw)) or Reply({"id": "re_abc123"}))

    result = send_platform_email(api_key="re_key", sender="GildOps <hello@gildops.test>", to="person@example.test", subject="Hi", text="Body")

    assert result == {"ok": True, "external_id": "re_abc123", "detail": None}
    (url, kw), = calls
    assert url == "https://api.resend.com/emails"
    assert kw["headers"]["Authorization"] == "Bearer re_key"
    assert kw["json"] == {
        "from": "GildOps <hello@gildops.test>",
        "to": ["person@example.test"],
        "subject": "Hi",
        "text": "Body",
    }


def test_a_refusal_carries_resends_own_words_and_no_id(monkeypatch) -> None:
    monkeypatch.setattr(httpx, "post", lambda *a, **kw: Reply({"message": "invalid `to` field"}, status=422))

    result = send_platform_email(api_key="re_key", sender="s", to="bad", subject="s", text="t")

    assert result["ok"] is False
    assert result["external_id"] is None
    assert "invalid `to` field" in result["detail"]


def test_unreachable_is_a_refusal_not_an_exception(monkeypatch) -> None:
    def raise_it(*a, **kw):
        raise httpx.ConnectError("boom")

    monkeypatch.setattr(httpx, "post", raise_it)
    result = send_platform_email(api_key="k", sender="s", to="t", subject="s", text="t")
    assert result["ok"] is False and result["external_id"] is None


def test_a_500_is_still_a_refusal_here_unlike_the_tenant_channel(monkeypatch) -> None:
    # Platform email has no outbox to retry from -- apps/web's own copyable link is the fallback,
    # so a 5xx is recorded exactly like a 4xx rather than raised for a caller to retry.
    monkeypatch.setattr(httpx, "post", lambda *a, **kw: Reply({"message": "upstream exploded"}, status=502))
    result = send_platform_email(api_key="k", sender="s", to="t", subject="s", text="t")
    assert result["ok"] is False


def test_a_2xx_with_no_message_id_is_not_a_successful_send(monkeypatch) -> None:
    # Nothing could ever correlate a later webhook back to this send without an id -- treated as
    # a refusal, never recorded as ok with a null provider_message_id (work order 1 closeout, §6).
    monkeypatch.setattr(httpx, "post", lambda *a, **kw: Reply({}))

    result = send_platform_email(api_key="k", sender="s", to="t", subject="s", text="t")

    assert result["ok"] is False
    assert result["external_id"] is None
    assert "no message id" in result["detail"]


def test_a_2xx_with_an_empty_string_id_is_also_not_a_successful_send(monkeypatch) -> None:
    monkeypatch.setattr(httpx, "post", lambda *a, **kw: Reply({"id": ""}))

    result = send_platform_email(api_key="k", sender="s", to="t", subject="s", text="t")

    assert result["ok"] is False
    assert result["external_id"] is None
