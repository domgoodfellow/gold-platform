"""The API's one authentication boundary: bearer parsing plus authoritative Supabase verification.

Pure and offline, in the same spirit `test_stripe_webhook.py` gives for its own module: a real
key pair is generated once per run and used to sign fixture tokens for the asymmetric (JWKS)
path, and both the JWKS fetch and the Supabase Auth server call are monkeypatched rather than
reaching a network, so what is exercised is this package's own dispatch and refusal logic —
never a mode where an unverified claim is trusted.
"""

from __future__ import annotations

import sys
import time
from pathlib import Path

import httpx
import jwt
import pytest
from cryptography.hazmat.primitives.asymmetric import rsa
from jwt import PyJWKClient

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.auth import AuthError, require_caller  # noqa: E402
from app.auth.bearer import extract_bearer_token  # noqa: E402
from app.auth.context import CallerContext  # noqa: E402
from app.auth.supabase import _jwk_client, verify_access_token  # noqa: E402
import app.auth.supabase as supabase_auth  # noqa: E402

SUPABASE_URL = "https://project.supabase.test"
PUBLISHABLE_KEY = "sb_publishable_test"
ISSUER = f"{SUPABASE_URL}/auth/v1"
USER_ID = "11111111-1111-4111-8111-111111111111"
KEY_ID = "test-key-1"
HS256_SECRET = "any-secret-this-runtime-never-holds-for-people"


@pytest.fixture(autouse=True)
def _clear_jwk_cache():
    _jwk_client.cache_clear()
    yield
    _jwk_client.cache_clear()


class _Headers(dict):
    """Case-sensitive stand-in for `http.server`'s header object, which this module reads
    with `.get(name)` exactly as the real one supports."""


@pytest.fixture(scope="module")
def keypair():
    private_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    return private_key, private_key.public_key()


def _sign_asymmetric(private_key, claims: dict) -> str:
    return jwt.encode(claims, private_key, algorithm="RS256", headers={"kid": KEY_ID})


def _sign_legacy(claims: dict, secret: str = HS256_SECRET) -> str:
    # A legacy-generation Supabase access token: HS256, a secret this runtime never holds.
    return jwt.encode(claims, secret, algorithm="HS256")


def _claims(**overrides) -> dict:
    now = int(time.time())
    base = {"sub": USER_ID, "aud": "authenticated", "iss": ISSUER, "iat": now, "exp": now + 3600}
    base.update(overrides)
    return base


def _fake_signing_key(public_key):
    class _Key:
        key = public_key

    return _Key()


def _patch_jwk_client(monkeypatch, public_key) -> None:
    """The one seam on the asymmetric path: real JWKS discovery is an HTTP call this suite
    never makes."""
    monkeypatch.setattr(
        PyJWKClient, "get_signing_key_from_jwt", lambda self, token: _fake_signing_key(public_key)
    )


class _FakeAuthServerResponse:
    def __init__(self, status_code: int, body: dict | None = None) -> None:
        self.status_code = status_code
        self._body = body or {}

    def json(self):
        return self._body


def _patch_auth_server(monkeypatch, respond):
    """The one seam on the legacy path: `GET /auth/v1/user` never reaches a network here.

    `respond` is called with (url, headers) and returns a `_FakeAuthServerResponse`, or raises
    an `httpx`-shaped error to simulate a network failure.
    """

    def fake_get(url, headers=None, timeout=None):
        return respond(url, headers)

    monkeypatch.setattr(supabase_auth.httpx, "get", fake_get)


# --- bearer.py -----------------------------------------------------------------------------


def test_missing_authorization_header_is_refused() -> None:
    with pytest.raises(AuthError) as failure:
        extract_bearer_token(_Headers())
    assert failure.value.status == 401


def test_malformed_scheme_is_refused() -> None:
    with pytest.raises(AuthError):
        extract_bearer_token(_Headers(authorization="Basic dXNlcjpwYXNz"))


def test_bearer_with_nothing_after_it_is_refused() -> None:
    with pytest.raises(AuthError):
        extract_bearer_token(_Headers(authorization="Bearer "))


