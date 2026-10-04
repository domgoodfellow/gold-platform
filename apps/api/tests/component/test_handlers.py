"""The HTTP entrypoints in `apps/api/api/`, driven as Vercel drives them.

Every other Python test proves a *function* refuses what it should -- `verify_signature`,
`require_caller`, `settlement`. None of them proves the handler actually **calls** it before doing
anything, and that wiring is the whole of the guarantee: a handler that verified a signature and
then wrote regardless would pass every one of them. This file closes that gap and no other.

What is real: the handler class, its signature/secret/bearer checks, and its routing of the
refusal. What is patched: the deployment's settings and the sink that would write -- the database
or a domain command. Each test asserts the refusal **and that the sink was never reached**, which
is the property CLAUDE.md's "an unsigned callback accepted" row holds.

No socket is opened: a handler is instantiated without its request loop and fed a byte buffer.
"""

from __future__ import annotations

import base64
import email.message
import hashlib
import hmac
import io
import json
from types import SimpleNamespace
from urllib.parse import urlencode

import pytest

import api.ai_ask as ai_ask
import api.automation_tick as automation_tick
import api.crm_change_customer_stage as crm_change_customer_stage
import api.integration_operations as integration_operations
import api.invitation_email as invitation_email
import api.invitation_email_webhook as invitation_email_webhook
import api.organization_domains as organization_domains
import api.organization_email_domains as organization_email_domains
import api.provider_operations as provider_operations
import api.public_chat as public_chat
import api.routing_preview_inbound as routing_preview_inbound
import api.routing_preview_outbound as routing_preview_outbound
import api.sms_inbound as sms_inbound
import api.sms_status as sms_status
import api.stripe_platform_billing_webhook as platform_billing_webhook
import api.stripe_webhook as stripe_webhook
import api.tenant_email_send as tenant_email_send
import api.tenant_email_webhook as tenant_email_webhook
import api.voice_inbound as voice_inbound
import api.voice_outbound as voice_outbound
import api.voice_recording as voice_recording
import api.voice_status as voice_status
import api.voice_wrap_up_call as voice_wrap_up_call

HOST = "gold.example"
TOKEN = "an-account-auth-token"
SETTINGS = SimpleNamespace(
    supabase_url="https://project.supabase.test",
    supabase_publishable_key="anon",
    supabase_jwt_secret="signing",
    twilio_auth_token=TOKEN,
    stripe_signing_secret="whsec_test",
    signing_secret="whsec_platform",
    cron_secret="the-cron-secret",
)


def call(module, method: str, *, path: str = "/x", headers: dict[str, str] | None = None, body: bytes = b""):
    """Run one request through a handler and return (status, body)."""
    cls = module.handler
    instance = cls.__new__(cls)  # skip the base class's request loop: no socket, no parsing
    instance.headers = email.message.Message()
    for key, value in {"content-length": str(len(body)), **(headers or {})}.items():
        instance.headers[key] = value
    instance.rfile = io.BytesIO(body)
    instance.wfile = io.BytesIO()
    instance.path = path
    instance.command = method
    instance.request_version = "HTTP/1.1"
    instance.requestline = f"{method} {path} HTTP/1.1"
    instance.client_address = ("127.0.0.1", 0)
    instance.log_message = lambda *args, **kwargs: None
    getattr(instance, f"do_{method}")()
    raw = instance.wfile.getvalue()
    return int(raw.split(b" ", 2)[1]), raw.split(b"\r\n\r\n", 1)[1].decode()


class Sink:
    """Stands in for whatever would write, and remembers whether anything reached it."""

    def __init__(self, result=True) -> None:
        self.calls: list[tuple] = []
        self.result = result

    def __call__(self, *args, **kwargs):
        self.calls.append((args, kwargs))
        return self.result


def twilio_signature(url: str, params: dict[str, str], token: str = TOKEN) -> str:
    payload = url + "".join(f"{key}{params[key]}" for key in sorted(params))
    return base64.b64encode(hmac.new(token.encode(), payload.encode(), hashlib.sha1).digest()).decode()


def form(params: dict[str, str]) -> bytes:
    return urlencode(params).encode()


# --- the carrier's callbacks: signed, or refused before anything is written ---------------------

