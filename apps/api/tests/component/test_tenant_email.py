"""A business's own email: what is sent, what is recorded, and what a stranger cannot make it do.

The provider (`app.providers.resend.email`) and the database doors (`app.core.db`) are replaced; what
is proved here is this runtime's own sequencing -- the request names a message and nothing else,
a message is claimed once, every outcome is recorded, a transient fault returns the message to the
queue, a provider link is never kept -- and the provider module's reading of the vendor's protocol.
"""

from __future__ import annotations

import base64
import json
from datetime import datetime, timezone
from types import SimpleNamespace

import pytest

from app.core.config import ProviderOperationsSettings
from app.errors import DomainError, NotFoundError, ValidationError
from app.providers.resend import email as resend_email
from app.providers.resend.webhook import parse_tenant_event
from app.services.tenant_email import inbound, operations as ops
from app.services.tenant_email.operations import ProviderUnavailableError, send_queued_email

SETTINGS = ProviderOperationsSettings(supabase_url="http://db.test", supabase_publishable_key="anon", supabase_jwt_secret="signing")
ORG = "11111111-1111-4111-8111-111111111111"
MESSAGE = "22222222-2222-4222-8222-222222222222"
CONVERSATION = "33333333-3333-4333-8333-333333333333"


class Response:
    def __init__(self, status: int, body=None, content: bytes = b"") -> None:
        self.status_code = status
        self._body = body
        self.content = content

    def json(self):
        if self._body is None:
            raise ValueError("no body")
        return self._body


# --- the provider module's reading of the vendor's protocol -------------------------------------