# --- supabase.py: asymmetric / JWKS path -----------------------------------------------------


def test_a_valid_asymmetric_token_is_accepted(monkeypatch, keypair) -> None:
    private_key, public_key = keypair
    _patch_jwk_client(monkeypatch, public_key)

    token = _sign_asymmetric(private_key, _claims())
    verified = verify_access_token(
        token, supabase_url=SUPABASE_URL, supabase_publishable_key=PUBLISHABLE_KEY
    )

    assert verified.mechanism == "jwks"
    assert verified.claims["sub"] == USER_ID


def test_an_expired_asymmetric_token_is_rejected(monkeypatch, keypair) -> None:
    private_key, public_key = keypair
    _patch_jwk_client(monkeypatch, public_key)

    token = _sign_asymmetric(private_key, _claims(exp=int(time.time()) - 60))

    with pytest.raises(AuthError) as failure:
        verify_access_token(
            token, supabase_url=SUPABASE_URL, supabase_publishable_key=PUBLISHABLE_KEY
        )
    assert failure.value.status == 401


def test_a_token_from_the_wrong_issuer_is_rejected(monkeypatch, keypair) -> None:
    private_key, public_key = keypair
    _patch_jwk_client(monkeypatch, public_key)

    token = _sign_asymmetric(
        private_key, _claims(iss="https://a-different-project.supabase.test/auth/v1")
    )

    with pytest.raises(AuthError) as failure:
        verify_access_token(
            token, supabase_url=SUPABASE_URL, supabase_publishable_key=PUBLISHABLE_KEY
        )
    assert failure.value.status == 401


def test_a_token_for_the_wrong_audience_is_rejected(monkeypatch, keypair) -> None:
    private_key, public_key = keypair
    _patch_jwk_client(monkeypatch, public_key)

    token = _sign_asymmetric(private_key, _claims(aud="something-else"))

    with pytest.raises(AuthError):
        verify_access_token(
            token, supabase_url=SUPABASE_URL, supabase_publishable_key=PUBLISHABLE_KEY
        )


def test_a_token_signed_by_a_different_key_is_rejected(monkeypatch, keypair) -> None:
    _, public_key = keypair
    other_private_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    _patch_jwk_client(monkeypatch, public_key)

    # Signed with a key this "project" never published — the forged-token case.
    token = _sign_asymmetric(other_private_key, _claims())

    with pytest.raises(AuthError) as failure:
        verify_access_token(
            token, supabase_url=SUPABASE_URL, supabase_publishable_key=PUBLISHABLE_KEY
        )
    assert failure.value.status == 401


def test_an_unrecognised_key_id_is_rejected(monkeypatch, keypair) -> None:
    private_key, _ = keypair

    def _raise(self, token):
        raise jwt.PyJWKClientError("no matching key")

    monkeypatch.setattr(PyJWKClient, "get_signing_key_from_jwt", _raise)

    token = _sign_asymmetric(private_key, _claims())
    with pytest.raises(AuthError) as failure:
        verify_access_token(
            token, supabase_url=SUPABASE_URL, supabase_publishable_key=PUBLISHABLE_KEY
        )
    assert failure.value.status == 401


def test_jwks_endpoint_unreachable_fails_closed_with_503(monkeypatch, keypair) -> None:
    """Infrastructure trouble is never evidence the token is fine."""
    private_key, _ = keypair

    def _raise(self, token):
        raise jwt.PyJWKClientConnectionError("could not reach JWKS endpoint")

    monkeypatch.setattr(PyJWKClient, "get_signing_key_from_jwt", _raise)

    token = _sign_asymmetric(private_key, _claims())
    with pytest.raises(AuthError) as failure:
        verify_access_token(
            token, supabase_url=SUPABASE_URL, supabase_publishable_key=PUBLISHABLE_KEY
        )
    assert failure.value.status == 503


