# Local

What a fresh clone needs before `pnpm --filter @gold/web dev` or `pnpm check` will run.

## Required

- `apps/web/.env.local`, copied from `apps/web/.env.example`. Anon key only — see
  `apps/web/.env.example` for the full, current variable list and each one's secret/browser-
  visibility classification. Nothing here duplicates that list; it goes stale the moment it does.
- `apps/api/.env`, copied from `apps/api/.env.example`, for `pnpm check:api`.
- Docker, for `pnpm db:start` (the Supabase CLI's own local stack).

## Optional, by feature

Every optional variable in `apps/web/.env.example` and `apps/api/.env.example` is optional for
the same reason: the deployment it's missing from is a complete deployment, not a broken one
(the house rule this repository applies everywhere a provider is optional). Configure only what
the feature you're working on needs — geocoding, Stripe, Twilio, Resend (both the tenant-channel
key in `apps/api` and GOLD's own platform-email key in `apps/web`), or an LLM key for setup
drafting.

## Never

No service-role Supabase key in `apps/web` (D14). No production credential of any kind, ever, in
a local `.env.local` — Preview and Production values live in Vercel only (see
`infrastructure/deployment/vercel/README.md`).
