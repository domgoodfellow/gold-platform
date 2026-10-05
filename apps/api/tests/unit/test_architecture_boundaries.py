"""Phase C, Slice 11 — the corrected `app/` boundary `app/domains/__init__.py` now describes in
words: domains are provider-independent, caller-independent commands; services are application
orchestration that crosses the persistence/provider/connector boundary; providers and connectors
are vendor dialects; ``api`` is HTTP handling alone. Each layer earns that description only by
being unable to import the ones that sit above or beside it the wrong way.

Static import scans, in the same spirit as the TypeScript side's
`apps/web/tests/architecture/static/application-layer-boundary.test.ts` — no server, no database,
just the source tree.
"""

from __future__ import annotations

import ast
from pathlib import Path

APP = Path(__file__).resolve().parents[2] / "app"
API = Path(__file__).resolve().parents[2] / "api"


def _python_files(root: Path) -> list[Path]:
    return [path for path in root.rglob("*.py") if "__pycache__" not in path.parts]


def _imported_modules(path: Path) -> list[str]:
    """Every module an `import`/`from ... import` statement names, dotted path as written."""
    tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
    names: list[str] = []
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            names.extend(alias.name for alias in node.names)
        elif isinstance(node, ast.ImportFrom) and node.module and node.level == 0:
            names.append(node.module)
    return names


def _offenders(root: Path, forbidden_prefixes: tuple[str, ...]) -> list[str]:
    offenders: list[str] = []
    for path in _python_files(root):
        for module in _imported_modules(path):
            if any(module == prefix or module.startswith(f"{prefix}.") for prefix in forbidden_prefixes):
                offenders.append(f"{path.relative_to(root.parent)}: {module}")
    return offenders


def test_finds_the_layers_so_the_rule_is_not_passing_over_an_empty_tree() -> None:
    assert len(_python_files(APP / "domains")) > 3
    assert len(_python_files(APP / "services")) > 3
    assert len(_python_files(APP / "providers")) > 3


def test_domains_are_provider_and_caller_independent() -> None:
    # A domain command forwards the caller's own token and calls a narrow database function; it
    # never reaches a vendor dialect, an orchestrating service, or back up into HTTP handling.
    offenders = _offenders(APP / "domains", ("app.providers", "app.connectors", "app.services", "api"))
    assert offenders == []


def test_services_orchestrate_without_being_called_back_into_by_a_handler() -> None:
    # The dependency is one-directional: `api/*.py` may call into `app.services`, but nothing
    # under `app.services` may import an HTTP handler — that would be the orchestration layer
    # taking a dependency on the thing that is supposed to call it.
    offenders = _offenders(APP / "services", ("api",))
    assert offenders == []


def test_providers_and_connectors_know_no_orchestration_above_them() -> None:
    # A vendor dialect translates that vendor's shape; it is used by a service, never the other
    # way round, and it never reaches HTTP handling either.
    offenders = _offenders(APP / "providers", ("app.services", "api"))
    offenders += _offenders(APP / "connectors", ("app.services", "api"))
    assert offenders == []


def test_the_domains_package_no_longer_holds_what_moved_to_services() -> None:
    # 20260930's services move (Slice 11) retired these three domains sub-packages; their
    # presence again would mean the boundary correction regressed rather than held.
    for retired in ("integrations", "providers", "web_delivery"):
        assert not (APP / "domains" / retired).exists()
    assert not (APP / "domains" / "errors.py").exists()
    assert (APP / "errors.py").exists()


# --- the AI runtime: the platform's words once, a tenant's words apart, no env read in an adapter ----


def test_the_platforms_prompts_are_written_once_and_a_tenants_words_are_never_context() -> None:
    from app.ai import prompts

    # Each adapter asks `system_prompt`; none carries a copy of the rules, and none decides who a
    # conversation is with by sniffing a prefix in the application's own `context`.
    adapters = sorted((APP / "providers").glob("*/answering.py"))
    assert len(adapters) == 4
    for path in adapters:
        text = path.read_text(encoding="utf-8")
        assert "system_prompt(audience)" in text, path.name
        assert "SYSTEM =" not in text and "PUBLIC_SYSTEM" not in text, path
        assert "PUBLIC WEBSITE DEPLOYMENT" not in text, path

    assert "PUBLIC WEBSITE DEPLOYMENT" not in (API / "public_chat.py").read_text(encoding="utf-8")
    assert set(prompts._PROMPTS) == {"operator", "public", "drafting"}


def test_no_provider_adapter_reads_the_environment_or_names_a_model() -> None:
    import re

    # A credential and a model are handed in (`app.ai.adapters`, from the assignment); the one
    # place that reads the environment is the documented fallback, `app.ai.registry`.
    for path in (APP / "providers").glob("*/answering.py"):
        text = path.read_text(encoding="utf-8")
        assert "os.environ" not in text, path
        assert not re.search(r"""["'](claude-|gpt-|gemini-)""", text), path


def test_only_the_runtime_handlers_and_metering_may_write_usage() -> None:
    # `app.core.db.record_ai_usage` is the one caller of the database door, and `app.ai.metering`
    # the one caller of that; the loop and the adapters know no database.
    callers = {
        path.relative_to(APP.parent).as_posix()
        for path in _python_files(APP.parent)
        if "tests" not in path.parts and "record_ai_usage" in path.read_text(encoding="utf-8")
    }
    assert callers == {"app/core/db.py", "app/ai/metering.py"}
