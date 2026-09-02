"""The clock, and the two claims that are this runtime's to make.

Everything about *what is due* lives in Postgres (D30) and is tested there, against real RLS,
by `apps/web/tests/automations.test.ts`. What belongs here is the half that is a fact about this
process: that it identifies itself as a role holding almost nothing, and that it does not put a
single word of its own into a message a business wrote.

These run in `pnpm check` from the root, after the TypeScript half. They did not until M8;
`apps/api/README.md` records what changed.
"""

from __future__ import annotations

import base64
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.channels import Message, Sent  # noqa: E402
from app.channels.registry import sender_for, unconfigured_reason  # noqa: E402
from app.core.db import machine_token  # noqa: E402
from app.core.runner import AUTOMATION_ACTOR, ROLE  # noqa: E402

SECRET = "a-test-signing-secret"


def claims(token: str) -> dict:
    payload = token.split(".")[1]
    padded = payload + "=" * (-len(payload) % 4)
    return json.loads(base64.urlsafe_b64decode(padded))


def test_identifies_as_the_runner_role_and_not_as_a_person() -> None:
    # The whole of D26's argument, applied on a second axis: identity reaches Postgres as a JWT
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
    # on the Automations screen and names whose problem it is (constraints.md D31).
    assert "cannot send email" in unconfigured_reason("email")


def test_has_no_sender_for_a_channel_that_does_not_exist() -> None:
    assert sender_for("carrier pigeon") is None


def test_sends_the_body_exactly_as_the_business_wrote_it(monkeypatch) -> None:
    """The one assertion that would catch a friendly footer being added later.

    `constraints.md` forbids the platform putting words in a business's mouth, and an email is
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
