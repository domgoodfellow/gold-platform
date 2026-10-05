"""Drafting a configuration runs through the same runtime as every other AI capability.

What is asserted is this endpoint's own ordering and contract: the caller is proved, the business
must hold guided setup, the provider is the one assigned to `configuration_drafting`, the model is
given exactly one way to answer and that way performs nothing, and what it consumed is metered.
What the proposal is *worth* is `apps/web`'s to judge (the domain layer is the guarantee).
"""

from __future__ import annotations

import io
import json
from types import SimpleNamespace

import pytest

import api.ai_draft_configuration as draft
from app.ai import ModelUsage
from app.ai.loop import Answer, ProposedAction

SETTINGS = SimpleNamespace(supabase_url="http://db.test", supabase_publishable_key="anon")
SCHEMA = {"type": "object", "properties": {"shape": {"type": "object"}}, "required": ["shape"]}
BODY = {"question": "We fix boats.", "organization_id": "org-1", "schema": SCHEMA}


class Sink:
    def __init__(self, result=True) -> None:
        self.calls: list[tuple] = []
        self.result = result

    def __call__(self, *args, **kwargs):
        self.calls.append((args, kwargs))
        return self.result


def post(headers: dict[str, str], body: dict | bytes):
    raw = body if isinstance(body, bytes) else json.dumps(body).encode()
    instance = draft.handler.__new__(draft.handler)
    instance.headers = {key.lower(): value for key, value in {"content-length": str(len(raw)), **headers}.items()}
    instance.rfile = io.BytesIO(raw)
    instance.wfile = io.BytesIO()
    sent: dict = {}
    instance.send_response = lambda status: sent.update(status=status)
    instance.send_header = lambda *a: None
    instance.end_headers = lambda: None
    instance.do_POST()
    return sent["status"], json.loads(instance.wfile.getvalue() or b"{}")


@pytest.fixture
def armed(monkeypatch):
    monkeypatch.setattr(draft, "load_assistant_settings", lambda: SETTINGS)
    monkeypatch.setattr(draft, "load_provider_operations_settings", lambda: SETTINGS)
    monkeypatch.setattr(draft, "require_caller", lambda headers, **kw: SimpleNamespace(token="callers-token"))
    asked: list[dict] = []
    monkeypatch.setattr(draft, "holds_module", lambda settings, **kw: asked.append(kw) or True)
    resolved: list[str] = []
    provider = SimpleNamespace(name="model-x", provider_key="anthropic")
    monkeypatch.setattr(draft, "resolve_provider", lambda settings, *, capability: resolved.append(capability) or provider)
    proposal = ProposedAction(name="submit_configuration", arguments={"shape": {"typeName": "Repair"}}, because="")
    ran = Sink(Answer(outcome="answered", action=proposal, usage=ModelUsage(900, 400)))
    monkeypatch.setattr(draft, "answer", ran)
    metered = Sink("recorded")
    monkeypatch.setattr(draft, "meter", metered)
    return SimpleNamespace(asked=asked, resolved=resolved, ran=ran, metered=metered)


def test_an_unauthenticated_request_resolves_nothing(monkeypatch, armed) -> None:
    from app.auth import AuthError

    def refuse(headers, **kw):
        raise AuthError(401, "sign in")

    monkeypatch.setattr(draft, "require_caller", refuse)

    status, _ = post({}, BODY)

    assert status == 401
    assert armed.resolved == [] and armed.ran.calls == [] and armed.asked == []


def test_a_business_without_guided_setup_is_refused_before_anything_is_spent(monkeypatch, armed) -> None:
    monkeypatch.setattr(draft, "holds_module", lambda settings, **kw: armed.asked.append(kw) or False)

    status, body = post({}, BODY)

    assert status == 403 and body["code"] == "not_entitled"
    assert armed.asked == [{"token": "callers-token", "organization_id": "org-1", "module_key": "drafting"}]
    assert armed.resolved == [] and armed.ran.calls == [] and armed.metered.calls == []


def test_a_malformed_request_is_rejected_before_any_check(armed) -> None:
    for body in (
        {"question": "", "organization_id": "o", "schema": SCHEMA},
        {"question": "q", "organization_id": "", "schema": SCHEMA},
        {"question": "q", "organization_id": "o"},
        {"question": "q", "organization_id": "o", "schema": {"type": "array"}},
        {"question": "q", "organization_id": "o", "schema": {"type": "object", "x": "y" * 70_000}},
    ):
        assert post({}, body)[0] == 400
    assert armed.asked == [] and armed.ran.calls == []


def test_the_assigned_provider_answers_and_its_one_way_to_answer_performs_nothing(armed) -> None:
    status, body = post({}, BODY)

    assert status == 200
    assert body["outcome"] == "drafted"
    assert body["configuration"] == {"shape": {"typeName": "Repair"}}
    assert body["answered_by"] == "model-x" and body["metering"] == "recorded"
    assert armed.resolved == ["configuration_drafting"]

    sent = armed.ran.calls[0][1]
    assert sent["audience"] == "drafting" and sent["tools"] == ()
    (action,) = sent["actions"]
    assert action.name == "submit_configuration" and action.function == "" and action.schema == SCHEMA
    assert armed.metered.calls[0][1]["capability"] == "configuration_drafting"
    assert armed.metered.calls[0][1]["organization_id"] == "org-1"


def test_a_model_that_answers_in_words_has_declined_and_is_still_metered(monkeypatch, armed) -> None:
    monkeypatch.setattr(draft, "answer", Sink(Answer(outcome="answered", text="I cannot do that.", usage=ModelUsage(10, 5))))

    status, body = post({}, BODY)

    assert status == 200 and body["outcome"] == "declined" and body["configuration"] is None
    assert len(armed.metered.calls) == 1


def test_a_failure_is_a_failure_and_not_a_decline(monkeypatch, armed) -> None:
    monkeypatch.setattr(draft, "answer", Sink(Answer(outcome="failed", detail="boom")))

    _, body = post({}, BODY)

    assert body["outcome"] == "failed" and body["detail"] == "boom"


def test_a_deployment_with_no_model_says_so(monkeypatch, armed) -> None:
    monkeypatch.setattr(draft, "resolve_provider", lambda settings, *, capability: None)

    status, _ = post({}, BODY)

    assert status == 503 and armed.ran.calls == []
