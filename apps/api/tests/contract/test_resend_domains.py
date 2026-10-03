"""What GildOps sends Resend's Domains API, and how it reads the answers -- offline.

`normalize` is the one function that turns Resend's JSON into GildOps' own state and required
records; every fixture below is a response shape Resend documents (a domain from `POST /domains`
or `GET /domains/{id}`, a page of `GET /domains`, and its `{name, message}` error body). The
requests are asserted by replacing `httpx.request`, so nothing leaves the process.
"""

from __future__ import annotations

import json

import httpx
import pytest

from app.providers.providers import (
    CredentialRejected,
    HostnameUnavailable,
    MalformedAnswer,
    UpstreamRefused,
    email_domains_for,
)
from app.providers.resend import domains as resend

CREDENTIAL = {"provider_key": "resend", "credential_kind": "api_key", "secret": "re_the_key"}
DOMAIN_ID = "4dd369bc-aa82-4ff3-97de-514ae3000ee0"

# Exactly the records Resend's own documentation returns for a sending domain: an MX and a TXT
# named relative to the domain, a DKIM TXT also relative, and a tracking CNAME named absolutely.
RECORDS = [
    {"record": "SPF", "name": "send", "type": "MX", "ttl": "Auto", "status": "not_started", "value": "feedback-smtp.us-east-1.amazonses.com", "priority": 10},
    {"record": "SPF", "name": "send", "value": '"v=spf1 include:amazonses.com ~all"', "type": "TXT", "ttl": "Auto", "status": "not_started"},
    {"record": "DKIM", "name": "resend._domainkey", "value": "p=MIGfMA0GCSqGSIb3", "type": "TXT", "status": "not_started", "ttl": "Auto"},
    {"record": "Tracking", "name": "links.acme.ca", "type": "CNAME", "value": "links1.resend-dns.com", "ttl": "Auto", "status": "not_started"},
]


def domain(status: str = "not_started", records=None) -> dict:
    return {
        "object": "domain",
        "id": DOMAIN_ID,
        "name": "acme.ca",
        "status": status,
        "created_at": "2026-04-26 20:21:26.347412+00",
        "region": "us-east-1",
        "records": RECORDS if records is None else records,
    }


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
    answers: dict[tuple[str, str], list] = {}

    def request(method, url, *, headers=None, params=None, json=None, timeout=None):
        sent.append({"method": method, "url": url, "headers": headers, "json": json})
        path = url.removeprefix(resend.API)
        queued = answers.get((method, path))
        if not queued:
            pytest.fail(f"unexpected request {method} {path}")
        return queued.pop(0) if len(queued) > 1 else queued[0]

    monkeypatch.setattr(httpx, "request", request)
    return sent, answers


# --- normalize: Resend's JSON in, GildOps' vocabulary out ---------------------------------------


def test_a_relative_record_name_becomes_the_whole_name_a_dns_host_is_given() -> None:
    status = resend.normalize(domain())

    names = [record.name for record in status.records]
    assert names == ["send.acme.ca", "send.acme.ca", "resend._domainkey.acme.ca", "links.acme.ca"]


def test_a_txt_value_loses_one_layer_of_zone_file_quoting_and_a_dkim_key_is_untouched() -> None:
    status = resend.normalize(domain())

    spf = next(record for record in status.records if record.purpose == "SPF" and record.type == "TXT")
    dkim = next(record for record in status.records if record.purpose == "DKIM")
    assert spf.value == "v=spf1 include:amazonses.com ~all"
    assert dkim.value == "p=MIGfMA0GCSqGSIb3"


def test_priority_belongs_to_the_mx_record_and_to_no_other() -> None:
    status = resend.normalize(domain())

    mx = next(record for record in status.records if record.type == "MX")
    assert mx.priority == 10
    assert all(record.priority is None for record in status.records if record.type != "MX")
    # And the view a caller stores drops the key entirely rather than storing a null.
    views = resend.record_views(status)
    assert "priority" not in views[1] and views[0]["priority"] == 10


@pytest.mark.parametrize(
    ("provider_status", "state"),
    [
        ("not_started", "pending"),
        ("pending", "pending"),
        ("temporary_failure", "pending"),
        ("partially_failed", "pending"),
        ("verified", "active"),
        ("partially_verified", "active"),
        ("failed", "failed"),
    ],
)
def test_each_status_resend_documents_maps_to_one_gildops_state(provider_status, state) -> None:
    status = resend.normalize(domain(provider_status))

    assert status.state == state
    # The provider's own word travels beside it, unmapped, for the sentence a person reads.
    assert status.provider_status == provider_status


def test_a_status_word_resend_adds_later_is_pending_rather_than_an_unreadable_answer() -> None:
    status = resend.normalize(domain("some_new_word"))

    assert status.state == "pending" and status.provider_status == "some_new_word"


def test_a_record_status_resend_has_seen_is_carried_through_so_counting_verified_is_honest() -> None:
    seen = [dict(RECORDS[0], status="verified"), dict(RECORDS[1], status="failed"), RECORDS[2]]

    status = resend.normalize(domain(records=seen))

    assert [record.status for record in status.records] == ["verified", "failed", "pending"]


