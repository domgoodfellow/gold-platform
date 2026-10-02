"""A business's custom domain: who may act, what is recorded, and what may leave.

What Postgres decides -- that `record_custom_domain_registration` and
`set_custom_domain_verification` are executable by no signed-in role, that a hostname is claimed
once, that one business never reaches another's row -- is proven against a real database by
`apps/web/tests/integration/database/organization-domains.test.ts`. What belongs here is the half
that is a fact about this process: authorization is proved before the credential is read, every
provider outcome is recorded on the row before it is returned, a missing hosting account is never
reported as a DNS problem, and nothing Vercel-shaped reaches the response.

The provider boundary is `app.providers.vercel.domains`; its `connect`, `check` and `remove` are
replaced here, the way `test_integration_operations.py` replaces its vendor.
"""

from __future__ import annotations

import json

import pytest

from app.core.config import IntegrationSettings, ProviderOperationsSettings
from app.errors import NotFoundError, ValidationError
from app.services.dns.operations import AutomationPreview as DnsAutomationPreview
from app.services.dns.operations import EnsureResult as DnsEnsureResult
from app.services.web_delivery import operations as ops
from app.services.web_delivery.operations import (
    HostnameUnavailableError,
    ProviderRefusedError,
    ProviderUnavailableError,
    apply_dns_automation,
    check_domain,
    connect_domain,
    remove_domain,
    run_domain_command,
)
from app.providers.providers import HostnameUnavailable, MalformedAnswer, UpstreamRefused
from app.providers.vercel import domains as vercel

SETTINGS = ProviderOperationsSettings(
    supabase_url="http://db.test", supabase_publishable_key="anon", supabase_jwt_secret="signing"
)
ORG = "11111111-1111-4111-8111-111111111111"
DOMAIN = "22222222-2222-4222-8222-222222222222"
ACCOUNT = "33333333-3333-4333-8333-333333333333"
RESOURCE = "44444444-4444-4444-8444-444444444444"
SECRET = "the-vercel-token"
CREDENTIAL = {
    "provider_key": "vercel",
    "external_account_id": "prj_gildops",
    "credential_kind": "api_token",
    "credential_identifier": "team_gildops",
    "secret": SECRET,
}
CNAME = [{"type": "CNAME", "name": "shop.example.com", "value": "cname.vercel-dns.com"}]
TXT = [{"type": "TXT", "name": "_vercel.example.com", "value": "vc-domain-verify=abc"}]


class Response:
    def __init__(self, status: int, body) -> None:
        self.status_code = status
        self._body = body
        self.text = json.dumps(body)

    def json(self):
        return self._body


class World:
    """One fake database (as the caller, and as the machine role) and one fake provider."""

    def __init__(self, monkeypatch, *, manage=True, registered=False, account=ACCOUNT, credential=CREDENTIAL, state="pending") -> None:
        self.manage = manage
        self.row = {
            "id": DOMAIN,
            "hostname": "shop.example.com",
            "provider_key": "vercel",
            "provider_resource_id": RESOURCE if registered else None,
            "verification_state": state,
        }
        self.visible = True
        self.rest: list[tuple[str, str]] = []
        self.released: list[dict] = []
        self.account = account
        self.credential = credential
        self.reads: list[str] = []
        self.registrations: list[dict] = []
        self.verifications: list[dict] = []
        self.provider: list[tuple[str, str]] = []

        monkeypatch.setattr(ops.httpx, "request", self._request)
        monkeypatch.setattr(ops.db, "custom_domain_provider_account", lambda s, **kw: self.account)
        monkeypatch.setattr(ops.db, "read_provider_account_credential", self._read)
        monkeypatch.setattr(ops.db, "record_custom_domain_registration", lambda s, **kw: self.registrations.append(kw))
        monkeypatch.setattr(ops.db, "set_custom_domain_verification", lambda s, **kw: self.verifications.append(kw))

    def _request(self, method, url, **kwargs):
        path = url.removeprefix("http://db.test/rest/v1/")
        self.rest.append((method, path))
        assert kwargs["headers"]["Authorization"] == "Bearer caller-token", "the caller's own token, never a machine one"
        if path == "rpc/can_manage_custom_domains":
            return Response(200, self.manage)
        if path == "organization_domains":
            return Response(200, [self.row] if self.visible else [])
        if path == "rpc/release_custom_domain":
            self.released.append(kwargs["json"])
            return Response(204, None)
        raise AssertionError(f"unexpected request {method} {path}")

    def _read(self, settings, *, account_id):
        self.reads.append(account_id)
        return self.credential

    def answers(self, monkeypatch, *, connect=None, check=None, remove=None) -> None:
        def wrap(name, outcome):
            def run(credential, hostname):
                assert credential["secret"] == SECRET
                self.provider.append((name, hostname))
                if isinstance(outcome, Exception):
                    raise outcome
                return outcome

            return run

        for name, outcome in (("connect", connect), ("check", check), ("remove", remove)):
            if outcome is not None:
                monkeypatch.setattr(vercel, name, wrap(name, outcome))