CALLBACKS = [
    # module, path, sink attribute (None: the endpoint writes nothing), body the carrier would send
    (voice_status, "/voice/status", "record_call_event", {"CallSid": "CA1", "CallStatus": "completed", "CallDuration": "42"}),
    (
        voice_recording,
        "/voice/recording",
        "record_call_event",
        {"CallSid": "CA1", "RecordingSid": "RE1", "RecordingUrl": "https://api.twilio.com/2010-04-01/Recordings/RE1", "RecordingStatus": "completed"},
    ),
    (voice_inbound, "/voice/inbound", None, {"CallSid": "CA1", "To": "+31000000000"}),
    (voice_outbound, "/voice/outbound", None, {"CallSid": "CA1", "Conference": "room-1"}),
    (sms_inbound, "/sms/inbound", "record_inbound_message", {"MessageSid": "SM1", "To": "+31000000000", "From": "+31000000001", "Body": "Thanks"}),
    (sms_status, "/sms/status", "record_message_status", {"MessageSid": "SM1", "MessageStatus": "delivered"}),
]
IDS = [module.__name__.split(".")[-1] for module, *_ in CALLBACKS]


@pytest.fixture
def configured(monkeypatch):
    for module in (voice_status, voice_recording, voice_inbound, voice_outbound, sms_inbound, sms_status):
        monkeypatch.setattr(module, "load_voice_settings", lambda: SETTINGS)


@pytest.mark.parametrize(("module", "path", "sink_name", "params"), CALLBACKS, ids=IDS)
class TestCarrierCallbacks:
    def _sink(self, monkeypatch, module, sink_name):
        sink = Sink(result="recorded")
        if sink_name:
            monkeypatch.setattr(module, sink_name, sink)
        return sink

    def test_a_deployment_with_no_carrier_answers_404_and_writes_nothing(self, monkeypatch, module, path, sink_name, params):
        monkeypatch.setattr(module, "load_voice_settings", lambda: None)
        sink = self._sink(monkeypatch, module, sink_name)

        status, _ = call(module, "POST", path=path, headers={"host": HOST}, body=form(params))

        assert status == 404
        assert sink.calls == []

    def test_an_unsigned_callback_is_refused_and_writes_nothing(self, configured, monkeypatch, module, path, sink_name, params):
        sink = self._sink(monkeypatch, module, sink_name)

        status, body = call(module, "POST", path=path, headers={"host": HOST}, body=form(params))

        assert (status, body) == (403, "rejected")
        assert sink.calls == []

    def test_a_callback_signed_for_another_address_is_refused(self, configured, monkeypatch, module, path, sink_name, params):
        sink = self._sink(monkeypatch, module, sink_name)
        signature = twilio_signature(f"https://{HOST}/somewhere/else", params)

        status, _ = call(module, "POST", path=path, headers={"host": HOST, "x-twilio-signature": signature}, body=form(params))

        assert status == 403
        assert sink.calls == []

    def test_a_callback_edited_after_signing_is_refused(self, configured, monkeypatch, module, path, sink_name, params):
        sink = self._sink(monkeypatch, module, sink_name)
        signature = twilio_signature(f"https://{HOST}{path}", params)
        edited = {**params, "CallSid": "CA-someone-elses"}

        status, _ = call(module, "POST", path=path, headers={"host": HOST, "x-twilio-signature": signature}, body=form(edited))

        assert status == 403
        assert sink.calls == []

    def test_a_callback_signed_with_another_token_is_refused(self, configured, monkeypatch, module, path, sink_name, params):
        sink = self._sink(monkeypatch, module, sink_name)
        signature = twilio_signature(f"https://{HOST}{path}", params, token="not-our-token")

        status, _ = call(module, "POST", path=path, headers={"host": HOST, "x-twilio-signature": signature}, body=form(params))

        assert status == 403
        assert sink.calls == []


