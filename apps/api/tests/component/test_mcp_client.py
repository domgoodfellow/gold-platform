"""The MCP client against a scripted server, over httpx's own mock transport.

Proves the protocol steps and what the transport refuses to do: connect anywhere but the address it
checked, follow a redirect, read past a size limit, wait on a stream that has already answered, or
accept a reply that is not a well-formed JSON-RPC answer. It does not prove a live server works.
"""

from __future__ import annotations

import itertools
import json

import httpx
import pytest

from app.connectors import mcp
from app.connectors.mcp import EndpointRefused, McpClient, validate_endpoint
from app.providers.providers import UpstreamRefused

PUBLIC = lambda host, port: ["93.184.216.34"]  # noqa: E731


class Script:
    """A server that answers JSON-RPC requests, and remembers every request it was sent."""

    def __init__(self, monkeypatch, *, tools=None, capabilities=None, version="2025-06-18") -> None:
        self.requests: list[httpx.Request] = []
        self.messages: list[dict] = []
        self.tools = tools if tools is not None else [{"name": "lookup", "description": "d", "inputSchema": {"type": "object"}, "annotations": {"readOnlyHint": True}}]
        self.capabilities = capabilities if capabilities is not None else {"tools": {}}
        self.version = version
        self.override = None
        monkeypatch.setattr(mcp, "_client", lambda **kw: httpx.Client(transport=httpx.MockTransport(self.handle), **kw))

    def handle(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(request)
        if request.method == "DELETE":
            return httpx.Response(405)
        message = json.loads(request.content)
        self.messages.append(message)
        if self.override is not None:
            return self.override(message) if callable(self.override) else self.override
        if "id" not in message:
            return httpx.Response(202)
        reply = lambda result: httpx.Response(200, json={"jsonrpc": "2.0", "id": message["id"], "result": result})  # noqa: E731
        method = message["method"]
        if method == "initialize":
            response = reply({"protocolVersion": self.version, "capabilities": self.capabilities, "serverInfo": {"name": "demo"}})
            response.headers["mcp-session-id"] = "sess-1"
            return response
        if method == "tools/list":
            if message["params"].get("cursor") == "p2":
                return reply({"tools": [{"name": "second"}]})
            return reply({"tools": self.tools, "nextCursor": "p2"})
        if method == "tools/call":
            body = {"jsonrpc": "2.0", "id": message["id"], "result": {"content": [{"type": "text", "text": "ok"}], "isError": False}}
            return httpx.Response(200, headers={"content-type": "text/event-stream"}, content=f"event: message\ndata: {json.dumps(body)}\n\n".encode())
        return httpx.Response(200, json={"jsonrpc": "2.0", "id": message["id"], "error": {"code": -32601, "message": "no such method"}})


def client(**kw) -> McpClient:
    return McpClient("https://mcp.example.test/mcp", resolver=PUBLIC, **kw)


@pytest.mark.parametrize(
    "url",
    [
        "http://mcp.example.test/mcp",
        "ftp://mcp.example.test/",
        "https://user:pw@mcp.example.test/",
        "https://127.0.0.1/mcp",
        "https://[::1]/mcp",
        "https://169.254.169.254/latest/meta-data",
        "https://10.0.0.5/mcp",
        "https://192.168.1.1/mcp",
        "https://[::ffff:127.0.0.1]/mcp",
        "https://0.0.0.0/mcp",
        "https://100.64.0.1/mcp",
        "not a url",
    ],
)
def test_unsafe_endpoints_are_refused_before_any_request(monkeypatch, url):
    script = Script(monkeypatch)
    with pytest.raises(EndpointRefused):
        validate_endpoint(url, PUBLIC)
    with pytest.raises(EndpointRefused):
        McpClient(url, resolver=PUBLIC)
    assert script.requests == []


def test_a_name_that_resolves_to_a_private_address_is_refused():
    with pytest.raises(EndpointRefused):
        validate_endpoint("https://mcp.example.test/", lambda h, p: ["93.184.216.34", "10.1.2.3"])


def test_the_connection_goes_to_the_checked_address_with_the_original_name(monkeypatch):
    """A name that resolves differently later changes nothing: the request is addressed to the IP that
    was checked, and the hostname is carried as `Host` and as the TLS server name."""
    resolutions = iter([["93.184.216.34"], ["10.0.0.9"]])
    script = Script(monkeypatch)
    c = McpClient("https://mcp.example.test/mcp", resolver=lambda h, p: next(resolutions))
    c.initialize()

    sent = script.requests[0]
    assert sent.url.host == "93.184.216.34"
    assert sent.headers["host"] == "mcp.example.test"
    assert sent.extensions["sni_hostname"] == "mcp.example.test"


def test_initialize_negotiates_and_carries_the_session_and_credential(monkeypatch):
    script = Script(monkeypatch)
    c = client(bearer="secret-token")
    c.initialize()

    assert c.protocol_version == "2025-06-18" and c.server_info == {"name": "demo"}
    assert [m.get("method") for m in script.messages] == ["initialize", "notifications/initialized"]
    assert script.requests[0].headers["authorization"] == "Bearer secret-token"
    assert script.requests[1].headers["mcp-session-id"] == "sess-1" and script.requests[1].headers["mcp-protocol-version"] == "2025-06-18"


def test_an_unsupported_protocol_version_is_refused(monkeypatch):
    Script(monkeypatch, version="1999-01-01")
    with pytest.raises(UpstreamRefused, match="protocol version"):
        client().initialize()


def test_tools_are_discovered_across_pages_and_hints_are_only_hints(monkeypatch):
    Script(monkeypatch)
    c = client()
    c.initialize()
    tools = c.list_tools()
    assert [t.name for t in tools] == ["lookup", "second"]
    assert tools[0].read_only_hint is True and tools[1].read_only_hint is None


def test_resources_and_prompts_are_not_asked_for_when_the_server_lacks_them(monkeypatch):
    script = Script(monkeypatch)
    c = client()
    c.initialize()
    assert c.list_resources() == [] and c.list_prompts() == []
    assert not any(m.get("method") in ("resources/list", "prompts/list") for m in script.messages)


def test_a_tool_call_reads_an_event_stream_answer(monkeypatch):
    script = Script(monkeypatch)
    c = client()
    c.initialize()
    result = c.call_tool("lookup", {"q": "x"})
    assert result == {"is_error": False, "content": [{"type": "text", "text": "ok"}], "structured": None}
    assert script.messages[-1]["params"] == {"name": "lookup", "arguments": {"q": "x"}}


def test_a_protocol_error_is_a_refusal_in_the_servers_words(monkeypatch):
    Script(monkeypatch)
    c = client()
    c.initialize()
    with pytest.raises(UpstreamRefused, match="no such method"):
        c._request("bogus", {})


def test_redirects_and_credential_failures_are_refused(monkeypatch):
    script = Script(monkeypatch)
    script.override = httpx.Response(302, headers={"location": "https://169.254.169.254/"})
    with pytest.raises(UpstreamRefused, match="redirected"):
        client().initialize()
    assert len(script.requests) == 1  # the redirect target was never requested
    script.override = httpx.Response(401)
    with pytest.raises(UpstreamRefused, match="credentials"):
        client().initialize()


def test_an_oversized_answer_stops_the_read_at_the_limit(monkeypatch):
    script = Script(monkeypatch)
    consumed = itertools.count()

    def endless():
        for _ in range(10_000):
            next(consumed)
            yield b"x" * 100_000

    script.override = httpx.Response(200, headers={"content-type": "application/json"}, content=endless())
    with pytest.raises(UpstreamRefused, match="too large"):
        client().initialize()
    assert next(consumed) <= 12  # about a megabyte read, then abandoned; not the gigabyte on offer


def test_an_event_stream_that_stays_open_is_cut_off_once_the_reply_arrives(monkeypatch):
    script = Script(monkeypatch)
    pulled = []

    def stream_that_never_ends(message):
        reply = {"jsonrpc": "2.0", "id": message["id"], "result": {"protocolVersion": "2025-06-18", "capabilities": {}}}
        yield f"data: {json.dumps(reply)}\n\n".encode()
        for _ in range(1_000_000):
            pulled.append(1)
            yield b": keep-alive\n\n"

    script.override = lambda message: httpx.Response(200, headers={"content-type": "text/event-stream"}, content=stream_that_never_ends(message)) if "id" in message else httpx.Response(202)
    c = client()
    c.initialize()
    assert c.protocol_version == "2025-06-18" and len(pulled) == 0


def test_a_stream_that_never_answers_is_cut_off_by_the_total_deadline(monkeypatch):
    script = Script(monkeypatch)
    clock = itertools.count(0, 10)
    monkeypatch.setattr(mcp.time, "monotonic", lambda: next(clock))

    def drip(message):
        for _ in range(1_000):
            yield b": still thinking\n\n"

    script.override = lambda message: httpx.Response(200, headers={"content-type": "text/event-stream"}, content=drip(message))
    with pytest.raises(UpstreamRefused, match="too long"):
        client().initialize()


@pytest.mark.parametrize(
    "reply",
    [
        {"id": 1, "result": {}},  # not jsonrpc 2.0
        {"jsonrpc": "2.0", "id": 1},  # neither result nor error
        {"jsonrpc": "2.0", "id": 1, "result": {}, "error": {"message": "x"}},  # both
    ],
)
def test_a_malformed_json_rpc_reply_is_rejected(monkeypatch, reply):
    script = Script(monkeypatch)
    script.override = httpx.Response(200, json=reply)
    with pytest.raises(UpstreamRefused, match="malformed"):
        client().initialize()


def test_an_answer_that_is_not_json_or_for_another_request_is_not_accepted(monkeypatch):
    script = Script(monkeypatch)
    script.override = httpx.Response(200, headers={"content-type": "application/json"}, content=b"<html>")
    with pytest.raises(UpstreamRefused, match="not JSON"):
        client().initialize()
    script.override = httpx.Response(200, json={"jsonrpc": "2.0", "id": 99, "result": {}})
    with pytest.raises(UpstreamRefused, match="did not answer"):
        client().initialize()


def test_discovery_is_bounded_in_pages_and_in_size(monkeypatch):
    script = Script(monkeypatch)
    pages = []

    def endless(message):
        if message["method"] == "initialize":
            return httpx.Response(200, json={"jsonrpc": "2.0", "id": message["id"], "result": {"protocolVersion": "2025-06-18", "capabilities": {}}})
        if "id" not in message:
            return httpx.Response(202)
        pages.append(1)
        tools = [{"name": f"t{len(pages)}-{i}"} for i in range(60)]
        return httpx.Response(200, json={"jsonrpc": "2.0", "id": message["id"], "result": {"tools": tools, "nextCursor": "more"}})

    script.override = endless
    c = client()
    c.initialize()
    with pytest.raises(UpstreamRefused, match="more than this runtime will take"):
        c.list_tools()
    assert len(pages) < mcp.MAX_PAGES + 1


def test_close_ends_a_session_without_failing_when_the_server_refuses(monkeypatch):
    script = Script(monkeypatch)
    c = client()
    c.initialize()
    c.close()
    assert script.requests[-1].method == "DELETE" and script.requests[-1].url.host == "93.184.216.34"
