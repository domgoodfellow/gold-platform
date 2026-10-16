from types import SimpleNamespace

import pytest

from app.services.tenant_email import notifications as subject


def _job(n=1, account="tenant-account"):
    return {"job_id": f"job-{n}", "lease_id": f"lease-{n}", "message_id": f"canonical-message-{n}", "provider_key": "resend", "provider_account_id": account, "from_address": "service@example.test", "to": ["verified@example.test"], "subject": "Server template", "text": "Server content"}


class Clock:
    """A monotonic clock the fakes below move forward, so time spent is a fact of the test."""

    def __init__(self):
        self.now = 1_000.0

    def __call__(self):
        return self.now

    def spend(self, seconds):
        self.now += seconds


def _worker(monkeypatch, jobs, *, clock=None, rpc_cost=0.0, send_cost=0.0, credential_cost=0.0, send_result=None, secrets=None):
    """The worker with its database, credential read and provider replaced; returns what it was asked to do."""
    calls = []
    jobs = iter(jobs)
    secrets = iter(secrets) if secrets else None

    def rpc(settings, *, function, payload, timeout):
        calls.append(("rpc", function, payload, timeout))
        if clock:
            clock.spend(rpc_cost)
        return next(jobs, None) if function == "claim_customer_notification" else True

    def credential(settings, *, account_id, timeout):
        calls.append(("credential", account_id, timeout))
        if clock:
            clock.spend(credential_cost)
        return {"secret": next(secrets) if secrets else "fixture-credential"}

    def send(**kwargs):
        calls.append(("send", kwargs))
        if clock:
            clock.spend(send_cost)
        return send_result or {"ok": True, "external_id": f"provider-{kwargs['idempotency_key']}"}

    monkeypatch.setattr(subject, "_rpc", rpc)
    monkeypatch.setattr(subject.db, "read_provider_account_credential", credential)
    monkeypatch.setattr(subject, "tenant_email_for", lambda key: SimpleNamespace(send_tenant_email=send))
    return calls


def _functions(calls):
    return [call[1] if call[0] == "rpc" else call[0] for call in calls]


@pytest.mark.parametrize("result,expected", [
    ({"ok": True, "external_id": "provider-id"}, "accepted"),
    ({"ok": False, "retryable": True}, "retry"),
    ({"ok": False, "retryable": False}, "rejected"),
])
def test_uses_claimed_content_sender_account_and_message_id(monkeypatch, result, expected):
    job = _job()
    calls = _worker(monkeypatch, [job], send_result=result)
    subject.drain_notifications(None)
    send = next(call[1] for call in calls if call[0] == "send")
    assert send["idempotency_key"] == job["message_id"]
    assert send["to"] == job["to"] and send["text"] == job["text"] and send["api_key"] == "fixture-credential"
    assert next(call[1] for call in calls if call[0] == "credential") == "tenant-account"
    assert next(call[2] for call in calls if call[0] == "rpc" and call[1] == "finish_customer_notification")["p_outcome"] == expected
    assert _functions(calls)[:4] == ["claim_customer_notification", "credential", "authorize_customer_notification_send", "send"]


def test_missing_account_never_uses_platform_environment_key(monkeypatch):
    monkeypatch.setenv("RESEND_API_KEY", "must-not-be-used")
    calls = _worker(monkeypatch, [_job(account=None)])
    assert subject.drain_notifications(None)["retry"] == 1
    assert "send" not in _functions(calls) and "authorize_customer_notification_send" not in _functions(calls)


def test_withdrawal_after_claim_prevents_provider_call(monkeypatch):
    calls = _worker(monkeypatch, [])
    jobs = iter([_job()])

    def rpc(settings, *, function, payload, timeout):
        calls.append(("rpc", function, payload, timeout))
        return next(jobs, None) if function == "claim_customer_notification" else False

    monkeypatch.setattr(subject, "_rpc", rpc)
    assert subject.drain_notifications(None)["held"] == 1
    assert "send" not in _functions(calls)


