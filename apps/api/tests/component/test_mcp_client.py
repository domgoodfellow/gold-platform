"""The MCP client against a scripted server: the protocol steps, and what it refuses to do."""

from __future__ import annotations

import json

import httpx
import pytest

from app.connectors import mcp
from app.connectors.mcp import EndpointRefused, McpClient, validate_endpoint
from app.providers.providers import UpstreamRefused

PUBLIC = lambda host, port: ["93.184.216.34"]  # noqa: E731


class Reply:
    def __init__(self, status=200, body=None, kind="application/json", headers=None, text=None) -> None:
        self.status_code = status
        payload = text if text is not None else json.dumps(body)
        self.text, self.content = payload, payload.encode()
        self.headers = {"content-type": kind, **(headers or {})}

    def json(self):
        return json.loads(self.text)


class Server:
    def __init__(self, monkeypatch, tools=None, capabilities=None, version="2025-06-18") -> None:
        self.sent: list[dict] = []
        self.headers: list[dict] = []
        self.tools = tools if tools is not None else [{"name": "lookup", "description": "d", "inputSchema": {"type": "object"}, "annotations": {"readOnlyHint": True}}]
        self.capabilities = capabilities if capabilities is not None else {"tools": {}}
        self.version = version
        self.override = None
        monkeypatch.setattr(httpx, "post", self._post)
        monkeypatch.setattr(httpx, "request", lambda method, url, **kw: self.sent.append({"method": method}) or Reply(405, {}))

    def _post(self, url, *, headers, content, **kwargs):
        assert kwargs.get("follow_redirects") is False
        message = json.loads(content)
        self.sent.append(message)
        self.headers.append(headers)
        if self.override:
            return self.override
        if "id" not in message:
            return Reply(202, {})
        method = message["method"]
        if method == "initialize":
            result = {"protocolVersion": self.version, "capabilities": self.capabilities, "serverInfo": {"name": "demo"}}
            return Reply(body={"jsonrpc": "2.0", "id": message["id"], "result": result}, headers={"mcp-session-id": "sess-1"})
        if method == "tools/list":
            if message["params"].get("cursor") == "p2":
                result = {"tools": [{"name": "second"}]}
            else:
                result = {"tools": self.tools, "nextCursor": "p2"}
            return Reply(body={"jsonrpc": "2.0", "id": message["id"], "result": result})
        if method == "tools/call":
            result = {"content": [{"type": "text", "text": "ok"}], "isError": False}
            return Reply(kind="text/event-stream", text=f"event: message\ndata: {json.dumps({'jsonrpc': '2.0', 'id': message['id'], 'result': result})}\n\n")
        return Reply(body={"jsonrpc": "2.0", "id": message["id"], "error": {"code": -32601, "message": "no such method"}})


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
        "not a url",
    ],
)
def test_unsafe_endpoints_are_refused_before_any_request(monkeypatch, url):
    server = Server(monkeypatch)
    with pytest.raises(EndpointRefused):
        validate_endpoint(url, PUBLIC)
    assert server.sent == []


def test_a_name_that_resolves_to_a_private_address_is_refused():
    with pytest.raises(EndpointRefused):
        validate_endpoint("https://mcp.example.test/", lambda h, p: ["93.184.216.34", "10.1.2.3"])


def test_initialize_negotiates_and_carries_the_session_and_credential(monkeypatch):
    server = Server(monkeypatch)
    c = client(bearer="secret-token")
    c.initialize()

    assert c.protocol_version == "2025-06-18" and c.server_info == {"name": "demo"}
    assert [m.get("method") for m in server.sent] == ["initialize", "notifications/initialized"]
    assert server.headers[0]["Authorization"] == "Bearer secret-token"
    assert server.headers[1]["Mcp-Session-Id"] == "sess-1" and server.headers[1]["MCP-Protocol-Version"] == "2025-06-18"


def test_an_unsupported_protocol_version_is_refused(monkeypatch):
    Server(monkeypatch, version="1999-01-01")
    with pytest.raises(UpstreamRefused, match="protocol version"):
        client().initialize()


def test_tools_are_discovered_across_pages_and_hints_are_only_hints(monkeypatch):
    Server(monkeypatch)
    c = client()
    c.initialize()
    tools = c.list_tools()
    assert [t.name for t in tools] == ["lookup", "second"]
    assert tools[0].read_only_hint is True and tools[1].read_only_hint is None


def test_resources_and_prompts_are_not_asked_for_when_the_server_lacks_them(monkeypatch):
    server = Server(monkeypatch)
    c = client()
    c.initialize()
    assert c.list_resources() == [] and c.list_prompts() == []
    assert not any(m.get("method") in ("resources/list", "prompts/list") for m in server.sent)


def test_a_tool_call_reads_an_event_stream_answer(monkeypatch):
    server = Server(monkeypatch)
    c = client()
    c.initialize()
    result = c.call_tool("lookup", {"q": "x"})
    assert result == {"is_error": False, "content": [{"type": "text", "text": "ok"}], "structured": None}
    assert server.sent[-1]["params"] == {"name": "lookup", "arguments": {"q": "x"}}


def test_a_protocol_error_is_a_refusal_in_the_servers_words(monkeypatch):
    Server(monkeypatch)
    c = client()
    c.initialize()
    with pytest.raises(UpstreamRefused, match="no such method"):
        c._request("bogus", {})


def test_redirects_credential_failures_and_oversize_answers_are_refused(monkeypatch):
    server = Server(monkeypatch)
    c = client()
    server.override = Reply(302, {})
    with pytest.raises(UpstreamRefused, match="redirected"):
        c.initialize()
    server.override = Reply(401, {})
    with pytest.raises(UpstreamRefused, match="credentials"):
        c.initialize()
    server.override = Reply(text="x" * (mcp.MAX_RESPONSE_BYTES + 1))
    with pytest.raises(UpstreamRefused, match="too large"):
        c.initialize()


def test_an_answer_that_does_not_match_the_request_is_not_accepted(monkeypatch):
    server = Server(monkeypatch)
    server.override = Reply(body={"jsonrpc": "2.0", "id": 99, "result": {}})
    with pytest.raises(UpstreamRefused, match="did not answer"):
        client().initialize()


def test_close_ends_a_session_without_failing_when_the_server_refuses(monkeypatch):
    server = Server(monkeypatch)
    c = client()
    c.initialize()
    c.close()
    assert server.sent[-1] == {"method": "DELETE"}
