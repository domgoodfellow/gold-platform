# UI system audit

Written before Phase 1 (`/platform` overview and its navigation), per the brief that asked for
this pass. It is a working document for that slice, not an eighth `docs/` file under D8's budget
— it is deleted or folded into `ui-spec.md` once Phase 1 lands, the way a design note should be.

---

## A. Current UI architecture

**shadcn config** (`apps/web/components.json`): style `radix-nova`, Tailwind v4 with CSS
variables, base colour `neutral`, no prefix, icon library `lucide`. `ui/` is the alias for
source-owned primitives.

**Installed shadcn primitives** (`components/ui/`): `breadcrumb`, `avatar`, `button` (unused —
see below), `card`, `dropdown-menu`, `input` (unused), `separator` (unused), `sheet`, `sidebar`
(unused), `skeleton` (unused), `tooltip`. No `tabs`, `dialog`, `dropdown-menu`-derived menu, no
`table`, `badge`, or `chart`.

**GOLD semantic layer** (`components/`, per its own `README.md`, one folder per `ui-spec.md`
section):
- `controls/` — `Button`/`ButtonLink` (four tones, three sizes), `TextInput`/`SelectInput`/
  `TextArea`, `FieldLabel`/`Hint`/`ErrorText`, `OptionalSelect`, `form.tsx` helpers.
