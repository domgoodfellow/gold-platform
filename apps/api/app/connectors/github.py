"""GitHub: a business installs a GitHub App on the repositories it chooses (D56, work order 2).

**An installation, not an OAuth sign-in.** What a business authorizes is *which repositories*
GildOps may read -- the narrowing and the revocation a business actually wants -- and GitHub models
that as an App installation, not as an OAuth grant over a whole account. So this connector does not
hold a long-lived token for the person. It holds the installation's id, and mints a one-hour
installation token from the App's own signing key whenever it needs one. In the contract the base
class gives every other vendor:

- `exchange` proves who is installing and which installation they mean, then mints the first token;
- `refresh` mints the next one from the installation id, so the "refresh token" this connector
  returns *is* that id -- the durable handle, not a credential on its own (it grants nothing without
  the App's key, which is GildOps', and it is stored in Vault with the rest like any other);
- `revoke` does nothing, deliberately: removing the App from a person's account is theirs to do on
  GitHub, and doing it for them would break every other business that connected the same account.

**The installation id arrives in a URL a person's browser carries, so it is not trusted.** Anyone
could paste another account's id into that URL. `exchange` therefore takes the *code* GitHub issues
to the person who installed (user authorization during installation must be enabled on the App),
trades it for a user token, and asks GitHub which installations *that user* can reach. An id that
is not among them is refused. The user token is used for that one question and discarded -- never
stored, never returned.

**Read-only.** The App is registered with repository metadata and contents read, and nothing here
writes to a repository. A commit, a branch or a pull request is the Studio deployment work's, and
asks the person again when it arrives.
"""

from __future__ import annotations

import re
import time
from collections.abc import Mapping
from datetime import datetime
from urllib.parse import quote, urlencode

import httpx
import jwt

from app.connectors.base import Account, Capability, OAuthApp, OAuthProvider, Tokens, bounded, segment
from app.providers.providers import MalformedAnswer, UpstreamRefused

API = "https://api.github.com"
_HEADERS = {"Accept": "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28"}
_PAGE = 100
# 2,000 repositories is far past what one business hands a deployment tool; a bound, not a quota.
_MAX_PAGES = 20
_ID = re.compile(r"^[0-9]{1,18}$")