class TestProviderProtocol:
    def _post(self, monkeypatch, response=None, raises=None):
        sent = {}

        def post(url, headers=None, json=None, timeout=None):
            sent.update(url=url, headers=headers, body=json)
            if raises:
                raise raises
            return response

        monkeypatch.setattr(resend_email.httpx, "post", post)
        return sent

    def _send(self, **overrides):
        return resend_email.send_tenant_email(
            api_key="k", idempotency_key=MESSAGE, sender="Acme <hello@acme.test>", to=["kim@example.test"], subject="Quote",
            text="Hi", html=None, in_reply_to=None, references=[], attachments=[], **overrides,
        )

    def test_sends_the_message_with_its_own_id_as_the_idempotency_key(self, monkeypatch) -> None:
        sent = self._post(monkeypatch, Response(200, {"id": "re_1"}))
        result = self._send()
        assert result == {"ok": True, "external_id": "re_1", "retryable": False, "detail": None}
        assert sent["headers"]["Idempotency-Key"] == MESSAGE
        assert sent["body"]["to"] == ["kim@example.test"]
        assert "html" not in sent["body"] and "headers" not in sent["body"]

    def test_carries_the_threading_headers_and_attachments_when_there_are_some(self, monkeypatch) -> None:
        sent = self._post(monkeypatch, Response(200, {"id": "re_1"}))
        resend_email.send_tenant_email(
            api_key="k", idempotency_key=MESSAGE, sender="a@b.test", to=["c@d.test"], subject="s", text="t", html="<p>t</p>",
            in_reply_to="<a@x>", references=["<r1@x>", "<a@x>"], attachments=[{"filename": "f.txt", "content": "eA==", "content_type": "text/plain"}],
        )
        assert sent["body"]["headers"] == {"In-Reply-To": "<a@x>", "References": "<r1@x> <a@x>"}
        assert sent["body"]["html"] == "<p>t</p>" and sent["body"]["attachments"][0]["filename"] == "f.txt"

    @pytest.mark.parametrize("status", [429, 500, 503])
    def test_a_provider_fault_is_retryable(self, monkeypatch, status) -> None:
        self._post(monkeypatch, Response(status, {"message": "try later"}))
        assert self._send()["retryable"] is True

    def test_a_key_still_in_flight_is_retried_and_never_called_uncertain(self, monkeypatch) -> None:
        self._post(monkeypatch, Response(409, {"name": "concurrent_idempotent_requests", "message": "in progress"}))
        result = self._send()
        assert result["ok"] is False and result["retryable"] is True and result["uncertain"] is False

    def test_a_key_already_used_for_a_different_request_is_uncertain_not_a_refusal(self, monkeypatch) -> None:
        self._post(monkeypatch, Response(409, {"name": "invalid_idempotent_request", "message": "payload differs"}))
        result = self._send()
        assert result["ok"] is False and result["retryable"] is False and result["uncertain"] is True

    def test_an_unreachable_provider_is_retryable(self, monkeypatch) -> None:
        self._post(monkeypatch, raises=resend_email.httpx.ConnectError("down"))
        result = self._send()
        assert result["ok"] is False and result["retryable"] is True

    def test_a_refusal_is_a_fact_about_the_message_and_is_not_retried(self, monkeypatch) -> None:
        self._post(monkeypatch, Response(422, {"message": "Invalid `to` field"}))
        result = self._send()
        assert result["ok"] is False and result["retryable"] is False and result["detail"] == "Invalid `to` field"

    def test_an_acceptance_with_no_id_is_not_a_success(self, monkeypatch) -> None:
        self._post(monkeypatch, Response(200, {}))
        assert self._send()["ok"] is False

    def test_the_confirmed_message_id_is_read_back_and_absence_is_not_invented(self, monkeypatch) -> None:
        monkeypatch.setattr(resend_email.httpx, "get", lambda *a, **k: Response(200, {"id": "re_1", "message_id": "<abc@mail.test>"}))
        assert resend_email.confirmed_message_id(api_key="k", email_id="re_1") == "<abc@mail.test>"
        monkeypatch.setattr(resend_email.httpx, "get", lambda *a, **k: Response(200, {"id": "re_1"}))
        assert resend_email.confirmed_message_id(api_key="k", email_id="re_1") is None
        monkeypatch.setattr(resend_email.httpx, "get", lambda *a, **k: Response(404, {}))
        assert resend_email.confirmed_message_id(api_key="k", email_id="re_1") is None

    @pytest.mark.parametrize(
        "headers",
        [
            {"In-Reply-To": "<p@x>", "references": "<r@x> <p@x>"},
            [{"name": "in-reply-to", "value": "<p@x>"}, {"name": "References", "value": "<r@x> <p@x>"}],
        ],
        ids=["object", "list"],
    )
    def test_a_received_message_is_read_whichever_shape_the_headers_arrive_in(self, monkeypatch, headers) -> None:
        answer = {"text": "Hello", "html": "<p>Hello</p>", "message_id": "<in@x>", "headers": headers, "authentication": {"spf": "pass"}}
        monkeypatch.setattr(resend_email.httpx, "get", lambda *a, **k: Response(200, answer))
        got = resend_email.fetch_received_email(api_key="k", email_id="in_1")
        assert got["in_reply_to"] == "<p@x>" and got["references"] == ["<r@x>", "<p@x>"]
        assert got["text"] == "Hello" and got["message_id"] == "<in@x>"

    def test_an_attachment_over_the_limit_is_not_held_in_memory(self, monkeypatch) -> None:
        class Stream:
            status_code = 200

            def __enter__(self):
                return self

            def __exit__(self, *a):
                return False

            def iter_bytes(self):
                yield b"x" * 600
                yield b"x" * 600

        monkeypatch.setattr(resend_email.httpx, "stream", lambda *a, **k: Stream())
        assert resend_email.download_attachment("https://p.test/f", max_bytes=1000) is None
        assert resend_email.download_attachment("https://p.test/f", max_bytes=2000) == b"x" * 1200


class TestEventParsing:
    def test_a_delivery_event_becomes_gildops_vocabulary(self) -> None:
        body = {"type": "email.bounced", "created_at": "2026-01-01T00:00:00Z", "data": {"email_id": "re_1", "bounce": {"message": "mailbox full"}}}
        event = parse_tenant_event(body)
        assert event["kind"] == "delivery" and event["type"] == "bounced" and event["detail"] == "mailbox full"
        assert event["event_at"] == datetime(2026, 1, 1, tzinfo=timezone.utc)

    @pytest.mark.parametrize(
        ("provider_type", "ours"),
        [("email.sent", "sent"), ("email.delivered", "delivered"), ("email.delivery_delayed", "delayed"), ("email.complained", "complained"),
         ("email.suppressed", "rejected"), ("email.opened", "opened"), ("email.clicked", "clicked"), ("email.failed", "failed")],
    )
    def test_every_event_this_platform_tracks_maps_to_one_word(self, provider_type, ours) -> None:
        assert parse_tenant_event({"type": provider_type, "data": {"email_id": "re_1"}})["type"] == ours

    def test_a_received_event_carries_only_what_the_callback_carries(self) -> None:
        body = {"type": "email.received", "data": {"email_id": "in_1", "from": "Kim <KIM@Example.test>", "to": ["Hello@Acme.test"], "cc": [], "subject": "Hi",
                                                    "message_id": "<m@x>", "received_for": ["hello@acme.test"], "attachments": [{"id": "a1", "filename": "f.pdf"}]}}
        event = parse_tenant_event(body)
        assert event["from"] == "kim@example.test" and event["to"] == ["hello@acme.test"] and event["email_id"] == "in_1"
        assert "attachments" not in event and "html" not in event

    @pytest.mark.parametrize("body", [{}, {"type": "email.unknown", "data": {}}, {"type": "email.delivered", "data": {}}, {"type": "email.received", "data": {"email_id": "x"}}, "nope"])
    def test_anything_else_is_ignored_not_refused(self, body) -> None:
        assert parse_tenant_event(body) is None


