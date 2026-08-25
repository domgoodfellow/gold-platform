# Changelog

Shipped work, recorded on merge. Milestone definitions live in `docs/roadmap.md`; task state
lives on the issue board. Nothing here has a checkbox (`constraints.md` D9).

## Unreleased

### Tenancy kernel — organizations, memberships, events

The first vertical slice: schema, domain, route, UI, guard, test.

- `infra/supabase/migrations/20260825000001_tenancy.sql` — `organizations` (the tenant),
  `memberships`, and the append-only `events` table; RLS enabled and forced on all three;
  `app.current_tenant_ids()` as the single tenant resolution point; `public.create_organization`
  as the narrow privileged bootstrap.
- `apps/web/src/lib/domain/tenancy/` — `listMyOrganizations`, `createOrganization`,
  `requireActor`. The route, the server action, and the form are callers and decide nothing.
- `apps/web/tests/tenancy.test.ts` — two organizations with identical names in one database,
  under two genuinely signed-in users. Verified non-vacuous: three organizations exist while
  one user sees two and the other sees one.

Newly enforced: **I1, I2, I3, I11, I12** (see `docs/domain-model.md`).

Deliberately absent: no `packages/`, no `services/api/`, no roles table, no per-tenant
terminology, no Customer, Location, Asset, Work Item, Resource, Document, or Field
Definition. Each arrives with the slice that needs it.
