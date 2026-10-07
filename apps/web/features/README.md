# `apps/web/features`

This directory owns **presentation and interaction for recognizable GildOps product capabilities**.

A feature boundary answers:

> Which product/domain workflow owns this interaction?

It does not mirror every route, database table or commercial Feature one-to-one.

## Related concepts

These names are not interchangeable:

- **Catalogue Feature** — sellable/entitled capability.
- **Web feature package** — UI/interaction boundary in this directory.
- **Domain capability** — authoritative runtime behavior under `lib/domain`.
- **Route** — URL boundary and top-level composition under `app`.

A web feature may represent several routes.

A route may compose several features.

## Dependency direction

A feature may consume:

- shared application components from `apps/web/components`;
- generic primitives from `@gold/ui`;
- domain/application types and readers;
- route-owned server actions.

A feature must not:

- query the database directly;
- reimplement authoritative domain rules;
- weaken authorization;
- import provider SDKs for privileged operations;
- become a second source of navigation truth.

## Shared vs feature-local UI

Prefer an existing shared GildOps component when it already represents the semantic interaction.

Using `@gold/ui` directly is valid for a low-level primitive when no shared semantic abstraction exists.

Promote feature-local UI to `apps/web/components` only when it becomes a stable cross-feature application contract.

Do not promote merely to satisfy a layering diagram.

## Folder depth

Keep a feature flat while its files remain easy to name.

Add subdirectories such as:

```text
components/
forms/
configuration/
utils/
```

only when the feature itself has enough real responsibilities to justify them.

## Naming

Use canonical domain/workspace vocabulary from:

- `docs/product.md`
- `docs/domain-model.md`

Legacy runtime/module names may remain where they are still executable technical identifiers.

Do not let a legacy route or runtime folder redefine current product ownership.

## Business rules

Features render and collect interaction.

Authoritative decisions remain in:

```text
apps/web/lib/domain
database constraints/functions
apps/api/app/domains
```

according to `docs/architecture.md`.

See `docs/ui-system.md` before introducing a new page/surface pattern.
