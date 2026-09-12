# Preview

Vercel Preview deployments, one per pull request, for both the `web` and `api` projects
(`infrastructure/deployment/vercel/README.md`).

The full, current variable-by-variable status for this tier — including which ones share a
hosted Supabase project with Production and therefore need test/sandbox credentials rather than
live ones — is the root `SETUP.md`, specifically its "Preview" rows and the "Preview data
isolation caution" table above the final variable list. This file does not repeat that; `SETUP.md`
is the one place it is kept current.

The one thing worth stating here rather than there: Preview is not an isolated database unless a
separate staging Supabase project is deliberately set up for it. Until one exists, treat any
credential that can write — a real Twilio auth token, a real Resend key, a live Stripe key — as
reaching the same rows Production does, and configure Preview accordingly (test/sandbox
credentials, or none).
