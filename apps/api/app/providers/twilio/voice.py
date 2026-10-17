"""The carrier calling in, and the instructions it fetches when it does.

**The second half of the telephony adapter, and the half that could not live in TypeScript.**
Placing a call is an operator pressing a button, which the web/API runtime split gives to the transactional runtime;
being *called* by the carrier with nobody signed in is webhook ingress, which the web/API runtime split gives to this
one. The same split payments already made, stated in `app/providers/stripe/webhook.py`.

**No SDK, and the same reasoning as everywhere else here.** What this needs is one HMAC, one
form parse and some XML, all of them specified and stable. Everything below is pure and is
tested directly, signature included -- there is no network in this file.

**TwiML lives here because it is the carrier's dialect.** A conference, a dial verb and an
attribute spelled `startConferenceOnEnter` are that vendor's vocabulary, and the no-vendor-SDK-in-domain rule says the place
for a vendor's vocabulary is inside its own adapter. Nothing above this module ever sees XML.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
from dataclasses import dataclass
from urllib.parse import quote
from xml.sax.saxutils import escape

# Their word for what the line is doing, mapped onto ours -- the same six this platform stores
# and no more. `queued` and `initiated` are stages of dialling our contract does not
# distinguish, because no screen has needed to. Anything unrecognised is reported as a failure
# rather than guessed at: a status this repository does not understand is not one it should act
# on.
_STATUS = {
    "queued": "ringing",
    "initiated": "ringing",
    "ringing": "ringing",
    "in-progress": "in_progress",
    "answered": "in_progress",
    "completed": "completed",
    "busy": "busy",
    "no-answer": "no_answer",
    "canceled": "failed",
    "failed": "failed",
}

TERMINAL = ("completed", "failed", "no_answer", "busy")


def normalise_status(raw: str | None) -> str | None:
    """One of the six, or None when the carrier said nothing about status."""
    if not raw:
        return None
    return _STATUS.get(raw.strip().lower(), "failed")


def verify_signature(*, url: str, params: dict[str, str], signature: str | None, auth_token: str) -> bool:
    """Did this really come from the carrier.

    **The one entirely vendor-specific question**, and the reason this module exists rather than
    a generic webhook reader. Their scheme: take the full URL exactly as they called it, append
    every POST parameter as key immediately followed by value in sorted key order, sign the lot
    with the account's auth token, and compare base64.

    Compared with `compare_digest` rather than `==`, because a signature check that returns early
    on the first wrong byte tells a patient caller how much of their guess was right.

    **A missing signature is a failure rather than a skip.** An endpoint that accepted unsigned
    callbacks would let anyone who learned the URL write call records into a tenant's database,
    which is the whole of what this function is here to prevent.
    """
    if not signature or not auth_token:
        return False

    payload = url + "".join(f"{key}{params[key]}" for key in sorted(params))
    expected = base64.b64encode(
        hmac.new(auth_token.encode(), payload.encode("utf-8"), hashlib.sha1).digest()
    ).decode()

    return hmac.compare_digest(expected, signature)


@dataclass(frozen=True)
class CallReport:
    """What the carrier is telling us about one call or one leg of one.

    Deliberately thin, exactly as `ProviderPayment` is. Nothing in this shape lets the carrier
    say anything about a customer, a business or an outcome: which call it concerns is resolved
    from `external_id` against a row this platform wrote first, and everything else about that
    row is derived inside the database function rather than supplied here.
    """

    external_id: str
    source: str
    raw_status: str | None
    status: str | None
    duration_seconds: int | None
    recording_url: str | None


def _int_or_none(value: str | None) -> int | None:
    try:
        parsed = int(str(value))
    except (TypeError, ValueError):
        return None
    return parsed if parsed >= 0 else None


# Who is in the room, which the carrier reports as people join and leave it. Every other
# conference event (the room starting, ending, somebody muted) says nothing about a leg.
_CONFERENCE_EVENT = {
    "participant-join": "in_progress",
    "participant-leave": "completed",
}


def status_report(params: dict[str, str]) -> CallReport | None:
    """A progress callback, as a report. None when it names no leg this platform tracks."""
    external_id = (params.get("CallSid") or "").strip()
    if not external_id:
        return None

    event = (params.get("StatusCallbackEvent") or "").strip().lower()
    if event:
        status = _CONFERENCE_EVENT.get(event)
        if status is None:
            return None
        return CallReport(
            external_id=external_id,
            source="status",
            raw_status=event,
            status=status,
            duration_seconds=None,
            recording_url=None,
        )

    raw = params.get("CallStatus")
    return CallReport(
        external_id=external_id,
        source="status",
        raw_status=raw,
        status=normalise_status(raw),
        duration_seconds=_int_or_none(params.get("CallDuration")),
        recording_url=None,
    )


def recording_report(params: dict[str, str]) -> CallReport | None:
    """A recording callback, as a report.

    The recording's own duration is deliberately not written onto the call: a recording that
    started when the far end answered is shorter than the call, and reporting it as the call's
    length would quietly understate every conversation on the floor.
    """
    external_id = (params.get("CallSid") or "").strip()
    url = (params.get("RecordingUrl") or "").strip()
    if not external_id or not url:
        return None

    return CallReport(
        external_id=external_id,
        source="recording",
        raw_status=params.get("RecordingStatus"),
        status=None,
        duration_seconds=None,
        recording_url=url,
    )


def payload_hash(params: dict[str, str]) -> str:
    """A digest of what arrived, which is what makes a retry a no-op.

    **Over the parameters rather than the raw body**, because the carrier is entitled to reorder
    form fields between deliveries of the same event and a raw-body hash would call those two
    different events. Sorted, joined with separators that cannot appear in a key.
    """
    canonical = "\n".join(f"{key}={params[key]}" for key in sorted(params))
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


# ---------------------------------------------------------------------------
# What the carrier should do, in its own dialect
# ---------------------------------------------------------------------------


def conference_twiml(
    *,
    name: str,
    start_on_enter: bool,
    end_on_exit: bool,
    caller_id: str | None = None,
    status_callback: str | None = None,
) -> str:
    """Put whoever is calling this URL into a named room.

    **This is the conference-call design in eleven lines of XML.** Both legs of every call join a conference rather
    than dialling each other, which is what makes hold, transfer, merge and supervision
    operations on a participant instead of four features nobody can add later.

    `start_on_enter` is false for the customer and true for the agent, so a customer who answers
    first hears hold music rather than silence until somebody arrives. `end_on_exit` is true for
    the agent alone: when the person who made the call hangs up, the room closes.
    """
    attributes = [
        f'startConferenceOnEnter="{"true" if start_on_enter else "false"}"',
        f'endConferenceOnExit="{"true" if end_on_exit else "false"}"',
    ]
    if status_callback:
        # Who joins and who leaves is how the platform learns a call is over: a leg ending says
        # nothing about the room, but the last person leaving does.
        attributes += [
            f'statusCallback="{escape(status_callback, {chr(34): "&quot;"})}"',
            'statusCallbackEvent="join leave"',
            'statusCallbackMethod="POST"',
        ]
    dial_attributes = f' callerId="{escape(caller_id, {chr(34): "&quot;"})}"' if caller_id else ""

    return (
        '<?xml version="1.0" encoding="UTF-8"?>'
        "<Response>"
        f"<Dial{dial_attributes}>"
        f'<Conference {" ".join(attributes)}>{escape(name)}</Conference>'
        "</Dial>"
        "</Response>"
    )


def say_and_hang_up(message: str) -> str:
    """The answer for an inbound call this platform cannot place anywhere.

    **A sentence rather than a dropped line**, because a customer ringing a number that is not
    yet configured has done nothing wrong and silence tells them nothing. The words are an
    argument for finishing the configuration, not a greeting the platform is inventing on a
    business's behalf -- which is why the caller supplies them.
    """
    return (
        '<?xml version="1.0" encoding="UTF-8"?>'
        f"<Response><Say>{escape(message)}</Say><Hangup/></Response>"
    )


def recording_download_url(url: str) -> str:
    """The audio itself, rather than the page about it.

    The carrier hands back an address with no extension, which serves a metadata document to
    anything expecting bytes. Kept here because knowing that is knowing something about one
    vendor, which is exactly what must not travel upward.
    """
    return f"{quote(url, safe=':/?&=')}.mp3"
