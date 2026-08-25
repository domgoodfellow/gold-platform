---
description: Turn discovery-call notes into platform terms - entities, rules, events, gaps
argument-hint: [business name]
---

Turn this business into platform terms. Read `docs/domain-model.md` for the core entities
first.

Business: $ARGUMENTS

Produce, and nothing else:

- **Entities** — the nouns this business tracks, each mapped onto a core entity
  (Organization, User, Customer, Location, Asset, Work Item, Resource, Document) or flagged
  as genuinely new
- **Work Item types** — and the statuses each one moves through
- **Rules** — what constrains scheduling, pricing, assignment, and completion
- **Events** — what happens that something else must react to
- **Metrics** — what the owner checks to know the business is healthy
- **Friction** — where they currently spend manual hours, and what it costs them

For each entity, state whether it is **configuration** or **code**. Default to
configuration; the burden of proof is on code.

Flag anything that cannot be expressed as configuration on the current kernel, and name the
module or primitive that is missing. That list is the actual output — it is how the platform
learns what it lacks.

Do not propose schema. Do not write code.

NOTES FROM THE CALL:
