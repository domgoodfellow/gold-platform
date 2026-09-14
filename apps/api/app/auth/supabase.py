"""Establishing a human caller's identity, authoritatively, whichever way this project can prove it.

**Two verification mechanisms, one guarantee.** A Supabase project on the current signing-key
architecture publishes public keys at `{SUPABASE_URL}/auth/v1/.well-known/jwks.json`; a token from
it is verified locally, by signature, against them. A project still on the legacy shared HS256
secret cannot be verified locally without holding that secret — and this migration's whole point
is that a human-auth path never holds it (`SUPABASE_JWT_SECRET` stays machine-role-only:
`app.core.db`, `app.core.runner`). Supabase's own documented answer for that generation is to ask
its Auth server: `GET /auth/v1/user` with the caller's bearer token returns 200 only if that
server itself accepts the token as live, unexpired, and belonging to this project. Both paths
finish in the same place — an identity this runtime did not merely assume, but that something
authoritative (a signature it checked, or the issuing server it asked) actually vouched for.

**There is no third answer.** Earlier code in this package for one release read a token's claims
without checking the signature and called that "structural" verification good enough to build an
authenticated `CallerContext` from, deferring the actual signature check to PostgREST a moment
later. That was wrong: `apps/api` now makes provider calls (AI, Twilio, email, Stripe) that spend
money or reach a third party before any database write happens, and none of those undo themselves
when PostgREST eventually notices the bearer was garbage. **Nothing here builds a `VerifiedToken`
except by a signature this process checked, or a Supabase Auth response this process saw.**

**Fails closed, never open, on infrastructure trouble.** A network failure or a 5xx from either
Supabase's JWKS endpoint or its Auth server refuses the request (`AuthError(503, ...)`) rather
than treating "I could not check" as "checked and fine". The one thing untrusted claims may ever
do is choose *which* verifier to try — the JOSE header's declared `alg` — because a wrong guess
there fails one specific verifier's own check rather than skipping verification.
"""

from __future__ import annotations

from dataclasses import dataclass
from functools import lru_cache
from typing import Any

import httpx
import jwt
from jwt import PyJWKClient

from app.auth.errors import invalid_credential, provider_unavailable

# Every Supabase user-facing PostgREST call authenticates as this audience.
EXPECTED_AUDIENCE = "authenticated"

# Algorithms this verifier will check a *signature* for, locally, against the project's own
# published JWKS. HS256 is deliberately absent — see `_verify_via_auth_server` below.
ASYMMETRIC_ALGORITHMS = ("RS256", "ES256", "EdDSA")

# The legacy generation: a shared secret this runtime never holds for a human token, verified
# instead by asking the server that issued it.
LEGACY_SYMMETRIC_ALGORITHM = "HS256"


@dataclass(frozen=True)
class VerifiedToken:
    claims: dict[str, Any]
    # "jwks" (this process checked the signature itself) or "auth_server" (Supabase Auth checked
    # it and told us). Diagnostic only — both are an authoritative, finished verification, and
    # nothing downstream may treat one as less trusted than the other.
    mechanism: str


@lru_cache(maxsize=8)
def _jwk_client(supabase_url: str) -> PyJWKClient:
    # Cached per URL for the life of the process — a warm Vercel function reuses this rather
    # than re-fetching the JWKS document on every invocation. `PyJWKClient` itself re-fetches
    # when it meets a key id it has not cached, which is what a rotation needs.
    jwks_url = f"{supabase_url.rstrip('/')}/auth/v1/.well-known/jwks.json"
    return PyJWKClient(jwks_url, cache_keys=True, lifespan=600)


def verify_access_token(
    token: str, *, supabase_url: str, supabase_publishable_key: str
) -> VerifiedToken:
    """Verify one caller-presented token, authoritatively, or raise `AuthError`.

    Never raises anything but `AuthError` — a library- or transport-specific exception reaching
    a handler would be one step from its message reaching a response body.

    The declared `alg` in the token's own header picks which verifier is asked; it is not trusted
    for anything beyond that dispatch, since each branch it can lead to enforces the real check.
    """
    try:
        header = jwt.get_unverified_header(token)
    except jwt.InvalidTokenError:
        raise invalid_credential() from None

    alg = header.get("alg")

    if alg in ASYMMETRIC_ALGORITHMS:
        return _verify_via_jwks(token, supabase_url=supabase_url)

    if alg == LEGACY_SYMMETRIC_ALGORITHM:
        return _verify_via_auth_server(
            token, supabase_url=supabase_url, supabase_publishable_key=supabase_publishable_key
        )

    # Anything else is an algorithm this runtime has no verifier for at all — not "unknown, so
    # let it through", but refused outright.
    raise invalid_credential()


