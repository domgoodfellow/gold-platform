"""What GildOps sends Vercel's Domains API, and how it reads the answers -- offline.

`normalize` is the one function that turns Vercel's JSON into GildOps' own states and DNS records;
every fixture below is a response shape Vercel documents (a project domain from
`POST /v10/projects/{id}/domains` or `GET /v9/projects/{id}/domains/{name}`, and a configuration
from `GET /v6/domains/{name}/config`). The requests are asserted by replacing `httpx.request`, so
nothing leaves the process.
"""

from __future__ import annotations

import json

import httpx
import pytest

from app.providers.providers import HostnameUnavailable, MalformedAnswer, UpstreamRefused, domain_hosting_for
from app.providers.vercel import domains as vercel

CREDENTIAL = {
    "provider_key": "vercel",
    "external_account_id": "prj_gildops",
    "credential_kind": "api_token",
    "credential_identifier": "team_gildops",
    "secret": "the-vercel-token",
}

CONFIGURED = {"misconfigured": False, "configuredBy": "CNAME", "acceptedChallenges": []}
MISCONFIGURED = {
    "misconfigured": True,
    "configuredBy": None,
    "recommendedIPv4": [{"rank": 1, "value": ["76.76.21.21"]}],
    "recommendedCNAME": [{"rank": 1, "value": "cname.vercel-dns.com."}],
}
OWNED_SUBDOMAIN = {"name": "shop.example.com", "apexName": "example.com", "projectId": "prj_gildops", "verified": True}
UNOWNED_SUBDOMAIN = {
    "name": "shop.example.com",
    "apexName": "example.com",
    "projectId": "prj_gildops",
    "verified": False,
    "verification": [
        {"type": "TXT", "domain": "_vercel.example.com", "value": "vc-domain-verify=shop.example.com,abc123", "reason": "pending_domain_verification"}
    ],
}
OWNED_APEX = {"name": "example.com", "apexName": "example.com", "projectId": "prj_gildops", "verified": True}


class Response:
    def __init__(self, status: int, body) -> None:
        self.status_code = status
        self._body = body
        self.text = body if isinstance(body, str) else json.dumps(body)

    def json(self):
        if isinstance(self._body, str):
            raise ValueError("not json")
        return self._body


@pytest.fixture
def wire(monkeypatch):
    """Every request, and a queue of answers keyed by (method, path)."""
    sent: list[dict] = []
    answers: dict[tuple[str, str], Response] = {}

    def request(method, url, *, headers=None, params=None, json=None, timeout=None):
        sent.append({"method": method, "url": url, "headers": headers, "params": params, "json": json})
        path = url.removeprefix(vercel.API)
        if (method, path) not in answers:
            pytest.fail(f"unexpected request {method} {path}")
        return answers[(method, path)]

    monkeypatch.setattr(httpx, "request", request)
    return sent, answers


# --- normalize: Vercel's JSON in, GildOps' vocabulary out --------------------------------------


def test_a_verified_and_configured_hostname_is_verified_with_nothing_to_publish() -> None:
    status = vercel.normalize("shop.example.com", OWNED_SUBDOMAIN, CONFIGURED)

    assert status == vercel.DomainStatus("satisfied", "verified", "issued", [])


def test_a_subdomain_whose_dns_is_not_pointed_needs_one_cname() -> None:
    status = vercel.normalize("shop.example.com", OWNED_SUBDOMAIN, MISCONFIGURED)

    assert status.configuration_state == "dns_required"
    assert status.verification_state == "verifying"
    assert status.ssl_state == "pending"
    assert status.dns_records == [{"type": "CNAME", "name": "shop.example.com", "value": "cname.vercel-dns.com"}]


def test_an_apex_whose_dns_is_not_pointed_needs_an_address_record() -> None:
    status = vercel.normalize("example.com", OWNED_APEX, MISCONFIGURED)

    assert status.dns_records == [{"type": "A", "name": "example.com", "value": "76.76.21.21"}]


def test_an_unproven_hostname_lists_the_ownership_record_first_and_is_never_verified() -> None:
    status = vercel.normalize("shop.example.com", UNOWNED_SUBDOMAIN, MISCONFIGURED)

    assert status.verification_state == "verifying"
    assert status.dns_records == [
        {"type": "TXT", "name": "_vercel.example.com", "value": "vc-domain-verify=shop.example.com,abc123"},
        {"type": "CNAME", "name": "shop.example.com", "value": "cname.vercel-dns.com"},
    ]