def test_a_reconciled_late_answer_is_counted_and_never_resent(monkeypatch):
    calls = _worker(monkeypatch, [{"held": True, "reconciled": True}])
    assert subject.drain_notifications(None)["reconciled"] == 1
    assert "send" not in _functions(calls)


def test_retries_read_the_current_credential_of_the_pinned_account(monkeypatch):
    calls = _worker(monkeypatch, [_job(1, "pinned"), _job(2, "pinned")], secrets=["before-rotation", "after-rotation"])
    subject.drain_notifications(None)
    assert [call[1] for call in calls if call[0] == "credential"] == ["pinned", "pinned"]
    assert [call[1]["api_key"] for call in calls if call[0] == "send"] == ["before-rotation", "after-rotation"]


def test_claims_nothing_when_the_invocation_budget_cannot_fit_one_job(monkeypatch):
    clock = Clock()
    calls = _worker(monkeypatch, [_job()], clock=clock)
    counts = subject.drain_notifications(None, budget_seconds=subject.JOB_BUDGET - 1, clock=clock)
    assert calls == [] and counts["deferred"] == 1


def test_a_slow_provider_still_finishes_its_job_and_stops_further_claims(monkeypatch):
    clock = Clock()
    calls = _worker(monkeypatch, [_job(1), _job(2)], clock=clock, send_cost=subject.PROVIDER_TIMEOUT)
    counts = subject.drain_notifications(None, budget_seconds=subject.JOB_BUDGET + 10, clock=clock)
    assert counts["accepted"] == 1 and counts["deferred"] == 1
    assert _functions(calls).count("claim_customer_notification") == 1
    assert _functions(calls)[-1] == "finish_customer_notification"
    assert next(call[1] for call in calls if call[0] == "send")["timeout"] <= subject.PROVIDER_TIMEOUT


def test_slow_database_calls_are_bounded_and_stop_further_claims(monkeypatch):
    clock = Clock()
    calls = _worker(monkeypatch, [_job(1), _job(2)], clock=clock, rpc_cost=subject.DB_TIMEOUT, credential_cost=subject.DB_TIMEOUT)
    counts = subject.drain_notifications(None, budget_seconds=subject.JOB_BUDGET + 10, clock=clock)
    assert counts["accepted"] == 1 and counts["deferred"] == 1
    assert all(call[-1] <= subject.DB_TIMEOUT for call in calls if call[0] in ("rpc", "credential"))


def test_never_authorizes_a_send_it_could_not_finish_in_time(monkeypatch):
    clock = Clock()
    # The credential read overran its own timeout (a stalled connection), leaving too little time.
    calls = _worker(monkeypatch, [_job()], clock=clock, credential_cost=subject.JOB_BUDGET)
    counts = subject.drain_notifications(None, budget_seconds=subject.JOB_BUDGET + 5, clock=clock)
    assert "authorize_customer_notification_send" not in _functions(calls) and "send" not in _functions(calls)
    assert next(call[2] for call in calls if call[0] == "rpc" and call[1] == "finish_customer_notification")["p_outcome"] == "retry"
    assert counts["retry"] == 1


def test_a_failed_completion_stops_the_invocation_and_leaves_the_lease_to_expire(monkeypatch):
    calls = _worker(monkeypatch, [_job(1), _job(2)])

    def rpc(settings, *, function, payload, timeout):
        calls.append(("rpc", function, payload, timeout))
        if function == "finish_customer_notification":
            raise RuntimeError("database unavailable")
        return _job(1) if function == "claim_customer_notification" else True

    monkeypatch.setattr(subject, "_rpc", rpc)
    counts = subject.drain_notifications(None)
    assert counts["unfinished"] == 1
    assert _functions(calls).count("claim_customer_notification") == 1


def test_the_invocation_budget_leaves_room_inside_the_function_limit_and_the_lease():
    assert subject.INVOCATION_BUDGET + subject.JOB_BUDGET <= 300
    # The database refuses to authorize a send with less than 60 seconds of lease left.
    assert subject.PROVIDER_TIMEOUT + subject.FINISH_RESERVE < 60
