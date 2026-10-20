"""The clock, and the two claims that are this runtime's to make.

Everything about *what is due* lives in Postgres and is tested there, against real RLS,
by `apps/web/tests/integration/database/automations.test.ts`. What belongs here is the half that is a fact about this
process: that it identifies itself as a role holding almost nothing, and that it does not put a
single word of its own into a message a business wrote.

These run in `pnpm check` from the root, after the TypeScript half. They did not always;
`apps/api/README.md` records what changed.
"""

from __future__ import annotations

import base64
import json

import api.automation_tick as tick
from app.channels import Message, Sent
from app.channels.registry import sender_for, unconfigured_reason
from app.core.db import machine_token
from app.core.runner import AUTOMATION_ACTOR, ROLE, QueuedMessage

SECRET = "a-test-signing-secret"


def claims(token: str) -> dict:
    payload = token.split(".")[1]
    padded = payload + "=" * (-len(payload) % 4)
    return json.loads(base64.urlsafe_b64decode(padded))


def test_identifies_as_the_runner_role_and_not_as_a_person() -> None:
    # The whole of the authoritative-webhook rule's argument, applied on a second axis: identity reaches Postgres as a JWT
    # naming a role that holds no table grant — never as a service-role key, which would discard
    # RLS for everything rather than narrowing to three functions.
    token = machine_token(SECRET, role=ROLE, sub=AUTOMATION_ACTOR)
    body = claims(token)

    assert body["role"] == "automation_runner"
    assert body["sub"] == AUTOMATION_ACTOR
    assert body["exp"] > body["iat"]


def test_keeps_the_two_machine_identities_apart() -> None:
    # One function mints both, and they must not collapse into each other: the payment webhook
    # may record a payment and nothing else, the runner may turn the clock and nothing else.
    payment = claims(machine_token(SECRET))
    runner = claims(machine_token(SECRET, role=ROLE, sub=AUTOMATION_ACTOR))

    assert payment["role"] != runner["role"]
    assert payment["sub"] != runner["sub"]


def test_has_no_sender_for_a_channel_this_deployment_is_not_configured_for(monkeypatch) -> None:
    for name in (
        "RESEND_API_KEY",
        "MESSAGE_FROM_ADDRESS",
        "TWILIO_ACCOUNT_SID",
        "TWILIO_AUTH_TOKEN",
        "MESSAGE_FROM_NUMBER",
    ):
        monkeypatch.delenv(name, raising=False)

    assert sender_for("email") is None
    assert sender_for("sms") is None
    # And it says so, rather than leaving a business to wonder. The sentence is for an operator
    # on the Automations screen and names whose problem it is (the no-dead-end rule, `docs/ui-system.md`).
    assert "cannot send email" in unconfigured_reason("email")


def test_has_no_sender_for_a_channel_that_does_not_exist() -> None:
    assert sender_for("carrier pigeon") is None


def test_sends_the_body_exactly_as_the_business_wrote_it(monkeypatch) -> None:
    """The one assertion that would catch a friendly footer being added later.

    `docs/product.md` forbids the platform putting words in a business's mouth, and an email is
    the strongest case of that rule — it lands in somebody's inbox with the business's name on
    it. So the finished words are resolved in Postgres when the message is queued, and every
    layer after that is a pipe.
    """
    captured: dict = {}

    class _Recorder:
        def send(self, message: Message) -> Sent:
            captured["recipient"] = message.recipient
            captured["subject"] = message.subject_line
            captured["body"] = message.body
            return Sent(ok=True)

    written = "Hello Ana, your van is booked for Tuesday.\n\nPneu3L"
    _Recorder().send(Message(recipient="ana@example.test", subject_line="Booked", body=written))

    assert captured["body"] == written
    assert captured["subject"] == "Booked"


# --- a business's own sender ---------------------------------------------------------------------
#
# What the database resolved (`app.organization_email_sender`) is what goes out: the business's own
# verified address, through the provider account that holds its domain, under the delivery's own id
# as the idempotency key. Nothing here may fall back to an address or key of this deployment's.

PROVIDERS = object()
DELIVERY = "11111111-1111-4111-8111-111111111111"


def _email(**overrides) -> QueuedMessage:
    values = dict(
        id=DELIVERY, channel="email", recipient="ana@example.test", subject_line="Booked",
        body="Hello Ana, your van is booked.", from_address="hello@pneu3l.test", from_name="Pneu3L",
        provider_key="resend", provider_account_id="acct-of-the-domain",
    )
    values.update(overrides)
    return QueuedMessage(**values)


