"""Checking a caller's arguments against a tool's declared inputs, and describing a third party's
tool to a model without trusting it.

**Deliberately small.** It understands the keywords that bound what a value can be (`type`,
`required`, `properties`, `additionalProperties`, `enum`, `const`, `items`, length and range limits)
and ignores every other keyword. It resolves no `$ref`, follows no URL and compiles no regular
expression: a schema comes from a native connector (ours) or from an MCP server (someone else's), and
neither may make this process do work of the server's choosing. The server validates again; this is
the first line, not the only one.
"""

from __future__ import annotations

import json
from collections.abc import Mapping

MAX_DEPTH = 6
MAX_PROPERTIES = 40
MAX_SCHEMA_BYTES = 6_000
MAX_DESCRIPTION = 400

_TYPES = {
    "string": lambda v: isinstance(v, str),
    "integer": lambda v: isinstance(v, int) and not isinstance(v, bool),
    "number": lambda v: isinstance(v, (int, float)) and not isinstance(v, bool),
    "boolean": lambda v: isinstance(v, bool),
    "object": lambda v: isinstance(v, dict),
    "array": lambda v: isinstance(v, list),
    "null": lambda v: v is None,
}


def problems(schema: Mapping[str, object], value: object, *, path: str = "arguments", depth: int = 0) -> list[str]:
    """Why `value` does not fit `schema`, as short sentences; empty when it fits."""
    if depth > MAX_DEPTH:
        return []
    found: list[str] = []

    declared = schema.get("type")
    kinds = declared if isinstance(declared, list) else [declared] if isinstance(declared, str) else []
    kinds = [k for k in kinds if k in _TYPES]
    if kinds and not any(_TYPES[k](value) for k in kinds):
        return [f"{path} must be {' or '.join(kinds)}"]

    if "const" in schema and value != schema["const"]:
        found.append(f"{path} has the wrong value")
    enum = schema.get("enum")
    if isinstance(enum, list) and value not in enum:
        found.append(f"{path} is not one of the allowed values")

    if isinstance(value, str):
        if isinstance(schema.get("maxLength"), int) and len(value) > schema["maxLength"]:  # type: ignore[operator]
            found.append(f"{path} is too long")
        if isinstance(schema.get("minLength"), int) and len(value) < schema["minLength"]:  # type: ignore[operator]
            found.append(f"{path} is too short")
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        if isinstance(schema.get("maximum"), (int, float)) and value > schema["maximum"]:  # type: ignore[operator]
            found.append(f"{path} is too large")
        if isinstance(schema.get("minimum"), (int, float)) and value < schema["minimum"]:  # type: ignore[operator]
            found.append(f"{path} is too small")

    if isinstance(value, list):
        if isinstance(schema.get("maxItems"), int) and len(value) > schema["maxItems"]:  # type: ignore[operator]
            found.append(f"{path} has too many items")
        items = schema.get("items")
        if isinstance(items, dict):
            for index, item in enumerate(value[:100]):
                found.extend(problems(items, item, path=f"{path}[{index}]", depth=depth + 1))

    if isinstance(value, dict):
        properties = schema.get("properties") if isinstance(schema.get("properties"), dict) else {}
        required = schema.get("required") if isinstance(schema.get("required"), list) else []
        for name in required:
            if isinstance(name, str) and name not in value:
                found.append(f"{path}.{name} is required")
        if schema.get("additionalProperties") is False:
            for name in value:
                if name not in properties:
                    found.append(f"{path}.{name} is not an input of this tool")
        for name, sub in properties.items():
            if name in value and isinstance(sub, dict):
                found.extend(problems(sub, value[name], path=f"{path}.{name}", depth=depth + 1))

    return found[:5]


def displayable_schema(schema: object) -> dict:
    """A bounded copy of a tool's input schema that is safe to put in front of a model.

    Keeps only keywords that describe the shape of a value, cuts every description short and caps
    depth, property count and total size. Anything that does not fit becomes a plain "an object".
    """
    if not isinstance(schema, dict):
        return {"type": "object", "properties": {}}
    cleaned = _clean(schema, 0)
    if cleaned.get("type") != "object":
        cleaned = {"type": "object", "properties": {}}
    if len(json.dumps(cleaned)) > MAX_SCHEMA_BYTES:
        return {"type": "object", "properties": {}}
    return cleaned


_KEEP = ("type", "enum", "const", "required", "minimum", "maximum", "minLength", "maxLength", "maxItems")


def _clean(node: dict, depth: int) -> dict:
    out: dict = {}
    for keyword in _KEEP:
        if keyword in node and isinstance(node[keyword], (str, int, float, bool, list)):
            value = node[keyword]
            if isinstance(value, list):
                value = [v for v in value if isinstance(v, (str, int, float, bool))][:50]
            out[keyword] = value
    if isinstance(node.get("description"), str):
        out["description"] = prose(node["description"])
    if depth < MAX_DEPTH:
        if isinstance(node.get("properties"), dict):
            out["properties"] = {
                str(name)[:64]: _clean(sub, depth + 1)
                for name, sub in list(node["properties"].items())[:MAX_PROPERTIES]
                if isinstance(sub, dict)
            }
        if isinstance(node.get("items"), dict):
            out["items"] = _clean(node["items"], depth + 1)
    if out.get("type") == "object" or "properties" in out:
        out["additionalProperties"] = False if "properties" in out else True
    return out


def prose(text: str, limit: int = MAX_DESCRIPTION) -> str:
    """Third-party words shortened and stripped of control characters before they reach a prompt."""
    cleaned = "".join(ch if ch.isprintable() or ch in "\n " else " " for ch in text)
    return " ".join(cleaned.split())[:limit]