# --- sending one queued message -----------------------------------------------------------------


class World:
    """The database as the caller's token sees it, and the doors this runtime writes through."""

    def __init__(self, monkeypatch, *, status="queued", visible=True, provider="resend", credential="secret", send=None, files=(), sender="ready", sender_detail=None) -> None:
        self.status = status
        self.visible = visible
        self.provider_key = provider
        self.credential = credential
        self.sender = sender
        self.sender_detail = sender_detail
        self.resolved: list[dict] = []
        self.claimed = True
        self.recorded: list[dict] = []
        self.claims = 0
        self.rest: list[str] = []
        self.sends: list[dict] = []
        self.files = list(files)
        self.module = SimpleNamespace(
            send_tenant_email=lambda **kw: (self.sends.append(kw), (send or {"ok": True, "external_id": "re_9", "retryable": False, "detail": None}))[1],
            confirmed_message_id=lambda **kw: "<confirmed@mail.test>",
        )
        monkeypatch.setattr(ops, "caller_rest", self._rest)
        monkeypatch.setattr(ops, "tenant_email_for", lambda key: self.module if key == "resend" else None)
        monkeypatch.setattr(ops.db, "email_sender_account", self._sender_account)
        monkeypatch.setattr(ops.db, "read_provider_account_credential", lambda s, **kw: {"secret": self.credential} if self.credential else None)
        monkeypatch.setattr(ops.db, "claim_email_for_send", self._claim)
        monkeypatch.setattr(ops.db, "record_email_send_result", lambda s, **kw: self.recorded.append(kw))
        monkeypatch.setattr(ops.httpx, "get", lambda url, **kw: Response(200, content=b"file-bytes"))
        monkeypatch.delenv("RESEND_API_KEY", raising=False)

    def _sender_account(self, s, **kw):
        self.resolved.append(kw)
        if self.sender != "ready":
            return {"state": self.sender, "detail": self.sender_detail, "provider_key": None, "provider_account_id": None}
        return {"state": "ready", "detail": None, "provider_key": self.provider_key, "provider_account_id": "acct"}

    def _claim(self, s, **kw):
        self.claims += 1
        return self.claimed

    def _rest(self, url, key, token, method, path, **kwargs):
        assert token == "caller-token"
        self.rest.append(path)
        p = kwargs["params"]
        if path == "messages":
            return Response(200, [{"id": MESSAGE, "status": self.status, "body": "Hi Kim", "conversation_id": CONVERSATION, "external_id": None}] if self.visible else [])
        if path == "email_message_details":
            return Response(200, [{"subject": "Quote", "from_address": "hello@acme.test", "from_name": "Acme", "to_addresses": ["kim@example.test"],
                                   "html_body": None, "in_reply_to": "<prev@x>", "reference_ids": ["<prev@x>"]}])
        if path == "conversations":
            return Response(200, [{"email_identity_id": "ident"}])
        if path == "message_attachments":
            return Response(200, [{"filename": "n.txt", "content_type": "text/plain", "size_bytes": 10, "storage_path": f"{ORG}/outbound/x/n.txt"}] * len(self.files))
        raise AssertionError(path)


def run(world: World):
    return send_queued_email(SETTINGS, token="caller-token", organization_id=ORG, message_id=MESSAGE)


