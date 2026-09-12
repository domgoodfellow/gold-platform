-- `start_support_session` (20260915000004) inserted unconditionally: a second staff member's
-- click, or the same staff member's second click, opened a second row for the same
-- (staff_user_id, organization_id) pair every time. Nothing downstream widened what that let
-- anyone read -- support sessions are the audit trail for a read D28 already grants, not a
-- second access path -- but "who is currently supporting this organization" stopped being a
-- question with one answer, and an audit trail that can't say which of two open sessions is the
-- real one is a broken audit trail even when nothing else breaks with it.
--
-- **The invariant**: at most one *open* (`ended_at is null`) session per staff member per
-- organization, at all times, including under two concurrent calls.
--
-- **Why not an index alone.** `expires_at` is not something a partial index's predicate can key
-- on -- `now()` is stable, not immutable, and an index predicate must be. So the index below
-- guards `ended_at is null` only, which admits a session that has quietly lapsed past its
-- `expires_at` without anyone calling `end_support_session`. The function is what turns that into
-- the right behaviour: it closes out a lapsed session -- the same "retire the stale one before
-- inserting a fresh one" shape `invite_member` already uses for an expired pending invitation --
-- before deciding whether a new row is needed at all.
--
-- **Why not the index alone for concurrency either.** Two simultaneous calls with *no* existing
-- row for the pair have nothing for `select ... for update` to lock, so the read-then-insert
-- itself would still race. `pg_advisory_xact_lock`, keyed by hashing the two ids together, closes
-- that gap: the second concurrent call blocks until the first call's transaction (one call, one
-- PostgREST request, one transaction) commits, at which point it finds the row the first call
-- just made and returns its id rather than racing to insert a second one. The unique index is
-- the backstop that makes a lock ever being bypassed a hard error instead of a silent duplicate,
-- not the primary mechanism.

-- Leads with organization_id per I2 -- ordering the two columns the other way round would
-- enforce exactly the same uniqueness (a two-column unique index cares which columns, not which
-- comes first), so unlike this file's three named exceptions there is no real reason for this one
-- to lead any other way.
create unique index platform_support_sessions_staff_org_open_unique
  on public.platform_support_sessions (organization_id, staff_user_id)
  where ended_at is null;

comment on index platform_support_sessions_staff_org_open_unique is
  'At most one open (unended) support session per staff member per organization. Does not key on expires_at -- an index predicate must be immutable -- so start_support_session closes out a lapsed session before it would need a second open row.';

create or replace function public.start_support_session(
  p_organization_id uuid,
  p_reason          text default null
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_staff uuid := (select auth.uid());
  v_id    uuid;
begin
  perform app.require_platform_staff();

  -- Serializes concurrent starts for this exact (staff, organization) pair. hashtextextended is
  -- a core builtin, same as the sha256 this schema already leans on elsewhere for the same
  -- no-extension reason. The lock is transaction-scoped, so it releases the moment this call's
  -- own request finishes -- a second call blocks only until the first one actually commits.
  perform pg_advisory_xact_lock(
    hashtextextended(v_staff::text || ':' || p_organization_id::text, 0)
  );

  -- Retire a session that has lapsed on its own, so it does not occupy the one open slot the
  -- unique index allows -- the same shape invite_member already uses for a stale pending
  -- invitation.
  update public.platform_support_sessions
     set ended_at = now()
   where staff_user_id = v_staff
     and organization_id = p_organization_id
     and ended_at is null
     and expires_at <= now();

  -- Idempotent: a staff member opening an organization they are already actively supporting
  -- gets the same session back rather than a second row naming the same click twice.
  select id into v_id
    from public.platform_support_sessions
   where staff_user_id = v_staff
     and organization_id = p_organization_id
     and ended_at is null;

  if v_id is not null then
    return v_id;
  end if;

  insert into public.platform_support_sessions (organization_id, staff_user_id, reason)
  values (p_organization_id, v_staff, nullif(btrim(coalesce(p_reason, '')), ''))
  returning id into v_id;

  return v_id;
end;
$fn$;

comment on function public.start_support_session(uuid, text) is
  'Opens an audited support session on one organization, or returns the caller''s already-open one for the same organization unchanged (20260915000010) -- idempotent under concurrency via an advisory lock plus a partial unique index. Staff-only (app.require_platform_staff). Grants no new read -- see the table comment.';

revoke all on function public.start_support_session(uuid, text) from public;
grant execute on function public.start_support_session(uuid, text) to authenticated;