def test_dns_pointed_but_ownership_unproven_is_still_verifying() -> None:
    status = vercel.normalize("shop.example.com", UNOWNED_SUBDOMAIN, CONFIGURED)

    assert status.configuration_state == "satisfied"
    assert status.verification_state == "verifying"
    assert [record["type"] for record in status.dns_records] == ["TXT"]


def test_a_configuration_with_no_recommendation_falls_back_to_vercels_documented_targets() -> None:
    bare = {"misconfigured": True}

    assert vercel.normalize("example.com", OWNED_APEX, bare).dns_records[0]["value"] == "76.76.21.21"
    assert vercel.normalize("shop.example.com", OWNED_SUBDOMAIN, bare).dns_records[0]["value"] == "cname.vercel-dns.com"


@pytest.mark.parametrize(
    ("domain", "config"),
    [
        ({"name": "shop.example.com"}, CONFIGURED),  # no ownership fact
        (OWNED_SUBDOMAIN, {"configuredBy": "CNAME"}),  # no DNS fact
        ({**UNOWNED_SUBDOMAIN, "verification": []}, CONFIGURED),  # unproven, and no way to prove it
        ({**UNOWNED_SUBDOMAIN, "verification": [{"type": "TXT", "domain": "", "value": "x"}]}, CONFIGURED),
        ([], CONFIGURED),
    ],
)
def test_a_shape_nobody_can_read_is_refused_as_malformed_rather_than_guessed_at(domain, config) -> None:
    with pytest.raises(MalformedAnswer):
        vercel.normalize("shop.example.com", domain, config)


def test_the_normalized_status_carries_no_vercel_field_names() -> None:
    status = vercel.normalize("shop.example.com", UNOWNED_SUBDOMAIN, MISCONFIGURED)

    assert set(status.__dict__) == {"configuration_state", "verification_state", "ssl_state", "dns_records"}
    assert all(set(record) == {"type", "name", "value"} for record in status.dns_records)
    for leaked in ("misconfigured", "apexName", "projectId", "recommended", "reason"):
        assert leaked not in json.dumps(status.__dict__)


# --- the requests ------------------------------------------------------------------------------


def test_registering_posts_the_name_to_the_project_on_the_team_with_the_token(wire) -> None:
    sent, answers = wire
    answers[("POST", "/v10/projects/prj_gildops/domains")] = Response(200, OWNED_SUBDOMAIN)

    assert vercel.register(CREDENTIAL, "shop.example.com") == OWNED_SUBDOMAIN
    assert sent[0]["json"] == {"name": "shop.example.com"}
    assert sent[0]["params"] == {"teamId": "team_gildops"}
    assert sent[0]["headers"] == {"Authorization": "Bearer the-vercel-token"}


def test_a_token_on_a_personal_account_sends_no_team(wire) -> None:
    sent, answers = wire
    answers[("GET", "/v6/domains/shop.example.com/config")] = Response(200, CONFIGURED)

    vercel.configuration({**CREDENTIAL, "credential_identifier": None}, "shop.example.com")

    assert sent[0]["params"] == {}


def test_a_hostname_already_attached_to_this_project_is_not_a_conflict(wire) -> None:
    _, answers = wire
    answers[("POST", "/v10/projects/prj_gildops/domains")] = Response(409, {"error": {"code": "domain_already_in_use", "message": "in use"}})
    answers[("GET", "/v9/projects/prj_gildops/domains/shop.example.com")] = Response(200, OWNED_SUBDOMAIN)

    assert vercel.register(CREDENTIAL, "shop.example.com") == OWNED_SUBDOMAIN


def test_a_hostname_somebody_else_holds_is_unavailable_in_vercels_words(wire) -> None:
    _, answers = wire
    answers[("POST", "/v10/projects/prj_gildops/domains")] = Response(
        409, {"error": {"code": "domain_already_in_use", "message": "Cannot add shop.example.com since it's already in use by your account."}}
    )
    answers[("GET", "/v9/projects/prj_gildops/domains/shop.example.com")] = Response(404, {"error": {"code": "not_found"}})

    with pytest.raises(HostnameUnavailable, match="already in use"):
        vercel.register(CREDENTIAL, "shop.example.com")


def test_a_name_vercel_will_not_accept_is_unavailable(wire) -> None:
    _, answers = wire
    answers[("POST", "/v10/projects/prj_gildops/domains")] = Response(400, {"error": {"code": "invalid_domain", "message": "Invalid domain name"}})

    with pytest.raises(HostnameUnavailable):
        vercel.register(CREDENTIAL, "shop.example.com")