class TestCarrierCallbacksThatAreSigned:
    """The other half of the wiring: a genuine callback does reach the sink, once."""

    def _signed(self, module, path, params):
        signature = twilio_signature(f"https://{HOST}{path}", params)
        return call(module, "POST", path=path, headers={"host": HOST, "x-twilio-signature": signature}, body=form(params))

    def test_a_signed_status_report_is_recorded(self, configured, monkeypatch) -> None:
        sink = Sink(result="a-call-row")
        monkeypatch.setattr(voice_status, "record_call_event", sink)

        status, body = self._signed(voice_status, "/voice/status", CALLBACKS[0][3])

        assert (status, body) == (200, "recorded")
        assert len(sink.calls) == 1
        assert sink.calls[0][1]["external_id"] == "CA1"

    def test_a_replayed_or_unknown_report_is_the_same_harmless_answer(self, configured, monkeypatch) -> None:
        monkeypatch.setattr(voice_status, "record_call_event", Sink(result=None))

        assert self._signed(voice_status, "/voice/status", CALLBACKS[0][3]) == (200, "ignored")

    def test_a_signed_inbound_call_is_declined_rather_than_improvised(self, configured) -> None:
        status, body = self._signed(voice_inbound, "/voice/inbound", CALLBACKS[2][3])

        assert status == 200
        assert "<Reject" in body

    def test_a_signed_outbound_leg_joins_only_the_room_it_was_given(self, configured) -> None:
        status, body = self._signed(voice_outbound, "/voice/outbound", CALLBACKS[3][3])
        assert status == 200 and "room-1" in body

        status, _ = self._signed(voice_outbound, "/voice/outbound", {"CallSid": "CA1"})
        assert status == 400

    def test_a_signed_inbound_text_is_recorded(self, configured, monkeypatch) -> None:
        recorded = Sink(result="a-message-row")
        monkeypatch.setattr(sms_inbound, "record_inbound_message", recorded)

        status, body = self._signed(sms_inbound, "/sms/inbound", CALLBACKS[4][3])

        assert (status, body) == (200, "recorded")
        assert len(recorded.calls) == 1

    def test_a_stop_keyword_suppresses_before_the_message_is_recorded(self, configured, monkeypatch) -> None:
        suppressed = Sink()
        recorded = Sink(result="a-message-row")
        monkeypatch.setattr(sms_inbound, "record_message_suppression", suppressed)
        monkeypatch.setattr(sms_inbound, "record_inbound_message", recorded)

        params = {"MessageSid": "SM2", "To": "+31000000000", "From": "+31000000001", "Body": "STOP"}
        status, body = self._signed(sms_inbound, "/sms/inbound", params)

        assert (status, body) == (200, "recorded")
        assert len(suppressed.calls) == 1
        assert suppressed.calls[0][1]["opted_out"] is True

    def test_an_ordinary_message_never_touches_suppression(self, configured, monkeypatch) -> None:
        suppressed = Sink()
        monkeypatch.setattr(sms_inbound, "record_message_suppression", suppressed)
        monkeypatch.setattr(sms_inbound, "record_inbound_message", Sink(result="a-message-row"))

        self._signed(sms_inbound, "/sms/inbound", CALLBACKS[4][3])

        assert suppressed.calls == []

    def test_a_signed_delivery_status_is_recorded(self, configured, monkeypatch) -> None:
        recorded = Sink(result="a-message-id")
        monkeypatch.setattr(sms_status, "record_message_status", recorded)

        status, body = self._signed(sms_status, "/sms/status", CALLBACKS[5][3])

        assert (status, body) == (200, "recorded")
        assert recorded.calls[0][1]["status"] == "delivered"

    def test_a_failed_delivery_carries_a_reason(self, configured, monkeypatch) -> None:
        recorded = Sink(result="a-message-id")
        monkeypatch.setattr(sms_status, "record_message_status", recorded)

        params = {"MessageSid": "SM1", "MessageStatus": "failed", "ErrorCode": "30007"}
        self._signed(sms_status, "/sms/status", params)

        assert recorded.calls[0][1]["failure_reason"]


# --- the payment processors' webhooks: verified over the raw body, or refused --------------------


class TestProcessorWebhooks:
    @pytest.mark.parametrize(
        ("module", "loader", "sinks"),
        [
            (stripe_webhook, "load_settings", ["record_provider_payment"]),
            (platform_billing_webhook, "load_platform_billing_settings", ["apply_platform_subscription_event", "record_platform_billing_notice"]),
        ],
        ids=["tenant_payments", "platform_billing"],
    )
    def test_refuses_without_a_valid_signature_and_writes_nothing(self, monkeypatch, module, loader, sinks) -> None:
        monkeypatch.setattr(module, loader, lambda: SETTINGS)
        recorded = [Sink() for _ in sinks]
        for name, sink in zip(sinks, recorded):
            monkeypatch.setattr(module, name, sink)
        body = json.dumps({"type": "checkout.session.completed", "data": {"object": {}}}).encode()

        for headers in ({}, {"stripe-signature": "t=1,v1=deadbeef"}):
            status, text = call(module, "POST", headers=headers, body=body)
            assert (status, text) == (400, "rejected")

        assert all(sink.calls == [] for sink in recorded)

    @pytest.mark.parametrize(
        ("module", "loader"),
        [(stripe_webhook, "load_settings"), (platform_billing_webhook, "load_platform_billing_settings")],
        ids=["tenant_payments", "platform_billing"],
    )
    def test_a_deployment_with_no_processor_answers_404(self, monkeypatch, module, loader) -> None:
        monkeypatch.setattr(module, loader, lambda: None)

        assert call(module, "POST", body=b"{}")[0] == 404


