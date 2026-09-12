# Production

The live deployment: Vercel Production for both `web` and `api`, against the live Supabase
project.

The full, current variable-by-variable status for this tier is the root `SETUP.md`'s final
table. This file does not repeat it.

What belongs here instead, as it accumulates: anything true of Production specifically that
isn't a variable — which Supabase project is linked (`supabase link`, `infrastructure/deployment/
supabase/README.md`), and eventually the domain(s) it answers on
(`infrastructure/deployment/domains/README.md`, not yet built). Nothing in this file is a secret
value; secret values live in Vercel's own Production environment, entered once, never committed.