def dns_required(records=CNAME) -> vercel.DomainStatus:
    return vercel.DomainStatus("dns_required", "verifying", "pending", records)


VERIFIED = vercel.DomainStatus("satisfied", "verified", "issued", [])


def connect(**kwargs) -> dict:
    return connect_domain(SETTINGS, token="caller-token", organization_id=ORG, domain_id=DOMAIN, **kwargs)


# --- who may act ---------------------------------------------------------------------------------


@pytest.mark.parametrize("command", [connect_domain, check_domain, remove_domain, apply_dns_automation])
def test_a_caller_who_may_not_manage_domains_never_causes_the_credential_to_be_read(monkeypatch, command) -> None:
    world = World(monkeypatch, manage=False)

    with pytest.raises(NotFoundError):
        command(SETTINGS, token="caller-token", organization_id=ORG, domain_id=DOMAIN)

    assert world.reads == [] and world.provider == [] and world.registrations == [] and world.released == []


def test_another_business_s_domain_is_indistinguishable_from_no_domain(monkeypatch) -> None:
    world = World(monkeypatch)
    world.visible = False

    with pytest.raises(NotFoundError):
        connect()

    assert world.reads == []


def test_an_unknown_command_is_refused_before_anything_is_read(monkeypatch) -> None:
    world = World(monkeypatch)

    with pytest.raises(ValidationError):
        run_domain_command(SETTINGS, token="caller-token", command="transfer", organization_id=ORG, domain_id=DOMAIN)

    assert world.rest == []


def test_a_hostname_that_is_not_the_row_s_is_refused(monkeypatch) -> None:
    world = World(monkeypatch)

    with pytest.raises(ValidationError):
        connect(hostname="other.example.com")

    assert world.reads == []


# --- connecting ----------------------------------------------------------------------------------


def test_an_already_configured_hostname_is_registered_and_verified_at_once(monkeypatch) -> None:
    world = World(monkeypatch)
    world.answers(monkeypatch, connect=VERIFIED)

    result = connect()

    assert world.registrations == [
        {"organization_id": ORG, "domain_id": DOMAIN, "configuration_state": "satisfied", "dns_records": []}
    ]
    assert world.verifications[0]["verification_state"] == "verified"
    assert world.verifications[0]["ssl_state"] == "issued"
    assert result["verification_state"] == "verified"


def test_a_hostname_needing_dns_is_registered_with_the_records_to_publish_and_not_verified(monkeypatch) -> None:
    world = World(monkeypatch)
    world.answers(monkeypatch, connect=dns_required())

    result = connect()

    assert world.registrations[0]["configuration_state"] == "dns_required"
    assert world.registrations[0]["dns_records"] == CNAME
    assert world.verifications == []
    assert result == {
        "domain_id": DOMAIN,
        "hostname": "shop.example.com",
        "configuration_state": "dns_required",
        "verification_state": "verifying",
        "ssl_state": "pending",
        "dns_records": CNAME,
        "dns_automation": {"available": False, "connectionId": None, "zoneName": None},
    }


