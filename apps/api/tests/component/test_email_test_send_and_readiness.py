"""Test send and GildOps' own email readiness (Phase 3C).

A test email goes only from the business's own resolved sender, through the account recorded as
holding its domain, to the caller's own confirmed address — every one of those decided by the
database, never by the request. Readiness is judged from this runtime's own settings and a
read-only provider call, and never returns a key or an address beyond its domain.
"""

from __future__ import annotations

import json
from types import SimpleNamespace

import pytest

from app.services.platform_email import readiness as ready
from app.services.tenant_email import test_send as ts

SETTINGS = SimpleNamespace(supabase_url="https://db.test", supabase_publishable_key="anon", supabase_jwt_secret="signing")
ORG = "11111111-1111-4111-8111-111111111111"
TEST = "22222222-2222-4222-8222-222222222222"


class Response:
    def __init__(self, status: int, body) -> None:
        self.status_code = status
        self._body = body

    def json(self):
        return self._body


class World:
    def __init__(self, monkeypatch, *, begin=None, account=None, credential="domain-secret", result=None) -> None:
        self.posts: list[dict] = []
        self.finished: list[dict] = []
        self.sends: list[dict] = []
        self.reads: list[str] = []
        self.begin = begin or Response(200, [{"id": TEST, "recipient": "manager@example.test", "from_address": "hello@acme.test", "from_name": "Acme", "reply_to": "replies@acme.test", "business_name": "Acme"}])
        account = account or {"state": "ready", "detail": None, "provider_key": "resend", "provider_account_id": "acct-of-the-domain"}
        self.result = result or {"ok": True, "external_id": "re_1", "retryable": False, "detail": None}
        monkeypatch.setattr(ts.httpx, "post", lambda url, **kw: (self.posts.append({"url": url, **kw}), self.begin)[1])
        monkeypatch.setattr(ts.db, "email_test_send_account", lambda s, **kw: account)
        monkeypatch.setattr(ts.db, "read_provider_account_credential", lambda s, **kw: (self.reads.append(kw["account_id"]), {"secret": credential} if credential else None)[1])
        monkeypatch.setattr(ts.db, "finish_email_test_send", lambda s, **kw: self.finished.append(kw))
        module = SimpleNamespace(send_tenant_email=lambda **kw: (self.sends.append(kw), self.result)[1])
        monkeypatch.setattr(ts, "tenant_email_for", lambda key: module if key == "resend" else None)
        monkeypatch.setenv("RESEND_API_KEY", "deployment-key")


def run():
    return ts.send_test_email(SETTINGS, token="caller-token", organization_id=ORG)


class TestTestSend:
    def test_sends_from_the_resolved_sender_to_the_callers_own_address_under_the_callers_session(self, monkeypatch) -> None:
        world = World(monkeypatch)
        assert run() == {"state": "sent", "recipient": "manager@example.test", "detail": None}
        begin = world.posts[0]
        assert begin["url"].endswith("/rpc/begin_email_test_send")
        assert begin["headers"]["Authorization"] == "Bearer caller-token"
        assert begin["json"] == {"p_organization_id": ORG}
        sent = world.sends[0]
        assert sent["to"] == ["manager@example.test"] and sent["sender"] == "Acme <hello@acme.test>"
        assert sent["reply_to"] == "replies@acme.test" and sent["idempotency_key"] == TEST
        assert sent["api_key"] == "domain-secret" and world.reads == ["acct-of-the-domain"]
        assert sent["tags"] == [{"name": "gildops_test_send", "value": TEST}]
        assert world.finished == [dict(organization_id=ORG, test_id=TEST, outcome="accepted", external_id="re_1")]

    def test_the_request_carries_nothing_but_the_business(self) -> None:
        import inspect

        assert set(inspect.signature(ts.send_test_email).parameters) == {"settings", "token", "organization_id"}

    @pytest.mark.parametrize(("code", "error"), [("42501", ts.TestSendForbidden), ("53400", ts.TestSendLimited), ("55000", ts.TestSendRefused)])
    def test_a_refusal_from_the_database_is_its_own_error_and_nothing_is_sent(self, monkeypatch, code, error) -> None:
        world = World(monkeypatch, begin=Response(400, {"code": code, "message": "This business has no default sender address."}))
        with pytest.raises(error):
            run()
        assert world.sends == [] and world.finished == []

    def test_no_recorded_account_means_no_send_and_the_deployment_key_is_never_used(self, monkeypatch) -> None:
        world = World(monkeypatch, account={"state": "refused", "detail": "GildOps has not yet confirmed which email account holds the domain.", "provider_key": None, "provider_account_id": None})
        assert run()["state"] == "failed"
        assert world.sends == [] and world.finished[0]["outcome"] == "failed"

    def test_an_answer_that_may_mean_it_was_sent_is_uncertain_and_not_retried(self, monkeypatch) -> None:
        world = World(monkeypatch, result={"ok": False, "external_id": None, "retryable": True, "detail": "timed out"})
        assert run()["state"] == "uncertain"
        assert len(world.sends) == 1 and world.finished[0]["outcome"] == "uncertain"

    def test_a_provider_refusal_is_recorded_with_its_reason(self, monkeypatch) -> None:
        world = World(monkeypatch, result={"ok": False, "external_id": None, "retryable": False, "detail": "domain not verified"})
        assert run() == {"state": "failed", "recipient": "manager@example.test", "detail": "domain not verified"}
        assert world.finished[0] == dict(organization_id=ORG, test_id=TEST, outcome="rejected", detail="domain not verified")


