"""Acting on GOLD's own Twilio parent account, and the subaccounts beneath it.

**The outbound half of provider operations, and the only half that names the vendor.** Everything
above this module asks to *verify an account*, *list its subaccounts* or *create one*; how Twilio
spells that is here. No SDK, for the reason `voice.py` gives: each step is one HTTPS call.

**Two ways to authenticate, chosen by the account's `credential_kind`.** An API key (`api_key`)
signs with its own SID and secret and is the preferred mechanism -- it can be revoked without
touching the account. The account's auth token (`auth_token`) remains supported because it is
what a deployment already holds. Which of the two an account uses is data, not a branch in the
schema.

**A failure is Twilio's own words.** A rewritten message is the one thing that makes a failing
integration unreadable, and Twilio's error bodies carry no credential.
"""

from __future__ import annotations

import httpx

from app.providers.providers import UpstreamRefused

API = "https://api.twilio.com/2010-04-01"
_PAGE_SIZE = 1000
_MAX_PAGES = 5


def _auth(credential: dict) -> tuple[str, str]:
    kind = credential.get("credential_kind")
    secret = credential.get("secret")
    if not secret:
        raise UpstreamRefused("This account has no credential stored.")
    if kind == "api_key":
        identifier = credential.get("credential_identifier")
        if not identifier:
            raise UpstreamRefused("This account's API key identifier is missing.")
        return identifier, secret
    if kind == "auth_token":
        return credential["external_account_id"], secret
    raise UpstreamRefused(f"Unsupported credential kind: {kind}")


def _parse(response: httpx.Response) -> dict:
    if response.status_code >= 400:
        raise UpstreamRefused(f"Twilio refused the request ({response.status_code}): {response.text[:300]}")
    return response.json()


def _get(credential: dict, path: str, params: dict | None = None) -> dict:
    try:
        return _parse(httpx.get(f"{API}{path}", auth=_auth(credential), params=params, timeout=15.0))
    except httpx.HTTPError as failure:
        raise UpstreamRefused(f"Twilio could not be reached: {type(failure).__name__}") from failure


def _post(credential: dict, path: str, form: dict[str, str]) -> dict:
    try:
        return _parse(httpx.post(f"{API}{path}", auth=_auth(credential), data=form, timeout=15.0))
    except httpx.HTTPError as failure:
        raise UpstreamRefused(f"Twilio could not be reached: {type(failure).__name__}") from failure


def verify(credential: dict) -> dict:
    """Does this credential work, and is the account a parent that may own subaccounts.

    Returns `{"ok": bool, "error": str | None, "metadata": {...}}` rather than raising: a
    credential that does not work is an answer, and the caller records it.
    """
    account = credential["external_account_id"]
    try:
        body = _get(credential, f"/Accounts/{account}.json")
    except UpstreamRefused as failure:
        return {"ok": False, "error": str(failure), "metadata": {}}

    if body.get("status") != "active":
        return {"ok": False, "error": f"The account's status is {body.get('status')!r}, not active.", "metadata": {}}

    # A subaccount names its parent in `owner_account_sid`; a parent names itself.
    owner = body.get("owner_account_sid")
    if owner and owner != account:
        return {
            "ok": False,
            "error": "This is a subaccount. Provisioning needs a parent account.",
            "metadata": {},
        }

    return {
        "ok": True,
        "error": None,
        "metadata": {"friendly_name": body.get("friendly_name"), "type": body.get("type"), "status": body.get("status")},
    }


