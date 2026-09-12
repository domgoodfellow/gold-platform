# Vercel

Two Vercel projects, one repository, linked via `.vercel/project.json` at the repo root:

| Project | Root directory | Runtime |
|---|---|---|
| `web` | `apps/web` | Next.js (`@gold/web`) |
| `api` | `apps/api` | Python (FastAPI, D26) |

Both deploy from the same GitHub repository and the same commit — there is no separate release
process for one without the other, and no build step outside each project's own `pnpm --filter`/
Python entrypoint (D13: no build orchestrator).

Environment variables are configured per-project, per-environment (Development/Preview/
Production), directly in each Vercel project's settings — **the exhaustive, current list of
every variable either project reads, its status, and whether it is safe to enter yet, is
`SETUP.md` at the repo root.** This file does not duplicate that list; it only says where the
two projects live and how they relate.

Neither project holds a service-role Supabase key (D14) or a secret this repository's own
`.env.example` files don't already name. A new environment variable is added to the relevant
`apps/*/​.env.example` in the same change that starts reading it, with its secret/sensitivity
classification documented there — that is the source `SETUP.md` reads from, not the reverse.
