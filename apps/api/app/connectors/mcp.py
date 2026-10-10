"""A client for a remotely hosted MCP server, over Streamable HTTP.

An MCP server is an arbitrary third party, so nothing it says is trusted: the endpoint is checked before
any request (`validate_endpoint`), redirects are never followed, every answer is read as a bounded stream,
and what a tool returns is data for the caller to treat as untrusted input. Which tools a business enables,
who they are granted to and whether a call needs approval is decided by the caller, never by what the
server advertises; this module only speaks the protocol.

**The address is resolved once, checked, and then connected to.** The request goes to the validated IP,
with the original hostname carried as the `Host` header and as the TLS server name, so certificate
verification still proves the hostname while a DNS answer that changes between the check and the
connection (rebinding) has nothing to change. That removes one way around the check; it is not a
network control. A deployment that lets customers name endpoints still needs egress filtering outside
this process, and `app.core.config` keeps custom endpoints off unless a deployment says it has it.
"""

from __future__ import annotations

import ipaddress
import json
import socket
import time
from collections.abc import Callable, Iterator
from contextlib import contextmanager
from dataclasses import dataclass
from urllib.parse import urlsplit

import httpx

from app.providers.providers import UpstreamRefused

PROTOCOL_VERSIONS = ("2025-06-18", "2025-03-26")
MAX_RESPONSE_BYTES = 1_000_000
MAX_PAGES = 10
MAX_ITEMS = 500
MAX_DISCOVERY_BYTES = 2_000_000
CONNECT_TIMEOUT = 10.0
READ_TIMEOUT = 15.0
TOTAL_DEADLINE_SECONDS = 30.0
CLIENT_INFO = {"name": "gildops", "version": "1"}


class EndpointRefused(ValueError):
    """The endpoint may not be used, and nothing was sent to it."""


Resolver = Callable[[str, int], list[str]]


def _resolve(host: str, port: int) -> list[str]:
    try:
        return [str(info[4][0]) for info in socket.getaddrinfo(host, port, type=socket.SOCK_STREAM)]
    except socket.gaierror as failure:
        raise EndpointRefused("That server's address could not be found.") from failure


@dataclass(frozen=True)
class Target:
    """A checked endpoint: where to connect, and the name the server is known by."""

    url: str
    host: str
    port: int
    address: str
    path: str


def check_endpoint(url: str, resolver: Resolver = _resolve) -> Target:
    """The endpoint as a connection target, if it is safe to call: HTTPS, no embedded credentials,
    and every address it resolves to a public one. The first address is the one connected to."""
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

    path = parts.path or "/"
    if parts.query:
        path = f"{path}?{parts.query}"
    return Target(url=url.strip(), host=host, port=port, address=addresses[0], path=path)


def validate_endpoint(url: str, resolver: Resolver = _resolve) -> str:
    return check_endpoint(url, resolver).url


@dataclass(frozen=True)
class McpTool:
    name: str
    description: str
    input_schema: dict
    read_only_hint: bool | None


# --- transport --------------------------------------------------------------------------------


def _client(**kwargs) -> httpx.Client:
    """A seam: the one place a network client is made, so a test can substitute the network."""
    return httpx.Client(**kwargs)


class _Response:
    def __init__(self, status: int, headers: httpx.Headers, chunks: Iterator[bytes]) -> None:
        self.status = status
        self.headers = headers
        self.chunks = chunks


@contextmanager
def _post(target: Target, headers: dict[str, str], body: bytes) -> Iterator[_Response]:
    """One POST to the pinned address, never following a redirect, streamed."""
    ip = f"[{target.address}]" if ":" in target.address else target.address
    netloc = ip if target.port == 443 else f"{ip}:{target.port}"
    timeout = httpx.Timeout(READ_TIMEOUT, connect=CONNECT_TIMEOUT)
    with _client(timeout=timeout, follow_redirects=False, trust_env=False) as client:
        request = client.build_request(
            "POST",
            f"https://{netloc}{target.path}",
            headers={**headers, "Host": target.host if target.port == 443 else f"{target.host}:{target.port}"},
            content=body,
            extensions={"sni_hostname": target.host},
        )
        try:
            response = client.send(request, stream=True)
        except httpx.HTTPError as failure:
            raise UpstreamRefused(f"The MCP server could not be reached: {type(failure).__name__}") from failure
        try:
            yield _Response(response.status_code, response.headers, response.iter_bytes())
        except httpx.HTTPError as failure:
            raise UpstreamRefused(f"The MCP server could not be reached: {type(failure).__name__}") from failure
        finally:
            response.close()