def test_a_domain_list_entry_carries_no_records_and_that_is_not_an_answer_about_records() -> None:
    status = resend.normalize({"id": DOMAIN_ID, "name": "acme.ca", "status": "verified"})

    assert status.records == [] and status.state == "active"


@pytest.mark.parametrize(
    "body",
    [
        {"name": "acme.ca", "status": "verified"},  # no id
        {"id": DOMAIN_ID, "status": "verified"},  # no name
        {"id": DOMAIN_ID, "name": "acme.ca"},  # no status
        {"id": DOMAIN_ID, "name": "acme.ca", "status": "pending", "records": "lots"},
        {"id": DOMAIN_ID, "name": "acme.ca", "status": "pending", "records": [{"type": "TXT", "name": "x"}]},
    ],
)
def test_an_answer_missing_something_this_adapter_needs_is_a_controlled_error(body) -> None:
    with pytest.raises(MalformedAnswer):
        resend.normalize(body)


def test_a_record_type_this_platform_cannot_publish_is_refused_rather_than_dropped() -> None:
    # Dropped quietly, it would be a domain that never verifies and never says why.
    with pytest.raises(MalformedAnswer):
        resend.normalize(domain(records=[{"record": "X", "name": "a", "type": "A", "value": "1.2.3.4", "status": "pending"}]))


# --- the requests ---------------------------------------------------------------------------------


def test_creating_a_domain_asks_for_sending_and_refuses_receiving(wire) -> None:
    sent, answers = wire
    answers[("POST", "/domains")] = [Response(200, domain())]

    resend.create(CREDENTIAL, "acme.ca")

    assert sent[0]["json"] == {"name": "acme.ca", "capabilities": {"sending": "enabled", "receiving": "disabled"}}
    assert sent[0]["headers"]["Authorization"] == "Bearer re_the_key"


def test_verifying_asks_and_returns_nothing_because_asking_is_not_an_answer(wire) -> None:
    sent, answers = wire
    answers[("POST", f"/domains/{DOMAIN_ID}/verify")] = [Response(200, {"object": "domain", "id": DOMAIN_ID})]

    assert resend.verify(CREDENTIAL, DOMAIN_ID) is None
    assert sent[0]["method"] == "POST"


def test_a_domain_resend_no_longer_has_reads_as_absent_rather_than_as_a_failure(wire) -> None:
    _, answers = wire
    answers[("GET", f"/domains/{DOMAIN_ID}")] = [Response(404, {"name": "not_found", "message": "Domain not found"})]

    assert resend.get(CREDENTIAL, DOMAIN_ID) is None


def test_removing_a_domain_that_is_already_gone_is_gone(wire) -> None:
    _, answers = wire
    answers[("DELETE", f"/domains/{DOMAIN_ID}")] = [Response(404, {"name": "not_found", "message": "Domain not found"})]

    assert resend.remove(CREDENTIAL, DOMAIN_ID) is None


def test_finding_by_name_matches_case_insensitively_and_answers_none_for_a_stranger(wire) -> None:
    _, answers = wire
    answers[("GET", "/domains")] = [Response(200, {"object": "list", "data": [{"id": DOMAIN_ID, "name": "ACME.ca", "status": "verified"}]})]

    assert resend.find(CREDENTIAL, "acme.ca") == DOMAIN_ID
    assert resend.find(CREDENTIAL, "other.ca") is None


# --- refusals, each the narrowest thing it can be shown to mean -----------------------------------


@pytest.mark.parametrize("name", ["missing_api_key", "invalid_api_key", "restricted_api_key", "suspended_api_key"])
def test_a_rejected_credential_is_its_own_refusal_and_never_a_problem_with_the_domain(wire, name) -> None:
    _, answers = wire
    answers[("POST", "/domains")] = [Response(401, {"name": name, "message": "nope"})]

    with pytest.raises(CredentialRejected):
        resend.create(CREDENTIAL, "acme.ca")


def test_an_invalid_key_answers_the_identical_shape_a_rejected_domain_name_uses_and_is_still_told_apart(wire) -> None:
    # Confirmed against the live API (work order 1, section 33): Resend does not answer an invalid
    # key at 401 with `invalid_api_key` as its own documented names suggest -- it answers
    # `400 validation_error`, "API key is invalid", the identical status/name pair a rejected
    # domain name uses. Told apart by the message, which is what `_refused` now checks.
    _, answers = wire
    answers[("POST", "/domains")] = [Response(400, {"statusCode": 400, "message": "API key is invalid", "name": "validation_error"})]

    with pytest.raises(CredentialRejected):
        resend.create(CREDENTIAL, "acme.ca")


def test_find_also_tells_an_invalid_key_apart_from_a_malformed_list(wire) -> None:
    _, answers = wire
    answers[("GET", "/domains")] = [Response(400, {"statusCode": 400, "message": "API key is invalid", "name": "validation_error"})]

    with pytest.raises(CredentialRejected):
        resend.find(CREDENTIAL, "acme.ca")