class TestInvitationEmailWebhook:
    """`verify_signature`'s own correctness (every header, every failure mode, the timestamp
    tolerance) is `test_resend_webhook.py`'s subject; this proves only that the handler calls it
    before anything is recorded."""

    def test_refuses_without_a_valid_signature_and_writes_nothing(self, monkeypatch) -> None:
        monkeypatch.setattr(invitation_email_webhook, "load_invitation_email_webhook_settings", lambda: SETTINGS)
        recorded = Sink()
        monkeypatch.setattr(invitation_email_webhook, "record_invitation_delivery_event", recorded)
        body = json.dumps({"type": "email.delivered", "data": {"email_id": "m1"}}).encode()

        for headers in ({}, {"svix-id": "x", "svix-timestamp": "1", "svix-signature": "v1,deadbeef"}):
            status, text = call(invitation_email_webhook, "POST", headers=headers, body=body)
            assert (status, text) == (400, "rejected")

        assert recorded.calls == []

    def test_a_deployment_with_no_webhook_configured_answers_404(self, monkeypatch) -> None:
        monkeypatch.setattr(invitation_email_webhook, "load_invitation_email_webhook_settings", lambda: None)

        assert call(invitation_email_webhook, "POST", body=b"{}")[0] == 404


class TestTenantEmailWebhook:
    """The signature's own correctness is `test_resend_webhook.py`'s subject; this proves the handler
    verifies before it writes, derives nothing from the payload, and asks the provider to retry when a
    verified message could not be read."""

    SECRET = "whsec_" + base64.b64encode(b"b" * 24).decode()

    def _signed(self, body: bytes, svix_id: str = "msg_1") -> dict[str, str]:
        import time

        issued = int(time.time())
        key = base64.b64decode(self.SECRET.removeprefix("whsec_"))
        signature = base64.b64encode(hmac.new(key, f"{svix_id}.{issued}.{body.decode()}".encode(), hashlib.sha256).digest()).decode()
        return {"svix-id": svix_id, "svix-timestamp": str(issued), "svix-signature": f"v1,{signature}"}

    def _armed(self, monkeypatch):
        monkeypatch.setattr(tenant_email_webhook, "load_tenant_email_webhook_settings", lambda: SimpleNamespace(**{**SETTINGS.__dict__, "signing_secret": self.SECRET}))

    def test_refuses_without_a_valid_signature_and_writes_nothing(self, monkeypatch) -> None:
        self._armed(monkeypatch)
        recorded, received = Sink(), Sink()
        monkeypatch.setattr(tenant_email_webhook, "record_email_event", recorded)
        monkeypatch.setattr(tenant_email_webhook, "handle_received", received)
        body = json.dumps({"type": "email.delivered", "data": {"email_id": "m1"}}).encode()

        for headers in ({}, {"svix-id": "x", "svix-timestamp": "1", "svix-signature": "v1,deadbeef"}):
            assert call(tenant_email_webhook, "POST", headers=headers, body=body) == (400, "rejected")

        assert recorded.calls == [] and received.calls == []

    def test_a_deployment_with_no_webhook_configured_answers_404(self, monkeypatch) -> None:
        monkeypatch.setattr(tenant_email_webhook, "load_tenant_email_webhook_settings", lambda: None)
        assert call(tenant_email_webhook, "POST", body=b"{}")[0] == 404

    def test_a_signed_delivery_event_is_recorded_with_the_providers_own_delivery_id(self, monkeypatch) -> None:
        self._armed(monkeypatch)
        recorded = Sink(result="event-1")
        monkeypatch.setattr(tenant_email_webhook, "record_email_event", recorded)
        body = json.dumps({"type": "email.delivered", "data": {"email_id": "re_1"}}).encode()

        assert call(tenant_email_webhook, "POST", headers=self._signed(body, "msg_77"), body=body) == (200, "recorded")
        kwargs = recorded.calls[0][1]
        assert kwargs["provider_message_id"] == "re_1" and kwargs["event_type"] == "delivered" and kwargs["provider_event_id"] == "msg_77"

    def test_a_duplicate_or_unknown_event_is_acknowledged_not_failed(self, monkeypatch) -> None:
        self._armed(monkeypatch)
        monkeypatch.setattr(tenant_email_webhook, "record_email_event", Sink(result=None))
        body = json.dumps({"type": "email.delivered", "data": {"email_id": "re_1"}}).encode()
        assert call(tenant_email_webhook, "POST", headers=self._signed(body), body=body) == (200, "ignored")

    def test_an_event_this_platform_does_not_track_is_acknowledged(self, monkeypatch) -> None:
        self._armed(monkeypatch)
        recorded = Sink()
        monkeypatch.setattr(tenant_email_webhook, "record_email_event", recorded)
        body = json.dumps({"type": "domain.updated", "data": {}}).encode()
        assert call(tenant_email_webhook, "POST", headers=self._signed(body), body=body) == (200, "ignored")
        assert recorded.calls == []

    def test_a_received_message_is_handed_on_and_a_failure_to_read_it_asks_the_provider_to_retry(self, monkeypatch) -> None:
        self._armed(monkeypatch)
        body = json.dumps({"type": "email.received", "data": {"email_id": "in_1", "from": "kim@example.test", "to": ["hello@acme.test"], "subject": "Hi"}}).encode()

        handled = Sink(result="recorded")
        monkeypatch.setattr(tenant_email_webhook, "handle_received", handled)
        assert call(tenant_email_webhook, "POST", headers=self._signed(body, "msg_9"), body=body) == (200, "recorded")
        assert handled.calls[0][1]["event_id"] == "msg_9" and handled.calls[0][1]["event"]["to"] == ["hello@acme.test"]

        def unreadable(*args, **kwargs):
            raise RuntimeError("provider unreachable")

        monkeypatch.setattr(tenant_email_webhook, "handle_received", unreadable)
        assert call(tenant_email_webhook, "POST", headers=self._signed(body, "msg_10"), body=body) == (500, "retry")


