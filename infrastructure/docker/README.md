# Docker

Nothing here runs its own containers. `pnpm db:start` shells out to the Supabase CLI
(`supabase start`), which owns the actual `docker-compose` definition — Postgres, GoTrue, Kong,
Storage, Studio and the rest — configured by `supabase/config.toml` at the repo root, not by
anything in this directory.

A change to `supabase/config.toml` needs the stack **restarted, not reset**: `npx supabase stop`
then `npx supabase start`. `pnpm db:reset` re-applies migrations against the already-running
containers and does not re-read that file (see the root `CLAUDE.md`, Commands).

Neither deployable runs in a container in any of the three shipped tiers. `apps/web` and
`apps/api` are both serverless functions on Vercel (D24 forbids a daemon), and a Private/
Enterprise deployment is the identical code against one organization's own Supabase project —
not a self-hosted container image. If that ever changes, this is where its build context and
compose file would go.