def test_a_server_error_is_a_refusal_not_an_unavailable_name(wire) -> None:
    _, answers = wire
    answers[("POST", "/v10/projects/prj_gildops/domains")] = Response(500, "upstream exploded")

    with pytest.raises(UpstreamRefused) as raised:
        vercel.register(CREDENTIAL, "shop.example.com")
    assert not isinstance(raised.value, HostnameUnavailable)


def test_an_unreachable_vercel_is_a_refusal(monkeypatch) -> None:
    def down(*args, **kwargs):
        raise httpx.ConnectError("no route")

    monkeypatch.setattr(httpx, "request", down)

    with pytest.raises(UpstreamRefused, match="could not be reached"):
        vercel.configuration(CREDENTIAL, "shop.example.com")


def test_a_non_json_answer_is_malformed(wire) -> None:
    _, answers = wire
    answers[("GET", "/v6/domains/shop.example.com/config")] = Response(200, "<html>")

    with pytest.raises(MalformedAnswer):
        vercel.configuration(CREDENTIAL, "shop.example.com")


def test_ownership_not_provable_yet_is_an_answer_not_a_failure(wire) -> None:
    _, answers = wire
    answers[("POST", "/v9/projects/prj_gildops/domains/shop.example.com/verify")] = Response(
        400, {"error": {"code": "missing_txt_record", "message": "TXT record not found"}}
    )

    assert vercel.verify_ownership(CREDENTIAL, "shop.example.com") is None


def test_checking_a_hostname_vercel_lost_attaches_it_again(wire) -> None:
    sent, answers = wire
    answers[("POST", "/v9/projects/prj_gildops/domains/shop.example.com/verify")] = Response(400, {"error": {"code": "not_found"}})
    answers[("GET", "/v9/projects/prj_gildops/domains/shop.example.com")] = Response(404, {"error": {"code": "not_found"}})
    answers[("POST", "/v10/projects/prj_gildops/domains")] = Response(200, OWNED_SUBDOMAIN)
    answers[("GET", "/v6/domains/shop.example.com/config")] = Response(200, CONFIGURED)

    assert vercel.check(CREDENTIAL, "shop.example.com").verification_state == "verified"
    assert [request["method"] for request in sent] == ["POST", "GET", "POST", "GET"]


def test_removing_a_hostname_already_gone_is_fine(wire) -> None:
    _, answers = wire
    answers[("DELETE", "/v9/projects/prj_gildops/domains/shop.example.com")] = Response(404, {"error": {"code": "not_found"}})

    vercel.remove(CREDENTIAL, "shop.example.com")


def test_a_refused_removal_says_so(wire) -> None:
    _, answers = wire
    answers[("DELETE", "/v9/projects/prj_gildops/domains/shop.example.com")] = Response(403, {"error": {"code": "forbidden", "message": "Not authorized"}})

    with pytest.raises(UpstreamRefused, match="Not authorized"):
        vercel.remove(CREDENTIAL, "shop.example.com")


@pytest.mark.parametrize(
    "credential",
    [
        {**CREDENTIAL, "credential_kind": "api_key"},
        {**CREDENTIAL, "secret": None},
        {**CREDENTIAL, "external_account_id": None},
    ],
)
def test_a_credential_this_adapter_cannot_use_is_refused_before_anything_is_sent(monkeypatch, credential) -> None:
    monkeypatch.setattr(httpx, "request", lambda *a, **k: pytest.fail("nothing should be sent"))

    with pytest.raises(UpstreamRefused):
        vercel.configuration(credential, "shop.example.com")


def test_verifying_the_account_reads_the_project_and_never_raises(wire) -> None:
    _, answers = wire
    answers[("GET", "/v9/projects/prj_gildops")] = Response(200, {"id": "prj_gildops", "name": "gildops-web"})

    assert vercel.verify_account(CREDENTIAL) == {"ok": True, "error": None, "metadata": {"project_name": "gildops-web"}}

    answers[("GET", "/v9/projects/prj_gildops")] = Response(403, {"error": {"code": "forbidden", "message": "Invalid token"}})
    refused = vercel.verify_account(CREDENTIAL)
    assert refused["ok"] is False and "Invalid token" in refused["error"]


def test_the_registry_hands_out_this_module_by_key_and_nothing_for_an_unknown_one() -> None:
    assert domain_hosting_for("vercel") is vercel
    assert domain_hosting_for("netlify") is None
