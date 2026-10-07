# Infrastructure

This directory contains infrastructure-adjacent repository assets.

Canonical environment, release and operations documentation lives in:

- `docs/development.md` — local environment
- `docs/deployment.md` — Preview/Production deployment
- `docs/operations.md` — runtime reliability and incident operation
- `docs/integrations.md` — provider infrastructure
- `docs/public-web.md` — public hostname/domain behavior

Do not recreate separate environment manuals under each infrastructure subdirectory.

The executable sources remain authoritative for implementation details such as:

- `supabase/config.toml`;
- `supabase/migrations/`;
- `apps/api/vercel.json`;
- Vercel project configuration;
- provider dashboards/configuration.

If an infrastructure subdirectory later contains an independently operated artifact that genuinely requires local instructions, add a narrow README for that artifact rather than duplicating the global deployment guide.
