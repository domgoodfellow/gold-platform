"""A business's sending domain: who may act, what is recorded, and what may leave.

What Postgres decides -- that `record_email_domain_provisioning` is executable by no signed-in
role, that only the tenant may name or release a domain, that one business never reaches another's
row -- is proven against a real database by
`apps/web/tests/integration/database/email-sending-domains.test.ts`. What belongs here is the half
that is a fact about this process: authorization is proved before the credential is read, every
provider outcome is recorded on the row before it is returned, a missing provider account is never
reported as a problem with the domain, DNS is never written except when asked, publishing DNS is
never recorded as verification, and nothing provider-shaped reaches the response.

The provider boundary is `app.providers.resend.domains`; its operations are replaced here, the way
`test_web_delivery_domains.py` replaces its own.
"""

from __future__ import annotations

import json

import pytest

from app.core.config import IntegrationSettings, ProviderOperationsSettings
from app.errors import NotFoundError, ValidationError
from app.providers.providers import CredentialRejected, HostnameUnavailable, MalformedAnswer, UpstreamRefused
from app.providers.resend import domains as resend
from app.services.dns.operations import AutomationPreview, EnsureResult, RecordOutcome
from app.services.email_provisioning import operations as ops
from app.services.email_provisioning.operations import (
    DomainRejectedError,
    ProviderRefusedError,
    ProviderUnavailableError,
    apply_dns,
    check_domain,
    provision_domain,
    release_domain,
    run_email_domain_command,
)

SETTINGS = ProviderOperationsSettings(
    supabase_url="http://db.test", supabase_publishable_key="anon", supabase_jwt_secret="signing"
)
ORG = "11111111-1111-4111-8111-111111111111"
RESOURCE = "22222222-2222-4222-8222-222222222222"
BINDING = "33333333-3333-4333-8333-333333333333"
ACCOUNT = "44444444-4444-4444-8444-444444444444"
PROVIDER_DOMAIN = "4dd369bc-aa82-4ff3-97de-514ae3000ee0"
SECRET = "re_the_key"
CREDENTIAL = {"provider_key": "resend", "credential_kind": "api_key", "secret": SECRET}

# `dns_automation` is built from a read-only preview (`app.services.dns.preview_automation`,
# mocked here; its own real resolution is `test_dns_operations.py`'s subject). A deployment with
# no OAuth connectors configured passes none of this, and the review step is simply not offered.
DNS_SETTINGS = IntegrationSettings(
    supabase_url="http://db.test", supabase_publishable_key="anon", supabase_jwt_secret="signing",
    state_secret="state-secret", redirect_uri="https://app.test/connect/oauth/callback",
)


def record(status: str = "pending", **over) -> resend.RequiredRecord:
    return resend.RequiredRecord(
        type=over.get("type", "TXT"),
        name=over.get("name", "resend._domainkey.acme.ca"),
        value=over.get("value", "p=MIG"),
        purpose=over.get("purpose", "DKIM"),
        status=status,
        priority=over.get("priority"),
    )


def standing(state: str = "pending", provider_status: str = "pending", records=None) -> resend.EmailDomainStatus:
    return resend.EmailDomainStatus(
        external_id=PROVIDER_DOMAIN,
        domain="acme.ca",
        state=state,
        provider_status=provider_status,
        records=[record()] if records is None else records,
    )


VERIFIED = standing("active", "verified", [record("verified")])


class Response:
    def __init__(self, status: int, body) -> None:
        self.status_code = status
        self._body = body
        self.text = json.dumps(body)

    def json(self):
        return self._body