class _World:
    def __init__(self, monkeypatch, *, result=None, credential="domain-secret", providers=PROVIDERS, read=None) -> None:
        self.sends: list[dict] = []
        self.reads: list[str] = []
        self.finished: list[dict] = []
        self.result = result or {"ok": True, "external_id": "re_1", "retryable": False, "detail": None}
        module = type("Email", (), {"send_tenant_email": staticmethod(lambda **kw: (self.sends.append(kw), self.result)[1])})
        monkeypatch.setattr(tick, "tenant_email_for", lambda key: module if key == "resend" else None)

        def read_credential(settings, *, account_id):
            if read:
                raise read
            self.reads.append(account_id)
            return {"secret": credential} if credential else None

        monkeypatch.setattr(tick.db, "read_provider_account_credential", read_credential)
        monkeypatch.setattr(tick, "load_provider_operations_settings", lambda: providers)
        monkeypatch.setattr(tick, "finish_delivery", lambda settings, **kw: self.finished.append(kw))
        # The deployment's own sender and key exist, and must never be used for a business's mail.
        monkeypatch.setenv("RESEND_API_KEY", "deployment-key")
        monkeypatch.setenv("MESSAGE_FROM_ADDRESS", "noreply@gildops.test")

    def drain(self, monkeypatch, *messages: QueuedMessage) -> tuple[int, int, int]:
        monkeypatch.setattr(tick, "claim_deliveries", lambda settings: list(messages))
        return tick.handler._drain(object.__new__(tick.handler), object())


def test_there_is_no_installation_wide_email_sender_even_when_one_is_configured(monkeypatch) -> None:
    monkeypatch.setenv("RESEND_API_KEY", "deployment-key")
    monkeypatch.setenv("MESSAGE_FROM_ADDRESS", "noreply@gildops.test")
    assert sender_for("email") is None


def test_an_automation_email_goes_from_the_businesss_own_sender_through_its_domains_account(monkeypatch) -> None:
    world = _World(monkeypatch)
    assert world.drain(monkeypatch, _email()) == (1, 0, 0)

    sent = world.sends[0]
    assert sent["sender"] == "Pneu3L <hello@pneu3l.test>"
    assert sent["api_key"] == "domain-secret" and world.reads == ["acct-of-the-domain"]
    assert sent["idempotency_key"] == DELIVERY
    assert sent["to"] == ["ana@example.test"] and sent["text"] == "Hello Ana, your van is booked."
    assert world.finished == [dict(message_id=DELIVERY, outcome="accepted", external_id="re_1", detail=None)]


def test_a_domain_account_without_a_credential_fails_and_the_deployment_key_is_not_used(monkeypatch) -> None:
    world = _World(monkeypatch, credential=None)
    assert world.drain(monkeypatch, _email()) == (0, 1, 0)
    assert world.sends == []
    assert world.finished == [dict(message_id=DELIVERY, outcome="failed", external_id=None, detail=tick.EMAIL_ACCOUNT_UNAVAILABLE)]


def test_an_email_with_no_resolved_sender_or_provider_is_not_sent(monkeypatch) -> None:
    for message in (_email(from_address=None), _email(provider_key=None), _email(provider_account_id=None), _email(provider_key="unknown")):
        world = _World(monkeypatch)
        world.drain(monkeypatch, message)
        assert world.sends == []
        assert world.finished[0]["outcome"] == "failed" and world.finished[0]["detail"] == tick.EMAIL_NOT_SET_UP


def test_a_deployment_without_provider_settings_sends_no_business_email(monkeypatch) -> None:
    world = _World(monkeypatch, providers=None)
    world.drain(monkeypatch, _email())
    assert world.sends == [] and world.finished[0]["outcome"] == "failed"


def test_a_provider_refusal_is_recorded_with_its_reason(monkeypatch) -> None:
    world = _World(monkeypatch, result={"ok": False, "external_id": None, "retryable": False, "detail": "Domain not verified"})
    assert world.drain(monkeypatch, _email()) == (0, 1, 0)
    assert world.finished == [dict(message_id=DELIVERY, outcome="rejected", external_id=None, detail="Domain not verified")]


def test_a_transient_fault_returns_it_to_the_queue_for_the_same_send_again(monkeypatch) -> None:
    world = _World(monkeypatch, result={"ok": False, "external_id": None, "retryable": True, "detail": "rate limited"})
    assert world.drain(monkeypatch, _email()) == (0, 0, 1)
    assert world.finished == [dict(message_id=DELIVERY, outcome="retry", external_id=None, detail=None)]


def test_not_reading_the_credential_is_a_retry_not_a_refusal(monkeypatch) -> None:
    world = _World(monkeypatch, read=RuntimeError("database unreachable"))
    assert world.drain(monkeypatch, _email()) == (0, 0, 1)
    assert world.sends == [] and world.finished[0]["outcome"] == "retry"


def test_a_text_message_keeps_its_own_channel_and_is_finished_either_way(monkeypatch) -> None:
    world = _World(monkeypatch)
    for name in ("TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN", "MESSAGE_FROM_NUMBER"):
        monkeypatch.delenv(name, raising=False)
    text = _email(channel="sms", recipient="+14165550100", from_address=None, provider_key=None, provider_account_id=None)
    assert world.drain(monkeypatch, text) == (0, 1, 0)
    assert world.sends == []
    assert world.finished == [dict(message_id=DELIVERY, outcome="failed", external_id=None, detail=unconfigured_reason("sms"))]


def test_a_provider_that_may_already_have_sent_it_is_recorded_as_uncertain_not_retried(monkeypatch) -> None:
    world = _World(monkeypatch, result={"ok": False, "external_id": None, "retryable": False, "uncertain": True, "detail": "key reused"})
    assert world.drain(monkeypatch, _email()) == (0, 1, 0)
    assert world.finished == [dict(message_id=DELIVERY, outcome="uncertain", external_id=None, detail="key reused")]