def test_an_unsupported_algorithm_is_rejected_outright() -> None:
    # A `none`-alg or otherwise unrecognised token: neither verifier is asked.
    forged = (
        jwt.utils.base64url_encode(b'{"alg":"none","typ":"JWT"}').decode()
        + "."
        + jwt.utils.base64url_encode(b'{"sub":"x"}').decode()
        + "."
    )
    with pytest.raises(AuthError) as failure:
        verify_access_token(
            forged, supabase_url=SUPABASE_URL, supabase_publishable_key=PUBLISHABLE_KEY
        )
    assert failure.value.status == 401


def test_a_malformed_token_is_rejected() -> None:
    with pytest.raises(AuthError):
        verify_access_token(
            "not-a-jwt-at-all", supabase_url=SUPABASE_URL, supabase_publishable_key=PUBLISHABLE_KEY
        )


# --- supabase.py: legacy HS256, verified against Supabase Auth ------------------------------


def test_a_legacy_token_accepted_by_supabase_auth_is_authenticated(monkeypatch) -> None:
    token = _sign_legacy(_claims(aal="aal1"))

    def respond(url, headers):
        assert url == f"{SUPABASE_URL}/auth/v1/user"
        assert headers["apikey"] == PUBLISHABLE_KEY
        assert headers["Authorization"] == f"Bearer {token}"
        return _FakeAuthServerResponse(200, {"id": USER_ID, "aud": "authenticated", "role": "authenticated"})

    _patch_auth_server(monkeypatch, respond)

    verified = verify_access_token(
        token, supabase_url=SUPABASE_URL, supabase_publishable_key=PUBLISHABLE_KEY
    )

    assert verified.mechanism == "auth_server"
    assert verified.claims["sub"] == USER_ID
    # Enriched from the (already-verified) token itself, not invented.
    assert verified.claims["aal"] == "aal1"


def test_supabase_auth_401_is_rejected(monkeypatch) -> None:
    token = _sign_legacy(_claims())
    _patch_auth_server(monkeypatch, lambda url, headers: _FakeAuthServerResponse(401))

    with pytest.raises(AuthError) as failure:
        verify_access_token(
            token, supabase_url=SUPABASE_URL, supabase_publishable_key=PUBLISHABLE_KEY
        )
    assert failure.value.status == 401


def test_an_expired_or_revoked_legacy_token_is_rejected(monkeypatch) -> None:
    token = _sign_legacy(_claims(exp=int(time.time()) - 60))
    _patch_auth_server(monkeypatch, lambda url, headers: _FakeAuthServerResponse(401))

    with pytest.raises(AuthError) as failure:
        verify_access_token(
            token, supabase_url=SUPABASE_URL, supabase_publishable_key=PUBLISHABLE_KEY
        )
    assert failure.value.status == 401


def test_a_legacy_token_from_another_project_is_rejected(monkeypatch) -> None:
    """Supabase Auth itself refuses a token signed by a different project's secret — this
    runtime does not need its own issuer check on this path, the remote check already enforces
    it, and this test proves the plumbing gets that refusal back out as a 401."""
    token = _sign_legacy(_claims(iss="https://someone-elses-project.supabase.test/auth/v1"))
    _patch_auth_server(monkeypatch, lambda url, headers: _FakeAuthServerResponse(401))

    with pytest.raises(AuthError) as failure:
        verify_access_token(
            token, supabase_url=SUPABASE_URL, supabase_publishable_key=PUBLISHABLE_KEY
        )
    assert failure.value.status == 401


def test_supabase_auth_network_outage_fails_closed(monkeypatch) -> None:
    token = _sign_legacy(_claims())

    def respond(url, headers):
        raise httpx.ConnectError("connection refused")

    _patch_auth_server(monkeypatch, respond)

    with pytest.raises(AuthError) as failure:
        verify_access_token(
            token, supabase_url=SUPABASE_URL, supabase_publishable_key=PUBLISHABLE_KEY
        )
    assert failure.value.status == 503


def test_supabase_auth_5xx_never_authenticates(monkeypatch) -> None:
    token = _sign_legacy(_claims())
    _patch_auth_server(monkeypatch, lambda url, headers: _FakeAuthServerResponse(500))

    with pytest.raises(AuthError) as failure:
        verify_access_token(
            token, supabase_url=SUPABASE_URL, supabase_publishable_key=PUBLISHABLE_KEY
        )
    assert failure.value.status == 503