class World:
    """One fake database (as the caller, and as the machine role) and one fake provider."""

    def __init__(self, monkeypatch, *, manage=True, created=False, account=ACCOUNT, credential=CREDENTIAL, status="pending") -> None:
        self.manage = manage
        self.row = {
            "id": RESOURCE,
            "binding_id": BINDING,
            "resource_type": "resend_domain",
            "external_id": "acme.ca",
            "status": status,
            "config": {"provider_domain_id": PROVIDER_DOMAIN} if created else {},
        }
        self.visible = True
        self.provider_key = "resend"
        self.rest: list[tuple[str, str]] = []
        self.released: list[dict] = []
        self.account = account
        self.credential = credential
        self.reads: list[str] = []
        self.recorded: list[dict] = []
        self.provider: list[tuple[str, str]] = []
        self.ensured: list[dict] = []

        monkeypatch.setattr(ops.httpx, "request", self._request)
        monkeypatch.setattr(ops.db, "email_domain_provider_account", lambda s, **kw: self.account)
        monkeypatch.setattr(ops.db, "read_provider_account_credential", self._read)
        monkeypatch.setattr(ops.db, "record_email_domain_provisioning", lambda s, **kw: self.recorded.append(kw))

    def _request(self, method, url, **kwargs):
        path = url.removeprefix("http://db.test/rest/v1/")
        self.rest.append((method, path))
        assert kwargs["headers"]["Authorization"] == "Bearer caller-token", "the caller's own token, never a machine one"
        if path == "rpc/can_manage_email_domains":
            return Response(200, self.manage)
        if path == "organization_provider_resources":
            return Response(200, [self.row] if self.visible else [])
        if path == "organization_provider_bindings":
            return Response(200, [{"provider_key": self.provider_key}])
        if path == "rpc/release_organization_email_domain":
            self.released.append(kwargs["json"])
            return Response(204, None)
        raise AssertionError(f"unexpected request {method} {path}")

    def _read(self, settings, *, account_id):
        self.reads.append(account_id)
        return self.credential

    def answers(self, monkeypatch, *, ensure=None, get=None, verify=None, remove=None) -> None:
        def wrap(name, outcome):
            def run(credential, target, **kwargs):
                assert credential["secret"] == SECRET
                self.provider.append((name, target))
                value = outcome.pop(0) if isinstance(outcome, list) else outcome
                if isinstance(value, Exception):
                    raise value
                return value

            return run

        for name, outcome in (("ensure", ensure), ("get", get), ("verify", verify), ("remove", remove)):
            if outcome is not None:
                monkeypatch.setattr(resend, name, wrap(name, outcome))

    def automation(self, monkeypatch, *, available=False, applied=True, outcomes=()) -> None:
        monkeypatch.setattr(
            ops, "preview_automation", lambda s, **kw: AutomationPreview(available=available, connection_id="c1" if available else None, zone_name="acme.ca" if available else None)
        )

        def ensure(settings, *, token, organization_id, hostname, records):
            self.ensured.append({"hostname": hostname, "records": records})
            return EnsureResult(applied=applied, connection_id="c1", zone_name="acme.ca", results=list(outcomes))

        monkeypatch.setattr(ops, "ensure_required_records", ensure)


def provision(**kwargs) -> dict:
    return provision_domain(SETTINGS, token="caller-token", organization_id=ORG, resource_id=RESOURCE, **kwargs)


# --- who may act ---------------------------------------------------------------------------------


@pytest.mark.parametrize("command", [provision_domain, check_domain, apply_dns, release_domain])
def test_a_caller_who_may_not_manage_email_never_causes_the_credential_to_be_read(monkeypatch, command) -> None:
    world = World(monkeypatch, manage=False)

    with pytest.raises(NotFoundError):
        command(SETTINGS, token="caller-token", organization_id=ORG, resource_id=RESOURCE)

    assert world.reads == [] and world.provider == [] and world.recorded == [] and world.released == []


def test_another_business_s_sending_domain_is_indistinguishable_from_no_domain(monkeypatch) -> None:
    world = World(monkeypatch)
    world.visible = False

    with pytest.raises(NotFoundError):
        provision()

    assert world.reads == []


def test_a_resource_that_is_not_a_sending_domain_is_not_reachable_through_this_command(monkeypatch) -> None:
    # A phone number's id passed here must not become a command about a phone number.
    world = World(monkeypatch)
    world.row["resource_type"] = "twilio_phone_number"

    with pytest.raises(NotFoundError):
        provision()

    assert world.reads == []


def test_a_binding_to_a_provider_with_no_sending_domains_is_refused(monkeypatch) -> None:
    world = World(monkeypatch)
    world.provider_key = "twilio"

    with pytest.raises(NotFoundError):
        provision()

    assert world.reads == []


def test_an_unknown_command_is_refused_before_anything_is_read(monkeypatch) -> None:
    world = World(monkeypatch)

    with pytest.raises(ValidationError):
        run_email_domain_command(SETTINGS, token="caller-token", command="transfer", organization_id=ORG, resource_id=RESOURCE)

    assert world.rest == []


@pytest.mark.parametrize(("organization_id", "resource_id"), [("", RESOURCE), (ORG, "")])
def test_a_missing_argument_is_refused_before_anything_is_read(monkeypatch, organization_id, resource_id) -> None:
    world = World(monkeypatch)

    with pytest.raises(ValidationError):
        provision_domain(SETTINGS, token="caller-token", organization_id=organization_id, resource_id=resource_id)

    assert world.rest == []