class Readiness:
    def __init__(self, monkeypatch, *, facts=None, credential="platform-secret", env=None, domains=None) -> None:
        self.facts = facts if facts is not None else {"account_id": "acct", "account_status": "active", "credential_set": True, "last_delivered_at": None, "last_accepted_at": None, "last_failed_at": None, "last_failure": None}
        for name in ("PLATFORM_EMAIL_FROM_ADDRESS", "RESEND_API_KEY", "RESEND_WEBHOOK_SECRET", "TENANT_EMAIL_WEBHOOK_SECRET"):
            monkeypatch.delenv(name, raising=False)
        for name, value in (env if env is not None else {"PLATFORM_EMAIL_FROM_ADDRESS": "invites@mail.gildops.test", "RESEND_WEBHOOK_SECRET": "whsec_x"}).items():
            monkeypatch.setenv(name, value)
        self.domain_calls: list[str] = []
        monkeypatch.setattr(ready.httpx, "post", lambda url, **kw: Response(200, [self.facts]))
        monkeypatch.setattr(ready.db, "read_provider_account_credential", lambda s, **kw: {"secret": credential} if credential else None)
        listed = domains if domains is not None else {"ok": True, "domains": [{"name": "mail.gildops.test", "status": "verified"}]}
        monkeypatch.setattr(ready, "sending_domains", lambda secret: (self.domain_calls.append(secret), listed)[1])

    def answer(self):
        return ready.platform_email_readiness(SETTINGS, token="staff-token")


class TestReadiness:
    def test_ready_for_a_test_when_everything_checks_out_and_nothing_secret_is_returned(self, monkeypatch) -> None:
        world = Readiness(monkeypatch)
        answer = world.answer()
        assert answer["state"] == "ready_for_test" and answer["from_domain"] == "mail.gildops.test"
        assert answer["credential_source"] == "platform_account" and world.domain_calls == ["platform-secret"]
        text = json.dumps(answer)
        assert "platform-secret" not in text and "invites@" not in text and "whsec_x" not in text

    def test_live_verified_needs_a_recent_provider_confirmed_delivery(self, monkeypatch) -> None:
        from datetime import datetime, timezone

        facts = {"account_id": "acct", "account_status": "active", "credential_set": True, "last_delivered_at": datetime.now(timezone.utc).isoformat(), "last_accepted_at": None, "last_failed_at": None, "last_failure": None}
        assert Readiness(monkeypatch, facts=facts).answer()["state"] == "live_verified"

    def test_not_configured_names_the_missing_settings_without_calling_the_provider(self, monkeypatch) -> None:
        world = Readiness(monkeypatch, facts={}, credential=None, env={})
        answer = world.answer()
        assert answer["state"] == "not_configured" and world.domain_calls == []
        assert {c["key"]: c["state"] for c in answer["checks"]}["from_address"] == "missing"

    def test_falls_back_to_the_bootstrap_key_and_says_so(self, monkeypatch) -> None:
        world = Readiness(monkeypatch, facts={}, credential=None, env={"PLATFORM_EMAIL_FROM_ADDRESS": "invites@mail.gildops.test", "RESEND_API_KEY": "boot-key"})
        answer = world.answer()
        assert answer["credential_source"] == "environment" and world.domain_calls == ["boot-key"] and "boot-key" not in json.dumps(answer)

    @pytest.mark.parametrize(("listed", "state"), [
        ({"ok": False, "kind": "rejected", "error": "Resend refused this account's key (401)."}, "misconfigured"),
        ({"ok": False, "kind": "unavailable", "error": "Resend answered 503."}, "provider_unavailable"),
        ({"ok": True, "domains": [{"name": "other.test", "status": "verified"}]}, "misconfigured"),
        ({"ok": True, "domains": [{"name": "mail.gildops.test", "status": "pending"}]}, "configured_unverified"),
        ({"ok": True, "domains": [{"name": "mail.gildops.test", "status": "failed"}]}, "misconfigured"),
    ])
    def test_each_provider_answer_is_its_own_state(self, monkeypatch, listed, state) -> None:
        assert Readiness(monkeypatch, domains=listed).answer()["state"] == state

    def test_only_staff_may_ask(self, monkeypatch) -> None:
        world = Readiness(monkeypatch)
        monkeypatch.setattr(ready.httpx, "post", lambda url, **kw: Response(400, {"code": "42501"}))
        with pytest.raises(ready.ReadinessForbidden):
            world.answer()