def test_a_domain_resend_will_not_take_is_a_fact_about_the_name(wire) -> None:
    _, answers = wire
    answers[("POST", "/domains")] = [Response(403, {"name": "validation_error", "message": "not a domain we accept"})]
    answers[("GET", "/domains")] = [Response(200, {"object": "list", "data": []})]

    with pytest.raises(HostnameUnavailable):
        resend.create(CREDENTIAL, "acme.ca")


def test_a_server_error_is_a_plain_refusal_carrying_resend_s_own_words(wire) -> None:
    _, answers = wire
    answers[("GET", f"/domains/{DOMAIN_ID}")] = [Response(500, {"name": "internal", "message": "boom"})]

    with pytest.raises(UpstreamRefused) as refusal:
        resend.get(CREDENTIAL, DOMAIN_ID)
    assert "boom" in str(refusal.value)
    assert not isinstance(refusal.value, CredentialRejected)


def test_an_account_with_no_credential_stored_never_reaches_the_network(wire) -> None:
    sent, _ = wire

    with pytest.raises(UpstreamRefused):
        resend.get({"provider_key": "resend", "credential_kind": "api_key"}, DOMAIN_ID)
    assert sent == []


def test_a_non_json_answer_is_a_controlled_error(wire) -> None:
    _, answers = wire
    answers[("GET", f"/domains/{DOMAIN_ID}")] = [Response(200, "<html>maintenance</html>")]

    with pytest.raises(MalformedAnswer):
        resend.get(CREDENTIAL, DOMAIN_ID)


# --- ensure: the three ways a retry arrives ------------------------------------------------------


def test_an_id_already_recorded_reads_back_and_creates_nothing(wire) -> None:
    sent, answers = wire
    answers[("GET", f"/domains/{DOMAIN_ID}")] = [Response(200, domain("verified"))]

    status = resend.ensure(CREDENTIAL, "acme.ca", external_id=DOMAIN_ID)

    assert status.state == "active"
    assert [entry["method"] for entry in sent] == ["GET"]


def test_a_create_whose_answer_was_lost_is_found_by_name_rather_than_attempted_twice(wire) -> None:
    sent, answers = wire
    answers[("GET", "/domains")] = [Response(200, {"object": "list", "data": [{"id": DOMAIN_ID, "name": "acme.ca", "status": "pending"}]})]
    answers[("GET", f"/domains/{DOMAIN_ID}")] = [Response(200, domain("pending"))]

    status = resend.ensure(CREDENTIAL, "acme.ca")

    assert status.external_id == DOMAIN_ID
    assert all(entry["method"] == "GET" for entry in sent), "no domain was created"


def test_a_create_told_the_domain_is_registered_already_looks_once_more_before_giving_up(wire) -> None:
    _, answers = wire
    answers[("GET", "/domains")] = [
        Response(200, {"object": "list", "data": []}),
        Response(200, {"object": "list", "data": [{"id": DOMAIN_ID, "name": "acme.ca", "status": "pending"}]}),
    ]
    answers[("POST", "/domains")] = [Response(403, {"name": "validation_error", "message": "The acme.ca domain has been registered already"})]
    answers[("GET", f"/domains/{DOMAIN_ID}")] = [Response(200, domain("pending"))]

    status = resend.ensure(CREDENTIAL, "acme.ca")

    assert status.external_id == DOMAIN_ID


def test_ensure_with_a_rejected_credential_never_reads_as_a_domain_that_needs_creating(wire) -> None:
    # The exact path a browser hit against the live API: no id recorded yet, `ensure` asks `find`
    # first, and a bad key must surface as GildOps' own credential trouble rather than `ensure`
    # falling through to `create` and reporting a domain problem that was never the domain's.
    _, answers = wire
    answers[("GET", "/domains")] = [Response(400, {"statusCode": 400, "message": "API key is invalid", "name": "validation_error"})]

    with pytest.raises(CredentialRejected):
        resend.ensure(CREDENTIAL, "acme.ca")


def test_a_domain_registered_to_somebody_else_entirely_stays_a_refusal(wire) -> None:
    _, answers = wire
    answers[("GET", "/domains")] = [Response(200, {"object": "list", "data": []})]
    answers[("POST", "/domains")] = [Response(403, {"name": "validation_error", "message": "registered already"})]

    with pytest.raises(HostnameUnavailable):
        resend.ensure(CREDENTIAL, "acme.ca")


def test_an_id_resend_has_lost_falls_through_to_creating_it_again(wire) -> None:
    _, answers = wire
    answers[("GET", f"/domains/{DOMAIN_ID}")] = [Response(404, {"name": "not_found", "message": "gone"})]
    answers[("GET", "/domains")] = [Response(200, {"object": "list", "data": []})]
    answers[("POST", "/domains")] = [Response(200, domain())]

    assert resend.ensure(CREDENTIAL, "acme.ca", external_id=DOMAIN_ID).external_id == DOMAIN_ID


# --- the registry -----------------------------------------------------------------------------


def test_the_registry_answers_for_this_provider_and_for_no_other() -> None:
    assert email_domains_for("resend") is resend
    assert email_domains_for("vercel") is None
    assert email_domains_for("") is None