# --- provisioning --------------------------------------------------------------------------------


def test_provisioning_records_the_provider_s_own_id_and_the_records_it_asked_for(monkeypatch) -> None:
    world = World(monkeypatch)
    world.answers(monkeypatch, ensure=standing())
    world.automation(monkeypatch)

    answer = provision()

    assert world.recorded == [
        {
            "organization_id": ORG,
            "resource_id": RESOURCE,
            "status": "pending",
            "provider_domain_id": PROVIDER_DOMAIN,
            "provider_status": "pending",
            "dns_records": [{"type": "TXT", "name": "resend._domainkey.acme.ca", "value": "p=MIG", "purpose": "DKIM", "status": "pending"}],
            "error_code": None,
            "error_message": None,
        }
    ]
    assert answer["state"] == "pending" and answer["records_verified"] == 0


def test_a_retry_resumes_from_the_id_already_recorded_rather_than_creating_a_second_domain(monkeypatch) -> None:
    world = World(monkeypatch, created=True)
    world.answers(monkeypatch, ensure=standing())
    world.automation(monkeypatch)

    provision()

    assert world.provider == [("ensure", "acme.ca")]
    # The id it already held is what `ensure` was asked to resume from.
    assert world.recorded[0]["provider_domain_id"] == PROVIDER_DOMAIN


def test_a_domain_the_provider_already_says_is_verified_is_recorded_active_straight_away(monkeypatch) -> None:
    world = World(monkeypatch)
    world.answers(monkeypatch, ensure=VERIFIED)
    world.automation(monkeypatch)

    answer = provision()

    assert world.recorded[0]["status"] == "active"
    assert answer["state"] == "active" and answer["records_verified"] == 1


# --- a provider account nobody configured, and one whose credential is refused -------------------


@pytest.mark.parametrize("world_args", [{"account": None}, {"credential": None}, {"credential": {"provider_key": "resend"}}])
def test_no_usable_provider_account_is_its_own_state_and_never_a_problem_with_the_domain(monkeypatch, world_args) -> None:
    world = World(monkeypatch, **world_args)

    with pytest.raises(ProviderUnavailableError):
        provision()

    assert world.provider == []
    assert world.recorded[0]["status"] == "pending", "the domain is not failed: nothing about the name went wrong"
    assert world.recorded[0]["error_code"] == "provider_unavailable"


def test_a_credential_the_provider_rejects_reads_as_unavailable_and_never_as_a_rejected_domain(monkeypatch) -> None:
    world = World(monkeypatch)
    world.answers(monkeypatch, ensure=CredentialRejected("Resend refused GildOps' credential (401): nope"))

    with pytest.raises(ProviderUnavailableError) as refusal:
        provision()

    assert world.recorded[0]["error_code"] == "provider_unavailable"
    assert world.recorded[0]["status"] == "pending"
    # GildOps' own account trouble is never described to a business in the provider's words.
    assert "credential" not in str(refusal.value)


# --- the provider's refusals ----------------------------------------------------------------------


def test_a_domain_the_provider_will_not_take_fails_the_row_because_no_retry_changes_it(monkeypatch) -> None:
    world = World(monkeypatch)
    world.answers(monkeypatch, ensure=HostnameUnavailable("Resend will not take this domain: reserved"))

    with pytest.raises(DomainRejectedError):
        provision()

    assert world.recorded[0]["status"] == "failed" and world.recorded[0]["error_code"] == "domain_rejected"


@pytest.mark.parametrize(
    ("failure", "code"),
    [(UpstreamRefused("Resend could not be reached: ConnectError"), "provider_refused"), (MalformedAnswer("not JSON"), "malformed_response")],
)
def test_a_refused_or_unreadable_answer_leaves_the_domain_where_it_was(monkeypatch, failure, code) -> None:
    world = World(monkeypatch, status="active")
    world.answers(monkeypatch, ensure=failure)

    with pytest.raises(ProviderRefusedError):
        provision()

    assert world.recorded[0]["status"] == "active", "a failed attempt is not an answer about the domain"
    assert world.recorded[0]["error_code"] == code


# --- checking ------------------------------------------------------------------------------------


def test_checking_a_domain_the_provider_has_never_been_asked_about_provisions_it(monkeypatch) -> None:
    world = World(monkeypatch)
    world.answers(monkeypatch, ensure=standing())
    world.automation(monkeypatch)

    check_domain(SETTINGS, token="caller-token", organization_id=ORG, resource_id=RESOURCE)

    assert world.provider == [("ensure", "acme.ca")]


