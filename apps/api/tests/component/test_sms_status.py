"""The carrier's delivery vocabulary stops at the provider boundary.

`api/sms_status.py` receives the carrier's own status words and error codes; what it hands the database
is this platform's own vocabulary and a sentence a business can read. A word the platform has no meaning
for is acknowledged and not acted on, so the carrier stops retrying it instead of a constraint failing
inside the callback.
"""

from __future__ import annotations

import base64
import email.message
import hashlib
import hmac
import io
from types import SimpleNamespace
from urllib.parse import urlencode

import pytest

import api.sms_status as sms_status
from app.providers.twilio.sms import failure_reason, normalize_status

TOKEN = "an-account-auth-token"
SETTINGS = SimpleNamespace(supabase_url="https://p.test", supabase_publishable_key="anon", supabase_jwt_secret="signing", twilio_auth_token=TOKEN)


def post(params: dict[str, str]) -> tuple[int, str]:
    body = urlencode(params).encode()
    url = "https://gold.example/x"
    payload = url + "".join(f"{key}{params[key]}" for key in sorted(params))
    signature = base64.b64encode(hmac.new(TOKEN.encode(), payload.encode(), hashlib.sha1).digest()).decode()

    cls = sms_status.handler
    instance = cls.__new__(cls)
    instance.headers = email.message.Message()
    for key, value in {"content-length": str(len(body)), "host": "gold.example", "x-twilio-signature": signature}.items():
        instance.headers[key] = value
    instance.rfile = io.BytesIO(body)
    instance.wfile = io.BytesIO()
    instance.path = "/x"
    instance.command = "POST"
    instance.request_version = "HTTP/1.1"
    instance.requestline = "POST /x HTTP/1.1"
    instance.client_address = ("127.0.0.1", 0)
    instance.log_message = lambda *args, **kwargs: None
    instance.do_POST()
    raw = instance.wfile.getvalue()
    return int(raw.split(b" ", 2)[1]), raw.split(b"\r\n\r\n", 1)[1].decode()


class Recorder:
    def __init__(self) -> None:
        self.calls: list[dict] = []

    def __call__(self, settings, **kwargs):
        self.calls.append(kwargs)
        return "message-id"


@pytest.fixture
def recorder(monkeypatch):
    sink = Recorder()
    monkeypatch.setattr(sms_status, "load_voice_settings", lambda: SETTINGS)
    monkeypatch.setattr(sms_status, "record_message_status", sink)
    monkeypatch.setattr(sms_status, "public_url", lambda headers, path: "https://gold.example/x")
    return sink


@pytest.mark.parametrize(
    ("theirs", "ours"),
    [("accepted", "queued"), ("scheduled", "queued"), ("queued", "queued"), ("sending", "sending"), ("sent", "sent"), ("delivered", "delivered"),
     ("read", "read"), ("undelivered", "undelivered"), ("failed", "failed"), ("canceled", "failed"), ("SENT", "sent")],
)
def test_every_status_the_carrier_sends_becomes_one_of_ours(theirs, ours) -> None:
    assert normalize_status(theirs) == ours


@pytest.mark.parametrize("theirs", ["receiving", "received", "", None, "teleported"])
def test_a_word_with_no_meaning_here_is_not_translated(theirs) -> None:
    assert normalize_status(theirs) is None


def test_a_failure_is_explained_in_words_and_never_by_the_carriers_code() -> None:
    assert failure_reason("30005") == "That number does not exist or cannot receive texts."
    assert "3000" not in failure_reason("30007")
    # An error nobody here has words for still reads as a sentence.
    assert failure_reason("99999") == "The carrier could not deliver this message."
    assert failure_reason(None) == "The carrier could not deliver this message."


def test_the_handler_hands_the_database_our_vocabulary_and_a_readable_reason(recorder) -> None:
    status, text = post({"MessageSid": "SM1", "MessageStatus": "undelivered", "ErrorCode": "30006"})

    assert (status, text) == (200, "recorded")
    assert recorder.calls == [{"external_id": "SM1", "status": "undelivered", "failure_reason": "That number is a landline or cannot receive texts."}]


def test_a_non_failure_carries_no_reason(recorder) -> None:
    post({"MessageSid": "SM1", "MessageStatus": "delivered"})
    assert recorder.calls[0]["failure_reason"] is None


def test_a_carrier_word_with_no_meaning_here_is_acknowledged_and_writes_nothing(recorder) -> None:
    for word in ("receiving", "teleported"):
        assert post({"MessageSid": "SM1", "MessageStatus": word}) == (200, "ignored")
    assert recorder.calls == []


def test_an_unsigned_callback_writes_nothing(monkeypatch, recorder) -> None:
    body = urlencode({"MessageSid": "SM1", "MessageStatus": "delivered"}).encode()
    cls = sms_status.handler
    instance = cls.__new__(cls)
    instance.headers = email.message.Message()
    for key, value in {"content-length": str(len(body)), "host": "gold.example", "x-twilio-signature": "bogus"}.items():
        instance.headers[key] = value
    instance.rfile = io.BytesIO(body)
    instance.wfile = io.BytesIO()
    instance.path = "/x"
    instance.request_version = "HTTP/1.1"
    instance.requestline = "POST /x HTTP/1.1"
    instance.client_address = ("127.0.0.1", 0)
    instance.log_message = lambda *args, **kwargs: None
    instance.do_POST()
    assert instance.wfile.getvalue().split(b" ", 2)[1] == b"403"
    assert recorder.calls == []
