"""A client for a remotely hosted MCP server, over Streamable HTTP.

An MCP server is an arbitrary third party, so nothing it says is trusted: the endpoint is checked before
any request (`validate_endpoint`), redirects are never followed, every answer is size-bounded, and what a
tool returns is data for the caller to treat as untrusted input. Which tools a business enables, who they
are granted to and whether a call needs approval is decided by the caller, never by what the server
advertises; this module only speaks the protocol.

Residual risk: the address is checked when resolved here, and the HTTP client resolves again when it
connects. A hostname that answers differently the second time (DNS rebinding) is not stopped by this
module alone; the deployment's egress rules are the second line.
"""

from __future__ import annotations

import ipaddress
import json
import socket
from collections.abc import Callable
from dataclasses import dataclass
from urllib.parse import urlsplit

import httpx

from app.providers.providers import UpstreamRefused

PROTOCOL_VERSIONS = ("2025-06-18", "2025-03-26")
MAX_RESPONSE_BYTES = 1_000_000
MAX_PAGES = 10
TIMEOUT_SECONDS = 15.0
CLIENT_INFO = {"name": "gildops", "version": "1"}


class EndpointRefused(ValueError):
    """The endpoint may not be used, and nothing was sent to it."""


Resolver = Callable[[str, int], list[str]]


def _resolve(host: str, port: int) -> list[str]:
    try:
        return [str(info[4][0]) for info in socket.getaddrinfo(host, port, type=socket.SOCK_STREAM)]
    except socket.gaierror as failure:
        raise EndpointRefused("That server's address could not be found.") from failure


def validate_endpoint(url: str, resolver: Resolver = _resolve) -> str:
    """The URL, if it is safe to call: HTTPS, no embedded credentials, and every address it resolves to public."""
    parts = urlsplit(url.strip())
    if parts.scheme != "https" or not parts.hostname:
        raise EndpointRefused("An MCP server must be an https address.")
    if parts.username or parts.password:
        raise EndpointRefused("An MCP address cannot contain a username or password.")
    try:
        port = parts.port or 443
    except ValueError as failure:
        raise EndpointRefused("That port is not valid.") from failure

    host = parts.hostname
    try:
        addresses = [str(ipaddress.ip_address(host))]
    except ValueError:
        addresses = resolver(host, port)
    if not addresses:
        raise EndpointRefused("That server's address could not be found.")
    for address in addresses:
        ip = ipaddress.ip_address(address)
        if isinstance(ip, ipaddress.IPv6Address) and ip.ipv4_mapped:
            ip = ip.ipv4_mapped
        if not ip.is_global:
            raise EndpointRefused("That address is not on the public internet.")
    return url.strip()


@dataclass(frozen=True)
class McpTool:
    name: str
    description: str
    input_schema: dict
    read_only_hint: bool | None


