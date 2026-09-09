-- The Launch invariant, closed at the transition itself rather than trusted to whoever calls it.
--
-- `launch_organization` checked one thing: whether the caller held `organization.manage`. It
-- checked nothing about blockers, because that computation lived entirely in TypeScript
-- (`computeReadiness`, called by the domain layer's `launchOrganization` before it ever reached
-- this function). Anyone holding `organization.manage` could call `launch_organization` directly
-- through PostgREST and skip that computation altogether — the capability check was real, but it
-- was not the invariant this platform actually needs, which is:
--
--   An organization cannot transition SETUP -> LIVE while a BLOCKER exists, regardless of which
--   caller invokes the transition.
--
-- **What does not move into SQL.** `outstandingModuleSetup` stays exactly where it is — a
-- TypeScript function producing human-readable notes for every module with something left to
-- finish, warnings included. Porting that whole function into a trigger would be the "second
-- calculation" this repository's own rule against duplicated business logic refuses, and it
-- would drag presentation text into a place that should only ever answer yes or no.
--
-- **What does.** Of everything `outstandingModuleSetup` can say, exactly two conditions were
-- ever classified as launch-blocking (public booking with nothing to reach, card payments with
-- nothing connected) -- and both are pure facts already sitting in tables: which modules are
-- switched on, whether an organization has a slug, whether any work item type is published for
-- booking, whether a payment account row exists. Nothing here reads an environment variable or
-- asks an adapter which processor is configured -- "no payment account row for this
-- organization" is true in exactly the cases that mattered anyway, so the predicate stays a
-- database fact and nothing else.
--
-- **One function, two callers, never two definitions.** `computeReadiness` now asks this
-- function which keys are blocking, for presentation; the trigger below asks the same function,
-- for enforcement. Neither carries its own opinion about which conditions count.

-- `public`, not `app`, and that is not a slip (`booking_organization` carries the same note).
-- Everything in `app` is machinery for policies and triggers and is deliberately unreachable
-- from outside -- PostgREST exposes `public` alone. This one is meant to be called by
-- `computeReadiness` as well as by the trigger below, so it lives where callable things live.
create function public.organization_launch_blockers(p_id uuid)
returns text[]
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_slug     text;
  v_booking  boolean;
  v_cards    boolean;
  v_blockers text[] := array[]::text[];
begin
  select o.slug into v_slug from public.organizations o where o.id = p_id;

  select exists (
    select 1 from public.organization_modules m
    where m.organization_id = p_id and m.module_key = 'booking'
  ) into v_booking;

  -- A switched-on public page with no address, or nothing published to it, is unreachable --
  -- not merely unfinished (`outstandingModuleSetup`'s own two notes for this module).
  if v_booking and (
    v_slug is null
    or not exists (
      select 1 from public.work_item_types t
      where t.organization_id = p_id and t.booking_status_id is not null
    )
  ) then
    v_blockers := array_append(v_blockers, 'booking');
  end if;

  select exists (
    select 1 from public.organization_modules m
    where m.organization_id = p_id and m.module_key = 'card_payments'
  ) into v_cards;

  -- No connected account is the one fact worth checking here, and it is true whether the cause
  -- is "this deployment has no processor" or "nobody has connected one yet" -- either way,
  -- nothing behind the switch actually works.
  if v_cards and not exists (
    select 1 from public.payment_accounts a where a.organization_id = p_id
  ) then
    v_blockers := array_append(v_blockers, 'card_payments');
  end if;

  return v_blockers;
end;
$fn$;

comment on function public.organization_launch_blockers(uuid) is
  'The one definition of what blocks SETUP -> LIVE. Read by computeReadiness for presentation and enforced by organizations_check_launch_readiness for real -- never duplicated, only called twice.';

revoke all on function public.organization_launch_blockers(uuid) from public;
grant execute on function public.organization_launch_blockers(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- The atomic gate
-- ---------------------------------------------------------------------------

-- **A trigger, not a second check inside `launch_organization`.** The function's own capability
-- check and this trigger answer different questions -- who may attempt the transition, and
-- whether the transition is currently legal -- and I13 already settled that shape for
-- `work_items.status_id`: a trigger reading a sibling table, firing inside the same statement as
-- the write, so there is no round trip in which a blocker could appear or disappear unseen. It
-- fires on the transition itself rather than on the function, so it holds regardless of which
-- caller or future code path ever attempts to write `operational_state` -- the invariant belongs
-- to the column, not to one function's manners.
create function app.check_launch_readiness()
returns trigger
language plpgsql
set search_path = ''
as $fn$
declare
  v_blockers text[];
begin
  v_blockers := public.organization_launch_blockers(new.id);

  if array_length(v_blockers, 1) > 0 then
    raise exception 'this business still has something switched on and not working: %',
      array_to_string(v_blockers, ', ')
      using errcode = '55000';
  end if;

  return new;
end;
$fn$;

create trigger organizations_check_launch_readiness
  before update of operational_state on public.organizations
  for each row
  when (old.operational_state = 'setup' and new.operational_state = 'live')
  execute function app.check_launch_readiness();

comment on trigger organizations_check_launch_readiness on public.organizations is
  'I13''s shape, one table over: refuses SETUP -> LIVE while public.organization_launch_blockers(id) is non-empty, inside the same statement that would otherwise commit it.';