class TestSendingAQueuedMessage:
    def test_the_request_carries_a_message_id_and_nothing_a_stranger_could_redirect(self) -> None:
        import inspect

        parameters = set(inspect.signature(send_queued_email).parameters)
        assert parameters == {"settings", "token", "organization_id", "message_id"}

    def test_sends_what_the_message_row_says_and_records_acceptance_with_the_confirmed_id(self, monkeypatch) -> None:
        world = World(monkeypatch)
        result = run(world)

        assert result == {"status": "sent", "external_id": "re_9"}
        sent = world.sends[0]
        assert sent["sender"] == "Acme <hello@acme.test>" and sent["to"] == ["kim@example.test"] and sent["idempotency_key"] == MESSAGE
        assert sent["in_reply_to"] == "<prev@x>" and sent["references"] == ["<prev@x>"] and sent["text"] == "Hi Kim"
        assert world.recorded == [dict(organization_id=ORG, message_id=MESSAGE, outcome="accepted", external_id="re_9", rfc_message_id="<confirmed@mail.test>")]

    def test_a_message_the_caller_cannot_see_is_one_refusal_and_nothing_is_claimed(self, monkeypatch) -> None:
        world = World(monkeypatch, visible=False)
        with pytest.raises(NotFoundError):
            run(world)
        assert world.claims == 0 and world.sends == [] and world.recorded == []

    @pytest.mark.parametrize("status", ["sending", "sent", "delivered", "rejected", "bounced", "failed"])
    def test_a_message_that_is_not_queued_is_not_sent_again(self, monkeypatch, status) -> None:
        world = World(monkeypatch, status=status)
        assert run(world)["status"] == status
        assert world.claims == 0 and world.sends == []

    def test_losing_the_claim_means_somebody_else_has_it_and_nothing_is_sent(self, monkeypatch) -> None:
        world = World(monkeypatch)
        world.claimed = False
        assert run(world)["status"] == "sending"
        assert world.sends == [] and world.recorded == []

    def test_a_deployment_with_no_provider_account_returns_the_message_to_the_queue(self, monkeypatch) -> None:
        world = World(monkeypatch, credential=None)
        with pytest.raises(ProviderUnavailableError):
            run(world)
        assert world.sends == []
        assert [r["outcome"] for r in world.recorded] == ["retry"]

    def test_an_address_with_no_provider_beneath_it_cannot_send(self, monkeypatch) -> None:
        world = World(monkeypatch, provider="unknown_provider")
        with pytest.raises(ProviderUnavailableError):
            run(world)
        assert world.sends == []

    def test_the_sender_is_resolved_again_at_send_time_from_the_conversations_own_address(self, monkeypatch) -> None:
        world = World(monkeypatch)
        run(world)
        assert world.resolved == [dict(organization_id=ORG, email_identity_id="ident")]

    def test_a_sender_that_is_no_longer_ready_is_refused_with_its_reason_and_never_sent(self, monkeypatch) -> None:
        reason = "The sender address hello@acme.test is not verified for sending. Finish its domain setup in Email sending settings."
        world = World(monkeypatch, sender="refused", sender_detail=reason)
        result = run(world)
        assert result == {"status": "rejected", "external_id": None, "detail": reason}
        assert world.sends == []
        assert world.recorded == [dict(organization_id=ORG, message_id=MESSAGE, outcome="failed", detail=reason)]

    def test_an_unavailable_platform_account_returns_the_message_to_the_queue(self, monkeypatch) -> None:
        world = World(monkeypatch, sender="unavailable", sender_detail="Email sending for hello@acme.test is unavailable on this platform right now.")
        with pytest.raises(ProviderUnavailableError):
            run(world)
        assert world.sends == [] and [r["outcome"] for r in world.recorded] == ["retry"]

    def test_the_deployments_own_key_never_stands_in_for_the_senders_account(self, monkeypatch) -> None:
        world = World(monkeypatch, credential=None)
        monkeypatch.setenv("RESEND_API_KEY", "deployment-key")
        with pytest.raises(ProviderUnavailableError):
            run(world)
        assert world.sends == []

    def test_a_provider_refusal_is_recorded_as_rejected_with_its_reason(self, monkeypatch) -> None:
        world = World(monkeypatch, send={"ok": False, "external_id": None, "retryable": False, "detail": "Invalid to"})
        result = run(world)
        assert result["status"] == "rejected"
        assert world.recorded == [dict(organization_id=ORG, message_id=MESSAGE, outcome="rejected", detail="Invalid to")]

    def test_a_transient_fault_puts_the_message_back_so_the_same_attempt_can_be_made_again(self, monkeypatch) -> None:
        world = World(monkeypatch, send={"ok": False, "external_id": None, "retryable": True, "detail": "down"})
        with pytest.raises(ProviderUnavailableError):
            run(world)
        assert [r["outcome"] for r in world.recorded] == ["retry"]

    def test_an_unexpected_error_never_leaves_the_message_claimed_forever(self, monkeypatch) -> None:
        world = World(monkeypatch)

        def boom(**kw):
            raise RuntimeError("something nobody planned for")

        world.module.send_tenant_email = boom
        with pytest.raises(ProviderUnavailableError):
            run(world)
        assert [r["outcome"] for r in world.recorded] == ["retry"]

    def test_attachments_are_read_back_under_the_callers_token_and_sent_as_base64(self, monkeypatch) -> None:
        world = World(monkeypatch, files=[1])
        run(world)
        assert world.sends[0]["attachments"] == [{"filename": "n.txt", "content_type": "text/plain", "content": base64.b64encode(b"file-bytes").decode()}]

    def test_an_attachment_that_will_not_open_stops_the_send_and_is_recorded(self, monkeypatch) -> None:
        world = World(monkeypatch, files=[1])
        monkeypatch.setattr(ops.httpx, "get", lambda url, **kw: Response(403, content=b""))
        with pytest.raises(ValidationError):
            run(world)
        assert world.sends == [] and [r["outcome"] for r in world.recorded] == ["failed"]

    def test_an_oversized_attachment_is_refused_here_as_well_as_in_the_database(self, monkeypatch) -> None:
        world = World(monkeypatch, files=[1])
        monkeypatch.setattr(ops.httpx, "get", lambda url, **kw: Response(200, content=b"x" * (ops.MAX_ATTACHMENT_BYTES + 1)))
        with pytest.raises(ValidationError):
            run(world)
        assert world.sends == []