def _verify_via_jwks(token: str, *, supabase_url: str) -> VerifiedToken:
    try:
        signing_key = _jwk_client(supabase_url).get_signing_key_from_jwt(token)
    except jwt.PyJWKClientConnectionError:
        # Could not reach the JWKS endpoint at all — an outage, not evidence about the token.
        raise provider_unavailable() from None
    except jwt.PyJWKClientError:
        # Reached it, but no published key matches this token's key id — a rotated-out key, or a
        # forged one. Either way this runtime cannot vouch for the signature.
        raise invalid_credential() from None

    try:
        claims = jwt.decode(
            token,
            signing_key.key,
            algorithms=list(ASYMMETRIC_ALGORITHMS),
            audience=EXPECTED_AUDIENCE,
            issuer=_expected_issuer(supabase_url),
        )
    except jwt.InvalidTokenError:
        raise invalid_credential() from None

    if not claims.get("sub"):
        raise invalid_credential()

    return VerifiedToken(claims=claims, mechanism="jwks")


def _verify_via_auth_server(
    token: str, *, supabase_url: str, supabase_publishable_key: str
) -> VerifiedToken:
    """Supabase's own documented check for a legacy-signed token: ask the server that issued it.

    A 200 here is Supabase Auth itself confirming the token is genuine, unexpired, and belongs to
    this project — which is exactly what a local HS256 verification would confirm, had this
    runtime been willing to hold the shared secret that would take. It is not a weaker guarantee,
    only a networked one, and that dependency is what item 8 of this migration asks to be named
    honestly rather than called "reduced assurance".
    """
    try:
        response = httpx.get(
            f"{supabase_url.rstrip('/')}/auth/v1/user",
            headers={
                "apikey": supabase_publishable_key,
                "Authorization": f"Bearer {token}",
            },
            timeout=5.0,
        )
    except httpx.HTTPError:
        raise provider_unavailable() from None

    if response.status_code >= 500:
        # Supabase's own trouble, not evidence about the token. Refuse rather than guess.
        raise provider_unavailable()

    if response.status_code != 200:
        # 401/403 from Supabase Auth is the ordinary "no", and any other 4xx is treated the same
        # way — ambiguous is not a reason to let a caller through.
        raise invalid_credential()

    try:
        body = response.json()
    except ValueError:
        raise provider_unavailable() from None

    user_id = body.get("id")
    if not user_id:
        raise invalid_credential()

    claims: dict[str, Any] = {
        "sub": user_id,
        "aud": body.get("aud") or EXPECTED_AUDIENCE,
        "role": body.get("role"),
    }
    _enrich_with_already_verified_claims(claims, token)

    return VerifiedToken(claims=claims, mechanism="auth_server")


def _enrich_with_already_verified_claims(claims: dict[str, Any], token: str) -> None:
    """Read a few extra fields (`aal`, `exp`) off the same token Supabase Auth just vouched for.

    Reading these **without** re-checking the signature is safe only because identity is already
    settled by the successful `/auth/v1/user` call above — this adds detail to a caller already
    established, the same way `sub`/`aud`/`role` above came from Supabase's own response rather
    than the token. It never runs, and never could, ahead of that call succeeding. Best-effort:
    if the token cannot even be parsed here (it was already accepted by Supabase, so this would
    be surprising), the caller is still authenticated on `claims` as already built.
    """
    try:
        extra = jwt.decode(token, options={"verify_signature": False})
    except jwt.InvalidTokenError:
        return

    for key in ("aal", "exp", "iat"):
        if key in extra:
            claims.setdefault(key, extra[key])


def _expected_issuer(supabase_url: str) -> str:
    return f"{supabase_url.rstrip('/')}/auth/v1"