- `containers/` — `Section`/`SectionHeading`/`PageHeading`/`GroupHeading`, `DividedList`/
  `EmptyState`, `Card`/`Disclosure`, `Dialog`/`ConfirmSubmit`, `AppPage` (five named widths),
  `AppShell` (the three-rendering shell, §2 of `ui-spec.md`), `RecordHeader` (detail-screen
  identity: breadcrumb + heading + summary + actions, built on shadcn's `Breadcrumb`),
  `account-menu.tsx`, `site-shell.tsx`.
- `display/` — `DataTable`/`TableScroll`/`TableHeaderCell`/`TableCell` (responsive table↔card),
  `Badge`/`DefinitionList`/`Detail`/`Stat`(removed)/`Toolbar`, `Widget`/`WidgetGrid`/
  `WidgetPanel` (the area-dashboard vocabulary, §2b).
- `class-names.ts` — `cx`, `FOCUS_RING`.

**Shells.** Two: `SiteShell` (GOLD's own chrome — marketing + auth) and `AppShell` (the operator
and platform consoles — sidebar/rail/bottom-bar, three renderings over one `AREAS`/`PLATFORM_NAV`
list). The platform console (`app/(platform)/platform/layout.tsx`) uses `AppShell` with its own
`PlatformNavigation`/`PlatformSidebarHeader`/`PlatformMobileNavigation`, deliberately outside
`navigation.ts` (`ui-spec.md` §1: "the platform console has no `navigation.ts` entry").

**Current dashboard implementations.** One: Today (`features/today/today-dashboard.tsx`), built
from `Widget`/`WidgetGrid`/`WidgetPanel` exactly as `ui-spec.md` §2b specifies — product-owned
placement, `?widget=` expansion, no trend/comparison. `/platform` has none; it redirects straight
to `/platform/organizations` (`app/(platform)/platform/page.tsx`), a decision the file's own
comment calls correct ("no redundant overview: Organizations is the useful first control-plane
task") — true when M5 shipped with one screen behind it, false now that Catalog, Pricing,
Providers and Failures all exist.

---

## B. Missing primitives

| Primitive | Classification | Why |
|---|---|---|
| `Tabs` | Unnecessary now | The two places that look tab-shaped — the tenant workspace's own section nav, the operator shell's areas — are both built as plain link rows with `aria-current`, matching `ui-spec.md`'s "no interleaved list" and focus-ring rules already. A `Tabs` primitive would be a second navigation pattern next to `AREAS`, not a replacement for one. |
| `Dialog` (shadcn) | Unnecessary | GOLD already has `containers/dialog.tsx` (`Dialog`, `ConfirmSubmit`), built for the native `<dialog>` element and M11's confirmation rule (submits the *original* form via the `form` attribute). Installing shadcn's would be a second, incompatible confirmation shape. |
| `Table` (shadcn) | Unnecessary | `display/table.tsx`'s `DataTable` already does more than a markup wrapper would — the table↔card responsive switch `ui-spec.md` §5a requires, `primary`/`secondary` emphasis, an `actions` slot. Nothing here is a gap. |
| `Chart` | Likely soon, not now | No chart dependency exists, and Phase 1 introduces none — see §F. The moment a platform-wide, honestly-aggregable time series exists (provider cost vs. tenant charge, once a platform-wide commercial aggregate is built — see §H), this is the first real candidate. |
| `Drawer` (Base UI) | Unnecessary, and worth refusing explicitly | §5 below. |
| `Tabs`, `Command`, `Popover`, `Select` (shadcn) | Unnecessary | No screen needs a command palette; `SelectInput` already covers the native-select case `ui-spec.md` sanctions, and a styled combobox has no caller yet. |

**Already installed and genuinely unused** (dead weight, not a gap): `button.tsx`, `input.tsx`,
`separator.tsx`, `skeleton.tsx`, `sidebar.tsx` under `components/ui/` have no import anywhere in
`app/`, `features/`, or `components/` outside their own file. `sidebar.tsx` in particular is a
complete shadcn Sidebar block sitting unused beside a hand-built one (`AppShell`) that already
satisfies `ui-spec.md` §2's three renderings, its own `localStorage` collapse state and its
tenant-brand compatibility — the shadcn block does none of the last two. These are not "missing
primitives," they are scaffolded and abandoned; see §C.

---

## C. Duplicate or redundant abstractions

**`components/ui/card.tsx` vs. `components/containers/card.tsx` — a real defect, not a style
choice.** shadcn's `Card` reads `bg-card`, `text-card-foreground`, `text-muted-foreground`,
`ring-foreground/10`, `rounded-xl` — none of which `app/globals.css` defines. This project's
`@theme` block defines exactly nine roles (`ui-spec.md` §3: background, foreground, surface,
border, muted, subtle, danger, accent, on-accent, accent-text) and no `--card`, `--card-foreground`
or `--muted-foreground`. Every one of those shadcn classes therefore fell back to Tailwind's
*default* palette — an un-themed grey that tracked neither light/dark scheme nor a tenant's brand
override (`BrandStyle` only ever touches the nine roles). `components/README.md` says primitives
under `ui/` are meant to be "adapted to GOLD tokens before semantic use"; this one was not. It was
used in four places, all written in the same slice that added the commercial control plane:
`app/(platform)/platform/organizations/[organizationId]/page.tsx`, `.../commercial/page.tsx`,
`.../providers/page.tsx`, `app/(platform)/platform/pricing/page.tsx`.

**Resolution: kept, by explicit direction.** A retrofit to GOLD's own `Card` (plus a small
`FormCard` for the repeated "form beside a list" shape, and `Widget`/`WidgetGrid` for the tenant
summary tiles) was built and then reverted — the product owner prefers shadcn's `Card` visually
and asked for it back. The theming gap above is real and unresolved as a result: these four
screens render `Card`'s grey against Tailwind's default palette rather than the nine roles
`ui-spec.md` §3 defines, so they neither shift with dark mode the way every other screen does nor
pick up a tenant's brand override. Recorded here rather than silently dropped from the audit,
per this document's own "say when something is wrong" instruction — the fix is known and small
(either define `--card`/`--card-foreground`/`--muted-foreground` as aliases onto the nine roles
in `globals.css`, or keep `Card` unthemed as a deliberate, narrower look for the platform console
only, distinct from the operator shell). Neither was decided; both remain open, **P2**.

**`components/ui/sidebar.tsx`** duplicates `AppShell` outright and should be deleted rather than
kept "in case," per D8's own reasoning about document sprawl applied to code: an unused
alternative implementation is a decision nobody made, sitting where the next person will assume
it is the current one. **P2** — delete once confirmed unreferenced (this audit already checked;
worth a second look at delete time in case a same-day change added a caller).

**`Widget`/`WidgetGrid`/`WidgetPanel` vs. a hypothetical `MetricCard`.** The brief's own example
vocabulary names `MetricCard` as a GOLD semantic component. It already exists under a different
name: `Widget` takes `title`/`value`/`note`/`href` and is exactly a metric card with an optional
drill-through, plus the one rule that matters for a platform console (`ui-spec.md` §2b: "no
trend, no comparison, no percentage" — the platform cannot tell a tenant, or itself, whether a
number moving is good or bad). Phase 1 reuses `Widget` rather than inventing `MetricCard` beside
it — see §G.

---

## D. Navigation terminology problems

**The tenant workspace's "Commercial" tab** (`features/platform/tenant-workspace.tsx`,
`TenantWorkspaceHeader`'s `sections`). The screen behind it shows two things: what this specific
business agreed to pay (product, period, price) and which modules it is entitled to use right now
(wanted × paid). To a GOLD staff member reading the sidebar, "Commercial" is ambiguous with the
*platform's own* commercial catalogue — the top-level nav group of the same name, one level up,
holding "Pricing" (GOLD's global list/retail/provider rates). Both are staff-facing; both use the
identical English word for two different referents (this tenant's deal vs. GOLD's price list).
**Renamed to "Plan & Billing"** in Phase 1 — it names what the screen actually shows (an agreement
and its modules) without borrowing "Commercial," and reads the way an operator expects a SaaS
console to label the same information about their own account. The route (`/commercial`), the
domain directory (`lib/domain/commercial/`), and every function name are untouched — this is a
label change in one array, not a rename of the concept CLAUDE.md's own architecture table
correctly calls "Commercial" (D42, D43: GOLD selling GOLD).

**The top-level "Commercial" nav group** (`features/platform/platform-navigation.tsx`,
`PLATFORM_NAV`/`PLATFORM_GROUPS`), holding only "Pricing" today. Once the tenant-tab collision
above is fixed, this group's own name is still worth revisiting on its own contents: "Commercial"
for a group holding exactly one item (GOLD's rate cards) reads as a placeholder for something
wider than it is. **Renamed to "Revenue"** in Phase 1, matching the brief's own suggested
end-state and leaving room for a future "Usage & Margin" entry (§H) without a second rename later.

**Not renamed, and why.** "Infrastructure" (Providers, Failures) and "Catalog" (Products, Modules,
Meters) are both architecture words, and both are also the correct staff-facing words for this
audience — the platform console is GOLD's own engineering-and-ops surface, read by GOLD staff who
already think in these terms, not a tenant-facing screen where D23's "no architecture noun in
front of a customer" rule would bite. Renaming either would be churn with no comprehension gain.

---

## E. Dashboard candidates

| Surface | Status | Note |
|---|---|---|
| Platform (`/platform`) | **Built this slice** | See §H. |
| Tenant platform workspace (`/platform/organizations/[id]`) | Unchanged this slice | Already a light dashboard (three `Card`s: lifecycle, modules, last activity) but built with the un-themed shadcn `Card` (§C) and with numbers that don't yet say *does this tenant need attention* — no failure count, no entitlement gap. Real "command centre" work (open failures for this tenant, plan/billing state, provider health) is **P1**, deliberately deferred out of this slice per the brief's own scope fence (§13's ambition is explicitly sized for a later pass). |
| Operator Today (`features/today/today-dashboard.tsx`) | Unchanged, used as precedent | Already the reference implementation of `ui-spec.md` §2b; nothing here needed touching. |
| Other operator areas | Unchanged | Out of scope per the brief (§21). |

---

## F. Metric/data availability for the Platform Overview

| Candidate metric | Source | Currency/period concern | Trustworthy now? |
|---|---|---|---|
| Organizations, total | `platform_tenants` (`listTenants`) | None | **Yes** |
| Organizations, live vs. setting up | `organizations.operational_state`, not previously on `platform_tenants` | None | **Yes, after a one-column view migration** (`20260913000003_platform_console_reads_lifecycle_state.sql`) — the column already exists and is already forward-only (`launch_organization`); it was never read by this view. No new calculation, no new invariant. |
| Recently provisioned organizations | `platform_tenants`, ordered by `created_at` | None (each row keeps its own currency/timezone, never summed) | **Yes** |
| Open failures (operational) | `platform_failures` (`listFailures`) | None | **Yes** |
| Open failures (provider reconciliation) | `platform_provider_sync_failures` (`listProviderSyncFailures`) | None | **Yes** — currently and honestly always empty; nothing writes this table yet (D43), which the empty state must say plainly rather than implying a bug. |
| Usage revenue / provider cost / realized margin, platform-wide | `organization_commercial_summary(p_organization_id, …)` | **No platform-wide aggregate exists.** The function is scoped to one organization at a time (D43's own invariant tests, `commercial-usage.test.ts`, exercise it per-tenant only) | **Not this slice.** Two ways to get there, both real schema/domain work: (a) loop `listTenants` and call the per-org RPC once per tenant, then re-implement its currency-safe grouping and null-margin rule in TypeScript across tenants — this duplicates I29–I31's calculation in a second runtime, which is exactly what I4/I5's "exactly one calculation" reasoning refuses one level up; or (b) generalize `organization_commercial_summary`'s `p_organization_id` to accept `null` (all organizations), reusing the identical SQL and grant. (b) is the honest fix and is **P1**, named in §H — not attempted here because it touches a function with four load-bearing invariants (I29–I32) and its own dedicated test file, and deserves a reviewed change of its own rather than a rider on a navigation slice. |
| Unpriced usage events | No existing reader | Same root cause as above | **Not this slice**, same reasoning. |
| Module entitlement gaps (wanted, not paid) platform-wide | `module_commercial_state(p_organization_id)` | Same shape as usage: per-organization RPC, no platform-wide form | **Not this slice**, same reasoning — would need the same either/or as usage. |
| MRR | Would need `organization_commercial_terms` normalized to a monthly cadence | `period_start`/`period_end` are arbitrary date ranges with no declared billing cadence — a term covering 47 days is not obviously "1.5 months" and a term covering a year is not obviously "12 months of the same amount" | **Not calculable truthfully today.** Per the brief's own instruction (§10): documented here rather than derived casually. A trustworthy MRR needs either a cadence field on `organization_commercial_terms` or a rule for normalizing an arbitrary period, and neither exists. Not proposed as a schema change in this slice — no caller has asked for MRR yet, which is the same evidentiary bar `constraints.md` applies everywhere else. |
| Sellable products, meters defined | `listProducts`/`listMeters` (`lib/domain/commercial/catalogue.ts`) | None — vocabulary counts, not money | **Yes** — already staff-readable, already used unscoped by `/platform/pricing` |
| Retail rates recorded, provider rates recorded | `listRetailRates`/`listProviderRates` | None — a count of rows, not an amount | **Yes**, same reasoning |

**Net for Phase 1:** four widgets (organizations, with their live/setting-up split; open
failures, operational and provider-reconciliation; the sellable catalogue's size; how many rate
cards are recorded) plus one truthful table (recently provisioned organizations, each in its own
currency and zone). No chart — there is no honestly-aggregable time series available without the
platform-wide commercial aggregate named above, and §16 of the brief is explicit that a chart
with weak semantics is worse than none.

---

## G. Proposed component layering

```
shadcn primitives            Breadcrumb, Card(unused here), Sheet, Tooltip, Avatar, Dropdown
        ↓
GOLD semantic layer          Widget / WidgetGrid / WidgetPanel   (existing — reused, not duplicated)
                              DataTable / Badge                  (existing — reused)
                              RecordHeader / PageHeading / Hint   (existing — reused)
        ↓
Feature composition          PlatformOverview  (new — features/platform/platform-overview.tsx)
        ↓
Route                        app/(platform)/platform/page.tsx  (rewritten — was a redirect)
```

No new primitive, no new semantic component. The one new file is a feature composition, and it is
new because "how does the platform console's own landing screen read its four numbers and one
table" is genuinely new product surface — everything under it already existed and already had the
right shape.

---

## H. Implementation plan (Phase 1, this slice)

1. **Migration**: widen `platform_tenants` with `operational_state` (additive, `security_invoker`
   unchanged, no grant change). Regenerate `database.types.ts`.
2. **Domain**: extend `Tenant`/`toTenant` in `lib/domain/platform/tenants.ts` with
   `operationalState`. Add `lib/domain/platform/overview.ts` — a thin composition (counts, not a
   calculation) over `listTenants`/`listFailures`/`listProviderSyncFailures`, so the route stays a
   caller rather than an aggregator.
3. **Route**: `app/(platform)/platform/page.tsx` — real overview, `AppPage width="full"`.
4. **Feature**: `features/platform/platform-overview.tsx` — the composition, built from
   `WidgetGrid`/`Widget`/`DataTable`/`Badge`.
5. **Navigation**: `platform-navigation.tsx` — add `Overview` under a new `Platform` group;
   rename the `Commercial` group to `Revenue`.
6. **Terminology**: `tenant-workspace.tsx` — rename the `Commercial` tab label to `Plan & Billing`.
7. **Tests**: a real-Postgres test exercising empty state, organizations present in both
   lifecycle states, failures present and absent, and refusal for a non-staff caller; a structural
   test asserting the route no longer redirects and reads through the domain layer.

**Deliberately not in this slice** (named with triggers, matching `constraints.md`'s own
"Decided, not yet built" pattern rather than leaving them as loose asides):

| Item | Trigger |
|---|---|
| Platform-wide usage/revenue/margin (needs `organization_commercial_summary(null)` or equivalent) | The next slice that touches `lib/domain/commercial/` — bundling it with a navigation change risks the four invariants it carries for no reason |
| Delete unused `components/ui/{button,input,separator,skeleton,sidebar}.tsx` | Confirmed still unreferenced at delete time |
| Tenant workspace Overview as a real command centre (failures, plan state, provider health for *this* tenant) | Named in the brief as explicitly out of scope for this slice (§13, §21) |
| A first chart | The platform-wide commercial aggregate above exists, giving a truthful time series to plot |