def test_a_hostname_pending_ownership_verification_carries_its_txt_record(monkeypatch) -> None:
    world = World(monkeypatch)
    world.answers(monkeypatch, connect=dns_required(TXT + CNAME))

    result = connect()

    assert [record["type"] for record in result["dns_records"]] == ["TXT", "CNAME"]
    assert result["verification_state"] == "verifying"


def test_no_hosting_account_is_recorded_as_provider_unavailable_never_as_a_dns_problem(monkeypatch) -> None:
    world = World(monkeypatch, account=None)
    world.answers(monkeypatch, connect=VERIFIED)

    with pytest.raises(ProviderUnavailableError):
        connect()

    assert world.reads == [] and world.provider == []
    assert world.registrations[0]["error_code"] == "provider_unavailable"
    assert world.registrations[0]["dns_records"] == []


def test_an_account_with_no_usable_credential_is_the_same_unavailable_answer(monkeypatch) -> None:
    world = World(monkeypatch, credential=None)
    world.answers(monkeypatch, connect=VERIFIED)

    with pytest.raises(ProviderUnavailableError):
        connect()

    assert world.provider == []
    assert world.registrations[0]["error_code"] == "provider_unavailable"


def test_a_hostname_held_elsewhere_fails_the_domain_as_a_conflict_that_names_nobody(monkeypatch) -> None:
    world = World(monkeypatch)
    world.answers(monkeypatch, connect=HostnameUnavailable("Vercel will not attach this hostname: already in use"))

    with pytest.raises(HostnameUnavailableError) as raised:
        connect()

    assert raised.value.status == 409
    assert world.registrations == []
    assert world.verifications[0]["verification_state"] == "failed"
    assert world.verifications[0]["error_code"] == "hostname_unavailable"


def test_an_invalid_name_the_provider_rejects_is_also_failed(monkeypatch) -> None:
    world = World(monkeypatch)
    world.answers(monkeypatch, connect=HostnameUnavailable("Vercel will not attach this hostname: Invalid domain name"))

    with pytest.raises(HostnameUnavailableError):
        connect()

    assert world.verifications[0]["verification_state"] == "failed"


def test_a_provider_failure_is_recorded_in_its_own_words_and_changes_no_verification(monkeypatch) -> None:
    world = World(monkeypatch)
    world.answers(monkeypatch, connect=UpstreamRefused("Vercel refused the request (500): upstream exploded"))

    with pytest.raises(ProviderRefusedError):
        connect()

    assert world.registrations[0]["error_code"] == "provider_refused"
    assert "upstream exploded" in world.registrations[0]["error_message"]
    assert world.verifications == []


def test_a_malformed_answer_is_recorded_as_such(monkeypatch) -> None:
    world = World(monkeypatch)
    world.answers(monkeypatch, connect=MalformedAnswer("Vercel answered with an unexpected shape."))

    with pytest.raises(ProviderRefusedError):
        connect()

    assert world.registrations[0]["error_code"] == "malformed_response"


# --- rechecking ----------------------------------------------------------------------------------


def test_a_recheck_that_finds_dns_published_verifies_the_domain(monkeypatch) -> None:
    world = World(monkeypatch, registered=True, state="verifying")
    world.answers(monkeypatch, check=VERIFIED)

    result = check_domain(SETTINGS, token="caller-token", organization_id=ORG, domain_id=DOMAIN)

    assert world.provider == [("check", "shop.example.com")]
    assert world.verifications == [
        {
            "organization_id": ORG,
            "domain_id": DOMAIN,
            "verification_state": "verified",
            "configuration_state": "satisfied",
            "ssl_state": "issued",
            "dns_records": [],
        }
    ]
    assert result["verification_state"] == "verified"