class TestTenantEmailSend:
    def test_refuses_an_anonymous_caller_before_reading_anything(self, monkeypatch) -> None:
        monkeypatch.setattr(tenant_email_send, "load_provider_operations_settings", lambda: SETTINGS)
        sent = Sink()
        monkeypatch.setattr(tenant_email_send, "send_queued_email", sent)

        status, _ = call(tenant_email_send, "POST", body=b'{"organization_id": "o", "message_id": "m"}')

        assert status == 401 and sent.calls == []

    def test_a_deployment_with_no_provider_operations_answers_404(self, monkeypatch) -> None:
        monkeypatch.setattr(tenant_email_send, "load_provider_operations_settings", lambda: None)
        assert call(tenant_email_send, "POST", body=b"{}")[0] == 404


# --- the scheduler's tick: a shared secret, or nothing runs --------------------------------------


class TestAutomationTick:
    def _armed(self, monkeypatch):
        monkeypatch.setattr(automation_tick, "load_runner_settings", lambda: SETTINGS)
        ran = Sink(result=0)
        monkeypatch.setattr(automation_tick, "run_due_automations", ran)
        return ran

    @pytest.mark.parametrize("method", ["GET", "POST"])
    @pytest.mark.parametrize("authorization", [None, "", "Bearer wrong", "the-cron-secret", "bearer the-cron-secret"])
    def test_runs_nothing_without_the_exact_secret(self, monkeypatch, method, authorization) -> None:
        ran = self._armed(monkeypatch)
        headers = {} if authorization is None else {"authorization": authorization}

        status, _ = call(automation_tick, method, headers=headers)

        assert status == 401
        assert ran.calls == []

    def test_a_deployment_with_no_runner_answers_404(self, monkeypatch) -> None:
        monkeypatch.setattr(automation_tick, "load_runner_settings", lambda: None)

        assert call(automation_tick, "GET", headers={"authorization": "Bearer the-cron-secret"})[0] == 404


# --- the signed-in person's endpoints: a bearer token, or the domain is never called ------------

