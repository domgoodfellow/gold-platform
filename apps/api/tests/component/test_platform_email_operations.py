"""`send_invitation_email`: who may be sent to, which credential answers, and what is recorded.

The vendor boundary (`app.providers.resend.email.send_platform_email`) is replaced here exactly as
`test_web_delivery_domains.py` replaces `app.providers.vercel.domains` -- this file proves the
capability's own sequencing: the recipient comes from the invitation row alone, never from the
caller; the account is tried before the environment; every outcome is recorded.
"""

from __future__ import annotations

import json

import pytest

from app.core.config import ProviderOperationsSettings
from app.errors import NotFoundError, ValidationError
from app.services.platform_email import operations as ops
from app.services.platform_email.operations import send_invitation_email

SETTINGS = ProviderOperationsSettings(
    supabase_url="http://db.test", supabase_publishable_key="anon", supabase_jwt_secret="signing"
)
ORG = "11111111-1111-4111-8111-111111111111"
INVITATION = "22222222-2222-4222-8222-222222222222"
ACCOUNT = "33333333-3333-4333-8333-333333333333"
LINK = "https://app.test/organizations/accept-invite/tok123"


class Response:
    def __init__(self, status: int, body) -> None:
        self.status_code = status
        self._body = body

    def json(self):
        return self._body


class World:
    def __init__(self, monkeypatch, *, visible=True, account=ACCOUNT, credential=None, env=None) -> None:
        self.visible = visible
        self.account = account
        self.credential = credential
        self.env = env or {}
        self.rest: list[tuple[str, str]] = []
        self.deliveries: list[dict] = []
        self.sends: list[dict] = []

        monkeypatch.setattr(ops, "caller_rest", self._rest)
        monkeypatch.setattr(ops.db, "default_platform_provider_account", lambda s, **kw: self.account)
        monkeypatch.setattr(ops.db, "read_provider_account_credential", lambda s, **kw: self.credential)
        monkeypatch.setattr(ops.db, "record_invitation_delivery", lambda s, **kw: self.deliveries.append(kw))
        for key, value in self.env.items():
            monkeypatch.setenv(key, value)

    def _rest(self, url, key, token, method, path, **kwargs):
        assert token == "caller-token"
        self.rest.append((method, path))
        if method == "GET" and path == "organization_invitations":
            row = {"id": INVITATION, "email": "person@example.test", "organization_id": ORG}
            return Response(200, [row] if self.visible else [])
        raise AssertionError(f"unexpected call {method} {path}")

    def answers(self, monkeypatch, result: dict) -> None:
        def run(**kwargs):
            self.sends.append(kwargs)
            return result

        monkeypatch.setattr(ops, "send_platform_email", run)


def send(**overrides):
    kwargs = {"token": "caller-token", "organization_id": ORG, "invitation_id": INVITATION, "link": LINK}
    kwargs.update(overrides)
    return send_invitation_email(SETTINGS, **kwargs)


def test_a_caller_who_cannot_see_the_invitation_is_refused_before_any_send(monkeypatch) -> None:
    World(monkeypatch, visible=False)
    with pytest.raises(NotFoundError):
        send()


def test_a_missing_link_is_refused_before_the_invitation_is_even_read(monkeypatch) -> None:
    world = World(monkeypatch)
    with pytest.raises(ValidationError):
        send(link="")
    assert world.rest == []


def test_the_recipient_always_comes_from_the_invitation_row_never_the_caller(monkeypatch) -> None:
    world = World(monkeypatch, credential={"secret": "re_key"}, env={"PLATFORM_EMAIL_FROM_ADDRESS": "hello@gildops.test"})
    world.answers(monkeypatch, {"ok": True, "external_id": "re_1", "detail": None})

    send()

    assert world.sends[0]["to"] == "person@example.test"
    assert "subject" in world.sends[0] and "text" in world.sends[0]
    assert LINK in world.sends[0]["text"]


def test_an_account_with_a_credential_is_tried_before_the_environment(monkeypatch) -> None:
    world = World(
        monkeypatch,
        credential={"secret": "re_account_key"},
        env={"PLATFORM_EMAIL_FROM_ADDRESS": "hello@gildops.test", "RESEND_API_KEY": "re_env_key"},
    )
    world.answers(monkeypatch, {"ok": True, "external_id": "re_1", "detail": None})

    send()

    assert world.sends[0]["api_key"] == "re_account_key"
    # queued, not sent: Resend's own email.sent webhook is what advances this later.
    assert world.deliveries[0]["state"] == "queued"
    assert world.deliveries[0]["provider_message_id"] == "re_1"


def test_no_account_credential_falls_back_to_the_environment(monkeypatch) -> None:
    world = World(
        monkeypatch,
        account=None,
        env={"PLATFORM_EMAIL_FROM_ADDRESS": "hello@gildops.test", "RESEND_API_KEY": "re_env_key"},
    )
    world.answers(monkeypatch, {"ok": True, "external_id": "re_2", "detail": None})

    send()

    assert world.sends[0]["api_key"] == "re_env_key"


def test_neither_account_nor_environment_is_a_recorded_failure_not_an_exception(monkeypatch) -> None:
    world = World(monkeypatch, account=None)

    result = send()

    assert result == {"sent": False, "external_id": None}
    assert world.deliveries[0]["state"] == "failed"
    assert "not configured" in world.deliveries[0]["detail"]
    assert world.sends == []  # never reaches the vendor at all


def test_a_provider_refusal_is_recorded_as_failed_with_its_own_words(monkeypatch) -> None:
    world = World(monkeypatch, credential={"secret": "k"}, env={"PLATFORM_EMAIL_FROM_ADDRESS": "hello@gildops.test"})
    world.answers(monkeypatch, {"ok": False, "external_id": None, "detail": "Resend refused the request (422): invalid `to` field"})

    result = send()

    assert result == {"sent": False, "external_id": None}
    assert world.deliveries[0]["state"] == "failed"
    assert "invalid" in world.deliveries[0]["detail"]
