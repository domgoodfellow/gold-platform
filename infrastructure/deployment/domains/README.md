# Domains

Not built. Every surface today is reached by path (`/organizations/{id}/...`, `/book/{slug}`,
`/portal/{token}`) against one Vercel deployment, with no wildcard domain and no hostname
resolver in front of it.

The intended shape, when it is built, does not change today: one web deployment behind a
resolver that turns a hostname into an organization, handing the same `Organization Context`
every path-based route already resolves into. Context resolution in this codebase is
deliberately written so a hostname could supply it instead of a path segment without changing
anything downstream — see `requireOrganization` (`apps/web/lib/route/organization.ts`) and the
context-descriptor shape in `@gold/types`. Hostname would select *which* organization; RLS still
decides whether the caller may reach it (`docs/constraints.md`'s tenancy rules are unchanged by
where the id came from).

Not a technical blocker and not yet its own named row in `docs/constraints.md`'s "Decided, not
yet built" table — related to, but not the same deferral as, D20's per-tenant marketing surface
(that is about a tenant's own site having pages and blocks; this is about how any surface is
addressed). Nothing here needs solving before a real customer asks for their own subdomain or
custom domain. When it is built, this file is where the DNS/wildcard-certificate setup for each
tier gets written down.