PEOPLE = [
    (ai_ask, "load_assistant_settings", "answer"),
    (crm_change_customer_stage, "load_domain_settings", "change_customer_stage"),
    (voice_wrap_up_call, "load_domain_settings", "wrap_up_call"),
    (routing_preview_inbound, "load_domain_settings", "resolve_inbound_route"),
    (routing_preview_outbound, "load_domain_settings", "resolve_outbound_identity"),
    (integration_operations, "load_integration_settings", "operate"),
    (provider_operations, "load_provider_operations_settings", "operate"),
    (organization_domains, "load_provider_operations_settings", "run_domain_command"),
    (organization_email_domains, "load_provider_operations_settings", "run_email_domain_command"),
    (invitation_email, "load_provider_operations_settings", "send_invitation_email"),
]


@pytest.mark.parametrize(("module", "loader", "command"), PEOPLE, ids=[m.__name__.split(".")[-1] for m, *_ in PEOPLE])
class TestSignedInEndpoints:
    def _armed(self, monkeypatch, module, loader, command):
        monkeypatch.setattr(module, loader, lambda: SETTINGS)
        if module is ai_ask:
            # The caller is proved before this is ever reached (see the dedicated ordering test
            # below); armed here only so the parametrized "no domain called" tests below can still
            # exercise every endpoint uniformly.
            monkeypatch.setattr(module, "resolve_provider", lambda settings, *, capability: object())
        sink = Sink()
        monkeypatch.setattr(module, command, sink)
        return sink

    @pytest.mark.parametrize("authorization", [None, "", "Basic abc", "Bearer"])
    def test_refuses_a_request_with_no_usable_bearer_token_and_calls_no_domain(self, monkeypatch, module, loader, command, authorization) -> None:
        sink = self._armed(monkeypatch, module, loader, command)
        headers = {} if authorization is None else {"authorization": authorization}

        status, _ = call(module, "POST", headers=headers, body=b"{}")

        assert status == 401
        assert sink.calls == []

    def test_a_deployment_that_does_not_offer_it_answers_404(self, monkeypatch, module, loader, command) -> None:
        monkeypatch.setattr(module, loader, lambda: None)

        assert call(module, "POST", headers={"authorization": "Bearer x"}, body=b"{}")[0] == 404


class TestAiAskAuthenticatesBeforeReadingAnyCredential:
    """`resolve_provider` reads a GOLD-owned Provider Account credential out of Vault
    (`app.ai.runtime`). An unauthenticated caller must never cause that read -- proved directly,
    not merely inferred from `sink.calls == []` on the loop's own `answer()`.
    """

    def _armed(self, monkeypatch):
        monkeypatch.setattr(ai_ask, "load_assistant_settings", lambda: SETTINGS)
        resolved: list[str] = []
        monkeypatch.setattr(
            ai_ask,
            "resolve_provider",
            lambda settings, *, capability: resolved.append(capability) or SimpleNamespace(name="test-model"),
        )
        return resolved

    @pytest.mark.parametrize("authorization", [None, "", "Basic abc", "Bearer"])
    def test_an_unauthenticated_request_never_resolves_the_runtime_provider(self, monkeypatch, authorization) -> None:
        resolved = self._armed(monkeypatch)
        headers = {} if authorization is None else {"authorization": authorization}

        status, _ = call(ai_ask, "POST", headers=headers, body=b"{}")

        assert status == 401
        assert resolved == []

    def test_an_authenticated_request_does_resolve_it(self, monkeypatch) -> None:
        resolved = self._armed(monkeypatch)
        # `require_caller`'s own correctness is `test_auth.py`'s subject; here it is a fixed
        # caller so this test is only about this handler's ordering.
        monkeypatch.setattr(ai_ask, "require_caller", lambda headers, **kw: SimpleNamespace(token="t"))
        monkeypatch.setattr(ai_ask, "answer", Sink(result=SimpleNamespace(outcome="answered", text="", detail="", tools=[], action=None)))

        status, _ = call(
            ai_ask,
            "POST",
            headers={"authorization": "Bearer x"},
            body=json.dumps({"question": "q", "organization_id": "o"}).encode(),
        )

        assert status == 200
        assert resolved == ["operator_assistant"]


# --- the public-site assistant: one shared key from apps/web, and any mismatch is a plain "not found" ----


