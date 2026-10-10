"""Where a credential may be read, and who may reach the doors that read one.

Static scans of the source tree -- no server, no database -- in the same spirit as
`test_architecture_boundaries.py`. Three kinds of credential reach this runtime and each has exactly
one reader: GildOps' own provider-account credential, a business's delegated sign-in, and a
business's stored private value. A connector is a vendor *dialect*; it asks a vendor questions and
holds no door onto Vault, so a new vendor cannot arrive carrying a second way to decrypt.
"""

from __future__ import annotations

import ast
import re
from pathlib import Path

APP = Path(__file__).resolve().parents[2] / "app"
CONNECTORS = APP / "connectors"
DB = APP / "core" / "db.py"

READERS = ("read_integration_credential", "read_provider_account_credential", "resolve_secret_reference")


def _files(root: Path) -> list[Path]:
    return [path for path in root.rglob("*.py") if "__pycache__" not in path.parts]


def _imports(path: Path) -> list[str]:
    names: list[str] = []
    for node in ast.walk(ast.parse(path.read_text(encoding="utf-8"))):
        if isinstance(node, ast.Import):
            names.extend(alias.name for alias in node.names)
        elif isinstance(node, ast.ImportFrom) and node.module and node.level == 0:
            names.append(node.module)
    return names


def test_there_are_connectors_to_scan() -> None:
    assert len(_files(CONNECTORS)) > 5


def test_a_connector_cannot_reach_the_database_layer_or_a_credential_reader() -> None:
    """A connector is handed a token by `app.services.integrations`; it never fetches one, and so
    cannot be the way a credential is read around the canonical door."""
    offenders = []
    for path in _files(CONNECTORS):
        imports = _imports(path)
        if any(m == "app.core.db" or m.startswith("app.core.db.") or m == "app.core" for m in imports):
            offenders.append(f"{path.name} imports the database layer")
        text = path.read_text(encoding="utf-8")
        offenders.extend(f"{path.name} names {reader}" for reader in READERS if reader in text)
    assert offenders == []


def test_only_the_registry_reads_the_environment_for_a_connector() -> None:
    """A vendor's registration is named once, in the registry, so readiness and the handshake cannot
    disagree about what a deployment holds. An adapter that read its own environment would be a
    second answer to *is this configured*."""
    offenders = [
        path.name
        for path in _files(CONNECTORS)
        if path.name != "__init__.py" and re.search(r"\bos\.(environ|getenv)\b", path.read_text(encoding="utf-8"))
    ]
    assert offenders == []


def _callers(reader: str) -> set[str]:
    """Modules, as `app/...` paths, that call a reader. `app/core/db.py` defines them and is not a caller."""
    found: set[str] = set()
    for path in _files(APP):
        if path != DB and re.search(rf"\b{reader}\s*\(", path.read_text(encoding="utf-8")):
            found.add(path.relative_to(APP.parent).as_posix())
    return found


def test_a_business_s_stored_value_has_no_caller_yet() -> None:
    """The first runtime that needs one (a Studio deployment) adds itself here, by editing this test."""
    assert _callers("resolve_secret_reference") == set()


def test_a_business_s_delegated_credential_is_read_only_where_it_is_used() -> None:
    assert _callers("read_integration_credential") <= {
        "app/services/integrations/credentials.py",
        "app/services/dns/operations.py",
    }


def test_no_http_handler_reads_a_business_s_credential_directly() -> None:
    """Handlers call a service that proves the caller first (`require_caller`, then RLS); a handler
    that read a business's credential itself would skip that proof."""
    offenders = []
    for path in _files(APP.parent / "api"):
        text = path.read_text(encoding="utf-8")
        offenders.extend(f"{path.name} names {name}" for name in ("read_integration_credential", "resolve_secret_reference") if name in text)
    assert offenders == []