# --- mail that arrives --------------------------------------------------------------------------


class Inbound:
    def __init__(self, monkeypatch, *, result=None, credential="secret", content="ok", attachments=(), download=b"bytes") -> None:
        self.result = {"message_id": "m1", "organization_id": ORG, "attachments": [], "duplicate": False} if result is None else result
        self.recorded_inbound: list[dict] = []
        self.stored: list[dict] = []
        self.stored_state: list[dict] = []
        self.provider = SimpleNamespace(
            fetch_received_email=lambda **kw: (
                {"text": "Hello", "html": "<p>Hello</p>", "message_id": "<in@x>", "in_reply_to": "<out@x>", "references": ["<out@x>"], "authentication": None}
                if content == "ok" else None
            ),
            list_received_attachments=lambda **kw: list(attachments),
            download_attachment=lambda url, max_bytes: download,
        )
        monkeypatch.delenv("RESEND_API_KEY", raising=False)
        monkeypatch.setattr(inbound.db, "default_platform_provider_account", lambda s, **kw: "acct")
        monkeypatch.setattr(inbound.db, "read_provider_account_credential", lambda s, **kw: {"secret": credential} if credential else None)
        monkeypatch.setattr(inbound.db, "record_inbound_email", lambda s, **kw: (self.recorded_inbound.append(kw), self.result)[1])
        monkeypatch.setattr(inbound.db, "store_inbound_attachment", lambda s, **kw: (self.stored.append(kw), True)[1])
        monkeypatch.setattr(inbound.db, "record_inbound_attachment_stored", lambda s, **kw: self.stored_state.append(kw))

    def run(self):
        event = {"email_id": "in_1", "from": "kim@example.test", "to": ["hello@acme.test"], "subject": "Hi", "message_id": "<in@x>", "event_at": None}
        return inbound.handle_received(SimpleNamespace(), self.provider, provider_key="resend", event=event, event_id="svix_1")


