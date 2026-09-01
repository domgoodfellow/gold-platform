-- `anon` and `authenticated` stop holding TRUNCATE on every table.
--
-- **Found by the second sweep, and it is the vendor's default rather than this repository's
-- doing** — which is exactly why it is worth a migration instead of a note. No file here grants
-- it: Supabase's local stack sets `alter default privileges in schema public grant ... to anon,
-- authenticated`, and the residue after this repo's per-table grants is `Dxtm` — TRUNCATE,
-- REFERENCES, TRIGGER and MAINTAIN — on all forty-five tables, including the ones whose whole
-- design is that a caller may not write them.
--
-- **TRUNCATE is the one that matters, and the reason is that RLS does not apply to it.** Every
-- guarantee in this schema is a policy or a column grant, and both are evaluated per row or per
-- column; `truncate` is neither. A role holding it can empty a tenant's table without a single
-- policy being consulted — there is no `using` clause to decline, because there is no row being
-- considered.
--
-- **It is not reachable today, and that is not the standard this repository holds itself to.**
-- PostgREST issues `select`, `insert`, `update`, `delete` and `rpc` and has no `truncate` verb,
-- so no HTTP request can reach it; it would take a direct SQL connection as `anon`, which needs
-- credentials nobody has. But `payment_webhook` "holds no grant on any table at all" and
-- `platform-staff.test.ts` asserts `permission denied` rather than a policy declining, on the
-- argument that a privilege that does not exist survives a policy written wrongly later. This is
-- the same argument, applied to a privilege that arrived by default instead of by decision.
--
-- **The other three are assessed and deliberately left.** REFERENCES lets a role point a foreign
-- key at these tables and TRIGGER lets it attach a trigger — both need `create` on some schema to
-- have anything to point or attach, and neither `anon` nor `authenticated` holds `create` on
-- `public` or `app`. MAINTAIN permits `vacuum` and `analyze`, which destroy nothing. Revoking
-- four things where one is the risk would be a wider change with the same benefit and more ways
-- to surprise the vendor's own tooling.

revoke truncate on all tables in schema public from anon, authenticated;

-- **The half that makes it stay true.** Without this, the next table created inherits TRUNCATE
-- from the same default that granted it forty-five times already — which is the inherited-grant
-- trap this sweep exists to close, arriving from the other direction: not a column added after a
-- grant, but a table.
alter default privileges in schema public
  revoke truncate on tables from anon, authenticated;
