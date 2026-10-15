from types import SimpleNamespace

import pytest

from app.services.tenant_email import notifications as subject


@pytest.mark.parametrize("result,expected", [
    ({"ok": True, "external_id": "provider-id"}, "accepted"),
    ({"ok": False, "retryable": True}, "retry"),
    ({"ok": False, "retryable": False}, "rejected"),
])
def test_uses_claimed_content_sender_account_and_message_id(monkeypatch, result, expected):
    calls = []
    job = {"job_id": "job", "lease_id": "lease", "message_id": "canonical-message", "provider_key": "resend", "provider_account_id": "tenant-account", "from_address": "service@example.test", "to": ["verified@example.test"], "subject": "Server template", "text": "Server content"}
    jobs = iter([job, None])

    def rpc(settings, *, function, payload):
        name = function
        calls.append((name, payload))
        return next(jobs) if name == "claim_customer_notification" else True

    def send(**kwargs):
        assert kwargs["idempotency_key"] == job["message_id"]
        assert kwargs["to"] == job["to"]
        assert kwargs["text"] == job["text"]
        assert kwargs["api_key"] == "fixture-credential"
        return result

    def credential(settings, *, account_id):
        assert account_id == "tenant-account"
        return {"secret": "fixture-credential"}

    monkeypatch.setattr(subject, "_rpc", rpc)
    monkeypatch.setattr(subject.db, "read_provider_account_credential", credential)
    monkeypatch.setattr(subject, "tenant_email_for", lambda key: SimpleNamespace(send_tenant_email=send))
    subject.drain_notifications(None)
    assert next(payload for name, payload in calls if name == "finish_customer_notification")["p_outcome"] == expected
    assert calls[1][0] == "authorize_customer_notification_send"


def test_missing_account_never_uses_platform_environment_key(monkeypatch):
    jobs = iter([{"job_id": "job", "lease_id": "lease", "provider_key": "resend", "provider_account_id": None}, None])
    results = []
    monkeypatch.setenv("RESEND_API_KEY", "must-not-be-used")
    monkeypatch.setattr(subject, "tenant_email_for", lambda key: object())
    monkeypatch.setattr(subject, "_rpc", lambda settings, function, payload: next(jobs) if function == "claim_customer_notification" else results.append(payload) or True)
    assert subject.drain_notifications(None)["retry"] == 1
    assert results[0]["p_outcome"] == "retry"


def test_withdrawal_after_claim_prevents_provider_call(monkeypatch):
    jobs = iter([{"job_id": "job", "lease_id": "lease", "provider_key": "resend", "provider_account_id": "account"}, None])
    monkeypatch.setattr(subject, "tenant_email_for", lambda key: object())
    monkeypatch.setattr(subject.db, "read_provider_account_credential", lambda *args, **kwargs: {"secret": "fixture"})
    monkeypatch.setattr(subject, "_rpc", lambda settings, function, payload: next(jobs) if function == "claim_customer_notification" else False)
    assert subject.drain_notifications(None)["held"] == 1