class TestPublicChat:
    KEY = "the-public-chat-key"
    BODY = json.dumps({"message": "hello", "instructions": "be brief", "deploymentId": "d1", "organizationId": "o1"}).encode()

    def _armed(self, monkeypatch, *, secret: str | None = KEY, settings=SETTINGS, provider=object()):
        if secret is None:
            monkeypatch.delenv("PUBLIC_CHAT_API_SECRET", raising=False)
        else:
            monkeypatch.setenv("PUBLIC_CHAT_API_SECRET", secret)
        monkeypatch.setattr(public_chat, "load_assistant_settings", lambda: settings)
        monkeypatch.setattr(public_chat, "resolve_provider", lambda settings, *, capability: provider)
        sink = Sink(result=SimpleNamespace(text="Hello.", action=None))
        monkeypatch.setattr(public_chat, "answer", sink)
        return sink

    @pytest.mark.parametrize("presented", [None, "", "wrong-key", "THE-PUBLIC-CHAT-KEY"])
    def test_a_missing_or_wrong_key_is_not_found_and_never_reaches_the_model(self, monkeypatch, presented) -> None:
        sink = self._armed(monkeypatch)
        headers = {} if presented is None else {"x-gold-public-chat-key": presented}

        assert call(public_chat, "POST", headers=headers, body=self.BODY)[0] == 404
        assert sink.calls == []

    def test_a_deployment_with_no_secret_answers_404_even_to_an_empty_key(self, monkeypatch) -> None:
        sink = self._armed(monkeypatch, secret=None)

        for headers in ({}, {"x-gold-public-chat-key": ""}):
            assert call(public_chat, "POST", headers=headers, body=self.BODY)[0] == 404
        assert sink.calls == []

    def test_a_deployment_with_no_assistant_answers_404(self, monkeypatch) -> None:
        sink = self._armed(monkeypatch, settings=None)

        assert call(public_chat, "POST", headers={"x-gold-public-chat-key": self.KEY}, body=self.BODY)[0] == 404
        assert sink.calls == []

    def test_the_right_key_reaches_the_assistant_with_no_caller_token_and_only_the_public_actions(self, monkeypatch) -> None:
        sink = self._armed(monkeypatch)

        status, body = call(public_chat, "POST", headers={"x-gold-public-chat-key": self.KEY}, body=self.BODY)

        assert status == 200 and json.loads(body)["answer"] == "Hello."
        assert len(sink.calls) == 1
        assert sink.calls[0][1]["token"] == ""        # no signed-in person stands behind a public visitor
        assert sink.calls[0][1]["tools"] == ()        # and no database tool is offered


# --- the assistant's request body: earlier turns are text pairs, and nothing else gets through ----


class TestAssistantHistory:
    def test_keeps_well_formed_pairs_in_order(self) -> None:
        turns = ai_ask._prior_turns([{"question": "a?", "answer": "A"}, {"question": "b?", "answer": "B"}])

        assert [(t.question, t.answer) for t in turns] == [("a?", "A"), ("b?", "B")]

    @pytest.mark.parametrize(
        "raw",
        [None, "text", {"question": "a?", "answer": "A"}, [1, "x", None], [{"question": "a?"}], [{"question": "", "answer": "A"}], [{"question": "a?", "answer": 7}]],
    )
    def test_drops_anything_that_is_not_a_question_and_an_answer(self, raw) -> None:
        assert ai_ask._prior_turns(raw) == ()

    def test_never_forwards_extra_fields_such_as_tool_rows(self, monkeypatch) -> None:
        turns = ai_ask._prior_turns([{"question": "a?", "answer": "A", "tools": [{"rows": 3}], "rows": [{"secret": 1}]}])

        assert [vars(t) for t in turns] == [{"question": "a?", "answer": "A"}]


class TestAssistantAttachments:
    def test_keeps_well_formed_files(self) -> None:
        files = ai_ask._attachments([{"name": "a.csv", "mimeType": "text/csv", "text": "x", "truncated": True}])

        assert [(f.name, f.mime_type, f.text, f.truncated) for f in files] == [("a.csv", "text/csv", "x", True)]

    @pytest.mark.parametrize(
        "raw",
        [None, "text", {"name": "a"}, [1, None], [{"name": "a.txt"}], [{"name": "a", "mimeType": "t", "text": 5}]],
    )
    def test_drops_anything_that_is_not_a_named_text_file(self, raw) -> None:
        assert ai_ask._attachments(raw) == ()