class GitHub(OAuthProvider):
    key = "github"
    authorize_endpoint = "https://github.com/apps"
    token_endpoint = "https://github.com/login/oauth/access_token"
    # A GitHub App's permissions are set on the App, not requested per sign-in.
    scopes = ()
    default_expires_in = 3600

    capabilities = (
        Capability("github.repositories.list", "Repositories the installation reaches", "repositories", "studio"),
        Capability("github.issues.list", "Open issues of one repository", "issues", "support"),
        Capability("github.commits.list", "Recent commits of one repository", "commits", "studio"),
    )

    @staticmethod
    def _repo(params) -> str:
        return f"{API}/repos/{segment(params.get('owner'), 'owner')}/{segment(params.get('repo'), 'repo')}"

    def repositories(self, access_token: str, params) -> dict:
        return {"repositories": [{"id": r["external_id"], "full_name": r["display_name"], **r["metadata"]} for r in self.resources(access_token)]}

    def issues(self, access_token: str, params) -> dict:
        rows = self._get_list(f"{self._repo(params)}/issues", access_token, {"state": "open", "per_page": str(bounded(params, "limit", 25, 100))})
        return {"issues": [{"number": i.get("number"), "title": i.get("title"), "state": i.get("state"), "url": i.get("html_url")} for i in rows if "pull_request" not in i]}

    def commits(self, access_token: str, params) -> dict:
        rows = self._get_list(f"{self._repo(params)}/commits", access_token, {"per_page": str(bounded(params, "limit", 25, 100))})
        return {
            "commits": [
                {
                    "sha": c.get("sha"),
                    "message": ((c.get("commit") or {}).get("message") or "").split("\n")[0],
                    "date": (((c.get("commit") or {}).get("author")) or {}).get("date"),
                }
                for c in rows
            ]
        }

    def _get_list(self, url: str, token: str, params: dict) -> list[dict]:
        # GitHub's list endpoints answer with a bare array; `_call` wraps it so one error path serves both.
        return self._call("GET", url, token, params=params).get("_list", [])

    # --- the handshake ---------------------------------------------------------------------

    def authorize_url(self, app: OAuthApp, *, state: str, redirect_uri: str) -> str:
        """The App's installation page, which is also where a person changes which repositories it
        reaches. GitHub returns them to the App's configured callback with `installation_id`."""
        slug = quote(app.extra["GITHUB_APP_SLUG"], safe="")
        return f"https://github.com/apps/{slug}/installations/new?{urlencode({'state': state})}"

    def exchange(self, app: OAuthApp, *, code: str, redirect_uri: str, extra: Mapping[str, str] | None = None) -> Tokens:
        extra = extra or {}
        if extra.get("setup_action") == "request":
            raise UpstreamRefused(
                "The GitHub organization has to approve this installation first. Ask an owner to approve it, then connect again."
            )
        installation_id = extra.get("installation_id", "")
        if not _ID.match(installation_id):
            raise UpstreamRefused("GitHub did not say which installation to use. Connect again from GildOps.")

        user_token = self._user_token(app, code=code, redirect_uri=redirect_uri)
        self._require_installation_is_theirs(user_token, int(installation_id))
        return self._mint(app, int(installation_id))

    def refresh(self, app: OAuthApp, *, refresh_token: str) -> Tokens:
        if not _ID.match(refresh_token or ""):
            raise UpstreamRefused("The stored GitHub installation is not usable. Reconnect it.")
        return self._mint(app, int(refresh_token))

    def revoke(self, app: OAuthApp, *, token: str) -> None:
        """Nothing to revoke here. GildOps' copy of the installation handle is deleted by the
        caller; the installation itself stays on the person's GitHub account until they remove it
        there, and an installation token already issued expires within the hour."""

    # --- what the installation reaches -----------------------------------------------------

    def account(self, access_token: str) -> Account:
        """Every repository an installation reaches belongs to the account that installed it, so the
        owner of the first one names that account without a call only the App's own key may make."""
        answer = self._get(f"{API}/installation/repositories", access_token, {"per_page": "1"})
        repositories = answer.get("repositories")
        if isinstance(repositories, list) and repositories and isinstance(repositories[0], dict):
            owner = repositories[0].get("owner")
            if isinstance(owner, dict) and owner.get("login"):
                return Account(label=str(owner["login"]))
        return Account(label="GitHub account")

    def resources(self, access_token: str) -> list[dict]:
        found: list[dict] = []
        for page in range(1, _MAX_PAGES + 1):
            answer = self._get(
                f"{API}/installation/repositories", access_token, {"per_page": str(_PAGE), "page": str(page)}
            )
            repositories = answer.get("repositories")
            if not isinstance(repositories, list):
                raise MalformedAnswer("GitHub answered with something that is not a list of repositories.")
            for repository in repositories:
                shaped = _repository(repository)
                if shaped is not None:
                    found.append(shaped)
            if len(repositories) < _PAGE:
                break
        return found

    # --- the one place a token is minted ---------------------------------------------------

    def _app_jwt(self, app: OAuthApp) -> str:
        now = int(time.time())
        # Issued a minute in the past to allow for clock drift, and valid for the shortest span GitHub
        # allows more than a second of: the App key signs it, so it is the most sensitive thing here.
        claims = {"iat": now - 60, "exp": now + 9 * 60, "iss": app.extra["GITHUB_APP_ID"]}
        try:
            return jwt.encode(claims, app.extra["GITHUB_APP_PRIVATE_KEY"].replace("\\n", "\n"), algorithm="RS256")
        except (ValueError, TypeError, jwt.PyJWTError) as failure:
            # Nothing of the key, or of the library's own words about it, goes into the message.
            raise UpstreamRefused("This deployment's GitHub App key is not usable.") from failure

    def _mint(self, app: OAuthApp, installation_id: int) -> Tokens:
        answer = self._call("POST", f"{API}/app/installations/{installation_id}/access_tokens", self._app_jwt(app))
        token = answer.get("token")
        if not isinstance(token, str) or not token:
            raise MalformedAnswer("GitHub did not return an installation token.")
        permissions = answer.get("permissions") if isinstance(answer.get("permissions"), dict) else {}
        return Tokens(
            access_token=token,
            refresh_token=str(installation_id),
            expires_at=_epoch(answer.get("expires_at")),
            scopes=[f"{name}:{level}" for name, level in sorted(permissions.items())],
        )

    def _user_token(self, app: OAuthApp, *, code: str, redirect_uri: str) -> str:
        try:
            response = httpx.post(
                self.token_endpoint,
                data={"client_id": app.client_id, "client_secret": app.client_secret, "code": code, "redirect_uri": redirect_uri},
                headers={"Accept": "application/json"},
                timeout=15.0,
            )
        except httpx.HTTPError as failure:
            raise UpstreamRefused(f"github could not be reached: {type(failure).__name__}") from failure
        try:
            body = response.json()
        except ValueError:
            body = {}
        # GitHub answers a bad code with a 200 and an `error` field, so the status alone is not the verdict.
        if not isinstance(body, dict) or not isinstance(body.get("access_token"), str):
            words = body.get("error_description") or body.get("error") if isinstance(body, dict) else None
            raise UpstreamRefused(f"GitHub refused the sign-in: {str(words or f'status {response.status_code}')[:300]}")
        return body["access_token"]

    def _require_installation_is_theirs(self, user_token: str, installation_id: int) -> None:
        for page in range(1, _MAX_PAGES + 1):
            answer = self._get(f"{API}/user/installations", user_token, {"per_page": str(_PAGE), "page": str(page)})
            installations = answer.get("installations")
            if not isinstance(installations, list):
                raise MalformedAnswer("GitHub answered with something that is not a list of installations.")
            if any(isinstance(item, dict) and item.get("id") == installation_id for item in installations):
                return
            if len(installations) < _PAGE:
                break
        raise UpstreamRefused("That GitHub installation does not belong to the account that signed in.")

    # --- plumbing --------------------------------------------------------------------------

    def _get(self, url: str, token: str, params: dict | None = None) -> dict:
        return self._call("GET", url, token, params=params)

    def _call(self, method: str, url: str, token: str, params: dict | None = None) -> dict:
        try:
            response = httpx.request(
                method, url, headers={**_HEADERS, "Authorization": f"Bearer {token}"}, params=params, timeout=15.0
            )
        except httpx.HTTPError as failure:
            raise UpstreamRefused(f"github could not be reached: {type(failure).__name__}") from failure

        limited = response.status_code == 429 or (
            response.status_code == 403
            and (response.headers.get("x-ratelimit-remaining") == "0" or "retry-after" in response.headers)
        )
        if limited:
            raise UpstreamRefused("GitHub is limiting requests right now. Try again in a few minutes.")

        try:
            body = response.json()
        except ValueError as failure:
            raise MalformedAnswer("GitHub answered with something that is not JSON.") from failure
        if isinstance(body, list) and response.status_code < 400:
            return {"_list": [row for row in body if isinstance(row, dict)]}
        if not isinstance(body, dict):
            raise MalformedAnswer("GitHub answered with an unexpected shape.")

        if response.status_code >= 400:
            words = body.get("message") or f"status {response.status_code}"
            if response.status_code in (401, 404):
                # The installation was removed, or this token no longer works: either way the connection
                # is not usable, and the person is told to reconnect rather than shown GitHub's phrasing.
                raise UpstreamRefused("GitHub no longer recognizes this installation. It may have been removed. Reconnect it.")
            raise UpstreamRefused(f"GitHub refused the request: {str(words)[:300]}")
        return body


def _epoch(value: object) -> int:
    """GitHub's `expires_at` (ISO 8601, UTC) as epoch seconds; an hour from now when it is absent or odd."""
    if isinstance(value, str):
        try:
            return int(datetime.fromisoformat(value.replace("Z", "+00:00")).timestamp())
        except ValueError:
            pass
    return int(time.time()) + 3600


def _repository(repository: object) -> dict | None:
    """What GildOps needs to name and reach one repository -- facts, never content or a secret."""
    if not isinstance(repository, dict) or not repository.get("id") or not repository.get("full_name"):
        return None
    owner = repository.get("owner") if isinstance(repository.get("owner"), dict) else {}
    visibility = repository.get("visibility") or ("private" if repository.get("private") else "public")
    return {
        "resource_type": "github_repository",
        "external_id": str(repository["id"]),
        "display_name": str(repository["full_name"]),
        "metadata": {
            "owner": owner.get("login"),
            "name": repository.get("name"),
            "default_branch": repository.get("default_branch"),
            "visibility": visibility,
            "archived": bool(repository.get("archived")),
            "url": repository.get("html_url"),
        },
    }