def test_a_recheck_is_idempotent(monkeypatch) -> None:
    world = World(monkeypatch, registered=True, state="verifying")
    world.answers(monkeypatch, check=dns_required())

    first = check_domain(SETTINGS, token="caller-token", organization_id=ORG, domain_id=DOMAIN)
    second = check_domain(SETTINGS, token="caller-token", organization_id=ORG, domain_id=DOMAIN)

    assert first == second
    assert world.verifications[0] == world.verifications[1]
    assert world.registrations == []


def test_a_recheck_of_a_domain_never_registered_registers_it(monkeypatch) -> None:
    world = World(monkeypatch)
    world.answers(monkeypatch, connect=dns_required(), check=VERIFIED)

    check_domain(SETTINGS, token="caller-token", organization_id=ORG, domain_id=DOMAIN)

    assert world.provider == [("connect", "shop.example.com")]
    assert len(world.registrations) == 1


def test_a_refused_recheck_keeps_what_the_provider_last_established(monkeypatch) -> None:
    world = World(monkeypatch, registered=True, state="verified")
    world.answers(monkeypatch, check=UpstreamRefused("Vercel could not be reached: ConnectTimeout"))

    with pytest.raises(ProviderRefusedError):
        check_domain(SETTINGS, token="caller-token", organization_id=ORG, domain_id=DOMAIN)

    assert world.verifications[0]["verification_state"] == "verified"
    assert world.verifications[0]["error_code"] == "provider_refused"


def test_a_recheck_with_no_hosting_account_says_so_and_keeps_the_state(monkeypatch) -> None:
    world = World(monkeypatch, registered=True, state="verifying", account=None)

    with pytest.raises(ProviderUnavailableError):
        check_domain(SETTINGS, token="caller-token", organization_id=ORG, domain_id=DOMAIN)

    assert world.verifications[0]["verification_state"] == "verifying"
    assert world.verifications[0]["error_code"] == "provider_unavailable"


# --- removing ------------------------------------------------------------------------------------


def test_removal_detaches_at_the_provider_then_releases_under_the_caller_s_own_token(monkeypatch) -> None:
    world = World(monkeypatch, registered=True, state="verified")
    world.answers(monkeypatch, remove=None)
    monkeypatch.setattr(vercel, "remove", lambda credential, hostname: world.provider.append(("remove", hostname)))

    result = remove_domain(SETTINGS, token="caller-token", organization_id=ORG, domain_id=DOMAIN)

    assert world.provider == [("remove", "shop.example.com")]
    assert world.released == [{"p_organization_id": ORG, "p_domain_id": DOMAIN}]
    assert result == {"domain_id": DOMAIN, "hostname": "shop.example.com", "released": True}


def test_a_refused_removal_releases_nothing(monkeypatch) -> None:
    world = World(monkeypatch, registered=True, state="verified")
    world.answers(monkeypatch, remove=UpstreamRefused("Vercel refused the request (403): Not authorized"))

    with pytest.raises(ProviderRefusedError):
        remove_domain(SETTINGS, token="caller-token", organization_id=ORG, domain_id=DOMAIN)

    assert world.released == []


def test_a_domain_never_registered_is_released_without_asking_the_provider(monkeypatch) -> None:
    world = World(monkeypatch, account=None)
    monkeypatch.setattr(vercel, "remove", lambda *a: pytest.fail("nothing to detach"))

    remove_domain(SETTINGS, token="caller-token", organization_id=ORG, domain_id=DOMAIN)

    assert world.released == [{"p_organization_id": ORG, "p_domain_id": DOMAIN}]
    assert world.reads == []


# --- the DNS review step (work order 1 closeout, section 3) ---------------------------------------
#
# `connect`/`check` never write a DNS record themselves any more -- they only *offer* a review,
# `dns_automation`, built from a read-only preview (`app.services.dns.preview_automation`, mocked
# directly here; its own real resolution is `test_dns_operations.py`'s subject). The one
# consequential mutation is `apply_dns_automation`, reached only once a person presses "Apply and
# verify" after seeing exactly what would change.

DNS_SETTINGS = IntegrationSettings(
    supabase_url="http://db.test", supabase_publishable_key="anon", supabase_jwt_secret="signing",
    state_secret="state-secret", redirect_uri="https://app.test/connect/oauth/callback",
)


