# `@gold/ui`

`packages/ui` contains generic source-owned UI primitives and low-level building blocks adapted from shadcn/Radix.

It is the bottom reusable UI layer.

## May know about

- HTML;
- React;
- Radix;
- focus and keyboard behavior;
- generic interaction state;
- generic responsive mechanics;
- generic semantic styling;
- GildOps theme tokens/accessibility conventions.

## Must not know about

- Organizations;
- Customers;
- Work Items;
- Finance;
- Communications;
- Providers;
- workspaces;
- application routes;
- authorization;
- tenant entitlements;
- database reads;
- business rules.

Import primitives by subpath:

```text
@gold/ui/components/<name>
```

Do not introduce one giant barrel merely for shorter imports.

## Composition direction

```text
packages/ui
↑
apps/web/components
↑
apps/web/features
↑
apps/web/app
```

This is responsibility direction, not a requirement that every primitive be wrapped at every intermediate layer.

A feature may use a generic primitive directly when no stable shared GildOps semantic component exists.

`packages/ui` must never import upward into `apps/web`.

## Technical package name

`@gold/ui` is a live technical identifier.

Human-facing product language is GildOps.

A future package-namespace migration must be bounded and atomic; do not rename this package independently.

See:

- `docs/architecture.md`
- `docs/ui-system.md`
- `docs/decisions/ADR-023-gildops-naming-migrates-forward-without-rewriting-history.md`
