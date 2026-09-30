# `@gold/ui`

Generic, source-owned UI primitives and low-level building blocks — the bottom layer of the
frontend, adapted from shadcn/Radix rather than installed as a black box.

It may know about HTML, React, Radix, focus, keyboard behavior, generic interaction state, generic
responsive mechanics and generic semantic styling — including adaptation to GildOps' theme tokens
and accessibility conventions.

It must not know about organizations, customers, work items, finance, communications, providers,
workspaces, routes in the GildOps application, authorization, tenant capabilities, database reads
or business rules.

Import subpath by subpath — `@gold/ui/components/<name>` — never through one barrel.

## Dependency direction

```text
packages/ui
    ^
apps/web/components
    ^
apps/web/features
    ^
apps/web/app
```

This describes preferred UI composition direction, not a mandatory relay: a higher layer is not
required to pass every primitive through every intermediate layer. `packages/ui` itself must never
import upward into `apps/web` or `@/...`.

The package keeps the technical name `@gold/ui`; D69 records the eventual `@gildops/*` rename as a
separate, atomic migration — this package is not renamed ahead of it.