def list_subaccounts(credential: dict) -> list[dict]:
    """Every subaccount beneath the parent, as `{sid, friendly_name, status}` and nothing more."""
    parent = credential["external_account_id"]
    found: list[dict] = []
    path = "/Accounts.json"
    params: dict | None = {"PageSize": str(_PAGE_SIZE)}

    for _ in range(_MAX_PAGES):
        body = _get(credential, path, params)
        for row in body.get("accounts", []):
            if row.get("sid") and row["sid"] != parent:
                found.append(
                    {"sid": row["sid"], "friendly_name": row.get("friendly_name"), "status": row.get("status")}
                )
        next_uri = body.get("next_page_uri")
        if not next_uri:
            return found
        # `next_page_uri` is rooted at `/2010-04-01` and already carries its own query.
        path = next_uri.removeprefix("/2010-04-01")
        params = None

    # Say so rather than pretend a truncated list is complete: a "missing" finding built on it
    # would be wrong.
    raise UpstreamRefused("More subaccounts exist than one reconciliation reads.")


def create_subaccount(credential: dict, *, friendly_name: str) -> dict:
    body = _post(credential, "/Accounts.json", {"FriendlyName": friendly_name})
    if not isinstance(body.get("sid"), str):
        raise UpstreamRefused("Twilio created a subaccount with no identifier.")
    if not isinstance(body.get("auth_token"), str) or not body["auth_token"]:
        raise UpstreamRefused("Twilio created a subaccount with no signing secret.")
    # The secret the carrier signs this subaccount's reports with. Returned once, to be stored in
    # Vault beside the subaccount by the caller, exactly as a new API key's secret is.
    return {"sid": body["sid"], "signing_secret": body["auth_token"]}


def subaccount_signing_secret(credential: dict, *, subaccount_sid: str) -> dict:
    """The signing secret of a subaccount that already exists beneath this parent.

    For a subaccount made before its secret was kept, or whose storing failed part-way: the parent
    may always ask again. A subaccount that is not this parent's is refused by the carrier.
    """
    body = _get(credential, f"/Accounts/{subaccount_sid}.json")
    if body.get("owner_account_sid") != credential["external_account_id"]:
        raise UpstreamRefused("That subaccount does not belong to this account.")
    if not isinstance(body.get("auth_token"), str) or not body["auth_token"]:
        raise UpstreamRefused("Twilio returned no signing secret for that subaccount.")
    return {"signing_secret": body["auth_token"]}


def create_api_key(credential: dict, *, subaccount_sid: str, friendly_name: str) -> dict:
    body = _post(credential, f"/Accounts/{subaccount_sid}/Keys.json", {"FriendlyName": friendly_name})
    if not isinstance(body.get("sid"), str) or not isinstance(body.get("secret"), str):
        raise UpstreamRefused("Twilio created an API key with no identifier or secret.")
    return {"sid": body["sid"], "secret": body["secret"]}


def create_twiml_app(credential: dict, *, subaccount_sid: str, friendly_name: str, voice_url: str) -> dict:
    body = _post(
        credential,
        f"/Accounts/{subaccount_sid}/Applications.json",
        {"FriendlyName": friendly_name, "VoiceUrl": voice_url, "VoiceMethod": "POST"},
    )
    if not isinstance(body.get("sid"), str):
        raise UpstreamRefused("Twilio created an application with no identifier.")
    return {"sid": body["sid"]}


# The operations a caller may ask for, by name. Anything else is refused before it is dispatched.
OPERATIONS = {
    "verify": lambda credential, args: verify(credential),
    "list_subaccounts": lambda credential, args: {"subaccounts": list_subaccounts(credential)},
    "create_subaccount": lambda credential, args: create_subaccount(credential, friendly_name=args["friendly_name"]),
    "subaccount_signing_secret": lambda credential, args: subaccount_signing_secret(
        credential, subaccount_sid=args["subaccount_sid"]
    ),
    "create_api_key": lambda credential, args: create_api_key(
        credential, subaccount_sid=args["subaccount_sid"], friendly_name=args["friendly_name"]
    ),
    "create_twiml_app": lambda credential, args: create_twiml_app(
        credential,
        subaccount_sid=args["subaccount_sid"],
        friendly_name=args["friendly_name"],
        voice_url=args["voice_url"],
    ),
}
