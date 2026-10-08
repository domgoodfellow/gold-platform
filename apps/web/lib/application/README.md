# Web application layer

`apps/web/lib/application` owns **use-case and screen/read-model composition**.

Each module coordinates the domain reads and supporting capability state required by one recognizable application task.

It may:

- combine several domain readers;
- resolve bounded provider/readiness context;
- produce typed page/read models;
- reduce N+1 read patterns;
- keep routes thin.

It does not own:

- RLS;
- database invariants;
- business-rule reimplementation;
- React/JSX;
- Tailwind;
- Next.js route APIs;
- redirects;
- browser UI state;
- provider dialects.

Routes retain request parsing and route guards.

Features render the resulting model.

Domain ownership remains in `apps/web/lib/domain`.

See `docs/architecture.md`.

`communications/dashboard.ts` composes the bounded Communications Home read model from canonical calls, Inbox, numbers, routing, outcomes and runtime readiness. It projects recorded activity without introducing another event store or UI dependencies.
