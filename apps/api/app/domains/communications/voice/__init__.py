"""Voice -- calling, and the record of how a call went.

Only call wrap-up lives here so far. Placing a call, reading history, and the outbound-identity
setting stay in `apps/web/lib/domain/reception/**` for now (D2's incremental-extraction rule) --
carrier-facing and needing `apps/web/lib/adapters/telephony`'s provider adapter at the moment of
dialling, which this domain layer must not import (`app/providers/**` is where a vendor's
shape belongs, and no Voice integration adapter exists in Python yet).
"""

from __future__ import annotations