def test_with_no_dns_settings_no_review_is_offered_and_nothing_is_previewed(monkeypatch) -> None:
    world = World(monkeypatch)
    world.answers(monkeypatch, connect=dns_required())
    monkeypatch.setattr(ops, "preview_automation", lambda *a, **kw: pytest.fail("not asked"))

    result = connect_domain(SETTINGS, token="caller-token", organization_id=ORG, domain_id=DOMAIN, dns_settings=None)

    assert result["configuration_state"] == "dns_required"
    assert result["dns_automation"] == {"available": False, "connectionId": None, "zoneName": None}


def test_connect_never_writes_dns_itself_even_when_automation_is_available(monkeypatch) -> None:
    world = World(monkeypatch)
    world.answers(monkeypatch, connect=dns_required())
    monkeypatch.setattr(
        ops, "preview_automation", lambda *a, **kw: DnsAutomationPreview(available=True, connection_id="conn-1", zone_name="example.com")
    )
    monkeypatch.setattr(ops, "ensure_required_records", lambda *a, **kw: pytest.fail("connect must never write"))

    result = connect_domain(SETTINGS, token="caller-token", organization_id=ORG, domain_id=DOMAIN, dns_settings=DNS_SETTINGS)

    assert result["configuration_state"] == "dns_required"
    assert result["dns_records"] == CNAME
    assert result["dns_automation"] == {"available": True, "connectionId": "conn-1", "zoneName": "example.com"}
    assert world.provider == [("connect", "shop.example.com")]  # never a second call: nothing was written


def test_a_business_with_no_connected_zone_sees_no_review_offered(monkeypatch) -> None:
    world = World(monkeypatch)
    world.answers(monkeypatch, connect=dns_required())
    monkeypatch.setattr(ops, "preview_automation", lambda *a, **kw: DnsAutomationPreview(available=False, connection_id=None, zone_name=None))

    result = connect_domain(SETTINGS, token="caller-token", organization_id=ORG, domain_id=DOMAIN, dns_settings=DNS_SETTINGS)

    assert result["dns_automation"] == {"available": False, "connectionId": None, "zoneName": None}


def test_a_verified_domain_is_never_offered_a_review(monkeypatch) -> None:
    world = World(monkeypatch)
    world.answers(monkeypatch, connect=VERIFIED)
    monkeypatch.setattr(ops, "preview_automation", lambda *a, **kw: pytest.fail("nothing to preview"))

    result = connect_domain(SETTINGS, token="caller-token", organization_id=ORG, domain_id=DOMAIN, dns_settings=DNS_SETTINGS)

    assert result["verification_state"] == "verified"
    assert result["dns_automation"] == {"available": False, "connectionId": None, "zoneName": None}


# --- apply_dns_automation: the one consequential mutation, pressed explicitly ----------------------


def apply(**kwargs) -> dict:
    return apply_dns_automation(SETTINGS, token="caller-token", organization_id=ORG, domain_id=DOMAIN, **kwargs)


def _stub_preview(monkeypatch) -> None:
    """`_view`'s own trailing preview (so a still-`dns_required` result can offer Review again) is
    not what these tests are about; the real resolution is `test_dns_operations.py`'s subject."""
    monkeypatch.setattr(
        ops, "preview_automation", lambda *a, **kw: DnsAutomationPreview(available=True, connection_id="conn-1", zone_name="example.com")
    )


def test_apply_refuses_a_domain_never_registered_with_the_provider(monkeypatch) -> None:
    world = World(monkeypatch)  # registered=False by default: no provider_resource_id

    with pytest.raises(ValidationError):
        apply(dns_settings=DNS_SETTINGS)

    assert world.reads == []


def test_apply_refuses_with_no_hosting_account_and_keeps_the_state(monkeypatch) -> None:
    world = World(monkeypatch, registered=True, state="verifying", account=None)

    with pytest.raises(ProviderUnavailableError):
        apply(dns_settings=DNS_SETTINGS)

    assert world.verifications[0]["verification_state"] == "verifying"
    assert world.verifications[0]["error_code"] == "provider_unavailable"