class McpClient:
    def __init__(self, endpoint: str, *, bearer: str | None = None, resolver: Resolver = _resolve) -> None:
        self.endpoint = validate_endpoint(endpoint, resolver)
        self._bearer = bearer
        self._session: str | None = None
        self._next_id = 0
        self.protocol_version: str | None = None
        self.server_info: dict = {}
        self.capabilities: dict = {}

    # --- lifecycle ---------------------------------------------------------------------------

    def initialize(self) -> None:
        answer = self._request(
            "initialize",
            {"protocolVersion": PROTOCOL_VERSIONS[0], "capabilities": {}, "clientInfo": CLIENT_INFO},
        )
        version = answer.get("protocolVersion")
        if version not in PROTOCOL_VERSIONS:
            raise UpstreamRefused("That server speaks a protocol version this runtime does not support.")
        self.protocol_version = version
        self.server_info = answer.get("serverInfo") if isinstance(answer.get("serverInfo"), dict) else {}
        self.capabilities = answer.get("capabilities") if isinstance(answer.get("capabilities"), dict) else {}
        self._notify("notifications/initialized")

    def close(self) -> None:
        """Ends the session where the server keeps one; a server that refuses (405) simply has none to end."""
        if not self._session:
            return
        try:
            httpx.request("DELETE", self.endpoint, headers=self._headers(), timeout=TIMEOUT_SECONDS, follow_redirects=False)
        except httpx.HTTPError:
            pass
        self._session = None

    # --- discovery ---------------------------------------------------------------------------

    def list_tools(self) -> list[McpTool]:
        tools: list[McpTool] = []
        for item in self._paged("tools/list", "tools"):
            if not isinstance(item, dict) or not isinstance(item.get("name"), str):
                continue
            annotations = item.get("annotations") if isinstance(item.get("annotations"), dict) else {}
            hint = annotations.get("readOnlyHint")
            tools.append(
                McpTool(
                    name=item["name"],
                    description=str(item.get("description") or "")[:1000],
                    input_schema=item.get("inputSchema") if isinstance(item.get("inputSchema"), dict) else {},
                    # A server's own claim that a tool is read-only is a hint to show, never a reason to skip approval.
                    read_only_hint=hint if isinstance(hint, bool) else None,
                )
            )
        return tools

    def list_resources(self) -> list[dict]:
        if "resources" not in self.capabilities:
            return []
        return [r for r in self._paged("resources/list", "resources") if isinstance(r, dict)]

    def list_prompts(self) -> list[dict]:
        if "prompts" not in self.capabilities:
            return []
        return [p for p in self._paged("prompts/list", "prompts") if isinstance(p, dict)]

    # --- execution ---------------------------------------------------------------------------

    def call_tool(self, name: str, arguments: dict) -> dict:
        """Run one tool. The caller has already decided this tool is enabled and granted; the result is untrusted."""
        answer = self._request("tools/call", {"name": name, "arguments": arguments})
        content = answer.get("content") if isinstance(answer.get("content"), list) else []
        return {"is_error": bool(answer.get("isError")), "content": content, "structured": answer.get("structuredContent")}

    # --- transport ---------------------------------------------------------------------------

    def _paged(self, method: str, key: str) -> list:
        found: list = []
        cursor: str | None = None
        for _ in range(MAX_PAGES):
            answer = self._request(method, {"cursor": cursor} if cursor else {})
            page = answer.get(key)
            if isinstance(page, list):
                found.extend(page)
            cursor = answer.get("nextCursor") if isinstance(answer.get("nextCursor"), str) else None
            if not cursor:
                break
        return found

    def _headers(self) -> dict[str, str]:
        headers = {"Accept": "application/json, text/event-stream", "Content-Type": "application/json"}
        if self._bearer:
            headers["Authorization"] = f"Bearer {self._bearer}"
        if self.protocol_version:
            headers["MCP-Protocol-Version"] = self.protocol_version
        if self._session:
            headers["Mcp-Session-Id"] = self._session
        return headers

    def _notify(self, method: str) -> None:
        self._send({"jsonrpc": "2.0", "method": method})

    def _request(self, method: str, params: dict) -> dict:
        self._next_id += 1
        request_id = self._next_id
        body = self._send({"jsonrpc": "2.0", "id": request_id, "method": method, "params": params}, expect_id=request_id)
        if "error" in body:
            error = body["error"] if isinstance(body["error"], dict) else {}
            raise UpstreamRefused(f"The MCP server refused {method}: {str(error.get('message') or 'unknown error')[:300]}")
        result = body.get("result")
        if not isinstance(result, dict):
            raise UpstreamRefused("The MCP server answered with something unexpected.")
        return result

    def _send(self, message: dict, expect_id: int | None = None) -> dict:
        try:
            response = httpx.post(self.endpoint, headers=self._headers(), content=json.dumps(message), timeout=TIMEOUT_SECONDS, follow_redirects=False)
        except httpx.HTTPError as failure:
            raise UpstreamRefused(f"The MCP server could not be reached: {type(failure).__name__}") from failure

        if 300 <= response.status_code < 400:
            raise UpstreamRefused("The MCP server redirected the request, which is not followed.")
        if response.status_code in (401, 403):
            raise UpstreamRefused("The MCP server refused our credentials.")
        if response.status_code >= 400:
            raise UpstreamRefused(f"The MCP server answered with status {response.status_code}.")
        if len(response.content) > MAX_RESPONSE_BYTES:
            raise UpstreamRefused("The MCP server's answer was too large.")

        session = response.headers.get("mcp-session-id")
        if session and not self._session:
            self._session = session
        if expect_id is None:
            return {}
        return _reply_for(response, expect_id)


def _reply_for(response: httpx.Response, request_id: int) -> dict:
    kind = response.headers.get("content-type", "").split(";")[0].strip().lower()
    if kind == "application/json":
        try:
            body = response.json()
        except ValueError as failure:
            raise UpstreamRefused("The MCP server answered with something that is not JSON.") from failure
        candidates = body if isinstance(body, list) else [body]
    elif kind == "text/event-stream":
        candidates = _events(response.text)
    else:
        raise UpstreamRefused("The MCP server answered in a format this runtime does not support.")
    for candidate in candidates:
        if isinstance(candidate, dict) and candidate.get("id") == request_id and ("result" in candidate or "error" in candidate):
            return candidate
    raise UpstreamRefused("The MCP server did not answer the request.")


def _events(text: str) -> list:
    """The JSON payloads of a server-sent-event body. Anything that is not JSON is ignored."""
    messages: list = []
    data: list[str] = []
    for line in [*text.splitlines(), ""]:
        if line.startswith("data:"):
            data.append(line[5:].removeprefix(" "))
        elif not line and data:
            try:
                messages.append(json.loads("\n".join(data)))
            except ValueError:
                pass
            data = []
    return messages
