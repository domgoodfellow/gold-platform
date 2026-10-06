"""The one contract every OAuth connector implements (D56).

**A suite is one authorization.** Google Workspace and Microsoft 365 each ask a person to sign in
once and then reach several apps beneath it, so a connector here is *one sign-in plus what it can
reach*, never one class per app. A second connector that needs a different method on this base is
the signal the contract is wrong, which is why two substantially different suites implement it
before it is called stable.

Each step is one HTTPS call, so no SDK: the vendor's own words in a refusal are the only thing
that makes a failing connection readable, and a provider's error body carries no credential.
`httpx` is called through the module so a test substitutes the network without a fake vendor.
"""

from __future__ import annotations

import time
from collections.abc import Mapping
from dataclasses import dataclass, field
from urllib.parse import urlencode

import httpx

from app.providers.providers import UpstreamRefused


@dataclass(frozen=True)
class OAuthApp:
    """GOLD's own registration with the vendor. Never a tenant's credential.

    `extra` holds the further registration inputs a vendor needs that are not a client id and
    secret -- a GitHub App's numeric id and signing key, for one. Named in the registry
    (`app.connectors`), present only when every one of them is, and never rendered anywhere.
    """

    client_id: str
    client_secret: str
    extra: Mapping[str, str] = field(default_factory=dict)


@dataclass(frozen=True)
class Tokens:
    access_token: str
    refresh_token: str | None
    expires_at: int
    scopes: list[str] = field(default_factory=list)


@dataclass(frozen=True)
class Account:
    """What the signed-in account is called, so a person can tell two connections apart."""

    label: str


class OAuthProvider:
    """A connector's OAuth behaviour. Subclasses are configuration plus two reads."""

    key: str = ""
    authorize_endpoint: str = ""
    token_endpoint: str = ""
    scopes: tuple[str, ...] = ()
    authorize_extra: dict[str, str] = {}
    # What a token response with no `expires_in` means. A vendor whose tokens do not expire says so
    # here, rather than the default making GOLD try (and fail) to refresh one after an hour.
    default_expires_in: int = 3600

    # --- the handshake, identical for every vendor -----------------------------------------

    def authorize_url(self, app: OAuthApp, *, state: str, redirect_uri: str) -> str:
        query = {
            "client_id": app.client_id,
            "redirect_uri": redirect_uri,
            "response_type": "code",
            "state": state,
            **self.authorize_extra,
        }
        if self.scopes:  # Notion has none: access is chosen on its consent screen
            query["scope"] = " ".join(self.scopes)
        return f"{self.authorize_endpoint}?{urlencode(query)}"

    def exchange(self, app: OAuthApp, *, code: str, redirect_uri: str, extra: Mapping[str, str] | None = None) -> Tokens:
        """`extra` is whatever else the vendor put on the redirect (a short allowlist of strings the
        browser relayed untouched); most vendors put nothing there, and this ignores it."""
        return self._token_request(
            app, {"grant_type": "authorization_code", "code": code, "redirect_uri": redirect_uri}
        )

    def refresh(self, app: OAuthApp, *, refresh_token: str) -> Tokens:
        tokens = self._token_request(app, {"grant_type": "refresh_token", "refresh_token": refresh_token})
        # A vendor may rotate the refresh token or keep the old one; either way, keep one.
        if tokens.refresh_token is None:
            return Tokens(tokens.access_token, refresh_token, tokens.expires_at, tokens.scopes)
        return tokens

    def revoke(self, app: OAuthApp, *, token: str) -> None:
        """Best effort; a vendor with no revocation endpoint leaves this as is."""

    # --- what differs -----------------------------------------------------------------------

    def account(self, access_token: str) -> Account:
        raise NotImplementedError

    def resources(self, access_token: str) -> list[dict]:
        """Everything this authorization can reach, as `{resource_type, external_id, display_name, metadata}`."""
        raise NotImplementedError

    # --- shared plumbing --------------------------------------------------------------------

    def _token_request(self, app: OAuthApp, form: dict[str, str]) -> Tokens:
        body = {"client_id": app.client_id, "client_secret": app.client_secret, **form}
        try:
            response = httpx.post(self.token_endpoint, data=body, timeout=15.0)
        except httpx.HTTPError as failure:
            raise UpstreamRefused(f"{self.key} could not be reached: {type(failure).__name__}") from failure

        payload = _json(response)
        if response.status_code >= 400 or "access_token" not in payload:
            # The vendor's own two fields, never the whole body.
            words = payload.get("error_description") or payload.get("error") or f"status {response.status_code}"
            raise UpstreamRefused(f"The provider refused the sign-in: {str(words)[:300]}")

        return Tokens(
            access_token=payload["access_token"],
            refresh_token=payload.get("refresh_token"),
            expires_at=int(time.time()) + int(payload.get("expires_in") or self.default_expires_in),
            scopes=str(payload.get("scope") or "").split(),
        )

    def _get(self, url: str, access_token: str, params: dict | None = None, headers: dict | None = None) -> dict:
        return self._request("GET", url, access_token, params=params, headers=headers)

    def _post(self, url: str, access_token: str, body: dict | None = None, headers: dict | None = None) -> dict:
        return self._request("POST", url, access_token, json=body, headers=headers)

    def _request(
        self,
        method: str,
        url: str,
        access_token: str,
        *,
        params: dict | None = None,
        json: dict | None = None,
        headers: dict | None = None,
    ) -> dict:
        auth = {"Authorization": f"Bearer {access_token}", **(headers or {})}
        try:
            if method == "POST":
                response = httpx.post(url, headers=auth, json=json, timeout=15.0)
            else:
                response = httpx.get(url, headers=auth, params=params, timeout=15.0)
        except httpx.HTTPError as failure:
            raise UpstreamRefused(f"{self.key} could not be reached: {type(failure).__name__}") from failure
        payload = _json(response)
        if response.status_code >= 400:
            error = payload.get("error")
            words = error.get("message") if isinstance(error, dict) else (error or payload.get("message") or f"status {response.status_code}")
            raise UpstreamRefused(f"The provider refused the request: {str(words)[:300]}")
        return payload


def _json(response: httpx.Response) -> dict:
    try:
        body = response.json()
    except ValueError:
        return {}
    return body if isinstance(body, dict) else {}