def test_apply_rechecks_fresh_ensures_through_the_connected_zone_then_rechecks_again(monkeypatch) -> None:
    world = World(monkeypatch, registered=True, state="verifying")
    ensured = []

    def ensure(settings, *, token, organization_id, hostname, records):
        ensured.append((organization_id, hostname, records))
        return DnsEnsureResult(applied=True, connection_id="conn-1", zone_name="example.com")

    # The *first* check (what "Apply" re-asks before writing) says dns_required; the *second*,
    # after ensuring, reports verified.
    checks = {"n": 0}

    def two_checks(credential, hostname):
        checks["n"] += 1
        return dns_required() if checks["n"] == 1 else VERIFIED

    monkeypatch.setattr(vercel, "check", two_checks)
    monkeypatch.setattr(ops, "ensure_required_records", ensure)
    _stub_preview(monkeypatch)

    result = apply(dns_settings=DNS_SETTINGS)

    assert checks["n"] == 2
    assert ensured == [(ORG, "shop.example.com", CNAME)]
    assert result["verification_state"] == "verified"
    assert world.verifications[-1]["verification_state"] == "verified"


def test_apply_with_nothing_to_ensure_records_the_fresh_check_and_never_rechecks_twice(monkeypatch) -> None:
    world = World(monkeypatch, registered=True, state="verifying")
    checks = []
    monkeypatch.setattr(vercel, "check", lambda credential, hostname: checks.append(1) or dns_required())
    monkeypatch.setattr(ops, "ensure_required_records", lambda *a, **kw: DnsEnsureResult(applied=False, connection_id=None, zone_name=None))
    _stub_preview(monkeypatch)

    result = apply(dns_settings=DNS_SETTINGS)

    assert len(checks) == 1  # no second recheck when nothing was applied
    assert result["configuration_state"] == "dns_required"


def test_apply_with_a_refused_second_recheck_keeps_the_first_checks_own_answer(monkeypatch) -> None:
    world = World(monkeypatch, registered=True, state="verifying")
    monkeypatch.setattr(ops, "ensure_required_records", lambda *a, **kw: DnsEnsureResult(applied=True, connection_id="conn-1", zone_name="example.com"))

    calls = {"n": 0}

    def flaky_check(credential, hostname):
        calls["n"] += 1
        if calls["n"] == 1:
            return dns_required()
        raise UpstreamRefused("Vercel refused the request (500): busy")

    monkeypatch.setattr(vercel, "check", flaky_check)
    _stub_preview(monkeypatch)

    result = apply(dns_settings=DNS_SETTINGS)

    assert calls["n"] == 2
    assert result["configuration_state"] == "dns_required"
    assert result["dns_records"] == CNAME


def test_apply_already_satisfied_records_as_such_without_ensuring_anything(monkeypatch) -> None:
    world = World(monkeypatch, registered=True, state="verifying")
    world.answers(monkeypatch, check=VERIFIED)
    monkeypatch.setattr(ops, "ensure_required_records", lambda *a, **kw: pytest.fail("nothing to ensure"))

    result = apply(dns_settings=DNS_SETTINGS)

    assert result["verification_state"] == "verified"


def test_a_registered_domain_is_not_released_while_no_account_can_detach_it(monkeypatch) -> None:
    world = World(monkeypatch, registered=True, account=None)

    with pytest.raises(ProviderUnavailableError):
        remove_domain(SETTINGS, token="caller-token", organization_id=ORG, domain_id=DOMAIN)

    assert world.released == []


# --- what may leave ------------------------------------------------------------------------------


def test_no_result_carries_the_credential(monkeypatch) -> None:
    world = World(monkeypatch)
    world.answers(monkeypatch, connect=dns_required(TXT + CNAME))

    result = connect()

    assert SECRET not in json.dumps(result)
    assert "team_gildops" not in json.dumps(result) and "prj_gildops" not in json.dumps(result)
