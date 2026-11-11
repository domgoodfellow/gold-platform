"""Placing and controlling a business's calls for a signed-in person.

**Who may is decided under the person's own token, before any credential is read.** The asking
person's token answers `telephony_caller`: membership to hold a telephone, and `call.place` to
place or control a call -- the same capability every call command in the database already checks.
Only then does this read that one business's own calling credential under a machine role no
person can wear. What is returned is the operation's result, never the credential.

**The business is the boundary, twice.** The credential read is that business's own key, which can
act inside its own calling account and nowhere else; and a recording's reference must name that
same account before it is fetched. A person in one business cannot reach another's calls by
choosing arguments.

**Where the carrier reports to is this runtime's own address, never an argument.** A caller able
to choose it could have every later report about a call, recording address included, sent to a
server of their own.
"""

from __future__ import annotations

import re
from dataclasses import dataclass

import httpx

from app.core.config import ProviderOperationsSettings
from app.core.db import read_organization_telephony_credential
from app.errors import DomainError, NotFoundError, ValidationError
from app.providers.providers import UpstreamRefused
from app.providers.twilio import calls as carrier

_UUID = re.compile(r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$")
_E164 = re.compile(r"^\+[1-9][0-9]{7,14}$")


class CarrierRefusedError(DomainError):
    """The carrier refused, or could not be reached. Its own words."""

    status = 502
    code = "provider_refused"


class CallingUnavailableError(DomainError):
    """This business has no active calling account, so there is nothing to place a call with."""

    status = 409
    code = "calling_unavailable"


@dataclass(frozen=True)
class CallCommand:
    organization_id: str
    operation: str
    arguments: dict


def _rpc(settings: ProviderOperationsSettings, *, token: str, function: str, arguments: dict):
    response = httpx.post(
        f"{settings.supabase_url}/rest/v1/rpc/{function}",
        headers={
            "apikey": settings.supabase_publishable_key,
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
        },
        json=arguments,
        timeout=10.0,
    )
    if response.status_code >= 400:
        code = None
        if response.headers.get("content-type", "").startswith("application/json"):
            code = response.json().get("code")
        # 42501 is this schema's one refusal for "not yours, or not there"; nothing else is told apart.
        if code == "42501":
            raise NotFoundError("No such calling account.")
        raise DomainError("That could not be completed.")
    return response.json()


def _caller(settings: ProviderOperationsSettings, *, token: str, organization_id: str, places_calls: bool) -> str:
    membership = _rpc(
        settings,
        token=token,
        function="telephony_caller",
        arguments={"p_organization_id": organization_id, "p_places_calls": places_calls},
    )
    if not isinstance(membership, str) or not membership:
        raise NotFoundError("No such calling account.")
    return membership


def _credential(settings: ProviderOperationsSettings, organization_id: str) -> dict:
    credential = read_organization_telephony_credential(settings, organization_id=organization_id)
    if credential is None:
        raise CallingUnavailableError("This business has no active calling account.")
    return credential


def _text(arguments: dict, key: str, *, limit: int = 200) -> str:
    value = arguments.get(key)
    if not isinstance(value, str) or not value.strip() or len(value) > limit:
        raise ValidationError(f"Missing argument: {key}")
    return value.strip()


def _flag(arguments: dict, key: str) -> bool | None:
    value = arguments.get(key)
    if value is None:
        return None
    if not isinstance(value, bool):
        raise ValidationError(f"Invalid argument: {key}")
    return value


def _number(arguments: dict, key: str) -> str:
    value = _text(arguments, key, limit=20)
    if not _E164.match(value):
        raise ValidationError(f"Invalid argument: {key}")
    return value


def _organization(command_organization_id: str) -> str:
    if not _UUID.match(command_organization_id):
        raise ValidationError("An organization and an operation are both required.")
    return command_organization_id


def operate(settings: ProviderOperationsSettings, *, token: str, command: CallCommand, report_to: str) -> dict:
    """Run one call operation and return its result."""
    organization_id = _organization(command.organization_id)
    arguments = command.arguments

    if command.operation == "browser_token":
        membership = _caller(settings, token=token, organization_id=organization_id, places_calls=False)
        credential = _credential(settings, organization_id)
        return {"token": carrier.browser_token(credential, identity=membership)}

    if command.operation == "add_to_room":
        room = _text(arguments, "room")
        from_number = _number(arguments, "from")
        to_number = _number(arguments, "to")
        if not report_to.startswith("https://"):
            raise CallingUnavailableError("This deployment has no public address for the carrier to report to.")
        _caller(settings, token=token, organization_id=organization_id, places_calls=True)
        credential = _credential(settings, organization_id)
        try:
            return carrier.add_to_room(
                credential, room=room, from_number=from_number, to_number=to_number, report_to=report_to
            )
        except UpstreamRefused as failure:
            raise CarrierRefusedError(str(failure)) from failure

    if command.operation == "update_participant":
        room = _text(arguments, "room")
        external_id = _text(arguments, "external_id")
        status = arguments.get("status")
        if status is not None and status != "completed":
            raise ValidationError("Invalid argument: status")
        hold = _flag(arguments, "hold")
        muted = _flag(arguments, "muted")
        ends_room_on_exit = _flag(arguments, "ends_room_on_exit")
        _caller(settings, token=token, organization_id=organization_id, places_calls=True)
        credential = _credential(settings, organization_id)
        try:
            return carrier.update_participant(
                credential,
                room=room,
                external_id=external_id,
                hold=hold,
                muted=muted,
                status=status,
                ends_room_on_exit=ends_room_on_exit,
            )
        except UpstreamRefused as failure:
            raise CarrierRefusedError(str(failure)) from failure

    raise ValidationError("That operation is not available.")


def open_recording(settings: ProviderOperationsSettings, *, token: str, organization_id: str, call_id: str):
    """One call's audio, open as a stream, for a person the database says may play it.

    `call_recording_reference` is the check: it answers only for a person who may play recordings
    in this business, and it is asked under their own token.
    """
    organization_id = _organization(organization_id)
    if not _UUID.match(call_id or ""):
        raise ValidationError("Missing argument: call_id")

    reference = _rpc(
        settings,
        token=token,
        function="call_recording_reference",
        arguments={"p_organization_id": organization_id, "p_call_id": call_id},
    )
    if not isinstance(reference, str) or not reference:
        raise NotFoundError("That call has no recording.")

    credential = _credential(settings, organization_id)
    try:
        return carrier.open_recording(credential, reference=reference)
    except UpstreamRefused as failure:
        raise CarrierRefusedError(str(failure)) from failure
