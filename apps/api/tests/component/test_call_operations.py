"""A signed-in person placing and controlling their business's calls: who may, and what may leave.

What Postgres decides -- that `read_organization_telephony_credential` and
`telephony_signing_secret` are executable by no signed-in role, and what `telephony_caller` answers
for a member, a non-member and a role without `call.place` -- is proven against a real database by
`apps/web/tests/integration/database/provider-bindings.test.ts`. What belongs here is the half
that is a fact about this process: the person is checked under their own token before any
credential is read, a refused person never reaches the carrier, every carrier request signs in
with the business's own key inside the business's own account, the carrier is told to report to
this runtime and nowhere a caller chose, and no response carries a secret.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import json

import pytest

from app.core.config import ProviderOperationsSettings
from app.errors import NotFoundError, ValidationError
from app.providers.providers import UpstreamRefused
from app.providers.twilio import calls as twilio
from app.services.communications import call_operations as ops
from app.services.communications.call_operations import (
    CallCommand,
    CallingUnavailableError,
    CarrierRefusedError,
    open_recording,
    operate,
)

SETTINGS = ProviderOperationsSettings(
    supabase_url="http://db.test", supabase_publishable_key="anon", supabase_jwt_secret="signing"
)
ORGANIZATION = "11111111-1111-4111-8111-111111111111"
CALL = "22222222-2222-4222-8222-222222222222"
MEMBERSHIP = "33333333-3333-4333-8333-333333333333"
SECRET = "the-business-key-secret"
CREDENTIAL = {
    "account_sid": "AC" + "a" * 32,
    "api_key_sid": "SK" + "b" * 32,
    "api_key_secret": SECRET,
    "application_sid": "AP" + "c" * 32,
}
REPORT_TO = "https://api.gold.example"
RECORDING = f"https://api.twilio.com/2010-04-01/Accounts/{CREDENTIAL['account_sid']}/Recordings/RE1.mp3"


class _Response:
    def __init__(self, status: int, body, headers=None) -> None:
        self.status_code = status
        self._body = body
        self.text = json.dumps(body)
        self.headers = headers or {"content-type": "application/json"}

    def json(self):
        return self._body


class World:
    """The database's answers and the carrier's, and a record of what each was asked."""

    def __init__(self, monkeypatch, *, member=True, credential=CREDENTIAL, reference=RECORDING, carrier=None):
        self.rpc: list[tuple[str, str, dict]] = []
        self.reads: list[str] = []
        self.carrier: list[dict] = []

        def database(url, **kwargs):
            function = url.rsplit("/", 1)[-1]
            self.rpc.append((function, kwargs["headers"]["Authorization"], kwargs["json"]))
            if not member:
                return _Response(403, {"code": "42501", "message": "insufficient privilege"})
            if function == "telephony_caller":
                return _Response(200, MEMBERSHIP)
            if function == "call_recording_reference":
                return _Response(200, reference)
            pytest.fail(f"unexpected database call: {function}")

        def read(settings, *, organization_id):
            self.reads.append(organization_id)
            return credential

        def upstream(url, **kwargs):
            self.carrier.append({"url": url, **kwargs})
            if carrier is not None:
                return carrier(url, **kwargs)
            return _Response(201, {"call_sid": "CA1", "status": "queued"})

        # `httpx` is one module, so one fake `post` answers both the database and the carrier.
        def post(url, **kwargs):
            return database(url, **kwargs) if url.startswith("http://db.test") else upstream(url, **kwargs)

        monkeypatch.setattr(ops.httpx, "post", post)
        monkeypatch.setattr(ops, "read_organization_telephony_credential", read)


def run(operation: str, arguments: dict | None = None, *, report_to: str = REPORT_TO, organization: str = ORGANIZATION):
    return operate(
        SETTINGS,
        token="the-persons-own-token",
        command=CallCommand(organization_id=organization, operation=operation, arguments=arguments or {}),
        report_to=report_to,
    )


ADD = {"room": "gold-room", "from": "+14165550100", "to": "+14165550142"}


class TestWhoMayAsk:
    @pytest.mark.parametrize(
        ("operation", "arguments"),
        [
            ("browser_token", {}),
            ("add_to_room", ADD),
            ("update_participant", {"room": "gold-room", "external_id": "CA1", "hold": True}),
        ],
    )
    def test_a_refused_person_reads_no_credential_and_reaches_no_carrier(self, monkeypatch, operation, arguments):
        world = World(monkeypatch, member=False)

        with pytest.raises(NotFoundError):
            run(operation, arguments)

        assert world.reads == []
        assert world.carrier == []

    def test_the_question_is_asked_under_the_persons_own_token(self, monkeypatch):
        world = World(monkeypatch)

        run("add_to_room", ADD)

        function, authorization, arguments = world.rpc[0]
        assert function == "telephony_caller"
        assert authorization == "Bearer the-persons-own-token"
        assert arguments == {"p_organization_id": ORGANIZATION, "p_places_calls": True}

    def test_holding_a_telephone_takes_membership_and_not_the_right_to_dial(self, monkeypatch):
        world = World(monkeypatch)

        run("browser_token")

        assert world.rpc[0][2] == {"p_organization_id": ORGANIZATION, "p_places_calls": False}

    def test_a_business_with_no_calling_account_is_told_so_and_no_carrier_is_asked(self, monkeypatch):
        world = World(monkeypatch, credential=None)

        with pytest.raises(CallingUnavailableError):
            run("add_to_room", ADD)

        assert world.carrier == []

    @pytest.mark.parametrize(
        ("operation", "arguments", "organization"),
        [
            ("add_to_room", ADD, "not-an-organization"),
            ("add_to_room", {**ADD, "to": "4165550142"}, ORGANIZATION),
            ("add_to_room", {**ADD, "from": ""}, ORGANIZATION),
            ("add_to_room", {"from": ADD["from"], "to": ADD["to"]}, ORGANIZATION),
            ("update_participant", {"room": "gold-room", "external_id": "CA1", "status": "in-progress"}, ORGANIZATION),
            ("update_participant", {"room": "gold-room", "external_id": "CA1", "hold": "yes"}, ORGANIZATION),
            ("delete_everything", {}, ORGANIZATION),
        ],
    )
    def test_a_malformed_request_is_refused_before_anything_is_asked(self, monkeypatch, operation, arguments, organization):
        world = World(monkeypatch)

        with pytest.raises(ValidationError):
            run(operation, arguments, organization=organization)

        assert world.reads == []
        assert world.carrier == []


class TestWhatReachesTheCarrier:
    def test_a_call_is_placed_inside_the_business_own_account_with_its_own_key(self, monkeypatch):
        world = World(monkeypatch)

        result = run("add_to_room", ADD)

        assert result == {"external_id": "CA1", "status": "ringing"}
        (request,) = world.carrier
        assert request["url"] == (
            f"https://api.twilio.com/2010-04-01/Accounts/{CREDENTIAL['account_sid']}/Conferences/gold-room/Participants.json"
        )
        assert request["auth"] == (CREDENTIAL["api_key_sid"], SECRET)
        assert request["data"]["From"] == ADD["from"] and request["data"]["To"] == ADD["to"]
        assert request["data"]["Record"] == "true"

    def test_the_carrier_reports_to_this_runtime_and_never_to_an_address_in_the_request(self, monkeypatch):
        world = World(monkeypatch)

        run("add_to_room", {**ADD, "report_to": "https://attacker.test", "reportTo": "https://attacker.test"})

        data = world.carrier[0]["data"]
        assert data["StatusCallback"] == f"{REPORT_TO}/voice/status"
        assert data["ConferenceStatusCallback"] == f"{REPORT_TO}/voice/status"
        assert data["RecordingStatusCallback"] == f"{REPORT_TO}/voice/recording"
        assert "attacker" not in json.dumps(data)

    def test_no_call_is_placed_when_this_runtime_has_no_address_the_carrier_can_reach(self, monkeypatch):
        world = World(monkeypatch)

        with pytest.raises(CallingUnavailableError):
            run("add_to_room", ADD, report_to="http://127.0.0.1:8000")

        assert world.carrier == []

    def test_a_leg_is_changed_by_only_the_fields_named(self, monkeypatch):
        world = World(monkeypatch, carrier=lambda url, **kwargs: _Response(200, {}))

        run("update_participant", {"room": "gold-room", "external_id": "CA9", "hold": True})
        run("update_participant", {"room": "gold-room", "external_id": "CA9", "status": "completed", "ends_room_on_exit": False})

        first, second = world.carrier
        assert first["url"].endswith(f"/Accounts/{CREDENTIAL['account_sid']}/Conferences/gold-room/Participants/CA9.json")
        assert first["data"] == {"Hold": "true"}
        assert second["data"] == {"Status": "completed", "EndConferenceOnExit": "false"}

    def test_a_room_name_cannot_walk_out_of_its_path(self, monkeypatch):
        world = World(monkeypatch)

        run("add_to_room", {**ADD, "room": "../../Accounts/ACother/Calls"})

        assert f"/Accounts/{CREDENTIAL['account_sid']}/Conferences/..%2F..%2FAccounts%2FACother%2FCalls/" in world.carrier[0]["url"]

    def test_the_carriers_refusal_is_its_own_words_and_carries_no_secret(self, monkeypatch):
        World(monkeypatch, carrier=lambda url, **kwargs: _Response(400, {"message": "The caller ID is not yours."}))

        with pytest.raises(CarrierRefusedError) as refused:
            run("add_to_room", ADD)

        assert "The caller ID is not yours." in str(refused.value)
        assert SECRET not in str(refused.value)


class TestTheBrowserTelephone:
    def _claims(self, token: str) -> dict:
        payload = token.split(".")[1]
        return json.loads(base64.urlsafe_b64decode(payload + "=" * (-len(payload) % 4)))

    def test_it_is_a_three_part_token_in_the_carriers_access_token_format(self, monkeypatch):
        World(monkeypatch)

        token = run("browser_token")["token"]
        header = token.split(".")[0]

        assert len(token.split(".")) == 3
        assert json.loads(base64.urlsafe_b64decode(header + "=" * (-len(header) % 4))) == {
            "alg": "HS256",
            "typ": "JWT",
            "cty": "twilio-fpa;v=1",
        }

    def test_it_names_the_asking_member_this_business_account_and_its_application_and_nothing_wider(self, monkeypatch):
        World(monkeypatch)

        claims = self._claims(run("browser_token", {"identity": "somebody-else"})["token"])

        # Who the person is comes from the database's answer, never from the request.
        assert claims["grants"]["identity"] == MEMBERSHIP
        assert claims["iss"] == CREDENTIAL["api_key_sid"]
        assert claims["sub"] == CREDENTIAL["account_sid"]
        assert claims["grants"]["voice"]["outgoing"] == {"application_sid": CREDENTIAL["application_sid"]}
        assert sorted(claims["grants"]) == ["identity", "voice"]
        assert claims["exp"] - claims["iat"] == 3600

    def test_it_is_signed_with_the_business_key_and_carries_no_secret(self, monkeypatch):
        World(monkeypatch)

        first = run("browser_token")["token"]
        second = run("browser_token")["token"]
        header, payload, signature = first.split(".")
        expected = base64.urlsafe_b64encode(
            hmac.new(SECRET.encode(), f"{header}.{payload}".encode(), hashlib.sha256).digest()
        ).rstrip(b"=").decode()

        assert signature == expected
        readable = base64.urlsafe_b64decode(header + "==") + base64.urlsafe_b64decode(payload + "=" * (-len(payload) % 4))
        assert SECRET.encode() not in readable and SECRET not in first
        assert self._claims(first)["jti"] != self._claims(second)["jti"]

    def test_an_expiry_can_be_shortened(self):
        token = twilio.browser_token(CREDENTIAL, identity=MEMBERSHIP, ttl_seconds=60, now=1000)

        assert self._claims(token)["exp"] == 1060


class TestARecording:
    def _open(self, monkeypatch, **world):
        opened: list[str] = []

        class Client:
            def __init__(self, **kwargs):
                opened.append(kwargs["auth"])

            def build_request(self, method, url):
                opened.append(url)
                return url

            def send(self, request, stream):
                return type("R", (), {"status_code": 200, "headers": {"content-type": "audio/mpeg", "content-length": "5"}, "iter_bytes": lambda self, size: iter([b"audio"]), "close": lambda self: None})()

            def close(self):
                pass

        monkeypatch.setattr(twilio.httpx, "Client", Client)
        return World(monkeypatch, **world), opened

    def test_it_is_played_only_for_a_person_the_database_says_may(self, monkeypatch):
        world, opened = self._open(monkeypatch, member=False)

        with pytest.raises(NotFoundError):
            open_recording(SETTINGS, token="the-persons-own-token", organization_id=ORGANIZATION, call_id=CALL)

        assert world.reads == [] and opened == []

    def test_it_is_fetched_with_the_business_own_key(self, monkeypatch):
        world, opened = self._open(monkeypatch)

        recording = open_recording(SETTINGS, token="the-persons-own-token", organization_id=ORGANIZATION, call_id=CALL)

        assert world.rpc[0][0] == "call_recording_reference"
        assert world.rpc[0][1] == "Bearer the-persons-own-token"
        assert opened == [(CREDENTIAL["api_key_sid"], SECRET), RECORDING]
        assert (recording.content_type, recording.length, b"".join(recording.chunks)) == ("audio/mpeg", "5", b"audio")

    def test_a_call_with_no_recording_is_not_found(self, monkeypatch):
        _, opened = self._open(monkeypatch, reference=None)

        with pytest.raises(NotFoundError):
            open_recording(SETTINGS, token="t", organization_id=ORGANIZATION, call_id=CALL)

        assert opened == []

    @pytest.mark.parametrize(
        "reference",
        [
            "https://attacker.test/2010-04-01/Accounts/" + CREDENTIAL["account_sid"] + "/Recordings/RE1.mp3",
            "http://api.twilio.com/2010-04-01/Accounts/" + CREDENTIAL["account_sid"] + "/Recordings/RE1.mp3",
            "https://api.twilio.com/2010-04-01/Accounts/AC" + "9" * 32 + "/Recordings/RE1.mp3",
        ],
    )
    def test_a_reference_off_the_carriers_host_or_in_another_account_is_never_fetched(self, monkeypatch, reference):
        _, opened = self._open(monkeypatch, reference=reference)

        with pytest.raises(CarrierRefusedError):
            open_recording(SETTINGS, token="t", organization_id=ORGANIZATION, call_id=CALL)

        assert opened == []


def test_a_subaccounts_signing_secret_is_only_read_beneath_its_own_parent(monkeypatch):
    from app.providers.twilio import accounts

    parent = {"external_account_id": "AC" + "a" * 32, "credential_kind": "auth_token", "secret": "parent"}
    child = "AC" + "d" * 32
    monkeypatch.setattr(accounts.httpx, "get", lambda url, **kwargs: _Response(200, {"owner_account_sid": parent["external_account_id"], "auth_token": "child-secret"}))
    assert accounts.subaccount_signing_secret(parent, subaccount_sid=child) == {"signing_secret": "child-secret"}

    monkeypatch.setattr(accounts.httpx, "get", lambda url, **kwargs: _Response(200, {"owner_account_sid": "AC" + "9" * 32, "auth_token": "x"}))
    with pytest.raises(UpstreamRefused):
        accounts.subaccount_signing_secret(parent, subaccount_sid=child)
