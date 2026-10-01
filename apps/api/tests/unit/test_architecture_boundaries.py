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