def test_checking_asks_the_provider_to_verify_and_then_reads_where_it_actually_stands(monkeypatch) -> None:
    world = World(monkeypatch, created=True)
    world.answers(monkeypatch, get=[standing(), VERIFIED], verify=None)
    monkeypatch.setattr(resend, "verify", lambda credential, external_id: world.provider.append(("verify", external_id)))
    world.automation(monkeypatch)

    answer = check_domain(SETTINGS, token="caller-token", organization_id=ORG, resource_id=RESOURCE)

    assert [name for name, _ in world.provider] == ["get", "verify", "get"]
    assert answer["state"] == "active" and world.recorded[0]["status"] == "active"


def test_a_domain_already_verified_is_read_rather_than_asked_to_verify_again(monkeypatch) -> None:
    world = World(monkeypatch, created=True)
    world.answers(monkeypatch, get=VERIFIED)
    world.automation(monkeypatch)

    check_domain(SETTINGS, token="caller-token", organization_id=ORG, resource_id=RESOURCE)

    assert [name for name, _ in world.provider] == ["get"], "nothing knocks a verified domain back to checking"


def test_a_domain_deleted_at_the_provider_is_created_again_rather_than_reported_as_lost(monkeypatch) -> None:
    world = World(monkeypatch, created=True)
    world.answers(monkeypatch, get=None, ensure=standing())
    monkeypatch.setattr(resend, "get", lambda credential, external_id: world.provider.append(("get", external_id)) or None)
    world.automation(monkeypatch)

    check_domain(SETTINGS, token="caller-token", organization_id=ORG, resource_id=RESOURCE)

    assert [name for name, _ in world.provider] == ["get", "ensure"]


def test_a_verification_that_did_not_succeed_does_not_mark_the_domain_active(monkeypatch) -> None:
    world = World(monkeypatch, created=True)
    monkeypatch.setattr(resend, "verify", lambda credential, external_id: None)
    world.answers(monkeypatch, get=[standing(), standing("pending", "pending")])
    world.automation(monkeypatch)

    answer = check_domain(SETTINGS, token="caller-token", organization_id=ORG, resource_id=RESOURCE)

    assert world.recorded[0]["status"] == "pending" and answer["state"] == "pending"


# --- DNS: never without being asked, and never mistaken for verification --------------------------


@pytest.mark.parametrize("command", [provision_domain, check_domain])
def test_nothing_writes_dns_except_the_action_that_exists_to_write_dns(monkeypatch, command) -> None:
    world = World(monkeypatch, created=True)
    world.answers(monkeypatch, ensure=standing(), get=standing(), verify=None)
    monkeypatch.setattr(resend, "verify", lambda credential, external_id: None)
    world.automation(monkeypatch, available=True)

    command(SETTINGS, token="caller-token", organization_id=ORG, resource_id=RESOURCE, dns_settings=DNS_SETTINGS)

    assert world.ensured == []


def test_the_review_step_is_offered_only_while_records_are_still_outstanding(monkeypatch) -> None:
    world = World(monkeypatch)
    world.answers(monkeypatch, ensure=standing())
    world.automation(monkeypatch, available=True)

    assert provision(dns_settings=DNS_SETTINGS)["dns_automation"] == {"available": True, "connectionId": "c1", "zoneName": "acme.ca"}

    verified = World(monkeypatch)
    verified.answers(monkeypatch, ensure=VERIFIED)
    verified.automation(monkeypatch, available=True)

    assert provision(dns_settings=DNS_SETTINGS)["dns_automation"]["available"] is False


def test_a_deployment_with_no_connectors_configured_offers_no_review_and_previews_nothing(monkeypatch) -> None:
    world = World(monkeypatch)
    world.answers(monkeypatch, ensure=standing())
    monkeypatch.setattr(ops, "preview_automation", lambda *a, **kw: pytest.fail("not asked"))

    answer = provision()

    assert answer["dns_automation"] == {"available": False, "connectionId": None, "zoneName": None}


def test_applying_publishes_only_the_outstanding_records_then_asks_the_provider_again(monkeypatch) -> None:
    world = World(monkeypatch, created=True)
    done, outstanding = record("verified", name="send.acme.ca", purpose="SPF"), record()
    monkeypatch.setattr(resend, "verify", lambda credential, external_id: world.provider.append(("verify", external_id)))
    world.answers(monkeypatch, get=[standing(records=[done, outstanding]), VERIFIED])
    world.automation(monkeypatch, available=True)

    answer = apply_dns(SETTINGS, token="caller-token", organization_id=ORG, resource_id=RESOURCE, dns_settings=DNS_SETTINGS)

    assert [r["name"] for r in world.ensured[0]["records"]] == ["resend._domainkey.acme.ca"]
    assert [name for name, _ in world.provider] == ["get", "verify", "get"]
    assert answer["state"] == "active"


