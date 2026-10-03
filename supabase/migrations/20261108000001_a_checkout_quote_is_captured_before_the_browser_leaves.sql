-- A browser cannot be trusted to come back from the processor's own page in the same instant it
-- left: the organization's package can change while it is away, and nothing it carries in the
-- return URL is proof of what it actually agreed to pay. The server-built quote is captured onto
-- the correlation row at the moment checkout begins, so a later mismatch is detectable rather than
-- silently re-priced against whatever the package happens to be when the browser returns.

alter table public.platform_billing_checkout_sessions
  add column quote_snapshot jsonb,
  add column quote_version text,
  add column expires_at timestamptz;

comment on column public.platform_billing_checkout_sessions.quote_snapshot is
  'The purchase quote (lib/domain/platform-billing/quote.ts) resolved server-side at the moment '
  'this session was created -- what the organization was told it was buying. Never read back as '
  'authorization for anything; it is provenance, compared against a fresh quote at confirmation '
  'time to detect a configuration change the browser raced past.';

comment on column public.platform_billing_checkout_sessions.quote_version is
  'The quote''s own commercialConfigurationVersion at capture time -- the one value a fresh quote '
  'is compared against to decide whether the package changed while the browser was away.';
