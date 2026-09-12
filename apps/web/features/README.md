# `features/`

Presentation and interaction for recognizable GOLD product capabilities.

A feature boundary answers which product workflow owns the UI, not how many routes currently call
it. Route files load data and compose screens; features render and operate the capability; generic
interface vocabulary stays in `components/`; business rules stay in `lib/domain/`.

Current boundaries:

| Feature | Owns |
|---|---|
| `automations/` | Rule, condition, action and message-template UI |
| `reporting/` | Report navigation, filters, results, dashboards and management forms |
| `custom-fields/` | Rendering and collecting tenant-defined fields across supported entities |
| `documents/` | Listing, uploading and presenting documents attached to any entity `DOCUMENT_ENTITIES` allows |
| `timeline/` | Rendering a record's own history — the interpretive work stays in `lib/domain/timeline/` |
| `public-profile/` | Editing and rendering a business's public identity |
| `branding/` | Applying a tenant's approved visual roles |
| `locale/` | Timezone and currency controls used by organization-facing workflows |
| `today/` | The lifecycle-aware operational cockpit and its expanded views |
| `work/` | Work boards, job records, checklists, consumption, pricing and billing interactions |

Keep a feature flat while its files remain easy to name. Add `components/`, `forms/` or `utils/`
subdirectories only when the feature itself has enough distinct responsibilities to need them.

Features may import domain types and call route-owned server actions. They do not query the
database, reimplement validation, calculate business results or weaken authorization checks.
