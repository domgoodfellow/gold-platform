# `src/features/`

UI that belongs to a capability rather than to a route, because **more than one surface renders
it**.

Everything in `apps/web` so far has belonged to exactly one route, so its components sit beside
that route — `work-forms.tsx` next to `/work`, `price-forms.tsx` next to `/pricing`. That is
still the rule for anything with one caller. This directory is for the cases where it stops
being true.

The first inhabitant is the public profile: the **admin** surface edits a business's public
copy and the **booking** surface renders it, and neither route owns the other. Putting the
editor under `/settings` and the renderer under `/book` would be the parallel set per surface
that D23 forbids in as many words — *"one component file, extended — never a parallel set per
surface"*.

**A feature moves here when it has a second surface, not before.** That is the same bar
`constraints.md` sets for extracting a function ("a second caller… is enough"), applied to a
directory. Creating `features/booking/` today by moving one route's components into it would
buy a longer import path and nothing else.

Business logic does not live here. These are components; rules are in `lib/domain`, and that
does not bend because a directory sounds domain-shaped.
