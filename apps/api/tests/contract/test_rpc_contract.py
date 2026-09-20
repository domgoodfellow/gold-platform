"""The names of the arguments Python sends to Postgres, held against the contract file.

`apps/api` calls a database function over PostgREST by naming its arguments, and PostgREST matches
them to the function's own parameter names: send `p_something` to a function that now expects
something else and the call is a 404 at runtime, in a webhook or in front of a customer. Nothing
here can see the database. What it can do is hold Python to `tests/rpc_contract.json`, so that the
other half -- `apps/web/tests/architecture/database/python-rpc-surface.test.ts`, which holds that
same file to `pg_proc` -- means something.

Both directions: what the file says Python sends must be what Python sends, and every
`"p_..."` argument named in a calling file must be in the file. The assistant's tools are read from
the real `TOOLS` schemas rather than from source, because they name arguments without the prefix.
"""

from __future__ import annotations

import json
import re
from pathlib import Path

from app.ai.tools import TOOLS

API = Path(__file__).resolve().parents[2]
CONTRACT = json.loads((Path(__file__).resolve().parents[1] / "rpc_contract.json").read_text(encoding="utf-8"))["functions"]

# `app/ai/loop.py` adds the organization to every tool call itself, which is why every tool sends it.
INJECTED = {("app/ai/loop.py", "p_organization_id")}


def source(relative: str) -> str:
    return (API / relative).read_text(encoding="utf-8")


def literals(text: str) -> set[str]:
    return set(re.findall(r"""["']([a-z_0-9]+)["']""", text))


def test_every_tool_sends_exactly_what_the_contract_says() -> None:
    for tool in TOOLS:
        properties = list(tool.schema.get("properties", {}))
        required = set(tool.schema.get("required", []))
        entry = CONTRACT[tool.function]

        assert set(entry["sends"]) == {"p_organization_id", *(f"p_{name}" for name in properties)}, tool.function
        assert set(entry.get("optional", [])) == {f"p_{name}" for name in properties if name not in required}, tool.function


def test_the_contract_names_no_tool_that_does_not_exist() -> None:
    declared = {name for name, entry in CONTRACT.items() if entry["callers"] == ["app/ai/tools.py"]}

    assert declared == {tool.function for tool in TOOLS}


def test_every_argument_the_contract_promises_is_named_in_the_calling_file() -> None:
    missing = []
    for name, entry in CONTRACT.items():
        if entry["callers"] == ["app/ai/tools.py"]:
            continue  # held against the real schemas above
        for caller in entry["callers"]:
            found = literals(source(caller))
            for argument in entry["sends"]:
                spelled = argument.removeprefix("p_") if entry.get("naming") == "bare" else argument
                if spelled not in found:
                    missing.append(f"{name}: {caller} never names {spelled!r}")

    assert missing == []


def test_every_p_argument_a_calling_file_names_is_in_the_contract() -> None:
    allowed: dict[str, set[str]] = {}
    for entry in CONTRACT.values():
        for caller in entry["callers"]:
            allowed.setdefault(caller, set()).update(entry["sends"])

    unknown = []
    for path in sorted((API / "app").rglob("*.py")):
        relative = path.relative_to(API).as_posix()
        for argument in sorted(name for name in literals(path.read_text(encoding="utf-8")) if re.fullmatch(r"p_[a-z_0-9]+", name)):
            if argument not in allowed.get(relative, set()) and (relative, argument) not in INJECTED:
                unknown.append(f"{relative} names {argument!r}, which no contract entry for it sends")

    assert unknown == []