def test_publishing_dns_is_not_recorded_as_verification(monkeypatch) -> None:
    # Every record written, and the provider still says pending. `active` must not appear.
    world = World(monkeypatch, created=True)
    monkeypatch.setattr(resend, "verify", lambda credential, external_id: None)
    world.answers(monkeypatch, get=[standing(), standing()])
    world.automation(monkeypatch, available=True, applied=True, outcomes=[RecordOutcome("TXT", "resend._domainkey.acme.ca", "p=MIG", "created")])

    answer = apply_dns(SETTINGS, token="caller-token", organization_id=ORG, resource_id=RESOURCE, dns_settings=DNS_SETTINGS)

    assert world.recorded[0]["status"] == "pending" and answer["state"] == "pending"


def test_a_record_the_dns_capability_refused_to_overwrite_is_reported_rather_than_swallowed(monkeypatch) -> None:
    world = World(monkeypatch, created=True)
    conflict = RecordOutcome("TXT", "send.acme.ca", "v=spf1", "conflict", "A different record already answers for this name.")
    world.answers(monkeypatch, get=standing())
    world.automation(monkeypatch, available=True, applied=False, outcomes=[conflict])

    answer = apply_dns(SETTINGS, token="caller-token", organization_id=ORG, resource_id=RESOURCE, dns_settings=DNS_SETTINGS)

    assert answer["dns_outcome"]["applied"] is False
    assert answer["dns_outcome"]["records"][0]["outcome"] == "conflict"
    # Nothing was re-verified: there was no point, and claiming otherwise would be the lie.
    assert [name for name, _ in world.provider] == ["get"]


def test_applying_before_the_provider_has_the_domain_is_refused_rather_than_guessed_at(monkeypatch) -> None:
    world = World(monkeypatch)

    with pytest.raises(ValidationError):
        apply_dns(SETTINGS, token="caller-token", organization_id=ORG, resource_id=RESOURCE)

    assert world.reads == [] and world.ensured == []


# --- releasing -------------------------------------------------------------------------------------


def test_releasing_deletes_at_the_provider_first_and_then_as_the_person_asking(monkeypatch) -> None:
    world = World(monkeypatch, created=True)
    world.answers(monkeypatch, remove=None)
    monkeypatch.setattr(resend, "remove", lambda credential, external_id: world.provider.append(("remove", external_id)))

    answer = release_domain(SETTINGS, token="caller-token", organization_id=ORG, resource_id=RESOURCE)

    assert world.provider == [("remove", PROVIDER_DOMAIN)]
    assert world.released == [{"p_organization_id": ORG, "p_resource_id": RESOURCE}]
    assert answer == {"resource_id": RESOURCE, "domain": "acme.ca", "released": True}


def test_releasing_a_domain_the_provider_never_had_touches_no_provider_at_all(monkeypatch) -> None:
    world = World(monkeypatch)

    release_domain(SETTINGS, token="caller-token", organization_id=ORG, resource_id=RESOURCE)

    assert world.provider == [] and world.reads == [] and world.released


def test_a_provider_that_refuses_the_delete_stops_the_release(monkeypatch) -> None:
    # Releasing the row anyway would leave the domain live upstream with nothing here to say so.
    world = World(monkeypatch, created=True)
    world.answers(monkeypatch, remove=UpstreamRefused("Resend refused the request (500): boom"))

    with pytest.raises(ProviderRefusedError):
        release_domain(SETTINGS, token="caller-token", organization_id=ORG, resource_id=RESOURCE)

    assert world.released == []


# --- what may leave --------------------------------------------------------------------------------


def test_nothing_in_the_answer_carries_a_credential_or_a_provider_s_raw_payload(monkeypatch) -> None:
    world = World(monkeypatch)
    world.answers(monkeypatch, ensure=standing())
    world.automation(monkeypatch, available=True)

    answer = json.dumps(provision())

    assert SECRET not in answer and ACCOUNT not in answer
    assert set(json.loads(answer)) == {
        "resource_id",
        "domain",
        "state",
        "provider_status",
        "records",
        "records_verified",
        "dns_outcome",
        "dns_automation",
    }
