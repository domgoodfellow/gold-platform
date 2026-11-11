"""Placing and controlling one business's calls, inside that business's own calling account.

**Every request here signs in with the business's own key, never GildOps' parent credential.** The
key can act inside one calling account and nowhere else, so a call placed here cannot land in
another business's account whatever the arguments say -- the carrier itself is the boundary.

**The browser telephone's credential is signed by the same key**, and names the same account and
that account's own application. A browser signed in to one account and a customer rung into
another would be two rooms with one person in each.

No SDK, for the reason `voice.py` gives: each operation is one HTTPS call or one signed token.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import time
import uuid
from typing import Iterator
from urllib.parse import quote, urlsplit

import httpx

from app.providers.providers import UpstreamRefused

API = "https://api.twilio.com/2010-04-01"

_STATUS = {
    "queued": "ringing",
    "initiated": "ringing",
    "ringing": "ringing",
    "in-progress": "in_progress",
    "completed": "completed",
    "no-answer": "no_answer",
    "busy": "busy",
}


def _auth(credential: dict) -> tuple[str, str]:
    return credential["api_key_sid"], credential["api_key_secret"]


def _post(credential: dict, path: str, form: dict[str, str]) -> dict:
    try:
        response = httpx.post(f"{API}{path}", auth=_auth(credential), data=form, timeout=15.0)
    except httpx.HTTPError as failure:
        raise UpstreamRefused(f"Twilio could not be reached: {type(failure).__name__}") from failure
    if response.status_code >= 400:
        # The carrier's own words, never a paraphrase. Its error bodies carry no credential.
        raise UpstreamRefused(f"Twilio refused the request ({response.status_code}): {response.text[:300]}")
    return response.json()


def _participants(credential: dict, room: str) -> str:
    return f"/Accounts/{credential['account_sid']}/Conferences/{quote(room, safe='')}/Participants"


def add_to_room(credential: dict, *, room: str, from_number: str, to_number: str, report_to: str) -> dict:
    """Ring `to_number` from `from_number` into the room. Adding a participant creates the room."""
    body = _post(
        credential,
        f"{_participants(credential, room)}.json",
        {
            "From": from_number,
            "To": to_number,
            # The customer does not start the room and does not close it: they may answer before
            # the agent's browser has joined, and hearing hold music beats hearing the line die.
            "StartConferenceOnEnter": "false",
            "EndConferenceOnExit": "false",
            "StatusCallback": f"{report_to}/voice/status",
            "StatusCallbackEvent": "initiated ringing answered completed",
            "StatusCallbackMethod": "POST",
            # Who is in the room is the carrier's fact, reported as people join and leave.
            "ConferenceStatusCallback": f"{report_to}/voice/status",
            "ConferenceStatusCallbackEvent": "join leave",
            "ConferenceStatusCallbackMethod": "POST",
            # Asked for here rather than configured at the account, so a deployment cannot be
            # recording calls this code does not know are recorded.
            "Record": "true",
            "RecordingStatusCallback": f"{report_to}/voice/recording",
            "RecordingStatusCallbackMethod": "POST",
        },
    )
    if not isinstance(body.get("call_sid"), str):
        raise UpstreamRefused("Twilio accepted the call but returned no identifier for it.")
    raw = body.get("status") if isinstance(body.get("status"), str) else ""
    return {"external_id": body["call_sid"], "status": _STATUS.get(raw, "failed")}


def update_participant(
    credential: dict,
    *,
    room: str,
    external_id: str,
    hold: bool | None = None,
    muted: bool | None = None,
    status: str | None = None,
    ends_room_on_exit: bool | None = None,
) -> dict:
    """Change what one leg is doing in a room that exists. Only the fields named are sent."""
    form: dict[str, str] = {}
    if hold is not None:
        form["Hold"] = "true" if hold else "false"
    if muted is not None:
        form["Muted"] = "true" if muted else "false"
    if status is not None:
        form["Status"] = status
    if ends_room_on_exit is not None:
        form["EndConferenceOnExit"] = "true" if ends_room_on_exit else "false"
    _post(credential, f"{_participants(credential, room)}/{quote(external_id, safe='')}.json", form)
    return {}


def _segment(value: dict) -> str:
    raw = json.dumps(value, separators=(",", ":")).encode()
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode("ascii")


def browser_token(credential: dict, *, identity: str, ttl_seconds: int = 3600, now: int | None = None) -> str:
    """A short-lived credential letting one person's browser be a telephone in this account.

    Signed here rather than fetched: it is a token this server mints, naming exactly one member,
    one calling account and that account's one application.
    """
    issued = int(time.time()) if now is None else now
    header = _segment({"alg": "HS256", "typ": "JWT", "cty": "twilio-fpa;v=1"})
    payload = _segment(
        {
            "jti": f"{credential['api_key_sid']}-{uuid.uuid4()}",
            "iss": credential["api_key_sid"],
            "sub": credential["account_sid"],
            "iat": issued,
            "exp": issued + ttl_seconds,
            "grants": {
                "identity": identity,
                "voice": {
                    "outgoing": {"application_sid": credential["application_sid"]},
                    # So a number pointed at this account can ring the person as well as the
                    # other way round.
                    "incoming": {"allow": True},
                },
            },
        }
    )
    signature = hmac.new(
        credential["api_key_secret"].encode(), f"{header}.{payload}".encode(), hashlib.sha256
    ).digest()
    return f"{header}.{payload}.{base64.urlsafe_b64encode(signature).rstrip(b'=').decode('ascii')}"


class Recording:
    """One recording's audio, open. The caller reads `chunks` and then calls `close`."""

    def __init__(self, client: httpx.Client, response: httpx.Response) -> None:
        self._client = client
        self._response = response
        self.content_type = response.headers.get("content-type", "audio/mpeg")
        # Only when the bytes arrive exactly as the carrier counted them.
        self.length = None if response.headers.get("content-encoding") else response.headers.get("content-length")
        self.chunks: Iterator[bytes] = response.iter_bytes(65536)

    def close(self) -> None:
        self._response.close()
        self._client.close()


def open_recording(credential: dict, *, reference: str) -> Recording:
    """Open one recording's audio as a stream.

    The reference came from a signed callback, but it is fetched with credentials, so it is held
    to the carrier's own host **and to this business's own account** rather than trusted to be
    either. A reference naming another account is refused before any request is made.
    """
    url = urlsplit(reference)
    if url.scheme != "https" or url.hostname != "api.twilio.com":
        raise UpstreamRefused("A recording is only fetched from the carrier's own host.")
    if f"/Accounts/{credential['account_sid']}/" not in url.path:
        raise UpstreamRefused("That recording does not belong to this calling account.")

    client = httpx.Client(auth=_auth(credential), timeout=30.0, follow_redirects=True)
    try:
        response = client.send(client.build_request("GET", reference), stream=True)
    except httpx.HTTPError as failure:
        client.close()
        raise UpstreamRefused(f"Twilio could not be reached: {type(failure).__name__}") from failure
    if response.status_code >= 400:
        status = response.status_code
        response.close()
        client.close()
        raise UpstreamRefused(f"Twilio could not return that recording ({status}).")
    return Recording(client, response)