class McpClient:
    def __init__(self, endpoint: str, *, bearer: str | None = None, resolver: Resolver = _resolve) -> None:
        self._target = check_endpoint(endpoint, resolver)
        self.endpoint = self._target.url
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
        """Ends the session where the server keeps one. A server that refuses has none to end."""
        if not self._session:
            return
        try:
            with _client(timeout=httpx.Timeout(READ_TIMEOUT, connect=CONNECT_TIMEOUT), follow_redirects=False, trust_env=False) as client:
                ip = f"[{self._target.address}]" if ":" in self._target.address else self._target.address
                client.request(
                    "DELETE",
                    f"https://{ip}:{self._target.port}{self._target.path}",
                    headers={**self._headers(), "Host": self._target.host},
                    extensions={"sni_hostname": self._target.host},
                )
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

    # --- protocol ----------------------------------------------------------------------------

    def _paged(self, method: str, key: str) -> list:
        found: list = []
        size = 0
        cursor: str | None = None
        for _ in range(MAX_PAGES):
            answer = self._request(method, {"cursor": cursor} if cursor else {})
            page = answer.get(key)
            if isinstance(page, list):
                found.extend(page)
                size += len(json.dumps(page, default=str))
            if len(found) > MAX_ITEMS or size > MAX_DISCOVERY_BYTES:
                raise UpstreamRefused("The MCP server listed more than this runtime will take.")
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
        self._send({"jsonrpc": "2.0", "method": method}, expect_id=None)

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

    def _send(self, message: dict, expect_id: int | None) -> dict:
        deadline = time.monotonic() + TOTAL_DEADLINE_SECONDS
        with _post(self._target, self._headers(), json.dumps(message).encode()) as response:
            if 300 <= response.status < 400:
                raise UpstreamRefused("The MCP server redirected the request, which is not followed.")
            if response.status in (401, 403):
                raise UpstreamRefused("The MCP server refused our credentials.")
            if response.status >= 400:
                raise UpstreamRefused(f"The MCP server answered with status {response.status}.")

            session = response.headers.get("mcp-session-id")
            if session and not self._session:
                self._session = session
            if expect_id is None:
                return {}

            kind = response.headers.get("content-type", "").split(";")[0].strip().lower()
            if kind == "application/json":
                return _json_reply(_read_all(response, deadline), expect_id)
            if kind == "text/event-stream":
                return _stream_reply(response, expect_id, deadline)
            raise UpstreamRefused("The MCP server answered in a format this runtime does not support.")


# --- reading ----------------------------------------------------------------------------------


def _read_all(response: _Response, deadline: float) -> bytes:
    """The whole body, stopping the moment it is too large or too slow."""
    received = bytearray()
    for chunk in response.chunks:
        received.extend(chunk)
        if len(received) > MAX_RESPONSE_BYTES:
            raise UpstreamRefused("The MCP server's answer was too large.")
        if time.monotonic() > deadline:
            raise UpstreamRefused("The MCP server took too long to answer.")
    return bytes(received)


def _valid(candidate: object, request_id: int) -> dict | None:
    """The JSON-RPC reply to this request, if `candidate` is one; a malformed reply is an error."""
    if not isinstance(candidate, dict) or candidate.get("id") != request_id:
        return None
    if candidate.get("jsonrpc") != "2.0" or ("result" in candidate) == ("error" in candidate):
        raise UpstreamRefused("The MCP server answered with a malformed reply.")
    return candidate


def _json_reply(raw: bytes, request_id: int) -> dict:
    try:
        body = json.loads(raw)
    except ValueError as failure:
        raise UpstreamRefused("The MCP server answered with something that is not JSON.") from failure
    for candidate in body if isinstance(body, list) else [body]:
        found = _valid(candidate, request_id)
        if found is not None:
            return found
    raise UpstreamRefused("The MCP server did not answer the request.")


def _stream_reply(response: _Response, request_id: int, deadline: float) -> dict:
    """Parses server-sent events as they arrive and stops at the reply to this request, so a stream
    that stays open afterwards costs nothing and one that never answers is cut off."""
    received = 0
    buffer = ""
    data: list[str] = []
    for chunk in response.chunks:
        received += len(chunk)
        if received > MAX_RESPONSE_BYTES:
            raise UpstreamRefused("The MCP server's answer was too large.")
        if time.monotonic() > deadline:
            raise UpstreamRefused("The MCP server took too long to answer.")
        buffer += chunk.decode("utf-8", errors="replace")
        *lines, buffer = buffer.replace("\r\n", "\n").split("\n")
        for line in lines:
            if line.startswith("data:"):
                data.append(line[5:].removeprefix(" "))
            elif not line and data:
                try:
                    candidate = json.loads("\n".join(data))
                except ValueError:
                    candidate = None
                data = []
                found = _valid(candidate, request_id)
                if found is not None:
                    return found
    raise UpstreamRefused("The MCP server did not answer the request.")
