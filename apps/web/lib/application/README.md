# Web application layer

Each module represents one recognizable application use case. It coordinates bounded domain
reads, provider availability, and typed read/page-model composition. Functions normally accept
the authenticated `Db` handle explicitly.

The application layer does not own RLS, database invariants, business-rule reimplementation,
React/JSX, Tailwind, Next route APIs, redirects, UI state, or vendor dialects. It may consume
domain readers, adapters, API clients, database types, and pure helpers. Routes retain request
parsing and guards; features render the resulting model.