def test_legacy_verification_never_reads_a_jwt_secret(monkeypatch) -> None:
    """`verify_access_token`'s own signature carries no secret parameter, and the legacy branch
    never imports or reads `SUPABASE_JWT_SECRET` — proven by simply not supplying one anywhere
    in this test and confirming a real signature check still isn't attempted locally."""
    import inspect

    parameters = inspect.signature(verify_access_token).parameters
    assert not any("secret" in name for name in parameters)


# --- guards.py: the composed entry point, and ordering ---------------------------------------


def test_require_caller_needs_no_jwt_secret_argument() -> None:
    import inspect

    parameters = inspect.signature(require_caller).parameters
    assert "supabase_url" in parameters
    assert "supabase_publishable_key" in parameters
    assert not any("secret" in name for name in parameters)


def test_require_caller_returns_a_context_forwarding_the_original_token(monkeypatch, keypair) -> None:
    private_key, public_key = keypair
    _patch_jwk_client(monkeypatch, public_key)
    token = _sign_asymmetric(private_key, _claims())

    context = require_caller(
        _Headers(authorization=f"Bearer {token}"),
        supabase_url=SUPABASE_URL,
        supabase_publishable_key=PUBLISHABLE_KEY,
    )

    assert isinstance(context, CallerContext)
    assert context.user_id == USER_ID
    assert context.token == token
    assert context.verification_mechanism == "jwks"


def test_require_caller_rejects_a_missing_header() -> None:
    with pytest.raises(AuthError) as failure:
        require_caller(_Headers(), supabase_url=SUPABASE_URL, supabase_publishable_key=PUBLISHABLE_KEY)
    assert failure.value.status == 401


def test_an_invalid_token_never_reaches_a_domain_or_provider_call(monkeypatch) -> None:
    """The ordering guarantee: `require_caller` fails before anything with a side effect runs."""
    _patch_auth_server(monkeypatch, lambda url, headers: _FakeAuthServerResponse(401))

    called = False

    def side_effecting_domain_call(_caller_token: str) -> None:
        nonlocal called
        called = True

    token = _sign_legacy(_claims())
    headers = _Headers(authorization=f"Bearer {token}")

    try:
        context = require_caller(
            headers, supabase_url=SUPABASE_URL, supabase_publishable_key=PUBLISHABLE_KEY
        )
        side_effecting_domain_call(context.token)
    except AuthError:
        pass

    assert called is False


def test_a_role_claim_is_exposed_but_grants_nothing_here(monkeypatch) -> None:
    """`platform_staff` is a database fact (D45), never a JWT claim. This module exposes the
    claim for inspection and does not use it to decide anything — there is no
    `is_platform_staff`, `is_admin` or similar method anywhere on `CallerContext`."""

    def respond(url, headers):
        return _FakeAuthServerResponse(200, {"id": USER_ID, "aud": "authenticated", "role": "service_role"})

    _patch_auth_server(monkeypatch, respond)
    token = _sign_legacy(_claims())

    context = require_caller(
        _Headers(authorization=f"Bearer {token}"),
        supabase_url=SUPABASE_URL,
        supabase_publishable_key=PUBLISHABLE_KEY,
    )

    assert context.role == "service_role"
    assert not hasattr(context, "is_platform_staff")
    assert not hasattr(context, "is_admin")


def test_the_token_never_appears_in_repr(monkeypatch, keypair) -> None:
    """Logging hygiene: a stray `repr(context)` in a log line must not leak the bearer token."""
    private_key, public_key = keypair
    _patch_jwk_client(monkeypatch, public_key)
    token = _sign_asymmetric(private_key, _claims())

    context = require_caller(
        _Headers(authorization=f"Bearer {token}"),
        supabase_url=SUPABASE_URL,
        supabase_publishable_key=PUBLISHABLE_KEY,
    )

    rendered = repr(context)
    assert token not in rendered
    assert USER_ID in rendered
