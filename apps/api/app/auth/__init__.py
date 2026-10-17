"""The one authentication boundary this runtime has for a human caller.

**Answers who, never what.** `require_caller` below is the single place that parses an
`Authorization: Bearer ...` header and authoritatively verifies the token before anything else
runs — a signature check against the project's own published keys, or, for a project still on
the legacy shared secret, an online check against Supabase's own Auth server. Either way, what it
hands back, a `CallerContext`, is an identity and a token to forward, nothing else. Whether that
identity may touch a given row is answered exactly where it always was: RLS, `app/domains/**`,
and the platform-staff checks (ADR-003, ADR-026). Folding an
authorization decision in here would be the thing the module-visibility rule already refused once for modules, on a
different axis.

**No unverified token ever becomes a `CallerContext`.** There is no mode where a token's claims
are read without a signature check (local or Supabase's own) and treated as good enough to
proceed — a domain command, an AI call, a Twilio/email/Stripe side effect all happen only after
`require_caller` returns, never before it decides.

**Mints nothing.** Unlike `app.core.db` and `app.core.runner`, which sign short-lived tokens for
machine Postgres roles because no person is present, this package only ever verifies a
token somebody else — Supabase Auth — issued. It holds no signing key and needs none, for either
verification mechanism it uses.
"""

from __future__ import annotations

from app.auth.context import CallerContext
from app.auth.errors import AuthError
from app.auth.guards import require_caller

__all__ = ["CallerContext", "AuthError", "require_caller"]
