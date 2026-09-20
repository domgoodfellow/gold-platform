"""The carrier's half of a call, tested where it is pure.

Everything worth asserting here is a decision the adapter makes with no network in reach: is
this really from the carrier, what does their word mean in ours, and is this the same delivery
we already applied. The handlers around it are routing and status codes.

**The signature test is the one with teeth.** Without it an endpoint reachable by anyone who
learns the URL can write call records into a business's database, which is the single most
serious thing this slice could get wrong.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.providers.twilio.voice import (  # noqa: E402
    TERMINAL,
    conference_twiml,
    normalise_status,
    payload_hash,
    recording_download_url,
    recording_report,
    status_report,
    verify_signature,
)

TOKEN = "an-account-auth-token"
URL = "https://gold.example/voice/status"


def sign(url: str, params: dict[str, str], token: str = TOKEN) -> str:
    """What the carrier would send, built the way they document it."""
    payload = url + "".join(f"{key}{params[key]}" for key in sorted(params))
    return base64.b64encode(
        hmac.new(token.encode(), payload.encode(), hashlib.sha1).digest()
    ).decode()


class TestSignature:
    def test_accepts_what_the_carrier_actually_signed(self) -> None:
        params = {"CallSid": "CA123", "CallStatus": "completed", "CallDuration": "42"}
        assert verify_signature(
            url=URL, params=params, signature=sign(URL, params), auth_token=TOKEN
        )

    def test_refuses_a_body_somebody_edited(self) -> None:
        # The attack this exists for: a real captured callback with one value changed.
        params = {"CallSid": "CA123", "CallStatus": "completed", "CallDuration": "42"}
        signature = sign(URL, params)
        params["CallDuration"] = "9999"

        assert not verify_signature(
            url=URL, params=params, signature=signature, auth_token=TOKEN
        )

    def test_refuses_a_signature_for_a_different_address(self) -> None:
        # The URL is part of what is signed, so a valid callback replayed against another
        # endpoint of ours does not verify there.
        params = {"CallSid": "CA123", "CallStatus": "completed"}
        assert not verify_signature(
            url="https://gold.example/voice/recording",
            params=params,
            signature=sign(URL, params),
            auth_token=TOKEN,
        )

    def test_refuses_a_missing_signature_rather_than_skipping_the_check(self) -> None:
        params = {"CallSid": "CA123"}
        assert not verify_signature(
            url=URL, params=params, signature=None, auth_token=TOKEN
        )

    def test_refuses_when_this_deployment_holds_no_token(self) -> None:
        # An endpoint that cannot verify must refuse rather than accept. The route answers 404
        # before reaching here; this is the second line.
        params = {"CallSid": "CA123"}
        assert not verify_signature(
            url=URL, params=params, signature=sign(URL, params), auth_token=""
        )


class TestStatus:
    def test_maps_every_word_the_carrier_uses(self) -> None:
        assert normalise_status("queued") == "ringing"
        assert normalise_status("initiated") == "ringing"
        assert normalise_status("in-progress") == "in_progress"
        assert normalise_status("completed") == "completed"
        assert normalise_status("no-answer") == "no_answer"
        assert normalise_status("busy") == "busy"
        assert normalise_status("canceled") == "failed"

    def test_reads_a_word_it_does_not_know_as_a_failure(self) -> None:
        # Never a guess and never a pass-through: a status this repository does not understand
        # is not one it should be acting on, and the check constraint would refuse it anyway.
        assert normalise_status("teleported") == "failed"

    def test_says_nothing_when_the_carrier_said_nothing(self) -> None:
        assert normalise_status(None) is None
        assert normalise_status("") is None

    def test_reports_a_finished_call(self) -> None:
        report = status_report(
            {"CallSid": "CA123", "CallStatus": "completed", "CallDuration": "42"}
        )
        assert report is not None
        assert report.external_id == "CA123"
        assert report.status == "completed"
        assert report.duration_seconds == 42
        assert report.source == "status"

    def test_ignores_a_callback_naming_no_call(self) -> None:
        assert status_report({"CallStatus": "completed"}) is None

    def test_refuses_a_duration_that_is_not_one(self) -> None:
        report = status_report({"CallSid": "CA1", "CallStatus": "completed", "CallDuration": "-5"})
        assert report is not None
        assert report.duration_seconds is None

    def test_every_terminal_status_is_one_the_column_allows(self) -> None:
        # The check constraint on `calls.status` and this tuple have to agree, and the failure
        # if they stop agreeing is a callback that raises rather than a call that finishes.
        for status in TERMINAL:
            assert status in {"completed", "failed", "no_answer", "busy"}


class TestRecording:
    def test_reports_where_the_audio_is(self) -> None:
        report = recording_report(
            {"CallSid": "CA1", "RecordingUrl": "https://api.example/R1", "RecordingStatus": "completed"}
        )
        assert report is not None
        assert report.recording_url == "https://api.example/R1"
        assert report.source == "recording"
        # Deliberately absent: a recording is shorter than the call that contains it, and
        # writing its length onto the call would understate every conversation.
        assert report.duration_seconds is None
        assert report.status is None

    def test_ignores_a_callback_with_no_audio_in_it(self) -> None:
        assert recording_report({"CallSid": "CA1", "RecordingStatus": "failed"}) is None

    def test_asks_for_the_audio_rather_than_the_page_about_it(self) -> None:
        assert recording_download_url("https://api.example/R1") == "https://api.example/R1.mp3"


class TestDeduplication:
    def test_the_same_delivery_hashes_the_same(self) -> None:
        first = {"CallSid": "CA1", "CallStatus": "completed"}
        second = {"CallSid": "CA1", "CallStatus": "completed"}
        assert payload_hash(first) == payload_hash(second)

    def test_reordered_fields_are_still_the_same_delivery(self) -> None:
        # The reason this hashes parameters rather than the raw body: a carrier may reorder form
        # fields between deliveries of one event, and a body hash would call those two events
        # and write a second ending onto a call that already ended.
        assert payload_hash({"a": "1", "b": "2"}) == payload_hash({"b": "2", "a": "1"})

    def test_a_different_event_hashes_differently(self) -> None:
        assert payload_hash({"CallSid": "CA1", "CallStatus": "ringing"}) != payload_hash(
            {"CallSid": "CA1", "CallStatus": "completed"}
        )


class TestTwiml:
    def test_puts_the_agent_in_a_room_that_starts_and_ends_with_them(self) -> None:
        xml = conference_twiml(name="room-1", start_on_enter=True, end_on_exit=True)
        assert "<Conference" in xml
        assert 'startConferenceOnEnter="true"' in xml
        assert 'endConferenceOnExit="true"' in xml
        assert ">room-1<" in xml

    def test_holds_the_room_open_for_a_customer_who_answers_first(self) -> None:
        xml = conference_twiml(name="room-1", start_on_enter=False, end_on_exit=False)
        assert 'startConferenceOnEnter="false"' in xml
        assert 'endConferenceOnExit="false"' in xml

    def test_escapes_a_room_name_rather_than_letting_it_close_a_tag(self) -> None:
        # A conference name is generated by this platform, so this is defence rather than a live
        # hole -- and it is the assertion that stays true if that ever stops being so.
        xml = conference_twiml(name="a<b>&c", start_on_enter=True, end_on_exit=True)
        assert "<b>" not in xml.split("<Conference")[1].split("</Conference>")[0]
        assert "&amp;" in xml