class TestReceivingMail:
    def test_hands_the_database_the_body_and_the_threading_headers_and_nothing_to_choose_a_business_by(self, monkeypatch) -> None:
        world = Inbound(monkeypatch)
        assert world.run() == "recorded"
        sent = world.recorded_inbound[0]
        assert sent["in_reply_to"] == "<out@x>" and sent["references"] == ["<out@x>"] and sent["text"] == "Hello" and sent["provider_event_id"] == "svix_1"
        assert "organization_id" not in sent

    def test_a_message_for_nobody_here_is_ignored(self, monkeypatch) -> None:
        world = Inbound(monkeypatch)
        monkeypatch.setattr(inbound.db, "record_inbound_email", lambda s, **kw: None)
        assert world.run() == "ignored"

    def test_a_duplicate_is_acknowledged_and_nothing_is_stored(self, monkeypatch) -> None:
        world = Inbound(monkeypatch, result={"message_id": "m1", "organization_id": ORG, "attachments": [], "duplicate": True})
        assert world.run() == "duplicate"
        assert world.stored == []

    def test_a_message_the_provider_cannot_produce_raises_so_the_provider_retries(self, monkeypatch) -> None:
        with pytest.raises(RuntimeError):
            Inbound(monkeypatch, content="missing").run()
        with pytest.raises(RuntimeError):
            Inbound(monkeypatch, credential=None).run()

    def test_an_attachment_is_stored_under_its_own_business_and_the_provider_link_is_never_passed_on(self, monkeypatch) -> None:
        listed = [{"id": "a1", "filename": "../../etc/Quote.pdf", "content_type": "application/pdf", "size": 5, "download_url": "https://provider.test/tmp?sig=1"}]
        world = Inbound(monkeypatch, attachments=listed, result={"message_id": "m1", "organization_id": ORG, "duplicate": False, "attachments": [{"id": "row1", "provider_attachment_id": "a1"}]})
        assert world.run() == "recorded"

        assert "download_url" not in json.dumps(world.recorded_inbound[0]["attachments"])
        path = world.stored[0]["path"]
        assert path.startswith(f"{ORG}/inbound/") and path.endswith("/Quote.pdf") and ".." not in path
        # Served back only as a neutral download, whatever the sender called it.
        assert world.stored[0]["content_type"] == "application/octet-stream"
        assert world.stored_state == [dict(attachment_id="row1", storage_path=path, size_bytes=5)]

    def test_an_oversized_or_unfetchable_attachment_is_recorded_as_rejected_not_dropped(self, monkeypatch) -> None:
        too_big = [{"id": "a1", "filename": "big.bin", "size": inbound.MAX_ATTACHMENT_BYTES + 1, "download_url": "https://p.test/x"}]
        pending = {"message_id": "m1", "organization_id": ORG, "duplicate": False, "attachments": [{"id": "row1", "provider_attachment_id": "a1"}]}
        world = Inbound(monkeypatch, attachments=too_big, result=pending)
        world.run()
        assert world.stored == [] and world.stored_state[0]["storage_path"] is None and "10 MB" in world.stored_state[0]["rejection"]

        gone = Inbound(monkeypatch, attachments=[{"id": "a1", "filename": "x", "size": 1, "download_url": "https://p.test/x"}], result=pending, download=None)
        gone.run()
        assert gone.stored == [] and gone.stored_state[0]["rejection"]

        no_link = Inbound(monkeypatch, attachments=[{"id": "a1", "filename": "x", "size": 1}], result=pending)
        no_link.run()
        assert no_link.stored == [] and no_link.stored_state[0]["rejection"]


def test_the_provider_registry_names_a_vendor_only_inside_providers() -> None:
    import pathlib

    root = pathlib.Path(__file__).resolve().parents[2] / "app" / "services" / "tenant_email"
    for path in root.glob("*.py"):
        assert "resend" not in path.read_text(encoding="utf-8").lower().replace("resend_", "").replace("`resend`", ""), path.name


def test_domain_errors_stay_domain_errors() -> None:
    assert issubclass(ProviderUnavailableError, DomainError)


def test_a_database_function_that_returns_nothing_is_a_success_not_a_parse_error(monkeypatch) -> None:
    from app.core import db

    settings = SimpleNamespace(supabase_url="http://db.test", supabase_publishable_key="anon", supabase_jwt_secret="signing")
    monkeypatch.setattr(db.httpx, "post", lambda *a, **k: SimpleNamespace(status_code=204, content=b"", json=lambda: (_ for _ in ()).throw(ValueError("no body"))))

    assert db.record_inbound_attachment_stored(settings, attachment_id="a", storage_path="p", size_bytes=1) is None
    assert db.claim_email_for_send(ProviderOperationsSettings("http://db.test", "anon", "signing"), organization_id=ORG, message_id=MESSAGE) is False
