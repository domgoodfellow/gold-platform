# `features/`

Presentation and interaction for recognizable GOLD product capabilities.

Four related names are deliberately not interchangeable:

- A **Catalogue Feature** is a commercial capability, such as `communications.voice.call_history`.
- A **web feature package** is a coherent workflow boundary, such as `communications/voice/`.
- A **domain capability** is runtime behavior, such as `lib/domain/reception/`.
- A **route** authenticates, loads and composes, such as `/organizations/[organizationId]/calls`.

The legacy runtime module `reception` backs both CRM Sales and Communications Voice. That is why
the web has separate `crm/sales` and `communications/voice` packages rather than mirroring one
runtime folder or creating one folder for every Catalogue Feature.

A feature should prefer an existing shared GildOps semantic component from `apps/web/components`
when that component already represents the required interaction. A feature may also use `@gold/ui`
directly for low-level composition (an Accordion, an Alert, a Tabs, a Popover) where no shared
application semantic exists — this is not a violation, and features must not be prohibited from
importing `@gold/ui`. Promote a feature-local construction into `apps/web/components` only when it
represents a stable cross-feature application contract, never merely to satisfy a layering diagram.

A feature boundary answers which product workflow owns the UI, not how many routes currently call
it. Route files load data and compose screens; features render and operate the capability; generic
interface vocabulary stays in `components/`; business rules stay in `lib/domain/`.

Current boundaries:

| Feature | Owns |
|---|---|
| `automations/` | Rule, condition, action and message-template UI |
| `reporting/` | Report navigation, filters, results, dashboards and management forms |
| `custom-fields/` | Rendering and collecting tenant-defined field values across supported entities, and — in `custom-fields/configuration/` — defining those fields: the entity-scoped list, its create/edit Sheets and forms, and the URL-backed entity nav. One component, every host that configures fields (Settings' own Data & automation page and every entity's own Configure rail) |
| `documents/` | Listing, uploading and presenting documents attached to any entity `DOCUMENT_ENTITIES` allows |
| `timeline/` | Rendering a record's own history — the interpretive work stays in `lib/domain/timeline/` |
| `public-profile/` | Editing and rendering a business's public identity |
| `portal-access/` | Making, listing and revoking one customer's own portal links — the customer's access to their own things, not the business's public one |
| `branding/` | Applying a tenant's approved visual roles |
| `locale/` | Timezone and currency controls used by organization-facing workflows |
| `today/` | The lifecycle-aware operational cockpit and its expanded views |
| `work/` | Work boards, job records, checklists, consumption, pricing and billing interactions |
| `crm/customers/` | Customer list, create and edit interaction, the customer detail screen's own presentation, and the customer's Configure panel — its custom-field configuration (hosting `custom-fields/configuration/`) and, where Sales is on, its pipeline-stage configuration (hosting `crm/sales/stage-settings-sheet.tsx`) |
| `crm/sales/` | The canonical Pipeline board, its per-card stage control, and stage-vocabulary settings |
| `communications/voice/` | Call history, call wrap-up, outbound identity and outcome-vocabulary settings |
| `integrations/` | The tenant Integrations product: `catalogue/` (Browse, its cards and brand identity), `connections/` (Connected, the CSV connect form, one connection's own record and its Disconnect/Check/assistant-access controls), `sources/` (the Data sources table) and `imports/` (upload, the CSV column-mapping editor, the run collection and one run's own review/apply). `integrations-nav.tsx` is the one `ViewNav` every one of the four views renders |
| `platform/providers/` | Platform's read of infrastructure GOLD operates: `ProviderIcon`, and `ProviderDetail` for every Provider without its own account model — Twilio keeps its own telephony-specific page instead |

`crm/` and `communications/voice/` are also this repository's reference example of a **command**
routed through `apps/api/app/domains/` rather than `lib/domain/`: `crm/sales/stage-control.tsx`
and `communications/voice/wrap-up-form.tsx` each call a route-owned server action that forwards
the caller's own token to a FastAPI domain command, which calls one narrow Postgres RPC. Every
other write above still goes straight to `lib/domain/`, and most of CRM's and Voice's own writes
still do too — see `apps/api/app/domains/__init__.py` for which few do not and why.

Keep a feature flat while its files remain easy to name. Add `components/`, `forms/` or `utils/`
subdirectories only when the feature itself has enough distinct responsibilities to need them.

Features may import domain types and call route-owned server actions. They do not query the
database, reimplement validation, calculate business results or weaken authorization checks.
