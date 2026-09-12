# Supabase

One Supabase project per deployment tier (D4: shared-schema multi-tenancy, not a database per
tenant) — local, and whatever hosted project each of Preview/Production is linked to via
`supabase link`.

`supabase/migrations/` is the source of truth for schema (root `CLAUDE.md`). The commands that
touch a real project:

| Command | What it does |
|---|---|
| `pnpm db:start` | Starts the local stack via the Supabase CLI (Docker) |
| `pnpm db:reset` | Re-applies every migration from scratch, locally |
| `pnpm db:types` | Regenerates `apps/web/lib/db/database.types.ts` — checked in, and a stale one fails the gate (D15) |
| `pnpm db:push` | Applies pending migrations to the linked **remote** project |

`pnpm db:push` is the only one of these that touches a shared, non-local database. It is never
run as part of the gate (`pnpm check`) and is a deliberate, individual action — the same caution
`CLAUDE.md`'s Git Safety Protocol asks for on any command that changes shared state.

Auth configuration that lives in `supabase/config.toml` (hooks, redirect URLs, provider settings)
is local-stack configuration; a hosted project's equivalent settings are configured in that
project's own Supabase dashboard and are not read from this repository at all. Where the two
must agree — for example, an auth hook wired locally must also be enabled in a hosted project's
dashboard — the migration or config comment that introduces it says so (see
`supabase/config.toml`'s own comments for the current set).
