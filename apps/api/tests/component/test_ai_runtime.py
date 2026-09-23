"""Resolving which provider answers a capability: explicit beats implicit, and never fails over.

What Postgres decides -- that `resolve_ai_runtime_assignment` is granted to `provider_operator`
alone, that `record_ai_runtime_assignment` refuses a mismatched or uncredentialed account -- is
proven against a real database by the RLS/db-level suite (`docs/testing.md`'s db tier). What
belongs here is the fact about this process: no assignment falls back to the legacy default, an
assignment is authoritative, and a failure never becomes a silent vendor swap.
"""

from __future__ import annotations

import pytest

from app.ai import runtime as runtime_module
from app.ai.runtime import resolve_provider
from app.core.config import ProviderOperationsSettings

SETTINGS = ProviderOperationsSettings(
    supabase_url="http://db.test", supabase_publishable_key="anon", supabase_jwt_secret="signing"
)

ASSIGNMENT = {
    "provider_key": "openai",
    "provider_service_key": "responses",
    "provider_account_id": "acct-1",
    "model": "gpt-test",
}
CREDENTIAL = {"provider_key": "openai", "secret": "sk-test"}


def test_no_assignment_falls_back_to_the_legacy_default(monkeypatch) -> None:
    monkeypatch.setattr(runtime_module, "resolve_ai_runtime_assignment", lambda settings, *, capability: None)
    sentinel = object()
    monkeypatch.setattr(runtime_module, "answering_provider", lambda: sentinel)

    assert resolve_provider(SETTINGS, capability="operator_assistant") is sentinel


def test_unconfigured_settings_is_treated_like_no_assignment(monkeypatch) -> None:
    called = []
    monkeypatch.setattr(
        runtime_module,
        "resolve_ai_runtime_assignment",
        lambda settings, *, capability: called.append(1) or None,
    )
    sentinel = object()
    monkeypatch.setattr(runtime_module, "answering_provider", lambda: sentinel)

    assert resolve_provider(None, capability="operator_assistant") is sentinel
    # Never asked Postgres -- there is no signing secret to mint the token with.
    assert called == []


def test_an_explicit_assignment_instantiates_the_matching_adapter(monkeypatch) -> None:
    monkeypatch.setattr(
        runtime_module, "resolve_ai_runtime_assignment", lambda settings, *, capability: dict(ASSIGNMENT)
    )
    monkeypatch.setattr(
        runtime_module,
        "read_provider_account_credential",
        lambda settings, *, account_id: dict(CREDENTIAL) if account_id == "acct-1" else None,
    )

    built: dict = {}

    def factory(*, api_key, model):
        built["api_key"] = api_key
        built["model"] = model
        return "the-provider"

    monkeypatch.setattr(runtime_module, "adapter_for", lambda provider_key, service_key: factory)

    assert resolve_provider(SETTINGS, capability="operator_assistant") == "the-provider"
    assert built == {"api_key": "sk-test", "model": "gpt-test"}


def test_an_assignment_with_no_usable_credential_raises_rather_than_falling_back(monkeypatch) -> None:
    monkeypatch.setattr(
        runtime_module, "resolve_ai_runtime_assignment", lambda settings, *, capability: dict(ASSIGNMENT)
    )
    monkeypatch.setattr(runtime_module, "read_provider_account_credential", lambda settings, *, account_id: None)
    monkeypatch.setattr(runtime_module, "answering_provider", lambda: pytest.fail("must not fall back"))

    with pytest.raises(RuntimeError, match="no usable credential"):
        resolve_provider(SETTINGS, capability="operator_assistant")


def test_an_assignment_naming_an_unimplemented_service_raises_rather_than_falling_back(monkeypatch) -> None:
    monkeypatch.setattr(
        runtime_module, "resolve_ai_runtime_assignment", lambda settings, *, capability: dict(ASSIGNMENT)
    )
    monkeypatch.setattr(
        runtime_module, "read_provider_account_credential", lambda settings, *, account_id: dict(CREDENTIAL)
    )
    monkeypatch.setattr(runtime_module, "adapter_for", lambda provider_key, service_key: None)
    monkeypatch.setattr(runtime_module, "answering_provider", lambda: pytest.fail("must not fall back"))

    with pytest.raises(RuntimeError, match="no runtime implementation"):
        resolve_provider(SETTINGS, capability="operator_assistant")


def test_the_capability_is_forwarded_to_the_resolver(monkeypatch) -> None:
    seen = []
    monkeypatch.setattr(
        runtime_module,
        "resolve_ai_runtime_assignment",
        lambda settings, *, capability: seen.append(capability) or None,
    )
    monkeypatch.setattr(runtime_module, "answering_provider", lambda: None)

    resolve_provider(SETTINGS, capability="public_assistant")

    assert seen == ["public_assistant"]
